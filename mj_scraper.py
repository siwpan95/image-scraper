#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""多源图片爬虫 · 统一启动器（facade）—— P6 起实现迁入 `apps/cli/main.py`。

保留本入口以兼容既有调用（文档 / 自动化 / 肌肉记忆）：
行为与 apps/cli 完全一致（argparse 契约以 scripts/p6_help_golden.txt 为金标，逐字节对齐）。
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from apps.cli.main import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
