# image-scraper (Cordis 版)

多源图片爬虫，基于 **cordis@4.0.0-rc.8** 插件元框架重构——「一切皆插件」：
驱动、解析器、分页器、每个图源、调度器、CLI 都是可独立装卸的插件，由一份声明式
`cordis.yml` 装配，顺序即拓扑。

> Python 原版已整体移入 [`legacy/`](legacy/)（保留作为行为基线，不再开发）。
> 重构规划见 [`docs/ROADMAP_CORDIS.md`](docs/ROADMAP_CORDIS.md)，
> P0–P2 验收报告见 [`docs/ACCEPTANCE_P0-P2.md`](docs/ACCEPTANCE_P0-P2.md)。

## 运行

```bash
npm install                 # workspaces：packages/* + apps/*
node apps/cli/src/index.js --list-sources
node apps/cli/src/index.js --source all --max-images 5
```

常用参数：

```
--source <名|all>   要跑的源（默认 picsum；all=并行跑全部已挂载源）
--max-images N      每源最大下载数（默认 100）
--query <词>        搜索关键词
--pages N           翻页数
--tags / --booru-rating / --booru-limit / --booru-exclude   booru 系参数
--proxy <url>       代理（http/https/socks5；仅对 needs_proxy 的源自动启用）
--retry-failed PATH 重投失败清单（meta/failed_*.json，直接下载不再抓取）
--verify-proxy URL  一键验证 GFW 源经代理可达性（OK/REACH/TIMEOUT/FAIL/SKIP）
--serve             启动 Web 面板长驻（端口见 cordis.yml web.config.port）
--dump-config       打印插件树后退出
--list-sources      列出已挂载源后退出
```

下载失败的 URL 自动导出 `meta/failed_<源>_<时间>.json`，用
`--retry-failed` 一键重投（不再重新抓取任务）；重投后仍有失败的会导出
`meta/failed_retry_*.json`，可继续链式重投。

Web 面板（`--serve` 后访问 `http://127.0.0.1:8642/`）：勾选源 → 填参数 →
运行，实时看每源统计与日志尾部；接口：`/api/sources` `/api/run`
`/api/status` `/api/logtail`。

## 测试与门禁

```bash
npm run check        # 语法 + cordis.yml 校验 + harness 单测（15 项不变量）+ 装配冒烟
npm run check:fast   # 跳过单测与冒烟
npm test             # 仅 harness（node:test）
```

不变量固化：数据守恒（`fetched ≥ downloaded + skipped + errors`）、
跨运行去重、失败清单 `write → read` 链路、事件配对
（registered ↔ unregistered）、与 Python 版一致的 md5 命名。

首批（P0–P2）已迁移 7 个源：`bing` `duitang` `giphy` `picsum`
`pixabay_illustration` `pixabay_vector` `safebooru`。

P3 已完成 **30 源全量插件化**（与 Python 版 30 个 JSON 配置一一对应）。
运行约束：

- **browser / browser_html 源**（midjourney×4 / deviantart / google / pinterest /
  photo / webpage）：`driver-browser(-html)` 挂载前自动下线（日志点名
  `driver-unavailable:browser_html`），P4 实现；
- **GFW 源**（artstation / civitai / deviantart / flickr / google / konachan /
  lexica / midjourney×4 / pinterest / pixiv / reddit / wallhaven）：
  需 `--proxy`（如 `socks5://127.0.0.1:1080`），否则跳过（`needs-proxy`）；
- **needs_key 源**（flickr / unsplash / wallhaven / pexels）：key 写
  `data/settings.json` 的 `credentials.keys` 按源名存放，如
  `{"credentials": {"keys": {"unsplash": "..."}}}`；flickr/unsplash 无 key
  自动回退 alt 通道（unsplash 的 key 经 `Authorization: Client-ID {key}`
  头注入，已配置并实测可用）。
- **视频/音频源**（pixabay_video / pixabay_music / midjourney_video×2）：
  产出 mp4/mp3，媒体类型由 `ctx.media` 判定（ffmpeg 后处理属 P4 `postprocess-video`）。

