# -*- coding: utf-8 -*-
"""ConfigService —— 持久化配置与代理能力（P1 包装模式）。

服务名 `config` → 经 `ctx.config` 属性访问。
entry: services.config（config 字段见 cordis.yml）

P1 行为契约：**零变化** —— 全部能力直接委托 legacy `config.py` 的同名函数；
本服务只做「声明面 + 容纳点」：
  - proxy_candidates  : 本地代理候选端口列表。P1 仅作 yml 声明与验收断言
                        （消费点仍在 legacy detect_proxy 内部常量，P2 迁移时改读本值）。
  - persisted         : config.json 的持久化快照（proxy + keys），__cordis_init__ 时读取。

P2 起把 config.py 的实现整体搬进本服务（届时 legacy 模块收缩为数据读取）。
"""
from __future__ import annotations

from cordis import Service

import config as _legacy_config  # 顶层模块：持久化配置 + 代理探测（既有实现）

#: yml 未提供 proxy_candidates 时的回退（= legacy config.PROXY_CANDIDATES 快照）
_DEFAULT_PROXY_CANDIDATES = list(_legacy_config.PROXY_CANDIDATES)


class ConfigService(Service):
    inject = []

    def __init__(self, ctx, config=None):
        super().__init__(ctx, "config")
        cfg = dict(config or {})
        declared = cfg.get("proxy_candidates")
        self.candidates_from_yaml = bool(declared)  # 配置传递断言用
        self.proxy_candidates = list(declared or _DEFAULT_PROXY_CANDIDATES)
        self.persisted: dict = {}

    def __cordis_init__(self):
        # 读取 config.json（代理 + keys 持久化值）
        self.persisted = _legacy_config.load_config()
        return None

    # ---- 委托 legacy 实现（P1 行为零变化）----
    def effective_proxy(self, explicit=None) -> str:
        return _legacy_config.effective_proxy(explicit)

    def proxy_reachable(self, url: str) -> bool:
        return _legacy_config.proxy_reachable(url)

    async def auto_fetch_proxy(self, prefer_socks: bool = False) -> str:
        return await _legacy_config.auto_fetch_proxy(prefer_socks=prefer_socks)


default = ConfigService
