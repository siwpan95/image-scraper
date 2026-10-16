# -*- coding: utf-8 -*-
"""P5 headless 验收 —— engine 服务化（三路径分类矩阵 + 单一实现身份 + 离线行为 + 回滚）。

① 三路径分类矩阵：30 源 × 7 项原始判定（driver/needs_browser/needs_proxy/fetch/
   require_content_url/is_browser_html/alt_wants_browser_html），与搬迁前基线 fixture 逐项一致
  （矩阵覆盖 run() 的四条分派：http / curl / browser-api / browser-html）
② 单一实现身份：sources.engine.* is services.engine.*（含 selftest 在用的工具函数）
③ classify 分派语义抽查（四类路径各 ≥1 例）
④ 工具函数 / 实例方法离线 spot check
⑤ 回滚
预期：== P5_MATRIX_OK == / == P5_IDENTITY_OK == / == P5_CLASSIFY_OK == / == P5_SPOT_OK == / == P5_ROLLBACK_OK ==

运行：.venv/Scripts/python.exe scripts/p5_check.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from host.tree import WANT_P5, config_path, mount_tree  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "p5_path_matrix.json")


class _NS:
    def __init__(self, **kw):
        self.__dict__.update(kw)


async def _main() -> int:
    ctx = await mount_tree(config_path("cordis.yml"), want=WANT_P5)

    # ---- ① 三路径分类矩阵（30 源 × 7 项，与搬迁前基线逐项一致）----
    from sources.registry import _CONFIGS, build_source

    with open(FIXTURE, "r", encoding="utf-8") as f:
        base = json.load(f)
    assert len(base) == len(_CONFIGS) == 30, \
        f"源数变化: fixture={len(base)} 现有={len(_CONFIGS)}"

    diffs = []
    for name, want in base.items():
        src = build_source(name, _NS(max_images=1))
        got = {
            "driver": src.cfg.get("driver"),
            "needs_browser": bool(src.needs_browser),
            "needs_proxy": bool(src.needs_proxy),
            "fetch": src.cfg.get("fetch"),
            "require_content_url": bool(src.cfg.get("require_content_url")),
            "is_browser_html": bool(src._is_browser_html()),
            "alt_wants_browser_html": bool(src._alt_wants_browser_html()),
        }
        if got != want:
            diffs.append((name, want, got))
    assert not diffs, f"分类矩阵出现漂移: {diffs[:3]}"
    print(f"== P5_MATRIX_OK ==  ({len(base)} 源 × 7 项逐项一致)")

    # ---- ② 单一实现身份 ----
    import services.engine as svc_eng
    import sources
    import sources.engine as fac_eng
    import sources.registry as reg

    assert fac_eng.JsonSource is svc_eng.JsonSource
    for fn in ("_subst", "_subst_any", "_get_path", "_to_int",
               "_check_filter", "_apply_transforms", "_apply_extractor", "_deep_merge"):
        assert getattr(fac_eng, fn) is getattr(svc_eng, fn), fn
    assert ctx.engine.source_class is not None
    # ctx.<服务> 为 Traceable 代理：可调用属性（类也是 callable）会被包一层 self 注入代理，
    # 身份需取 __wrapped__ 再比对（cordis 语义，非本项目缺陷）
    sc = ctx.engine.source_class
    assert getattr(sc, "__wrapped__", sc) is svc_eng.JsonSource
    assert sources.JsonSource is svc_eng.JsonSource          # __init__ 懒导出一致
    assert sources.build_source is reg.build_source          # __init__ 懒导出一致
    print("== P5_IDENTITY_OK ==  (facade is services / sources 懒导出 / 服务引用)")

    # ---- ③ classify 抽查（四路径覆盖）----
    cases = {
        "midjourney": "browser-api",
        "google": "browser-html",
        "bing": "http",
        "pixabay_illustration": "curl",
        "midjourney_url": "require-url",
    }
    for name, want in cases.items():
        got = ctx.engine.classify_by_name(name)
        assert got == want, f"classify({name}) = {got} != {want}"
    print(f"== P5_CLASSIFY_OK ==  ({len(cases)} 例覆盖四路径)")

    # ---- ④ 离线 spot check ----
    assert svc_eng._subst("a{query}b", {"query": "x"}) == "axb"
    assert svc_eng._subst("a{zzz}b", {}) == "a{zzz}b"
    assert svc_eng._subst_any({"a": "{q}", "b": ["{q}"]}, {"q": "V"}) == {"a": "V", "b": ["V"]}
    assert svc_eng._get_path({"a": {"b": [10, 20]}}, "a.b.1") == 20
    assert svc_eng._get_path({}, "x.y") is None
    assert svc_eng._to_int("1,234") == 1234
    assert svc_eng._to_int(None, 5) == 5
    assert svc_eng._to_int("zz", 7) == 7
    assert svc_eng._check_filter({"is_image": True}, "https://x/a.JPG?q=1", {}) is True
    assert svc_eng._check_filter({"is_image": True}, "https://x/a.html", {}) is False
    assert svc_eng._check_filter({"is_image": True}, "https://i.redd.it/abc", {}) is True
    assert svc_eng._apply_transforms("ABC", [{"op": "lower"}], {}) == "abc"
    assert svc_eng._apply_transforms("7", [{"op": "to_int"}], {}) == 7

    src = build_source("bing", _NS(max_images=3))
    assert src._resolve_int(None) == 1
    assert src._resolve_int("zz", 7) == 7
    assert src._resolve_int("{max_images}") == 3
    src._last_json = {"total": 5}
    assert src._stop_page({"stop_path": "total"}, 5) is True
    assert src._stop_page({"stop_path": "total"}, 4) is False
    src._last_json = {"cursor": "cur1"}
    assert src._next_cursor({"cursor_path": "cursor"}) == "cur1"
    assert src._next_cursor({}) is None
    print("== P5_SPOT_OK ==  (工具函数 + 实例方法)")

    # ---- ⑤ 回滚 ----
    loader = ctx.loader
    for options in list(loader.root.data):
        loader.root.remove(options["id"])
    for _ in range(20):
        await asyncio.sleep(0)
    gone = [n for n in WANT_P5 if getattr(ctx, n, None) is not None]
    assert not gone, f"dispose 后服务仍可达: {gone}"
    print("== P5_ROLLBACK_OK ==")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
