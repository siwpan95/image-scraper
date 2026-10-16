#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""多源图片爬虫 · 统一启动器（P6：cordis 应用入口）。

与 legacy `mj_scraper.py` 的契约**逐项对齐**（argparse 面以 `scripts/p6_help_golden.txt`
为金标，`--help` 逐字节一致；prog 固定为 `mj_scraper.py`）：

- 40+ 参数与默认值、`--source all` 并行 + 总进度条、`--retry-failed` 模式、
  日志格式与落盘（scraper.log + stdout）、meta/failed 清单结构、退出码。
- 与 legacy 的差异（P6 入口切换的应有之义）：本入口启动时**挂载 cordis 配置树**
  （cordis.yml），能力一律经服务消费：
    ctx.config（代理）/ ctx.sources（源注册）/ ctx.downloader（下载器工厂）/ ctx.meta（落盘）。
- retry 重投的失败再导出改经 `ctx.meta.save_failed(prefix="failed_retry")`（单一实现），
  用户可见行「仍有 N 个失败，已导出」保留；较 legacy 多一行 meta_store 的「失败清单已导出」。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent  # apps/cli/main.py → 仓根
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from host.tree import WANT_P5, config_path, mount_tree  # noqa: E402
from services.downloader import ImageTask, SourceStats  # noqa: E402

log = logging.getLogger("mj_scraper")

OUTPUT_DIR = ROOT
IMAGES_DIR = ROOT / "images"

#: argparse epilog —— legacy mj_scraper.py 的模块 docstring 原文（逐字节保留，金标契约）
_LEGACY_EPILOG = """
多源图片爬虫 · 统一启动器
=========================
所有图片源（共 23 个）现已统一为 JSON 配置（sources/json/*.json），
由 sources.engine.JsonSource 通用引擎驱动，不再为每个源维护独立 Python 类。

支持源 (23 个):
  [墙内可达]
  webpage     指定网页爬取 (--url "https://...")
  midjourney  Midjourney Explore 图片 (Playwright 浏览器, tab=top)
  midjourney_video  Midjourney Explore 视频 (Playwright 浏览器, tab=video_top)
  bing        Bing 图片搜索 (无需 key)
  safebooru   Safebooru 图库 (Danbooru 式, 无需 key, 支持标签黑名单)
  artstation  ArtStation CG 社区 (无需 key)
  picsum      Lorem Picsum 随机高清图 (无需 key)
  duitang     堆糖中文社区 (无需 key)
  surfcg      SurfCG 盛绘艺点 CG 社区 (无需 key, 支持关键词搜索/60w+ 作品)
  [GFW 封锁 · 需 --proxy]
  konachan    Konachan 图库 (booru 式, 支持分级/标签黑名单)
  wallhaven   Wallhaven 壁纸 (NSFW 需 key)
  google      Google 图片搜索
  pixiv       Pixiv 插画
  deviantart  DeviantArt (公开 RSS, 无需 key)
  flickr      Flickr 图库 (需免费 key)
  pinterest   Pinterest 图库
  reddit      Reddit 图版/搜索
  civitai     Civitai SD 社区
  lexica      Lexica SD 搜索
  [需免费 API key · 无 key 自动走网页兜底]
  unsplash    Unsplash 精选图库
  pexels      Pexels 精选图库（官方 API 免鉴权，无 key 也能抓；填 key 仅提升限流额度）
  all         并行运行全部（按可达性自动跳过缺 key/被墙源）

下载控制:
  --retries N        下载失败重试次数 (默认 3, 指数退避)
  --rate-limit N     请求速率上限 (请求/秒, 0=不限)
  --speed-limit N    下载速度上限 (KB/s, 0=不限)

用法：
  python mj_scraper.py --source bing --query "ai art" --max-images 50
  python mj_scraper.py --source safebooru --tags "landscape" --booru-exclude "blood,gore"
  python mj_scraper.py --source konachan --booru-rating s --proxy socks5://127.0.0.1:1080
  python mj_scraper.py --source all --max-images 20 --rate-limit 2 --speed-limit 500
  python mj_scraper.py --source wallhaven --proxy socks5://127.0.0.1:1080 --query space
  python mj_scraper.py --source pixiv --proxy socks5://127.0.0.1:1080 --query "初音ミク"
"""


