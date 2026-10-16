# -*- coding: utf-8 -*-
"""ConfigService —— 持久化配置与代理探测（P2 起实现主体在此）。

服务名 `config` → `ctx.config`。entry: services.config（config 字段见 cordis.yml）。

P2 迁移：实现自 legacy `config.py` 原样搬入（行为零变化），并**真正消费** yml 的
`proxy_candidates`——模块级函数支持显式候选列表参数，服务把 yml 值作为默认传入；
legacy `config.py` 已收缩为 facade（转发本模块），P6 删除入口后移除。

模块级函数 = 唯一实现；ConfigService 是薄封装（同名方法转发 + yml 消费）。
"""
from __future__ import annotations

import json
import os
import socket
import sys
from pathlib import Path

try:
    from cordis import Service
except ImportError:  # fresh clone（未挂 .pth）→ 经仓库内 vendor 兜底
    import _cordis_locate

    _cordis_locate.ensure()
    from cordis import Service

#: 仓库根（本文件在 services/ 下）
ROOT = Path(__file__).resolve().parent.parent

CONFIG_PATH = ROOT / "config.json"

DEFAULTS: dict = {
    "proxy": "",
    "keys": {
        "unsplash": "",
        "pexels": "",
        "flickr": "",
        "wallhaven": "",
    },
    "proxy_sources": {
        "zdopen": {"app_id": "", "akey": ""},
        "zdaye": {"username": "", "password": ""},
    },
}

# 常见本地代理端口（Clash / v2rayN / SS / 系统代理 等）
PROXY_CANDIDATES: list[str] = [
    "socks5://127.0.0.1:1080",
    "http://127.0.0.1:7890",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:8888",
    "socks5://127.0.0.1:10808",
    "http://127.0.0.1:10809",
    "socks5://127.0.0.1:7891",
]


def load_config() -> dict:
    """读取 config.json，缺失字段回退默认值（深拷贝避免污染 DEFAULTS）"""
    cfg = json.loads(json.dumps(DEFAULTS))
    try:
        if CONFIG_PATH.exists():
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(data.get("proxy"), str):
                cfg["proxy"] = data["proxy"]
            if isinstance(data.get("keys"), dict):
                cfg["keys"].update({k: v for k, v in data["keys"].items()
                                    if k in DEFAULTS["keys"] and v})
            ps = data.get("proxy_sources")
            if isinstance(ps, dict):
                for svc, creds in ps.items():
                    if svc in cfg["proxy_sources"] and isinstance(creds, dict):
                        cfg["proxy_sources"][svc].update(
                            {k: v for k, v in creds.items() if v}
                        )
    except Exception:
        pass
    return cfg


def save_config(proxy: str | None = None, keys: dict | None = None) -> None:
    """合并写入 config.json（仅覆盖传入的非空项）"""
    cfg = load_config()
    if proxy:
        cfg["proxy"] = proxy.strip()
    if keys:
        for svc, val in keys.items():
            if svc in DEFAULTS["keys"] and val:
                cfg["keys"][svc] = val.strip()
    try:
        CONFIG_PATH.write_text(
            json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    except Exception:
        pass


def _check_reachable(url: str, timeout: float = 1.2) -> str:
    """若给定代理地址 TCP 可连则返回原串，否则返回空串。
    url 形如 socks5://127.0.0.1:1080 或 http://127.0.0.1:7890"""
    try:
        scheme, rest = url.split("://", 1)
        host, port_s = rest.rsplit(":", 1)
        port = int(port_s)
    except Exception:
        return ""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        return url
    except Exception:
        return ""
    finally:
        try:
            s.close()
        except Exception:
            pass


def _proxy_from_env() -> str:
    """读取标准代理环境变量（HTTP_PROXY/HTTPS_PROXY 及其小写），返回首个可达的"""
    for key in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        v = os.environ.get(key, "").strip()
        if v:
            # 仅保留 host:port 部分做连通性校验
            norm = v if "://" in v else "http://" + v
            hit = _check_reachable(norm)
            if hit:
                return norm
    return ""


def _proxy_from_system() -> str:
    """读取 Windows 系统代理（Internet Settings\\ProxyServer）。
    形如 '127.0.0.1:7890' 或 'http=127.0.0.1:7890;https=127.0.0.1:7890;socks=127.0.0.1:7891'。
    优先取 socks，其次 http/https。"""
    if sys.platform != "win32":
        return ""
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
        )
        enabled, _ = winreg.QueryValueEx(key, "ProxyEnable")
        server, _ = winreg.QueryValueEx(key, "ProxyServer")
        winreg.CloseKey(key)
        if not enabled or not server:
            return ""
        server = server.strip()
        # 多协议形式：scheme=host:port;...
        if "=" in server:
            parts = {}
            for seg in server.split(";"):
                if "=" in seg:
                    k, v = seg.split("=", 1)
                    parts[k.strip().lower()] = v.strip()
            for proto in ("socks", "http", "https"):
                if proto in parts:
                    return _check_reachable(_normalize(parts[proto]))
        else:
            return _check_reachable(_normalize(server))
    except Exception:
        pass
    return ""