## 架构

```
L1 基础服务    config · logfile · settings · proxy · http · curl · media · storage · downloader
L2 能力注册表  drivers · parsers · paginators
L3 能力实现    driver-http · driver-curl · driver-browser · driver-browser-html
               parser-json · parser-html
               paginator-page · paginator-list · paginator-none · paginator-cursor
L4 源注册表    sources（+ source-* ×30）
L5 应用        scheduler · cli · web
```

全部 55 个插件装配在 [`apps/cli/cordis.yml`](apps/cli/cordis.yml)。
共享实现在 [`packages/core/src/`](packages/core/src/)；app 侧
`src/plugins/<id>.js` 只做薄转发。

### 装配纪律（自研 loader，对齐 private-radio-stations 的 @relay/core）

- 行式条目：`{ id, module?, config?, disabled?, hot? }`，支持裸模块标识符；
- **顺序即拓扑**：loader 逐行 `await` fiber，被依赖者必须排在依赖者之前；
- **启动审计**：每个 id 必须注册同名 Service（`ctx[id]`），缺失即点名抛错；
- **`!!js` 表达式**：如 `root: !!js "path.resolve(__dirname, '..', '..')"`；
- **patch 分层**：机器本地差异写 `apps/cli/cordis.patch.yml`（不入库），
  或 `CORDIS_PATCH` 环境变量指定；按 id 覆盖 / `before:` 锚点插入；
- **effect 可逆注册**：驱动/解析器/分页器/源均经 `ctx.effect(() => registry.register(...))`
  注册，插件卸载时自动撤销。

### 删一行即少一个能力

例如把 `driver-curl` 整行禁用（patch 里 `disabled: true`）：

```yaml
- id: driver-curl
  disabled: true
```

依赖 curl 通道的 pixabay 系源会因 `inject` 级联**自动下线**并在日志点名
（`driver-unavailable:curl`），其余源完全不受影响。

### 浏览器驱动（可选依赖）

`driver-browser`（Playwright 全流程，midjourney 系）与 `driver-browser-html`
（浏览器取 HTML 后走常规解析，webpage/photo）依赖 **Playwright**：

```bash
npm i playwright && npx playwright install chromium   # 在 apps/cli 下
node apps/cli/src/index.js --source webpage --url 'https://safebooru.org/index.php?page=post&s=list' --max-images 5
```

未安装 Playwright 时两个驱动**不注册**，挂载的浏览器源以
`driver-unavailable:browser` / `driver-unavailable:browser_html` 点名下线，
其余源零影响。midjourney 系源标记 `needs_proxy: true`，无 `--proxy` 时
启动前即跳过（`needs-proxy`），不拉起浏览器。

## 配置分层（取代 Python 版 config.json）

凭据与覆盖按优先级合成：**源 schema 默认 < cordis.yml base < `data/settings.json`（用户文档，不入库）**。

```bash
node apps/cli/src/index.js --dump-config   # 查看合成结果
```

API Key / 代理建议写入 `data/settings.json`，例如：

```json
{ "pixabay_illustration": { "key": "..." } }
```

## 输出

- 图片：`images/<source>/<source>_<md5(url)[:12]><ext>`（与 Python 版一致，跨实现去重）
- 元数据：`meta/<source>_<时间戳>.json`
- 失败清单：`meta/failed_<source>_<时间戳>.json`
- 日志：`data/logs/scraper.log`

## 热重载（长驻模式）

```bash
SCRAPER_WATCH=1 node apps/cli/src/index.js --source picsum
```

改动 `cordis.patch.yml` 或受 `hot: true` 标记的插件时，loader 按依赖闭包
逆序 dispose → 重应用，失败自动回滚。

## 目录

```
packages/core     共享实现（loader、服务层、能力注册表、源插件）
apps/cli          CLI 应用（cordis.yml + 薄转发插件 + bootstrap）
legacy            Python 原版（行为基线，只读）
docs              规划与验收文档
images/ meta/     产出（与 Python 版共用，约 13 GB 存量资产）
```
