# image-scraper × Cordis 重构规划

> 目标：把 image-scraper 从 **Python 单体 + 中心化参数表** 重构为 **Cordis 插件树**，实现「一切皆插件」。
> 本文为规划（P0 前），不含实现代码。

---

## 0. 前置决策（必须先定）

**Cordis 是 TypeScript / Node.js 框架**（`cordis@4.0.0-rc.8`，cordiverse 出品，Koishi 内核、DeepSeek Harness 的底座）。现有 image-scraper 是 Python。因此「用 Cordis 重构」隐含一次**运行时迁移**，三条路线：

| 路线 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **A（推荐）** | 整体重写为 TypeScript + Cordis | 拿到真正的 inject / effect / HMR / patch 全套机制；与你在 `private-radio-stations-upstream` 的既有工程约定完全一致 | 全量重写；Python 生态需换等价物（httpx→undici、Playwright→playwright-node、moviepy→ffmpeg CLI）；**Cloudflare 绕过能力需重新验证**（见 §10 R1） |
| B | 用 Python 自实现一套 Cordis 语义内核 | 保留 Python 生态与现有代码资产，可渐进迁移 | 不是真 Cordis，内核需自己维护；拿不到 `@cordisjs/*` 生态插件；两套「插件」概念并存 |
| C | Cordis(TS) 作宿主 + Python 源作 sidecar worker | 架构上真「一切皆插件」，同时复用现有 Python 源实现 | 双运行时；需定义进程间协议（源发现 / 任务流 / 代理 / 凭据）；调试与打包复杂度上升 |

**推荐 A**，理由：Cordis 的价值恰好在 `inject` 级联与 `effect` 自动回收——这正是当前 `engine.py` 用字符串分支硬编码、`mj_scraper.py` 用 `try/except` 兜底的地方；只有真 Cordis 才能兑现。Python 版应作为**行为基线（reference implementation）**保留，用于逐源回归比对（见 §11）。

**已对齐的工程基线**（取自 `C:\Users\psw\repos\private-radio-stations-upstream`）：

- `cordis@4.0.0-rc.8`（npm 包，非 vendored），ESM（`"type": "module"`），Node ≥ 22
- npm workspaces monorepo：`packages/*`（公共）+ `apps/*`（应用）
- 自研声明式 loader `@relay/core/src/loader.js`，**取代** `@cordisjs/plugin-loader`：
  - `!!js` 配置表达式（`tag:yaml.org,2002:js`）
  - 行式 cordis.yml：`{ id, module?, config?, disabled?, hot? }`
  - patch 分层：`cordis.patch.yml` + `CORDIS_PATCH` 环境变量；按 id 覆盖 / `before:` 锚点插入
  - 启动结算审计：逐个 `await` fiber，**应用后核对 `ctx[id]` 是否存在**，缺失即点名抛错
  - HMR：`affectedClosure()` 依赖闭包 + 逆序 dispose + 回滚
- 插件写法固定为：**默认导出一个函数插件**，内部 `ctx.plugin(ServiceClass, cfg)` 注册为 `ctx.<id>`
  ```js
  class XxxService extends Service {
    constructor(ctx, cfg) { super(ctx, 'xxx'); /* ... */ }
  }
  XxxService.inject = ['config']
  export default function xxxPlugin(ctx, cfg) { ctx.plugin(XxxService, cfg) }
  ```
- 共享实现放 `packages/core`，各 app 的 `src/plugins/<id>.js` 做薄转发（现有仓库中 `logfile.js` 仅 130 字节即此类）
- `schemastery` 做配置 schema；`docs/ROADMAP_*.md` 承载分期路线；`harness/` + `scripts/check.mjs` 做门禁

---

## 1. 现状诊断

