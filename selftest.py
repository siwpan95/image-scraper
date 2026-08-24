#!/usr/bin/env python3
"""
离线自测：校验 JSON 配置合法性 + 引擎解析/字段映射逻辑（无需联网）。
运行： python selftest.py
"""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from sources.registry import ALL_SOURCES, build_source, _CONFIGS  # noqa: E402
from sources.engine import JsonSource, _apply_extractor, _get_path  # noqa: E402


def check_regexes():
    """仅校验真正的「正则字段」：url_extract 的 patterns、block_extract 的
    block/url/title，以及 item transform 中 regex_replace 的 pattern。
    其余含特殊字符的字符串（模板 {x}、替换串 _b\\1、查询串 ?a=1）不是正则，跳过。"""
    problems = []
    for name, cfg in _CONFIGS.items():
        parse = cfg.get("parse", {})
        ue = parse.get("url_extract")
        if ue:
            for pat in ue.get("patterns", []):
                if "{" in pat:
                    continue
                try:
                    re.compile(pat)
                except re.error as e:
                    problems.append(f"  [{name}] url_extract 正则非法: {e} -> {pat!r}")
        be = parse.get("block_extract")
        if be:
            for key in ("block", "url", "title"):
                pat = be.get(key, "")
                if pat and "{" not in pat:
                    try:
                        re.compile(pat)
                    except re.error as e:
                        problems.append(f"  [{name}] block_extract.{key} 正则非法: {e} -> {pat!r}")
        # transform 中的 regex_replace.pattern
        for fld, extr in cfg.get("item", {}).items():
            for t in _collect_transforms(extr):
                if t.get("op") == "regex_replace":
                    pat = t.get("pattern", "")
                    try:
                        re.compile(pat)
                    except re.error as e:
                        problems.append(f"  [{name}] item.{fld} transform 正则非法: {e} -> {pat!r}")
        # alt 分支同样检查
        alt = cfg.get("alt")
        if alt:
            aue = alt.get("parse", {}).get("url_extract")
            if aue:
                for pat in aue.get("patterns", []):
                    if "{" in pat:
                        continue
                    try:
                        re.compile(pat)
                    except re.error as e:
                        problems.append(f"  [{name}] alt url_extract 正则非法: {e} -> {pat!r}")
            for fld, extr in alt.get("item", {}).items():
                for t in _collect_transforms(extr):
                    if t.get("op") == "regex_replace":
                        pat = t.get("pattern", "")
                        try:
                            re.compile(pat)
                        except re.error as e:
                            problems.append(f"  [{name}] alt item.{fld} transform 正则非法: {e} -> {pat!r}")
    return problems


def _collect_transforms(extr):
    out = []
    if isinstance(extr, dict):
        if "transform" in extr and isinstance(extr["transform"], list):
            out.extend(extr["transform"])
        if "default" in extr and isinstance(extr["default"], list):
            for sub in extr["default"]:
                out.extend(_collect_transforms(sub))
        if "fallback" in extr:
            out.extend(_collect_transforms(extr["fallback"]))
    return out


