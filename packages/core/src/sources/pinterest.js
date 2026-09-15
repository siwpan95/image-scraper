// 源插件：pinterest —— Pinterest 图库（browser_html 驱动，GFW 需代理）
// 移植自 legacy/sources/json/pinterest.json
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('').description('搜索关键词'),
  pinterest_pages: Schema.natural().default(3).description('翻页数'),
})

export default defineSource('source-pinterest', () => ({
  def: {
    name: 'pinterest',
    display: 'Pinterest 图库 (GFW 需代理)',
    driver: 'browser_html',
    needs_proxy: true,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://www.pinterest.com/search/pins/?q={query_encoded}&page={page}',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
      pagination: { type: 'page', param: null, start: 1, step: 1, count_var: 'pinterest_pages' },
    },
    parse: {
      format: 'html',
      url_extract: {
        patterns: [
          '"image_url"\\s*:\\s*"(.*?)"',
          'https?://[a-z]\\.pinimg\\.com/[^\\s"\\\\]+',
        ],
        post_replace: { '\\/': '/', '\\u002F': '/' },
      },
    },
    item: {
      url: { path: 'url' },
      title: { const: '{query}' },
      referer: { const: 'https://www.pinterest.com/' },
    },
  },
  schema: Config,
}))
