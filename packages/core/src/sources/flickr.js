// 源插件：flickr —— Flickr 图库（GFW 需代理 + API Key；无 key 自动回退公开 feeds）
// 移植自 legacy/sources/json/flickr.json（needs_key + alt 兜底）
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('').description('搜索关键词'),
  sorting: Schema.union(['relevance', 'interestingness-desc', 'date-posted-desc']).default('relevance').description('排序'),
})

export default defineSource('source-flickr', () => ({
  def: {
    name: 'flickr',
    display: 'Flickr 图库 (GFW 需代理)',
    driver: 'http',
    needs_proxy: true,
    needs_key: true,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://www.flickr.com/services/rest/',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      params: {
        method: 'flickr.photos.search', api_key: '{key}', text: '{query}',
        sort: '{sorting}', per_page: 30, page: '{page}',
        format: 'json', nojsoncallback: 1,
        extras: 'url_m,url_l,url_o,owner,title',
      },
      pagination: { type: 'page', param: 'page', start: 1, step: 1, per_page: 30 },
    },
    parse: { format: 'json', list_path: 'photos.photo', stop_when_empty: true },
    item: {
      url: { default: [{ path: 'url_o' }, { path: 'url_l' }, { path: 'url_m' }] },
      title: { path: 'title' },
      author: { path: 'owner' },
      referer: { const: 'https://www.flickr.com/' },
      meta: { id: { path: 'id' } },
    },
    alt: {
      request: {
        method: 'GET',
        url: 'https://www.flickr.com/services/feeds/photos_public.gne',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        params: { tags: '{query}', tagmode: 'any', format: 'json', nojsoncallback: 1, per_page: 100 },
        pagination: { type: 'none' },
      },
      parse: {
        format: 'json', list_path: 'items', stop_when_empty: true,
        url_transform: [{ op: 'regex_replace', pattern: '_m(\\.\\w+)$', repl: '_b\\1' }],
      },
      item: {
        url: { path: 'media.m' },
        title: { path: 'title' },
        author: { path: 'author' },
        referer: { const: 'https://www.flickr.com/' },
        meta: { id: { path: 'link' } },
      },
    },
  },
  schema: Config,
}))