| 文件 | 体量 | 职责 | 问题 |
|---|---|---|---|
| `mj_scraper.py` | 334 行 | argparse（~40 个 flag）+ 多源并行 + 重投 | 参数与源强耦合 |
| `sources/registry.py` | 159 行 | 扫 JSON、`build_source()`、**`_build_ctx()`** | 中心化参数翻译表 |
| `sources/base.py` | 370 行 | `ImageTask` / `SourceStats` / `Downloader` / `SourceBase` | 下载器不可替换 |
| `sources/engine.py` | **~1290 行** | 模板替换 + HTTP + curl + 分页 + HTML/JSON 解析 + **浏览器双通道** + 任务构建 | 上帝对象 |
| `sources/json/*.json` | 30 个 | 声明式源配置 | 依赖中心化 ctx |
| `config.py` | 7.5 KB | 代理 / API Key 持久化、代理探测与自动拉取 | 模块级单例 |
| `gui_scraper.py` | 27.7 KB | tkinter GUI | 与 CLI 重复拼装依赖 |

**六处根因**：

1. **`_build_ctx()` 是加源瓶颈**：新增一个源要同时改 `mj_scraper.py`（argparse）、`registry._build_ctx()`（80 行 if 块）、`sources/json/*.json` 三处。
2. **`engine.JsonSource` 是上帝对象**：约 1290 行里混了 7 类关注点；`_run_browser`(L706–892) + `_run_browser_html`(L892–1091) 共 **~385 行**浏览器逻辑硬编码在引擎内。
3. **驱动/解析靠字符串分支**：`driver: http | browser | browser_html`、`fetch: curl`、`parse.format: html | json`、`pagination.type: page | list | none` 全是 if 链，无法新增/替换/卸载。
4. **`Downloader` 硬编码**在 `base.py`，源无法换下载实现（并发、限速、文件名策略、断点）。
5. **`config.py` 模块级全局**：代理与 Key 通过模块函数取，无法按上下文隔离。
6. **CLI / GUI / 测试各自拼装依赖**（都走 `build_source`），没有统一容器，没有生命周期与回收。

> 注：现有项目已经是「JSON 声明式源」，这是很好的底子——重构不是推翻，而是把**声明式源**从「中心翻译 + 单体引擎」升级为「插件注册 + 驱动/解析注册表」。

---

## 2. 目标架构

### 2.1 Cordis 五概念 → 本项目映射

| Cordis 概念 | 本项目落点 |
|---|---|
| **Plugin** | 驱动、解析器、分页器、每一个图源、下载器、代理、CLI、GUI 全都是插件 |
| **Context** | 根 `ctx`；`ctx.http` / `ctx.drivers` / `ctx.sources` … |
| **inject** | 源插件声明 `inject: ['http', 'downloader', 'storage']`；驱动插件声明 `inject: ['logfile']` |
| **Events** | `scrape/before`、`task/fetched`、`download/before`（waterfall，可改写/拒绝）、`download/after`、`source/registered`、`ready`、`dispose`、`config:update` |
| **Effect** | 注册源、注册驱动、开 Playwright、开定时器、事件监听——全部随插件卸载自动回收 |

### 2.2 分层

```
L0  内核         cordis 本体（不可替换）
L1  基础服务     config · logfile · proxy · http · curl · downloader · storage · settings
L2  能力注册表   drivers · parsers · paginators · media
L3  能力实现     driver-http · driver-curl · driver-browser · driver-browser-html
                 parser-html · parser-json · postprocess-video
L4  源插件       source-bing · source-picsum · … · source-midjourney_video（30 个）
L5  应用插件     cli · scheduler · retry · verify · gui
```

### 2.3 服务表

