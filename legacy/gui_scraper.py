#!/usr/bin/env python3
"""
多源图片爬虫 · GUI 版 (tkinter)
===============================
在当前 mj_scraper.py (命令行调度器) 基础上封装的图形界面。
直接复用 mj_scraper 的 build_source / run_source / retry_failed 与 sources.base 的
下载/元数据基础设施，不重复造轮子。

特性：
  - 源选择（全部 23 个源 + all 并行顺序模式）
  - 通用设置：每源最大数 / 并发 / 代理 / 重试 / 限速
  - 源专属设置：根据所选源动态显示对应参数
  - 实时日志流（复用 sources.base 的 log logger）
  - 结果汇总表（获取/下载/跳过/失败/耗时）
  - 失败清单一键重投（文件选择）
  - 一键打开图片输出目录

运行：
  python gui_scraper.py
（依赖与 mj_scraper.py 相同：playwright + httpx，Python 3.13+）
"""

from __future__ import annotations

import asyncio
import logging
import queue
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

# ── 确保能 import 自身目录与 sources 包 ──
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from sources.base import log  # 与 mj_scraper / 各源共用的 logger  (NOQA)
from mj_scraper import (  # noqa: E402
    ALL_SOURCES,
    build_source,
    retry_failed,
    run_source,
    IMAGES_DIR,
    OUTPUT_DIR,
)

import config  # 持久化代理 / API Key (NOQA)


# ───────────────────────────── 字段定义 ─────────────────────────────
# 每个字段描述：key / label / type / default / section / sources
# type ∈ {str, int, float, bool, choice}
@dataclass
class Field:
    key: str
    label: str
    type: str
    default: object
    section: str = "common"
    sources: tuple = ()
    choices: tuple = ()
    hint: str = ""


