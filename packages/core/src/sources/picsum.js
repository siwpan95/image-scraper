// 源插件：picsum —— Lorem Picsum 随机高清图（无需 key）
// 移植自 legacy/sources/json/picsum.json（含 item_filter 作者过滤）
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  picsum_query: Schema.string().default('').description('作者过滤（空 = 全量随机）'),
})

export default defineSource('source-picsum', () => ({
  def: {
    name: 'picsum',
    display: 'Lorem Picsum 随机高清图',
    driver: 'http',
    needs_proxy: false,
    media: 'image',
    item_filter: { path: 'author', contains: 'picsum_query' },
    request: {
      method: 'GET',
      url: 'https://picsum.photos/v2/list',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      params: { page: '{page}', limit: 100 },
      pagination: { type: 'page', param: 'page', start: 1, step: 1, per_page: 100 },
    },
    parse: { format: 'json', list_path: '', stop_when_empty: true },
    item: {
      url: { path: 'download_url' },
      title: { path: 'author' },
      author: { path: 'author' },
      width: { path: 'width', transform: [{ op: 'to_int' }] },
      height: { path: 'height', transform: [{ op: 'to_int' }] },
      referer: { const: 'https://picsum.photos/' },
      meta: { id: { path: 'id' } },
    },
  },
  schema: Config,
}))
