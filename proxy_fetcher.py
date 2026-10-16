#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""多源图片爬虫 · 免费代理获取器 —— P2 起实现迁入 `services/proxy.py`（facade）。

本模块保留旧接口（fetch_working_proxy / fetch_proxy_list / ProxyItem / ...）与 CLI，
全部转发到 services.proxy 的同名对象：

    python proxy_fetcher.py --test-all     # 转发到 services.proxy 的同名 CLI

谁在用：config.py facade 经 services.config.auto_fetch_proxy（现直达 services.proxy）、
gui_scraper.py（from proxy_fetcher import fetch_working_proxy）。
P6 入口切换完成后，本 facade 随 legacy 层一并移除。
"""
from __future__ import annotations

from services.proxy import (  # noqa: F401
    CHECK_TARGET,
    CHECK_TIMEOUT,
    CONFIG_PATH,
    TCP_TIMEOUT,
    ProxyItem,
    _fetch_zdaye,
    _fetch_zdaye_free,
    _fetch_zdopen,
    _get_proxy_sources,
    _load_config,
    _normalize_proto,
    _proxy_check,
    _tcp_check,
    fetch_proxy_list,
    fetch_working_proxy,
)

if __name__ == "__main__":
    import asyncio

    from services.proxy import _cli

    asyncio.run(_cli())
