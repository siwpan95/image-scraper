# -*- coding: utf-8 -*-
"""源注册表服务 —— 扫描 sources/json/*.json（P1 包装模式）。

服务名 `sources` → 经 `ctx.sources` 属性访问。
entry: services.source_registry（config 字段见 cordis.yml）

P1 行为契约：**零变化** —— 委托 legacy `sources/registry.py`；本服务只做
「声明面 + 容纳点」：
  - json_dir / images_dir : P1 仅作 yml 声明与验收断言（legacy 内部按 __file__
                            推导路径，P2 迁移时改读本值）。
  - names                 : 全部源名（sorted），__cordis_init__ 时扫描得出。

P2 起把 registry.py 的实现整体搬进本服务（_build_ctx 30+ 变量翻译层逐项对照
P0 黄金轨迹 ctx_snapshot.json 迁移）。
"""
from __future__ import annotations

from cordis import Service

import sources.registry as _legacy_registry


class SourceRegistryService(Service):
    inject = []

    def __init__(self, ctx, config=None):
        super().__init__(ctx, "sources")
        cfg = dict(config or {})
        self.json_dir = cfg.get("json_dir") or "sources/json"
        self.images_dir = cfg.get("images_dir") or "images"
        self.names: list = []

    def __cordis_init__(self):
        # legacy 模块导入时已扫过一次；这里显式 reload，保证扫描发生在服务初始化期
        _legacy_registry.reload()
        self.names = list(_legacy_registry.ALL_SOURCES)
        return None

    # ---- 只读面 ----
    def config_for(self, name: str):
        """单源 JSON 配置（未注册返回 None）。"""
        return _legacy_registry._CONFIGS.get(name)

    # ---- 委托 legacy 实现（P1 行为零变化）----
    def build_ctx(self, name: str, args, keys=None):
        """把运行参数翻译成引擎模板 ctx（P2 迁入后成为唯一实现）。"""
        cfg = _legacy_registry._CONFIGS.get(name)
        if cfg is None:
            return None
        return _legacy_registry._build_ctx(name, cfg, args, keys)

    def build_source(self, name: str, args, keys=None):
        """构造 JsonSource 实例（未知源返回 None）。"""
        return _legacy_registry.build_source(name, args, keys)


default = SourceRegistryService
