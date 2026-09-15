// @scraper/core — 声明式 loader（移植自 @relay/core，与 private-radio-stations 保持同一套装配纪律）。
//
// 特性：
//   - `!!js` 配置表达式（yml 可写 pages: !!js "Number(process.env.PAGES) || 3"）；
//   - 行式配置：plugins 为 {id, module?, config?, disabled?, hot?} 数组（兼容旧 map 形式）；
//   - patch 分层：cordis.patch.yml + CORDIS_PATCH 环境变量（按 id 覆盖 / before 锚点插入）；
//   - 启动结算审计：逐个 await 插件 fiber，失败点名（带 id + stack）；
//   - 应用后核对每个插件的同名 Service 是否注册（inject 缺失当场暴露）；
//   - P8A patch 热重载 + P8B 依赖闭包级联重载。
//
// 相对 @relay 的唯一增强：`module` 支持**裸模块标识符**。
//   - `module: './foo.js'` / 绝对路径 → 相对 pluginsDir 解析（原行为）
//   - `module: '@scraper/core/src/drivers-http.js'` → 交给 Node 解析（新增）
//   这样 cordis.yml 可以直接引用公共包里的插件，无需为每个插件写转发文件。
import { readFile } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import yaml from 'js-yaml'

// !!js 简写在 YAML 规范里映射到 tag:yaml.org,2002:js，注册必须用完整 URI
const JS_EXPR = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: (data) => ({ __jsExpr: String(data) }),
})
const JS_SCHEMA = yaml.DEFAULT_SCHEMA.extend([JS_EXPR])

function evaluateJs(expr, scope) {
  // 作用域受控：仅暴露 process/env/path/__dirname/root
  const fn = new Function('process', 'env', 'path', '__dirname', 'root', 'return (' + expr + ')')
  return fn(scope.process, scope.env, scope.path, scope.__dirname, scope.root)
}

export function interpolate(value, scope) {
  if (value && typeof value === 'object' && value.__jsExpr !== undefined) {
    return evaluateJs(value.__jsExpr, scope)
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, scope))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = interpolate(v, scope)
    return out
  }
  return value
}

// 供质量门禁等复用：按项目 schema（含 !!js）解析 cordis.yml 文本
export function parseCordisYml(text) {
  return yaml.load(text, { schema: JS_SCHEMA }) || {}
}

// 行式归一化：新旧两种 cordis.yml 写法 → 统一 Entry 行
export function normalizeEntries(doc) {
  const raw = (doc && doc.plugins) || {}
  if (Array.isArray(raw)) {
    return {
      entries: raw.map((e, i) => {
        if (!e || typeof e !== 'object') throw new Error('[boot] plugins[' + i + '] 必须为对象行')
        if (!e.id) throw new Error('[boot] plugins[' + i + '] 缺少 id')
        return {
          id: String(e.id),
          module: e.module ? String(e.module) : null,
          config: e.config || {},
          disabled: !!e.disabled,
          hot: !!e.hot,
          source: 'base',
        }
      }),
      legacy: false,
    }
  }
  // 旧 map 形式：{ name: cfg }
  return {
    entries: Object.entries(raw).map(([id, config]) => ({
      id,
      module: null,
      config: config || {},
      disabled: false,
      hot: false,
      source: 'base',
    })),
    legacy: true,
  }
}

function defaultPatchPath(yamlPath) {
  return path.join(path.dirname(yamlPath), 'cordis.patch.yml')
}