def test_extract_units():
    # picsum (json, list_path "")
    cfg = _CONFIGS["picsum"]
    src = JsonSource(cfg, output_root=ROOT / "images", ctx={"picsum_query": ""})
    data = [{"id": i, "author": f"Alan{i}", "width": 100 + i, "height": 200 + i,
             "download_url": f"https://picsum.photos/id/{i}", "url": f"https://picsum.photos/id/{i}"}
            for i in range(3)]
    items = src._extract_json(data, cfg["parse"])
    assert len(items) == 3, items
    tasks = src._build_tasks(items, [], set())
    assert tasks[0].url == "https://picsum.photos/id/0", tasks[0].url
    assert tasks[0].width == 100

    # picsum author filter
    src2 = JsonSource(cfg, output_root=ROOT / "images", ctx={"picsum_query": "Alan1"})
    tasks2 = src2._build_tasks(items, [], set())
    assert [t.author for t in tasks2] == ["Alan1"], tasks2
    print("  picsum json + filter ........ OK")

    # bing (html url_extract + post_replace)
    cfg = _CONFIGS["bing"]
    src = JsonSource(cfg, output_root=ROOT / "images", ctx={"query": "cat"})
    html = ('<a href="x">murl&quot;:&quot;https://img.example/1.jpg?a=1&amp;b=2&quot;</a>'
            '<a>murl:"https://img.example/2.png"</a>')
    items = src._extract_html(html, cfg["parse"])
    assert len(items) == 2, items
    tasks = src._build_tasks(items, [], set())
    assert tasks[0].url == "https://img.example/1.jpg?a=1&b=2", tasks[0].url
    assert tasks[1].url == "https://img.example/2.png"
    print("  bing html + post_replace .... OK")

    # deviantart (html block_extract)
    cfg = _CONFIGS["deviantart"]
    src = JsonSource(cfg, output_root=ROOT / "images", ctx={"query": "art", "sorting": "popular"})
    html = ('<item><title>My Art</title>'
            '<media:content url="https://orig.example/a.png" medium="image"/>'
            '<media:thumbnail url="https://thumb.example/a.jpg"/></item>')
    items = src._extract_html(html, cfg["parse"])
    assert len(items) == 1 and items[0]["title"] == "My Art", items
    tasks = src._build_tasks(items, [], set())
    assert tasks[0].url == "https://orig.example/a.png", tasks[0].url
    print("  deviantart block_extract ... OK")

    # reddit (json, is_image filter + preview fallback + cursor)
    cfg = _CONFIGS["reddit"]
    src = JsonSource(cfg, output_root=ROOT / "images",
                    ctx={"query": "earthporn", "mode": "sub"})
    data = {"data": {"after": "t3_xyz", "children": [
        {"data": {"url": "https://i.redd.it/x.png", "title": "T", "author": "u",
                  "id": "1", "subreddit": "r", "preview": {"images": [{"source": {"url": "https://preview.redd.it/y.png", "width": 10, "height": 20}}]}}},
        {"data": {"url": "https://example.com/notimage", "title": "T2", "author": "u2",
                  "id": "2", "subreddit": "r", "preview": {"images": [{"source": {"url": "https://preview.redd.it/z.png", "width": 5, "height": 6}}]}}},
    ]}}
    items = src._extract_json(data, cfg["parse"])
    assert len(items) == 2, items
    tasks = src._build_tasks(items, [], set())
    assert tasks[0].url == "https://i.redd.it/x.png", tasks[0].url
    assert tasks[1].url == "https://preview.redd.it/z.png", tasks[1].url  # fallback
    assert tasks[1].width == 5 and tasks[1].height == 6
    print("  reddit json + filters ...... OK")

    # pixiv (merge_keys + url transform)
    cfg = _CONFIGS["pixiv"]
    src = JsonSource(cfg, output_root=ROOT / "images",
                    ctx={"query": "miku", "order": "popular_d", "mode": "all"})
    data = {"body": {"illust": {"11": {"id": "11", "title": "I", "userName": "U",
                                       "width": 800, "height": 600,
                                       "url": "https://i.pximg.net/c/250x250_80_a2/img-master/img/1/master.jpg"}},
                     "manga": {"22": {"id": "22", "title": "M", "userName": "V",
                                      "width": 400, "height": 300,
                                      "url": "https://i.pximg.net/c/250x250_80_a2/img-master/img/2/master.jpg"}}}}
    items = src._extract_json(data, cfg["parse"])
    assert len(items) == 2, items
    tasks = src._build_tasks(items, [], set())
    assert tasks[0].url == "https://i.pximg.net/img-master/img/1/master.jpg", tasks[0].url
    print("  pixiv merge + transform .... OK")

    # lexica (template url)
    cfg = _CONFIGS["lexica"]
    src = JsonSource(cfg, output_root=ROOT / "images", ctx={"query": "cat"})
    data = {"images": [{"id": "abc", "prompt": "a cat", "a": "auth", "w": 512, "h": 512}]}
    items = src._extract_json(data, cfg["parse"])
    tasks = src._build_tasks(items, [], set())
    assert tasks[0].url == "https://image.lexica.art/full_jpg/abc", tasks[0].url
    print("  lexica template url ....... OK")

    # flickr alt (JSON feed, url_transform _m -> _b)
    cfg = _CONFIGS["flickr"]
    src = JsonSource(cfg, output_root=ROOT / "images", ctx={"query": "cat", "key": ""})
    act = src._active()
    assert act["request"].get("url", "").endswith("photos_public.gne"), act["request"]["url"]
    feed = {"items": [
        {"media": {"m": "https://live.staticflickr.com/123/abc_xyz_m.jpg"},
         "title": "T", "author": "A", "link": "x"},
        {"media": {"m": "https://live.staticflickr.com/9/def_ghi_m.jpg"},
         "title": "T2", "author": "B", "link": "y"},
    ]}
    items = src._extract_json(feed, act["parse"])
    tasks = src._build_tasks(items, [], set())
    assert len(tasks) == 2, tasks
    assert tasks[0].url.endswith("_b.jpg"), tasks[0].url
    print("  flickr alt json transform  OK")

    # wallhaven stop_path 位于 request.pagination（引擎据此终止翻页）
    cfg = _CONFIGS["wallhaven"]
    src = JsonSource(cfg, output_root=ROOT / "images",
                    ctx={"query": "space", "sorting": "toplist", "wallhaven_nsfw": False,
                         "key": "", "purity": "100"})
    assert src._active()["request"]["pagination"].get("stop_path") == "meta.last_page"
    print("  wallhaven stop_path ....... OK")

    # unsplash random mode -> list_path ""
    cfg = _CONFIGS["unsplash"]
    src = JsonSource(cfg, output_root=ROOT / "images", ctx={"query": "nature", "mode": "random", "key": ""})
    act = src._active()
    assert act["parse"].get("list_path", "") == "", act["parse"]
    print("  unsplash random mode ...... OK")


