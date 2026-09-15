// 源插件：pixabay —— Pixabay 图库（墙内可达，无需 key，curl 绕过 Cloudflare）
// 移植自 legacy/sources/json/pixabay.json（"fetch": "curl"）
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('art').description('搜索关键词'),
  pages: Schema.natural().default(3).description('翻页数'),
})

export default defineSource('source-pixabay', () => ({
  def: {
    name: 'pixabay',
    display: 'Pixabay 图库 (墙内可达, 无需 key, curl 绕过 CF)',
    driver: 'http',
    fetch: 'curl',
    needs_proxy: false,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://pixabay.com/zh/images/search/{query_encoded}/?pagi={page}',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      skip_empty_params: true,
      pagination: { type: 'page', param: null, start: 1, step: 1, count_var: 'pages' },
    },
    parse: {
      format: 'html',
      url_extract: {
        patterns: ['https://cdn\\.pixabay\\.com/photo/[^"\'\t >]+?\\.(?:jpg|jpeg|png|webp)'],
      },
      url_transform: [
        { op: 'regex_replace', pattern: '_\\d+\\.(jpg|jpeg|png|webp)$', repl: '_1280.\\1' },
      ],
    },
    item: {
      url: { path: 'url' },
      title: { const: '{query}' },
      author: { const: '' },
      referer: { const: 'https://pixabay.com/' },
    },
  },
  schema: Config,
}))
