"""
多源图片爬虫 - sources 包
========================
各图片源现已统一为 JSON 配置（见 ./json/*.json），由 services/engine.JsonSource 驱动。
构建入口：from sources.registry import ALL_SOURCES, build_source

⚠ P5 起：本 __init__ 只**急切**导入 cycle-free 的 .base；`.engine` / `.registry` 的导出
改懒加载（PEP 562 __getattr__）——否则出现循环导入：
    services.engine → sources.base → sources/__init__ → .engine(facade) → services.engine（部分初始化）
（cordis Loader 会吞掉该 ImportError，表现为"engine 服务不就绪"的静默失败，故此处钉死约定。）
"""

from .base import log, ImageTask, Downloader, SourceStats, SourceBase  # noqa: F401

__all__ = [
    "log", "ImageTask", "Downloader", "SourceStats", "SourceBase",
    "JsonSource", "ALL_SOURCES", "build_source", "reload",
]


def __getattr__(name: str):
    if name == "JsonSource":
        from .engine import JsonSource
        globals()["JsonSource"] = JsonSource
        return JsonSource
    if name in ("ALL_SOURCES", "build_source", "reload"):
        from .registry import ALL_SOURCES, build_source, reload
        value = {"ALL_SOURCES": ALL_SOURCES, "build_source": build_source,
                 "reload": reload}[name]
        globals()[name] = value
        return value
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
