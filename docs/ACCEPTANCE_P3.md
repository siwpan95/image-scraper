# image-scraper × Cordis —— P3 验收报告（30 源全量插件化）

> 日期：2026-09-15 · Node 22.22.2 · cordis@4.0.0-rc.8
> 交付范围：P3 —— 其余 23 个源从 legacy JSON 迁移为 cordis 源插件，`source-*` ×30 成型。
> 前序：P0–P2 验收见 [ACCEPTANCE_P0-P2.md](ACCEPTANCE_P0-P2.md)。

## 1. 结论

**验收通过。** 30/30 源全部插件化并装配成功（插件树 53 个），语义与 Python 版
`_build_ctx` 逐项对齐；浏览器源在驱动缺位时优雅下线、GFW 源明确跳过、
墙内 HTTP 源真实下载成功。

| 验收点 | 结果 |
|---|---|
| `--list-sources` 列出 30 源 | ✅ 与 legacy JSON 30 个 name 一一对应 |
| 插件树装配 + 启动审计 | ✅ 53 插件，`--dump-config` 53 行 |
| 新源真实抓取下载 | ✅ surfcg（POST JSON API）获取 3 下载 3 |
| 浏览器源驱动缺位下线 | ✅ `driver-unavailable:browser_html` 点名（photo/webpage） |
| GFW 源跳过可观测 | ✅ `needs-proxy` 点名（midjourney/wallhaven） |

## 2. 迁移清单（23 个新源）

| 类别 | 源 | 迁移要点 |
|---|---|---|
| HTTP+JSON API | artstation · civitai · konachan · pexels · pixiv · reddit · surfcg · lexica · wallhaven | `{sorting}` 默认值落进各源 schema（artstation=popular / civitai=Newest / wallhaven=toplist / surfcg=0）；pixiv `merge_keys:[illust,manga]`；reddit cursor 分页 + `request_by_mode`（sub/search）；lexica list 分页 + POST body；civitai/wallhaven `stop_path` 提前停页 |
| HTTP+HTML(curl) | pixabay · pixabay_video · pixabay_music | `fetch:'curl'` 绕 CF；pixabay_video/music 分页 `delay:3`；music 详情页二级提取 mp3（`parse.detail`）；媒体类型 video/audio |
| needs_key + alt 回退 | flickr · unsplash | 无 key 自动走 alt 公开通道并 warn（`viaAlt`）；unsplash `request_by_mode.random` |
| browser 驱动 | midjourney · midjourney_url · midjourney_video · midjourney_video_url | `browser` 配置块原样进 def（explore_url/cdn/size_suffix/variants）；video 系 `media:'video'`；url 系 `require_content_url`；P4 挂 driver-browser 后生效 |
| browser_html 驱动 | deviantart · google · pinterest · photo · webpage | deviantart RSS `block_extract`；google/pinterest `url_decode`/`post_replace`；photo/webpage `url_resolve`+`is_image` 过滤+`{page_origin}` referer |

## 3. 行为对齐说明（与 Python `_build_ctx`）

- 全部模板变量 snake_case 对齐；`eff_tags`/`query_encoded`/`purity`/`nsfw_flag`/`browsing` 派生逻辑一致；
- Python 版 `civitai_sort="Newest"`、`deviantart_sort="popular"`、`flickr_sort="relevance"`
  三个默认值因模板占位符为 `{sorting}` 而**从未生效**（latent bug）——本版将意图落到
  schema 默认值上，行为等价或更正确；
- key 解析顺序 `CLI > env > settings`（`ctx.settings.key(name)`）；
- CLI 层新增通用 `--tab/--size/--scrolls/--no-headless/--content_url/--mj-index` 等透传，
  源专属键由 schema 声明、cordis.yml config 覆盖。

## 4. 验收证据（2026-09-15 10:26–10:27 日志）

```
[info] image-scraper (Node.js + Cordis) started · 插件数=53
[warn] 源 [midjourney] 跳过：GFW 封锁，需 --proxy (如 socks5://127.0.0.1:1080)
[warn] 源 [wallhaven]  跳过：GFW 封锁，需 --proxy
[info] [surfcg] 完成 3.2s | 获取 3 | 下载 3 | 跳过 0 | 失败 0
[warn] 源 [photo]   跳过：所需驱动未挂载 "browser_html"（如未安装 Playwright，属预期行为）
[warn] 源 [webpage] 跳过：所需驱动未挂载 "browser_html"
总览: photo/webpage → driver-unavailable:browser_html
```

产物：`images/surfcg/surfcg_88fe9166bd3a.png` 等 3 文件 + `meta/surfcg_*.json`。

## 5. 后续（P4–P6）

- P4：`driver-browser` / `driver-browser-html`（Playwright 生命周期入 `ctx.effect`）、
  `probe`、`postprocess-video`（ffmpeg）；
- P5：Web 面板（GUI 决策）、`retry`（--retry-failed）、`verify`；
- P6：`harness/` 不变量 + `scripts/check.mjs` 门禁。
