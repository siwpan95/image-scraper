// @scraper/core — cursor 分页器（paginator-cursor）。
// 游标翻页：响应里带下一页游标（pag.cursor_path），直到取不到为止。
// 忠实移植 Python fetch_tasks 的 ptype == "cursor" 分支。
import { Service } from 'cordis'
import { nextCursor } from './engine.js'

class PaginatorCursorService extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'paginator-cursor')
    this.impl = {
      name: 'cursor',
      run: async ({ pag, ctxVars, maxImages, host }) => {
        const maxPages = pag.max_pages ?? 50
        let cursor = null
        for (let i = 0; i < maxPages; i++) {
          if (host.tasks() >= maxImages) break
          const r = await host.fetchPage({ cursor })
          if (!r.items.length && pag.stop_when_empty !== false) break
          await host.buildTasks(r.items)
          cursor = nextCursor(pag, r.lastJson)
          if (!cursor) break
        }
      },
    }
    ctx.effect(() => ctx.paginators.register('cursor', this.impl))
  }
}

PaginatorCursorService.inject = ['config', 'paginators', 'logfile']

export default function paginatorCursorPlugin(ctx, cfg) {
  ctx.plugin(PaginatorCursorService, cfg)
}
