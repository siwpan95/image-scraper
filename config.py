#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""持久化配置（代理 + API Key）—— P2 起实现迁入 `services/config.py`（facade）。

本模块保留旧公共接口，全部转发到 services.config 的同名实现：
  - load_config / save_config / detect_proxy / effective_proxy / proxy_reachable
  - auto_fetch_proxy / CONFIG_PATH / DEFAULTS / PROXY_CANDIDATES

谁在用：mj_scraper.py（auto_fetch_proxy / effective_proxy / proxy_reachable）、
gui_scraper.py（load_config / save_config / detect_proxy）、run_video_sources.py（effective_proxy）。
P6 入口切换完成后，本 facade 随 legacy 层一并移除。
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
