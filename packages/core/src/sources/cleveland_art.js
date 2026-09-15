// 源插件：cleveland_art —— 克利夫兰艺术博物馆开放访问（CC0 公有领域，无需 key）
// 实测（2026-09-15 墙内直连）：200 / ~1.2s，总量 4 万+；
// data[].images.web.url（web 版）优先，images.print.url（印刷版）兜底，均为 CDN 直链
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  limit: Schema.natural().default(20).description('每页数量'),
  pages: Schema.natural().default(1).description('翻页数'),
})

export default defineSource('source-cleveland_art', () => ({
  def: {
    name: 'cleveland_art',
    display: '克利夫兰艺术博物馆',
    driver: 'http',
    needs_proxy: false,
    media: 'image',
    request: {
      method: 'GET',
      // skip/offset 分页：pageVal 仅经 URL 模板 {page} 替换（param 置 null，与 bing.js 同款写法）
      url: 'https://openaccess-api.clevelandart.org/api/artworks/?cc0=1&has_image=1&limit={limit}&skip={page}',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      pagination: { type: 'page', param: null, start: 0, step: '{limit}', count_var: 'pages' },
    },
    parse: { format: 'json', list_path: 'data' },
    item: {
      url: { default: [{ path: 'images.web.url' }, { path: 'images.print.url' }] },
      title: { path: 'title' },
      referer: { const: 'https://www.clevelandart.org/' },
    },
  },
  schema: Config,
}))
