// @scraper/core — 源注册表 + 调度（ctx.sources）。
//
// 这是「一切皆插件」的中枢：
//   - 每个源插件 register 一份声明（driver / parse / pagination / item / 自身 schema）；
//   - run() 组装模板变量 → 交给分页器驱动循环 → 交给驱动抓取 → 引擎构建任务 → 下载器入库。
//
// 取代 Python 版的 registry.build_source + mj_scraper.run_source + engine.JsonSource.run：
//   1. 模板变量不再来自 80 行中心化 if 表，而是「共享层 + 源自身 schema」两层合成；
//   2. 抓取循环按 pagination.type 从注册表解析，不再是 if 链；
//   3. 传输按 fetch/driver 从注册表解析，不再是 if 链。
import { Service } from 'cordis'
import { makeStats } from './downloader.js'
import {
  activeConfig, buildTasks, pyQuote, subst, substAny,
} from './engine.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 只保留显式给出的键（用于区分「用户/配置真的写了」与「schema 填的默认」） */
function pickExplicit(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

/** booru 系 eff_tags：tags + rating 后缀 + 黑名单取反（对齐 Python _build_ctx 派生逻辑） */
function computeEffTags(v, def) {
  let eff = v.tags ?? 'art'
  if (v.rating) {
    const rm = def.ratingMap || {}
    eff += ' rating:' + (rm[v.rating] ?? v.rating)
  }
  if (v.booru_exclude) {
    eff += ' ' + String(v.booru_exclude).split(',').map((t) => t.trim()).filter(Boolean).map((t) => '-' + t).join(' ')
  }
  return eff.trim()
}

class SourcesService extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'sources')
    this.defs = new Map()
    this._altWarned = new Set()
  }

  /** 注册一个源（源插件调用）；重复注册视为错误，避免静默覆盖 */
  register(def) {
    if (!def || !def.name) throw new Error('[sources] 注册的源缺少 name')
    if (this.defs.has(def.name)) throw new Error('[sources] 源重复注册: ' + def.name)
    this.defs.set(def.name, def)
    this.ctx.emit('source/registered', { name: def.name })
    this.ctx.logger.debug?.('[sources] ← ' + def.name)
    return () => {
      this.defs.delete(def.name)
      this.ctx.emit('source/unregistered', { name: def.name })
    }
  }

  names() {
    return [...this.defs.keys()].sort()
  }

  get(name) {
    return this.defs.get(name)
  }

  has(name) {
    return this.defs.has(name)
  }

  /** 供 CLI / GUI 生成参数与校验 */
  schemas() {
    return [...this.defs.values()].map((d) => ({ name: d.name, display: d.display, schema: d.schema, config: d.config }))
  }

  /**
   * 组装模板变量。键名刻意使用 snake_case，与 JSON 模板里的 {var} 一致。
   * 优先级：CLI 显式值 > cordis.yml 显式值 > 源 schema 默认值 > 共享默认。
   */
  templateVars(def, o = {}) {
    const name = def.name
    const key = this.ctx.settings.key(name) || def.key || ''
    const url = o.url || ''
    let pageOrigin = ''
    if (url) {
      try { pageOrigin = new URL(url).origin + '/' } catch { /* ignore */ }
    }

    const d = this.ctx.config.defaults
    // 共享默认（来自 config 插件 + run 选项）
    const shared = {
      query: '',
      max_images: o.maxImages ?? d.maxImages,
      nsfw: false,
      pages: 3,
      tags: 'art',
      rating: 's',
      limit: 40,
      booru_exclude: '',
      tab: 'top',
      size: 'thumb',
      scrolls: 20,
      headless: true,
      mode: '',
      order: '',
      sorting: '',
      // 源 schema 全量（含默认）→ CLI 显式 → yml 显式
      ...(def.config || {}),
      ...pickExplicit(o),
      ...pickExplicit(def.configExplicit),
    }
    shared.key = key
    shared.url = o.url || ''
    let pageOrigin2 = ''
    if (shared.url) {
      try { pageOrigin2 = new URL(shared.url).origin + '/' } catch { /* ignore */ }
    }
    shared.page_origin = pageOrigin2
    shared.content_url = o.contentUrl || shared.url || ''
    shared.mj_index = o.mjIndex ?? 0

    // 派生变量（booru 系 eff_tags / 编码 / purity）
    shared.query_encoded = pyQuote(shared.query)
    shared.eff_tags = computeEffTags(shared, def)
    shared.eff_tags_encoded = pyQuote(shared.eff_tags)
    shared.purity = shared.nsfw && key ? '111' : '100'
    shared.nsfw_flag = shared.nsfw ? 'true' : ''
    shared.browsing = shared.nsfw ? 31 : ''
    return shared
  }

  /** 二级抓取：搜索页抽出的 url 实为详情页链接，逐条抓取后用 parse.detail 再抽最终媒体地址 */
  async resolveDetailLinks(items, { def, active, driver, state, proxy, maxImages, logger }) {
    const detailCfg = active.parse?.detail
    if (!detailCfg) return items
    const headers = { ...(active.request?.headers || {}) }
    const delay = detailCfg.delay
    const out = []
    const seenDetail = new Set()
    for (const it of items) {
      if (out.length >= maxImages) break
      const durl = it && typeof it === 'object' ? it.url : String(it)
      if (!durl || seenDetail.has(durl)) continue
      seenDetail.add(durl)
      const r = await driver.fetchUrl(durl, { cfg: def, active, headers, proxy, logger })
      if (r.status !== 200 || !r.text) continue
      out.push(...this.ctx.parsers.resolve('html').run(r.text, detailCfg, durl, {
        sourceName: def.name, logger,
      }))
      if (delay) await sleep(Number(delay) * 1000)
    }
    return out
  }

  /** 抓取阶段：由分页器驱动循环（对齐 Python JsonSource.fetch_tasks） */
  async fetchTasks({ def, active, ctxVars, maxImages, driver, state, proxy, logger }) {
    const pag = active.request?.pagination || { type: 'none' }
    const ptype = pag.type || 'none'
    if (!this.ctx.paginators.has(ptype)) {
      throw new Error('[sources] ' + def.name + ' 的分页类型未注册: ' + ptype)
    }
    const paginator = this.ctx.paginators.resolve(ptype)

    const tasks = []
    const host = {
      maxImages,
      tasks: () => tasks.length,
      fetchPage: async (pageOpts = {}) => {
        const mapping = { ...ctxVars }
        if (pageOpts.pageVal !== undefined) mapping.page = pageOpts.pageVal
        if (pageOpts.cursor !== undefined) mapping.cursor = pageOpts.cursor
        if (pageOpts.overrideQuery !== undefined) mapping.query = pageOpts.overrideQuery
        mapping.__proxy = proxy
        return driver.fetchPage({ cfg: def, active, mapping, state, logger })
      },
      buildTasks: async (items) => {
        let resolved = items
        if (active.parse?.detail) {
          resolved = await this.resolveDetailLinks(resolved, {
            def, active, driver, state, proxy, maxImages, logger,
          })
        }
        buildTasks(resolved, { cfg: def, ctxVars, maxImages, active, sourceName: def.name, tasks })
      },
    }

    await paginator.run({ pag, ctxVars, maxImages, host })
    return tasks.slice(0, maxImages)
  }

  /**
   * 运行一个源（抓取 → 下载 → 落盘）。
   * @returns {Promise<{ok:boolean, name:string, stats?:object, reason?:string, message?:string}>}
   */
  async run(name, o = {}) {
    const log = this.ctx.logger
    const def = this.defs.get(name)
    if (!def) return { ok: false, name, reason: 'unknown', message: '未注册的源' }

    const stats = makeStats()
    stats.startTime = Date.now() / 1000
    log.info(`[${name}] 开始 (max=${o.maxImages ?? 100}, driver=${def.driver})`)

    // ── 代理决策（对齐 Python run_source：仅对 needs_proxy 的源分配代理）──
    let proxy = o.proxy ?? null
    if (def.needs_proxy) {
      if (o.autoProxy && !proxy) {
        const fetched = await this.ctx.proxy.autoFetch()
        if (fetched) {
          proxy = fetched
          log.info(`  自动代理: ${fetched}`)
        } else {
          const detected = await this.ctx.proxy.detect()
          if (detected) proxy = detected
        }
      }
      if (!proxy) proxy = await this.ctx.proxy.resolve(null)
      if (proxy && !(await this.ctx.proxy.reachable(proxy))) {
        log.warn(`  代理不可达，忽略并退回直连: ${proxy}`)
        proxy = ''
      }
    } else if (o.explicitProxy !== true) {
      proxy = '' // 不需要代理的源 → 直连
    }

    if (def.needs_proxy && !proxy) {
      log.warn(`源 [${name}] 跳过：GFW 封锁，需 --proxy (如 socks5://127.0.0.1:1080)`)
      return { ok: false, name, reason: 'needs-proxy' }
    }

    // ── 传输通道解析（driver / fetch）──
    const transport = def.fetch === 'curl'
      ? 'curl'
      : (def.driver === 'browser' || def.driver === 'browser_html') ? def.driver : 'http'
    if (!this.ctx.drivers.has(transport)) {
      log.warn(`源 [${name}] 跳过：所需驱动未挂载 "${transport}"（如未安装 Playwright，属预期行为）`)
      return { ok: false, name, reason: 'driver-unavailable:' + transport }
    }
    const driver = this.ctx.drivers.resolve(transport)

    // ── 模板变量 / active 配置 ──
    const ctxVars = this.templateVars(def, o)
    const active = activeConfig(def, ctxVars)
    if (active.viaAlt && !this._altWarned.has(name)) {
      this._altWarned.add(name)
      log.warn(`  [${name}] 未提供 API Key，回退到网页抓取(alt)；若该源已启用反爬(Anubis/Cloudflare 等)，可能返回 0 结果。`)
    }

    const state = { lastJson: null }

    try {
      const tasks = await this.fetchTasks({
        def, active, ctxVars, maxImages: o.maxImages ?? 100, driver, state, proxy, logger: log,
      })
      stats.fetched = tasks.length
      log.info(`  获取任务: ${tasks.length}`)

      if (tasks.length) {
        const session = this.ctx.downloader.session(name, {
          concurrency: o.concurrency,
          retries: o.retries,
          rateLimit: o.rateLimit,
          speedLimit: o.speedLimit,
          proxy,
        })
        const completed = await session.downloadBatch(tasks, stats)
        const meta = this.ctx.storage.writeMeta(name, stats, completed)
        log.info(`  元数据: ${meta.file} (${meta.count} imgs)`)
        if (session.failed.length) {
          const f = this.ctx.storage.writeFailed(name, session.failed)
          log.warn(`  失败清单已导出: ${f.file} (${f.count} 个 URL，可用 --retry-failed 重投)`)
        }
      } else {
        log.warn(`  源 [${name}] 无任务`)
      }
    } catch (e) {
      stats.endTime = Date.now() / 1000
      log.error(`源 [${name}] 异常: ${e && e.stack ? e.stack : e}`)
      return { ok: false, name, reason: 'error', message: e && e.message ? e.message : String(e), stats }
    }

    stats.endTime = Date.now() / 1000
    log.info(
      `[${name}] 完成 ${(stats.endTime - stats.startTime).toFixed(1)}s | ` +
      `获取 ${stats.fetched} | 下载 ${stats.downloaded} | 跳过 ${stats.skipped} | 失败 ${stats.errors}`,
    )
    return { ok: true, name, stats }
  }
}

SourcesService.inject = ['config', 'settings', 'proxy', 'downloader', 'storage', 'drivers', 'parsers', 'paginators', 'logfile']

export default function sourcesPlugin(ctx, cfg) {
  ctx.plugin(SourcesService, cfg)
}
