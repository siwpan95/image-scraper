#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
定时运行「视频源」: pixabay_video + midjourney_video
====================================================
供「每小时自动任务」调用。依次运行两个视频源，每源带超时保护，
运行结果写入 meta/run_video_<ts>.json 并打印简明汇总。

依赖解释器: F:/Python314/python.exe
  (需含 httpx / requests / bs4 / lxml / playwright；项目 .venv 缺 playwright，故用主 Python)
  调用方式:
    F:/Python314/python.exe G:/repos/image-scraper/run_video_sources.py [--query 关键词] [--max-images 60]

说明:
  - pixabay_video : HTTP/curl 驱动，墙内可达，无需代理，无需登录。
  - midjourney_video : Playwright 浏览器驱动，Midjourney 在国内被墙 -> 需要代理；
                      且 explore 需要已登录的浏览器会话(cookies)，无会话时抓取数为 0。
  - 代理: 自动探测(config.json / 环境变量 / 系统代理 / 常见端口)，显式传入以保留给 midjourney_video。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import mj_scraper as m  # noqa: E402
import config  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(ROOT / "scraper.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("run_video_sources")

# 要运行的视频源（顺序即执行顺序）
VIDEO_SOURCES = ["pixabay_video", "midjourney_video"]


def build_args(ns, proxy: str | None, name: str) -> argparse.Namespace:
    """构造与 mj_scraper.main 等价的参数 Namespace，保证 build_source._build_ctx 取得到所有字段。
    proxy 仅对 midjourney_video 显式传入(国内被墙需代理)；pixabay_video 墙内可达，强制直连。"""
    eff_proxy = proxy if name == "midjourney_video" else None
    a = argparse.Namespace()
    defaults = dict(
        source="pixabay_video",
        max_images=ns.max_images,
        concurrency=5,
        proxy=eff_proxy,        # 仅 midjourney_video 走代理；pixabay_video 直连
        auto_proxy=ns.auto_proxy,
        auto_proxy_socks=False,
        tab="video_top",
        size="original",
        scrolls=20,
        headless=ns.headless,
        content_url="",
        mj_index=0,
        url="",
        query=ns.query,
        pages=ns.pages,
        unsplash_key=None,
        unsplash_mode="search",
        pexels_key=None,
        civitai_sort="Newest",
        civitai_user=None,
        nsfw=False,
        tags="art",
        booru_limit=40,
        booru_exclude="",
        booru_rating="s",
        deviantart_sort="popular",
        flickr_key=None,
        flickr_sort="relevance",
        pinterest_pages=3,
        picsum_query=None,
        reddit_mode="sub",
        wallhaven_key=None,
        wallhaven_nsfw=False,
        wallhaven_sorting="toplist",
        artstation_sorting="popular",
        surfcg_sorting="0",
        google_pages=3,
        pixiv_order="popular_d",
        pixiv_mode="all",
        retries=ns.retries,
        rate_limit=0.0,
        speed_limit=0.0,
        retry_failed=None,
    )
    for k, v in defaults.items():
        setattr(a, k, v)
    return a


async def run_one(name: str, ns, proxy: str | None, timeout: float) -> dict:
    a = build_args(ns, proxy, name)
    try:
        res = await asyncio.wait_for(m.run_source(name, a), timeout=timeout)
        return res.get(name, {})
    except asyncio.TimeoutError:
        log.error(f"源 [{name}] 超时(>{timeout:.0f}s)，跳过")
        return {"error": f"timeout>{timeout:.0f}s"}
    except Exception as e:  # noqa: BLE001
        log.error(f"源 [{name}] 异常: {e}")
        return {"error": str(e)}


async def main() -> None:
    ap = argparse.ArgumentParser(description="定时运行视频源(pixabay_video + midjourney_video)")
    ap.add_argument("--query", default="ai art", help="搜索关键词(主要用于 pixabay_video)")
    ap.add_argument("--max-images", type=int, default=60, help="每源最大下载数")
    ap.add_argument("--pages", type=int, default=3, help="pixabay_video 翻页数")
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--per-source-timeout", type=float, default=900.0,
                    help="单源超时(秒)，防止浏览器卡死拖垮整点任务")
    ap.add_argument("--headless", type=lambda x: x.lower() != "false", default=True)
    ap.add_argument("--auto-proxy", action="store_true",
                    help="无显式代理时仍允许从免费代理源拉取(对 midjourney_video 生效)")
    ns = ap.parse_args()

    # 代理探测：显式传入以保留给 needs_proxy=False 的 midjourney_video
    proxy = config.effective_proxy() or None
    if proxy:
        log.info(f"使用代理: {proxy}")
    else:
        log.info("未探测到代理（pixabay_video 直连正常；midjourney_video 在国内需代理）")

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    results: dict = {}
    t0 = time.time()
    for name in VIDEO_SOURCES:
        log.info("=" * 60)
        log.info(f"开始源: {name}")
        info = await run_one(name, ns, proxy, ns.per_source_timeout)
        results[name] = info
        log.info(f"源 {name} 结果: {info}")
    elapsed = round(time.time() - t0, 1)

    report = {
        "task": "video_sources_hourly",
        "timestamp": ts,
        "elapsed": elapsed,
        "interpreter": sys.executable,
        "proxy": proxy or "",
        "sources": results,
    }
    meta_dir = ROOT / "meta"
    meta_dir.mkdir(parents=True, exist_ok=True)
    rp = meta_dir / f"run_video_{ts}.json"
    rp.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    # 简明汇总（供自动任务汇报）
    lines = [f"[视频源定时任务 {ts}] 解释器={sys.executable} 代理={proxy or '无'} 耗时={elapsed}s"]
    for name, info in results.items():
        if isinstance(info, dict) and "downloaded" in info:
            lines.append(f"  - {name}: 抓取={info.get('fetched')} 下载={info.get('downloaded')} "
                         f"跳过={info.get('skipped', 0)} 失败={info.get('errors')} "
                         f"({info.get('elapsed')}s)")
        else:
            lines.append(f"  - {name}: {info}")
    lines.append(f"报告已落盘: {rp}")
    summary = "\n".join(lines)
    log.info("=" * 60)
    log.info(summary)
    # 额外打印到 stdout 末尾，便于自动任务抓取结论
    print("\n===VIDEO_TASK_SUMMARY===\n" + summary + "\n===/VIDEO_TASK_SUMMARY===")


if __name__ == "__main__":
    asyncio.run(main())
