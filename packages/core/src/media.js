// @scraper/core — 媒体类型抽象（ctx.media）。
//
// 取代 Python 版散落三处、互相不一致的硬编码：
//   base.Downloader.MEDIA_EXTS / base.Downloader._fallbacks / engine.JsonSource._fallbacks
//
// 类型表是可注册的：P4 的 postprocess-video 会往这里追加 video/audio 的后处理能力，
// 卸载该插件则相关类型随之消失（「依赖即开关」）。
import { Service } from 'cordis'

function endsWithAny(pathname, exts) {
  return exts.some((e) => pathname.endsWith(e))
}

function stripQuery(url) {
  return String(url || '').split('?')[0].split('#')[0]
}

class MediaService extends Service {
  constructor(ctx, cfg = {}) {
    super(ctx, 'media')
    this.kinds = new Map()
    this.registerKind('image', {
      extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'],
      // 回退顺序刻意与 Python engine._fallbacks 的候选序列一致：
      //   [.png, .webp, .jpg, .mp4, .webm, .mov]
      fallbacks: ['.png', '.webp', '.jpg'],
    })
    this.registerKind('video', {
      extensions: ['.mp4', '.webm', '.mov', '.m4v'],
      fallbacks: ['.mp4', '.webm', '.mov'],
    })
    this.registerKind('audio', {
      extensions: ['.mp3', '.wav', '.ogg', '.m4a'],
      fallbacks: ['.mp3', '.ogg'],
    })
    // 额外整块启用/禁用（来自 cordis.yml 的 media 插件配置）
    if (Array.isArray(cfg.kinds) && cfg.kinds.length) {
      for (const k of [...this.kinds.keys()]) {
        if (!cfg.kinds.includes(k)) this.kinds.delete(k)
      }
    }
  }

  registerKind(name, def) {
    this.kinds.set(name, {
      extensions: def.extensions || [],
      fallbacks: def.fallbacks || def.extensions || [],
    })
    return this
  }

  /** 全部（或指定类型的）扩展名 */
  extensions(kinds = null) {
    const list = kinds || [...this.kinds.keys()]
    return list.flatMap((k) => this.kinds.get(k)?.extensions || [])
  }

  /** 去掉查询串后的扩展名，如 .jpg（无扩展名返回 ''） */
  extOf(url) {
    const p = stripQuery(url).toLowerCase()
    for (const e of this.extensions()) {
      if (p.endsWith(e)) return e
    }
    return ''
  }

  /**
   * 猜扩展名：命中已知媒体类型则用它，否则回退 .jpg
   * （与 Python Downloader._guess_ext 一致）
   */
  guessExt(url) {
    return this.extOf(url) || '.jpg'
  }

  /** 与 Python engine._check_filter 的 is_image 语义一致（含 redd.it 特例） */
  isImage(url) {
    if (typeof url !== 'string') return false
    const s = stripQuery(url).toLowerCase()
    if (endsWithAny(s, this.kinds.get('image')?.extensions || [])) return true
    return s.startsWith('https://i.redd.it/') || s.startsWith('https://preview.redd.it/')
  }

  /** 该 URL 是否属于某类媒体（默认任意类型） */
  isMedia(url, kinds = null) {
    return endsWithAny(stripQuery(url).toLowerCase(), this.extensions(kinds))
  }

  /**
   * 格式回退候选（改变扩展名再试）。
   * Python 版 engine._fallbacks 覆盖了 base 版并加入视频扩展名，这里统一为 image+video。
   */
  fallbacks(url, kinds = ['image', 'video']) {
    const base = stripQuery(url)
    const cur = this.extOf(url)
    if (!cur) return []
    const out = []
    for (const e of this.extensions(kinds)) {
      if (e === cur) continue
      out.push(base.slice(0, base.length - cur.length) + e)
    }
    return out
  }
}

MediaService.inject = ['config']

export default function mediaPlugin(ctx, cfg) {
  ctx.plugin(MediaService, cfg)
}
