// 源插件：midjourney_video_url —— Midjourney Video 指定链接（browser 驱动，require_content_url）
// 移植自 legacy/sources/json/midjourney_video_url.json
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  content_url: Schema.string().default('').description('Midjourney 内容页链接（或用 --url）'),
  mj_index: Schema.natural().default(0).description('从第 N 个内容开始'),
})

export default defineSource('source-midjourney_video_url', () => ({
  def: {
    name: 'midjourney_video_url',
    display: 'Midjourney Video 指定链接 (浏览器)',
    driver: 'browser',
    needs_browser: true,
    needs_proxy: true,
    require_content_url: true,
    media: 'video',
    browser: {
      explore_url: 'https://www.midjourney.com/explore',
      api_path: '/api/explore',
      cdn: 'https://cdn.midjourney.com',
      tab: 'video_top',
      build: { url_template: '{cdn}/video/{id}/0.mp4', variants: 1 },
    },
  },
  schema: Config,
}))
