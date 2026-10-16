# image-scraper · 多源图片爬虫

> 仓库：<https://gitee.com/siwpan/image-scraper> ｜ 许可：MIT（见 [LICENSE](LICENSE)）

从多个图片站统一抓取图片的命令行工具。基于 MidJourney 抓取器扩展而来，现支持 **30 个源**，统一调度、断点续传、防盗链绕过，并针对中国网络环境（GFW / 代理 / API key）做了优雅降级。

---

## 特性

- **30 个图片源**：Midjourney、Bing、Safebooru、Konachan、Wallhaven、ArtStation、Google、Pixiv、DeviantArt、Flickr、Pinterest、Unsplash、Pexels、Civitai、Lexica、Pixabay、**Giphy 动图**（完整清单见 `sources/json/`）
- **统一调度**：`--source all` 并行跑全部源，按可达性自动跳过缺 key / 被墙源
- **配置树内核**：cordis 配置树（`cordis.yml`）声明式装配服务（P7 起），改配置不动 Python
- **浏览器双模式**：默认自管 Chromium（launch）；可切换 CDP 模式接管本地 Chrome —— 复用登录态 / 真实指纹，反爬更友好（见下文「浏览器 CDP 模式」）
- **断点续传**：已下载的图片自动跳过
- **防盗链绕过**：自动发送 `Referer`；Bing 等源从原图 URL 提取
- **GFW 友好**：被墙源无代理时直接跳过（不傻等 30s 超时）
- **下载控制**：失败重试（指数退避）、请求速率限制、下载速度限制
- **失败清单 + 重投**：下载失败的 URL 自动导出 `meta/failed_<源>_<时间>.json`，可用 `--retry-failed` 一键重投（不重新 fetch）
- **总进度条**：`--source all` 并行运行时实时显示源级总进度 `总进度 [████░░] 3/15`
- **代理一键验证**：`verify_proxy.py` 一键测试全部 GFW 源能否通过代理正常访问
- **内容过滤**：booru 源支持标签黑名单（NSFW 过滤）与分级
- **可扩展**：新增一个源 ≈ 复制骨架改 30 行

---

## 安装

需要 Python 3.13+（推荐用隔离 venv，避免污染系统环境）。

```bash
# 1. 建 venv（可选但推荐）
python -m venv venv
venv\Scripts\python.exe -m pip install -r requirements.txt

# 2. 安装 Playwright 浏览器（Midjourney 源需要）
venv\Scripts\python.exe -m playwright install chromium
```

`requirements.txt`：`httpx`、`playwright`、`pyyaml`、`watchdog`（后两者为 cordis 内核依赖；vendored cordis 已随仓库携带，无需单独安装）

> 本仓库受管 venv：`.venv/Scripts/python.exe`。pip 直连若被重置，追加 `-i https://mirrors.aliyun.com/pypi/simple/` 走镜像。

---

## 用法

```bash
PY=venv/Scripts/python.exe        # 或受管 venv 的 python
$PY mj_scraper.py --source <源名> [选项]
```

> `mj_scraper.py` 为兼容 shim（等价于 `apps/cli/main.py`），历史命令行零改动。

### 常用示例

```bash
# Midjourney（Playwright 浏览器，无需登录）
$PY mj_scraper.py --source midjourney --max-images 50 --tab top

# Bing（墙内可达，无需 key）
$PY mj_scraper.py --source bing --query "cyberpunk city" --max-images 30

# Safebooru + NSFW 标签过滤
$PY mj_scraper.py --source safebooru --tags "landscape" --booru-exclude "blood,gore" --max-images 30

# Konachan（GFW，需代理）+ 分级过滤
$PY mj_scraper.py --source konachan --proxy socks5://127.0.0.1:1080 --booru-rating s

# GFW 源统一加代理跑
$PY mj_scraper.py --source pixiv --proxy socks5://127.0.0.1:1080 --query "初音ミク"
$PY mj_scraper.py --source flickr --flickr-key YOUR_KEY --proxy socks5://127.0.0.1:1080

# 全部源并行（自动跳过不可达的，实时显示源级总进度条）
$PY mj_scraper.py --source all --max-images 20

# 限流下载（保护目标站 / 自身带宽）
$PY mj_scraper.py --source all --max-images 50 --rate-limit 2 --speed-limit 500 --retries 3

# 失败后重投：把某次运行导出的失败清单再投一遍（不再重新 fetch_tasks）
$PY mj_scraper.py --retry-failed meta/failed_bing_20260707_120000.json --retries 5

# 一键验证代理能否打通所有 GFW 源
$PY verify_proxy.py --proxy socks5://127.0.0.1:1080
```

