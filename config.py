#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""持久化配置（代理 + API Key）—— P2 起实现迁入 `services/config.py`（facade）。

本模块保留旧公共接口，全部转发到 services.config 的同名实现：
  - load_config / save_config / detect_proxy / effective_proxy / proxy_reachable
  - auto_fetch_proxy / CONFIG_PATH / DEFAULTS / PROXY_CANDIDATES

谁在用：mj_scraper.py / run_video_sources.py（P6 起均为薄 shim）；apps/* 经 cordis 服务
消费（ctx.config）。gui_scraper.py 已随 P6 删除；P7 文档切换后本 facade 随 legacy 层移除。
"""
from __future__ import annotations

from services.config import (  # noqa: F401
    CONFIG_PATH,
    DEFAULTS,
    PROXY_CANDIDATES,
    auto_fetch_proxy,
    detect_proxy,
    effective_proxy,
    load_config,
    proxy_reachable,
    save_config,
)
