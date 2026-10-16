# -*- coding: utf-8 -*-
"""P6 验收 —— 入口切换（help 金标逐字节 / GUI 已删 / 打包配置更新 / shim 同一实现）。

① `--help` 逐字节对齐（scripts/p6_help_golden.txt 为金标；prog 固定 mj_scraper.py）
② gui_scraper.py 已删除且无 .py 引用
③ .spec ×2 / manifest.json 已切到 apps/cli
④ mj_scraper.py / run_video_sources.py shim 与 apps/* 共享同一 main / run_source
预期：== P6_HELP_OK == / == P6_DELETE_OK == / == P6_PACKAGING_OK == / == P6_SHIM_OK ==

运行：.venv/Scripts/python.exe scripts/p6_check.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENV_PY = str(ROOT / ".venv" / "Scripts" / "python.exe")


def _first_diff(a: str, b: str) -> str:
    for i, (ca, cb) in enumerate(zip(a, b)):
        if ca != cb:
            return (f"first diff @ {i}: golden={ca!r} got={cb!r}\n"
                    f"  golden …{a[max(0, i - 80):i + 80]!r}\n"
                    f"  got    …{b[max(0, i - 80):i + 80]!r}")
    return "（前缀相同，长度不同）"


def _run_help(target: str) -> str:
    r = subprocess.run([VENV_PY, target, "--help"], capture_output=True, text=True,
                       cwd=str(ROOT), timeout=120)
    assert r.returncode == 0, f"{target} --help 退出码 {r.returncode}: {r.stderr[:300]}"
    return r.stdout


def main() -> int:
    # ① help 金标逐字节
    golden = (ROOT / "scripts" / "p6_help_golden.txt").read_text(encoding="utf-8")
    got = _run_help("apps/cli/main.py")
    assert got == golden, ("apps/cli --help 与金标不一致：\n"
                           f"len(golden)={len(golden)} len(got)={len(got)}\n"
                           + _first_diff(golden, got))
    print("== P6_HELP_OK ==  (--help 与金标逐字节一致)")

    # ② GUI 已删除且无代码引用
    assert not (ROOT / "gui_scraper.py").exists(), "gui_scraper.py 仍存在"
    import re
    pat = re.compile(r"(?:^|\n)\s*(?:import|from)\s+gui_scraper\b")
    refs = []
    for p in ROOT.rglob("*.py"):
        rel = p.relative_to(ROOT).as_posix()
        if rel.startswith((".venv/", "vendor/", "build/", "dist/")) or rel == "scripts/p6_check.py":
            continue
        try:
            txt = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if pat.search(txt):
            refs.append(rel)
    assert not refs, f"仍有代码 import gui_scraper: {refs}"
    # 注：docstring 中的历史提及（"已随 P6 删除"）不算引用
    print("== P6_DELETE_OK ==  (gui_scraper.py 已删除，无 import 引用)")

    # ③ 打包配置更新
    for spec in ("image-scraper.spec", "image-scraper-dbg.spec"):
        t = (ROOT / spec).read_text(encoding="utf-8")
        assert "apps/cli/main.py" in t, f"{spec} 未切到 apps/cli"
        assert "vendor/cordis/src" in t, f"{spec} 缺 vendor pathex"
        assert "services.config" in t, f"{spec} 缺 services hiddenimports"
        assert "'playwright'" not in t, f"{spec} 仍在 excludes 里排 playwright"
    m = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert m["entry"] == "apps/cli/main.py", f"manifest entry = {m['entry']}"
    print("== P6_PACKAGING_OK ==  (spec ×2 + manifest 已切换)")

    # ④ shim 与 apps 共享同一实现（import 路径身份）
    sys.path.insert(0, str(ROOT))
    import apps.cli.main as app_cli
    import apps.video.main as app_video
    import mj_scraper as shim_cli
    import run_video_sources as shim_video
    assert shim_cli.main is app_cli.main
    assert shim_video.main is app_video.main
    assert app_video.run_source is app_cli.run_source
    print("== P6_SHIM_OK ==  (两个 shim 与 apps/* 共享同一实现)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
