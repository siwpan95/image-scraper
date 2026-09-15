// @scraper/core — page 分页器（paginator-page）。
// 页码递增：pageVal = start + i*step，共 count 页（count 由 count_var 或 per_page 推出）。
// 忠实移植 Python fetch_tasks 的 ptype == "page" 分支，含 stop_when_empty / stop_path / delay。
//
// 宿主（ctx.sources 提供的 host）契约：
//   fetchPage({ pageVal?, cursor?, overrideQuery? }) → { items, lastJson }   原始条目（未做二级详情）
//   buildTasks(items)                                                 → void（内部含二级详情解析）
//   tasks()                                                           → 当前任务数
import { Service } from 'cordis'
import { pageCount, resolveInt, stopPage } from './engine.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class PaginatorPageService extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'paginator-page')
    this.impl = {
      name: 'page',
      run: async ({ pag, ctxVars, maxImages, host }) => {
        const count = pageCount(pag, ctxVars, maxImages)
        const start = resolveInt(pag.start, ctxVars, 1)
        const step = resolveInt(pag.step, ctxVars, 1)

        for (let i = 0; i < count; i++) {
          if (host.tasks() >= maxImages) break
          const pageVal = start + i * step

          const r = await host.fetchPage({ pageVal })
          // 注意顺序：stop_when_empty 在二级详情抓取**之前**判断（对齐 Python）
          if (!r.items.length && pag.stop_when_empty !== false) break
          await host.buildTasks(r.items)
          if (stopPage(pag, pageVal, r.lastJson)) break
          // 翻页间隔：缓解部分站点（如 pixabay 视频）对高频请求的 403 限流
          if (i < count - 1 && pag.delay) await sleep(Number(pag.delay) * 1000)
        }
      },
    }
    ctx.effect(() => ctx.paginators.register('page', this.impl))
  }
}

PaginatorPageService.inject = ['config', 'paginators', 'logfile']

export default function paginatorPagePlugin(ctx, cfg) {
  ctx.plugin(PaginatorPageService, cfg)
}
