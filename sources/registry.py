"""
多源图片爬虫 · 源注册表
========================
从 sources/json/*.json 加载全部源配置，统一对外提供：
  - ALL_SOURCES     : 全部源名称列表
  - build_source(name, args) : 根据名称与运行参数构造 JsonSource 实例

build_source 兼容原 mj_scraper 的 argparse.Namespace 参数形态（query / pages /
xxx_key / xxx_mode / xxx_sorting / ...），并把它翻译成 JSON 模板所需的 ctx 变量。
这样 GUI / CLI / 测试脚本无需改动即可复用。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from .base import log, ImageTask, Downloader, SourceStats  # noqa: F401
from .engine import JsonSource

JSON_DIR = Path(__file__).resolve().parent / "json"

_CONFIGS: dict = {}
ALL_SOURCES: list = []


def _load_all():
    _CONFIGS.clear()
    if not JSON_DIR.exists():
        return
    for f in sorted(JSON_DIR.glob("*.json")):
        try:
            cfg = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            log.warning(f"  源配置加载失败 {f.name}: {e}")
            continue
        if isinstance(cfg, dict) and cfg.get("name"):
            _CONFIGS[cfg["name"]] = cfg
    ALL_SOURCES.clear()
    ALL_SOURCES.extend(sorted(_CONFIGS.keys()))


_load_all()


def _build_ctx(name: str, cfg: dict, args, keys: Optional[dict]) -> dict:
    """把命令行/ GUI 的 args 翻译成引擎模板 ctx 变量。"""
    def g(attr, default=""):
        return getattr(args, attr, default)

    ctx: dict = {}
    ctx["query"] = g("query", "") or ""
    ctx["max_images"] = g("max_images", 100)
    ctx["nsfw"] = bool(g("nsfw", False))
    ctx["pages"] = g("pages", 3)
    ctx["tags"] = g("tags", "art")
    ctx["rating"] = g("booru_rating", "s")
    ctx["limit"] = g("booru_limit", 40)
    ctx["booru_exclude"] = g("booru_exclude", "")

    # 网页爬取：URL 与页面来源（用于 referer 防盗链）
    ctx["url"] = g("url", "") or ""
    if ctx["url"]:
        from urllib.parse import urlparse
        parsed = urlparse(ctx["url"])
        ctx["page_origin"] = f"{parsed.scheme}://{parsed.netloc}/"

    # 各源专属参数
    ctx["artstation_sorting"] = g("artstation_sorting", "popular")
    ctx["civitai_sort"] = g("civitai_sort", "Newest")
    ctx["surfcg_sorting"] = g("surfcg_sorting", "0")   # 0=最新 1=最热 2=点赞最多
    ctx["civitai_user"] = g("civitai_user", None) or ""
    ctx["deviantart_sort"] = g("deviantart_sort", "popular")
    ctx["flickr_sort"] = g("flickr_sort", "relevance")
    ctx["google_pages"] = g("google_pages", 3)
    ctx["pinterest_pages"] = g("pinterest_pages", 3)
    ctx["unsplash_mode"] = g("unsplash_mode", "search")
    ctx["pixiv_order"] = g("pixiv_order", "popular_d")
    ctx["pixiv_mode"] = g("pixiv_mode", "all")
    ctx["reddit_mode"] = g("reddit_mode", "sub")
    ctx["wallhaven_sorting"] = g("wallhaven_sorting", "toplist")
    ctx["wallhaven_nsfw"] = bool(g("wallhaven_nsfw", False))
    ctx["picsum_query"] = g("picsum_query", None) or ""
    ctx["tab"] = g("tab", "top")
    ctx["size"] = g("size", "thumb")
    ctx["scrolls"] = g("scrolls", 20)
    ctx["headless"] = g("headless", True)

    # Midjourney 指定内容链接爬取（content_url 字段或通用 url 字段均可提供）
    ctx["content_url"] = g("content_url", "") or g("url", "") or ""
    ctx["mj_index"] = g("mj_index", 0)

    # 模式变量（request_by_mode 使用）
    ctx["mode"] = g(f"{name}_mode", "") or ""
    ctx["order"] = g(f"{name}_order", "") or ""
    # 排序变量（artstation/civitai/wallhaven 等模板用 {sorting}）
    ctx["sorting"] = g(f"{name}_sorting", "") or ""

    # API Key
    key = g(f"{name}_key", None) or os.getenv(f"{name.upper()}_KEY") or ""
    if not key and isinstance(keys, dict):
        key = keys.get(name, "")
    ctx["key"] = key or ""

    # 派生变量
    eff = ctx["tags"]
    if ctx["rating"]:
        # 不同 booru 的 rating 简写不同：konachan 用 s/q/e，safebooru 用 safe/questionable/explicit
        rating_map = {
            "safebooru": {"s": "safe", "q": "questionable", "e": "explicit"},
            "konachan": {"s": "s", "q": "q", "e": "e"},
        }
        suffix = rating_map.get(name, {}).get(ctx["rating"], ctx["rating"])
        eff += f" rating:{suffix}"
    if ctx["booru_exclude"]:
        eff += " " + " ".join(f"-{t.strip()}" for t in ctx["booru_exclude"].split(",") if t.strip())
    ctx["eff_tags"] = eff.strip()
    ctx["purity"] = "111" if (ctx["wallhaven_nsfw"] and ctx["key"]) else "100"
    ctx["nsfw_flag"] = "true" if ctx["nsfw"] else ""
    ctx["browsing"] = 31 if ctx["nsfw"] else ""
    # URL 编码后的关键词（用于把 {query} 直接拼进 URL 路径/查询串的源，
    # 避免多词/中文关键词因未编码而失效；params/body 由 httpx 自动编码，用原值即可）
    ctx["query_encoded"] = quote(ctx["query"]) if ctx["query"] else ""
    ctx["eff_tags_encoded"] = quote(ctx["eff_tags"]) if ctx["eff_tags"] else ""
    return ctx


def build_source(name: str, args, keys: Optional[dict] = None):
    """根据名称与运行参数构造 JsonSource；未知名称返回 None。"""
    cfg = _CONFIGS.get(name)
    if cfg is None:
        return None
    ctx = _build_ctx(name, cfg, args, keys)
    return JsonSource(
        cfg,
        output_root=_images_dir(),
        concurrency=getattr(args, "concurrency", 5),
        proxy=getattr(args, "proxy", None),
        max_images=getattr(args, "max_images", 100),
        retries=getattr(args, "retries", 3),
        rate_limit=getattr(args, "rate_limit", 0.0),
        speed_limit=getattr(args, "speed_limit", 0.0),
        ctx=ctx,
        keys=keys,
    )


def _images_dir() -> Path:
    # 与 mj_scraper.IMAGES_DIR 保持一致：脚本目录 / images
    return Path(__file__).resolve().parent.parent / "images"


def reload():
    """重新扫描 json 目录（便于热更新配置）。"""
    _load_all()
