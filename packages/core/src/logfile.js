// @scraper/core — 文件日志 + 内存错误环（ctx.logfile）。
// 移植自 @relay/core/src/logfile.js：错误链（Error.cause / AggregateError）自动展开。
import { Service } from 'cordis'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

const MAX_BYTES = 2 * 1024 * 1024 // 日志文件上限：超过则保留后半
const RING_SIZE = 30 // 内存错误环容量

function fmtArg(a) {
  if (typeof a === 'string') return a
  if (a instanceof Error) {
    const parts = []
    let e = a
    let depth = 0
    while (e && depth < 5) {
      parts.push(e.stack || (e.name + ': ' + e.message))
      if (e instanceof AggregateError && e.errors && e.errors.length) {
        for (const sub of e.errors) parts.push('  ⤷ ' + fmtArg(sub))
      }
      e = e.cause
      depth += 1
    }
    return parts.join('\n')
  }
  try { return util.inspect(a, { depth: 3, breakLength: 200 }) } catch { return String(a) }
}

class LogfileService extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'logfile')
    const root = (ctx.config && ctx.config.root) || process.cwd()
    // cfg.file 相对应用根解析（如 data/logs/scraper.log），并确保父目录存在
    this.file = path.isAbsolute(cfg && cfg.file)
      ? cfg.file
      : path.resolve(root, (cfg && cfg.file) || path.join('data', 'logs', 'scraper.log'))
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    this.bytes = 0
    try { this.bytes = fs.statSync(this.file).size } catch { /* ignore */ }
    this.errors = []

    this.appendLine('======== ' + new Date().toISOString() + ' 服务启动 ========')

    for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'success']) {
      if (typeof ctx.logger[level] !== 'function') continue
      const orig = ctx.logger[level].bind(ctx.logger)
      ctx.logger[level] = (...args) => {
        const line = args.map(fmtArg).join(' ')
        try {
          this.appendLine('[' + new Date().toISOString() + '] [' + level + '] ' + line)
          if (level === 'error' || level === 'fatal') {
            this.errors.push(line)
            if (this.errors.length > RING_SIZE) this.errors.shift()
          }
        } catch { /* 日志失败不影响主流程 */ }
        return orig(...args)
      }
    }
  }

  appendLine(line) {
    try {
      fs.appendFileSync(this.file, line + '\n')
      this.bytes += Buffer.byteLength(line) + 1
      if (this.bytes > MAX_BYTES) {
        const buf = fs.readFileSync(this.file)
        const keep = buf.subarray(Math.max(0, buf.length - MAX_BYTES / 2))
        fs.writeFileSync(this.file, keep)
        this.bytes = keep.length
      }
    } catch { /* ignore */ }
  }

  recentErrors() {
    return this.errors.slice()
  }

  /** 最近 n 行日志（文件上限 2MB，整读可接受；供 Web 面板 logtail） */
  tail(n = 80) {
    try {
      const buf = fs.readFileSync(this.file)
      const lines = buf.toString('utf8').split('\n')
      while (lines.length && !lines[lines.length - 1]) lines.pop()
      return lines.slice(-n)
    } catch {
      return []
    }
  }

  status() {
    return { file: this.file, bytes: this.bytes, errors: this.errors.length }
  }
}

LogfileService.inject = ['config']

export default function logfilePlugin(ctx, cfg) {
  ctx.plugin(LogfileService, cfg)
}
