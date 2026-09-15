// 源插件：duitang —— 堆糖中文社区（无需 key，JSON API）
// 移植自 legacy/sources/json/duitang.json
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('插画').description('搜索关键词'),
})

export default defineSource('source-duitang', () => ({
  def: {
    name: 'duitang',
    display: '堆糖 Duitang 社区',
    driver: 'http',
    needs_proxy: false,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://www.duitang.com/napi/blog/list/by_search/',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Referer: 'https://www.duitang.com/',
      },
      params: { kw: '{query}', start: '{page}', limit: 20, _: 1 },
      pagination: { type: 'page', param: 'start', start: 0, step: 20, per_page: 20 },
    },
    parse: { format: 'json', list_path: 'data.object_list', stop_when_empty: true },
    item: {
      url: { default: [{ path: 'photo.path' }, { path: 'photo_path' }] },
      title: { path: 'msg' },
      author: { path: 'user.username' },
      width: { path: 'photo.width', transform: [{ op: 'to_int' }] },
      height: { path: 'photo.height', transform: [{ op: 'to_int' }] },
      referer: { const: 'https://www.duitang.com/' },
      meta: { id: { path: 'id' } },
    },
  },
  schema: Config,
}))
