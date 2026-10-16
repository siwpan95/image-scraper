# Changelog

本项目所有值得注意的变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased] — cordis 内核重构（2026-10-16）

抓取内核重构：能力拆为 cordis 服务，装配清单 `cordis.yml`；CLI 契约（40+ 参数、输出格式）与旧版逐字节一致。

### Added

- cordis 内核（`vendor/cordis` v4.0.0 @ `a3d0c17`，MIT；`VENDOR.md` + `cordis.lock` 记账）：`services/` 七服务 + `host/tree.py` 配置树引导（entry 白名单）。
- 浏览器服务双模式：默认 launch（行为与旧版一致）；新增 **CDP 模式**接管本地 Chrome（`cordis.yml` 的 `browser.cdp`）—— 登录态复用 / 反爬友好。
- 分阶段 headless 验收：`scripts/mount_check.py`、`scripts/p2_check.py` ~ `scripts/p7_check.py`（含文件名规则 12800+ 语料 diff、四路径分类矩阵、P0 黄金轨迹重放）。
- 环境修复：midjourney 浏览器源恢复可用（chromium-1248 与 playwright 1.64 对齐；此前版本错位必败）。

### Changed

- 入口迁移：`apps/cli/main.py`（统一 CLI）+ `apps/video/main.py`（视频源）；`mj_scraper.py` / `run_video_sources.py` 变为兼容 shim。
- `config.py` / `proxy_fetcher.py` / `sources/{base,engine,registry}.py` 收缩为 facade（实现唯一在 `services/`）。
- `selftest.py` 升级为「离线单测 + 服务级挂载验收」双段。

### Removed

- `gui_scraper.py`（tkinter GUI，681 行）—— 调度能力由 CLI 完整覆盖。

### Fixed

- browser-html 路径 `page.goto(headers=...)` 传参错误（playwright 不支持）：异常被吞、页面从未真正导航，webpage 类源恒 0 结果；改用 `context.set_extra_http_headers`。

## [1.0.0] - 2026-08-27

### Added

- 首个发行版：Windows 可执行程序（PyInstaller，Python 3.14）。
- 发布面：gitee [siwpan/image-scraper](https://gitee.com/siwpan/image-scraper) release `v1.0.0`（多源图片爬虫 v1.0.0）。