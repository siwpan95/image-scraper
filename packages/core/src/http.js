// @scraper/core — HTTP 通道（ctx.http）。取代 Python 版 engine.JsonSource 内联的 httpx 客户端。
//
// 语义对齐 Python 版（httpx.AsyncClient）：
//   - 跟随重定向（follow_redirects=True）
//   - **不使用环境变量/系统代理**（trust_env=False）——代理只来自显式传入，避免被 shell 的
//     HTTP_PROXY 静默改变行为
//   - 默认 UA 与 Accept 与 Python 版一致
//   - http/https 代理走 undici ProxyAgent；**socks5 不支持** → 由 driver-curl 承接（见 docs R4）
import { Service } from 'cordis'
import { ProxyAgent, fetch as undiciFetch } from 'undici'
import { DEFAULT_UA } from './config.js'

/** 用 URLSearchParams 拼查询串（空格→'+'，与 Python urlencode/quote_plus 一致） */
export function buildQuery(params) {
  if (!params) return ''
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    usp.append(k, String(v))
  }
  return usp.toString()
}

export function withQuery(url, params) {
  const q = buildQuery(params)
  if (!q) return url
  return url + (url.includes('?') ? '&' : '?') + q
}

class HttpService extends Service {
  constructor(ctx, cfg = {}) {
    super(ctx, 'http')
    this.timeout = cfg.timeout || 30000
    this.maxConnections = cfg.maxConnections || 32
    this.userAgent = cfg.userAgent || DEFAULT_UA
    this.accept = cfg.accept || 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
    this._agents = new Map()
    // 卸载本插件时关闭所有连接池
    ctx.effect(() => () => this.close())
  }

  dispatcher(proxy) {
    if (!proxy) return undefined
    if (this._agents.has(proxy)) return this._agents.get(proxy)
    const agent = new ProxyAgent({ uri: proxy, connections: this.maxConnections })
    this._agents.set(proxy, agent)
    return agent
  }

  /**
   * 通用请求。
   * @returns {Promise<{status:number, text:string, bytes:Uint8Array|null, headers:object, error:string}>}
   */
  async request(url, opts = {}) {
    const {
      method = 'GET',
      params = null,
      headers = {},
      body = undefined,
      proxy = '',
      timeout = this.timeout,
      accept = null,
      userAgent = null,
      speedLimit = 0, // KB/s，0=不限（对齐 Python Downloader._try 的流式节流）
    } = opts

    const finalUrl = params ? withQuery(url, params) : url
    const h = { 'User-Agent': userAgent || this.userAgent }
    if (accept !== null) h['Accept'] = accept
    if (body !== undefined) h['Content-Type'] = 'application/json'
    for (const [k, v] of Object.entries(headers)) {
      if (v !== undefined && v !== null && v !== '') h[k] = String(v)
    }

    try {
      const res = await undiciFetch(finalUrl, {
        method,
        headers: h,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        dispatcher: this.dispatcher(proxy || ''),
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      })

      let buf
      if (speedLimit > 0 && res.body) {
        // 流式读取并按 speedLimit 节流（每块读完 sleep 等效时长）
        const bytesPerSec = speedLimit * 1024
        const chunks = []
        let total = 0
        for await (const chunk of res.body) {
          chunks.push(chunk)
          total += chunk.length
          if (bytesPerSec > 0) {
            await new Promise((r) => setTimeout(r, (chunk.length / bytesPerSec) * 1000))
          }
        }
        buf = new Uint8Array(total)
        let off = 0
        for (const c of chunks) {
          buf.set(c, off)
          off += c.length
        }
      } else {
        buf = new Uint8Array(await res.arrayBuffer())
      }

      return {
        status: res.status,
        text: new TextDecoder('utf-8').decode(buf),
        bytes: buf,
        headers: Object.fromEntries(res.headers.entries()),
        error: '',
      }
    } catch (e) {
      return { status: 0, text: '', bytes: null, headers: {}, error: e && e.message ? e.message : String(e) }
    }
  }

  /** 只要文本（页面 / JSON） */
  async text(url, opts = {}) {
    const r = await this.request(url, opts)
    return { status: r.status, text: r.text, error: r.error }
  }

  /** 下载二进制（用于图片入库） */
  async bytes(url, opts = {}) {
    const r = await this.request(url, opts)
    return { status: r.status, bytes: r.bytes, error: r.error }
  }

  async close() {
    for (const agent of this._agents.values()) {
      try { await agent.close() } catch { /* ignore */ }
    }
    this._agents.clear()
  }
}

HttpService.inject = ['config']

export default function httpPlugin(ctx, cfg) {
  ctx.plugin(HttpService, cfg)
}