// P7：读取 patch 文件（默认 cordis.patch.yml + CORDIS_PATCH 环境变量追加）
export function loadPatchFiles(yamlPath) {
  const files = []
  const def = defaultPatchPath(yamlPath)
  if (fs.existsSync(def)) files.push(def)
  for (const extra of (process.env.CORDIS_PATCH || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    files.push(path.isAbsolute(extra) ? extra : path.resolve(path.dirname(yamlPath), extra))
  }
  const patches = []
  for (const f of files) {
    try {
      const text = fs.readFileSync(f, 'utf8')
      const doc = parseCordisYml(text)
      if (Array.isArray(doc)) patches.push(...doc.map((e) => e || {}))
      else if (doc && Array.isArray(doc.patches)) patches.push(...doc.patches.map((e) => e || {}))
    } catch (e) {
      throw new Error('[boot] patch 文件解析失败 ' + f + ': ' + e.message)
    }
  }
  return patches
}

// P7：patch 叠加（按 id 覆盖 / before 锚点插入 / disabled 开关）
export function composeEntries(entries, patches) {
  const list = entries.map((e) => ({ ...e, config: { ...e.config } }))
  for (const op of patches) {
    if (!op || typeof op !== 'object' || !op.id) continue
    if (op.before) {
      const neu = { id: String(op.id), module: op.module ? String(op.module) : null, config: op.config || {}, disabled: !!op.disabled, hot: !!op.hot, source: 'patch' }
      const idx = list.findIndex((e) => e.id === op.before)
      if (idx >= 0) list.splice(idx, 0, neu)
      else list.push(neu)
      continue
    }
    const target = list.find((e) => e.id === op.id)
    if (!target) {
      list.push({ id: String(op.id), module: op.module ? String(op.module) : null, config: op.config || {}, disabled: !!op.disabled, hot: !!op.hot, source: 'patch' })
      continue
    }
    target.source = 'patch'
    if (op.module !== undefined) target.module = op.module ? String(op.module) : null
    if (op.config !== undefined) target.config = Object.assign({}, target.config, op.config) // 浅层合并
    if (op.disabled !== undefined) target.disabled = !!op.disabled
    if (op.hot !== undefined) target.hot = !!op.hot
  }
  return list
}

export async function start(ctx, opts = {}) {
  const yamlPath = opts.yamlPath || path.join(process.cwd(), 'cordis.yml')
  const pluginsDir = opts.pluginsDir || path.join(process.cwd(), 'src', 'plugins')
  const root = opts.root || path.dirname(yamlPath)
  const scope = { process, env: process.env, path, __dirname: path.dirname(yamlPath), root }

  const raw = await readFile(yamlPath, 'utf8')
  const doc = parseCordisYml(raw)
  const norm = normalizeEntries(doc)
  if (norm.legacy) {
    ctx.logger.warn('[boot] cordis.yml 使用旧 map 形式，建议迁移为行式')
  }
  const entries = composeEntries(norm.entries, loadPatchFiles(yamlPath))

  const state = { entries: [], fibers: new Map() }
  ctx.$loader = state

  // 逐个应用并审计（对应 harness 的 assertEntriesLoaded/assertEntriesActivated）
  for (const entry of entries) {
    if (entry.disabled) {
      ctx.logger.info('[boot] 插件 ' + entry.id + ' 已禁用，跳过')
      continue
    }
    const cfg = interpolate(entry.config, scope)
    const fiber = await applyEntry(ctx, entry, cfg, pluginsDir)
    state.fibers.set(entry.id, fiber)
    const svc0 = ctx[entry.id]
    entry.inject = (svc0 && svc0.constructor && svc0.constructor.inject) || []
    state.entries.push({ ...entry, config: cfg, rawConfig: entry.config })
  }

  // 核对同名 Service 是否注册（缺 inject 的依赖会在这里点名）
  const appliedIds = state.entries.map((e) => e.id)
  const missing = appliedIds.filter((id) => !ctx[id])
  if (missing.length) {
    throw new Error('[boot] 以下插件应用后未注册同名服务（检查 Service.inject 依赖链）: ' + missing.join(', '))
  }

  ctx.emit('ready')

  // P8A：patch 热重载（可选，默认关）
  if (opts.watch) startWatcher(ctx, { yamlPath, pluginsDir, root, scope, state })
  return ctx
}

export async function applyEntry(ctx, entry, cfg, pluginsDir) {
  const spec = entry.module
  let specifier
  if (!spec) {
    specifier = pathToFileURL(path.join(pluginsDir, entry.id + '.js')).href
  } else if (spec.startsWith('.') || path.isAbsolute(spec)) {
    specifier = pathToFileURL(path.resolve(pluginsDir, spec)).href
  } else {
    // 裸模块标识符：交给 Node 解析（@scraper/core/src/xxx.js 等）
    specifier = spec
  }
  let mod
  try {
    mod = await import(specifier)
  } catch (e) {
    throw new Error('[boot] 插件 ' + entry.id + ' 加载失败 (' + specifier + '): ' + (e && e.stack ? e.stack : e), { cause: e })
  }
  const plugin = mod.default
  if (typeof plugin !== 'function') {
    throw new Error('[boot] 插件 "' + entry.id + '" 没有默认导出函数')
  }
  try {
    const fiber = ctx.plugin(plugin, cfg)
    if (fiber && typeof fiber.then === 'function') await fiber
    return fiber
  } catch (e) {
    throw new Error('[boot] 插件 ' + entry.id + ' 应用失败: ' + (e && e.stack ? e.stack : e), { cause: e })
  }
}

// ---- P8A watcher（安全子集）----
function startWatcher(ctx, { yamlPath, pluginsDir, scope, state }) {
  const dir = path.dirname(yamlPath)
  let timer = null
  let pending = false
  const schedule = () => {
    if (pending) return
    pending = true
    timer = setTimeout(() => {
      pending = false
      reload().catch((e) => ctx.logger.error('[hmr] 重载失败，保持现有配置: ' + e.message))
    }, 300)
  }

  async function reload() {
    const doc = parseCordisYml(fs.readFileSync(yamlPath, 'utf8'))
    const norm = normalizeEntries(doc)
    const next = composeEntries(norm.entries, loadPatchFiles(yamlPath))
    await applyDiff(ctx, { next, state, pluginsDir, scope })
  }

  try {
    fs.watch(dir, (event, filename) => {
      if (filename && /cordis\.(patch\.)?yml$/.test(String(filename))) schedule()
    })
    ctx.logger.info('[hmr] 配置热重载已启用（监听 ' + dir + '）')
  } catch (e) {
    ctx.logger.warn('[hmr] watcher 启动失败: ' + e.message)
  }
}

// P8A diff：按 id 分组比较
export function diffEntries(prev, next) {
  const prevMap = new Map(prev.map((e) => [e.id, e]))
  const nextMap = new Map(next.map((e) => [e.id, e]))
  const added = next.filter((e) => !prevMap.has(e.id))
  const removed = prev.filter((e) => !nextMap.has(e.id))
  const changed = []
  for (const e of next) {
    const p = prevMap.get(e.id)
    if (!p) continue
    const pc = p.rawConfig !== undefined ? p.rawConfig : p.config
    const nc = e.rawConfig !== undefined ? e.rawConfig : e.config
    if (JSON.stringify(pc) !== JSON.stringify(nc) || p.disabled !== e.disabled || (p.module || null) !== (e.module || null)) {
      changed.push({ prev: p, next: e })
    }
  }
  return { added, removed, changed }
}

// P8B 应用 diff（完整重载 + 依赖级联处理）：
// cordis 卸载某插件 fiber 会级联注销依赖它的服务（且不调其 dispose 钩子），
// 因此任何结构变更先计算「受影响闭包」（该插件 + 传递依赖它的所有插件），
// 逆序调 dispose 钩子 → 卸载 fiber → 按原顺序重应用受影响且仍启用的行。
export function affectedClosure(entries, rootIds) {
  const affected = new Set(rootIds)
  let changed = true
  while (changed) {
    changed = false
    for (const e of entries) {
      if (affected.has(e.id)) continue
      if ((e.inject || []).some((dep) => affected.has(dep))) {
        affected.add(e.id)
        changed = true
      }
    }
  }
  return affected
}

export async function applyDiff(ctx, { next, state, pluginsDir, scope }) {
  const prev = state.entries
  const diff = diffEntries(prev, next)
  const failures = []
  const prevById = new Map(prev.map((e) => [e.id, e]))
  const nextById = new Map(next.map((e) => [e.id, e]))

  const structuralRoots = []
  for (const { prev: p, next: n } of diff.changed) {
    const structural = p.disabled !== n.disabled || (p.module || null) !== (n.module || null)
    if (structural) structuralRoots.push(p.id)
  }
  for (const e of diff.removed) structuralRoots.push(e.id)

  if (structuralRoots.length) {
    const affected = affectedClosure(prev, structuralRoots)

    // 1) 逆序释放资源并卸载（先 dispose 钩子，再 fiber）
    for (const e of [...prev].reverse()) {
      if (!affected.has(e.id)) continue
      await disposeEntry(ctx, state, e.id, null)
    }

    // 2) 重应用受影响且在新树中仍启用的行（按原顺序）
    for (const e of prev) {
      if (!affected.has(e.id)) continue
      const n = nextById.get(e.id)
      if (!n || n.disabled) continue
      const depGone = (e.inject || []).some((dep) => {
        const de = nextById.get(dep)
        return de && (de.disabled || !ctx[dep])
      })
      if (depGone) {
        ctx.logger.info('[hmr] ' + e.id + ' 依赖缺失，跳过重应用（预期下线）')
        continue
      }
      if (!(await tryApply(ctx, n, state, pluginsDir, scope, e))) failures.push(e.id)
    }
  }

  // 3) 纯新增行（与既有树无依赖关系）
  for (const e of diff.added) {
    if (e.disabled) continue
    if (!(await tryApply(ctx, e, state, pluginsDir, scope, null))) failures.push(e.id)
  }

  // 4) 纯 config 变更：白名单事件快速路径（不重启插件）
  for (const { prev: p, next: n } of diff.changed) {
    const structural = p.disabled !== n.disabled || (p.module || null) !== (n.module || null)
    if (structural) continue
    const oldCfg = interpolate(p.rawConfig !== undefined ? p.rawConfig : p.config, scope)
    const newCfg = interpolate(n.config, scope)
    ctx.emit('config:update', { id: n.id, config: newCfg, previous: oldCfg })
    ctx.logger.info('[hmr] ' + n.id + ' 配置已热更新（白名单键下一次动作生效）')
  }

  // 5) 依赖图审计：应存在而缺失的服务点名并逆序回滚
  const nextActive = next.filter((e) => !e.disabled).map((e) => e.id)
  const missing = nextActive.filter((id) => {
    if (ctx[id]) return false
    const e = nextById.get(id)
    const prevE = prevById.get(id)
    const inject = (prevE && prevE.inject) || (e && e.inject) || []
    const depGone = inject.some((dep) => {
      const de = nextById.get(dep)
      return de && (de.disabled || !ctx[dep])
    })
    return !depGone
  })
  if (missing.length) {
    ctx.logger.error('[hmr] 审计失败，缺失服务: ' + missing.join(', '))
    for (const id of [...missing].reverse()) {
      const prevEntry = prevById.get(id)
      if (prevEntry && !prevEntry.disabled) {
        await tryApply(ctx, prevEntry, state, pluginsDir, scope, null, true)
      }
    }
  }

  state.entries = next.map((e) => {
    const prevE = prevById.get(e.id)
    let inject = (prevE && prevE.inject) || e.inject || []
    if (!inject.length) {
      const svc = ctx[e.id]
      if (svc && svc.constructor && svc.constructor.inject) inject = svc.constructor.inject
    }
    return { ...e, config: interpolate(e.config, scope), rawConfig: e.config, inject }
  })
  if (failures.length) ctx.logger.warn('[hmr] 本次热重载有失败项: ' + failures.join(', '))
}

// 服务 dispose 约定：cordis 卸载 fiber 不回调服务，由 loader 在卸载前手动调用
async function disposeEntry(ctx, state, id, logTag) {
  const svc = ctx[id]
  if (svc && typeof svc.dispose === 'function') {
    try { await svc.dispose() } catch (e) { ctx.logger.error('[hmr] ' + id + ' dispose 失败: ' + e.message) }
  }
  const fiber = state.fibers.get(id)
  if (fiber) {
    try { await fiber.dispose() } catch (e) { ctx.logger.error('[hmr] ' + id + ' fiber dispose 失败: ' + e.message) }
    state.fibers.delete(id)
  }
  if (logTag) ctx.logger.info('[hmr] ' + logTag + ' ' + id)
}

async function tryApply(ctx, entry, state, pluginsDir, scope, fallbackEntry, silent) {
  try {
    const cfg = interpolate(entry.rawConfig !== undefined ? entry.rawConfig : entry.config, scope)
    const f = await applyEntry(ctx, entry, cfg, pluginsDir)
    state.fibers.set(entry.id, f)
    // 启动约定：ready 只在引导时发一次，热应用的实例由 loader 显式 start
    const svc = ctx[entry.id]
    if (svc && typeof svc.start === 'function') {
      await svc.start()
    }
    if (svc && svc.constructor && svc.constructor.inject) entry.inject = svc.constructor.inject
    if (!silent) ctx.logger.info('[hmr] 已热加载 ' + entry.id)
    return true
  } catch (e) {
    ctx.logger.error('[hmr] 应用 ' + entry.id + ' 失败: ' + e.message)
    if (fallbackEntry && !fallbackEntry.disabled) {
      ctx.logger.warn('[hmr] 回滚 ' + entry.id + ' 到旧配置')
      try {
        const cfg = interpolate(fallbackEntry.rawConfig !== undefined ? fallbackEntry.rawConfig : fallbackEntry.config, scope)
        const f = await applyEntry(ctx, fallbackEntry, cfg, pluginsDir)
        state.fibers.set(entry.id, f)
        ctx.logger.info('[hmr] ' + entry.id + ' 已回滚')
      } catch (e2) {
        ctx.logger.error('[hmr] ' + entry.id + ' 回滚也失败: ' + e2.message)
      }
    }
    return false
  }
}