class _FakeResp:
    def __init__(self, data=None, text=""):
        self.status_code = 200
        self._data = data if data is not None else []
        self.text = text
    def json(self):
        return self._data


async def test_skip_empty():
    # artstation: 无 query 时 params.query 应在抓取期被丢弃（通过替换 _request 观察最终参数）
    captured = {}

    def make_src(name, ns):
        s = build_source(name, ns)
        async def fake_request(req, url, params, headers, body=None):
            captured[name] = dict(params)
            return _FakeResp()
        s._request = fake_request
        return s

    src = make_src("artstation", SimpleNamespace(
        max_images=5, concurrency=5, proxy=None, retries=3, rate_limit=0.0,
        speed_limit=0.0, query="", artstation_sorting="popular"))
    await src.fetch_tasks(5)
    assert "query" not in captured["artstation"], captured["artstation"]
    assert captured["artstation"].get("sorting") == "popular"
    print("  skip_empty_params ........ OK")

    # wallhaven: 无 key 时 apikey 应被丢弃
    src = make_src("wallhaven", SimpleNamespace(
        max_images=5, concurrency=5, proxy=None, retries=3, rate_limit=0.0,
        speed_limit=0.0, query="space", wallhaven_sorting="toplist",
        wallhaven_nsfw=False, wallhaven_key=""))
    await src.fetch_tasks(5)
    assert "apikey" not in captured["wallhaven"], captured["wallhaven"]
    print("  wallhaven apikey drop .... OK")


async def test_full_flow():
    # picsum 走完整 fetch_tasks（用假数据替换 _fetch_page，避免联网）
    cfg = _CONFIGS["picsum"]
    args = SimpleNamespace(max_images=250, concurrency=5, proxy=None, retries=3,
                           rate_limit=0.0, speed_limit=0.0, picsum_query="")
    src = build_source("picsum", args)
    page_data = [{"id": 1000 + i, "author": f"A{i}", "width": 100, "height": 200,
                  "download_url": f"https://picsum.photos/id/{1000+i}",
                  "url": f"https://picsum.photos/id/{1000+i}"} for i in range(50)]

    async def fake_fetch(active, page_val=None, cursor=None, override_query=None):
        # 每页返回不同 id，验证翻页 + 去重真实生效
        base = 1000 + (max(page_val, 1) - 1) * 50
        return [{"id": base + i, "author": f"A{i}", "width": 100, "height": 200,
                 "download_url": f"https://picsum.photos/id/{base+i}",
                 "url": f"https://picsum.photos/id/{base+i}"} for i in range(50)]

    src._fetch_page = fake_fetch
    tasks = await src.fetch_tasks(250)
    assert len(tasks) == 150, len(tasks)  # 3 pages * 50, 受数据量限制
    print(f"  picsum full flow ......... OK ({len(tasks)} tasks)")


def main():
    print(f"已加载源: {len(ALL_SOURCES)} -> {ALL_SOURCES}\n")
    assert len(ALL_SOURCES) == 28, f"期望 28 个源，实际 {len(ALL_SOURCES)}"

    probs = check_regexes()
    if probs:
        print("正则校验失败:")
        for p in probs:
            print(p)
        sys.exit(1)
    print("  全部 JSON 正则编译通过 ..... OK\n")

    test_extract_units()
    asyncio.run(test_skip_empty())
    asyncio.run(test_full_flow())
    print("\n全部自测通过 [OK]")


if __name__ == "__main__":
    main()
