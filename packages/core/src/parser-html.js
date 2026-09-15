// @scraper/core — HTML 解析器（parser-html）。
// 负责 parse.format === 'html'：url_extract 正则提取 / block_extract 分块提取。
import { Service } from 'cordis'
import { extractHtml } from './engine.js'

class ParserHtmlService extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'parser-html')
    this.impl = {
      name: 'html',
      /** (html, parse, pageUrl, {sourceName, logger}) → 原始条目列表 */
      run: (html, parse, pageUrl = '', opts = {}) => extractHtml(html, parse, pageUrl, opts),
    }
    ctx.effect(() => ctx.parsers.register('html', this.impl))
  }
}

ParserHtmlService.inject = ['config', 'parsers', 'logfile']

export default function parserHtmlPlugin(ctx, cfg) {
  ctx.plugin(ParserHtmlService, cfg)
}
