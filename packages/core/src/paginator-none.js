// @scraper/core — none 分页器（paginator-none）。
// 单次抓取，不翻页（如 giphy 搜索页、webpage）。
// 忠实移植 Python fetch_tasks 的 ptype == "none" 分支。
import { Service } from 'cordis'

class PaginatorNoneService extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'paginator-none')
    this.impl = {
      name: 'none',
      run: async ({ ctxVars, maxImages, host }) => {
        if (host.tasks() >= maxImages) return
        const r = await host.fetchPage({})
        await host.buildTasks(r.items)
      },
    }
    ctx.effect(() => ctx.paginators.register('none', this.impl))
  }
}

PaginatorNoneService.inject = ['config', 'paginators', 'logfile']

export default function paginatorNonePlugin(ctx, cfg) {
  ctx.plugin(PaginatorNoneService, cfg)
}