---

## 源清单（代表性节选；完整 30 个见 `sources/json/`）

| 源 | 类型 | 可达性 | 认证 | 备注 |
|---|---|---|---|---|
| midjourney | 浏览器拦截 | 墙内可达 | 无需 | Playwright 拦截 `/api/explore` |
| bing | HTML 解析 | 墙内可达 | 无需 | `murl` 提取原图 |
| safebooru | booru API | 墙内可达 | 无需 | 支持标签黑名单 |
| artstation | JSON API | 墙内通常可达 | 无需 | CG/概念艺术 |
| konachan | booru API | GFW 需代理 | 无需 | 支持分级/黑名单 |
| wallhaven | REST API | GFW 需代理 | NSFW 需 key | 壁纸 |
| google | HTML 解析 | GFW 需代理 | 无需 | 全网图片 |
| pixiv | AJAX search | GFW 需代理 | 无需 | 缩略图转 1200px master |
| deviantart | 公开 RSS | GFW 需代理 | 无需 | 免 OAuth |
| flickr | REST API | GFW 需代理 | 需 key | 注册免费 key |
| pinterest | HTML 解析 | GFW 需代理 | 无需 | 反爬严格 |
| unsplash | REST API | 墙内可达 | 需 key | 无 key 自动跳过 |
| pexels | REST API | 墙内可达 | 需 key | 无 key 自动跳过 |
| civitai | REST API | GFW 需代理 | 无需 | SD 社区 |
| lexica | POST API | GFW 需代理 | 无需 | SD 搜索 |
| pixabay | HTML 解析 | 墙内可达 | 无需 | `fetch: curl` 绕过 Cloudflare 托管质询，自动升级 `_1280` 大图 |
| giphy | HTML 提取 | 墙内可达 | 无需 | 动图站；搜索页提取 GIF ID → 详情页 related **链式扩展**（去重后单查询可达数百张，实测 "cat" 423 张）；直链 `media.giphy.com` 原图 `giphy.gif`（官方 API 被墙且需 key） |

> **GFW 提示**：Konachan / Wallhaven / Google / Pixiv / DeviantArt / Flickr / Pinterest / Civitai / Lexica 在中国被封锁，必须加 `--proxy socks5://127.0.0.1:1080`（或 http/https 代理）才能拉取。无代理时这些源会被 launcher **直接跳过**，不会卡等。

---

## 下载控制

| 参数 | 默认 | 说明 |
|---|---|---|
| `--retries N` | 3 | 单图下载失败重试次数，指数退避（上限 10s） |
| `--rate-limit N` | 0 | 请求速率上限（请求/秒），0=不限 |
| `--speed-limit N` | 0 | 下载速度上限（KB/s），0=不限 |
| `--concurrency N` | 5 | 并发下载数（信号量） |
| `--retry-failed PATH` | — | 读取失败清单 JSON，直接重投其中的 URL（不重新抓取任务） |

重试会覆盖「原图 + 格式回退」（.png/.webp/.jpg…）。限速为软限速（按分块 sleep），适合在共享网络/带宽紧张时使用。

### 失败清单与重投

每次运行若有下载失败，`Downloader` 会记录失败 URL（含 `referer` / `meta` / `source`），由 `SourceBase` 导出到：

```
meta/failed_<源名>_<时间戳>.json
```

结构：

```json
{ "source": "bing", "timestamp": "20260707_120000", "count": 3,
  "tasks": [ {"url": "...", "referer": "...", "source": "bing", "title": "...", "meta": {}} ] }
```

用 `--retry-failed` 重投时，程序会直接把清单里的 URL 交给下载器，**不再调用 `fetch_tasks`**，因此对网络/站点更友好；若重投后仍有失败，会再导出 `meta/failed_retry_<源>_<时间戳>.json`，可继续链式重投。

---

## NSFW / 内容过滤（booru 源）

Safebooru 本身即 SFW，但仍支持标签黑名单过滤不想要的内容；Konachan 支持分级 + 黑名单。

```bash
# 黑名单（逗号分隔，内部转成 -tag 查询）
--booru-exclude "blood,gore,nude"

# Konachan 分级：s=安全(默认) / q=可疑 / e=成人
--booru-rating s
```

