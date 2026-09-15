// 源插件：bing —— Bing 图片搜索（无需 key，HTML 正则提取 murl）
// 移植自 legacy/sources/json/bing.json
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('ai art').description('搜索关键词'),
  pages: Schema.natural().default(3).description('翻页数'),
})

export default defineSource('source-bing', () => ({
  def: {
    name: 'bing',
    display: 'Bing 图片搜索',
    driver: 'http',
    needs_proxy: false,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://www.bing.com/images/search?q={query_encoded}&form=HDRSC2&first={page}',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      pagination: { type: 'page', param: null, start: 0, step: 35, count_var: 'pages' },
    },
    parse: {
      format: 'html',
      url_extract: {
        patterns: [
          'murl&quot;:&quot;(https?://.*?)&quot;',
          'murl:"(https?://[^"]+)"',
        ],
        post_replace: { '&amp;': '&' },
      },
    },
    item: {
      url: { path: 'url' },
      title: { const: '{query}' },
      referer: { const: 'https://cn.bing.com/' },
    },
  },
  schema: Config,
}))
