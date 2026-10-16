# -*- coding: utf-8 -*-
"""P2 headless 验收 —— 服务实迁后的三方一致性 + 消费点接入 + 回滚。

三方一致性（同一期望值的三条路径）：
  ① golden fixture（scripts/p2_ctx_golden.json，P0 旧实现快照）
  ② 服务路径  ctx.sources.build_ctx(...)
  ③ legacy facade 路径  sources.registry._build_ctx(...)
预期：== P2_PARITY_OK == / == P2_FACADE_OK == / == P2_ROLLBACK_OK ==

运行：.venv/Scripts/python.exe scripts/p2_check.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from host.tree import WANT_P2, config_path, mount_tree  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "p2_ctx_golden.json")


class _NS:
    def __init__(self, **kw):
        self.__dict__.update(kw)


#: 与 P0 快照采集时完全一致的用例参数（黄金轨迹的契约，勿改）
CASES = {
    "bing": _NS(query="cyberpunk city", max_images=3, pages=3),
    "safebooru": _NS(tags="landscape", booru_rating="s", booru_limit=40,
                     booru_exclude="", max_images=3),
    "konachan": _NS(tags="art", booru_rating="s", booru_exclude="blood,gore",
                    max_images=3),
    "pixiv": _NS(query="x", pixiv_order="popular_d", pixiv_mode="all", max_images=3),
    "midjourney": _NS(tab="top", size="thumb", scrolls=20, headless=True,
                      max_images=3),
}
KEYS = {"unsplash": "K1", "flickr": "K2"}


async def _main() -> int:
    path = config_path("cordis.yml")
    ctx = await mount_tree(path, want=WANT_P2)

    # ---- ① 消费点接入：yml 值到达且被服务采用 ----
    print(f"[config] candidates_from_yaml={ctx.config.candidates_from_yaml} "
          f"n={len(ctx.config.proxy_candidates)}")
    assert ctx.config.candidates_from_yaml, "yml 的 proxy_candidates 未到达 config 服务"
    assert ctx.proxy is not None and callable(ctx.proxy.fetch_working_proxy)
    assert ctx.proxy.free_pages == 3 and ctx.proxy.prefer_socks is False, \
        "yml 的 proxy 配置未到达 proxy 服务"

    # ---- ② 三方一致性：fixture == 服务路径 == facade 路径 ----
    with open(FIXTURE, "r", encoding="utf-8") as f:
        golden = json.load(f)

    import sources.registry as facade_reg

    for name in golden:
        args = CASES[name]
        got_golden = golden[name]
        got_svc = ctx.sources.build_ctx(name, args, KEYS)
        got_facade = facade_reg._build_ctx(name, facade_reg._CONFIGS[name], args, KEYS)
        assert got_svc == got_golden, f"[{name}] 服务路径 ≠ golden"
        assert got_facade == got_golden, f"[{name}] facade 路径 ≠ golden"
    print(f"== P2_PARITY_OK ==  ({len(golden)} 用例：fixture == 服务 == facade)")

    # ---- ③ build_source 双路径一致 + 单一实现身份 ----
    args = CASES["bing"]
    src_svc = ctx.sources.build_source("bing", args)
    src_facade = facade_reg.build_source("bing", args)
    assert src_svc is not None and src_facade is not None
    assert (src_svc.name, src_svc.needs_proxy) == (src_facade.name, src_facade.needs_proxy) \
        == ("bing", False)
    assert src_svc.ctx == src_facade.ctx == golden["bing"]
    assert src_svc.max_images == 3

    import services.proxy as svc_proxy
    import proxy_fetcher as facade_pf
    assert facade_pf.ProxyItem is svc_proxy.ProxyItem, "proxy facade 未共享同一实现对象"
    assert facade_pf.fetch_working_proxy is svc_proxy.fetch_working_proxy

    # config 服务的显式代理短路（无网络）；facade 仍是同一函数
    import config as facade_cfg
    assert ctx.config.effective_proxy("socks5://example:1") == "socks5://example:1"
    assert facade_cfg.effective_proxy("http://example:2") == "http://example:2"
    print("== P2_FACADE_OK ==  (双路径一致 / proxy·config facade 共享单一实现)")

    # ---- ④ 回滚 ----
    loader = ctx.loader
    for options in list(loader.root.data):
        loader.root.remove(options["id"])
    for _ in range(20):
        await asyncio.sleep(0)
    gone = [n for n in WANT_P2 if getattr(ctx, n, None) is not None]
    assert not gone, f"dispose 后服务仍可达: {gone}"
    print("== P2_ROLLBACK_OK ==")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
