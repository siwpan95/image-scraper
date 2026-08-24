#!/usr/bin/env python3
"""
全部非-midjourney 源 一键测通脚本
=================================
逐个运行各源（fetch + download 真实下载），判定是否可用。
判定：
  OK       成功下载 >=1 张
  EMPTY    跑通但 0 张（可能缺 key / 该源无结果 / 代理通但被限）
  PROXY    需代理但该环境无代理 → 跳过（不算代码 bug）
  KEY      需 API Key 但本环境未提供 → 跳过
  FAIL     抛异常（代码 bug，需修）
  TIMEOUT  超时

用法：
  python test_sources.py                       # 用默认（无代理/无 key）测可达源
  python test_sources.py --proxy socks5://127.0.0.1:1080
  python test_sources.py --proxy http://127.0.0.1:7890 --max 10
  python test_sources.py --source bing,safebooru
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import mj_scraper as m  # noqa: E402

log = logging.getLogger("test_sources")


def make_args(proxy: str, max_images: int, keys: dict):
    a = argparse.Namespace()
    a.concurrency = 4
    a.max_images = max_images
    a.retries = 2
    a.rate_limit = 0.0
    a.speed_limit = 0.0
    a.proxy = proxy
    a.tab = "top"; a.size = "thumb"; a.scrolls = 1; a.headless = True
    a.query = "art"
    a.pages = 1
    a.unsplash_key = keys.get("unsplash")
    a.unsplash_mode = "search"
    a.pexels_key = keys.get("pexels")
    a.civitai_sort = "Newest"; a.civitai_user = None; a.nsfw = False
    a.tags = "art"; a.booru_limit = 20; a.booru_exclude = ""; a.booru_rating = "s"
    a.deviantart_sort = "popular"
    a.flickr_key = keys.get("flickr"); a.flickr_sort = "relevance"
    a.pinterest_pages = 1
    a.picsum_query = None
    a.reddit_mode = "sub"
    a.wallhaven_key = keys.get("wallhaven"); a.wallhaven_nsfw = False; a.wallhaven_sorting = "toplist"
    a.artstation_sorting = "popular"
    a.google_pages = 1
    a.pixiv_order = "popular_d"; a.pixiv_mode = "all"
    return a


async def test_one(name: str, args, timeout: float):
    """返回 (status, detail)"""
    src = m.build_source(name, args)
    if src is None:
        return "FAIL", "build_source returned None"
    # 无代理但需代理 → 跳过（非代码问题）
    if getattr(src, "needs_proxy", False) and not args.proxy:
        return "PROXY", "needs proxy"
    # key 源无 key → 跳过
    key_sources = {"unsplash": "unsplash_key", "pexels": "pexels_key", "flickr": "flickr_key"}
    if name in key_sources and not getattr(args, key_sources[name]):
        return "KEY", "needs API key"

    t0 = time.time()
    try:
        res = await asyncio.wait_for(m.run_source(name, args), timeout=timeout)
        info = res.get(name, "")
        if isinstance(info, dict) and "fetched" in info:
            dl = info.get("downloaded", 0)
            st = "OK" if dl > 0 else "EMPTY"
            return st, (f"fetched={info.get('fetched')} dl={dl} "
                        f"skip={info.get('skipped',0)} err={info.get('errors')} "
                        f"{info.get('elapsed')}s")
        else:
            return "EMPTY", str(info)[:80]
    except asyncio.TimeoutError:
        return "TIMEOUT", f">{timeout:.0f}s"
    except Exception as e:
        import traceback
        return "FAIL", f"{type(e).__name__}: {str(e)[:60]} | {traceback.format_exc()[-300:]}"


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--proxy", default=None)
    ap.add_argument("--max", type=int, default=10, help="每源下载上限")
    ap.add_argument("--timeout", type=float, default=90.0)
    ap.add_argument("--source", default="", help="逗号分隔，限定源（默认全部非 mj）")
    ap.add_argument("--unsplash-key", default=None)
    ap.add_argument("--pexels-key", default=None)
    ap.add_argument("--flickr-key", default=None)
    args = ap.parse_args()

    logging.basicConfig(level=logging.WARNING,
                        format="%(asctime)s [%(levelname)s] %(message)s",
                        stream=sys.stdout)

    keys = {
        "unsplash": args.unsplash_key or (args.proxy and None),
        "pexels": args.pexels_key,
        "flickr": args.flickr_key,
    }
    a = make_args(args.proxy, args.max, keys)

    names = [n for n in m.ALL_SOURCES if n != "midjourney"]
    # webpage 源需要 --url 参数，跳过自动化测试
    names = [n for n in names if n != "webpage"]
    if args.source:
        names = [n.strip() for n in args.source.split(",") if n.strip()]

    print(f"\n代理={args.proxy or '无'} | 每源 max={args.max} | 超时={args.timeout:.0f}s")
    print(f"待测源({len(names)}): {names}\n")
    print(f"{'源':12} {'状态':8} 详情")
    print("-" * 70)

    results = {}
    for name in names:
        st, detail = await test_one(name, a, args.timeout)
        results[name] = st
        flag = {"OK": "Y", "EMPTY": "o", "PROXY": "P", "KEY": "K",
                "FAIL": "X", "TIMEOUT": "T"}.get(st, "?")
        print(f"{name:12} {flag} {st:7} {detail}")
        log.warning(f"{name}: {st} {detail}")

    print("-" * 70)
    ok = sum(1 for v in results.values() if v == "OK")
    fail = [n for n, v in results.items() if v in ("FAIL", "TIMEOUT")]
    blocked = [n for n, v in results.items() if v in ("PROXY", "KEY")]
    print(f"OK={ok}  FAIL/TIMEOUT={fail}  需代理/key跳过={blocked}")


if __name__ == "__main__":
    asyncio.run(main())
