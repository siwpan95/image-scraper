// 源插件：artstation —— ArtStation CG 社区（GFW 需代理）
// 移植自 legacy/sources/json/artstation.json
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('').description('搜索关键词（可空=社区流）'),
  sorting: Schema.union(['popular', 'newest', 'trending']).default('popular').description('排序'),
})

export default defineSource('source-artstation', () => ({
  def: {
    name: 'artstation',
    display: 'ArtStation CG 社区',
    driver: 'http',
    needs_proxy: true,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://www.artstation.com/api/v2/community/explore/projects.json',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      params: { page: '{page}', per_page: 50, sorting: '{sorting}', query: '{query}' },
      skip_empty_params: true,
      pagination: { type: 'page', param: 'page', start: 1, step: 1, per_page: 50 },
    },
    parse: { format: 'json', list_path: 'data', stop_when_empty: true },
    item: {
      url: { default: [
        { path: 'assets.0.image_url' },
        { path: 'covers.0.url' },
        { path: 'covers.0.huge_thumb_url' },
      ] },
      title: { path: 'title' },
      author: { path: 'user.full_name' },
      width: { path: 'assets.0.width', transform: [{ op: 'to_int' }] },
      height: { path: 'assets.0.height', transform: [{ op: 'to_int' }] },
      referer: { const: 'https://www.artstation.com/' },
      meta: { id: { path: 'id' }, likes: { path: 'likes_count' } },
    },
  },
  schema: Config,
}))
