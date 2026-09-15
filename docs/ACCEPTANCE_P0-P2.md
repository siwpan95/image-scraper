# image-scraper × Cordis —— P0–P2 验收报告

> 日期：2026-09-15 · 运行环境：Windows · Node 22.22.2（managed）· cordis@4.0.0-rc.8
> 交付范围：P0 骨架 + P1 服务层 + P2 能力注册表与 7 个可用源（规划见 ROADMAP_CORDIS.md §9）
> 日志为准：`data/logs/scraper.log`（下文时间戳为本地时间 GMT+8，对应日志内 UTC）

---

## 1. 结论

**验收通过。** 30 行插件树装配成功、启动审计通过、7/7 源端到端可用、
级联下线可观测、跨实现去重命中、两个移植 bug 已修复并有回归覆盖。

| 验收点（ROADMAP §9 P0–P2） | 结果 |
|---|---|
| monorepo + loader（`!!js`/行式/patch/审计） | ✅ 30 插件树，`--dump-config` 正常 |
| P1 服务层端到端（picsum 落盘与 Python 版一致） | ✅ 文件名 md5 规则一致，跨实现去重命中 |
| P2 七源跑通、与 Python 版逐源可比 | ✅ 7/7（详见 §3） |
| 失败面收窄：能力下线不影响其余源 | ✅ 禁用 driver-curl → pixabay 系点名下线（§4） |

## 2. 装配与自检

- `node src/index.js --dump-config`：30 行插件树全量打印（来源 base/patch、module、config）。
- `--list-sources`：列出 7 源，exit 0。
- 启动审计：每个 id 均注册同名 Service；此前 8 个「未注册同名服务」的插件
  （parser-json/parser-html/paginator-*×4/driver-http/driver-curl）已按 cordis v4
  静态 `inject` 约定修正后全部通过。
- 常驻句柄排查：默认 `watch:false`（fs.watch 阻止退出的坑已消除，`SCRAPER_WATCH=1` 显式开启）。

## 3. 七源端到端结果

最终全量验收（`--source all --max-images 5`）两轮独立运行 + 单源重试：

| 源 | 第 1 轮 09:55 | 第 2 轮 09:57 | 单源重试 09:59 | 说明 |
|---|---|---|---|---|
| bing | 获取5 下载4 失败1 · 17.7s | 获取5 **跳过4** 失败1 · 16.6s | — | 见 §3.1/§3.2 |
| duitang | 获取5 跳过5 · 0.5s | 获取5 跳过5 · 0.4s | — | 中文关键词链路早前已 5/5 实下载 |
| giphy | 获取5 跳过5 · 2.1s | 获取5 跳过5 · 2.2s | — | 二级详情链早前已 5/5 实下载 |
| picsum | 获取5 跳过5 · 1.0s | 获取5 跳过5 · 0.9s | — | 跳过=命中 Python 版已下载文件 |
| pixabay_illustration | **获取0（HTTP 403）** | **获取0（HTTP 403）** | **获取3 跳过3 · 0.8s** | 见 §3.3 |
| pixabay_vector | 获取5 跳过5 · 2.0s | 获取5 跳过5 · 0.8s | — | curl 通道正常 |
| safebooru | 获取5 跳过5 · 1.1s | 获取5 跳过5 · 0.9s | — | tags=art rating=s |

两轮均 `EXIT=0`，总耗时 17.8s / 16.6s。「跳过」为既有文件去重命中
（本机 `images/` 内各源已有当日早前实下载产物：bing 18、duitang 15、giphy 15、
picsum 10、pixabay_illustration 10、pixabay_vector 10、safebooru 10 个文件）。

### 3.1 跨运行/跨实现去重（硬证据）

- 第 1 轮 bing 实下载 4 个新文件：`bing_4d8b05f4186f.png`、`bing_4f03a97fd56b.png`、
  `bing_8b83f828f800.jpeg`、`bing_a8355b16e4d4.jpg`（`<source>_<md5(url)[:12]>` 命名与 Python 版一致）；