---

## 中国网络注意事项

- **防盗链**：很多 CDN（zcool 等）即使带正确 Referer 也返回 403，属站点硬限制，会记为失败并继续，不视为 bug。
- **死链正常**：Bing 索引全网，部分主机已关停（如 `pic.uuhy.com` DNS 失败），属预期失败。
- **代理格式**：`socks5://127.0.0.1:1080`、`http://127.0.0.1:7890` 均可。
- **Cloudflare 托管质询**：部分源（如 **Pixabay**）对 Python httpx 客户端下发 "Just a moment..." 质询（按 TLS/JA3 指纹拦截），但 `curl` 的 TLS 指纹可直接通过。这类源在 JSON 配置里设 `"fetch": "curl"`，引擎会用 `curl` 子进程拉取搜索页（其余解析/下载仍走 httpx）。要求运行环境 PATH 中可用 `curl`（Git Bash / 多数系统自带）。

### 一键验证代理（verify_proxy.py）

不确定代理能否打通所有被墙源？用这个脚本一键测试，无需完整下载：

```bash
$PY verify_proxy.py --proxy socks5://127.0.0.1:1080
$PY verify_proxy.py --proxy http://127.0.0.1:7890 --timeout 30
$PY verify_proxy.py --proxy socks5://127.0.0.1:1080 --no-baseline   # 跳过无代理对照
```

原理：为每个 GFW 源（`needs_proxy=True`）构造实例并调用 `fetch_tasks(max_images=3)`（只抓任务 URL，不下载图片），用超时包裹判定可达性。

- `OK`：成功拿到任务 → 代理通。
- `EMPTY`：代理通但源返回空 → 多为缺 key（如 Flickr）。
- `TIMEOUT` / `FAIL`：代理无效或源不可达。
- 默认还会跑「无代理对照」，确认这些源在无代理时确实被墙（证明代理生效）。

---

### 通用网络抓包探针（probe_capture.py）

通用 **Playwright+Edge 无头抓包探针**：加载任意目标页并捕获其真实网络请求
（媒体流 / API / 签名参数），静态 JS 分析解不开时的决定性手段。浏览器用系统
Edge（自动发现 msedge.exe），无需 `playwright install` 下载内核。首次实战于
real-url 直播平台逆向（六间房 / 央视频 / 抖音三条线的拉流证据均由同款方法抓到）。

```bash
$PY probe_capture.py <url> [选项]

# 抓直播房间页媒体/接口请求，观测 15s
$PY probe_capture.py https://v.6.cn/1111520

# 移动端 UA + 点击播放器触发播放（不自动播的站点）
$PY probe_capture.py "https://m.yangshipin.cn/tv?vid=2024078201&pid=600001859" --ua mobile --click 195,300

# 自定义过滤 + 全量不过滤
$PY probe_capture.py <url> --filter "m3u8|flv|webcast" --wait 20 --out out.json
$PY probe_capture.py <url> --all
```

常用参数：`--ua desktop|mobile`、`--wait N`、`--click X,Y`（可多次）、
`--js "EXPR"`（执行页面内 JS，播放器触发常用）、`--filter REGEX`、`--out PATH`、
`--headed`、`--browser edge|chromium`。
Edge 不在默认路径时用环境变量 `PROBE_EDGE=<msedge.exe>` 指定。默认启用
`--autoplay-policy=no-user-gesture-required`（放行无手势自动播放）。
输出 JSON：`{meta:{...}, captures:[{type,method,status,url,body}]}`
（`body` 为命中响应前 4KB；输出文件不入库，见 .gitignore）。

> 与图片源无关的独立通用工具，与 `verify_proxy.py` 一样位于项目顶层、不参与源调度。

---

## GUI 版（已移除）

内核重构（cordis）后 `gui_scraper.py`（tkinter 界面，681 行）已移除 —— 调度能力由 CLI 完整提供（`--source all` 实时总进度条 + 结果总览表）。如需图形界面，可基于 `apps/cli/main.py` 的 `run_source` 二次开发。

---

## 内核（cordis 配置树）

抓取能力（配置 / 代理 / 源注册 / 下载 / 元数据 / 浏览器 / 引擎）拆为 `services/` 下的 cordis 服务，装配清单是 `cordis.yml` —— 增删服务、改行为参数（并发、重试、代理候选……）**改 yml 即可**。应用入口 `apps/cli/main.py` 与验收脚本走同一挂载路径（`host/tree.py`；entry name 有白名单，防「改 yml = 执行代码」）。

