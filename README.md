# image-scraper · 多源图片爬虫

从多个图片站统一抓取图片的命令行工具。基于 MidJourney 抓取器扩展而来，现支持 **16 个源**，统一调度、断点续传、防盗链绕过，并针对中国网络环境（GFW / 代理 / API key）做了优雅降级。

---

## 特性

- **16 个图片源**：Midjourney、Bing、Safebooru、Konachan、Wallhaven、ArtStation、Google、Pixiv、DeviantArt、Flickr、Pinterest、Unsplash、Pexels、Civitai、Lexica、**Pixabay**
- **统一调度**：`--source all` 并行跑全部源，按可达性自动跳过缺 key / 被墙源
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

`requirements.txt`：`playwright>=1.45.0`、`httpx>=0.27.0`

> 本项目自带的受管 venv 已配好：`C:\Users\13122\.workbuddy\binaries\python\envs\default\Scripts\python.exe`

---

## 用法

```bash
PY=venv/Scripts/python.exe        # 或受管 venv 的 python
$PY mj_scraper.py --source <源名> [选项]
```

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

## 源清单（16 个）

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

## GUI 版（tkinter）

除命令行外，本项目附带图形界面 `gui_scraper.py`，直接复用 `mj_scraper.py` 的调度逻辑与 `sources.base` 的下载/元数据基础设施。

```bash
$PY gui_scraper.py
```

功能：

- **源选择**：下拉框选单个源或 `all`（顺序运行全部可达源）。
- **通用设置**：每源最大数、并发、代理、重试、请求/速度限速。
- **源专属设置**：选源后自动显示该源对应参数（如 Bing 翻页数、Konachan 分级、各 API Key 等）。
- **实时日志**：复用 `sources.base` 的 `log`，流式显示抓取/下载过程。
- **结果汇总表**：每个源的获取/下载/跳过/失败/耗时。
- **失败清单重投**：按钮选择 `meta/failed_*.json` 一键重投（不再重新 fetch）。
- **打开图片目录**：直接打开 `images/` 输出文件夹。

> GUI 在独立线程中跑 asyncio 事件循环，日志通过线程安全队列回传主线程，不卡界面。`all` 模式为顺序执行（便于「停止」即时生效）。

---

## 项目结构

```
image-scraper/
├── mj_scraper.py          # 统一启动器（调度全部源）
├── mj_discover.py         # Midjourney API 发现工具
├── verify_proxy.py        # GFW 源代理一键验证脚本
├── requirements.txt
├── sources/
│   ├── base.py            # SourceBase / ImageTask / Downloader（核心基础设施）
│   ├── engine.py          # JsonSource 统一引擎（JSON 配置驱动；支持 fetch:curl 绕过 CF）
│   ├── registry.py        # 扫描 sources/json/*.json 自动注册 ALL_SOURCES / build_source
│   ├── json/              # 各源配置（新增源 = 加一份 JSON，pixabay.json 即其一）
│   ├── midjourney.py      # Playwright 浏览器源
│   ├── bing.py            # Bing HTML 解析
│   ├── booru.py           # Safebooru + Konachan（共用 BooruSource）
│   ├── wallhaven.py
│   ├── artstation.py
│   ├── google.py
│   ├── pixiv.py
│   ├── deviantart.py      # 公开 RSS
│   ├── flickr.py          # 需 key
│   ├── pinterest.py       # HTML 解析
│   ├── unsplash.py        # 需 key
│   ├── pexels.py          # 需 key
│   ├── civitai.py
│   └── lexica.py
├── images/<源名>/         # 下载图片落盘
└── meta/                  # 每次运行的元数据 JSON
```

---

## 新增一个源（约 30 行）

1. 复制 `sources/` 下相近的源作模板，或参考各源实现。
2. 子类化 `SourceBase`，设置 `name` / `needs_browser` / `needs_proxy`，实现 `async fetch_tasks(self, max_images) -> list[ImageTask]`。
3. 每个 `ImageTask` 务必设 `referer`（站点源站）以绕防盗链。
4. 在 `mj_scraper.py` 的 `build_source()` 加分支、`ALL_SOURCES` 加名字、按需加 CLI 参数。
5. 测试：`$PY mj_scraper.py --source <新源> --max-images 6`（GFW 源加 `--proxy`）。

更完整的架构说明见配套 skill：`multi-source-image-scraper`（用户级，含 `references/source_apis.md` 与各源端点文档、`scripts/new_source_template.py` 骨架）。

> 资产目录标注（2026-08-24）：`images/`（各源下载落盘，约 13GB）、`duitang/ pixabay/ midjourney/ midjourney_video/`（早期按源输出目录）为下载输出，本地保留、不进版本库（见 .gitignore）；`meta/` 为运行元数据（含失败清单，重投依赖，勿删）。
