// 源插件：met_museum —— 大都会艺术博物馆开放访问（公有领域，无需 key）
// 实测（2026-09-15 墙内直连）：search 200 / ~1.8s。
//
// 两步流（复用引擎 parse.detail 二级抓取机制）：
//   第一步 search 接口仅返回 {"total":N,"objectIDs":[...]} → 用 html 解析器对 JSON 文本跑正则
//   抽出 objectIDs 数组元素（lookbehind 精确锚定），url_template 拼 objects 详情 URL；
//   第二步逐个抓取详情页 JSON，正则抽 primaryImage（原图）/ primaryImageSmall（web 版）。
// 注意：detail 阶段解析器固定为 html（sources.resolveDetailLinks），故 detail 也用正则抽取。
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('cat').description('搜索关键词'),
})

export default defineSource('source-met_museum', () => ({
  def: {
    name: 'met_museum',
    display: '大都会艺术博物馆',
    driver: 'http',
    needs_proxy: false,
    media: 'image',
    request: {
      method: 'GET',
      // search 接口不支持分页，一次返回全量 objectIDs；detail 循环按 maxImages 截断
      url: 'https://collectionapi.metmuseum.org/public/collection/v1/search?q={query_encoded}&hasImages=true&isPublicDomain=true',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      pagination: { type: 'none' },
    },
    parse: {
      format: 'html',
      url_extract: {
        // search 响应为 {"total":N,"objectIDs":[id1,id2,...]}：用 lookbehind/lookahead
        // 精确抽数组元素（total 的数字前文是 ":" 不满足），url_template 拼详情 URL
        patterns: ['(?<="objectIDs":\\[|,)\\d+(?=,|\\])'],
        url_template: 'https://collectionapi.metmuseum.org/public/collection/v1/objects/{url}',
      },
      detail: {
        delay: 0.1,
        url_extract: {
          patterns: [
            '"primaryImage":"(https://images\\.metmuseum\\.org/[^"]+)"',
            '"primaryImageSmall":"(https://images\\.metmuseum\\.org/[^"]+)"',
          ],
        },
      },
    },
    item: {
      url: { path: 'url' },
      title: { const: 'Met Museum 公有领域藏品' },
      referer: { const: 'https://www.metmuseum.org/' },
    },
  },
  schema: Config,
}))
