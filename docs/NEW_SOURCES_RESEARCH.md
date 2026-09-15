# 新源插件调研（联网搜索 + 墙内直连实测）

> 日期：2026-09-15 ｜ 实测环境：本机直连（无代理）｜ 方法：WebSearch 调研 → node fetch 实测 HTTP 状态与延迟

## 1. 实测结果汇总

| 候选源 | API | 墙内实测 | 许可 | 结论 |
|---|---|---|---|---|
| **Bing 每日壁纸** | `cn.bing.com/HPImageArchive.aspx?format=js&idx=0..7&n=1..8&mkt=zh-CN` | ✅ 200，0.29s | 必应版权（展示/壁纸用途，每日一图官方接口） | **P1 强烈推荐**：单步 JSON、秒回、每日更新、n≤8 一轮 8 张 |
| **NASA 图像库** | `images-api.nasa.gov/search?q=&media_type=image&page_size=` | ✅ 200，0.56s | PD（公有领域） | **P2 推荐**：`collection.items[].links[rel=preview]` 缩略图，`~thumb→~orig` 替换取全图 |
| **克利夫兰艺术博物馆** | `openaccess-api.clevelandart.org/api/artworks/?cc0=1&has_image=1&limit=&skip=` | ✅ 200，1.4s | CC0（per-record `share_license_status`） | **P2 推荐**：单步列表直接带 `images.web.url`（900px）/`print.url`（3400px） |
| **大都会博物馆 Met** | `collectionapi.metmuseum.org/public/collection/v1/search?q=&hasImages=true&isPublicDomain=true` → `/objects/{id}` | ✅ 200，1.8s | CC0（49 万+ PD 图） | **P2 推荐**：两步流——用现有 `parse.detail` 二级抓取机制（`resolveDetailLinks`）+ `detail` 延时 0.1s |
| **丹麦国家美术馆 SMK** | `api.smk.dk/api/v1/art/search/?keys=*&filters=[public_domain:true]&filters=[has_image:true]` | ✅ 200，1.5s | Public Domain Mark | P3 备用：filters 必须重复参数传递（拼接会被静默忽略） |
| Openverse | `api.openverse.org/v1/images/?q=` | ❌ ConnectTimeout 10.6s | CC | **排除**（墙内不可达；如走代理可再评估） |
| Art Institute of Chicago | `api.artic.edu/api/v1/artworks/search` | （未实测） | CC0 | 暂缓：调研确认其**图片 host 有 Cloudflare 挑战**，JSON 可用但图片下载需浏览器 |
| NGA Washington | published_images.csv + IIIF | （未实测） | openaccess=1 才开放 | 暂缓：CSV 批量模式与在线抓取引擎不匹配 |

## 2. 与现有引擎能力的映射

| 新源 | 引擎能力需求 | 落地方式 |
|---|---|---|
| bing_daily | 单步 JSON + 模板 URL | `source-bing_daily.js`：`request.url` 固定，`params: {idx: 0, n: 8, mkt: 'zh-CN'}`；`list_path: 'images'`；`item.url` 用 `template: 'https://cn.bing.com{url}'`（url 为相对路径）+ `url_resolve`；title 取 `title`，copyright 入 meta |
| cleveland_art | 单步 JSON + 分页 | `list_path: 'data'`；`item.url: images.web.url`，`meta` 取 `title/creator/creation_date`；分页 `skip` 参数 page 型步长 = limit |
| met_museum | 两步（search→detail） | `parse.detail` 已支持：一级 search 返回 `objectIDs[]`（数字数组，`list_path` + `item.url: template 'https://collectionapi.../objects/{id}'`）→ 二级 detail 从 object JSON 取 `primaryImageSmall`（web-large 体积适中）；`detail.delay: 0.1` 对齐礼貌使用（官方建议 ~1 req/s） |
| nasa_images | 单步 JSON + transforms | `list_path: 'collection.items'`；`item.url: links[rel=preview].href` + `url_transform`（`~thumb→~orig` 替换规则）；`meta` 取 `title/description/keywords` |

## 3. 接入建议与优先级

1. **P1 `bing_daily`**：收益最高（墙内 0.3s、每日唯一更新、与现有 `bing` 图片搜索源互补、md5 去重天然防重复下载）。每小时跑一次 `n=8`，跨小时去重后每天净增 ~8-24 张（壁纸轮换）。
2. **P2 `cleveland_art` + `met_museum`**：高质量 CC0 艺术图，适合按 `q` 关键词轮换（如每轮换一个主题词，写在 cordis.yml config）。
3. **P2 `nasa_images`**：PD 科普图，关键词轮换同理。
4. **P3 `smk_dk`**：备用；先观察 P1/P2 稳定性再接。
5. **排除**：Openverse（墙内超时）、AIC（图片 host CF 挑战）、NGA（CSV 模式不符）。

## 4. 附：实测命令

```js
// node 22 fetch，12s 超时，Chrome UA
fetch('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN')  // 200 / 0.29s
fetch('https://collectionapi.metmuseum.org/public/collection/v1/search?q=sunflowers&hasImages=true&isPublicDomain=true')  // 200 / 1.8s
fetch('https://openaccess-api.clevelandart.org/api/artworks/?cc0=1&has_image=1&limit=2')  // 200 / 1.4s
fetch('https://images-api.nasa.gov/search?q=galaxy&media_type=image&page_size=2')  // 200 / 0.56s
fetch('https://api.openverse.org/v1/images/?q=cat&page_size=2')  // ConnectTimeout → 排除
```
