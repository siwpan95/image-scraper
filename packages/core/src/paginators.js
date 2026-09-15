// @scraper/core — 分页器注册表（ctx.paginators）。
// 分页器 = 「这一源要抓多少页、页码/游标/查询列表怎么生成」：page / list / none / cursor。
// 取代 Python 版 fetch_tasks 里按 pagination.type 的 if 链。
import { RegistryService } from './registry.js'

class PaginatorsService extends RegistryService {
  constructor(ctx, cfg) {
    super(ctx, 'paginators', cfg)
  }
}

PaginatorsService.inject = ['config', 'logfile']

export default function paginatorsPlugin(ctx, cfg) {
  ctx.plugin(PaginatorsService, cfg)
}
