// 源插件：midjourney_url —— Midjourney 指定链接（browser 驱动，require_content_url）
// 移植自 legacy/sources/json/midjourney_url.json
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  size: Schema.union(['thumb', 'medium', 'original', 'original_webp']).default('thumb').description('尺寸后缀'),
  content_url: Schema.string().default('').description('Midjourney 内容页链接（或用 --url）'),
  mj_index: Schema.natural().default(0).description('从第 N 个内容开始'),
})

export default defineSource('source-midjourney_url', () => ({
  def: {
    name: 'midjourney_url',
    display: 'Midjourney 指定链接 (浏览器)',
    driver: 'browser',
    needs_browser: true,
    needs_proxy: false,
    require_content_url: true,
    media: 'image',
    browser: {
      explore_url: 'https://www.midjourney.com/explore',
      api_path: '/api/explore',
      cdn: 'https://cdn.midjourney.com',
      // 2026-09 实测：旧 _384_N 后缀已 404，前端现用 _640_N 缩略图
      size_suffix: {
        thumb: '_640_N.webp',
        medium: '_1024_N.webp',
        original: '.png',
        original_webp: '.webp',
      },
      build: { url_template: '{cdn}/{id}/0_{vi}{suffix}', variants: 4 },
      skip_type: 'video',
    },
  },
  schema: Config,
}))
