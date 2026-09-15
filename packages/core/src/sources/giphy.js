// 源插件：giphy —— Giphy 动图搜索（墙内可达，无需 key；搜索页 + 详情页相关链式扩展）
// 移植自 legacy/sources/json/giphy.json
//
// 注意：url_extract 的正则带捕获组（Python re.findall 语义 → 返回**组内容**，即媒体 ID），
// 再由 url_transform 把裸 ID 还原成 media.giphy.com 直链。pyFindAll 已复刻该语义。
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('cat').description('搜索关键词'),
})

export default defineSource('source-giphy', () => ({
  def: {
    name: 'giphy',
    display: 'Giphy 动图搜索 (墙内可达, 无需 key; 搜索页+详情页相关链式扩展, 单查询数百张)',
    driver: 'http',
    needs_proxy: false,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://giphy.com/search/{query_encoded}',
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
          'https://giphy\\.com/gifs/[a-zA-Z0-9_-]+-[A-Za-z0-9]{10,}',
          'https://giphy\\.com/gifs/[A-Za-z0-9]{10,}',
        ],
      },
      detail: {
        delay: 0.2,
        url_extract: {
          patterns: [
            'https://media\\d?\\.giphy\\.com/media/[^/"\']+/([A-Za-z0-9_-]{8,})/giphy\\.(?:gif|webp)',
            'https://media\\d?\\.giphy\\.com/media/([A-Za-z0-9_-]{8,})/giphy\\.gif',
            'https://giphy\\.com/gifs/[a-zA-Z0-9_-]+-([A-Za-z0-9]{10,})',
            'https://giphy\\.com/gifs/([A-Za-z0-9]{10,})',
          ],
        },
      },
      url_transform: [
        { op: 'regex_replace', pattern: '^https://giphy\\.com/gifs/[a-zA-Z0-9_-]*-?([A-Za-z0-9_-]{8,})$', repl: 'https://media.giphy.com/media/\\1/giphy.gif' },
        { op: 'regex_replace', pattern: '^([A-Za-z0-9_-]{8,})$', repl: 'https://media.giphy.com/media/\\1/giphy.gif' },
      ],
    },
    item: {
      url: { path: 'url' },
      title: { const: '{query}' },
      referer: { const: 'https://giphy.com/' },
    },
  },
  schema: Config,
}))
