# -*- coding: utf-8 -*-
"""MetaStoreService —— 元数据与失败清单落盘（P3 起实现主体在此）。

服务名 `meta` → `ctx.meta`。entry: services.meta_store（config 字段见 cordis.yml）。

P3 迁移：实现自 legacy `sources/base.py` 的 `_save_meta` / `_save_failed`
**逐字节移植**（行为零变化，含日志措辞）；`prefix` 参数化以覆盖 `failed_retry_`。
**真正消费** yml 的 `meta_dir`（服务默认落点）。legacy `sources/base.py` 的
SourceBase 已改为委托本模块，P6 删除入口后移除 facade。

落盘结构（契约，勿改）：
  meta/<source>_<ts>.json          {source, timestamp, stats, images[]}
  meta/<prefix>_<source>_<ts>.json {source, timestamp, count, tasks[]}
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

try:
    from cordis import Service
except ImportError:  # fresh clone（未挂 .pth）→ 经仓库内 vendor 兜底
    import _cordis_locate

    _cordis_locate.ensure()
    from cordis import Service

from runtime_paths import base_dir

log = logging.getLogger("mj_scraper")  # 与 legacy SourceBase 同 logger，日志不漂移


def save_meta(meta_dir, source_name: str, tasks: list, stats) -> Path:
    """保存运行元数据到 <meta_dir>/<source>_<ts>.json（P3 逐字节移植自 legacy _save_meta）。"""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = Path(meta_dir) / f"{source_name}_{ts}.json"
    path.parent.mkdir(parents=True, exist_ok=True)

    images = []
    for t in tasks:
        if t.downloaded:
            images.append({
                "source": t.source,
                "url": t.url,
                "title": t.title,
                "author": t.author,
                "width": t.width,
                "height": t.height,
                "filename": Path(t.local_path).name if t.local_path else "",
                "local": t.local_path,
                "meta": t.meta,
            })

    data = {
        "source": source_name,
        "timestamp": ts,
        "stats": asdict(stats),
        "images": images,
    }
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info(f"  元数据: {path} ({len(images)} imgs)")
    return path


def save_failed(meta_dir, source_name: str, failed: list, prefix: str = "failed") -> Path:
    """导出失败 URL 清单到 <meta_dir>/<prefix>_<source>_<ts>.json（供 --retry-failed 重投）。"""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = Path(meta_dir) / f"{prefix}_{source_name}_{ts}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "source": source_name,
        "timestamp": ts,
        "count": len(failed),
        "tasks": failed,
    }
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    log.warning(f"  失败清单已导出: {path} ({len(failed)} 个 URL，可用 --retry-failed 重投)")
    return path


class MetaStoreService(Service):
    inject = []

    def __init__(self, ctx, config=None):
        super().__init__(ctx, "meta")
        cfg = dict(config or {})
        d = Path(cfg.get("meta_dir") or "meta")
        self.meta_dir = d if d.is_absolute() else base_dir() / d

    # ---- 服务方法（转发模块级唯一实现；meta_dir 默认取 yml 值，可显式覆盖）----
    def save_meta(self, source_name: str, tasks: list, stats, meta_dir=None) -> Path:
        return save_meta(meta_dir or self.meta_dir, source_name, tasks, stats)

    def save_failed(self, source_name: str, failed: list, prefix: str = "failed",
                    meta_dir=None) -> Path:
        return save_failed(meta_dir or self.meta_dir, source_name, failed, prefix=prefix)


default = MetaStoreService
