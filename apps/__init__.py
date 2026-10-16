# -*- coding: utf-8 -*-
"""apps —— 应用入口层（cli / video）。

P6 起，一切入口经 `host.tree.mount_tree` 挂载 `cordis.yml` 配置树，
能力一律经服务消费（ctx.config / ctx.sources / ctx.downloader / ctx.meta / ...）。
legacy 顶层脚本（mj_scraper.py / run_video_sources.py）已收缩为薄 shim。
"""
