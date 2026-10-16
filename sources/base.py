"""
多源图片爬虫 - 基础层（P3 起：下载器/数据结构实现迁入 services/，本模块为 facade + SourceBase 宿主）
========================
- `Downloader` / `ImageTask` / `SourceStats` / `MEDIA_EXTS` 的唯一实现在
  `services/downloader.py`（此处转发，供 engine.py / mj_scraper.py 等既有 import 面
  无感过渡；P7 文档切换后随 legacy 层移除。gui_scraper.py 已随 P6 删除）。
- `SourceBase` 仍驻留本模块（P5 引擎服务化时再评估），其 run() 编排经
  `services/meta_store` 落盘元数据 —— 元数据/失败清单格式的实现只有一处。

设计要点（不变）：
- 中国网络环境：Civitai/Lexica 被 GFW 封锁，Unsplash/Pexels/Bing 可达。
- 所有源统一实现 fetch_tasks() -> list[ImageTask]，由调度器驱动。
- 下载统一走 httpx（带代理支持）；Midjourney 因 Cloudflare 需浏览器通道，自行覆盖。
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

from services import meta_store as _meta_store
from services.downloader import (  # noqa: F401  re-export：唯一实现在 services/
    MEDIA_EXTS,
    Downloader,
    ImageTask,
    SourceStats,
)

log = logging.getLogger("mj_scraper")


class SourceBase:
    """所有图片源的基类"""

    name: str = "base"
    # 是否需要浏览器（Playwright）通道
    needs_browser: bool = False
    # 是否被 GFW 封锁（需代理才能访问）
    needs_proxy: bool = False

    def __init__(
        self,
        output_root: Path,
        concurrency: int = 5,
        proxy: Optional[str] = None,
        max_images: int = 100,
        retries: int = 3,
        rate_limit: float = 0.0,
        speed_limit: float = 0.0,
    ):
        self.output_root = Path(output_root)
        self.concurrency = concurrency
        self.proxy = proxy
        self.max_images = max_images
        self.retries = retries
        self.rate_limit = rate_limit
        self.speed_limit = speed_limit
        self.output_dir = self.output_root / self.name
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.stats = SourceStats()

    # ── 子类必须实现 ──
    async def fetch_tasks(self, max_images: int) -> list[ImageTask]:
        raise NotImplementedError

    # ── 通用运行流程（httpx 下载）──
    async def run(self) -> SourceStats:
        self.stats.start_time = time.time()
        log.info(f"[{self.name}] 开始 (max={self.max_images}, proxy={self.proxy or '无'})")

        tasks = await self.fetch_tasks(self.max_images)
        self.stats.fetched = len(tasks)
        log.info(f"  获取任务: {len(tasks)}")

        if tasks:
            dl = Downloader(
                self.output_dir, self.concurrency, self.proxy,
                self.retries, self.rate_limit, self.speed_limit,
            )
            completed = await dl.download_batch(tasks, self.stats)
            await dl.close()
            self._save_meta(completed)
            # 失败 URL 清单导出（供 --retry-failed 重投）
            if dl.failed:
                self._save_failed(dl.failed)
        else:
            log.warning(f"  源 [{self.name}] 无任务")

        self.stats.end_time = time.time()
        self._summary()
        return self.stats

    # ── 元数据保存（委托 services.meta_store —— 格式唯一实现）──
    def _save_meta(self, tasks: list[ImageTask]):
        _meta_store.save_meta(self.output_root.parent / "meta", self.name, tasks, self.stats)

    def _save_failed(self, failed: list[dict]):
        """导出失败 URL 清单到 meta/failed_<source>_<ts>.json，供 --retry-failed 重投"""
        _meta_store.save_failed(self.output_root.parent / "meta", self.name, failed)

    def _summary(self):
        s = self.stats
        log.info(
            f"[{self.name}] 完成 {s.elapsed:.1f}s | "
            f"获取 {s.fetched} | 下载 {s.downloaded} | "
            f"跳过 {s.skipped} | 失败 {s.errors}"
        )
