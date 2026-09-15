// @scraper/core — JSON 解析器（parser-json）。
// 负责 parse.format === 'json'：list_path 取列表 + merge_keys 合并（如 pixiv 的 illust/manga）。
import { Service } from 'cordis'
import { extractJson } from './engine.js'

class ParserJsonService extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'parser-json')
    this.impl = {
      name: 'json',
      /** (data, parse) → 原始条目列表 */
      run: (data, parse) => extractJson(data, parse),
    }
    ctx.effect(() => ctx.parsers.register('json', this.impl))
  }
}

ParserJsonService.inject = ['config', 'parsers', 'logfile']

export default function parserJsonPlugin(ctx, cfg) {
  ctx.plugin(ParserJsonService, cfg)
}
