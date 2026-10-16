# -*- coding: utf-8 -*-
"""配置树引导 —— cordis.yml → 「服务图」的共享入口（唯一挂载路径）。

（模式镜像 3dworld/world3d/host/tree.py：load_tree / await_ready / mount_tree 三件套。）

- load_tree(ctx, path)      挂载配置树（内含 Loader 子插件就绪所需的 drain 循环）
- await_ready(ctx, loader, want)  轮询等待「want 服务全部可达」
- mount_tree(path, want)    一行式：新建 Context → 挂树 → 等就绪 → 返回 ctx

apps/*（P6 起）与 scripts/mount_check.py（headless 验收）调用同一 mount_tree ——
「怎么挂的 = 怎么验的」，接线只有这一份。

安全（配置即代码）：cordis 的 Loader 把每条 entry 的 name 直接交给
importlib.import_module（见 vendor/cordis/src/cordis/loader.py）——改一行 yml
等于改一段可执行代码。因此这里强制 **name 白名单**，本仓只允许 services.*。
"""
from __future__ import annotations

import asyncio
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)  # 供 entry name（services.*）经 importlib 解析

import _cordis_locate  # noqa: E402

_cordis_locate.ensure()

import yaml  # noqa: E402
from cordis import Context, Loader  # noqa: E402

CONFIG_DIR = os.environ.get("IMGSCRAPER_CONFIGS") or ROOT

#: P1 就绪所需的服务集（config + sources）
WANT_P1 = ("config", "sources")
#: P2 就绪所需的服务集（+ proxy；服务实迁后的验收集）
WANT_P2 = ("config", "proxy", "sources")
#: P3 就绪所需的服务集（+ downloader + meta；有状态服务实迁后的验收集）
WANT_P3 = ("config", "proxy", "downloader", "meta", "sources")

ALLOWED_NAME_PREFIXES = ("services.",)
ALLOWED_NAME_EXACT = ("@cordisjs/plugin-group",)


def config_path(name: str) -> str:
    """配置树文件路径（name 如 'cordis.yml'）。"""
    return os.path.join(CONFIG_DIR, name)


def _validate_entry_names(data, path: str) -> None:
    """拒绝白名单之外的 entry name（它们会被 cordis 当模块名导入）。"""
    if not isinstance(data, list):
        return
    for i, entry in enumerate(data):
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        if not isinstance(name, str):
            continue
        if name in ALLOWED_NAME_EXACT or name.startswith(ALLOWED_NAME_PREFIXES):
            continue
        raise ValueError(
            f"配置树 {path} 第 {i} 条 entry 的 name={name!r} 不在白名单内 —— "
            f"entry name 会被 cordis 直接 import，等同于执行代码。"
            f"允许前缀：{ALLOWED_NAME_PREFIXES}；允许精确值：{ALLOWED_NAME_EXACT}。"
        )


async def load_tree(ctx, path: str):
    """用 cordis 原生 Loader 把 cordis.yml 挂载为服务图。

    Loader 内部会自动注册 isolate 等子插件——必须先把事件循环 drain 几轮，
    等这些子插件就绪再 root.update()，否则首条 entry 建好时会因 _isolate
    尚未提供而抛 KeyError（该坑已由 3dworld 试点三 headless 运行实证）。
    """
    if not os.path.isfile(path):
        raise FileNotFoundError(f"配置树不存在: {path}")
    await ctx.plugin(Loader)
    loader = ctx.loader
    for _ in range(16):
        await asyncio.sleep(0)
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    _validate_entry_names(data, path)
    await loader.root.update(data)
    return loader


async def await_ready(ctx, loader, want=(), timeout: float = 8.0) -> bool:
    """等待 want 中的服务全部可达（轮询 loader.await_()）。"""
    want = tuple(want)
    dt = 1.0 / 60.0
    elapsed = 0.0
    while elapsed < timeout:
        await loader.await_()
        await asyncio.sleep(0)
        if all(getattr(ctx, n, None) is not None for n in want):
            return True
        elapsed += dt
    missing = [n for n in want if getattr(ctx, n, None) is None]
    raise RuntimeError(
        f"配置树未在 {timeout}s 内就绪；缺失服务: {missing}\n"
        "  提示：cordis Loader 会吞掉插件构造期异常 —— 服务不就绪时，"
        "手工 import 该 entry 的 name（如 `import services.config`）可看到真实 traceback。"
    )


async def mount_tree(path: str, want=(), timeout: float = 8.0):
    """一行式引导：新建 Context、按 cordis.yml 挂载、等到就绪，返回 ctx。"""
    ctx = Context()
    loader = await load_tree(ctx, path)
    if want:
        await await_ready(ctx, loader, want, timeout)
    return ctx


__all__ = [
    "CONFIG_DIR", "WANT_P1", "WANT_P2",
    "config_path", "load_tree", "await_ready", "mount_tree",
]
