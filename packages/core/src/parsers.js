// @scraper/core — 解析器注册表（ctx.parsers）。
// 解析器 = 「把响应文本变成原始条目列表」：json / html。
// 取代 Python 版 engine.py 的 `if parse.get("format") == "json"` 分支。
import { RegistryService } from './registry.js'

class ParsersService extends RegistryService {
  constructor(ctx, cfg) {
    super(ctx, 'parsers', cfg)
  }
}

ParsersService.inject = ['config', 'logfile']

export default function parsersPlugin(ctx, cfg) {
  ctx.plugin(ParsersService, cfg)
}
