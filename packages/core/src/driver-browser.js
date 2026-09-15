// @scraper/core — browser 驱动（driver-browser）：Midjourney Explore 专用通道。
//
// 职责（移植 legacy/sources/engine.py::_run_browser + _collect_jobs/_build_browser_tasks/
// _browser_download，L706–1268）：
//   打开 explore（或指定内容链接）→ 监听 midjourney.com 的 JSON 响应收集 jobs →
//   Cloudflare challenge 等待 → 滚动加载 → 按 build.url_template 构造 CDN URL →
//   **在已验证的浏览器 session 内**用 page.evaluate(fetch) 下载（绕过 CDN 的 CF）。
//
// Playwright 为可选依赖：未安装时不注册 'browser' 驱动（源优雅下线）。
import { Service } from 'cordis'
import crypto from 'node:crypto'
import path from 'node:path'
import {
  contextArgs, LAUNCH_ARGS, playwrightAvailable, loadPlaywright, sleep,
} from './driver-browser-html.js'
import { toInt, subst } from './engine.js'

class DriverBrowserService extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'driver-browser')
    this._pw = null
    this._browser = null
    this.impl = {
      name: 'browser',
      runSource: (opts) => this.runSource(opts),
      fetchUrl: async () => ({ status: 0, text: '' }),
      fetchPage: async () => ({ status: 0, items: [] }),
    }
    if (playwrightAvailable()) {
      ctx.effect(() => ctx.drivers.register('browser', this.impl))
      ctx.effect(() => () => this.closeBrowser())
    } else {
      ctx.logger.warn('[driver-browser] playwright 未安装 —— browser 源保持下线（安装: npm i playwright && npx playwright install chromium）')
    }
  }

  async closeBrowser() {
    try { if (this._browser) await this._browser.close() } catch { /* ignore */ }
    this._browser = null
    this._pw = null
  }

  async ensureBrowser() {
    if (!this._pw) {
      this._pw = await loadPlaywright(this.ctx.logger)
      if (!this._pw) throw new Error('playwright 不可用')
    }
    if (!this._browser || !this._browser.isConnected()) {
      this._browser = await this._pw.chromium.launch({ headless: true, args: LAUNCH_ARGS })
    }
    return this._browser
  }

  /** _collect_jobs：从 API 响应 JSON 抽取 job 对象（含一层包装下探） */
  collectJobs(data, jobs) {
    const maybeAdd = (it) => {
      if (!it || typeof it !== 'object' || Array.isArray(it)) return false
      const jid = it.id
      if (typeof jid !== 'string' || !jid) return false
      if (Array.isArray(it.items) || it.prompt || it.job_type || it.video || it.video_url || it.type) {
        if (!jobs[jid]) jobs[jid] = it
        return true
      }
      return false
    }
    if (Array.isArray(data)) {
      for (const it of data) maybeAdd(it)
      return
    }
    if (data && typeof data === 'object') {
      if (maybeAdd(data)) return
      for (const v of Object.values(data)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && maybeAdd(v)) return
      }
    }
  }

  /** _build_browser_tasks：jobs → ImageTask[]（模板构造 + items 直链优先） */
  buildBrowserTasks(jobs, { cdn, suffix, build, variants, skipType, variantIndex, maxImages, sourceName, ctxVars }) {
    const tasks = []
    const tmpl = build.url_template || '{cdn}/{id}/0_{vi}{suffix}'
    let constructedFallback = 0
    for (const it of Object.values(jobs)) {
      if (skipType && it.type === skipType) continue
      const jid = it.id || ''
      const items = it.items || []
      const n = Math.max(items.length, 4)
      let vis
      if (variantIndex !== null && variantIndex !== undefined) {
        if (!(variantIndex >= 0 && variantIndex < n)) continue
        vis = [variantIndex]
      } else {
        vis = []
        for (let i = 0; i < Math.min(n, variants); i++) vis.push(i)
      }
      const promptObj = it.prompt || {}
      const decoded = promptObj.decodedPrompt || []
      const promptText = decoded.map((s) => (s && typeof s === 'object' ? s.content || '' : '')).join(' ')
      const author = it.username_v2 || it.display_name || ''
      for (const vi of vis) {
        // 优先用 API 返回的直接 URL，否则用模板构造
        const itemData = vi < items.length && items[vi] && typeof items[vi] === 'object' ? items[vi] : {}
        let url = itemData.image_url || itemData.imageUrl || itemData.url || itemData.path ||
          itemData.image_path || itemData.src || itemData.video_url || itemData.video || ''
        let width, height
        if (url) {
          width = toInt(itemData.width)
          height = toInt(itemData.height)
        } else {
          url = subst(tmpl, { cdn, id: jid, vi, suffix, ...ctxVars })
          width = toInt(it.width)
          height = toInt(it.height)
          constructedFallback++
        }
        tasks.push({
          url, source: sourceName, title: promptText, author,
          width, height, referer: 'https://www.midjourney.com/',
          localPath: '', downloaded: false,
          meta: { job_id: jid, variant: vi, job_type: it.job_type || '' },
        })
      }
    }
    if (constructedFallback > 0) tasks._logNote = `  CDN URL 模板构造: ${constructedFallback}/${tasks.length} 个`
    return tasks.slice(0, maxImages)
  }

  /** _page_fetch：在已验证的浏览器 session 内用 JS fetch 下载（ArrayBuffer → base64） */
  static BROWSER_FETCH_JS = `async (url) => {
    try {
      const resp = await fetch(url, {
        headers: { 'Referer': 'https://www.midjourney.com/', 'Accept': '*/*' },
        redirect: 'follow',
      });
      if (!resp.ok) return {error: 'HTTP ' + resp.status};
      const buf = await resp.arrayBuffer();
      if (buf.byteLength < 300) return {error: 'too small: ' + buf.byteLength};
      const bytes = new Uint8Array(buf);
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return {ok: true, b64: btoa(binary), size: buf.byteLength};
    } catch(e) {
      return {error: e.message};
    }
  }`

  async pageFetch(page, url, log) {
    try {
      const result = await page.evaluate(DriverBrowserService.BROWSER_FETCH_JS, url)
      if (result && result.ok && result.b64) {
        return Buffer.from(result.b64, 'base64')
      }
      if (result && result.error) log.debug?.(`  CDN fetch ${url.slice(0, 80)}: ${result.error}`)
    } catch (e) {
      log.debug?.(`  page.evaluate 异常 ${url.slice(0, 80)}: ${e && e.message ? e.message : e}`)
    }
    return null
  }

  async runSource({ def, ctxVars, proxy, maxImages, stats, sourceName, logger, o = {} }) {
    const log = logger || this.ctx.logger
    const name = sourceName || def.name
    const b = def.browser || {}
    const cdn = b.cdn || ''
    const sizeSuffix = b.size_suffix || {}
    const suffix = sizeSuffix[ctxVars.size || 'thumb'] ?? sizeSuffix.thumb ?? ''
    const build = b.build || {}
    const explore = b.explore_url || ''
    const tab = b.tab || ctxVars.tab || 'top' // browser 配置可覆盖默认 tab
    const scrolls = toInt(ctxVars.scrolls, 20) || 20
    const headless = ctxVars.headless !== false
    const variants = build.variants ?? 4
    const skipType = b.skip_type

    log.info(`[${name}] (浏览器) tab=${tab} size=${ctxVars.size} max=${maxImages}`)

    // 指定内容链接源：未提供链接则直接跳过（不退回 explore）
    const contentUrl = String(ctxVars.content_url || '').trim()
    if (def.require_content_url && !contentUrl) {
      log.warn(`  源 [${name}] 未提供内容链接（content_url 为空），跳过。请在「源专属设置 → 目标 URL」填写 Midjourney 链接。`)
      return { fetched: 0, completed: [], failed: [] }
    }

    const browser = await this.ensureBrowser()
    const context = await browser.newContext({ ...contextArgs(proxy), headless })
    const page = await context.newPage()
    await page.addInitScript(`
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
    `)

    const jobs = {}
    let apiHits = 0
    const pending = new Set()
    const onResp = async (response) => {
      try {
        const url = response.url()
        if (!url.includes('midjourney.com')) return
        let data
        try { data = await response.json() } catch { return }
        apiHits++
        if (apiHits <= 5) log.info(`  响应: ${url.slice(0, 80)} status=${response.status()}`)
        this.collectJobs(data, jobs)
      } catch { /* ignore */ }
    }
    page.on('response', (response) => {
      const p = onResp(response)
      pending.add(p)
      p.finally(() => pending.delete(p))
    })

    try {
      // 指定内容链接 / explore 流程
      let parsedIdx = null
      let target
      if (contentUrl) {
        target = contentUrl
        log.info(`  指定内容链接: ${target}`)
        try {
          const idx = new URL(contentUrl).searchParams.get('index')
          if (idx) parsedIdx = Math.max(0, parseInt(idx, 10) - 1)
        } catch { /* ignore */ }
        if (Number.isNaN(parsedIdx)) parsedIdx = null
      } else {
        target = `${explore}?tab=${tab}`
      }

      let gotoErr = null
      try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 })
      } catch (e) {
        gotoErr = e
        log.warn(`  goto 异常: ${e && e.message ? e.message : e}`)
      }
      log.info(`  页面标题: ${await page.title()}`)
      await sleep(6000)
      // 导航未成功 → 直接结束，避免无意义的滚动空转
      const purl = page.url()
      if (!purl || purl.startsWith('chrome-error://') || purl.startsWith('about:blank') || purl.startsWith('data:')) {
        if (gotoErr && String(gotoErr).toUpperCase().includes('PROXY')) {
          log.error('  代理连接失败（ERR_PROXY_CONNECTION_FAILED）：代理不可达。请检查代理地址/端口，或确认本地代理客户端（clash/v2ray 等）已启动。')
        } else {
          log.error(`  页面未能加载（${purl}）：可能是网络被墙或 Cloudflare 拦截，请检查代理 / 网络后重试。`)
        }
        return { fetched: 0, completed: [], failed: [] }
      }

      // Cloudflare challenge 检测 + 轮询等待
      let cfDetected = false
      for (let cfAttempt = 0; cfAttempt < 15; cfAttempt++) {
        const title = await page.title()
        if (!title.toLowerCase().includes('moment') && !title.toLowerCase().includes('challenge')) break
        if (!cfDetected) {
          log.warn('  Cloudflare challenge 检测到，等待自动通过...')
          cfDetected = true
        }
        await sleep(4000)
        if (cfAttempt > 0 && cfAttempt % 3 === 0) {
          try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }) } catch { /* ignore */ }
        }
      }
      if (cfDetected) log.info(`  Cloudflare 等待结束，页面标题: ${await page.title()}`)

      // 滚动加载
      log.info(`  滚动加载 (最多 ${scrolls} 次)…`)
      for (let i = 0; i < scrolls; i++) {
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
        await sleep(1500)
        if (Object.keys(jobs).length >= maxImages * 3) {
          log.info('    任务充足，停止滚动')
          break
        }
      }
      await sleep(3000)
      if (pending.size) await Promise.allSettled([...pending])
      log.info(`  API 响应命中: ${apiHits} 次`)
      log.info(`  捕获 ${Object.keys(jobs).length} jobs`)
      if (!Object.keys(jobs).length) {
        log.warn(`  未捕获到任何 job；页面最终 URL: ${page.url()}`)
        const content = await page.content()
        log.info(`  页面内容长度: ${content.length} 字节`)
      }
      log.info(`  CDN URL 模板: ${build.url_template || '?'}`)

      // 变体下标：mj_index 优先，其次取链接中的 ?index=N
      let mjIndex = toInt(ctxVars.mj_index, 0)
      if (mjIndex < 0) mjIndex = 0
      const variantIndex = mjIndex > 0 ? mjIndex - 1 : parsedIdx

      const tasks = this.buildBrowserTasks(jobs, {
        cdn, suffix, build, variants, skipType, variantIndex, maxImages, sourceName: name, ctxVars,
      })
      if (tasks._logNote) log.info(tasks._logNote)
      log.info(`  下载任务: ${tasks.length}`)
      if (!tasks.length) {
        log.warn(`  源 [${name}] 无任务`)
        return { fetched: 0, completed: [], failed: [] }
      }

      // 浏览器内下载（绕过 CDN Cloudflare）
      const completed = []
      const failed = []
      const outDir = this.ctx.storage.dir(name)
      const media = this.ctx.media
      const concurrency = Number(o.concurrency) > 0 ? Number(o.concurrency) : 5
      let running = 0

      const runOne = async (t) => {
        while (running >= concurrency) await sleep(50)
        running++
        try {
          const h = crypto.createHash('md5').update(t.url).digest('hex').slice(0, 12)
          const rawExt = path.extname(t.url.split('?')[0]).toLowerCase()
          let ext = media.extOf(t.url) || (rawExt.startsWith('.') ? rawExt : '') || '.png'
          let fname = `${name}_${h}${ext}`
          if (this.ctx.storage.exists(name, fname)) {
            t.localPath = path.join(outDir, fname)
            t.downloaded = true
            stats.skipped++
            completed.push(t)
            return
          }
          let content = await this.pageFetch(page, t.url, log)
          if (!content) {
            for (const fb of media.fallbacks(t.url, ['image', 'video'])) {
              content = await this.pageFetch(page, fb, log)
              if (content) {
                const e = path.extname(fb.split('?')[0]).toLowerCase()
                if (media.isMedia(fb)) fname = `${name}_${h}${e}`
                break
              }
            }
          }
          if (content && content.length > 300) {
            this.ctx.storage.write(name, fname, content)
            t.localPath = path.join(outDir, fname)
            t.downloaded = true
            stats.downloaded++
            if (stats.downloaded <= 5 || stats.downloaded % 50 === 0) log.info(`  [${stats.downloaded}] ${fname}`)
            completed.push(t)
          } else {
            stats.errors++
            failed.push({
              url: t.url, referer: t.referer, source: t.source, title: t.title,
              author: t.author, width: t.width, height: t.height, meta: t.meta,
            })
          }
        } finally {
          running--
        }
      }
      await Promise.all(tasks.map((t) => runOne(t)))
      return { fetched: tasks.length, completed, failed }
    } finally {
      await context.close().catch(() => {})
    }
  }
}

DriverBrowserService.inject = ['config', 'drivers', 'media', 'storage', 'logfile']

export default function driverBrowserPlugin(ctx, cfg) {
  ctx.plugin(DriverBrowserService, cfg)
}
