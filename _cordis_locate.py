# -*- coding: utf-8 -*-
"""vendored cordis 的统一定位入口（clean clone 不再需要手工接线）。

（模式取自 3dworld/world3d/_cordis_locate.py，按本仓布局收窄。）

定位顺序：
  ① 已被安装 / 已被 .pth 暴露（推荐：.venv/Lib/site-packages/zz_vendor_cordis.pth）
  ② 环境变量 CORDIS_SRC（显式覆盖，须过 isdir 校验）
  ③ 仓库内 vendor/cordis/src（由 __file__ 绝对推导，不接受外部输入）

失败时报错文案必须携带真实根因：ImportError（没找到）与「cordis 已找到但缺依赖
pyyaml / watchdog」是两回事——后者若被统一改写成前者，会给出"永远无效的修复指令"。
（缺 watchdog 的典型症状是 "TypeError: NoneType takes no arguments"：cordis/hmr.py
把未安装 watchdog 时的 None 当基类使用，抛的不是 ImportError。）
"""
from __future__ import annotations

import importlib
import importlib.util
import os
import sys

__all__ = ["ensure", "locate", "repo_root", "vendor_dir"]

_VENDOR_PARTS = ("vendor", "cordis", "src")


def repo_root() -> str:
    """本仓仓库根（本文件就在根目录）。"""
    return os.path.dirname(os.path.abspath(__file__))


def vendor_dir() -> str:
    """仓库内 vendored cordis 的源码目录（vendor/cordis/src）。"""
    return os.path.join(repo_root(), *_VENDOR_PARTS)


def _find_spec():
    """importlib.util.find_spec('cordis') 的安全包装（不真正导入）。"""
    try:
        return importlib.util.find_spec("cordis")
    except (ImportError, ValueError, AttributeError):
        return None


def locate():
    """返回可用的 cordis 源码目录；都不存在时返回 None。"""
    env = os.environ.get("CORDIS_SRC")
    if env and os.path.isdir(env) and os.path.isdir(os.path.join(env, "cordis")):
        return env
    v = vendor_dir()
    if os.path.isdir(v) and os.path.isdir(os.path.join(v, "cordis")):
        return v
    return None


def _import_or_raise(where: str, strict: bool) -> bool:
    try:
        importlib.import_module("cordis")
        return True
    except (ImportError, TypeError) as exc:
        if not strict:
            return False
        raise ImportError(
            f"[cordis] cordis 已定位到 {where}，但导入失败 —— 几乎总是它自身的依赖缺失"
            f"（pyyaml / watchdog）：{exc.__class__.__name__}: {exc}。"
            f"请执行：.venv/Scripts/python.exe -m pip install pyyaml watchdog。"
            f'提示：缺 watchdog 的典型症状是 "TypeError: NoneType takes no arguments"。'
        ) from exc


def ensure(strict: bool = True) -> bool:
    """确保 cordis 可 import；必要时把 vendored 源码目录加入 sys.path。"""
    # ① 已被安装或被 .pth 暴露
    if _find_spec() is not None:
        return _import_or_raise("已安装 / 已被 .pth 暴露", strict)

    # ② CORDIS_SRC 或仓库内 vendor/cordis/src
    d = locate()
    if d is not None:
        if d not in sys.path:
            sys.path.insert(0, d)
        if _find_spec() is not None:
            return _import_or_raise(d, strict)

    if not strict:
        return False
    raise ImportError(
        f"[cordis] 未找到 cordis 包。已尝试 CORDIS_SRC={os.environ.get('CORDIS_SRC')!r} "
        f"与仓库内 {vendor_dir()}。"
    )