FIELDS: list[Field] = [
    # ── 通用 ──
    Field("max_images", "每源最大下载数", "int", 100, "common"),
    Field("concurrency", "并发下载数", "int", 5, "common"),
    Field("proxy", "代理 (留空=无)", "str", "", "common",
          hint="如 socks5://127.0.0.1:1080"),
    Field("auto_proxy", "自动获取代理(zdopen/zdaye)", "bool", False, "common"),
    Field("auto_proxy_socks", "自动代理优先 SOCKS5", "bool", False, "common"),
    Field("retries", "下载失败重试次数", "int", 3, "common"),
    Field("rate_limit", "请求速率上限(次/秒, 0=不限)", "float", 0.0, "common"),
    Field("speed_limit", "下载速度上限(KB/s, 0=不限)", "float", 0.0, "common"),

    # ── 网页 / 指定内容链接爬取 ──
    Field("url", "目标 URL", "str", "", "src",
          sources=("webpage", "midjourney_url", "midjourney_video_url"),
          hint="webpage: 任意网页；midjourney_url: https://www.midjourney.com/jobs/<uuid>?index=2"),

    # ── 跨源共享：搜索词 ──
    Field("query", "搜索关键词", "str", "ai art", "src",
          sources=("bing", "unsplash", "pexels", "lexica", "wallhaven",
                   "artstation", "google", "pixiv", "deviantart", "flickr",
                   "pinterest", "duitang", "reddit")),

    # ── Midjourney ──
    Field("tab", "Tab", "choice", "top", "src", ("midjourney",),
          choices=("top", "trending", "random", "new", "hot")),
    Field("size", "图片尺寸", "choice", "thumb", "src", ("midjourney",),
          choices=("thumb", "medium", "original", "original_webp")),
    Field("scrolls", "滚动次数", "int", 20, "src", ("midjourney",)),
    Field("headless", "无头浏览器(不弹窗)", "bool", True, "src", ("midjourney",)),

    # ── Midjourney 指定链接源（midjourney_url / midjourney_video_url）──
    Field("mj_index", "指定变体(0=全部,1-4)", "int", 0, "src",
          sources=("midjourney_url", "midjourney_video_url")),

    # ── Bing ──
    Field("pages", "翻页数", "int", 3, "src", ("bing",)),

    # ── Unsplash ──
    Field("unsplash_mode", "模式", "choice", "search", "src", ("unsplash",),
          choices=("search", "random")),
    Field("unsplash_key", "Unsplash Key(留空=环境变量)", "str", "", "src", ("unsplash",)),

    # ── Pexels ──
    Field("pexels_key", "Pexels Key(留空=环境变量)", "str", "", "src", ("pexels",)),

    # ── Civitai ──
    Field("civitai_sort", "排序", "choice", "Newest", "src", ("civitai",),
          choices=("Newest", "Most Reactions", "Most Comments")),
    Field("nsfw", "包含 NSFW", "bool", False, "src", ("civitai",)),
    Field("civitai_user", "用户名筛选(可选)", "str", "", "src", ("civitai",)),

    # ── Booru (Safebooru / Konachan) ──
    Field("tags", "标签/关键词", "str", "art", "src", ("safebooru", "konachan")),
    Field("booru_limit", "每页条数", "int", 40, "src", ("safebooru", "konachan")),
    Field("booru_exclude", "标签黑名单(逗号分隔)", "str", "", "src",
          ("safebooru", "konachan"), hint="如 blood,gore,nude"),
    Field("booru_rating", "Konachan 分级(s/q/e)", "str", "s", "src", ("konachan",)),

    # ── Wallhaven ──
    Field("wallhaven_key", "Wallhaven Key(NSFW 需)", "str", "", "src", ("wallhaven",)),
    Field("wallhaven_nsfw", "包含 NSFW(需 Key)", "bool", False, "src", ("wallhaven",)),
    Field("wallhaven_sorting", "排序", "str", "toplist", "src", ("wallhaven",),
          hint="toplist / views / favorites"),

    # ── ArtStation ──
    Field("artstation_sorting", "排序", "str", "popular", "src", ("artstation",),
          hint="popular / newest / trending"),

    # ── Google ──
    Field("google_pages", "翻页数", "int", 3, "src", ("google",)),

    # ── Pixiv ──
    Field("pixiv_order", "排序", "choice", "popular_d", "src", ("pixiv",),
          choices=("popular_d", "date_d")),
    Field("pixiv_mode", "模式", "choice", "all", "src", ("pixiv",),
          choices=("all", "safe", "r18")),

    # ── DeviantArt ──
    Field("deviantart_sort", "排序", "str", "popular", "src", ("deviantart",),
          hint="popular / newest / hot"),

    # ── Flickr ──
    Field("flickr_key", "Flickr Key(留空=环境变量)", "str", "", "src", ("flickr",)),
    Field("flickr_sort", "排序", "str", "relevance", "src", ("flickr",),
          hint="relevance / interestingness-desc / date-posted-desc"),

    # ── Pinterest ──
    Field("pinterest_pages", "翻页数", "int", 3, "src", ("pinterest",)),

    # ── Picsum ──
    Field("picsum_query", "作者过滤(可空)", "str", "", "src", ("picsum",),
          hint="留空=全量随机高清图"),

    # ── Reddit ──
    Field("reddit_mode", "模式", "choice", "sub", "src", ("reddit",),
          choices=("sub", "search"), hint="sub=版块 r/<词> / search=关键词"),
]

COMMON_FIELDS = [f for f in FIELDS if f.section == "common"]
SRC_FIELDS = [f for f in FIELDS if f.section == "src"]


# ───────────────────────────── 日志桥接 ─────────────────────────────
class QueueHandler(logging.Handler):
    """把 log 记录推到 GUI 线程安全的队列"""

    def __init__(self, q: "queue.Queue"):
        super().__init__()
        self.q = q

    def emit(self, record: logging.LogRecord):
        try:
            self.q.put(("log", self.format(record)))
        except Exception:
            pass


