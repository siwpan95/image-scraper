#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P7 总验收 —— 对 P0 黄金轨迹（golden/README.md）逐项 diff。

对照面（golden 清单 1-8 条）：
  ① 文件名规则：P0 时段 meta 的「url → filename」全量重算（同 P3 口径 + 同豁免清单）
     + 记录文件名必须在 images/ 落盘（跳过语义的物理基础未丢）
  ② meta 结构：{source,timestamp,stats,images[]}；images 项含 source/url/filename/local/meta
  ③ 跳过计数：01-05 重放的 downloaded+skipped==fetched 恒等式 + errors=0
  ④ CLI 契约：P0 原命令语法重放（help 逐字节断言在 scripts/p6_check.py，随总验收串跑）
  ⑤ 07 形态线：30/30 总览行（P0 附录：环境修复后浏览器源转正）/ errors 全零 /
     require_content_url 四源零抓取 / midjourney 成功形态
  ⑥ 08 重投：总1/成功1/失败0

运行：
  .venv/Scripts/python.exe scripts/p7_check.py --replay   # 完整重放（约 3-4 分钟）
  .venv/Scripts/python.exe scripts/p7_check.py            # 静态部分 + 复核上次重放结果

产物：
  scripts/p7_run_results.json   # 重放对照结果（入库存证）
  scripts/p7_run_logs/*.log     # 各命令完整日志（*.log 已被 .gitignore 覆盖）
预期：== P7_STATIC_OK == / == P7_REPLAY_OK == / == P7_COMPARE_OK ==
"""
from __future__ import annotations

import argparse
import glob
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

PY = sys.executable
EXPECT_PATH = ROOT / "scripts" / "p7_golden_expect.json"
RESULTS_PATH = ROOT / "scripts" / "p7_run_results.json"
LOGDIR = ROOT / "scripts" / "p7_run_logs"

SUMMARY_RE = re.compile(
    r"([A-Za-z0-9_]+)\s+\{'fetched': (\d+), 'downloaded': (\d+), 'skipped': (\d+), "
    r"'errors': (\d+), 'elapsed': ([\d.]+)\}"
)
RETRY_RE = re.compile(r"重试完成: 总 (\d+) \| 成功 (\d+) \| 失败 (\d+)")

#: P0 运行时段（2026-10-16 12:15-12:20）的 meta 文件
P0_META_GLOB = "meta/*_20261016_12*.json"


def _load_p3_allowlist() -> set:
    """复用 scripts/p3_check.py 的豁免清单（单一来源，勿复制）。"""
    spec = importlib.util.spec_from_file_location(
        "_p3_check_for_p7", str(ROOT / "scripts" / "p3_check.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return set(mod.ALLOWLIST)


def section_golden_corpus() -> None:
    """① P0 时段 meta 的 URL→filename 重算 + 落盘存在性。"""
    from services.downloader import Downloader, ImageTask

    dl = Downloader(ROOT / "images")
    allow = _load_p3_allowlist()

    files = [f for f in sorted(glob.glob(str(ROOT / P0_META_GLOB)))
             if not os.path.basename(f).startswith("failed")]
    if not files:
        print("[corpus] 警告：无 P0 时段（20261016_12*）meta —— 跳过（fresh clone 属预期）")
        return

    total = match = 0
    problems = []
    for fp in files:
        try:
            data = json.loads(Path(fp).read_text(encoding="utf-8"))
        except Exception:
            continue
        src0 = data.get("source") or ""
        for im in data.get("images", []):
            url = (im.get("url") or "").strip()
            fn = (im.get("filename") or "").strip()
            src = (im.get("source") or src0 or "").strip()
            if not url or not fn or not src:
                continue
            total += 1
            got = dl._make_filename(ImageTask(url=url, source=src))
            if got == fn:
                match += 1
            elif (url, fn) not in allow:
                problems.append(("RULE", src, fn, got))
            local = Path(im["local"]) if im.get("local") else (ROOT / "images" / src / fn)
            if not local.exists():
                problems.append(("MISSING", src, fn, str(local)))
    print(f"[corpus] P0 时段 meta={len(files)} 份 | pairs={total} rule_match={match} | "
          f"problems={len(problems)}")
    assert not problems, f"P0 黄金证据对照失败（前 4 条）: {problems[:4]}"


def section_meta_struct() -> None:
    """② meta 结构契约（P0 时段最新一份 + 全库最新一份）。"""
    p0 = [f for f in sorted(glob.glob(str(ROOT / P0_META_GLOB)))
          if not os.path.basename(f).startswith("failed")]
    allm = [f for f in sorted(glob.glob(str(ROOT / "meta" / "*.json")))
            if not os.path.basename(f).startswith("failed")]
    candidates = []
    if p0:
        candidates.append(Path(p0[-1]))
    if allm:
        candidates.append(Path(allm[-1]))
    if not candidates:
        print("[struct] 警告：meta/ 无记录 —— 跳过（fresh clone 属预期）")
        return
    for fp in candidates:
        d = json.loads(fp.read_text(encoding="utf-8"))
        assert {"source", "timestamp", "stats", "images"} <= set(d), (fp.name, list(d))
        assert {"fetched", "downloaded", "skipped", "errors"} <= set(d["stats"]), \
            (fp.name, d["stats"])
        for im in d["images"]:
            assert {"source", "url", "filename", "local", "meta"} <= set(im), \
                (fp.name, list(im))
        print(f"[struct] {fp.name}: source={d['source']} images={len(d['images'])} keys OK")


def run_command(entry: dict) -> dict:
    LOGDIR.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    t0 = time.time()
    try:
        proc = subprocess.run(
            [PY, "mj_scraper.py", *entry["args"]], cwd=str(ROOT), env=env,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=600)
        rc, out, err = proc.returncode, proc.stdout or "", proc.stderr or ""
    except subprocess.TimeoutExpired as exc:
        rc = -999
        out = (exc.stdout.decode("utf-8", "replace")
               if isinstance(exc.stdout, bytes) else (exc.stdout or ""))
        err = "TIMEOUT(600s)"
    wall = round(time.time() - t0, 1)
    output = out + (("\n[stderr]\n" + err) if err.strip() else "")

    log_path = LOGDIR / f"{entry['id']}.log"
    log_path.write_text(
        f"### CMD: mj_scraper.py {' '.join(entry['args'])}\n{output}\n"
        f"\nWALL={wall}s\nEXIT={rc}\n", encoding="utf-8")

    sources = {}
    for m in SUMMARY_RE.finditer(output):
        sources[m.group(1)] = {
            "fetched": int(m.group(2)), "downloaded": int(m.group(3)),
            "skipped": int(m.group(4)), "errors": int(m.group(5)),
            "elapsed": float(m.group(6)),
        }
    retry = RETRY_RE.search(output)
    return {
        "id": entry["id"], "desc": entry["desc"],
        "cmd": "mj_scraper.py " + " ".join(entry["args"]),
        "exit": rc, "wall": wall, "sources": sources,
        "retry": ({"total": int(retry.group(1)), "success": int(retry.group(2)),
                   "failed": int(retry.group(3))} if retry else None),
        "log": f"scripts/p7_run_logs/{entry['id']}.log",
    }


def compare(exp: dict, results: dict) -> list:
    runs = {r["id"]: r for r in results["runs"]}
    notes = []

    by_id = {e["id"]: e for e in exp["commands"]}

    # ---- 01-06：单源命令 ----
    for cid in ("01", "02", "03", "04", "05", "06"):
        e, r = by_id[cid], runs[cid]
        name = e["source"]
        assert r["exit"] == 0, f"[{cid}] EXIT={r['exit']}"
        s = r["sources"].get(name)
        assert s, f"[{cid}] 未解析到 [{name}] 总览行: {sorted(r['sources'])}"
        assert s["errors"] == 0, f"[{cid}] errors={s['errors']}"
        assert s["fetched"] == e["expect_fetched"], (
            f"[{cid}] fetched={s['fetched']}，期望 {e['expect_fetched']}（P0 值）"
            f" —— 若为站点行为漂移需人工裁定并记录")
        assert s["downloaded"] + s["skipped"] == s["fetched"], f"[{cid}] 恒等式破坏: {s}"
        p0v = e["p0"]
        notes.append(
            f"[{cid}] {e['desc']}: fetched={s['fetched']} downloaded={s['downloaded']} "
            f"skipped={s['skipped']} errors={s['errors']} elapsed={s['elapsed']}s "
            f"(P0: {p0v['fetched']}/{p0v['downloaded']}/{p0v['skipped']} @ {p0v['elapsed']}s)")

    # ---- 07：全源形态线 ----
    e7, r7 = by_id["07"], runs["07"]
    assert r7["exit"] == 0, f"[07] EXIT={r7['exit']}"
    srcs = r7["sources"]
    from sources.registry import ALL_SOURCES  # noqa: E402（与总览行逐名对照）
    missing = sorted(set(ALL_SOURCES) - set(srcs))
    assert len(srcs) == e7["require_sources"], \
        f"[07] 总览行 {len(srcs)}/30；缺: {missing}"
    bad = {n: s["errors"] for n, s in srcs.items() if s["errors"]}
    assert not bad, f"[07] 源级 errors 非零: {bad}"
    mj = srcs.get("midjourney", {})
    assert mj.get("fetched", 0) >= e7["midjourney_min_fetched"], (
        f"[07] midjourney fetched={mj.get('fetched')}（P1 修复环境后应为成功形态）")
    for n in e7["require_url_zero"]:
        assert srcs.get(n, {}).get("fetched", 0) == 0, \
            f"[07] {n} 应 0 抓取（require_content_url 无链接秒过）"
    nonzero = sorted(n for n, s in srcs.items() if s["fetched"] > 0)
    assert len(nonzero) >= 5, f"[07] 可达源过少: {nonzero}"
    gfw = {n: srcs.get(n, {}).get("fetched") for n in e7["gfw_expect_zero"]}
    notes.append(
        f"[07] 总览行 {len(srcs)}/30；可达源 {len(nonzero)} 个；"
        f"GFW 无代理零抓取 {gfw}；midjourney fetched={mj.get('fetched')}（成功形态）"
        f"；wall={r7['wall']}s")

    # ---- 08：重投 ----
    e8, r8 = by_id["08"], runs["08"]
    assert r8["exit"] == 0, f"[08] EXIT={r8['exit']}"
    assert r8["retry"] == e8["expect_retry"], f"[08] retry={r8['retry']}"
    notes.append(f"[08] 重投 {r8['retry']}（P0: 总1/成功1/失败0）")

    print("== P7_COMPARE_OK ==")
    for n in notes:
        print("   ", n)
    return notes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--replay", action="store_true", help="重放 P0 命令集（联网，约 3-4 分钟）")
    args = ap.parse_args()

    exp = json.loads(EXPECT_PATH.read_text(encoding="utf-8"))

    section_golden_corpus()
    section_meta_struct()
    print("== P7_STATIC_OK ==")

    if args.replay:
        print(f"[replay] 开始重放 P0 命令集（{len(exp['commands'])} 条）...")
        results = {"timestamp": time.strftime("%Y-%m-%d %H:%M:%S"), "runs": []}
        for entry in exp["commands"]:
            print(f"[replay] {entry['id']} {entry['desc']} ...", flush=True)
            r = run_command(entry)
            print(f"          exit={r['exit']} wall={r['wall']}s sources={len(r['sources'])}")
            results["runs"].append(r)
        print("== P7_REPLAY_OK ==")
        try:
            results["compare"] = {"ok": True, "notes": compare(exp, results)}
            rc = 0
        except AssertionError as exc:
            results["compare"] = {"ok": False, "error": str(exc)}
            print(f"[compare] 失败: {exc}")
            rc = 1
        RESULTS_PATH.write_text(
            json.dumps(results, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"[saved] {RESULTS_PATH.relative_to(ROOT)}")
        return rc

    if not RESULTS_PATH.exists():
        print("[replay] 无历史结果文件（先跑 --replay）—— 仅静态部分完成")
        return 0
    results = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
    print(f"[replay] 复核上次重放结果（{results.get('timestamp')}）")
    try:
        results["compare"] = {"ok": True, "notes": compare(exp, results)}
        rc = 0
    except AssertionError as exc:
        results["compare"] = {"ok": False, "error": str(exc)}
        print(f"[compare] 失败: {exc}")
        rc = 1
    results["reverified_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    RESULTS_PATH.write_text(
        json.dumps(results, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return rc


if __name__ == "__main__":
    sys.exit(main())
