// 应用插件：scheduler —— 多源并行调度 + 源级总进度条（按完成顺序逐个汇报）。
// 对齐 Python 版 mj_scraper.main() 的多源分支（asyncio.as_completed）。
import { Service } from 'cordis'

class SchedulerService extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'scheduler')
  }

  /** 并行运行多个源；返回 { name: result } */
  async runMany(names, opts = {}) {
    const results = {}
    const total = names.length
    if (total <= 1) {
      for (const n of names) results[n] = await this.ctx.sources.run(n, opts)
      return results
    }
    let done = 0
    const barW = 30
    await Promise.all(names.map(async (name) => {
      results[name] = await this.ctx.sources.run(name, opts)
      done += 1
      const filled = Math.floor((barW * done) / total)
      const bar = '█'.repeat(filled) + '░'.repeat(barW - filled)
      this.ctx.logger.info(`总进度 [${bar}] ${done}/${total}`)
    }))
    return results
  }
}

SchedulerService.inject = ['sources', 'logfile']

export default function schedulerPlugin(ctx, cfg) {
  ctx.plugin(SchedulerService, cfg)
}
