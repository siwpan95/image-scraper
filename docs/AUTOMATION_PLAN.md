# 每小时自动爬取方案

> 日期：2026-09-15 ｜ 适用：`2.0` 分支（P6 完成态，56 插件 / 30 源）｜ 已实测基线：`--source all --max-images 3` EXIT=0、16.6s

## 1. 目标

以 WorkBuddy 自动化（recurring，`FREQ=HOURLY;INTERVAL=1`）每小时执行一轮全源爬取，产出简报。
无代理环境下的预期行为（已实测验证）：

| 分组 | 源 | 行为 |
|---|---|---|
| 稳定产出（14） | bing · duitang · giphy · pexels · picsum · pixabay · pixabay_illustration · pixabay_vector · safebooru · surfcg | 每轮获取 max 张，下载/去重正常 |
| 空跑但无害（4） | photo · webpage · pixabay_video · pixabay_music | 获取 0（无 url 参数/为 0 属预期），EXIT 不受影响 |
| 优雅跳过（16） | artstation · civitai · deviantart · flickr · google · konachan · lexica · midjourney×4 · pinterest · pixiv · reddit · wallhaven | `needs-proxy` 点名跳过（0s，不拉浏览器） |
| 需 key（1） | unsplash | `data/settings.json` 配 key 后可用；无 key 时 401 → 获取 0 |

## 2. 自动化定义（已创建）

- **名称**：`image-scraper-hourly-crawl`
- **频率**：每小时整点（`FREQ=HOURLY;INTERVAL=1`）
- **工作目录**：`C:\image-scraper`
- **Prompt 要点**（全文见自动化定义）：
  1. 用固定 node 路径 `C:\Users\psw\.workbuddy\binaries\node\versions\22.22.2-3\node.exe` 跑 `apps\cli\src\index.js --source all --max-images 5`；
  2. **不依赖 stdout**（工具层会吞）：跑完 `Get-Content data\logs\scraper.log -Tail 120 | Out-File` 后读取，从「总览:」段提取每源统计；
  3. 输出简报：产出源逐行 `获取/下载/跳过/失败`；needs-proxy 与空跑源合并一句；失败清单文件名点名；统计 `images/` 累计文件数；
  4. 整轮失败不重跑，点名错误即可（避免雪崩式重试）。

## 3. 参数选择依据

- **`--max-images 5`**：30 源理论上限 150 张/轮，实际产出源 14 个 → ~70 张/轮上限；跨轮 md5 去重后净增量自然衰减（首日爬存量、之后爬增量）。可按需在 cordis.yml 或自动化 prompt 调整。
- **不用 `--source all` 以外的列表**：needs-proxy/driver-unavailable 均为优雅跳过，维护成本最低；有代理环境后 GFW 源自动参与，无需改自动化。
- **并发与限速**：沿用 config 默认（concurrency 5 / retries 3）；pixabay 系走 curl 通道过 CF，已实测稳定（间歇 403 属站点限流，重试后恢复）。

## 4. 运维

| 操作 | 方式 |
|---|---|
| 调整频率/暂停 | 在 WorkBuddy 自动化列表修改 `image-scraper-hourly-crawl` |
| 排除某源 | `apps/cli/cordis.patch.yml` 对应 `source-*` 行 `disabled: true`（不入库，热生效于下轮） |
| 失败 URL 重投 | `node apps/cli/src/index.js --retry-failed meta/failed_<源>_<ts>.json`（可链式） |
| 代理接入后 | GFW 16 源自动生效；建议先跑 `--verify-proxy socks5://...` 验证 |
| 新源接入 | 见 `NEW_SOURCES_RESEARCH.md`；加入 cordis.yml 即自动进入 `--source all` 范围 |

## 5. 已知常态现象（非故障）

- `bing` 源每轮可能 1 个第三方死链 → 进 `meta/failed_bing_*.json`（用 `--retry-failed` 重投）。
- `pixabay_*` 系间歇性 CF 403（约数分钟自愈），下一轮自动恢复。
- `photo`/`webpage` 无 `--url` 参数时空跑（获取 0）；它们的设计用途是手动指定页面爬取。
- 每轮日志位于 `data/logs/scraper.log`（2MB 自动轮转），元数据在 `meta/<源>_<ts>.json`。
