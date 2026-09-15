// @scraper/core — 落盘服务（ctx.storage）。取代 Python 版 SourceBase._save_meta / _save_failed。
//
// 目录约定（与 Python 版保持一致，避免与既有 ~13GB 资产冲突）：
//   <root>/images/<source>/<source>_<hash><variant>.<ext>      媒体文件
//   <root>/meta/<source>_<ts>.json                             本次抓取元数据
//   <root>/meta/failed_<source>_<ts>.json                      失败清单（供 --retry-failed 重投）
import { Service } from 'cordis'
import fs from 'node:fs'
import path from 'node:path'

export function ts14(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  )
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

class StorageService extends Service {
  constructor(ctx, cfg = {}) {
    super(ctx, 'storage')
    const c = ctx.config
    this.imagesRoot = path.resolve(c.root, cfg.imagesDir || c.outputDir)
    this.metaRoot = path.resolve(c.root, cfg.metaDir || c.metaDir)
    this.bySource = cfg.bySource !== false // 默认按源分目录
  }

  /** 某源的媒体目录（自动创建） */
  dir(source) {
    const d = this.bySource ? path.join(this.imagesRoot, source) : this.imagesRoot
    fs.mkdirSync(d, { recursive: true })
    return d
  }

  /** 已存在的媒体文件名集合（断点续传 / 去重，Python 版 _load_existing） */
  existing(source, extensions) {
    const set = new Set()
    const d = this.dir(source)
    let names = []
    try { names = fs.readdirSync(d) } catch { return set }
    for (const n of names) {
      if (extensions && !extensions.some((e) => n.toLowerCase().endsWith(e))) continue
      set.add(n)
    }
    return set
  }

  /** 写入媒体文件，返回绝对路径 */
  write(source, filename, bytes) {
    const fp = path.join(this.dir(source), filename)
    fs.writeFileSync(fp, bytes)
    return fp
  }

  /** 本地是否已存在该文件 */
  exists(source, filename) {
    return fs.existsSync(path.join(this.dir(source), filename))
  }

  /**
   * 元数据落盘（对齐 Python SourceBase._save_meta 的 JSON 结构）
   * @param {string} source
   * @param {object} stats {fetched, downloaded, skipped, errors, startTime, endTime}
   * @param {Array} tasks  ImageTask[]
   */
  writeMeta(source, stats, tasks) {
    const ts = ts14()
    const file = path.join(this.metaRoot, source + '_' + ts + '.json')
    const items = []
    for (const t of tasks) {
      if (!t.downloaded) continue
      items.push({
        source: t.source,
        url: t.url,
        title: t.title,
        author: t.author,
        width: t.width,
        height: t.height,
        filename: t.localPath ? path.basename(t.localPath) : '',
        local: t.localPath || '',
        meta: t.meta || {},
      })
    }
    writeJsonAtomic(file, {
      source,
      timestamp: ts,
      stats: {
        fetched: stats.fetched,
        downloaded: stats.downloaded,
        skipped: stats.skipped,
        errors: stats.errors,
        start_time: stats.startTime,
        end_time: stats.endTime,
      },
      images: items,
    })
    return { file, count: items.length }
  }

  /** 失败清单落盘（对齐 Python SourceBase._save_failed） */
  writeFailed(source, failed) {
    const ts = ts14()
    const file = path.join(this.metaRoot, 'failed_' + source + '_' + ts + '.json')
    writeJsonAtomic(file, { source, timestamp: ts, count: failed.length, tasks: failed })
    return { file, count: failed.length }
  }

  /** 读取失败清单（供 retry 插件重投） */
  readFailed(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
}

StorageService.inject = ['config']

export default function storagePlugin(ctx, cfg) {
  ctx.plugin(StorageService, cfg)
}