# ───────────────────────────── UI ─────────────────────────────
class ScraperGUI:
    # 源专属 Key 字段 -> config.keys 的服务名
    KEY_FIELD_MAP = {
        "unsplash_key": "unsplash",
        "pexels_key": "pexels",
        "flickr_key": "flickr",
        "wallhaven_key": "wallhaven",
    }

    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("多源图片爬虫 · GUI")
        self.root.geometry("1080x720")
        try:
            ttk.Style().theme_use("clam")
        except Exception:
            pass

        self.running = False
        self.thread: threading.Thread | None = None
        self.stop_event: threading.Event | None = None
        self.msg_queue: queue.Queue = queue.Queue()
        self.retry_mode = False
        self.retry_path = ""

        # 控件引用
        self.vars: dict[str, tk.Variable] = {}        # 字段 key -> tk 变量
        self.src_widgets: list[ttk.Widget] = []       # 源专属区内的控件
        self.result_rows: list[tuple] = []            # 结果表缓存

        # 持久化配置：代理与 Key（加载用于预填）
        self.config = config.load_config()

        self._build_ui()
        self._rebuild_src_frame(self.source_var.get())
        self.poll()

    # ── 界面构建 ──
    def _build_ui(self):
        # 顶部工具栏
        top = ttk.Frame(self.root, padding=8)
        top.pack(fill=tk.X)

        ttk.Label(top, text="图片源:", font=("Segoe UI", 10, "bold")).pack(side=tk.LEFT)
        self.source_var = tk.StringVar(value="midjourney")
        src_names = ["all"] + ALL_SOURCES
        self.source_cb = ttk.Combobox(top, textvariable=self.source_var,
                                      values=src_names, state="readonly", width=16)
        self.source_cb.pack(side=tk.LEFT, padx=(4, 0))
        self.source_cb.bind("<<ComboboxSelected>>",
                            lambda e: self._rebuild_src_frame(self.source_var.get()))

        self.start_btn = ttk.Button(top, text="▶ 开始", command=self.on_start)
        self.start_btn.pack(side=tk.LEFT, padx=6)
        self.stop_btn = ttk.Button(top, text="■ 停止", command=self.on_stop, state=tk.DISABLED)
        self.stop_btn.pack(side=tk.LEFT)
        self.retry_btn = ttk.Button(top, text="↻ 重投失败清单", command=self.on_retry)
        self.retry_btn.pack(side=tk.LEFT, padx=6)
        self.open_btn = ttk.Button(top, text="📂 打开图片目录", command=self.open_images)
        self.open_btn.pack(side=tk.LEFT, padx=6)
        self.save_cfg_btn = ttk.Button(top, text="💾 保存配置", command=self.on_save_config)
        self.save_cfg_btn.pack(side=tk.LEFT, padx=6)
        self.test_proxy_btn = ttk.Button(top, text="🔌 测试代理", command=self.on_test_proxy)
        self.test_proxy_btn.pack(side=tk.LEFT, padx=6)

        self.status_var = tk.StringVar(value="就绪")
        ttk.Label(top, textvariable=self.status_var, foreground="#2a7").pack(side=tk.RIGHT)

        # 主体：左设置 / 右日志+结果
        body = ttk.Frame(self.root)
        body.pack(fill=tk.BOTH, expand=True, padx=8, pady=(0, 8))

        # 左侧滚动设置区
        left = ttk.Frame(body, width=320)
        left.pack(side=tk.LEFT, fill=tk.Y, padx=(0, 6))
        left.pack_propagate(False)

        self.canvas = tk.Canvas(left, borderwidth=0, highlightthickness=0)
        self.canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        vsb = ttk.Scrollbar(left, orient=tk.VERTICAL, command=self.canvas.yview)
        vsb.pack(side=tk.RIGHT, fill=tk.Y)
        self.canvas.configure(yscrollcommand=vsb.set)

        self.inner = ttk.Frame(self.canvas)
        self.inner_id = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>",
                        lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>",
                         lambda e: self.canvas.itemconfig(self.inner_id, width=e.width))
        # 鼠标滚轮
        self.canvas.bind_all("<MouseWheel>",
                              lambda e: self.canvas.yview_scroll(-1 * (e.delta // 120), "units"))

        # 通用设置
        cf = ttk.LabelFrame(self.inner, text="通用设置", padding=8)
        cf.pack(fill=tk.X, pady=(0, 8))
        for f in COMMON_FIELDS:
            self._make_field(cf, f)

        # 源专属设置
        self.src_lf = ttk.LabelFrame(self.inner, text="源专属设置", padding=8)
        self.src_lf.pack(fill=tk.X)

        # 右侧：日志 + 进度 + 结果
        right = ttk.Frame(body)
        right.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self.progress = ttk.Progressbar(right, mode="indeterminate")
        self.progress.pack(fill=tk.X, pady=(0, 6))

        ttk.Label(right, text="运行日志", font=("Segoe UI", 9, "bold")).pack(anchor=tk.W)
        log_frame = ttk.Frame(right)
        log_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 6))
        self.log_text = tk.Text(log_frame, wrap=tk.WORD, font=("Consolas", 9),
                                bg="#0f1419", fg="#c8d3e0", state=tk.DISABLED)
        self.log_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        lsb = ttk.Scrollbar(log_frame, orient=tk.VERTICAL, command=self.log_text.yview)
        lsb.pack(side=tk.RIGHT, fill=tk.Y)
        self.log_text.configure(yscrollcommand=lsb.set)

        ttk.Label(right, text="结果汇总", font=("Segoe UI", 9, "bold")).pack(anchor=tk.W)
        res_frame = ttk.Frame(right)
        res_frame.pack(fill=tk.BOTH, expand=True)
        cols = ("源", "获取", "下载", "跳过", "失败", "耗时(s)")
        self.tree = ttk.Treeview(res_frame, columns=cols, show="headings", height=6)
        for c in cols:
            self.tree.heading(c, text=c)
            self.tree.column(c, anchor=tk.CENTER, width=90 if c != "源" else 140)
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        rsb = ttk.Scrollbar(res_frame, orient=tk.VERTICAL, command=self.tree.yview)
        rsb.pack(side=tk.RIGHT, fill=tk.Y)
        self.tree.configure(yscrollcommand=rsb.set)

    def _make_field(self, parent: ttk.Widget, f: Field):
        row = ttk.Frame(parent)
        row.pack(fill=tk.X, pady=2)
        lbl = ttk.Label(row, text=f.label, width=22, anchor=tk.W)
        lbl.pack(side=tk.LEFT)

        # 默认值：优先用已保存配置（代理 / 各源 Key）
        default = f.default
        if f.key in self.KEY_FIELD_MAP:
            saved = self.config["keys"].get(self.KEY_FIELD_MAP[f.key], "")
            if saved:
                default = saved
        elif f.key == "proxy":
            saved = self.config["proxy"] or config.detect_proxy()
            if saved:
                default = saved

        if f.type == "bool":
            var = tk.BooleanVar(value=default)
            self.vars[f.key] = var
            cb = ttk.Checkbutton(row, variable=var)
            cb.pack(side=tk.LEFT)
            return

        if f.type == "choice":
            var = tk.StringVar(value=default)
            self.vars[f.key] = var
            cb = ttk.Combobox(row, textvariable=var, values=list(f.choices),
                              state="readonly", width=16)
            cb.pack(side=tk.LEFT)
            return

        # str / int / float
        var = tk.StringVar(value=str(default))
        self.vars[f.key] = var
        w = 14 if f.type in ("int", "float") else 22
        ent = ttk.Entry(row, textvariable=var, width=w)
        ent.pack(side=tk.LEFT)
        if f.hint:
            ttk.Label(row, text=f.hint, foreground="#888",
                      font=("Segoe UI", 8)).pack(side=tk.LEFT, padx=4)
        return

    def _rebuild_src_frame(self, source: str):
        # 清空旧控件
        for w in self.src_widgets:
            try:
                w.destroy()
            except Exception:
                pass
        self.src_widgets = []

        if source == "all":
            note = ttk.Label(self.src_lf,
                             text="全部源：将顺序运行所有可达源（被墙/缺 key 自动跳过）。\n"
                                  "通用设置对所有源生效；源专属参数仅对对应源有效。",
                             foreground="#666", wraplength=280)
            note.pack(fill=tk.X, pady=4)
            self.src_widgets.append(note)
            return

        applicable = [f for f in SRC_FIELDS if source in f.sources]
        if not applicable:
            note = ttk.Label(self.src_lf, text="该源无额外参数。", foreground="#666")
            note.pack(fill=tk.X, pady=4)
            self.src_widgets.append(note)
            return

        for f in applicable:
            self._make_field(self.src_lf, f)
        self._sync_src_widgets()

    def _sync_src_widgets(self):
        # 记录 src_lf 下的所有子控件，供下次重建销毁
        self.src_widgets = list(self.src_lf.winfo_children())

    # ── 取值 ──
    def get_value(self, f: Field):
        var = self.vars.get(f.key)
        if var is None:
            return f.default
        raw = var.get()
        if f.type == "bool":
            return bool(raw)
        if f.type == "choice":
            return raw
        if f.type == "int":
            try:
                return int(raw)
            except Exception:
                return f.default
        if f.type == "float":
            try:
                return float(raw)
            except Exception:
                return f.default
        return raw

    def build_args(self) -> SimpleNamespace:
        args = SimpleNamespace()
        for f in FIELDS:
            setattr(args, f.key, f.default)
        for f in FIELDS:
            if f.key in self.vars:
                setattr(args, f.key, self.get_value(f))
        args.source = self.source_var.get()

        # 持久化：把当前代理与已填 Key 写入 config.json
        keys = {}
        for fk, svc in self.KEY_FIELD_MAP.items():
            v = self.vars.get(fk)
            if v is not None and v.get():
                keys[svc] = v.get()
        config.save_config(args.proxy, keys)

        return args

    # ── 运行控制 ──
    def on_start(self):
        if self.running:
            return
        self._start_run(retry=False)

    def on_retry(self):
        if self.running:
            return
        path = filedialog.askopenfilename(
            title="选择失败清单 JSON",
            initialdir=str(OUTPUT_DIR / "meta"),
            filetypes=[("JSON 文件", "*.json"), ("全部", "*.*")],
        )
        if not path:
            return
        self.retry_path = path
        self._start_run(retry=True)

    def _start_run(self, retry: bool):
        self.retry_mode = retry
        self.running = True
        self.stop_event = threading.Event()
        self._clear_results()
        self._log(f"=== {'重投模式' if retry else '开始抓取'} ===\n")
        self.progress.start(20)
        self._set_running_ui(True)
        self.thread = threading.Thread(target=self._worker, daemon=True)
        self.thread.start()

    def on_stop(self):
        if self.stop_event is not None:
            self.stop_event.set()
        self.status_var.set("停止请求已发出…")

    def _set_running_ui(self, running: bool):
        self.start_btn.configure(state=tk.DISABLED if running else tk.NORMAL)
        self.retry_btn.configure(state=tk.DISABLED if running else tk.NORMAL)
        self.stop_btn.configure(state=tk.NORMAL if running else tk.DISABLED)
        self.source_cb.configure(state=tk.DISABLED if running else "readonly")

    # ── 工作线程 ──
    def _worker(self):
        qh = QueueHandler(self.msg_queue)
        qh.setLevel(logging.INFO)
        qh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        log.addHandler(qh)
        log.setLevel(logging.INFO)
        # 第三方库降噪
        for n in ("httpx", "playwright", "asyncio", "urllib3"):
            logging.getLogger(n).setLevel(logging.WARNING)

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._run_task())
        except Exception:
            import traceback
            self.msg_queue.put(("error", traceback.format_exc()))
        finally:
            log.removeHandler(qh)
            self.msg_queue.put(("finished", None))

    async def _run_task(self):
        args = self.build_args()

        # 自动获取代理（站大爷免费页/zdopen），仅当勾选且未手填代理时生效
        if getattr(args, "auto_proxy", False) and not args.proxy:
            self.msg_queue.put(("status", "正在自动获取可用代理…"))
            try:
                from proxy_fetcher import fetch_working_proxy
                p = await fetch_working_proxy(
                    prefer_socks=bool(getattr(args, "auto_proxy_socks", False)),
                )
            except Exception as e:  # noqa
                p = None
                self.msg_queue.put(("log", f"⚠ 自动代理获取异常: {e}"))
            if p:
                args.proxy = p
                self.vars["proxy"].set(p)   # 仅本次界面回显，不写盘（避免污染下一次运行）
                self.msg_queue.put(("log", f"✓ 自动选用代理: {p}（仅本次运行，不保存）"))
            else:
                self.msg_queue.put(("log", "⚠ 未获取到可用代理，将无代理运行"))

        if self.retry_mode:
            self.msg_queue.put(("status", f"重投清单: {Path(self.retry_path).name}"))
            res = await retry_failed(Path(self.retry_path), args)
            self.msg_queue.put(("result", {"retry": res}))
            return

        sources = ALL_SOURCES if args.source == "all" else [args.source]
        self.msg_queue.put(("status", f"源={sources} | 每源 max={args.max_images}"))
        for name in sources:
            if self.stop_event.is_set():
                self.msg_queue.put(("status", "已停止（用户请求）"))
                break
            self.msg_queue.put(("status", f"▶ 运行中: {name}"))
            try:
                r = await run_source(name, args)
                self.msg_queue.put(("result", r))
            except Exception as e:  # 单个源异常不影响其余
                self.msg_queue.put(("result", {name: f"error: {e}"}))

    # ── 消息泵 ──
    def poll(self):
        try:
            while True:
                kind, data = self.msg_queue.get_nowait()
                self._handle(kind, data)
        except queue.Empty:
            pass
        self.root.after(120, self.poll)

    def _handle(self, kind, data):
        if kind == "log":
            self._log(data)
        elif kind == "status":
            self.status_var.set(data)
        elif kind == "result":
            self._add_result(data)
        elif kind == "error":
            self._log("ERROR:\n" + data)
            self.status_var.set("运行出错")
            self._finish()
        elif kind == "finished":
            self._finish()

    def _finish(self):
        self.running = False
        self.progress.stop()
        self._set_running_ui(False)
        self.status_var.set("完成")
        self._log("=== 运行结束 ===\n")

    # ── 日志/结果展示 ──
    def _log(self, text: str):
        self.log_text.configure(state=tk.NORMAL)
        self.log_text.insert(tk.END, text + "\n")
        self.log_text.configure(state=tk.DISABLED)
        self.log_text.see(tk.END)

    def _clear_results(self):
        for row in self.tree.get_children():
            self.tree.delete(row)

    def _add_result(self, result: dict):
        for name, info in result.items():
            if isinstance(info, dict) and "fetched" in info:
                self.tree.insert("", tk.END, values=(
                    name, info.get("fetched", 0), info.get("downloaded", 0),
                    info.get("skipped", 0), info.get("errors", 0),
                    info.get("elapsed", 0),
                ))
            elif name == "retry" and isinstance(info, dict):
                self.tree.insert("", tk.END, values=(
                    "retry", info.get("total", "-"), info.get("downloaded", "-"),
                    "-", info.get("errors", "-"), "-"))
            else:
                self.tree.insert("", tk.END, values=(name, "-", "-", "-", "-", str(info)))

    # ── 工具 ──
    def open_images(self):
        path = str(IMAGES_DIR)
        try:
            import os
            os.startfile(path)
        except Exception:
            import subprocess
            try:
                subprocess.Popen(["explorer", path])
            except Exception as e:
                messagebox.showerror("错误", f"无法打开目录: {e}")

    def on_save_config(self):
        """把当前代理与已填 Key 写入 config.json 并提示"""
        args = self.build_args()
        self.config = config.load_config()  # 重新读取以反映刚保存的 Key
        saved = [svc for svc, v in self.config["keys"].items() if v]
        messagebox.showinfo(
            "配置已保存",
            f"代理: {args.proxy or '（无）'}\n"
            f"已保存 Key: {', '.join(saved) if saved else '（无）'}\n\n"
            f"配置存于 config.json，下次启动自动加载。"
        )
        self._log("💾 配置已写入 config.json")

    def on_test_proxy(self):
        """测通被墙源：用当前/探测到的代理逐个验证可达性"""
        if self.running:
            return
        args = self.build_args()
        proxy = args.proxy or config.detect_proxy()
        if not proxy:
            self._log("⚠ 未配置代理且未探测到本地代理；被墙源无法测通。\n"
                      "   请在「通用设置 → 代理」填入，如 socks5://127.0.0.1:1080")
            return
        # 回填探测到的代理并保存
        if not args.proxy:
            self.vars["proxy"].set(proxy)
            config.save_config(proxy, {})
        self._log(f"\n🔌 开始测通被墙源（代理={proxy}）…")
        threading.Thread(target=self._test_proxy_worker, args=(proxy,), daemon=True).start()

    def _test_proxy_worker(self, proxy: str):
        import asyncio
        from verify_proxy import make_args, gfw_sources, test_one
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            a = make_args(proxy)
            sources = gfw_sources(a)
            self.msg_queue.put(("log", f"被墙源共 {len(sources)} 个: {sources}"))
            ok = 0
            for name in sources:
                try:
                    n, status, el, detail = loop.run_until_complete(test_one(name, a, 25.0))
                except Exception as e:  # noqa
                    n, status, el, detail = name, "ERR", 0.0, str(e)[:60]
                if status in ("OK", "EMPTY"):
                    ok += 1
                flag = {"OK": "✓", "EMPTY": "○", "TIMEOUT": "✗",
                        "FAIL": "✗", "ERR": "✗"}.get(status, "?")
                self.msg_queue.put(("log", f"  {flag} {n:12} {status:8} {el:5.1f}s {detail}"))
            self.msg_queue.put(("log",
                f"结论: {ok}/{len(sources)} 个被墙源可经代理访问。\n"
                f"   ✓=成功取数  ○=代理通但源返回空(可能缺Key/无结果)  ✗=代理无效"))
        finally:
            loop.close()
        self.msg_queue.put(("status", "代理测试完成"))


def main():
    root = tk.Tk()
    try:
        ScraperGUI(root)
        root.mainloop()
    except Exception as e:
        import traceback
        messagebox.showerror("启动失败", f"{e}\n\n{traceback.format_exc()}")


if __name__ == "__main__":
    main()
