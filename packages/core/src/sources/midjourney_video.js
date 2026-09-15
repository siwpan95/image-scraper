// 源插件：midjourney_video —— Midjourney Video Explore（browser 驱动，产出 mp4）
// 移植自 legacy/sources/json/midjourney_video.json
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  tab: Schema.string().default('video_top').description('Explore 页签'),
  scrolls: Schema.natural().default(20).description('浏览器滚动次数'),
  headless: Schema.boolean().default(true).description('无头模式'),
})

export default defineSource('source-midjourney_video', () => ({
  def: {
    name: 'midjourney_video',
    display: 'Midjourney Video Explore (浏览器)',
    driver: 'browser',
    needs_browser: true,
    needs_proxy: true,
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
