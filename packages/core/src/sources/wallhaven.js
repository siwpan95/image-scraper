// 源插件：wallhaven —— Wallhaven 壁纸（GFW 需代理；NSFW 需 key）
// 移植自 legacy/sources/json/wallhaven.json
// purity 语义：nsfw && key → '111'，否则 '100'（templateVars 派生，对齐 Python wallhaven_nsfw）。
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('').description('搜索关键词/标签'),
  sorting: Schema.union(['toplist', 'views', 'favorites', 'relevance', 'random', 'dateadded']).default('toplist').description('排序'),
  key: Schema.string().default('').description('Wallhaven API Key（NSFW 需要）'),
  nsfw: Schema.boolean().default(false).description('包含 NSFW（需 key）'),
})

export default defineSource('source-wallhaven', () => ({
  def: {
    name: 'wallhaven',
    display: 'Wallhaven 壁纸 (GFW 需代理)',
    driver: 'http',
    needs_proxy: true,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://wallhaven.cc/api/v1/search',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      params: {
        q: '{query}', sorting: '{sorting}', categories: '111',
        purity: '{purity}', page: '{page}', apikey: '{key}',
      },
      skip_empty_params: true,
      pagination: { type: 'page', param: 'page', start: 1, step: 1, per_page: 24, stop_path: 'meta.last_page' },
    },
    parse: { format: 'json', list_path: 'data', stop_when_empty: true },
    item: {
      url: { path: 'path' },
      title: { const: '{query}' },
      author: { path: 'uploader' },
      width: { path: 'dimension_x', transform: [{ op: 'to_int' }] },
      height: { path: 'dimension_y', transform: [{ op: 'to_int' }] },
      referer: { const: 'https://wallhaven.cc/' },
      meta: { id: { path: 'id' }, category: { path: 'category' } },
    },
  },
  schema: Config,
}))
