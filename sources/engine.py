"""
多源图片爬虫 · 统一引擎 —— P5 起实现迁入 `services/engine.py`（facade）。
=====================================================================
本模块保留旧 import 面，全部转发到 services.engine 的同名对象：
  - `JsonSource`（引擎主体；registry 的 build_source、sources/__init__、selftest 在用）
  - 工具函数 `_subst` / `_subst_any` / `_get_path` / `_to_int` / `_check_filter` /
    `_apply_transforms` / `_apply_extractor` / `_deep_merge`（selftest 在用其中两个）
P6 入口切换完成后，本 facade 随 legacy 层一并移除。

⚠ 导入顺序约束（防循环）：services.engine 顶层 import `sources.base` 会经 `sources/__init__`；
本 facade 与之共存的前提是「__init__ 只急切导入 .base」（见 sources/__init__.py 头注）。
"""

from services.engine import (  # noqa: F401
    JsonSource,
    _apply_extractor,
    _apply_transforms,
    _check_filter,
    _deep_merge,
    _get_path,
    _subst,
    _subst_any,
    _to_int,
)
