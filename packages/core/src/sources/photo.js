// 源插件：photo —— 简易图片爬虫（browser_html 驱动，单页 URL 提取）
// 移植自 legacy/sources/json/photo.json；P4 挂载 driver-browser-html 后可用。
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({})

export default defineSource('source-photo', () => ({
  def: {
    name: 'photo',
    display: '简易图片爬虫（photo 并入，单页 URL 提取）',
    driver: 'browser_html',
    needs_proxy: false,
    media: 'image',
    request: {
      method: 'GET',
      url: '{url}',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      pagination: { type: 'none' },
    },
    parse: {
      format: 'html',
      url_extract: {
        patterns: [
          '<img[^>]+src\\s*=\\s*["\']([^"\']+)["\']',
          '<img[^>]+data-src\\s*=\\s*["\']([^"\']+)["\']',
          '<img[^>]+data-original\\s*=\\s*["\']([^"\']+)["\']',
          '<img[^>]+data-lazy-src\\s*=\\s*["\']([^"\']+)["\']',
          '<img[^>]+data-lazy\\s*=\\s*["\']([^"\']+)["\']',
          '<source[^>]+srcset\\s*=\\s*["\']([^"\']+)["\']',
        ],
        url_resolve: true,
        url_decode: true,
      },
      url_transform: [
        { op: 'regex_replace', pattern: '^//', repl: 'https://' },
      ],
    },
    item: {
      url: { path: 'url', filter: { is_image: true } },
      title: { const: '{url}' },
      author: { const: '' },
      referer: { const: '{page_origin}' },
    },
  },
  schema: Config,
}))
