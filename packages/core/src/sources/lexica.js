// 源插件：lexica —— Lexica SD 搜索（POST JSON API，GFW 需代理）
// 移植自 legacy/sources/json/lexica.json
// 分页为 list 型：query 非空用单查询；为空则遍历 default_queries。
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('').description('搜索关键词（空=用内置默认词表）'),
})

export default defineSource('source-lexica', () => ({
  def: {
    name: 'lexica',
    display: 'Lexica SD 搜索 (GFW 需代理)',
    driver: 'http',
    needs_proxy: true,
    media: 'image',
    request: {
      method: 'POST',
      url: 'https://lexica.art/api/infinite-prompts',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json' },
      body: { text: '{query}', searchMode: 'images', source: 'search', model: 'lexica-aperture-v2' },
      pagination: {
        type: 'list',
        default_queries: ['concept art', 'fantasy', 'portrait', 'anime', 'landscape', 'cyberpunk', 'illustration', 'photorealistic'],
      },
    },
    parse: { format: 'json', list_path: 'images', stop_when_empty: true },
    item: {
      url: { template: 'https://image.lexica.art/full_jpg/{id}' },
      title: { default: [{ path: 'prompt' }, { const: '{query}' }] },
      author: { path: 'a' },
      width: { path: 'w', transform: [{ op: 'to_int' }] },
      height: { path: 'h', transform: [{ op: 'to_int' }] },
      meta: { id: { path: 'id' }, lexica_prompt: { path: 'prompt' } },
    },
  },
  schema: Config,
}))
