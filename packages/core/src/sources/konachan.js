// 源插件：konachan —— Konachan 壁纸图库（Danbooru 式，GFW 需代理）
// 移植自 legacy/sources/json/konachan.json
// 注：konachan 的 rating 后缀与输入简写一致（s/q/e 原样传递），无需 ratingMap。
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  tags: Schema.string().default('art').description('标签/关键词'),
  rating: Schema.union(['s', 'q', 'e']).default('s').description('分级'),
  limit: Schema.natural().default(40).description('每页条数'),
  booru_exclude: Schema.string().default('').description('标签黑名单（逗号分隔，转 -tag）'),
})

export default defineSource('source-konachan', () => ({
  def: {
    name: 'konachan',
    display: 'Konachan 图库',
    driver: 'http',
    needs_proxy: true,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://konachan.com/post.json',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      params: { tags: '{eff_tags}', limit: '{limit}', page: '{page}' },
      pagination: { type: 'page', param: 'page', start: 1, step: 1, per_page: '{limit}' },
    },
    parse: { format: 'json', list_path: '', stop_when_empty: true },
    item: {
      url: { default: [
        { path: 'file_url' },
        { path: 'jpeg_url' },
        { path: 'preview_url' },
      ] },
      title: { path: 'tags' },
      author: { default: [{ path: 'author' }, { path: 'owner' }] },
      width: { path: 'width', transform: [{ op: 'to_int' }] },
      height: { path: 'height', transform: [{ op: 'to_int' }] },
      referer: { const: 'https://konachan.com' },
      meta: { id: { path: 'id' }, tags: { path: 'tags' } },
    },
  },
  schema: Config,
}))
