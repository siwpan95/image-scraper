# -*- coding: utf-8 -*-
"""P3 headless 验收 —— downloader/meta-store 服务化后的规则一致性 + 单一实现身份 + 回滚。

四层证据：
  ① 文件名规则全量语料 diff：历史 meta 中 12800+ 对「url → filename」重算，
     豁免清单之外的新不匹配必须为零（规则回归即红）
  ② 硬编码黄金样例（5 源各一，取自真实落盘记录）逐字符比对
  ③ 单一实现身份（facade is services）+ 离线行为微测试（跳过语义 / 推导函数）
  ④ 元数据落盘结构（save_meta / save_failed / failed_retry 前缀）
预期：== P3_RULE_OK == / == P3_CORPUS_OK == / == P3_FACADE_OK == / == P3_ROLLBACK_OK ==

运行：.venv/Scripts/python.exe scripts/p3_check.py
"""
from __future__ import annotations

import asyncio
import glob
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from host.tree import WANT_P3, config_path, mount_tree  # noqa: E402

#: 已知豁免：历史期命名 / 回退路径痕迹，规则重算必然不同名（**勿新增**，新增即规则回归）
ALLOWLIST = {
    # w/h 变体纳入文件名是 2026-07-07 之后引入的规则；该记录属旧命名时代
    ("https://tse4-mm.cn.bing.net/th/id/OIP-C.337QI5biXGzK3FnaO6lgzwHaKQ"
     "?w=133&h=184&c=7&r=0&o=7&pid=1.7&rm=3", "bing_1d0b5184dea4.jpg"),
    # 下载期格式回退成功（.png→.webp）的实名字
    ("https://brainpod.ai/wp-content/uploads/2024/12/ai-art-generator-software-3203174.png",
     "bing_b26d90e00276.webp"),
    # 同上（.jpg→.webp 回退）
    ("https://clintlosee.com/supergreenlizard/wp-content/uploads/2015/12/"
     "Wild-Beauty-Landscape-Photography.jpg", "bing_31d0780cede4.webp"),
    # MJ 浏览器路径按 size=original 下载 .png；meta.url 记的是缩略图 URL（两字段不同源）
    ("https://cdn.midjourney.com/26e24c62-cff2-46f3-b4f0-b2610f00f909/0_3_384_N.webp",
     "midjourney_569b55a28c55.png"),
}

#: 黄金样例（5 源各一，取自真实落盘记录；规则契约，勿改）
GOLDEN_CASES = [
    ("bing", "https://imgs.hbsztv.com/2023/pic/c71eda17095e9a92e300ca207f09c778.jpg",
     "bing_4f3e79766b33.jpg"),
    ("duitang", "https://a-ho-img.dtstatic.com/uploads/item/201910/17/20191017181550_jnX8a.jpeg",
     "duitang_cd06e646da55.jpeg"),
    ("safebooru", "https://safebooru.org/images/816/27b6c56e46291fdcb43cc51daa0c6cbd.png",
     "safebooru_79abca0024b3.png"),
    ("giphy", "https://media.giphy.com/media/gkKV7UeG9r0QQYlvxc/giphy.gif",
     "giphy_1423bec8318f.gif"),
    ("surfcg", "https://img.art.shenyecg.com/Work/f452abf844eb45cba8d736b4ee94e0f7/"
               "BzRYAjHeNS.png", "surfcg_e4fe18338942.png"),
]


