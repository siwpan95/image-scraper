// 源插件：pixabay_music —— Pixabay 音乐（curl 绕过 CF；搜索页 → 详情页二级提取 mp3）
// 移植自 legacy/sources/json/pixabay_music.json（分页 delay=3 防限流）
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('').description('搜索关键词'),
  pages: Schema.natural().default(1).description('翻页数'),
})

export default defineSource('source-pixabay_music', () => ({
  def: {
    name: 'pixabay_music',
    display: 'Pixabay 音乐 (墙内可达, 无需 key, curl 绕过 CF)',
    driver: 'http',
    fetch: 'curl',
    needs_proxy: false,
    needs_key: false,
    media: 'audio',
    request: {
      method: 'GET',
      url: 'https://pixabay.com/zh/music/search/{query}/',
      headers: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: 'https://pixabay.com/',
      },
      pagination: { type: 'page', param: 'pagi', start: 1, count_var: 'pages', stop_when_empty: true, delay: 3 },
    },
    parse: {
      format: 'html',
      url_extract: {
        patterns: ['/zh/music/(?!search/)[^"\'>`\\s]*-\\d+/'],
        url_resolve: true,
      },
      detail: {
        delay: 2,
        url_extract: {
          patterns: ['https://cdn\\.pixabay\\.com/download/audio/[^"\'>`\\s]*?\\.mp3'],
        },
      },
    },
    item: {
      url: { path: 'url' },
      title: { const: '' },
      referer: { const: 'https://pixabay.com/' },
    },
  },
  schema: Config,
}))
