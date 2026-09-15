// 源插件：pexels —— Pexels 精选图库（API；无 key 时 Authorization 头被略去，与 Python 行为一致）
// 移植自 legacy/sources/json/pexels.json
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('nature').description('搜索关键词'),
  key: Schema.string().default('').description('Pexels API Key（建议写 data/settings.json）'),
})

export default defineSource('source-pexels', () => ({
  def: {
    name: 'pexels',
    display: 'Pexels 精选图库',
    driver: 'http',
    needs_proxy: false,
    needs_key: false,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://api.pexels.com/v1/search',
      headers: { Authorization: '{key}' },
      params: { query: '{query}', page: '{page}', per_page: 40 },
      skip_empty_params: true,
      pagination: { type: 'page', param: 'page', start: 1, step: 1, per_page: 40 },
    },
    parse: { format: 'json', list_path: 'photos', stop_when_empty: true },
    item: {
      url: { default: [{ path: 'src.original' }, { path: 'src.large2x' }, { path: 'src.large' }] },
      title: { path: 'alt' },
      author: { path: 'photographer' },
      width: { path: 'width', transform: [{ op: 'to_int' }] },
      height: { path: 'height', transform: [{ op: 'to_int' }] },
      meta: { id: { path: 'id' }, url_page: { path: 'url' } },
    },
  },
  schema: Config,
}))