```bash
$PY selftest.py                     # 离线单测 + 服务级挂载验收（七服务就绪 / 身份一致 / 回滚）
$PY scripts/mount_check.py          # 配置传递断言 + dispose 回滚断言
$PY scripts/p7_check.py             # P7 总验收（对 P0 黄金轨迹；--replay 完整重放）
```

### 浏览器 CDP 模式（接管本地 Chrome）

默认 launch 模式由 Playwright 自管 Chromium。需要**复用登录态 / 真实浏览器指纹**（反爬更友好）时，切换 CDP 模式接管本地 Chrome：

```bash
# 1. 启动一个带调试端口的专用 Chrome（勿用日常默认 profile！）
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="C:\chrome_profiles\image_scraper"
  # 如需代理：追加 --proxy-server="socks5://127.0.0.1:1080"

# 2. 验证：浏览器打开 http://127.0.0.1:9222/json/version 能看到 webSocketDebuggerUrl

# 3. 打开 cordis.yml 中的开关（browser.cdp.enabled: true，url 默认 9222），完工
```

> 说明：CDP 下复用 Chrome 的默认上下文（登录态 / 真实 UA，不再注入伪装脚本）；**代理必须写在 Chrome 启动参数**（context 级代理在 CDP 下不生效）；清理时只关本次打开的页面，**不会关掉你的 Chrome**。

---

## 项目结构

```
image-scraper/
├── mj_scraper.py          # 兼容 shim → apps/cli/main.py（历史命令行零改动）
├── apps/
│   ├── cli/main.py        # 统一 CLI（argparse 契约与旧版逐字节一致）
│   └── video/main.py      # 视频源入口（与 CLI 共享同一 run_source）
├── cordis.yml             # 服务装配清单（配置树：声明即挂载）
├── host/tree.py           # 配置树引导（唯一挂载路径，entry 白名单）
├── services/              # cordis 服务（内核）
│   ├── config.py          #   持久配置 + 代理探测
│   ├── proxy.py           #   免费代理拉取（zdaye）
│   ├── source_registry.py #   源注册 / _build_ctx 翻译层
│   ├── downloader.py      #   异步下载器（文件名规则 / 跳过 / 格式回退）
│   ├── meta_store.py      #   运行元数据 / 失败清单落盘
│   ├── browser.py         #   浏览器会话（launch / CDP 双模式）
│   └── engine.py          #   JsonSource 统一引擎（http / curl / browser 多路径）
├── sources/
│   ├── json/              # 各源配置（30 源；新增源 = 加一份 JSON）
│   ├── base.py            # facade → services（兼容层）
│   ├── engine.py          # facade → services.engine
│   └── registry.py        # facade → services.source_registry
├── vendor/cordis/         # cordis-py v4.0.0（vendored；VENDOR.md + cordis.lock 记账）
├── scripts/               # headless 验收（mount_check / p2 ~ p7_check）
├── images/<源名>/         # 下载图片落盘
└── meta/                  # 每次运行的元数据 JSON
```

---

## 新增一个源（JSON 配置驱动）

主体源已统一为 JSON 配置驱动，新增源**无需写 Python**：

1. 复制 `sources/json/` 下相近源的配置，改端点 / 分页 / 解析规则（`url_extract` / `block_extract` / `item` transform）。
2. 注册表自动扫描收录（`services/source_registry.py`）；如该源需要专属 CLI 参数，在 `apps/cli/main.py` 加参数、在 `services/source_registry.py` 的 `_build_ctx` 补翻译。
3. 测试：`$PY mj_scraper.py --source <新源> --max-images 6`（GFW 源加 `--proxy`）。

> 需要特殊抓取逻辑的源（登录态 / 特殊签名）仍可写成 `SourceBase` 子类；四路径分类（http / curl / browser-html / browser-api）见 `scripts/p5_path_matrix.json`。

更完整的架构说明见配套 skill：`multi-source-image-scraper`（用户级，含 `references/source_apis.md` 与各源端点文档、`scripts/new_source_template.py` 骨架）。

> 资产目录标注（2026-08-24）：`images/`（各源下载落盘，约 13GB）、`duitang/ pixabay/ midjourney/ midjourney_video/`（早期按源输出目录）为下载输出，本地保留、不进版本库（见 .gitignore）；`meta/` 为运行元数据（含失败清单，重投依赖，勿删）。
