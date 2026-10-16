"""
多源图片爬虫 · 源注册表 —— P2 起实现迁入 `services/source_registry.py`（facade）。

本模块保留旧接口，全部转发到 services.source_registry 的同名对象：
  - ALL_SOURCES / _CONFIGS / JSON_DIR（共享同一对象；服务侧 reload 用原地清空+填充，
    引用恒有效）
  - build_source / _build_ctx / _load_all / reload / _images_dir

谁在用：mj_scraper.py（ALL_SOURCES / build_source / _CONFIGS）、selftest.py、
sources/__init__.py。P6 入口切换完成后，本 facade 随 legacy 层一并移除。
"""
from services.source_registry import (  # noqa: F401
    ALL_SOURCES,
    JSON_DIR,
    _CONFIGS,
    _build_ctx,
    _images_dir,
    _load_all,
    build_source,
    reload,
)
