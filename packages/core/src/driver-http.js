// @scraper/core — HTTP 驱动（driver-http）。
//
// 职责：把「active 配置 + 模板变量」变成一次真实请求并解析出原始条目列表。
// 忠实移植 Python 版 engine.JsonSource._fetch_page 的 HTTP 分支（curl 分支在 driver-curl）。
//
// 注册方式：ctx.effect(() => ctx.drivers.register('http', impl))
//   —— 驱动插件卸载时注册自动撤销，依赖该驱动的源随之由 inject 级联下线。
import { Service } from 'cordis'
import { subst, substAny, apiError } from './engine.js'

class HttpDriverService extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'driver-http')
    this.impl = {
      name: 'http',
      /** 单页抓取：{ cfg, active, mapping, state, logger } → { status, items } */
      fetchPage: (opts) => this.fetchPage(opts),
      /** 任意 URL 抓取（详情页 / 二级链接复用） */
      fetchUrl: (url, opts = {}) => this.fetchUrl(url, opts),
    }
    ctx.effect(() => ctx.drivers.register('http', this.impl))
  }

  async fetchPage({ cfg, active, mapping, state, logger }) {
    const log = logger || this.ctx.logger
    const req = active.request
    const parse = active.parse
    const pag = req.pagination || {}

    const url = subst(req.url || '', mapping)
    if (!url || !url.startsWith('http')) {
      log.warn(`  [${cfg.name}] 无效 URL: '${url ? url.slice(0, 80) : '(空)'}' — 请指定 --url`)
      return { status: 0, items: [] }
    }

    let params = substAny(req.params || {}, mapping)
    const headers = { ...(req.headers || {}) }
    if (mapping.page !== undefined && mapping.page !== null && pag.param) params[pag.param] = mapping.page
    if (mapping.cursor !== undefined && mapping.cursor !== null && pag.param) params[pag.param] = mapping.cursor

    if (req.skip_empty_params) {
      params = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ''))
      for (const k of Object.keys(headers)) {
        if (headers[k] === null || headers[k] === undefined || headers[k] === '') delete headers[k]
      }
    }

    const body = req.body ? substAny(req.body, mapping) : undefined
    const method = String(req.method || 'GET').toUpperCase()

    const r = await this.ctx.http.request(url, {
      method,
      params: method === 'POST' ? params : params, // httpx 对 POST 也带 query params
      headers,
      body,
      proxy: mapping.__proxy || '',
      accept: undefined, // 不覆盖请求头里的 Accept（源自己声明）
    })

    if (r.status !== 200) {
      log.warn(`  [${cfg.name}] HTTP ${r.status} (${url.slice(0, 70)})` + (r.error ? ` — ${r.error}` : ''))
      return { status: r.status, items: [] }
    }

    state.lastJson = null
    let items = []
    if (parse.format === 'json') {
      try {
        state.lastJson = JSON.parse(r.text)
      } catch {
        return { status: r.status, items: [] }
      }
      apiError(state.lastJson, cfg.name, log)
      items = this.ctx.parsers.resolve('json').run(state.lastJson, parse)
    } else {
      items = this.ctx.parsers.resolve('html').run(r.text, parse, url, { sourceName: cfg.name, logger: log })
    }
    return { status: r.status, items }
  }

  async fetchUrl(url, { cfg, active, headers = null, logger } = {}) {
    const log = logger || this.ctx.logger
    const req = active.request
    const hs = headers !== null ? { ...headers } : { ...(req.headers || {}) }
    for (const k of Object.keys(hs)) {
      if (hs[k] === null || hs[k] === undefined || hs[k] === '') delete hs[k]
    }
    try {
      const r = await this.ctx.http.request(url, { method: 'GET', headers: hs })
      return { status: r.status, text: r.text }
    } catch (e) {
      log.warn(`  [${cfg.name}] 请求失败: ${e && e.message ? e.message : e}`)
      return { status: 0, text: '' }
    }
  }
}

HttpDriverService.inject = ['config', 'http', 'parsers', 'drivers', 'logfile']

export default function driverHttpPlugin(ctx, cfg) {
  ctx.plugin(HttpDriverService, cfg)
}
