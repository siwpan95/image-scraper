// @scraper/core — browser_html 驱动（driver-browser-html）。
//
// 职责（移植 legacy/sources/engine.py::_run_browser_html，L892–1088）：
//   开 Chromium 过 Anubis/Cloudflare/Consent 等验证页 → 渲染后 HTML 跑
//   parser-html（url_extract / block_extract）→ buildTasks → 交给下载器。
//   支持 page 分页与 none（无限滚动）两类分页。
//
// Playwright 为**可选依赖**：
//   - 未安装时本插件不注册 'browser_html' 驱动，依赖它的源由 inject 级联保持
//     下线并在运行时点名（driver-unavailable:browser_html），HTTP 源不受影响；
//   - 安装：npm i playwright && npx playwright install chromium。
import { Service } from 'cordis'
import { createRequire } from 'node:module'
import { subst, substAny, buildTasks, resolveInt, pageCount } from './engine.js'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const STEALTH_JS = `
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
`

/** 粗判反爬验证页（Anubis/Cloudflare/Consent 等）——对齐 Python _is_antibot_page */
export function isAntibotPage(content) {
  if (!content) return false
  const low = content.toLowerCase()
  const markers = [
    'not a bot', 'making sure you', 'just a moment', 'verify you are human',
    'attention required', 'checking your browser', 'enable javascript and cookies',
    'performance & security by cloudflare', 'why am i seeing this',
    'before you continue to google', 'consent.google.com', 'we use cookies',
    'are you a robot', 'please verify you are a human', 'cf-browser-verification',
    'ray id', 'ddos-guard', 'security check',
  ]
  return markers.some((m) => low.includes(m))
}

/** 共享的浏览器上下文参数（对齐 Python 两处 ctx_args） */
export function contextArgs(proxy) {
  const args = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
  }
  if (proxy) args.proxy = { server: proxy }
  return args
}

export const LAUNCH_ARGS = ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-gpu']

/** playwright 可用性探测（未安装 → 驱动不注册） */
export function playwrightAvailable() {
  try {
    createRequire(import.meta.url).resolve('playwright')
    return true
  } catch {
    return false
  }
}

/** 懒加载 playwright（返回 { chromium } 或 null） */
export async function loadPlaywright(logger) {
  try {
    const pw = await import('playwright')
    return pw.chromium ? pw : (pw.default && pw.default.chromium ? pw.default : null)
  } catch (e) {
    logger?.warn?.('[driver-browser] playwright 动态加载失败: ' + (e && e.message ? e.message : e))
    return null
  }
}

