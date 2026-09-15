// 源插件：bing_daily —— 必应每日壁纸（cn.bing.com 官方 HPImageArchive API，无需 key）
// 实测（2026-09-15 墙内直连）：200 / ~0.3s；images[].url 为相对路径，需拼 https://cn.bing.com 前缀
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  days: Schema.natural().default(8).description('获取最近 N 天壁纸（1-8，官方上限 8）'),
})

export default defineSource('source-bing_daily', () => ({
  def: {
    name: 'bing_daily',
    display: 'Bing 每日壁纸',
    driver: 'http',
    needs_proxy: false,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n={days}&mkt=zh-CN',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      pagination: { type: 'none' },
    },
    parse: { format: 'json', list_path: 'images' },
    item: {
      // images[].url 为相对路径（如 /th?id=OHR.xxx_1920x1080.jpg&rf=...&pid=hp）
      url: { template: 'https://cn.bing.com{url}' },
      title: { path: 'copyright' },
      referer: { const: 'https://cn.bing.com/' },
    },
  },
  schema: Config,
}))
