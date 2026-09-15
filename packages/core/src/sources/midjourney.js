// 源插件：midjourney —— Midjourney Explore（browser 驱动）
// 移植自 legacy/sources/json/midjourney.json
// driver: 'browser' → P4 挂载 driver-browser 后可用；缺位时由 sources.js 点名下线。
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  tab: Schema.string().default('top').description('Explore 页签 (top/newest...)'),
  size: Schema.union(['thumb', 'medium', 'original', 'original_webp']).default('thumb').description('尺寸后缀'),
  scrolls: Schema.natural().default(20).description('浏览器滚动次数'),
  headless: Schema.boolean().default(true).description('无头模式'),
})

const BROWSER = {
  explore_url: 'https://www.midjourney.com/explore',
  api_path: '/api/explore',
  cdn: 'https://cdn.midjourney.com',
  size_suffix: {
    thumb: '_384_N.webp',
    medium: '_1024_N.webp',
    original: '.png',
    original_webp: '.webp',
  },
  build: { url_template: '{cdn}/{id}/0_{vi}{suffix}', variants: 4 },
  skip_type: 'video',
}

export default defineSource('source-midjourney', () => ({
  def: {
    name: 'midjourney',
    display: 'Midjourney Explore (浏览器)',
    driver: 'browser',
    needs_browser: true,
    needs_proxy: true,
    media: 'image',
    browser: BROWSER,
  },
  schema: Config,
}))
