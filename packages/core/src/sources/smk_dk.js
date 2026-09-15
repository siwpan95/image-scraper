// 源插件：smk_dk —— 丹麦国家美术馆 Statens Museum for Kunst（公有领域，无需 key）
// 实测（2026-09-15 墙内直连）：200 / ~1.4s。
// 坑点：API 要求 filters 为**同名重复参数**（filters=[public_domain:true]&filters=[has_image:true]），
// JSON params 对象无法表达，必须直接写进 URL 模板（%5B/%5D 预编码）。
// 字段平铺：image_thumbnail（iip-thumb.smk.dk IIIF 1024px jpg 直链）；
// 不要用 image_native——它实际是 api.smk.dk/api/v1/download/<base64> 代理端点（服务端解码后
// 代理 iip.smk.dk 的 .tif.jp2 原图），实测墙内 30s 超时；titles[0].title / artist。
import Schema from 'schemastery'
import { defineSource } from './define.js'

export const Config = Schema.object({
  query: Schema.string().default('*').description('搜索关键词（* 为全部）'),
  rows: Schema.natural().default(20).description('每页数量'),
  pages: Schema.natural().default(1).description('翻页数'),
})

export default defineSource('source-smk_dk', () => ({
  def: {
    name: 'smk_dk',
    display: '丹麦国家美术馆 SMK',
    driver: 'http',
    needs_proxy: false,
    media: 'image',
    request: {
      method: 'GET',
      url: 'https://api.smk.dk/api/v1/art/search/?keys={query_encoded}&filters=%5Bpublic_domain:true%5D&filters=%5Bhas_image:true%5D&rows={rows}&offset={page}',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      pagination: { type: 'page', param: null, start: 0, step: '{rows}', count_var: 'pages' },
    },
    parse: { format: 'json', list_path: 'items' },
    item: {
      // image_native 是下载代理端点（超时），只用 thumbnail 直链
      url: { path: 'image_thumbnail' },
      title: { path: 'titles.0.title' },
      author: { path: 'artist' },
      referer: { const: 'https://www.smk.dk/' },
    },
  },
  schema: Config,
}))