| 服务 | 提供方 | 职责 | 取代 |
|---|---|---|---|
| `ctx.logger` | cordis 内置 | 分级日志 | — |
| `ctx.config` | 第一个插件（其余都 inject 它） | 全局根配置 | `mj_scraper.OUTPUT_DIR` 等 |
| `ctx.logfile` | `@scraper/core` | 文件日志 + 错误环 | `scraper.log` 硬编码 |
| `ctx.settings` | `@scraper/core` | 分层设置（schema→base→用户） | `config.json` 读写 |
| `ctx.proxy` | `@scraper/core` | 代理探测 / 自动拉取 / 可达性校验 | `config.py` |
| `ctx.http` | `@scraper/core` | HTTP 客户端池（undici），支持代理、UA、重试 | `engine._get_client` |
| `ctx.curl` | `@scraper/core` | curl 逃生通道（TLS 指纹） | `engine._curl_get` |
| `ctx.downloader` | `@scraper/core` | 并发 / 限速 / 重试 / 文件名 / 去重 | `base.Downloader` |
| `ctx.storage` | `@scraper/core` | 落盘 `images/`+`meta/`+失败清单 | `SourceBase._save_meta/_save_failed` |
| `ctx.drivers` | `@scraper/core` | 驱动注册表：`register(name, fn)` / `resolve(name)` | `driver:` 字符串分支 |
| `ctx.parsers` | `@scraper/core` | 解析器注册表：`html` / `json` | `parse.format` 分支 |
| `ctx.paginators` | `@scraper/core` | 分页策略：`page` / `list` / `none` | `pagination.type` 分支 |
| `ctx.media` | `@scraper/core` | 媒体类型抽象（image / video / audio） | `MEDIA_EXTS` 硬编码 |
| `ctx.sources` | `@scraper/core` | 源注册表 + schema 汇总（供 CLI 生成参数） | `registry` |

---

## 3. 插件清单

| # | 插件 id | inject | 提供 | 关键配置 |
|---|---|---|---|---|
| 1 | `config` | — | `ctx.config` | `root`、`outputDir`、`concurrency`、`retries`、`rateLimit`、`speedLimit` |
| 2 | `logfile` | `config` | `ctx.logfile` | `file` |
| 3 | `proxy` | `config` | `ctx.proxy` | `url`、`auto`、`preferSocks`、`candidates[]` |
| 4 | `settings` | `config` | `ctx.settings` | — |
| 5 | `http` | `config`、`proxy` | `ctx.http` | `timeout`、`ua`、`maxConnections` |
| 6 | `curl` | `config`、`proxy` | `ctx.curl` | `binary`、`extraArgs[]` |
| 7 | `downloader` | `http`、`storage` | `ctx.downloader` | `concurrency`、`retries`、`rateLimit`、`speedLimit` |
| 8 | `storage` | `config` | `ctx.storage` | `imagesDir`、`metaDir`、`bySource` |
| 9 | `media` | `config` | `ctx.media` | `kinds` |
| 10 | `drivers` | `logfile` | `ctx.drivers` | — |
| 11 | `parsers` | `logfile` | `ctx.parsers` | — |
| 12 | `paginators` | `logfile` | `ctx.paginators` | — |
| 13 | `driver-http` | `drivers`、`http` | 驱动 `http` | `fetch: http` |
| 14 | `driver-curl` | `drivers`、`curl` | 驱动 `curl` | — |
| 15 | **`driver-browser`** | `drivers` | 驱动 `browser` | `headless`、`scrolls`、`engine: chromium\|edge` |
| 16 | **`driver-browser-html`** | `drivers` | 驱动 `browser_html` | 同上 |
| 17 | `parser-html` | `parsers` | 解析器 `html` | — |
| 18 | `parser-json` | `parsers` | 解析器 `json` | — |
| 19 | `paginator-page` | `paginators` | 分页 `page` | — |
| 20 | `paginator-list` | `paginators` | 分页 `list` | — |
| 21 | **`postprocess-video`** | `media`、`storage` | 视频后处理 | `ffmpegDir`、`transcode` |
| 22 | `sources` | `drivers`、`parsers`、`paginators` | `ctx.sources` | — |
| 23 | `source-*` ×30 | `sources`、`downloader` | 各注册一个源 | 各自 schema（见 §8） |
| 24 | `cli` | `sources`、`settings` | CLI 入口 | 自动生成 flag |
| 25 | `scheduler` | `sources` | 多源并行 + 总进度 | `concurrency` |
| 26 | `retry` | `downloader`、`storage` | 失败清单重投 | `--retry-failed` |
| 27 | `verify` | `sources`、`proxy` | 代理/源连通性自检 | 对应 `verify_proxy.py` |
| 28 | `probe` | `drivers` | 浏览器抓包探针 | 对应 `probe_capture.py` |
| 29 | `gui` | `sources` | 图形界面 | 对应 `gui_scraper.py` |