def _normalize(endpoint: str) -> str:
    """把 '127.0.0.1:7890' 规范成 'http://127.0.0.1:7890'（端口扫描类默认用 http）"""
    endpoint = endpoint.strip()
    if "://" in endpoint:
        return endpoint
    return "http://" + endpoint


def detect_proxy(timeout: float = 1.2, candidates: list[str] | None = None) -> str:
    """探测可用代理，优先级：环境变量 > Windows 系统代理 > 常见本地客户端端口。
    返回首个 TCP 可连的代理地址；无则返回空串。
    candidates 给定时用它替代模块默认 PROXY_CANDIDATES（服务路径传入 yml 声明值）。"""
    for fn in (_proxy_from_env, _proxy_from_system):
        hit = fn()
        if hit:
            return hit
    for p in (candidates if candidates is not None else PROXY_CANDIDATES):
        hit = _check_reachable(p, timeout)
        if hit:
            return hit
    return ""


_EP_CACHE: str | None = None  # 缓存自动探测结果，避免多源重复扫描端口


async def auto_fetch_proxy(prefer_socks: bool = False) -> str:
    """从免费代理源拉取并校验，返回首个可用代理 URL；失败返回空串。"""
    try:
        from services.proxy import fetch_working_proxy

        p = await fetch_working_proxy(prefer_socks=prefer_socks)
        return p or ""
    except Exception:
        return ""


def proxy_reachable(url: str) -> bool:
    """校验代理地址 TCP 是否可连（不可达的死代理不应被使用）。"""
    return bool(_check_reachable(url))


def effective_proxy(explicit: str | None = None, candidates: list[str] | None = None) -> str:
    """返回应使用的代理：显式 > 已存配置(需可达) > 自动探测。
    仅在探测到结果时缓存，避免把「暂未找到」固化，便于中途启动客户端后即时生效。
    注意：已存配置中的代理若不可达则跳过，退回自动探测 / 直连，
    避免一个死代理把所有源（含本可直连的 midjourney）卡死。"""
    if explicit:
        return explicit.strip()
    cfg = load_config()
    saved = (cfg.get("proxy") or "").strip()
    if saved and _check_reachable(saved):
        return saved
    global _EP_CACHE
    if _EP_CACHE and _check_reachable(_EP_CACHE):
        return _EP_CACHE
    p = detect_proxy(candidates=candidates)
    if p:
        _EP_CACHE = p
    return p


class ConfigService(Service):
    inject = []

    def __init__(self, ctx, config=None):
        super().__init__(ctx, "config")
        cfg = dict(config or {})
        declared = cfg.get("proxy_candidates")
        self.candidates_from_yaml = bool(declared)  # 配置传递断言用
        self.proxy_candidates = list(declared or PROXY_CANDIDATES)
        self.persisted: dict = {}

    def __cordis_init__(self):
        # 读取 config.json（代理 + keys 持久化值）
        self.persisted = load_config()
        return None

    # ---- 服务方法（转发模块级唯一实现；消费点接入 yml 值）----
    def load_config(self) -> dict:
        return load_config()

    def save_config(self, proxy: str | None = None, keys: dict | None = None) -> None:
        return save_config(proxy=proxy, keys=keys)

    def detect_proxy(self, timeout: float = 1.2) -> str:
        return detect_proxy(timeout=timeout, candidates=self.proxy_candidates)

    def effective_proxy(self, explicit: str | None = None) -> str:
        return effective_proxy(explicit, candidates=self.proxy_candidates)

    def proxy_reachable(self, url: str) -> bool:
        return proxy_reachable(url)

    async def auto_fetch_proxy(self, prefer_socks: bool = False) -> str:
        return await auto_fetch_proxy(prefer_socks=prefer_socks)


default = ConfigService
