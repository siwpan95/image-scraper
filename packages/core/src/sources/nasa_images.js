// 源插件：nasa_images —— NASA 图片影像库（images-api.nasa.gov，无需 key）
// 实测（2026-09-15 墙内直连）：200 / ~0.6s；
// collection.items[].links[0].href 为 ~thumb/~small/~medium 预览图，regex_replace 换成 ~orig 原图
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('nebula galaxy').description('搜索关键词'),
  pages: Schema.natural().default(1).description('翻页数'),
})

export default defineSource('source-nasa_images', () => ({
  def: {
    name: 'nasa_images',
    display: 'NASA 图片影像库',
    driver: 'http',
    needs_proxy: false,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://images-api.nasa.gov/search?q={query_encoded}&media_type=image&page_size=100&page={page}',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      pagination: { type: 'page', param: null, start: 1, step: 1, count_var: 'pages' },
    },
    parse: { format: 'json', list_path: 'collection.items' },
    item: {
      // links[].href 形如 .../PIA14417~medium.jpg；统一提升为 ~orig 原图（无对应尺寸时保留原样由下载阶段兜底）
      url: {
        path: 'links.0.href',
        transform: [{ op: 'regex_replace', pattern: '~(thumb|small|medium)\\.jpg', repl: '~orig.jpg' }],
      },
      title: { path: 'data.0.title' },
      referer: { const: 'https://images.nasa.gov/' },
    },
  },
  schema: Config,
}))
