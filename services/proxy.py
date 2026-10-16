# -*- coding: utf-8 -*-
"""ProxyService —— 免费代理获取器（P2 起实现主体在此）。

服务名 `proxy` → `ctx.proxy`。entry: services.proxy（config 字段见 cordis.yml）。

P2 迁移：实现自 legacy `proxy_fetcher.py` 原样搬入（行为零变化），并**真正消费**
yml 的 `free_pages` / `prefer_socks`（服务方法作为默认值传入；模块级函数保留原默认）。
legacy `proxy_fetcher.py` 已收缩为 facade（转发本模块 + 转发 CLI），P6 删除后移除。

来源：zdopen API（凭据在 config.json 的 proxy_sources）/ zdaye 登录页 / zdaye 公开免费页。
CLI 自测：python services/proxy.py --test-all（或经 facade：python proxy_fetcher.py --test-all）
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import socket
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx

try:
    from cordis import Service
except ImportError:  # fresh clone（未挂 .pth）→ 经仓库内 vendor 兜底
    import _cordis_locate

    _cordis_locate.ensure()
    from cordis import Service

log = logging.getLogger("proxy_fetcher")  # 沿用旧 logger 名，日志记录不漂移

# ───────────────────────────── 配置 ─────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent.parent  # 仓库根
CONFIG_PATH = SCRIPT_DIR / "config.json"

# 校验目标：选一个 GFW 封锁但稳定的域（Civitai / Lexica / Google 图片）
CHECK_TARGET = "https://civitai.com/api/v1/models?limit=1"
CHECK_TIMEOUT = 8.0   # 代理连通性校验超时
TCP_TIMEOUT = 2.0     # TCP 端口握手超时


@dataclass
class ProxyItem:
    ip: str
    port: int
    proto: str          # http / https / socks4 / socks5
    source: str = ""    # 来源标识
    latency: float = 0.0

    def url(self) -> str:
        return f"{self.proto}://{self.ip}:{self.port}"

    def __repr__(self) -> str:
        return f"{self.proto}://{self.ip}:{self.port} ({self.source} {self.latency:.1f}s)"


# ───────────────────────────── 配置读取 ─────────────────────────────
def _load_config() -> dict:
    try:
        if CONFIG_PATH.exists():
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _get_proxy_sources() -> dict:
    """读取 config.json 中的 proxy_sources 区块（zdopen / zdaye 凭据）。"""
    return _load_config().get("proxy_sources", {})


# ───────────────────────────── 协议标准化 ─────────────────────────────
def _normalize_proto(ptype: str) -> str:
    """把 API 或网页上的类型文字统一为 httpx 可用的协议前缀。"""
    p = str(ptype).strip().lower()
    if "sock5" in p or "socks5" in p:
        return "socks5"
    if "sock4" in p or "socks4" in p:
        return "socks4"
    if "https" in p:
        return "https"
    return "http"


# ───────────────────────────── TCP 握手校验 ─────────────────────────────
def _tcp_check(ip: str, port: int, timeout: float = TCP_TIMEOUT) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((ip, port))
        return True
    except Exception:
        return False
    finally:
        try:
            s.close()
        except Exception:
            pass


# ───────────────────────────── HTTP/SOCKS 代理可用性校验 ─────────────────────────────
async def _proxy_check(item: ProxyItem, target: str = CHECK_TARGET,
                       timeout: float = CHECK_TIMEOUT) -> Optional[ProxyItem]:
    """通过该代理实际请求一个 GFW 封锁域名，能通即算可用。"""
    if not _tcp_check(item.ip, item.port):
        return None
    try:
        t0 = asyncio.get_event_loop().time()
        async with httpx.AsyncClient(
            proxy=item.url(),
            timeout=timeout,
            follow_redirects=True,
        ) as client:
            r = await client.get(target)
            # 只要响应码 200-299 或 403（代理通了但目标拦截）都算代理可用
            if 200 <= r.status_code < 300 or r.status_code == 403:
                item.latency = asyncio.get_event_loop().time() - t0
                return item
    except Exception:
        pass
    return None


# ═════════════════════════════ zdopen API ═════════════════════════════
async def _fetch_zdopen(overseas: bool = True) -> list[ProxyItem]:
    """
    zdopen 免费代理 API。
    dalu=0 海外(需翻) / dalu=1 国内。return_type=3（含协议类型的文本）。
    """
    cfg = _get_proxy_sources().get("zdopen", {})
    app_id = cfg.get("app_id", "")
    akey = cfg.get("akey", "")
    if not app_id or not akey:
        log.warning("  proxy_fetcher: zdopen 未配置 app_id/akey")
        return []

    dalu = 0 if overseas else 1
    url = (
        f"http://www.zdopen.com/FreeProxy/Get/"
        f"?app_id={app_id}&akey={akey}&dalu={dalu}&return_type=3"
    )
    items: list[ProxyItem] = []
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
            text = r.text.strip()
    except Exception as e:
        log.warning(f"  proxy_fetcher: zdopen 请求失败: {e}")
        return items

    # return_type=3 的文本格式每行类似：
    #   1.2.3.4:8080@HTTP#国家  或  1.2.3.4:1080@SOCKS5#国家
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.match(r"([\d.]+):(\d+)@([^#]+)(?:#.*)?", line)
        if not m:
            continue
        ip, port_s, ptype = m.group(1), m.group(2), m.group(3)
        items.append(ProxyItem(
            ip=ip, port=int(port_s),
            proto=_normalize_proto(ptype),
            source="zdopen",
        ))
    log.info(f"  proxy_fetcher: zdopen 返回 {len(items)} 条")
    return items


# ═════════════════════════════ zdaye 登录抓取 ═════════════════════════════
async def _fetch_zdaye() -> list[ProxyItem]:
    """
    站大爷登录后抓取用户免费代理页。
    先 POST 登录拿 cookie，再 GET /Users/FreeProxy/ 解析表格。
    """
    cfg = _get_proxy_sources().get("zdaye", {})
    user = cfg.get("username", "")
    pwd = cfg.get("password", "")
    if not user or not pwd:
        log.warning("  proxy_fetcher: zdaye 未配置 username/password")
        return []

    items: list[ProxyItem] = []
    login_url = "https://www.zdaye.com/Users/Login.html"
    free_url = "https://www.zdaye.com/Users/FreeProxy/"

    try:
        async with httpx.AsyncClient(
            timeout=15.0,
            follow_redirects=True,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36"
                ),
            },
        ) as client:
            # 1) 登录（通常不需要 csrf，若后续失败可补）
            r1 = await client.post(
                login_url,
                data={"username": user, "password": pwd},
            )
            # 若登录失败（302 到登录页、或页面含"登录失败"），提前返回
            body = r1.text
            if "登录失败" in body or "用户名或密码错误" in body:
                log.warning("  proxy_fetcher: zdaye 登录失败，检查凭据")
                return items

            # 2) 访问免费代理页
            r2 = await client.get(free_url)
            body = r2.text
    except Exception as e:
        log.warning(f"  proxy_fetcher: zdaye 请求失败: {e}")
        return items

    # 解析表格：匹配类似 <td>1.2.3.4</td><td>8080</td><td>HTTP</td>
    rows = re.findall(
        r"<td[^>]*>\s*([\d.]+)\s*</td>\s*<td[^>]*>\s*(\d+)\s*</td>\s*<td[^>]*>\s*(\w+)\s*</td>",
        body, re.S,
    )
    # 若 regex 未命中，尝试更宽松的提取（把所有 td 文本按 3 个一组）
    if not rows:
        tds = re.findall(r"<td[^>]*>([^<]+)</td>", body, re.S)
        for i in range(0, len(tds) - 2, 3):
            ip = tds[i].strip()
            port = tds[i + 1].strip()
            ptype = tds[i + 2].strip()
            if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", ip) and port.isdigit():
                rows.append((ip, port, ptype))

    for ip, port_s, ptype in rows:
        items.append(ProxyItem(
            ip=ip, port=int(port_s),
            proto=_normalize_proto(ptype),
            source="zdaye",
        ))
    log.info(f"  proxy_fetcher: zdaye 返回 {len(items)} 条")
    return items


# ═════════════════════════════ zdaye 公开免费页（免登录） ═════════════════════════════
# 页面结构（https://www.zdaye.com/free/ 及 /free/{page}/）：
#   <div class="ip-table-body"> 内每条为 <ul class="ul-row">
#     <p class="proxy_ip">1.2.3.4</p>
#     <p class="proxy_port">Port：8080...</p>
#     <p class="proxy_protocol">...<span ...>HTTP|HTTPS|SOCKS4|SOCKS5</span></p>
#     <p class="proxy_level">高匿</p>
_ZDAYE_ROW_RE = re.compile(
    r'proxy_ip">\s*([\d.]+)\s*</p>'
    r'.*?proxy_port">Port[:\uff1a]\s*(\d+)'
    r'.*?proxy_protocol">.*?>([A-Za-z0-9]+)</span>',
    re.S,
)


async def _fetch_zdaye_free(pages: int = 3) -> list[ProxyItem]:
    """
    抓取站大爷公开免费代理页（无需登录）。默认抓取前 pages 页，每页约 20 条。
    """
    base = "https://www.zdaye.com/free/"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/125.0.0.0 Safari/537.36"
        ),
        "Referer": "https://www.zdaye.com/free/",
    }
    items: list[ProxyItem] = []
    seen: set[tuple[str, int]] = set()
    try:
        async with httpx.AsyncClient(
            timeout=15.0, follow_redirects=True, headers=headers
        ) as client:
            for page in range(1, max(1, pages) + 1):
                url = base if page == 1 else f"{base}{page}/"
                try:
                    r = await client.get(url)
                    r.raise_for_status()
                except Exception as e:
                    log.warning(f"  proxy_fetcher: zdaye_free 第 {page} 页失败: {e}")
                    continue
                cnt = 0
                for ip, port_s, ptype in _ZDAYE_ROW_RE.findall(r.text):
                    key = (ip, int(port_s))
                    if key in seen:
                        continue
                    seen.add(key)
                    items.append(ProxyItem(
                        ip=ip, port=int(port_s),
                        proto=_normalize_proto(ptype),
                        source="zdaye_free",
                    ))
                    cnt += 1
                log.info(f"  proxy_fetcher: zdaye_free 第 {page} 页 {cnt} 条")
                if cnt == 0:
                    break  # 无更多数据/被限流，停止翻页
                await asyncio.sleep(0.8)  # 轻微限速，降低被封风险
    except Exception as e:
        log.warning(f"  proxy_fetcher: zdaye_free 请求失败: {e}")
    log.info(f"  proxy_fetcher: zdaye_free 合计 {len(items)} 条")
    return items


# ═════════════════════════════ 统一入口 ═════════════════════════════
async def fetch_proxy_list(
    sources: Optional[list[str]] = None,
    overseas: bool = True,
    free_pages: int = 3,
) -> list[ProxyItem]:
    """拉取全部（或指定）来源的代理列表，未校验。"""
    srcs = sources or ["zdaye_free", "zdopen", "zdaye"]
    coros = []
    for s in srcs:
        if s == "zdopen":
            coros.append(_fetch_zdopen(overseas=overseas))
        elif s == "zdaye":
            coros.append(_fetch_zdaye())
        elif s == "zdaye_free":
            coros.append(_fetch_zdaye_free(pages=free_pages))
    results = await asyncio.gather(*coros, return_exceptions=True)
    out: list[ProxyItem] = []
    for r in results:
        if isinstance(r, list):
            out.extend(r)
    return out


async def fetch_working_proxy(
    sources: Optional[list[str]] = None,
    overseas: bool = True,
    prefer_socks: bool = False,
    max_concurrent_check: int = 20,
    timeout: float = CHECK_TIMEOUT,
    free_pages: int = 3,
) -> Optional[str]:
    """
    获取首个可用的代理 URL 字符串。
    流程：拉列表 -> 并发校验 -> 按 latency 排序 -> 返回最优。
    无可用代理返回 None。
    """
    items = await fetch_proxy_list(
        sources=sources, overseas=overseas, free_pages=free_pages)
    if not items:
        return None

    # 并发校验，限制并发数避免本地端口耗尽
    sem = asyncio.Semaphore(max_concurrent_check)

    async def check(item: ProxyItem) -> Optional[ProxyItem]:
        async with sem:
            return await _proxy_check(item, timeout=timeout)

    checked = await asyncio.gather(*[check(it) for it in items])
    ok = [it for it in checked if it is not None]
    if not ok:
        return None

    # 排序：优先 socks（若要求），其次 latency 低
    if prefer_socks:
        ok.sort(key=lambda x: (0 if x.proto == "socks5" else 1, x.latency))
    else:
        ok.sort(key=lambda x: x.latency)

    best = ok[0]
    log.info(f"  proxy_fetcher: 选中代理 {best}")
    return best.url()


class ProxyService(Service):
    inject = []

    def __init__(self, ctx, config=None):
        super().__init__(ctx, "proxy")
        cfg = dict(config or {})
        self.free_pages = int(cfg.get("free_pages") or 3)
        self.prefer_socks = bool(cfg.get("prefer_socks", False))

    # ---- 服务方法（转发模块级唯一实现；默认值接入 yml 值）----
    async def fetch_proxy_list(self, sources=None, overseas: bool = True,
                               free_pages: Optional[int] = None) -> list:
        return await fetch_proxy_list(
            sources=sources, overseas=overseas,
            free_pages=self.free_pages if free_pages is None else free_pages)

    async def fetch_working_proxy(self, sources=None, overseas: bool = True,
                                  prefer_socks: Optional[bool] = None,
                                  free_pages: Optional[int] = None) -> Optional[str]:
        return await fetch_working_proxy(
            sources=sources, overseas=overseas,
            prefer_socks=self.prefer_socks if prefer_socks is None else prefer_socks,
            free_pages=self.free_pages if free_pages is None else free_pages)


default = ProxyService


# ═════════════════════════════ CLI 自测 ═════════════════════════════
async def _cli():
    import argparse
    ap = argparse.ArgumentParser(description="免费代理获取器自测")
    ap.add_argument("--zdopen", action="store_true", help="仅测 zdopen")
    ap.add_argument("--zdaye", action="store_true", help="仅测 zdaye(登录)")
    ap.add_argument("--zdaye-free", action="store_true",
                    help="仅测 zdaye 公开免费页(免登录)")
    ap.add_argument("--free-pages", type=int, default=3,
                    help="zdaye_free 抓取页数(默认3)")
    ap.add_argument("--test-all", action="store_true", help="拉取并校验全部来源")
    ap.add_argument("--prefer-socks", action="store_true", help="优先 SOCKS5")
    ap.add_argument("--overseas", action="store_true", default=True,
                    help="zdopen dalu=0(海外, 默认)")
    ap.add_argument("--domestic", action="store_true",
                    help="zdopen dalu=1(国内)")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        stream=sys.stdout,
    )

    if args.domestic:
        args.overseas = False

    if args.zdopen:
        items = await _fetch_zdopen(overseas=args.overseas)
        for it in items[:10]:
            print(it.url())
        return

    if args.zdaye:
        items = await _fetch_zdaye()
        for it in items[:10]:
            print(it.url())
        return

    if args.zdaye_free:
        items = await _fetch_zdaye_free(pages=args.free_pages)
        for it in items[:20]:
            print(it.url())
        return

    # 默认 --test-all 行为
    p = await fetch_working_proxy(
        overseas=args.overseas,
        prefer_socks=args.prefer_socks,
        free_pages=args.free_pages,
    )
    if p:
        print(f"WORKING: {p}")
    else:
        print("NO WORKING PROXY")


if __name__ == "__main__":
    asyncio.run(_cli())
