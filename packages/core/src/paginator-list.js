// @scraper/core — list 分页器（paginator-list）。
// 按查询列表逐个抓取（ctxVars.query 优先，否则用 pag.default_queries）。
// 忠实移植 Python fetch_tasks 的 ptype == "list" 分支。
import { Service } from 'cordis'
import { listQueries } from './engine.js'

class PaginatorListService extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'paginator-list')
    this.impl = {
      name: 'list',
      run: async ({ pag, ctxVars, maxImages, host }) => {
        const queries = listQueries(pag, ctxVars)
        for (const q of queries) {
          if (host.tasks() >= maxImages) break
          const r = await host.fetchPage({ overrideQuery: q })
          await host.buildTasks(r.items)
        }
      },
    }
    ctx.effect(() => ctx.paginators.register('list', this.impl))
  }
}

PaginatorListService.inject = ['config', 'paginators', 'logfile']

export default function paginatorListPlugin(ctx, cfg) {
  ctx.plugin(PaginatorListService, cfg)
}
