// 源插件：surfcg —— SurfCG 盛绘艺点 CG 社区（POST JSON API，墙内可达）
// 移植自 legacy/sources/json/surfcg.json
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('').description('搜索关键词（可空）'),
  sorting: Schema.union(['0', '1', '2']).default('0').description('排序: 0=最新 1=最热 2=点赞最多'),
})

export default defineSource('source-surfcg', () => ({
  def: {
    name: 'surfcg',
    display: 'SurfCG 盛绘艺点 CG 社区',
    driver: 'http',
    needs_proxy: false,
    media: 'image',
    request: {
      method: 'POST',
      url: 'https://api.surfcg.com/Content/SearchProduction',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Referer: 'https://www.surfcg.com/',
        'Content-Type': 'application/json',
      },
      body: {
        type: 1,
        page: '{page}',
        isFollow: false,
        pageSize: 100,
        orderBy: '{sorting}',
        structure: 0,
        themeIds: [],
        labelNames: [],
        mediumIds: [],
        Formats: [],
        isNotShowCrawler: false,
        keyWord: '{query}',
      },
      skip_empty_params: true,
      pagination: { type: 'page', param: 'page', start: 1, step: 1, per_page: 100 },
    },
    parse: { format: 'json', list_path: 'data.list', stop_when_empty: true },
    item: {
      url: { path: 'coverUrl' },
      title: { path: 'title' },
      author: { path: 'userName' },
      referer: { const: 'https://www.surfcg.com/' },
      meta: { id: { path: 'id' }, views: { path: 'viewCount' }, likes: { path: 'likeCount' }, image_count: { path: 'imageCount' } },
    },
  },
  schema: Config,
}))