async def run_source(ctx, name: str, args) -> dict:
    """运行单个源（P6 版：与 legacy mj_scraper.run_source 行为逐项对齐，能力经服务消费）。"""
    # 先查配置，知道该源是否需要代理
    cfg = ctx.sources.config_for(name) or {}
    needs_proxy = bool(cfg.get("needs_proxy", False))

    # 记录用户是否显式指定代理（保留显式 --proxy，即使源不需要代理）
    explicit_proxy = bool(args.proxy)

    # 代理处理：仅对需要的源自动分配代理；不需要代理的源直连
    if needs_proxy:
        if getattr(args, "auto_proxy", False) and not args.proxy:
            fetched = await ctx.config.auto_fetch_proxy(
                prefer_socks=getattr(args, "auto_proxy_socks", False))
            if fetched:
                args.proxy = fetched
                log.info(f"  自动代理: {fetched}")
            else:
                log.warning("  自动代理: 未获取到可用代理")
        if not args.proxy:
            p = ctx.config.effective_proxy()
            if p:
                args.proxy = p

        # 校验代理可达性：不可达则退回直连，避免死代理导致整源失败
        if args.proxy and not ctx.config.proxy_reachable(args.proxy):
            log.warning(f"  代理不可达，忽略并退回直连: {args.proxy}")
            args.proxy = None
    elif not explicit_proxy:
        # 不需要代理的源 → 清掉自动分配的代理，走直连
        args.proxy = None

    src = ctx.sources.build_source(name, args)
    if src is None:
        return {name: "unknown"}

    # 下载控制参数（SourceBase 已定义，构造后统一注入，避免各源签名繁琐）
    src.retries = args.retries
    src.rate_limit = args.rate_limit
    src.speed_limit = args.speed_limit

    # 可达性前置检查：避免无代理时 GFW 源卡满 30s 超时
    if getattr(src, "needs_proxy", False) and not args.proxy:
        log.warning(f"源 [{name}] 跳过：GFW 封锁，需 --proxy (如 socks5://127.0.0.1:1080)")
        return {name: "skipped: needs proxy"}

    # API key 源无 key 时由源自身返回空任务 / 走网页兜底（快速跳过，不卡等）
    try:
        stats = await src.run()
        return {name: {
            "fetched": stats.fetched, "downloaded": stats.downloaded,
            "skipped": stats.skipped, "errors": stats.errors,
            "elapsed": round(stats.elapsed, 1),
        }}
    except Exception as e:
        log.error(f"源 [{name}] 异常: {e}")
        return {name: f"error: {e}"}


async def retry_failed(ctx, path: Path, args) -> dict:
    """读取失败清单 JSON，直接重投下载（不重新 fetch_tasks）。"""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    items = data.get("tasks", [])
    if not items:
        log.warning(f"失败清单为空: {path}")
        return {"retry": "empty list"}

    tasks: list[ImageTask] = []
    for it in items:
        tasks.append(ImageTask(
            url=it.get("url", ""),
            source=it.get("source", data.get("source", "")),
            title=it.get("title", ""),
            author=it.get("author", ""),
            width=it.get("width", 0),
            height=it.get("height", 0),
            referer=it.get("referer", ""),
            meta=it.get("meta", {}) or {},
        ))
    tasks = [t for t in tasks if t.url]

    src_name = data.get("source") or "retried"
    out_dir = IMAGES_DIR / src_name
    out_dir.mkdir(parents=True, exist_ok=True)

    dl = ctx.downloader.create(out_dir, args.concurrency, args.proxy,
                               args.retries, args.rate_limit, args.speed_limit)
    stats = SourceStats()
    stats.start_time = time.time()
    completed = await dl.download_batch(tasks, stats)
    await dl.close()
    stats.end_time = time.time()

    ok = sum(1 for t in completed if t.downloaded)
    log.info(f"重试完成: 总 {len(tasks)} | 成功 {ok} | 失败 {stats.errors} | {stats.elapsed:.1f}s")
    if dl.failed:
        # 仍失败则再导一份，便于二次重投（经 ctx.meta 单一实现；prefix=failed_retry）
        fp = ctx.meta.save_failed(src_name, dl.failed, prefix="failed_retry")
        log.warning(f"仍有 {len(dl.failed)} 个失败，已导出: {fp}")
    return {"retry": {"total": len(tasks), "downloaded": ok, "errors": stats.errors}}


