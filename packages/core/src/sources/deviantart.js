// 源插件：deviantart —— DeviantArt 公开 RSS（browser_html 驱动，GFW 需代理）
// 移植自 legacy/sources/json/deviantart.json；P4 挂载 driver-browser-html 后可用。
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('').description('搜索关键词'),
  sorting: Schema.union(['popular', 'newest', 'hot']).default('popular').description('排序'),
})

export default defineSource('source-deviantart', () => ({
  def: {
    name: 'deviantart',
    display: 'DeviantArt (公开 RSS)',
    driver: 'browser_html',
    needs_proxy: true,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://backend.deviantart.com/rss.xml',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      params: { type: 'deviation', q: 'boost:{sorting} {query}', page: '{page}' },
      pagination: { type: 'page', param: 'page', start: 1, step: 1, per_page: 60 },
    },
    parse: {
      format: 'html',
      block_extract: {
        block: '<item>(.*?)</item>',
        block_flags: 'S',
        url: '<media:content[^>]*url="(https?://[^"]+)"',
        title: '<title>(.*?)</title>',
      },
    },
    item: {
      url: { path: 'url' },
      title: { path: 'title' },
      referer: { const: 'https://www.deviantart.com/' },
      meta: { query: { const: '{query}' }, sort: { const: '{sorting}' } },
    },
  },
  schema: Config,
}))
