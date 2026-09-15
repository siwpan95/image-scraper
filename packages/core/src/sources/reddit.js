// 源插件：reddit —— Reddit 图版（cursor 分页；mode=sub 版块 / search 全站搜索，GFW 需代理）
// 移植自 legacy/sources/json/reddit.json
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('art').description('版块名（sub）或搜索词（search）'),
  mode: Schema.union(['sub', 'search']).default('sub').description('sub=版块 / search=关键词搜索'),
})

export default defineSource('source-reddit', () => ({
  def: {
    name: 'reddit',
    display: 'Reddit 图版 (GFW 需代理)',
    driver: 'http',
    needs_proxy: true,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://www.reddit.com/r/{query_encoded}/hot.json',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ImageScraper/1.0)' },
      params: { limit: 100, after: '{cursor}' },
      pagination: { type: 'cursor', param: 'after', cursor_path: 'data.after', max_pages: 50 },
    },
    request_by_mode: {
      search: {
        request: {
          url: 'https://www.reddit.com/search.json',
          params: { q: '{query}', limit: 100, type: 'link', after: '{cursor}' },
        },
      },
    },
    parse: { format: 'json', list_path: 'data.children', stop_when_empty: true },
    item: {
      url: { default: [
        { path: 'data.url', filter: { is_image: true } },
        { path: 'data.preview.images.0.source.url' },
      ] },
      title: { path: 'data.title' },
      author: { path: 'data.author' },
      width: { path: 'data.preview.images.0.source.width', transform: [{ op: 'to_int' }] },
      height: { path: 'data.preview.images.0.source.height', transform: [{ op: 'to_int' }] },
      referer: { const: 'https://www.reddit.com/' },
      meta: { id: { path: 'data.id' }, subreddit: { path: 'data.subreddit' } },
    },
  },
  schema: Config,
}))