async def _main() -> int:
    ctx = await mount_tree(config_path("cordis.yml"), want=WANT_P3)

    # ---- ① yml 消费点到达 + 单一实现身份 ----
    assert ctx.downloader.concurrency == 5 and ctx.downloader.retries == 3
    assert ctx.meta.meta_dir == Path(ROOT) / "meta"
    print(f"[services] downloader(conc={ctx.downloader.concurrency}, "
          f"retries={ctx.downloader.retries}) meta_dir={ctx.meta.meta_dir.name}")

    import services.downloader as svc_dl
    import services.meta_store as svc_meta
    import sources.base as facade_base

    assert facade_base.Downloader is svc_dl.Downloader
    assert facade_base.ImageTask is svc_dl.ImageTask
    assert facade_base.SourceStats is svc_dl.SourceStats
    assert facade_base.log is svc_dl.log
    assert facade_base.MEDIA_EXTS is svc_dl.MEDIA_EXTS

    tmp = Path(tempfile.mkdtemp())
    dl = svc_dl.Downloader(tmp)

    # ---- ② 黄金样例逐字符 ----
    for src, url, want_fn in GOLDEN_CASES:
        got = dl._make_filename(svc_dl.ImageTask(url=url, source=src))
        assert got == want_fn, f"[{src}] {got} != {want_fn}"
    print(f"== P3_RULE_OK ==  ({len(GOLDEN_CASES)} 黄金样例逐字符一致)")

    # ---- ③ 全量语料 diff ----
    total = match = 0
    new_mismatch = []
    for fp in sorted(glob.glob(os.path.join(ROOT, "meta", "*.json"))):
        if os.path.basename(fp).startswith("failed"):
            continue
        try:
            data = json.loads(Path(fp).read_text(encoding="utf-8"))
        except Exception:
            continue
        for im in data.get("images", []):
            fn = (im.get("filename") or "").strip()
            url = (im.get("url") or "").strip()
            src = (im.get("source") or data.get("source") or "").strip()
            if not fn or not url or not src:
                continue
            total += 1
            got = dl._make_filename(svc_dl.ImageTask(url=url, source=src))
            if got == fn:
                match += 1
            elif (url, fn) not in ALLOWLIST:
                new_mismatch.append((src, url[:80], fn, got))
    rate = 100.0 * match / total if total else 0.0
    print(f"[corpus] total={total} match={match} mismatch={total - match} rate={rate:.3f}%")
    assert not new_mismatch, f"出现豁免清单之外的新不匹配（规则回归！）: {new_mismatch[:3]}"
    assert rate >= 99.9, f"语料匹配率低于 99.9%: {rate:.3f}%"
    print("== P3_CORPUS_OK ==  (豁免清单外零不匹配)")

    # ---- ④ 离线行为微测试 ----
    # 跳过语义：预置同名文件 → skipped+1 / downloaded=True，无网络
    t = svc_dl.ImageTask(url="https://example.com/skip-test.jpg", source="skip_src")
    fn = dl._make_filename(t)
    (tmp / fn).write_bytes(b"x")
    dl2 = svc_dl.Downloader(tmp)
    stats = svc_dl.SourceStats()
    await dl2.download_batch([t], stats)
    assert stats.skipped == 1 and stats.downloaded == 0 and t.downloaded is True
    assert not dl2.failed
    await dl2.close()

    # 推导函数
    assert svc_dl.Downloader._guess_ext("https://x/a.png?q=1") == ".png"
    assert svc_dl.Downloader._guess_ext("https://x/a.MP4") == ".mp4"
    assert svc_dl.Downloader._guess_ext("https://x/a") == ".jpg"
    assert svc_dl.Downloader._fallbacks("https://x/a.png") == [
        "https://x/a.webp", "https://x/a.jpg", "https://x/a.jpeg"]
    assert svc_dl.Downloader._derive_referer("https://cdn.x.com/a.jpg") == "https://cdn.x.com/"

    # 工厂：yml 默认 + 逐参覆盖
    d = ctx.downloader.create(tmp, concurrency=9)
    assert isinstance(d, svc_dl.Downloader) and d.concurrency == 9 and d.retries == 3

    # ---- ⑤ 元数据落盘结构 ----
    stats2 = svc_dl.SourceStats()
    stats2.start_time = stats2.end_time = 0.0
    stats2.downloaded = 1
    task = svc_dl.ImageTask(url="https://example.com/f.jpg", source="meta_test",
                            title="t", local_path=str(tmp / "f.jpg"), downloaded=True)
    p = svc_meta.save_meta(tmp / "meta", "meta_test", [task], stats2)
    d1 = json.loads(p.read_text(encoding="utf-8"))
    assert set(d1) >= {"source", "timestamp", "stats", "images"}
    assert d1["source"] == "meta_test" and d1["stats"]["downloaded"] == 1
    assert len(d1["images"]) == 1 and d1["images"][0]["filename"] == "f.jpg"

    p2 = ctx.meta.save_failed("meta_test", [{"url": "x"}], prefix="failed_retry",
                              meta_dir=tmp / "meta")
    d2 = json.loads(p2.read_text(encoding="utf-8"))
    assert d2["count"] == 1 and d2["source"] == "meta_test"
    assert p2.name.startswith("failed_retry_meta_test_")
    print("== P3_FACADE_OK ==  (身份一致 / 跳过语义 / 推导函数 / 落盘结构)")

    # ---- ⑥ 回滚 ----
    loader = ctx.loader
    for options in list(loader.root.data):
        loader.root.remove(options["id"])
    for _ in range(20):
        await asyncio.sleep(0)
    gone = [n for n in WANT_P3 if getattr(ctx, n, None) is not None]
    assert not gone, f"dispose 后服务仍可达: {gone}"
    print("== P3_ROLLBACK_OK ==")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