- 第 2 轮同参数运行，同 5 个任务 → 这 4 个文件全部识别为已存在并跳过，未重复下载。

### 3.2 失败清单机制

bing 有 1 个第三方源站死链
（`http://www.mysecretrainbow.com/wp-content/uploads/2022/11/1667392563.jpg`，
bing 搜索结果指向的外站，非实现问题）被正确记录到
`meta/failed_bing_20260915_095728.json`（含 referer/title，可重投）。

### 3.3 pixabay_illustration 的两次 403 与恢复

09:55/09:57 两轮全量运行中该源对
`https://pixabay.com/zh/illustrations/search/art/?pagi=1` 收到 CF 403；
约 2 分钟后单源重试（09:59）恢复，获取 3/3。同通道的 pixabay_vector 两轮均正常，
说明 curl 通道本身无恙——**定性为站点侧间歇限流（当日多轮测试触发），
非架构或移植缺陷**。Python 版在同场景下同样会遇到（这正是 `fetch: curl` 存在的原因）。

## 4. 级联下线验证（cordis 价值实证）

临时 `cordis.patch.yml`：

```yaml
- id: driver-curl
  disabled: true
```

运行结果：插件数 30→29，日志明确点名：

```
[info] image-scraper (Node.js + Cordis) started · 插件数=29
[info]   pixabay_illustration     driver-unavailable:curl
[info]   picsum                   获取 3 | 下载 0 | 跳过 3 | 失败 0 | 1.1s
```

依赖 curl 的 pixabay 系源静默下线且原因可观测，picsum 等 HTTP 源零影响。
验证后 patch 文件已删除。

## 5. 实施中发现并修复的移植 bug

| # | Bug | 根因 | 修复 |
|---|---|---|---|
| 1 | duitang 中文关键词抛 `URIError: URI malformed` | `pyQuote` 用 `encodeURIComponent` 分段 decode，把中文 UTF-8 多字节序列拆成非法半截 `%XX` | 重写为**字节级** percent-encoding：按 `Buffer.from(s,'utf8')` 逐字节判定 unreserved/safe，语义与 `urllib.parse.quote(safe='/')` 完全对齐 |
| 2 | giphy 获取 0 | 源的 `host.buildTasks` 为 async（含二级详情抓取），4 个分页器未 `await`，主流程提前返回 | 分页器统一补 `await` |

另修复/澄清两处装配问题：`module: './src/plugins/scheduler.js'` 双重拼接
（loader 以 pluginsDir 为基准，应为 `'./scheduler.js'`）；
cordis v4 要求 `ctx.X` 访问必须在静态 `inject` 数组声明（见 §2 启动审计）。

## 6. 与 Python 版的行为对齐清单

- 文件名 `<source>_<md5(url)[:12]><ext>`、扩展名回退：一致（§3.1 实证）；
- `re.findall` 单捕获组返回组内容（giphy 依赖）、`re.sub` repl `\1`→`$1` 转换：已在 engine 纯函数层对齐；
- meta / failed 清单 JSON 结构：字段兼容（§3.2）；
- 输出目录维持 `images/<source>/` + `meta/`，13 GB 存量资产原位复用；
- 代理：undici ProxyAgent（http/https）+ curl 通道兜底（socks5）。

## 7. 已知限制与后续（P3–P6）

- 其余 23 个源未迁移（P3）；浏览器驱动/视频后处理未迁移（P4，`media` 服务已就位）；
- Web 面板未开始（P5，GUI 决策已定：Web 面板）；
- `harness/` 不变量门禁与 `scripts/check.mjs` 未建（P6；当前以日志断言
  `fetched ≥ downloaded + skipped + errors` 人工核对通过）；
- pixabay 站点限流期间单源可能 403，重试即恢复（§3.3）。

## 8. 验收命令复现

```bash
cd C:\image-scraper\apps\cli
node src\index.js --dump-config
node src\index.js --list-sources
node src\index.js --source all --max-images 5        # 两轮
node src\index.js --source pixabay_illustration --max-images 3   # 单源重试
# 级联：临时写 cordis.patch.yml 禁用 driver-curl 后重复上一条
```
