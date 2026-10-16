#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""定时运行「视频源」: pixabay_video + midjourney_video（facade）—— P6 起实现迁入 `apps/video/main.py`。

保留本入口以兼容既有调用（自动化记忆里的调用路径不变），行为与 apps/video 一致。
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from apps.video.main import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
