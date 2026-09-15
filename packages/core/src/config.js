// @scraper/core — 根配置服务（ctx.config）。
// 必须第一个挂载：其余所有插件都 inject 它（与 @relay 的装配约定一致）。
import { Service } from 'cordis'
import path from 'node:path'

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

class ConfigService extends Service {
  constructor(ctx, cfg = {}) {
    super(ctx, 'config')
    // root 决定 outputDir / metaDir 的相对基准（默认进程 cwd，即 apps/cli）
    this.root = path.resolve(cfg.root || process.cwd())
    this.outputDir = path.resolve(this.root, cfg.outputDir || 'images')
    this.metaDir = path.resolve(this.root, cfg.metaDir || 'meta')
    this.userAgent = cfg.userAgent || DEFAULT_UA
    // 各源共享的默认下载参数；单个源可在自己的 config 里覆盖
    this.defaults = {
      maxImages: 100,
      concurrency: 5,
      retries: 3,
      rateLimit: 0, // 请求/秒，0=不限
      speedLimit: 0, // KB/s，0=不限
      ...(cfg.defaults || {}),
    }
  }
}

export default function configPlugin(ctx, cfg) {
  ctx.plugin(ConfigService, cfg)
}