---

## 4. 关键机制：注册表取代字符串分支

现状（`engine.py` 内 if 链）：

```python
if driver == "browser":        await self._run_browser()
elif driver == "browser_html": await self._run_browser_html()
elif driver == "http":         ...
if fetch == "curl": ...
if parse_format == "html": ...
```

目标：**能力即服务，服务即插件**。

```js
// driver-browser.js
class BrowserDriver extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'driverBrowser')
    // 注册即 Effect：卸载本插件，注册项自动撤销
    ctx.effect(() => ctx.drivers.register('browser', (opts) => this.run(opts)))
    ctx.effect(() => this.disposeBrowser())   // 关 Playwright
  }
}
```

源侧只声明名字，不再判断：

```js
// source-midjourney.js
export const inject = ['sources', 'drivers', 'downloader']
export function apply(ctx, cfg) {
  ctx.sources.register('midjourney', { driver: 'browser', parse: 'json', /* ... */ })
}
```

**收益（这是重构的核心价值）**：

- 卸载 `driver-browser` → 所有 `driver: browser` 的源因 `inject` 级联**自动下线**，不需要任何 `try/except`；
- 换 `driver-browser-edge` 实现 → 所有浏览器源在新实现上干净重启；
- 新增一个驱动（如 `driver-cdp` 直连 Chrome DevTools）→ **零改动**现有源与引擎。

---

## 5. 浏览器源插件化（重点一）

**现状**：`engine.py` 中 `_run_browser()`（L706–892）+ `_run_browser_html()`（L892–1091），共约 **385 行**，把 Playwright 启动、滚动、反爬等待、CDN 拼链、任务构建、浏览器内下载全部硬编码进单体引擎。`needs_browser` 只是个布尔标记。

**目标拆解**：

| 新插件 | 承担现状代码 | 说明 |
|---|---|---|
| `driver-browser` | `_run_browser` + `_collect_jobs` + `_maybe_add_job` + `_build_browser_tasks` + `_browser_download` | Midjourney Explore：`/api/explore` 响应收集 → CDN 拼链（`{cdn}/{id}/0_{vi}{suffix}`）→ 变体展开 |
| `driver-browser-html` | `_run_browser_html`（L892–1091） | 通用 HTML 抓取：滚动加载 + 反爬页识别（`_is_antibot_page`） |
| `probe`（可选） | `probe_capture.py` | 抓包探针，作为开发期插件挂载 |

**要点**：

1. **Playwright 生命周期归 `ctx.effect`**：浏览器实例在插件加载时创建、卸载时关闭，杜绝现有代码里浏览器泄漏 / 未关闭的问题。
2. **驱动配置 schema 化**：`{ headless, scrolls, engine: 'chromium'|'edge', ua, waitUntil }`。现状 `--headless` / `--scrolls` 是 CLI 全局参数，之后归属驱动。
3. **可整体替换**：`driver.js` 用 `playwright`，`driver-edge` 用系统 Edge（对应 `probe_capture.py` 的 `--browser edge` 用法），二者对源透明。
4. **浏览器源与 HTTP 源统一调度**：源不再区分「是否浏览器源」，只声明 `driver`；`triggerTask` 走统一的 `ctx.drivers.resolve(name)`。
5. **可用性自检**：Playwright 未安装时，`driver-browser` 加载失败 → 只有 `driver: browser` 的源处于 PENDING，**HTTP 源照常工作**（对齐现状 `No module named 'playwright'` 时 `EMPTY` 的行为，但由框架保证而非手工兜底）。

