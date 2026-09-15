# -*- coding: utf-8 -*-
"""通用 Playwright+Edge 无头抓包探针（实时平台逆向标准工具）

用途：加载任意目标页并捕获其真实网络请求（媒体流/API/签名参数），作为静态
      JS 分析解不开时的决定性手段。首次实战：real-url 6 平台逆向（六间房
      httpflv/liverecord、央视频 txvlive/vdnx、抖音 SSR 流地址均由本方法拿到
      金标准证据，见 tools/README.md 实战案例）。

依赖：`pip install playwright`（浏览器用系统 Edge，无需 playwright install 下载内核；
      如需用 Chromium 可改 --browser chromium 并先 playwright install chromium）。

用法：
  python probe_capture.py <url> [选项]

  --ua {desktop,mobile}    UA 预设（desktop=Chrome/Win，mobile=iPhone Safari）。默认 desktop
  --wait N                 加载后观测秒数（等播放器发起请求）。默认 15
  --click X,Y              观测中在 (X,Y) 点击一次（模拟点播放器触发播放），可多次
  --js "EXPR"              观测中执行一次页面内 JS（如触发 video.play()/点播放按钮），
                           可多次；比坐标点击更精确，常用于播放器不自动播的站点
  --filter REGEX           只记录 URL 命中正则的请求（忽略大小写）。
                           默认媒体/接口集：m3u8|\\.flv|\\.ts|live|stream|webcast|api|txvlive|playlist|limit_play
  --all                    不过滤，全量记录（输出可能很大）
  --out PATH               结果 JSON 落盘路径。默认 ./probe_capture_<时间戳>.json
  --headed                 有头模式（调试用）；默认无头
  --no-autoplay            不加 --autoplay-policy=no-user-gesture-required（默认加，
                           该参数放行无手势自动播放，多数播放器因此自动发起拉流）
  --browser {edge,chromium} 浏览器内核。默认 edge（自动发现 msedge.exe）

环境变量：PROBE_EDGE=<msedge.exe 路径> 可覆盖 Edge 自动发现结果。
输出 JSON：{meta:{url,ua,wait,click,filter,ts}, captures:[{type,method,status,url,body}]}，
  body 为命中响应的前 4KB 文本（媒体二进制为乱码属正常，看状态码即可）。
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime

DEFAULT_FILTER = (r'm3u8|\.flv|\.ts|live|stream|webcast|api|txvlive|playlist|limit_play')

EDGE_CANDIDATES = [
    os.path.expandvars(r'%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe'),
    os.path.expandvars(r'%ProgramFiles%\Microsoft\Edge\Application\msedge.exe'),
    os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe'),
]

UA_PRESETS = {
    'desktop': ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                '(KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'),
    'mobile': ('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) '
               'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'),
}


def find_edge():
    env = os.environ.get('PROBE_EDGE')
    if env and os.path.isfile(env):
        return env
    for p in EDGE_CANDIDATES:
        if os.path.isfile(p):
            return p
    return None


def safe_print(msg):
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode('utf-8', errors='replace').decode('utf-8', errors='replace'),
              flush=True)


def main():
    ap = argparse.ArgumentParser(description='通用 Playwright+Edge 无头抓包探针')
    ap.add_argument('url')
    ap.add_argument('--ua', choices=['desktop', 'mobile'], default='desktop')
    ap.add_argument('--wait', type=float, default=15.0)
    ap.add_argument('--click', action='append', default=[],
                    help='观测中点击坐标，格式 X,Y，可多次指定')
    ap.add_argument('--js', action='append', default=[],
                    help='观测中执行一次页面内 JS（如触发 video.play()），可多次')
    ap.add_argument('--filter', default=None,
                    help='URL 过滤正则（默认媒体/接口集；与 --all 互斥）')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--out', default=None)
    ap.add_argument('--headed', action='store_true')
    ap.add_argument('--no-autoplay', action='store_true')
    ap.add_argument('--browser', choices=['edge', 'chromium'], default='edge')
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        safe_print('缺少 playwright：pip install playwright（浏览器用系统 Edge，无需下载内核）')
        sys.exit(1)

    pattern = None if args.all else re.compile(args.filter or DEFAULT_FILTER, re.I)
    out_path = args.out or ('probe_capture_%s.json'
                            % datetime.now().strftime('%Y%m%d_%H%M%S'))
    captures = []

    def interesting(u):
        return pattern is None or bool(pattern.search(u))

    def on_request(req):
        if interesting(req.url):
            captures.append({'type': 'request', 'method': req.method, 'status': None,
                             'url': req.url, 'body': None})
            safe_print('REQ %s %s' % (req.method, req.url[:200]))

    def on_response(resp):
        if interesting(resp.url):
            body = None
            try:
                body = resp.text()[:4096]
            except Exception:
                body = None
            captures.append({'type': 'response', 'method': None, 'status': resp.status,
                             'url': resp.url, 'body': body})
            safe_print('RESP %s %s' % (resp.status, resp.url[:200]))

    browser_kind = args.browser
    if browser_kind == 'edge':
        exe = find_edge()
        if not exe:
            safe_print('未找到 msedge.exe：请设 PROBE_EDGE 或用 --browser chromium')
            sys.exit(1)
        safe_print('using Edge: %s' % exe)
    else:
        exe = None

    launch_kwargs = {'headless': not args.headed}
    if browser_kind == 'edge':
        launch_kwargs['executable_path'] = exe
    if not args.no_autoplay:
        launch_kwargs.setdefault('args', []).append(
            '--autoplay-policy=no-user-gesture-required')

    meta = {'url': args.url, 'ua': args.ua, 'wait': args.wait, 'clicks': args.click,
            'js': args.js,
            'filter': (args.filter or DEFAULT_FILTER) if not args.all else None,
            'ts': time.time(), 'browser': browser_kind}

    with sync_playwright() as p:
        browser = (p.chromium.launch(**launch_kwargs) if browser_kind == 'chromium'
                   else p.chromium.launch(**launch_kwargs))
        ctx = browser.new_context(user_agent=UA_PRESETS[args.ua],
                                  viewport={'width': 1280, 'height': 800}
                                  if args.ua == 'desktop' else {'width': 390, 'height': 844})
        page = ctx.new_page()
        page.on('request', on_request)
        page.on('response', on_response)

        safe_print('goto %s ...' % args.url)
        try:
            page.goto(args.url, wait_until='domcontentloaded', timeout=60000)
        except Exception as e:
            safe_print('goto 异常（继续观测已加载部分）：%s' % str(e)[:120])
        page.wait_for_timeout(args.wait * 1000)
        for c in args.click:
            try:
                x, y = (int(v) for v in c.split(',', 1))
                page.mouse.click(x, y)
                safe_print('clicked (%d,%d)' % (x, y))
            except Exception as e:
                safe_print('click 失败 %s: %s' % (c, str(e)[:80]))
        for js in args.js:
            try:
                ret = page.evaluate(js)
                safe_print('js 执行结果: %s' % str(ret)[:100])
            except Exception as e:
                safe_print('js 执行异常: %s' % str(e)[:80])
        page.wait_for_timeout(max(args.wait * 0.6, 5) * 1000)
        browser.close()

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({'meta': meta, 'captures': captures}, f,
                  ensure_ascii=False, indent=1)
    safe_print('captures=%d -> %s' % (len(captures), out_path))


if __name__ == '__main__':
    main()