async def _amain() -> int:
    # 日志（与 legacy 逐项一致：scraper.log + stdout）
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(OUTPUT_DIR / "scraper.log", encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )

    # 挂载 cordis 配置树（一切能力的来源）
    ctx = await mount_tree(config_path("cordis.yml"), want=WANT_P5)

    ap = argparse.ArgumentParser(
        prog="mj_scraper.py",
        description="多源图片爬虫 (统一 JSON 驱动引擎)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=_LEGACY_EPILOG,
    )
    ap.add_argument("--source", default="midjourney",
                    choices=ctx.sources.names + ["all"],
                    help="图片源 (默认 midjourney)")
    ap.add_argument("--max-images", type=int, default=100, help="每源最大下载数")
    ap.add_argument("--concurrency", type=int, default=5, help="并发下载数")
    ap.add_argument("--proxy", default=None, help="代理 (如 socks5://127.0.0.1:1080)")
    ap.add_argument("--auto-proxy", action="store_true",
                    help="自动从免费代理源(zdopen/zdaye)拉取可用代理")
    ap.add_argument("--auto-proxy-socks", action="store_true",
                    help="自动代理时优先 SOCKS5")

    # Midjourney
    ap.add_argument("--tab", default="top", choices=["top", "trending", "random", "new", "hot", "video_top"])
    ap.add_argument("--size", default="thumb", choices=["thumb", "medium", "original", "original_webp"])
    ap.add_argument("--scrolls", type=int, default=20)
    ap.add_argument("--headless", type=lambda x: x.lower() != "false", default=True)
    ap.add_argument("--content-url", default="", help="指定 Midjourney 内容链接 (https://www.midjourney.com/jobs/<uuid>?index=2)，爬取单条 job")
    ap.add_argument("--mj-index", type=int, default=0, help="指定变体 (1-4，0=全部)，配合 --content-url")

    # 网页爬取
    ap.add_argument("--url", default="", help="指定网页 URL 爬取图片 (source=webpage)")

    # Bing / 搜索类
    ap.add_argument("--query", default="ai art", help="搜索关键词 (Bing/Unsplash/Pexels/Lexica)")
    ap.add_argument("--pages", type=int, default=3, help="Bing 翻页数")

    # Unsplash
    ap.add_argument("--unsplash-key", default=None, help="Unsplash Access Key")
    ap.add_argument("--unsplash-mode", default="search", choices=["search", "random"])

    # Pexels
    ap.add_argument("--pexels-key", default=None, help="Pexels API Key")

    # Civitai
    ap.add_argument("--civitai-sort", default="Newest", choices=["Newest", "Most Reactions", "Most Comments"])
    ap.add_argument("--civitai-user", default=None, help="按用户名筛选")
    ap.add_argument("--nsfw", action="store_true", help="包含 NSFW (Civitai)")

    # Booru (Safebooru/Konachan)
    ap.add_argument("--tags", default="art", help="标签/关键词 (booru 源)")
    ap.add_argument("--booru-limit", type=int, default=40, help="booru 每页条数")
    ap.add_argument("--booru-exclude", default="", help="标签黑名单(逗号分隔，转 -tag 过滤 NSFW/不想要内容)")
    ap.add_argument("--booru-rating", default="s", help="Konachan 分级 (s=安全/q=可疑/e=成人)")

    # DeviantArt
    ap.add_argument("--deviantart-sort", default="popular", help="排序 (popular/newest/hot)")

    # Flickr
    ap.add_argument("--flickr-key", default=None, help="Flickr API Key")
    ap.add_argument("--flickr-sort", default="relevance", help="排序 (relevance/interestingness-desc/date-posted-desc)")

    # Pinterest
    ap.add_argument("--pinterest-pages", type=int, default=3, help="Pinterest 翻页数")

    # Picsum (Lorem Picsum, 随机高清图，无需 key)
    ap.add_argument("--picsum-query", default=None, help="Picsum 作者过滤(可空, 留空=全量随机)")

    # Reddit (GFW 需代理)
    ap.add_argument("--reddit-mode", default="sub", choices=["sub", "search"],
                    help="reddit: sub=版块(r/<query>) / search=关键词搜索")

    # Wallhaven
    ap.add_argument("--wallhaven-key", default=None, help="Wallhaven API Key (NSFW 需)")
    ap.add_argument("--wallhaven-nsfw", action="store_true", help="含 NSFW (需 --wallhaven-key)")
    ap.add_argument("--wallhaven-sorting", default="toplist", help="排序 (toplist/views/favorites)")

    # ArtStation
    ap.add_argument("--artstation-sorting", default="popular", help="排序 (popular/newest/trending)")

    # SurfCG
    ap.add_argument("--surfcg-sorting", default="0", choices=["0","1","2"],
                    help="排序: 0=最新 1=最热 2=点赞最多")

    # Google
    ap.add_argument("--google-pages", type=int, default=3, help="Google 翻页数")

    # Pixiv
    ap.add_argument("--pixiv-order", default="popular_d", help="排序 (popular_d/date_d)")
    ap.add_argument("--pixiv-mode", default="all", help="模式 (all/safe/r18)")

    # 下载器：重试 / 限速
    ap.add_argument("--retries", type=int, default=3, help="下载失败重试次数")
    ap.add_argument("--rate-limit", type=float, default=0.0, help="请求速率上限(请求/秒, 0=不限)")
    ap.add_argument("--speed-limit", type=float, default=0.0, help="下载速度上限(KB/s, 0=不限)")
    ap.add_argument("--retry-failed", default=None,
                    help="重投失败清单 JSON (meta/failed_<source>_<ts>.json) 中的 URL")

    args = ap.parse_args()

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    # ── 失败清单重投模式 ──
    if args.retry_failed:
        log.info("=" * 64)
        log.info(f"重投模式 | 清单: {args.retry_failed}")
        log.info("=" * 64)
        res = await retry_failed(ctx, Path(args.retry_failed), args)
        log.info(f"重投结果: {res}")
        return 0

    sources = ctx.sources.names if args.source == "all" else [args.source]

    log.info("=" * 64)
    log.info(f"多源图片爬虫 | 源={sources} | 每源 max={args.max_images}")
    log.info(f"输出根: {IMAGES_DIR}")
    log.info("=" * 64)

    t0 = time.time()
    results = {}

    if args.source != "all" and len(sources) == 1:
        # 单源：直接运行
        results.update(await run_source(ctx, sources[0], args))
    else:
        # 多源并行 + 源级总进度条（按完成顺序逐个汇报）
        coros = [run_source(ctx, s, args) for s in sources]
        total = len(coros)
        done = 0
        bar_w = 30
        for fut in asyncio.as_completed(coros):
            r = await fut
            results.update(r)
            done += 1
            filled = int(bar_w * done / total)
            bar = "█" * filled + "░" * (bar_w - filled)
            log.info(f"总进度 [{bar}] {done}/{total}")
        log.info("全部源完成")

    log.info("=" * 64)
    log.info("总览:")
    for name, info in results.items():
        log.info(f"  {name:12} {info}")
    log.info(f"总耗时: {time.time()-t0:.1f}s")
    log.info("=" * 64)
    return 0


def main() -> int:
    return asyncio.run(_amain())


if __name__ == "__main__":
    sys.exit(main())
