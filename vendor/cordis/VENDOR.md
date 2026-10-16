# vendor/cordis —— Cordis 源码 vendor（锁源 + 记账）

> 治理铁律 10「借鉴必记账」：来源 + 许可证 + 借用范围，一个都不能少。

## 来源（Source）

- **上游仓库**：`github.com/geohotstan/cordis-py`（pure Python port of cordiverse/cordis v4）
- **import 名**：`cordis`
- **获取方式**：**传递性 vendor** —— 本目录逐字节复制自 `G:/repos/3dworld/vendor/cordis`
  （2026-10-16）。该仓已用 GitHub「Download ZIP」归档 zip 的 **comment 字段 = commit SHA**
  离线钉死（`unzip -z cordis-py-main.zip`，见其 VENDOR.md / cordis.lock）。
  本次未重新下载 zip；复制后已 `diff -rq` 与 3dworld 副本复核一致（唯一差异为其 `__pycache__`）。
- **版本 / 提交锁定**：
  - 包版本 `__version__ = "4.0.0"`，与 vendored 源码一致 ✓
  - 分支 `main`，commit `a3d0c171571c6bbb465d04c06eab2de53d270814`（短 `a3d0c17`，
    "test(paper): render the Cordis paper as an executable test suite"，2026-08-14）
  - 🔒 溯源契约见 **`vendor/cordis.lock`**（commit + 逐文件 sha256 清单 + 复核命令）。

## 许可证（License）

- **MIT**（上游 pyproject 声明）。本目录 `LICENSE` 为按 pyproject 声明补录的标准 MIT 文本
  （著作权人 `Cordis Python Port Contributors`），与 3dworld 处理一致；
  如日后拿到上游 LICENSE 原件，以其为准覆盖。

## 借用范围（Scope / API surface）

本工程仅借用以下公开 API：

- `cordis.Context` —— 依赖注入容器（插件上下文）
- `cordis.Service` —— 服务基类（`ctx.<服务名>` 属性访问 / `__cordis_init__` 钩子）
- `cordis.Fiber` —— 生命周期与可逆副作用（dispose 回滚）
- `cordis.Loader` / `cordis.Entry` / `cordis.EntryTree` —— 配置树加载
- `cordis.Inject` / `cordis.evaluate` / `cordis.interpolate` —— 注入声明与配置插值

### ⚠️ v4.0.0 API 形态核对项

- `Context` 为 **fiber 属性式 API**（`provide` / `inject` / `effect` 经 fiber 属性，
  非 `ctx.provide(...)` 方法式调用）。
- 服务实例化：构造函数 `__init__(self, ctx, config)`；初始化钩子 `__cordis_init__(self)`。
- `ctx.<服务名>` 访问返回 **Traceable 代理**：普通属性直通；方法调用注入 shadow self
  （因此 **Service 里不要写 `@staticmethod`**，辅助方法一律实例方法）。
- Loader 会**吞掉插件构造期异常**：服务"不就绪"时，手工 `import <entry 的 name>` 看真实 traceback。

## 导入方式（如何离线 import）

源码布局保留上游 src-layout：`vendor/cordis/src/cordis/` 即包根。三种接法：

1. **已为本 venv 挂 .pth**（推荐，已做）：
   `.venv/Lib/site-packages/zz_vendor_cordis.pth` 含一行 `G:/repos/image-scraper/vendor/cordis/src`
2. 仓库内统一入口：`import _cordis_locate; _cordis_locate.ensure()`（由 `__file__` 绝对推导）
3. 临时：环境变量 `CORDIS_SRC` 指向 `vendor/cordis/src`（须过 isdir 校验）

### 运行时依赖（Runtime deps）

`import cordis` **硬依赖** `pyyaml`（`include.py` 顶部 `import yaml`）；
`hmr` 用到 `watchdog`。已入 `requirements.txt`，本 venv 已装。

## 文件清单（本目录）

- `src/cordis/` —— 包源码（16 模块，src-layout）
- `tests/` —— 上游测试套件（156 tests，便于 vendored 副本自测；不强制运行）
- `pyproject.toml` / `README.md` —— 上游元数据（保留以对照版本/许可）
- `LICENSE` —— 按 pyproject 声明补录的 MIT 文本
- `VENDOR.md` —— 本文件（记账）
- 布局说明：仅保留 src-layout；未携带 3dworld 副本中的冗余平铺 `cordis/` 目录
  （与其 `src/cordis/` 逐字节相同，属历史残留）。
