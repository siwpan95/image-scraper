# P5 验收报告：应用层（retry / verify-proxy / Web 面板）

> 日期：2026-09-15 ｜ 分支：`2.0` ｜ 基线：P4（ea23c8e）

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `packages/core/src/sources.js` | 新增 `retryFailed(file, o)` 与 `verifyProxy(proxy, o)` |
| `packages/core/src/web.js` | Web 面板（ctx.web）：node:http 零依赖，`GET /` 单页面板 + `/api/sources` + `POST /api/run` + `/api/status` + `/api/logtail`；单实例互斥（运行中 409）；`ctx.effect` 可逆关闭 |
| `packages/core/src/logfile.js` | 新增 `tail(n)`（供面板 logtail） |
| `apps/cli/src/plugins/web.js` + `cordis.yml` | 薄转发 + 注册（`web.config.port: 8642`，共 56 插件） |
| `apps/cli/src/plugins/cli.js` | `--retry-failed` / `--verify-proxy` / `--serve`；**统一收尾提升到 ready 层**：所有一次性分支（help/dump/retry/verify/run）完成后 `ctx.emit('dispose')` + `process.exit(exitCode)`，`main()` 返回 `true` 表示长驻不退出 |

## 2. 实测记录

| # | 命令 / 操作 | 结果 |
|---|---|---|
| 1 | `--help` | EXIT=0，进程正常退出（web server 装配后一次性路径仍能干净退出） |
| 2 | `--retry-failed meta/failed_webpage_20260915_104542.json` | EXIT=0；「重投模式 \| 清单 \| 源=webpage \| 任务 3」→ 13.3s 重投完成（bing 签名 URL 仍拒，符合预期）→ **链式导出 `meta/failed_retry_webpage_*.json`** 可继续重投；不再重新 fetch |
| 3 | `--verify-proxy socks5://127.0.0.1:9999 --timeout 6` | 无效代理：7 个 http 通道 GFW 源全部 FAIL（fetch failed），8 个浏览器源 SKIP，结论 0/15 → **EXIT=1**（代理无效语义） |
| 4 | `--serve`（后台）+ 端点冒烟 | `GET /` 200（5461B 单页面板）；`/api/sources` 30 源含 driver/needs_proxy 标签；`POST /api/run {sources:[picsum], maxImages:2}` → fetched 2 / skipped 2（跨运行去重）/ errors 0；`/api/status` 批次增量汇报；`/api/logtail` 80 行实时日志 |

## 3. 设计要点与对齐说明

- **retryFailed**（对齐 Python `mj_scraper.retry_failed`）：读 `{source, tasks:[{url,referer,...}]}` → 空任务过滤 → 直接 `downloader.session(srcName).downloadBatch`（**不重新 fetch_tasks**，对站点友好）→ `writeMeta`；仍失败导出 `failed_retry_<源>_<ts>.json` 支持链式重投。
- **verifyProxy**（对齐 Python `verify_proxy.py`，判定更精确）：不复用抓取管线（http 驱动会把网络失败吞成空列表，导致被墙源误判 EMPTY），改为用源自身的 `request.url/params/headers`（subst 模板展开）经代理发一次轻量请求：**OK**=HTTP 200、**REACH**=非 200（代理通、站点拒绝：缺 key/反爬）、**TIMEOUT/FAIL**=代理无效、**SKIP**=浏览器源（驱动只提供 `runSource` 全流程入口）或 curl 通道源。`okCount===0` 时 CLI exit 1。
- **Web 面板**：取代 Python tkinter GUI（用户拍板）。面板含源清单（勾选 + needs_proxy/driver 标签）、参数区（max-images/query/pages/proxy/concurrency）、运行按钮、结果表、实时日志尾部；轮询 2s。批次运行用 `Promise.all` 逐源增量写入 results（与 scheduler.runMany 同语义）。
- **退出模型重构**：web server 会撑住事件循环，一次性模式若不显式退出进程将挂住。统一收尾放 ready 层：`main().then(serve => { if (serve) return; ctx.emit('dispose'); setTimeout(() => process.exit(process.exitCode || 0), 500) })`——这同时是对 P4 退出码修复的推广（不再是 runMany 分支专属）。

## 4. 限制与后续项

- 面板端口写死在 `cordis.yml` 的 `web.config.port`（CLI 不提供 `--port` 覆盖，保持「yml 是配置权威」范式）。
- `/api/run` 未做鉴权（绑定 `127.0.0.1`，本机使用定位）；后续如需远程访问再加 token。
- verify-proxy 的 REACH 判定（非 200 也算代理通）与 Python 版的 EMPTY/异常语义有差异，属有意收紧——文档见上。

## 5. 结论

P5 通过。`--retry-failed` 与 Python 版等价（含链式重投）；`--verify-proxy` 等价且判定更准；Web 面板端到端可用（清单/运行/状态/日志闭环）。
