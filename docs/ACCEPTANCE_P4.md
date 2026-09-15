# P4 验收报告：浏览器驱动（driver-browser / driver-browser-html）

> 日期：2026-09-15 ｜ 分支：`2.0` ｜ 基线：P3（66a0e69）

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `packages/core/src/driver-browser-html.js` | 移植 Python `_run_browser_html`（L892–1088）：page 分页 → goto → antibot 轮询（30×2s，markers 表）→ 滚动加载 → html 解析 → 任务构建 → 下载。导出 `sleep / isAntibotPage / contextArgs / LAUNCH_ARGS / playwrightAvailable / loadPlaywright / runSource` |
| `packages/core/src/driver-browser.js` | 移植 Python `_run_browser`（L706–1268）：`collectJobs`（一层包装下探）、`buildBrowserTasks`（直链优先/CDN 模板/`mj_index` 变体）、CF challenge 轮询（15×4s，每 3 轮 reload）、`BROWSER_FETCH_JS`（页内 fetch → base64，md5 文件名 + `media.extOf/fallbacks`）、`storage.write`、并发闸（默认 5） |
| `packages/core/src/sources.js` | `run()` 按传输类型分流：`browser` / `browser_html` → `driver.runSource()`，回写 `stats` + `writeMeta/writeFailed` |
| `apps/cli/cordis.yml` | 新增 `driver-browser` / `driver-browser-html` 两行（55 插件）；注释注明 Playwright 未安装时不注册 |
| `apps/cli/src/plugins/cli.js` | **修复退出路径**（见 §4.3） |

## 2. 可选依赖机制

Playwright 为**可选依赖**：驱动构造时 `createRequire(import.meta.url).resolve('playwright')` 探测，未安装则不注册，挂载的浏览器源以 `driver-unavailable:<transport>` 点名下线（P3 已实证该路径：`photo` / `webpage` 下线且不影响其余 28 源）。本机 `npm i playwright` + `npx playwright install chromium` 完成（pw_exit=0）后，两驱动注册成功（插件数 53 → 55）。

## 3. 实测记录（无代理环境）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `--source webpage --url https://cn.bing.com` | 全流程通：goto → antibot 通过 → 滚动 20 次 → 解析 13 候选 → 2 任务。下载 0/2——失败 URL 为 `cn.bing.com/rp/*.png` 站点签名皮肤资源，**防盗链，非缺陷** |
| 2 | `--source webpage --url 'https://cn.bing.com/images/search?q=cat'` | 1506 候选 → 3 任务 → 0/3。失败 URL 全为 bing UI 图标（`/rp/*.png`、`/sa/simg/Flag_Feedback.png`）——bing 图片页真图 URL 藏在 `m` 属性 JSON 中，`<img>` 是懒加载占位，**该站不适合做下载验证样本** |
| 3 | `--source webpage --url 'https://safebooru.org/index.php?page=post&s=list' --max-images 5` | **43 候选 → 5 任务 → 下载 5/5、失败 0**（31.5s），md5 文件名落盘，元数据 5 imgs |
| 4 | 同上复测 `--max-images 3` | 获取 3 \| 下载 0 \| **跳过 3** \| 失败 0——跨运行去重生效；EXIT=0 |
| 5 | `--source midjourney,midjourney_video` | 两源 `[warn] 跳过：GFW 封锁，需 --proxy`，总览标 `needs-proxy`，**未启动浏览器**（0.0s）；EXIT=1（全失败的正确语义） |

## 4. 发现并修复的问题

### 4.1 bing 签名资源下载失败 → 定性非缺陷
失败 URL 均为站点侧签名/防盗链资源。downloader 行为正确（重试后进 `failed_*.json`）。换 safebooru 直链页后同一下载链路 5/5 成功，排除 downloader 问题。

### 4.2 `driver-browser-html.js` 缺导出
`const sleep` 未导出导致 `driver-browser.js` 装配报 `SyntaxError: does not provide an export named 'sleep'` → 改 `export const sleep`，复验通过。

### 4.3 CLI 退出码被 Playwright 残留句柄污染（本轮主修复）
**现象**：browser_html 任务完整完成后（日志含总览与总耗时）进程退出码为 1，日志无 `unhandledRejection` 记录。
**根因**：`main()` 完成后无主动退出路径——`ctx.emit('dispose')` 只挂在 SIGINT/SIGTERM；单例 Chromium 存活，父进程事件循环清空前后其连接断开触发内部 promise rejection，走 fail-loud 分支 `process.exit(1)`，错误信息经 `console.error` 落到被沙箱吞噬的 stderr。
**修复**（`apps/cli/src/plugins/cli.js`）：runMany 路径打印总览后主动 `ctx.emit('dispose')`（关闭浏览器）+ `setTimeout(process.exit(code), 500)`，`code` 保留「全部失败 → 1」语义。复测 EXIT=0。

## 5. 限制与后续项

- **driver-browser 完整链路（midjourney）**：需代理环境实测（CF challenge → 页内 fetch 下载）。装配、needs-proxy 跳过、不误启浏览器已验证；核心子流程（`collectJobs`/`buildBrowserTasks`/`BROWSER_FETCH_JS`）与 Python 逐段对照移植。
- **probe**：ROADMAP 标注可选（Python 版仅探测场景用），本轮跳过。
- **postprocess-video**：ffmpeg 集成记为后续——Python 基线中该功能亦未实际启用（无 moviepy 运行证据），不阻塞 P4 验收；视频源（pixabay_video / midjourney_video×2）的**采集侧**已就绪（`media:'video'` 注册 + 下载落盘走同一任务管线）。

## 6. 结论

P4 通过。browser_html 通道端到端（含下载、去重、退出码）实测闭环；browser 通道装配与降级路径验证通过，完整链路留待有代理环境回归。
