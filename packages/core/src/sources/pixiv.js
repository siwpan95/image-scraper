// 源插件：pixiv —— Pixiv 插画（GFW 需代理；body.illust/body.manga 经 merge_keys 合并）
// 移植自 legacy/sources/json/pixiv.json
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('').description('搜索关键词'),
  order: Schema.union(['popular_d', 'date_d']).default('popular_d').description('排序'),
  mode: Schema.union(['all', 'safe', 'r18']).default('all').description('分级模式'),
})

export default defineSource('source-pixiv', () => ({
  def: {
    name: 'pixiv',
    display: 'Pixiv 插画 (GFW 需代理)',
    driver: 'http',
    needs_proxy: true,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://www.pixiv.net/ajax/search/artworks/{query}',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://www.pixiv.net/',
        'X-Requested-With': 'XMLHttpRequest',
      },
      params: { word: '{query}', order: '{order}', mode: '{mode}', p: '{page}' },
      pagination: { type: 'page', param: 'p', start: 1, step: 1, per_page: 60 },
    },
    parse: { format: 'json', list_path: 'body', merge_keys: ['illust', 'manga'], stop_when_empty: true },
    item: {
      url: { path: 'url', transform: [{ op: 'regex_replace', pattern: '/c/250x250_80_a2/img-master/', repl: '/img-master/' }] },
      title: { path: 'title' },
      author: { path: 'userName' },
      width: { path: 'width', transform: [{ op: 'to_int' }] },
      height: { path: 'height', transform: [{ op: 'to_int' }] },
      referer: { const: 'https://www.pixiv.net/' },
      meta: { id: { path: 'id' }, tags: { path: 'tags' } },
    },
  },
  schema: Config,
}))
