// 源插件：safebooru —— Safebooru 图库（Danbooru 式，无需 key，支持标签黑名单与分级）
// 移植自 legacy/sources/json/safebooru.json
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  tags: Schema.string().default('art').description('标签/关键词'),
  rating: Schema.union(['s', 'q', 'e']).default('s').description('分级 (s=安全/q=可疑/e=成人)'),
  limit: Schema.natural().default(40).description('每页条数'),
  booru_exclude: Schema.string().default('').description('标签黑名单（逗号分隔，转 -tag）'),
})

export default defineSource('source-safebooru', () => ({
  def: {
    name: 'safebooru',
    display: 'Safebooru 图库',
    driver: 'http',
    needs_proxy: false,
    media: 'image',
    // safebooru 的 rating 后缀与缩写不同：s→safe / q→questionable / e→explicit
    ratingMap: { s: 'safe', q: 'questionable', e: 'explicit' },
    request: {
      method: 'GET',
      url: 'https://safebooru.org/index.php',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      params: {
        page: 'dapi', s: 'post', q: 'index', json: '1',
        tags: '{eff_tags}', limit: '{limit}', pid: '{page}',
      },
      pagination: { type: 'page', param: 'pid', start: 0, step: '{limit}', per_page: '{limit}' },
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
      referer: { const: 'https://safebooru.org' },
      meta: { id: { path: 'id' }, tags: { path: 'tags' } },
    },
  },
  schema: Config,
}))
