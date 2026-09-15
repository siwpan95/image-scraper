// @scraper/core — 代理服务（ctx.proxy）。取代 Python 版 config.py 的代理部分。
//
// 设计要点（沿用 Python 版语义）：
//   - 显式指定的代理优先；显式为空 = 直连，绝不静默套用系统代理；
//   - 自动探测仅在需要时发生：环境变量 → Windows 系统代理 → 常见本地端口探活；
//   - 不可达的代理会被丢弃（避免死代理拖垮整源，Python 版同样处理）。
import { Service } from 'cordis'
import net from 'node:net'
import { execFileSync } from 'node:child_process'

// 常见本地代理端口（Clash / v2ray / SS 等）
export const LOCAL_CANDIDATES = [
  'socks5://127.0.0.1:1080',
  'http://127.0.0.1:7890',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:8888',
  'socks5://127.0.0.1:10808',
  'http://127.0.0.1:10809',
  'socks5://127.0.0.1:7891',
]

/** 把 '127.0.0.1:7890' 规整为 'http://127.0.0.1:7890' */
export function normalizeEndpoint(ep) {
  const s = String(ep || '').trim()
  if (!s) return ''
  return s.includes('://') ? s : 'http://' + s
}

/** 解析代理串 → { protocol, host, port }；非法返回 null */
export function parseProxy(url) {
  try {
    const u = new URL(normalizeEndpoint(url))
    const port = Number(u.port || (u.protocol === 'socks5:' || u.protocol === 'socks4:' ? 1080 : 80))
    if (!u.hostname || !port) return null
    return { protocol: u.protocol.replace(':', ''), host: u.hostname, port }
  } catch {
    return null
  }
}

/** TCP 探活：能连上即认为可用 */
export function checkReachable(url, timeout = 1200) {
  const p = parseProxy(url)
  if (!p) return Promise.resolve(false)
  return new Promise((resolve) => {
    const sock = new net.Socket()
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(timeout)
    sock.once('connect', () => finish(true))
    sock.once('timeout', () => finish(false))
    sock.once('error', () => finish(false))
    sock.connect(p.port, p.host)
  })
}

function envProxy() {
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    const v = (process.env[k] || '').trim()
    if (v) return normalizeEndpoint(v)
  }
  return ''
}

function systemProxy() {
  if (process.platform !== 'win32') return ''
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
    const out = execFileSync('reg', ['query', key], { encoding: 'utf8', timeout: 3000 })
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(out)
    if (!enabled) return ''
    const m = out.match(/ProxyServer\s+REG_SZ\s+(.+)/i)
    if (!m) return ''
    const server = m[1].trim()
    // 多协议形式：http=127.0.0.1:7890;https=127.0.0.1:7890;socks=127.0.0.1:7891
    if (server.includes('=')) {
      const parts = {}
      for (const seg of server.split(';')) {
        const [k, v] = seg.split('=')
        if (k && v) parts[k.trim().toLowerCase()] = v.trim()
      }
      return normalizeEndpoint(parts.socks || parts.https || parts.http || '')
    }
    return normalizeEndpoint(server)
  } catch {
    return ''
  }
}

class ProxyService extends Service {
  constructor(ctx, cfg = {}) {
    super(ctx, 'proxy')
    this.base = cfg || {}
    this._cache = '' // 自动探测结果的缓存
  }

  /** 当前设置（settings 分层：schema 默认 < yml base < 用户文档） */
  get config() {
    return this.ctx.settings.get('proxy')
  }

  /**
   * 解析应使用的代理。
   * @param {string|null} explicit 显式传入（命令行/调用方）；传入空串视为「强制直连」
   */
  async resolve(explicit = null) {
    if (explicit === '') return ''
    if (explicit) return explicit
    const cfg = this.config
    if (cfg.url) return cfg.url
    if (cfg.candidates && cfg.candidates.length) {
      for (const c of cfg.candidates) {
        if (await checkReachable(c)) return c
      }
    }
    return ''
  }

  /** 显式需要「自动探测」时调用（--auto-proxy） */
  async detect() {
    if (this._cache && (await checkReachable(this._cache))) return this._cache
    const env = envProxy()
    if (env && (await checkReachable(env))) {
      this._cache = env
      return env
    }
    const sys = systemProxy()
    if (sys && (await checkReachable(sys))) {
      this._cache = sys
      return sys
    }
    for (const c of LOCAL_CANDIDATES) {
      if (await checkReachable(c)) {
        this._cache = c
        return c
      }
    }
    return ''
  }

  /** 免费代理源自动拉取（P5 迁入 proxy_fetcher；当前返回空并提示） */
  async autoFetch() {
    this.ctx.logger.warn('[proxy] 免费代理自动拉取尚未迁移（legacy/proxy_fetcher.py，计划 P5）')
    return ''
  }

  reachable(url) {
    return checkReachable(url)
  }
}

ProxyService.inject = ['config', 'settings']

export default function proxyPlugin(ctx, cfg) {
  ctx.plugin(ProxyService, cfg)
}