---

## 6. 视频源插件化（重点二）

**现状**：`pixabay_video` / `pixabay_music` / `midjourney_video` / `midjourney_video_url` 四个源产出 `.mp4` / `.mp3`；`Downloader.MEDIA_EXTS` 把音视频扩展名硬编码进下载器；README 提到 `moviepy` + `proglog` 做后处理。

**目标拆解**：

| 新插件 | 职责 |
|---|---|
| `media` | 媒体类型抽象：`registerKind('video', { extensions: ['.mp4','.webm'], needs: ['postprocess-video'] })` |
| `postprocess-video` | 用 **ffmpeg CLI** 取代 `moviepy`：转码 / 合并 / 抽帧 / 封面。ffmpeg 缺失时本插件加载失败，**视频源自动下线，图片源不受影响** |
| `storage`（改造） | 按 `kind` 落目录：`images/<source>/`、`videos/<source>/`、`audio/<source>/` |

**要点**：

1. **源只声明 `media: 'video'`**，不再关心 moviepy/ffmpeg 差异；`ctx.media` 负责扩展名判定与后处理编排。
2. **依赖即开关**：只跑图片时不挂 `postprocess-video`，整条链路无 ffmpeg 依赖——这正是「一切皆插件」的直接红利（现状是 `requirements.txt` 一把梭）。
3. **对应你既有仓库的做法**：`private-radio-stations` 已有 `packages/core/src/ffmpeg-args.js`，可直接复用其参数构造约定，保持两个项目的 ffmpeg 封装一致。
4. **分页 `delay` 支持**：`pixabay_video.json` 现有 `"delay": 3`（防限流），归入 `paginator-page` 的 schema。

---

## 7. 配置与组合

`apps/cli/cordis.yml`（行式 + `!!js` + patch，与现网约定一致）：

```yaml
plugins:
  # 必须第一个：其余插件都注入 ctx.config
  - id: config
    config:
      root: !!js "process.cwd()"
      outputDir: images
      concurrency: 5
      retries: 3

  - id: logfile
    config: { file: data/logs/scraper.log }

  - id: proxy
    config:
      auto: false
      preferSocks: true

  - id: http
  - id: curl
  - id: downloader
  - id: storage
  - id: media
  - id: drivers
  - id: parsers
  - id: paginators

  # ── 能力实现（可整体拔插）──
  - id: driver-http
  - id: driver-curl
  - id: driver-browser
    config: { headless: true, scrolls: 20, engine: chromium }
    hot: true
  - id: driver-browser-html
  - id: parser-html
  - id: parser-json
  - id: paginator-page
  - id: paginator-list
  - id: postprocess-video        # 只跑图片时整行删掉 / disabled

  # ── 源（30 行，删一行即少一个源）──
  - id: sources
  - id: source-picsum
  - id: source-bing
    config: { query: "cyberpunk city", pages: 3 }
  - id: source-safebooru
    config: { tags: landscape, exclude: [blood, gore] }
  - id: source-midjourney
    config: { tab: top, size: medium }
  - id: source-midjourney-video
  # … 其余源

  # ── 应用 ──
  - id: scheduler
  - id: retry
  - id: cli
```

`cordis.patch.yml`（机器本地，不入库——与你既有约定一致）：

```yaml
# 我这台机器：走本地 Clash，且关掉用不到的浏览器源
- id: proxy
  config: { url: "socks5://127.0.0.1:7890" }
- id: source-midjourney
  disabled: true
- id: source-console-logger      # before 锚点插入新插件
  before: cli
```

这里直接兑现了三点现状做不到的能力：**按 id 关源**、**本地覆盖不入库**、**不改代码插入新插件**。

---

## 8. 消灭 `_build_ctx()`：schema 驱动的 CLI

