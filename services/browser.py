# -*- coding: utf-8 -*-
"""BrowserService —— 浏览器会话（P4 起实现主体在此）：launch / CDP 双模式。

服务名 `browser` → `ctx.browser`。entry: services.browser（config 字段见 cordis.yml）。

P4 能力：
- **launch 模式**（默认，行为与 legacy 逐字节一致）：`pw.chromium.launch(headless, args=[...])`
  → new_context(UA/视口/locale/proxy) → new_page → stealth init script。
- **CDP 模式**（新）：`connect_over_cdp` 接管本地已启动的 Chrome/Edge，复用其
  contexts[0]（登录态/真实指纹），**不再注入 UA 伪装**；stealth 默认关闭（真实环境不需要）；
  代理不可经上下文指定 —— CDP 下代理由 **Chrome 启动参数 `--proxy-server`** 决定。

本地 Chrome 启动（CDP 模式前置；方法来源 = CSDN《用 Playwright 连接本地 Chrome（CDP 模式）
科普指南》，https://blog.csdn.net/u014177256/article/details/156098567）：:

    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" ^
      --remote-debugging-port=9222 ^
      --user-data-dir="C:\\chrome_profiles\\image_scraper"

    （如需代理：追加 --proxy-server="socks5://127.0.0.1:1080"）
    验证：浏览器访问 http://127.0.0.1:9222/json/version 能看到 webSocketDebuggerUrl

⚠ 不要接管日常默认 profile（锁文件/数据污染/扩展干扰）——一律专用 --user-data-dir。

接线方式：engine.py（无 cordis 句柄）经模块级 `open_session()` 消费；cordis 应用挂载
BrowserService 时，`__cordis_init__` 把 yml 声明 apply 进模块级 active 配置（`configure()`）
——「声明即生效」；legacy 不挂服务时保持默认 launch（行为零变化）。

清理语义（dispose 替代 browser.close()）：`session.aclose()` ——
launch 模式关掉自建浏览器；**CDP 模式只关本次打开的页面、绝不动用户的 Chrome**。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

try:
    from cordis import Service
except ImportError:  # fresh clone（未挂 .pth）→ 经仓库内 vendor 兜底
    import _cordis_locate

    _cordis_locate.ensure()
    from cordis import Service

log = logging.getLogger("mj_scraper")

#: launch 模式默认值（= legacy engine.py 原值，勿改：行为契约）
DEFAULT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
DEFAULT_VIEWPORT = {"width": 1920, "height": 1080}
DEFAULT_LOCALE = "en-US"
DEFAULT_ARGS = ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-gpu"]

#: stealth 注入脚本（= legacy engine.py 原文本，勿改）
STEALTH_SCRIPT = """
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                window.chrome = { runtime: {} };
            """

#: 模块级 active 配置（engine 无 cordis 句柄时的消费点；BrowserService 挂载时被 yml 覆盖）
_ACTIVE: dict = {
    "headless": True,
    "stealth": True,
    "cdp": {"enabled": False, "url": "http://127.0.0.1:9222", "stealth": False},
}


def configure(cfg: dict) -> dict:
    """把声明配置合并进模块级 active（浅层 + cdp 子字典合并）。返回合并后快照。"""
    if not isinstance(cfg, dict):
        return active_config()
    cdp = cfg.get("cdp")
    _ACTIVE.update({k: v for k, v in cfg.items() if k != "cdp"})
    if isinstance(cdp, dict):
        _ACTIVE["cdp"].update(cdp)
    return active_config()


def active_config() -> dict:
    snap = dict(_ACTIVE)
    snap["cdp"] = dict(_ACTIVE["cdp"])
    return snap


@dataclass
class BrowserSession:
    """一次浏览器会话（launch 自建 or CDP 接管）。"""
    browser: Any
    context: Any
    page: Any
    mode: str                 # "launch" / "cdp"
    owned: bool               # True = launch 自建；False = 接管（清理时绝不动用户浏览器）
    reused_context: bool = False  # CDP 是否复用已有上下文（launch 恒 False）

    async def aclose(self):
        """统一清理（dispose 语义）：
        launch → 关闭自建浏览器；cdp → 只关本次打开的页面，不动用户的 Chrome。"""
        if self.owned:
            try:
                await self.browser.close()
            except Exception:
                pass
            return
        try:
            await self.page.close()
        except Exception:
            pass
        # 不调用 browser.close()：连接随 playwright 驱动退出而断开（绝不动用户 Chrome）


async def open_session(
    pw,
    *,
    proxy: Optional[str] = None,
    headless: Optional[bool] = None,
    user_agent: Optional[str] = None,
    viewport: Optional[dict] = None,
    locale: str = DEFAULT_LOCALE,
    stealth: Optional[bool] = None,
) -> BrowserSession:
    """按模块级 active 配置打开浏览器会话（launch / CDP 双模式）。"""
    cdp = _ACTIVE.get("cdp") or {}
    if cdp.get("enabled"):
        url = str(cdp.get("url") or "http://127.0.0.1:9222")
        browser = await pw.chromium.connect_over_cdp(url)
        reused = bool(browser.contexts)
        context = browser.contexts[0] if reused else await browser.new_context()
        page = await context.new_page()
        use_stealth = bool(cdp.get("stealth", False)) if stealth is None else stealth
        if use_stealth:
            await page.add_init_script(STEALTH_SCRIPT)
        if proxy:
            log.warning(
                "  [browser] CDP 模式下 context 级代理不生效 —— 代理由 Chrome 启动参数 "
                "--proxy-server 决定；本次 proxy=%s 将被忽略", proxy)
        log.info("  [browser] CDP 接管: %s（复用已有上下文=%s, stealth=%s）",
                 url, reused, use_stealth)
        return BrowserSession(browser, context, page, mode="cdp", owned=False,
                              reused_context=reused)

    use_headless = bool(_ACTIVE.get("headless", True)) if headless is None else headless
    use_stealth = bool(_ACTIVE.get("stealth", True)) if stealth is None else stealth
    browser = await pw.chromium.launch(headless=use_headless, args=list(DEFAULT_ARGS))
    ctx_args: dict = {
        "user_agent": user_agent or DEFAULT_UA,
        "viewport": dict(viewport or DEFAULT_VIEWPORT),
        "locale": locale,
    }
    if proxy:
        ctx_args["proxy"] = {"server": proxy}
    context = await browser.new_context(**ctx_args)
    page = await context.new_page()
    if use_stealth:
        await page.add_init_script(STEALTH_SCRIPT)
    return BrowserSession(browser, context, page, mode="launch", owned=True)


class BrowserService(Service):
    inject = []

    def __init__(self, ctx, config=None):
        super().__init__(ctx, "browser")
        cfg = dict(config or {})
        self.headless = bool(cfg.get("headless", True))
        self.stealth = bool(cfg.get("stealth", True))
        cdp = dict(cfg.get("cdp") or {})
        self.cdp_enabled = bool(cdp.get("enabled", False))
        self.cdp_url = str(cdp.get("url") or "http://127.0.0.1:9222")
        self.cdp_stealth = bool(cdp.get("stealth", False))
        self.applied = False

    def __cordis_init__(self):
        # 声明即生效：yml → 模块级 active（engine 的消费点）
        configure({
            "headless": self.headless,
            "stealth": self.stealth,
            "cdp": {"enabled": self.cdp_enabled, "url": self.cdp_url,
                    "stealth": self.cdp_stealth},
        })
        self.applied = True
        return None

    async def open(self, pw, **kwargs) -> BrowserSession:
        """服务路径入口（与模块级 open_session 同一实现）。"""
        return await open_session(pw, **kwargs)


default = BrowserService
