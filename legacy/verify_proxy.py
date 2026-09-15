#!/usr/bin/env python3
"""
GFW 源代理一键验证脚本
=======================
一键测试所有被 GFW 封锁、需要代理的图片源是否可通过给定代理正常访问。

原理：为每个 GFW 源构造实例并调用 fetch_tasks(max_images=3)（仅抓取任务 URL，
不下载图片），用超时包裹，判定可达性。无需 key 的源能拿到任务即证明代理通；
需 key 的源（如 flickr）若返回空，说明代理通但缺 key，仍记为通（标注 EMPTY）。

用法：
  python verify_proxy.py --proxy socks5://127.0.0.1:1080
  python verify_proxy.py --proxy http://127.0.0.1:7890 --timeout 30
  python verify_proxy.py --proxy socks5://127.0.0.1:1080 --no-baseline   # 跳过无代理对照

依赖：与 mj_scraper.py 同目录，复用其 build_source / ALL_SOURCES。
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time
from pathlib import Path

# 复用启动器的源构造逻辑
sys.path.insert(0, str(Path(__file__).parent))
import mj_scraper as m  # noqa: E402

log = logging.getLogger("verify_proxy")

# 构造一个最小 args 命名空间，供 build_source 使用
def make_args(proxy: str):
    a = argparse.Namespace()
    a.concurrency = 3
    a.max_images = 3
    a.retries = 1
    a.rate_limit = 0.0
    a.speed_limit = 0.0
    a.proxy = proxy
    # 各源所需字段（build_source 会读取）
    a.tab = "top"; a.size = "thumb"; a.scrolls = 1; a.headless = True
    a.query = "art"; a.pages = 1
    a.unsplash_key = None; a.unsplash_mode = "search"
    a.pexels_key = None
    a.civitai_sort = "Newest"; a.civitai_user = None; a.nsfw = False
    a.tags = "art"; a.booru_limit = 5; a.booru_exclude = ""; a.booru_rating = "s"
    a.deviantart_sort = "popular"
    a.flickr_key = None; a.flickr_sort = "relevance"
    a.pinterest_pages = 1
    a.wallhaven_key = None; a.wallhaven_nsfw = False; a.wallhaven_sorting = "toplist"
    a.artstation_sorting = "popular"
    a.google_pages = 1
    a.pixiv_order = "popular_d"; a.pixiv_mode = "all"
    a.reddit_mode = "sub"
    a.picsum_query = None
    return a


def gfw_sources(args) -> list[str]:
    """筛选所有 needs_proxy=True 的源（单源构造失败不阻断整体）"""
    out = []
    for name in m.ALL_SOURCES:
        try:
            src = m.build_source(name, args)
        except Exception as e:  # noqa
            log.warning(f"  跳过 [{name}]：构造失败（可能 make_args 缺字段）: {e}")
            continue
        if src is not None and getattr(src, "needs_proxy", False):
            out.append(name)
    return out


async def test_one(name: str, args, timeout: float):
    src = m.build_source(name, args)
    t0 = time.time()
    try:
        tasks = await asyncio.wait_for(src.fetch_tasks(args.max_images), timeout=timeout)
        n = len(tasks)
        elapsed = time.time() - t0
        # 能进到这里即代理通；空任务可能因缺 key（如 flickr）或该源无结果
        status = "OK" if n > 0 else "EMPTY"
        return name, status, elapsed, f"获取 {n} 任务"
    except asyncio.TimeoutError:
        return name, "TIMEOUT", time.time() - t0, f">{timeout:.0f}s 无响应"
    except Exception as e:
        return name, "FAIL", time.time() - t0, f"{type(e).__name__}: {str(e)[:50]}"


async def test_baseline(name: str, args, timeout: float):
    """无代理对照：GFW 源应不可达（用于确认代理确实在起作用）"""
    no_proxy = argparse.Namespace(**vars(args))
    no_proxy.proxy = None
    src = m.build_source(name, no_proxy)
    try:
        await asyncio.wait_for(src.fetch_tasks(args.max_images), timeout=min(timeout, 15.0))
        return name, "REACHABLE_WO_PROXY"
    except Exception:
        return name, "blocked"


async def main():
    ap = argparse.ArgumentParser(description="GFW 源代理一键验证")
    ap.add_argument("--proxy", required=True, help="代理地址 (socks5://127.0.0.1:1080)")
    ap.add_argument("--timeout", type=float, default=25.0, help="每源超时秒数")
    ap.add_argument("--no-baseline", action="store_true", help="跳过无代理对照测试")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.WARNING,
        format="%(asctime)s [%(levelname)s] %(message)s",
        stream=sys.stdout,
    )

    a = make_args(args.proxy)
    sources = gfw_sources(a)
    log.warning(f"GFW 源({len(sources)}个): {sources}")

    print(f"\n代理: {args.proxy} | 超时: {args.timeout:.0f}s | GFW 源: {len(sources)}")
    print(f"{'源':12} {'状态':18} {'耗时':8} 详情")
    print("-" * 64)

    ok = 0
    for name in sources:
        n, status, el, detail = await test_one(name, a, args.timeout)
        if status in ("OK", "EMPTY"):
            ok += 1
        flag = "✓" if status == "OK" else ("○" if status == "EMPTY" else "✗")
        print(f"{name:12} {flag} {status:16} {el:6.1f}s {detail}")

    if not args.no_baseline:
        print("-" * 64)
        print("无代理对照（应被墙，确认代理生效）:")
        for name in sources:
            bn, bs = await test_baseline(name, a, args.timeout)
            print(f"  {bn:12} {bs}")

    print("-" * 64)
    print(f"结论: {ok}/{len(sources)} 个 GFW 源通过代理可达 (proxy={args.proxy})")
    print("  OK=成功获取任务 | EMPTY=代理通但源返回空(可能缺 key) | TIMEOUT/FAIL=代理无效")


if __name__ == "__main__":
    asyncio.run(main())
