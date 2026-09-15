// @scraper/core — curl 逃生通道（ctx.curl）。
//
// 为什么必须存在：部分站点（pixabay 等）对 Python/Node 原生客户端下发 Cloudflare 托管质询
// （按 TLS/JA3 指纹判定），而 curl 的指纹可以直接通过。Python 版靠 `"fetch": "curl"` 开关
// 达到同样效果，这里是它的对等实现。
//
// 行为严格对齐 Python 版 engine._curl_get：
//   curl -s -L --max-time 45 -A <UA> -w "\n__STATUS__%{http_code}" [-x proxy] [-H k:v] <url>
import { Service } from 'cordis'
import { spawn } from 'node:child_process'
import { buildQuery } from './http.js'
import { DEFAULT_UA } from './config.js'

class CurlService extends Service {
  constructor(ctx, cfg = {}) {
    super(ctx, 'curl')
    this.binary = cfg.binary || 'curl'
    this.maxTime = cfg.maxTime || 45
    this.userAgent = cfg.userAgent || DEFAULT_UA
    this.extraArgs = cfg.extraArgs || []
  }

  /** 在 PATH 中探测 curl 是否可用（Windows 10+ 自带 curl.exe） */
  async available() {
    return new Promise((resolve) => {
      try {
        const p = spawn(this.binary, ['--version'], { windowsHide: true })
        p.once('error', () => resolve(false))
        p.once('close', (code) => resolve(code === 0))
      } catch {
        resolve(false)
      }
    })
  }

  /**
   * 拉取页面文本。
   * @returns {Promise<{status:number, text:string, error:string}>}
   */
  get(url, { params = null, headers = {}, proxy = '', timeout = null } = {}) {
    let target = url
    const q = buildQuery(params)
    if (q) target += (target.includes('?') ? '&' : '?') + q

    const args = [
      '-s',
      '-L',
      '--max-time', String(timeout || this.maxTime),
      '-A', this.userAgent,
      '-w', '\n__STATUS__%{http_code}',
      ...this.extraArgs,
    ]
    for (const [k, v] of Object.entries(headers || {})) {
      if (v !== undefined && v !== null && v !== '') args.push('-H', k + ': ' + v)
    }
    if (proxy) args.push('-x', proxy) // curl 原生支持 http/https/socks5
    args.push(target)

    return new Promise((resolve) => {
      let out = ''
      let err = ''
      let settled = false
      const done = (status, text, error) => {
        if (settled) return
        settled = true
        resolve({ status, text, error })
      }
      let proc
      try {
        proc = spawn(this.binary, args, { windowsHide: true })
      } catch (e) {
        return done(0, '', 'spawn 失败: ' + e.message)
      }
      proc.stdout.setEncoding('utf8')
      proc.stderr.setEncoding('utf8')
      proc.stdout.on('data', (d) => { out += d })
      proc.stderr.on('data', (d) => { err += d })
      proc.once('error', (e) => done(0, '', 'curl 不可用: ' + e.message))
      proc.once('close', () => {
        const idx = out.lastIndexOf('\n__STATUS__')
        if (idx >= 0) {
          const body = out.slice(0, idx)
          const code = parseInt(out.slice(idx + '\n__STATUS__'.length).trim(), 10)
          return done(Number.isFinite(code) ? code : 0, body, '')
        }
        done(0, out, err.trim())
      })
    })
  }
}

CurlService.inject = ['config']

export default function curlPlugin(ctx, cfg) {
  ctx.plugin(CurlService, cfg)
}