**现状**：加一个源 = 改 3 处（argparse + `_build_ctx` 80 行 if + JSON）。

**目标**：每个源插件的配置 schema **自己声明**，框架汇总后自动生成 CLI 参数与校验。

```js
// source-safebooru.js
import Schema from 'schemastery'

export const Config = Schema.object({
  tags:     Schema.string().default('art').description('标签/关键词'),
  exclude:  Schema.array(Schema.string()).default([]).description('标签黑名单'),
  rating:   Schema.union(['s', 'q', 'e']).default('s').description('分级'),
  limit:    Schema.natural().default(40).description('每页条数'),
})

export const inject = ['sources', 'downloader']
export function apply(ctx, cfg) {
  ctx.sources.register('safebooru', {
    driver: 'http', parse: 'json', pagination: 'page',
    request: { url: 'https://safebooru.org/index.php?page=dapi&s=post&q=index&pid={page}&limit={limit}' },
    ctx: cfg,                       // 本源的 schema 校验结果
  })
}
```

CLI 侧：

```js
// plugins/cli.js —— 遍历 ctx.sources 汇总 schema，自动生成
//   --source safebooru --safebooru.tags landscape --safebooru.rating s
// 并提供 --dump-config（对齐你既有 scripts/dump-config.mjs）
```

**收益**：新增源只写**一个文件**；参数校验、`--help`、`--dump-config`、GUI 表单全部自动派生。`registry.py` 的 `_build_ctx()` 与 `mj_scraper.py` 的 ~40 个 `add_argument` 一并删除。

---

## 9. 迁移路线

| 阶段 | 目标 | 产出 | 验收 |
|---|---|---|---|
| **P0 骨架** ✅ | 对齐 `@relay` 工程约定 | monorepo（`packages/*` + `apps/cli`）、移植 loader（`!!js`/行式/patch/HMR/启动审计）、`config`、`logfile` | `node apps/cli/src/index.js` 起得来；`ctx[id]` 审计通过；`--dump-config` 输出插件树 |
| **P1 服务层** ✅ | L1 六件套 | `proxy` / `http` / `curl` / `downloader` / `storage` / `settings` | 用 **picsum** 单源打通端到端下载，落盘与 Python 版一致 |
| **P2 能力注册表** ✅ | 消灭字符串分支 | `drivers` / `parsers` / `paginators` 注册表 + `driver-http` / `curl` / `parser-html` / `parser-json` / `paginator-*` | **test_sources 的 7 个可用源**全部跑通，下载数与 Python 版逐源比对一致 |
| **P3 源插件化** ✅ | 30 个源成插件 | `source-*` ×30 + schema + 自动 CLI | 全部 28 个非浏览器源可跑；`_build_ctx` 概念消失 |
| **P4 浏览器 + 视频** ✅ | 两个重点 | `driver-browser` / `driver-browser-html` / `media`（probe、postprocess-video 记为后续，见 ACCEPTANCE_P4 §5） | browser_html 端到端实测闭环（safebooru 5/5）；browser 驱动装配 + needs-proxy 降级路径验证；`disabled`/未装 Playwright 时浏览器源干净下线且**不报错、不影响其余源**；midjourney 完整链路留待代理环境回归 |
| **P5 应用层** ✅ | CLI / Web 面板 / 调度 / 重投 / 自检 | `cli` / `scheduler` / `retry` / `verify` / `web`（tkinter GUI 按决策改为 Web 面板） | `--retry-failed` 与现状等价（含链式重投）；`--verify-proxy` 等价且判定收紧为网络可达性；面板 `/`+`/api/sources`+`/api/run`+`/api/status`+`/api/logtail` 闭环 |
| **P6 门禁与交付** ✅ | 可回归 | `harness/`（不变量，node:test）+ `scripts/check.mjs`（打包记为后续，见 ACCEPTANCE_P6 §4） | `npm run check` 全绿：语法 / yml / 15 项不变量（数据守恒、事件配对、跨运行去重、Python 哈希一致）/ 装配冒烟 |

