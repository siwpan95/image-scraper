# -*- coding: utf-8 -*-
"""运行基目录判定（冻结 / 源码双形态）—— exe 打包与源码运行共用。

- 源码运行：``base_dir()`` = 仓库根（本文件所在目录）
- 冻结运行（PyInstaller，``sys.frozen``）：``base_dir()`` = **可执行文件所在目录**

为什么需要：冻结模式下包的 ``__file__`` 指向临时解压区（``_MEIPASS``）——只读资产
（``cordis.yml`` / ``sources/json``，经 spec 的 datas 随包）放那里没问题；但**可写产出**
（``images/`` / ``meta/`` / ``config.json`` / ``scraper.log``）若落在 ``_MEIPASS``
会随进程退出蒸发，必须锚定到 exe 旁（便携式布局：exe 放可写目录运行）。

（P7 后收尾引入，支撑 v2.0.0 发行版打包；不改变源码运行行为——
非冻结时返回路径与各模块原 ``ROOT`` 完全一致。）
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

__all__ = ["is_frozen", "base_dir", "apply_frozen_defaults"]


def is_frozen() -> bool:
    """是否运行于 PyInstaller 冻结环境。"""
    return bool(getattr(sys, "frozen", False))


def base_dir() -> Path:
    """可写产出的根目录：冻结 = exe 所在目录；源码 = 仓库根。"""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def apply_frozen_defaults() -> None:
    """冻结（exe）运行时的启动默认值（幂等；源码运行直接返回）：

    ① stdout/stderr 固定 UTF-8 —— PyInstaller 引导器不采纳 PYTHONUTF8 /
       PYTHONIOENCODING（实测），重定向输出时中文会退回 ANSI 代码页（中文 Windows
       为 cp936），在 UTF-8 终端（git-bash / Windows Terminal / VS Code）显示为乱码。
    ② PLAYWRIGHT_BROWSERS_PATH 默认指向用户缓存（%LOCALAPPDATA%\\ms-playwright）——
       playwright 对 PyInstaller 冻结应用会 setdefault("0")，即改找「驱动旁内置」
       （driver/package/.local-browsers）；本发行版**不随包浏览器内核**（体量考虑），
       故显式对齐源码模式的用户缓存。用户显式设置过该变量则尊重之（setdefault 语义）。
    """
    if not is_frozen():
        return
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:
            pass
    if not os.environ.get("PLAYWRIGHT_BROWSERS_PATH"):
        local = os.environ.get("LOCALAPPDATA")
        if local:
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(local, "ms-playwright")
