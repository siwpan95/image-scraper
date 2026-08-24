#!/usr/bin/env python3
"""
MidJourney API 网络发现工具
============================
启动浏览器访问 explore 页面，拦截所有 API 请求，输出分析报告。
用于发现 MidJourney 的真实 API 端点和数据结构。

用法：
    python mj_discover.py
    python mj_discover.py --tab random --scroll 10
    python mj_discover.py --headless=False  # 显示浏览器窗口
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from playwright.async_api import async_playwright, Request, Response

# ── 配置 ──
OUTPUT_DIR = Path(__file__).resolve().parent  # 原 D:\allin 已失效，改为项目自身目录
META_DIR = OUTPUT_DIR / "meta"
REPORT_PATH = META_DIR / "api_discovery_report.json"
BASE_URL = "https://www.midjourney.com"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("mj_discover")


class APIDiscoverer:
    """专门用于发现 API 的工具"""

    def __init__(self, headless: bool = True, proxy: Optional[str] = None):
        self.headless = headless
        self.proxy = proxy

        # 分类存储
        self.xhr_requests: list[dict] = []       # XHR/Fetch 请求
        self.api_responses: list[dict] = []       # JSON 响应内容
        self.image_urls: set[str] = set()         # 发现的图片 URL
        self.all_requests: list[dict] = []         # 全部请求

    async def on_request(self, request: Request):
        info = {
            "url": request.url,
            "method": request.method,
            "resource_type": request.resource_type,
            "headers_summary": {
                k: v for k, v in request.headers.items()
                if k.lower() in ("content-type", "accept", "authorization", "x-", "referer")
            },
        }
        self.all_requests.append(info)

        # 重点关注 XHR/Fetch
        if request.resource_type in ("xhr", "fetch"):
            self.xhr_requests.append(info)
            log.info(f"  [XHR] {request.method} {request.url[:150]}")

        # 记录 image 类型
        if request.resource_type == "image":
            self.image_urls.add(request.url)

    async def on_response(self, response: Response):
        content_type = response.headers.get("content-type", "")

        # 只关注 JSON 响应
        if "json" in content_type:
            try:
                body = await response.json()
                self.api_responses.append({
                    "url": response.url,
                    "status": response.status,
                    "content_type": content_type,
                    "body_sample": str(body)[:2000],  # 截取前 2000 字符
                    "keys": list(body.keys()) if isinstance(body, dict) else f"list[{len(body)}]",
                })

                # 自动提取其中的图片 URL
                self._extract_images(body)

                log.info(f"  [JSON] {response.status} {response.url[:120]} "
                         f"keys={list(body.keys()) if isinstance(body, dict) else f'list({len(body)})'}")

            except Exception as e:
                log.debug(f"  无法解析 JSON: {response.url[:100]}: {e}")

        # 图片响应
        elif any(t in content_type for t in ("image/",)):
            self.image_urls.add(response.url)

    def _extract_images(self, data, depth=0):
        """递归提取图片 URL"""
        if depth > 10:
            return
        if isinstance(data, dict):
            for key in ("image_url", "url", "imagePath", "uri", "src", "thumbnail"):
                if key in data and isinstance(data[key], str):
                    if re.search(r"(cdn\.|midjourney\.|\.(png|jpg|jpeg|webp|avif))", data[key], re.IGNORECASE):
                        self.image_urls.add(data[key])
            for v in data.values():
                self._extract_images(v, depth + 1)
        elif isinstance(data, list):
            for item in data:
                self._extract_images(item, depth + 1)

    async def run(self, tab: str = "top", extra_urls: list[str] | None = None):
        """运行发现任务"""
        log.info("=" * 60)
        log.info("MidJourney API 网络发现")
        log.info("=" * 60)

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        META_DIR.mkdir(parents=True, exist_ok=True)

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=self.headless,
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )

            ctx_kwargs = {
                "user_agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
                ),
                "viewport": {"width": 1920, "height": 1080},
            }
            if self.proxy:
                ctx_kwargs["proxy"] = {"server": self.proxy}

            context = await browser.new_context(**ctx_kwargs)
            page = await context.new_page()

            page.on("request", self.on_request)
            page.on("response", self.on_response)

            # ── 访问主页面 ──
            urls = [f"{BASE_URL}/explore?tab={tab}"]
            if extra_urls:
                urls.extend(extra_urls)

            for url in urls:
                log.info(f"\n访问: {url}")
                try:
                    await page.goto(url, wait_until="networkidle", timeout=60000)
                except Exception as e:
                    log.warning(f"页面加载超时: {e}")

                await asyncio.sleep(3)

                # 滚动 5 次触发懒加载
                for i in range(5):
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await asyncio.sleep(1.5)
                    log.info(f"  滚动 {i+1}/5...")

            await browser.close()

        # ── 生成报告 ──
        self._generate_report()
        return self

    def _generate_report(self):
        """生成分析报告"""
        # 分析 API 端点模式
        api_patterns = {}
        for req in self.xhr_requests:
            url = req["url"]
            # 提取路径模式
            pattern = re.sub(r"\?.*$", "", url)  # 去掉 query string
            pattern = re.sub(r"/[a-f0-9-]{20,}", "/{id}", pattern)  # UUID
            pattern = re.sub(r"/\d{5,}", "/{num}", pattern)  # 长数字
            if pattern not in api_patterns:
                api_patterns[pattern] = []
            api_patterns[pattern].append(url)

        report = {
            "timestamp": datetime.now().isoformat(),
            "summary": {
                "total_requests": len(self.all_requests),
                "xhr_requests": len(self.xhr_requests),
                "api_responses": len(self.api_responses),
                "images_found": len(self.image_urls),
            },
            "api_endpoint_patterns": {
                k: {"count": len(v), "example": v[0]} for k, v in api_patterns.items()
            },
            "all_api_endpoints": [r["url"] for r in self.xhr_requests],
            "api_responses_sample": self.api_responses[:30],
            "image_urls_sample": sorted(self.image_urls)[:100],
            "all_xhr_requests": self.xhr_requests,
        }

        REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        log.info(f"\n报告已保存: {REPORT_PATH}")

        # ── 打印摘要 ──
        log.info("\n" + "=" * 60)
        log.info("发现摘要")
        log.info(f"  总请求数: {len(self.all_requests)}")
        log.info(f"  XHR/Fetch 请求: {len(self.xhr_requests)}")
        log.info(f"  API JSON 响应: {len(self.api_responses)}")
        log.info(f"  发现图片 URL: {len(self.image_urls)}")
        log.info(f"\n  API 端点模式:")
        for pattern, info in sorted(api_patterns.items()):
            log.info(f"    [{info.get('count', info)}x] {pattern}")
        log.info("=" * 60)


async def main():
    import argparse
    parser = argparse.ArgumentParser(description="MidJourney API 网络发现")
    parser.add_argument("--tab", default="top", choices=["top", "trending", "random", "new", "hot"])
    parser.add_argument("--scroll", type=int, default=5, help="滚动次数")
    parser.add_argument("--headless", type=lambda x: x.lower() != "false", default=True)
    parser.add_argument("--proxy", default=None)
    parser.add_argument("--extra-urls", nargs="*", default=None,
                        help="额外 URL 列表")
    args = parser.parse_args()

    discoverer = APIDiscoverer(headless=args.headless, proxy=args.proxy)
    await discoverer.run(tab=args.tab, extra_urls=args.extra_urls)


if __name__ == "__main__":
    asyncio.run(main())
