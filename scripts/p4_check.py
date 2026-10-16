# -*- coding: utf-8 -*-
"""P4 headless 验收 —— browser 服务双模式（launch / CDP）+ 清理语义 + 配置接线。

四段：
  A 静态接线：yml → 服务 → 模块级 active（声明即生效）；服务可访问
  B launch 模式实跑（无头 chromium）：data: URL → 标题 / webdriver=False（stealth 生效）→ aclose
  C CDP 模式实跑（自拉本地 Chrome/Edge）：
      spawn --remote-debugging-port=9223 --user-data-dir=<tmp>
      → /json/version 探活 → connect_over_cdp → **复用已有上下文** → data: URL 标题
      → aclose() → **断言 Chrome 进程仍存活**（清理绝不动用户浏览器）→ 收尾 kill
  D 回滚：dispose 全部 entry → 服务不可达
预期：== P4_WIRE_OK == / == P4_LAUNCH_OK == / == P4_CDP_OK ==（找不到浏览器则 P4_CDP_SKIP） / == P4_ROLLBACK_OK ==

运行：.venv/Scripts/python.exe scripts/p4_check.py
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from host.tree import WANT_P4, config_path, mount_tree  # noqa: E402

CHROME_CANDIDATES = [
    os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
    os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
    os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
]

CDP_PORT = 9223
CDP_URL = f"http://127.0.0.1:{CDP_PORT}"


def find_chromium():
    for p in CHROME_CANDIDATES:
        if p and os.path.isfile(p):
            return p
    return None


def wait_cdp(url: str, timeout: float = 20.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url + "/json/version", timeout=2) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            time.sleep(0.5)
    return None


def kill_by_profile(profile_dir: str) -> None:
    """按 --user-data-dir 标记精确清理本次自拉的 Chrome/Edge（不碰用户其它实例）。

    注：Windows 上 Popen 回来的 chrome.exe 是启动器（随后退出，真浏览器在子进程），
    因此清理与判活都必须以「CDP 端点 / 命令行标记」为准，不能依赖 proc.poll()
    （实验记录见工作区 _p4_cdp_debug.py）。
    """
    marker = os.path.basename(profile_dir)
    ps = (
        "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='msedge.exe'\" | "
        f"Where-Object {{ $_.CommandLine -like '*{marker}*' }} | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
    )
    try:
        subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                       timeout=30, capture_output=True)
    except Exception:
        pass


async def _main() -> int:
    ctx = await mount_tree(config_path("cordis.yml"), want=WANT_P4)

    import services.browser as svc_browser

    # ---- A 静态接线：yml → 服务 → 模块级 active ----
    cfg = svc_browser.active_config()
    assert cfg["headless"] is True and cfg["stealth"] is True
    assert cfg["cdp"]["enabled"] is False and cfg["cdp"]["url"] == "http://127.0.0.1:9222"
    assert cfg["cdp"]["stealth"] is False
    assert ctx.browser.applied is True and ctx.browser.cdp_enabled is False
    print("== P4_WIRE_OK ==  (yml→服务→active: mode=launch, stealth=True)")

    from playwright.async_api import async_playwright

    # ---- B launch 模式实跑 ----
    async with async_playwright() as pw:
        s = await svc_browser.open_session(pw, proxy=None, headless=True)
        assert s.mode == "launch" and s.owned is True and s.reused_context is False
        await s.page.goto("data:text/html,<title>p4-launch-ok</title>",
                          wait_until="domcontentloaded")
        assert await s.page.title() == "p4-launch-ok"
        wd = await s.page.evaluate("navigator.webdriver")
        assert wd is False, f"stealth 未生效: webdriver={wd}"
        await s.aclose()
    print("== P4_LAUNCH_OK ==  (标题 / stealth / 清理)")

    # ---- C CDP 模式实跑 ----
    exe = find_chromium()
    if not exe:
        print("== P4_CDP_SKIP ==  (未找到 chrome/edge 可执行文件；launch 路径不受影响)")
    else:
        profile = tempfile.mkdtemp(prefix="p4_cdp_profile_")
        proc = None
        info = None
        for extra in (["--headless=new"], []):  # 老版本不支持 new headless 时退回有头
            proc = subprocess.Popen(
                [exe, f"--remote-debugging-port={CDP_PORT}",
                 f"--user-data-dir={profile}",
                 "--no-first-run", "--no-default-browser-check", *extra],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            info = wait_cdp(CDP_URL, timeout=20.0)
            if info:
                break
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except Exception:
                proc.kill()
        try:
            assert info and info.get("webSocketDebuggerUrl"), "CDP 未就绪（/json/version 无响应）"
            svc_browser.configure({"cdp": {"enabled": True, "url": CDP_URL, "stealth": False}})
            async with async_playwright() as pw:
                s = await svc_browser.open_session(pw, proxy=None)
                assert s.mode == "cdp" and s.owned is False
                assert s.reused_context is True, "CDP 未复用已有上下文"
                await s.page.goto("data:text/html,<title>p4-cdp-ok</title>",
                                  wait_until="domcontentloaded")
                assert await s.page.title() == "p4-cdp-ok"
                await s.aclose()
            # 存活性以 CDP 端点为准（Popen 的 chrome.exe 是启动器，proc.poll() 非存活判据）
            assert wait_cdp(CDP_URL, timeout=3.0) is not None, \
                "CDP 清理把用户的 Chrome 弄死了（应只关页面）！"
            print(f"== P4_CDP_OK ==  (接管 / 复用上下文 / 标题 / Chrome 存活 "
                  f"[endpoint alive]）")
        finally:
            svc_browser.configure({"cdp": {"enabled": False}})  # 还原 yml 声明态
            if proc is not None:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except Exception:
                    proc.kill()
            kill_by_profile(profile)
            shutil.rmtree(profile, ignore_errors=True)
        assert svc_browser.active_config()["cdp"]["enabled"] is False

    # ---- D 回滚 ----
    loader = ctx.loader
    for options in list(loader.root.data):
        loader.root.remove(options["id"])
    for _ in range(20):
        await asyncio.sleep(0)
    gone = [n for n in WANT_P4 if getattr(ctx, n, None) is not None]
    assert not gone, f"dispose 后服务仍可达: {gone}"
    print("== P4_ROLLBACK_OK ==")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
