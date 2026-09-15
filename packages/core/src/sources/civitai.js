// 源插件：civitai —— Civitai SD 社区（GFW 需代理）
// 移植自 legacy/sources/json/civitai.json
// 注：JSON 模板的 sort 用 {sorting}；Python 版 _build_ctx 另有 civitai_sort="Newest"
// 默认但从未接入模板——本 schema 直接把该意图落到 {sorting} 的默认值上。
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('').description('按作者名过滤'),
  sorting: Schema.string().default('Newest').description('排序 (Newest/Most Reactions/...)'),
  nsfw: Schema.boolean().default(false).description('包含 NSFW'),
})

export default defineSource('source-civitai', () => ({
  def: {
    name: 'civitai',
    display: 'Civitai SD 社区',
    driver: 'http',
    needs_proxy: true,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://civitai.com/api/v1/images',
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      params: {
        limit: 100, page: '{page}', sort: '{sorting}',
        username: '{query}', nsfw: '{nsfw_flag}', browsingLevel: '{browsing}',
      },
      skip_empty_params: true,
      pagination: { type: 'page', param: 'page', start: 1, step: 1, per_page: 100, stop_path: 'metadata.totalPages' },
    },
    parse: { format: 'json', list_path: 'items', stop_when_empty: true },
    item: {
      url: { path: 'url' },
      title: { path: 'prompt' },
      author: { path: 'username' },
      width: { path: 'width', transform: [{ op: 'to_int' }] },
      height: { path: 'height', transform: [{ op: 'to_int' }] },
      meta: { id: { path: 'id' }, nsfw: { path: 'nsfwLevel' } },
    },
  },
  schema: Config,
}))
