# -*- coding: utf-8 -*-
"""P1 headless 验收 —— 配置树装配 + 服务可达 + 配置传递断言 + 回滚断言。

运行：.venv/Scripts/python.exe scripts/mount_check.py
预期：== P1_MOUNT_OK == / == P1_ROLLBACK_OK ==

（硬点模式取自 3dworld/world3d/cli/config_boot.py：配置传递断言 + dispose 回滚断言。）
"""
from __future__ import annotations

import asyncio
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from host.tree import WANT_P1, config_path, mount_tree  # noqa: E402


async def _main() -> int:
    path = config_path("cordis.yml")
    print(f"[mount] {path}")
    ctx = await mount_tree(path, want=WANT_P1)

    # ---- ① 配置传递断言：yml 声明值必须到达服务 ----
    import yaml

    with open(path, "r", encoding="utf-8") as f:
        declared = {e["id"]: (e.get("config") or {}) for e in yaml.safe_load(f)}

    cand = ctx.config.proxy_candidates
    print(f"[config] proxy_candidates {len(cand)} 项 "
          f"(yml 声明 {len(declared['config']['proxy_candidates'])} 项, "
          f"from_yaml={ctx.config.candidates_from_yaml})")
    assert cand == declared["config"]["proxy_candidates"], "yml 的 proxy_candidates 未到达 config 服务"
    import config as legacy_config

    assert cand == list(legacy_config.PROXY_CANDIDATES), "yml 值与该服务当前默认（legacy 常量）不一致"
    assert isinstance(ctx.config.persisted, dict), "config.json 读取失败"

    # ---- ② sources 服务：源注册表可用 ----
    names = ctx.sources.names
    assert names and names == sorted(names), f"源列表异常: {names[:5]}"
    print(f"[sources] count={len(names)} first={names[0]} last={names[-1]}")
    assert ctx.sources.json_dir == declared["sources"]["json_dir"], "yml 的 json_dir 未到达 sources 服务"
    import sources.registry as legacy_registry

    assert names == list(legacy_registry.ALL_SOURCES), "服务源列表与 legacy 注册表不一致"

    # ---- ③ 模块唯一性（无双副本）----
    loaded = sorted(k for k in sys.modules
                    if k in ("config", "services.config", "sources",
                             "sources.registry", "services.source_registry"))
    print(f"[modules] {loaded}")
    assert "services.config" in loaded and "config" in loaded
    assert sys.modules["services.config"].__name__ == "services.config"

    print("== P1_MOUNT_OK ==")

    # ---- ④ 回滚断言：dispose 全部 entry → 服务不可达 ----
    loader = ctx.loader
    for options in list(loader.root.data):
        loader.root.remove(options["id"])
    for _ in range(20):
        await asyncio.sleep(0)
    gone = [n for n in WANT_P1 if getattr(ctx, n, None) is not None]
    assert not gone, f"dispose 后服务仍可达（回滚不彻底）: {gone}"
    print("== P1_ROLLBACK_OK ==")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
