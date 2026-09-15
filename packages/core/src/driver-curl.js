// @scraper/core — curl 驱动（driver-curl）。
//
// 与 driver-http 同一接口，但传输走 curl 子进程：curl 的 TLS 指纹可以穿过
// Cloudflare 对 Node/Python 客户端的托管质询（pixabay 系源依赖此通道）。
// 忠实移植 Python 版 engine.JsonSource._curl_get + _fetch_page 的 curl 分支。
import { Service } from 'cordis'
import { subst, substAny, apiError } from './engine.js'

class CurlDriverService extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'driver-curl')
    this.impl = {
      name: 'curl',
      fetchPage: (opts) => this.fetchPage(opts),
      fetchUrl: (url, opts = {}) => this.fetchUrl(url, opts),
    }
    ctx.effect(() => ctx.drivers.register('curl', this.impl))
  }

  async #parseResponse(cfg, active, url, r, state, logger) {
    const parse = active.parse
    if (r.status !== 200) {
      logger.warn(`  [${cfg.name}] HTTP ${r.status} (${url.slice(0, 70)})` + (r.error ? ` — ${r.error}` : ''))
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
      apiError(state.lastJson, cfg.name, logger)
      items = this.ctx.parsers.resolve('json').run(state.lastJson, parse)
    } else {
      items = this.ctx.parsers.resolve('html').run(r.text, parse, url, { sourceName: cfg.name, logger })
    }
    return { status: r.status, items }
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

    const r = await this.ctx.curl.get(url, { params, headers, proxy: mapping.__proxy || '' })
    return this.#parseResponse(cfg, active, url, r, state, log)
  }

  async fetchUrl(url, { cfg, active, headers = null, logger } = {}) {
    const log = logger || this.ctx.logger
    const req = active.request
    const hs = headers !== null ? { ...headers } : { ...(req.headers || {}) }
    for (const k of Object.keys(hs)) {
      if (hs[k] === null || hs[k] === undefined || hs[k] === '') delete hs[k]
    }
    const r = await this.ctx.curl.get(url, { headers: hs })
    return { status: r.status, text: r.text }
  }
}

CurlDriverService.inject = ['config', 'curl', 'parsers', 'drivers', 'logfile']

export default function driverCurlPlugin(ctx, cfg) {
  ctx.plugin(CurlDriverService, cfg)
}
