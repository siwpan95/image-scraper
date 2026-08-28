---
name: image-scraper
description: Maintain image-scraper (G:\repos\image-scraper). A 模式（进程内插件）样板：JSON 驱动源注册表 + 宿主横切。
agent_created: true
---

# image-scraper（A 模式样板 · 爬虫插件化参考实现）

## 定位

**进程内插件化的参考样板**：一个源 = 一个 JSON 配置（+ 可选少量代码）；宿主（engine + Downloader）统一承担限速/重试/断点续传/防盗链/进度——源只管「发现 URL → 交给宿主下载」。

## 架构三件套（新增源的照抄流程）

1. **`sources/json/<name>.json`**（组合即数据，新增源 ≈ 复制骨架改 30 行）：
   - `request`：method/url/headers/params + `pagination`（type: page/none/cursor；start/step/per_page/stop_path）
   - `parse`：format（html/json）+ html 的 `url_extract.patterns`（正则提取）+ `url_transform`（如 `//` → `https://`）
   - `item`：url/title/referer 的 path（JSON 时）/const（模板变量 {query}/{url}/{page_origin}）/+ `filter: {is_image: true}`
   - 模板变量由 `registry._build_ctx` 注入：query/max_images/pages/tags/key/{name}_mode/{name}_sorting 等
2. **`sources/registry.py`**：扫描 json 目录 → `ALL_SOURCES` + `build_source(name, args, keys)`（argparse.Namespace 兼容，GUI/CLI/测试共用）
3. **`sources/base.py`**：`ImageTask`（数据契约）/`SourceStats`/`Downloader`（宿主横切：并发、速率限制、指数退避重试、断点续传、Referer 防盗链）/`SourceBase`（接口基类）
4. **`sources/engine.py`**：`JsonSource` 模板引擎 + 统一调度（`--source all` 并行、不可达跳过、源级总进度、失败清单重投）

## 已并入源族的外部项目（谱系记账）

- **photo**（2026-08-27 并入）：`photo.json` = 单页 URL + `<img>` 提取（网页爬取语义）；photo 桌面版（repos/photo）维持独立发行。
- 29 个专属源 + webpage 通用源（共 30 个）；新增源照 `photo.json` / `bing.json`（正则提取）/ `picsum.json`（JSON API）三种骨架；giphy 为「HTML 提取 ID → CDN 直链 transform」骨架（`selftest.py` 的 `ALL_SOURCES` 计数断言需随增源同步 +1）。

## 纪律

- 敏感信息：API key 经 `{name}_KEY` 环境变量或运行参数注入；`config.json` 的 keys 字段保持空占位（不进仓）。
- 测试：`selftest.py`（源加载/构造冒烟）与 `test_sources.py`（解析回归）；改 registry/engine 后必须全绿。
- 与 crawl-hub 分工：image-scraper = A 模式（进程内、同语言、源族共享状态）；重依赖/易崩/自带 GUI 的爬虫走 B 模式（crawl-hub manifest + 子进程隔离）。
- crawler-kit（P3 已完成 2026-08-27）：Downloader 已提炼为共享库 `crawl-hub/crawler_kit/downloader.py`（通用 Task）；本仓保留内联副本（复制优于共享），两侧改动需手工对照（kit 侧 11 测试全绿）。