class DriverBrowserHtmlService extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'driver-browser-html')
    this._pw = null
    this._browser = null // 单例浏览器（进程内复用，dispose 时关闭）
    this.impl = {
      name: 'browser_html',
      /** 全流程入口：browser_html 源的抓取+下载都由本驱动完成 */
      runSource: (opts) => this.runSource(opts),
      fetchUrl: async () => ({ status: 0, text: '' }),
      fetchPage: async () => ({ status: 0, items: [] }),
    }
    if (playwrightAvailable()) {
      ctx.effect(() => ctx.drivers.register('browser_html', this.impl))
      ctx.effect(() => () => this.closeBrowser())
    } else {
      ctx.logger.warn('[driver-browser-html] playwright 未安装 —— browser_html 源保持下线（安装: npm i playwright && npx playwright install chromium）')
    }
  }

  async closeBrowser() {
    try { if (this._browser) await this._browser.close() } catch { /* ignore */ }
    this._browser = null
    this._pw = null
  }

  /** 单例浏览器 + 每次运行独立 context（proxy 归 context 级） */
  async ensureBrowser(headless) {
    if (!this._pw) {
      this._pw = await loadPlaywright(this.ctx.logger)
      if (!this._pw) throw new Error('playwright 不可用')
    }
    if (!this._browser || !this._browser.isConnected()) {
      this._browser = await this._pw.chromium.launch({ headless: headless !== false, args: LAUNCH_ARGS })
    }
    return this._browser
  }

  async runSource({ def, active, ctxVars, proxy, maxImages, stats, sourceName, logger, o = {} }) {
    const log = logger || this.ctx.logger
    const name = sourceName || def.name
    const req = active.request
    const parse = active.parse
    const pag = req.pagination || { type: 'none' }
    const ptype = pag.type || 'none'

    const base_url = subst(req.url || '', ctxVars)
    if (!base_url || !base_url.startsWith('http')) {
      log.warn(`  [${name}] 无效 URL: '${base_url ? base_url.slice(0, 80) : '(空)'}' — 请指定 --url`)
      return { fetched: 0, completed: [], failed: [] }
    }

    log.info(`[${name}] (浏览器HTML) base=${base_url.slice(0, 70)} max=${maxImages} pag=${ptype}`)

    // 翻页计划（page 类型）
    let pages = [null]
    if (ptype === 'page') {
      const count = pageCount(pag, ctxVars, maxImages)
      const start = resolveInt(pag.start, ctxVars, 1)
      const step = resolveInt(pag.step, ctxVars, 1)
      pages = Array.from({ length: count }, (_, i) => start + i * step)
    }

    // 滚动次数：request.scroll > none 型 ctxVars.scrolls(默认10) > page 型 3
    let scrolls
    if (req.scroll !== undefined && req.scroll !== null) scrolls = resolveInt(req.scroll, ctxVars, 0)
    else if (ptype === 'none') scrolls = resolveInt(ctxVars.scrolls ?? 10, ctxVars, 10)
    else scrolls = 3

    const tasks = []
    const browser = await this.ensureBrowser(ctxVars.headless !== false)
    const context = await browser.newContext(contextArgs(proxy))
    const page = await context.newPage()
    await page.addInitScript(STEALTH_JS)

    try {
      for (let pidx = 0; pidx < pages.length; pidx++) {
        if (tasks.length >= maxImages) break
        const pv = pages[pidx]
        const pageMap = { ...ctxVars }
        if (pv !== null) pageMap.page = pv
        let url = subst(req.url || '', pageMap)

        // params / 翻页参数 / skip_empty_params → 拼成完整 URL（对齐 Python urlencode）
        let params = substAny(req.params || {}, pageMap)
        if (pv !== null && pag.param) params[pag.param] = pv
        if (req.skip_empty_params) {
          params = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ''))
        }
        if (params && Object.keys(params).length) {
          const q = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString()
          url = url + ((url.includes('?')) ? '&' : '?') + q
        }
        const headers = Object.fromEntries(
          Object.entries(req.headers || {}).filter(([, v]) => v !== null && v !== ''),
        )
        if (!url || !url.startsWith('http')) {
          log.warn(`  [${name}] 无效分页 URL: '${url ? url.slice(0, 80) : '(空)'}'`)
          continue
        }

        log.info(`  第 ${pidx + 1}/${pages.length} 页: ${url.slice(0, 70)}`)
        try {
          // commit：响应一返回就继续，反爬等待交给下面的轮询循环
          await page.goto(url, { waitUntil: 'commit', timeout: 30000, headers: Object.keys(headers).length ? headers : undefined })
        } catch (e) {
          log.warn(`  goto 异常: ${e && e.message ? e.message : e}`)
        }

        // 等待过反爬验证页并渲染出内容（30 × 2s）
        let content = ''
        for (let i = 0; i < 30; i++) {
          await sleep(2000)
          try { content = await page.content() } catch { content = '' }
          if (!isAntibotPage(content)) break
        }

        let title = ''
        try { title = await page.title() } catch { /* ignore */ }
        log.info(`  页面标题: ${title.slice(0, 60)}`)

        if (!content) {
          log.error('  页面未能加载：可能是网络被墙/代理不可达或拦截，请检查代理/网络后重试。')
          if (ptype === 'page') break
          continue
        }

        // 滚动加载懒加载图片后取最新 HTML
        if (scrolls > 0) {
          log.info(`  滚动加载 (${scrolls} 次)…`)
          for (let i = 0; i < scrolls; i++) {
            try { await page.evaluate('window.scrollTo(0, document.body.scrollHeight)') } catch { /* ignore */ }
            await sleep(1200)
            if (ptype === 'none' && tasks.length >= maxImages) break
          }
          try { content = await page.content() } catch { /* ignore */ }
        }

        const raw = this.ctx.parsers.resolve('html').run(content, parse, page.url(), { sourceName: name, logger: log })
        log.info(`  本页解析出 ${raw.length} 条候选`)
        buildTasks(raw, { cfg: def, ctxVars, maxImages, active, sourceName: name, tasks })
        log.info(`  累计任务: ${tasks.length}`)
        if (ptype === 'page' && !raw.length && pag.stop_when_empty !== false) {
          log.info('  本页无结果，停止翻页')
          break
        }
        if (pag.delay && pidx < pages.length - 1) await sleep(Number(pag.delay) * 1000)
      }
    } finally {
      await context.close().catch(() => {})
    }

    const cut = tasks.slice(0, maxImages)
    log.info(`  下载任务: ${cut.length}`)
    if (!cut.length) return { fetched: 0, completed: [], failed: [] }

    // 下载阶段：复用统一下载器（与 Python _run_browser_html 的 Downloader 一致）
    const session = this.ctx.downloader.session(name, {
      concurrency: o.concurrency, retries: o.retries,
      rateLimit: o.rateLimit, speedLimit: o.speedLimit, proxy,
    })
    const completed = await session.downloadBatch(cut, stats)
    return { fetched: cut.length, completed, failed: session.failed.slice() }
  }
}

DriverBrowserHtmlService.inject = ['config', 'drivers', 'downloader', 'parsers', 'logfile']

export default function driverBrowserHtmlPlugin(ctx, cfg) {
  ctx.plugin(DriverBrowserHtmlService, cfg)
}
