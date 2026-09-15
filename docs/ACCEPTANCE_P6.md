# P6 验收报告：门禁与交付（harness 不变量 + check.mjs）

> 日期：2026-09-15 ｜ 分支：`2.0` ｜ 基线：P5（b2e148b）

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `packages/core/test/loader.test.mjs` | loader 纯函数：行式/旧 map 归一化、缺 id 点名、patch 按 id 覆盖（config 浅合并）、`before:` 锚点、未知 id 追加、`affectedClosure` 依赖闭包（根 + 传递依赖） |
| `packages/core/test/engine.test.mjs` | 引擎黄金值：`subst`（缺键保留原样）、`hashName` 与 Python `hashlib.md5` 一致（`'abc' → 900150983cd2`）、`pyQuote` 对齐 `urllib.parse.quote(s, safe="/")`、`buildTasks` 去重/截断/字段完整、`makeStats` 守恒字段 |
| `packages/core/test/invariants.test.mjs` | **端到端不变量**（node:test，最小装配 15 插件 + 本地 mock HTTP）：① 第一轮全量下载（fetched=downloaded=3）+ 落盘文件名/元数据一致；② 第二轮跨运行去重（全部 skipped、无新文件）；③ 失败清单 `writeFailed → readFailed` 链路；④ `source/registered ↔ source/unregistered` 事件配对 + 注册表清空；每轮断言 ROADMAP §11.5 守恒式 `fetched ≥ downloaded + skipped + errors` |
| `scripts/check.mjs` | 质量门禁（对齐 private-radio-stations 范式）：语法检查（node --check 全仓）→ cordis.yml 解析校验（56 插件）→ package.json ×3 → staged whitespace（git 不可用环境自动跳过）→ harness 单测 → 装配冒烟（`--list-sources` exit 0） |
| `package.json` | scripts：`test` / `check` / `check:fast` |

## 2. 实测结果

```
== check: syntax ==                 ok
== check: cordis.yml ==             ok (56 plugins)
== check: package.json ==           ok ×3
== check: git whitespace ==         git unavailable, skip
== check: harness (invariants) ==   # pass 15 | # fail 0
== check: smoke (--list-sources) == ok (exit 0)
check PASSED
```

## 3. 过程中发现并修正的点

- `subst` 缺键行为是**保留 `{var}` 原样**（区分「显式空」与「未提供」）——测试初版断言错误，以源码语义为准修正。
- Windows 下 `node --test <目录>` 不可靠（被当模块解析）→ 改用无参默认发现（排除 node_modules）。
- Windows ESM 动态 import 绝对路径需 `pathToFileURL`。
- cordis `ctx.plugin()` 返回 fiber，测试装配需逐个 `await`（对齐 loader.start 的审计方式），否则服务访问早于注册完成。
- 环境无 git（PortableGit 需 `GIT_EXEC_PATH`）时 whitespace 检查自动跳过而非误报。

## 4. 限制与后续项

- **打包**（.iss/.bat，对齐既有仓库习惯）：属部署层，Python 基线无对应自动化，沙箱内无 Inno Setup 可验证 → 记为后续。
- harness 目前覆盖 loader/engine/下载管线核心不变量；30 个真实源的逐源回归依赖外网与凭据，沿用 P0–P5 各阶段实测记录作基线。

## 5. 结论

P6 通过。全仓门禁一条命令（`npm run check`）可回归：语法 / 装配 / 单测 / 冒烟全绿，不变量（数据守恒、事件配对、跨运行去重、与 Python 哈希一致）固化在测试中。
