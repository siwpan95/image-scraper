// @scraper/core — 下载器（ctx.downloader）。忠实移植 Python 版 base.Downloader。
//
// 必须保持一致的细节（关系到能否与既有 ~13GB 资产正确去重）：
//   - 文件名 = <source>_<md5(url)[:12]>[_<w>x<h>]<ext>
//   - URL 查询串含 w/h 时把尺寸并入文件名，避免同名碰撞
//   - 已存在同名文件 → 计 skipped 且视作已下载（元数据照常记录）
//   - Referer 缺省从 URL 推导 scheme://host/
//   - 失败重试 ≤ retries 次，指数退避 min(2^attempt, 10)s，期间尝试扩展名回退
//   - 内容长度 ≤ 300 字节视为失败
import { Service } from 'cordis'
import crypto from 'node:crypto'
import path from 'node:path'

export function hashName(url) {
  return crypto.createHash('md5').update(url, 'utf8').digest('hex').slice(0, 12)
}

export function makeTask(partial = {}) {
  return {
    url: '',
    source: '',
    title: '',
    author: '',
    width: 0,
    height: 0,
    localPath: '',
    downloaded: false,
    referer: '',
    meta: {},
    ...partial,
  }
}

export function makeStats() {
  return { fetched: 0, downloaded: 0, skipped: 0, errors: 0, startTime: 0, endTime: 0 }
}

export function taskToFailed(t) {
  return {
    url: t.url,
    referer: t.referer,
    source: t.source,
    title: t.title,
    author: t.author,
    width: t.width,
    height: t.height,
    meta: t.meta,
  }
}

/** 从图片 URL 推导 Referer 域名，绕过常见防盗链（对齐 Python _derive_referer） */
export function deriveReferer(url) {
  try {
    const u = new URL(url)
    return u.origin + '/'
  } catch {
    return ''
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 每个源一个下载会话：独立的并发、限速、已存在索引与失败清单 */
export class DownloadSession {
  constructor(ctx, source, opts = {}) {
    this.ctx = ctx
    this.source = source
    const d = ctx.config.defaults
    this.concurrency = Math.max(1, opts.concurrency ?? d.concurrency)
    this.retries = Math.max(1, opts.retries ?? d.retries)
    this.rateLimit = opts.rateLimit ?? d.rateLimit
    this.speedLimit = opts.speedLimit ?? d.speedLimit
    this.proxy = opts.proxy || ''
    this.minBytes = opts.minBytes ?? 300

    this.dir = ctx.storage.dir(source)
    this.downloaded = ctx.storage.existing(source, ctx.media.extensions())
    this.failed = []
    this._lastCall = 0
    this._rateChain = Promise.resolve()
    this._logged = 0
  }

  /** 生成稳定文件名（对齐 Python Downloader._make_filename） */
  makeFilename(task) {
    const h = hashName(task.url)
    const ext = this.ctx.media.guessExt(task.url)
    let variant = ''
    try {
      const u = new URL(task.url)
      if (u.searchParams.has('w') || u.searchParams.has('h')) {
        variant = '_' + (u.searchParams.get('w') ?? '0') + 'x' + (u.searchParams.get('h') ?? '0')
      }
    } catch { /* 相对/非法 URL 不加 variant */ }
    return task.source + '_' + h + variant + ext
  }

  /** 限速闸门（rateLimit>0 时串行化，保证相邻请求间隔 ≥ 1/rateLimit 秒） */
  async throttle() {
    if (!(this.rateLimit > 0)) return
    const gap = 1000 / this.rateLimit
    const prev = this._rateChain
    let release
    this._rateChain = new Promise((r) => { release = r })
    await prev
    const now = Date.now()
    const wait = this._lastCall + gap - now
    if (wait > 0) await sleep(wait)
    this._lastCall = Date.now()
    release()
  }

  async tryOnce(url, referer) {
    const headers = referer ? { Referer: referer } : {}
    const r = await this.ctx.http.bytes(url, {
      headers,
      proxy: this.proxy,
      speedLimit: this.speedLimit,
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    })
    if (r.status === 200 && r.bytes && r.bytes.length > this.minBytes) return r.bytes
    if (r.error) this.ctx.logger.debug('  下载失败: ' + url.slice(0, 90) + ' — ' + r.error)
    return null
  }

  async download(task, stats) {
    let fname = this.makeFilename(task)
    if (this.downloaded.has(fname)) {
      task.localPath = path.join(this.dir, fname)
      task.downloaded = true
      stats.skipped += 1
      return task
    }

    const referer = task.referer || deriveReferer(task.url)
    let content = null

    for (let attempt = 1; attempt <= this.retries; attempt++) {
      await this.throttle()
      content = await this.tryOnce(task.url, referer)

      if (!content) {
        for (const fb of this.ctx.media.fallbacks(task.url)) {
          await this.throttle()
          content = await this.tryOnce(fb, referer)
          if (content) {
            const ext = this.ctx.media.extOf(fb)
            if (ext) fname = fname.slice(0, fname.length - path.extname(fname).length) + ext
            break
          }
        }
      }
      if (content) break
      if (attempt < this.retries) {
        const backoff = Math.min(2 ** attempt, 10) * 1000
        await sleep(backoff)
      }
    }

    if (content && content.length > this.minBytes) {
      const fp = this.ctx.storage.write(this.source, fname, content)
      task.localPath = fp
      task.downloaded = true
      this.downloaded.add(fname)
      stats.downloaded += 1
      this._logged += 1
      if (this._logged <= 5 || stats.downloaded % 50 === 0) {
        this.ctx.logger.info('  [' + stats.downloaded + '] ' + fname)
      }
    } else {
      stats.errors += 1
      this.failed.push(taskToFailed({ ...task, referer }))
    }
    return task
  }

  /** 并发批量下载（对齐 Python download_batch：异常计入 errors） */
  async downloadBatch(tasks, stats) {
    const results = new Array(tasks.length)
    let cursor = 0
    const worker = async () => {
      for (;;) {
        const i = cursor++
        if (i >= tasks.length) return
        try {
          results[i] = await this.download(tasks[i], stats)
        } catch (e) {
          stats.errors += 1
          this.ctx.logger.debug('  任务异常: ' + (e && e.message ? e.message : e))
          results[i] = null
        }
      }
    }
    const n = Math.min(this.concurrency, Math.max(1, tasks.length))
    await Promise.all(Array.from({ length: n }, worker))
    return results.filter(Boolean)
  }
}

class DownloaderService extends Service {
  constructor(ctx, cfg = {}) {
    super(ctx, 'downloader')
    this.base = cfg || {}
  }

  /** 为某个源开一个下载会话 */
  session(source, opts = {}) {
    return new DownloadSession(this.ctx, source, { ...this.base, ...opts })
  }
}

DownloaderService.inject = ['config', 'http', 'storage', 'media']

export default function downloaderPlugin(ctx, cfg) {
  ctx.plugin(DownloaderService, cfg)
}