每阶段独立可验收，P1 结束时即可跑真实抓取——**不必等全部完成**。

---

## 10. 风险与对策

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| **R1** | **Cloudflare / 反爬能力平移失真**：`pixabay_*` 依赖 `fetch: "curl"` 的 TLS 指纹才能过 CF；Node 的 undici 指纹不同，可能直接被挡 | 高——现有 7 个可用源中 3 个（pixabay_*）依赖此通道 | ① 保留 `driver-curl` 作为**一等公民逃生舱**（子进程调 curl）；② P2 阶段就把 pixabay 三源纳入验收，早暴露；③ 必要时评估 `curl-impersonate` |
| R2 | Python 生态缺等价物：`moviepy` 无对等 JS 库 | 中 | 改用 ffmpeg CLI（复用 `@relay/core` 的 `ffmpeg-args.js` 约定），功能不降级 |
| R3 | Playwright 双语言行为差异（等待策略、反爬页判定） | 中 | `driver-browser` 保留现有滚动/等待参数语义；P4 用 Midjourney 源做对照 |
| R4 | socks5 代理支持差异：httpx 原生支持，undici 需 `ProxyAgent`，socks5 需额外包 | 中 | `proxy` 插件统一产出连接串，`http`/`curl` 各自适配；socks5 走 `driver-curl` 兜底 |
| R5 | `cordis@4.0.0-rc.8` 仍是 RC，核心 API 可能调整 | 中 | 版本**锁死**（与你既有仓库一致）；核心契约集中在 `@scraper/core` 少数文件，便于跟进升级 |
| R6 | 30 个源分批迁移期间双语并存，行为漂移 | 中 | Python 版冻结为基线；以「每源下载数一致性」做回归（§11） |
| R7 | 工作量：约 1290 行引擎 + 30 源 + CLI/GUI 需重构 | 高 | 分 P 交付；P1/P2 先兑现 7 个可用源的真实价值 |
| R8 | 现有 `images/`（约 13 GB 本地资产）与 `meta/` 路径迁移 | 低 | `storage` schema 显式指定 `imagesDir`/`metaDir`，默认沿用现路径 |

---

## 11. 验收标准

1. **行为等价**：Python 版已验证的 7 个可用源（`bing` / `duitang` / `giphy` / `picsum` / `pixabay_illustration` / `pixabay_vector` / `safebooru`），Cordis 版在同一参数下**获取数与下载数一致**，元数据结构兼容。
2. **失败面收窄**：禁用 `driver-browser` / `postprocess-video` 后，相关源**静默下线**，其余源零影响，且日志明确点名原因（现状靠 `EMPTY` + 手工 `try/except`）。
3. **可观测**：`--dump-config` 打印完整插件树（含 patch 来源标记）；启动审计对缺失 `ctx[id]` 点名抛错。
4. **可热更**：改 `cordis.patch.yml` 内某源配置 → 只有该源重载，正在跑的源不受影响。
5. **门禁**：`harness` 不变量（事件配对 / 数据守恒：`fetched ≥ downloaded + skipped + errors`）+ `scripts/check.mjs` 全绿。

---

## 12. 待确认

1. **运行时路线**：A（TS 全量重写，推荐）/ B（Python 自实现 Cordis 语义）/ C（Cordis 宿主 + Python sidecar）？
2. **API Key 与代理凭据**：沿用 `config.json` + 环境变量，还是改为 `ctx.settings` 分层（schema→base→用户文档，面板可编辑）？
3. **输出目录**：维持 `images/<source>/` + `meta/` 不变？（建议维持，避免与 13 GB 既有资产冲突）
4. **首个落地范围**：是否以 **P0–P2（骨架 + 服务层 + 7 个可用源）** 作为第一交付批次？
5. **GUI**：保留 tkinter 等价物，还是改为 Web 面板（你既有项目 `apps/*/public` + `web` 插件已有成熟范式）？
