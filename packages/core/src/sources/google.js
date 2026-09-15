// 源插件：google —— Google 图片搜索（browser_html 驱动，GFW 需代理）
// 移植自 legacy/sources/json/google.json；P4 挂载 driver-browser-html 后可用。
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('').description('搜索关键词'),
  google_pages: Schema.natural().default(3).description('翻页数'),
})

export default defineSource('source-google', () => ({
  def: {
    name: 'google',
    display: 'Google 图片搜索 (GFW 需代理)',
    driver: 'browser_html',
    needs_proxy: true,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://www.google.com/search?q={query_encoded}&tbm=isch&start={page}',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      pagination: { type: 'page', param: null, start: 0, step: 100, count_var: 'google_pages' },
    },
    parse: {
      format: 'html',
      url_extract: {
        patterns: [
          '(?:\\")?ou(?:\\")?\\s*:\\s*(?:\\")?(https?://[^\\s\\\"\\\\]+)',
          'imgurl=(https?://[^&]+)',
        ],
        url_decode: true,
      },
    },
    item: {
      url: { path: 'url' },
      title: { const: '{query}' },
      referer: { const: 'https://www.google.com/' },
    },
  },
  schema: Config,
}))
