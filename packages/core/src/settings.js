// @scraper/core — 分层设置服务（ctx.settings）。取代 Python 版的 config.py / config.json。
//
// 分层解析顺序（后者覆盖前者）：
//   1. schema 默认值（Schema({}) 自动填充）
//   2. 注册时传入的 base（来自 cordis.yml 的插件配置）
//   3. 用户持久化文档（data/settings.json，可被 GUI/Web 面板编辑）
//   最终结果再过一遍 schema 校验与强制类型转换。
//
// 凭据（API Key）与代理都走本服务，不再有 config.json 那样的专用文件。
import { Service } from 'cordis'
import Schema from 'schemastery'
import fs from 'node:fs'
import path from 'node:path'

export const CredentialsSchema = Schema.object({
  keys: Schema.dict(Schema.string()).default({}).description('按源名存放的 API Key，如 { flickr: "xxx" }'),
}).description('凭据')

export const ProxySchema = Schema.object({
  url: Schema.string().default('').description('显式代理，如 socks5://127.0.0.1:1080'),
  auto: Schema.boolean().default(false).description('自动从免费代理源拉取'),
  preferSocks: Schema.boolean().default(true).description('自动代理时优先 SOCKS5'),
  candidates: Schema.array(Schema.string()).default([]).description('候选代理地址（按序探活）'),
}).description('代理')

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

class SettingsService extends Service {
  constructor(ctx, cfg = {}) {
    super(ctx, 'settings')
    this.file = path.isAbsolute(cfg.file || '')
      ? cfg.file
      : path.resolve(ctx.config.root, cfg.file || path.join('data', 'settings.json'))
    this.namespaces = new Map()
    this.stored = readJson(this.file)

    // 基础命名空间：凭据与代理（各源/各通道共用）
    this.register('credentials', CredentialsSchema, {})
    this.register('proxy', ProxySchema, {})
  }

  /** 注册一个可被分层覆盖的设置命名空间 */
  register(ns, schema, { base = {} } = {}) {
    this.namespaces.set(ns, { schema, base: base || {} })
    return this
  }

  /** 解析某命名空间的最终值 */
  get(ns) {
    const entry = this.namespaces.get(ns)
    if (!entry) return {}
    const merged = { ...entry.base, ...(this.stored[ns] || {}) }
    try {
      // schemastery 调用即校验 + 填默认值
      return entry.schema(merged)
    } catch (e) {
      this.ctx.logger.warn('[settings] ' + ns + ' 校验失败，回退到已合并的原始值: ' + e.message)
      return merged
    }
  }

  /** 写入某命名空间（浅合并）并原子落盘 */
  set(ns, patch) {
    const prev = this.stored[ns] || {}
    this.stored[ns] = { ...prev, ...patch }
    this.persist()
    const value = this.get(ns)
    this.ctx.emit('settings/update', { ns, value, patch })
    return value
  }

  /** 取某个源的 API Key：显式配置 > settings.credentials > 环境变量 <SOURCE>_KEY */
  key(source) {
    const explicit = this.namespaces.get('credentials')
    const creds = this.get('credentials')
    return creds.keys?.[source] || explicit?.base?.keys?.[source] || process.env[source.toUpperCase() + '_KEY'] || ''
  }

  all() {
    const out = {}
    for (const ns of this.namespaces.keys()) out[ns] = this.get(ns)
    return out
  }

  persist() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = this.file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.stored, null, 2))
      fs.renameSync(tmp, this.file) // 原子写
    } catch (e) {
      this.ctx.logger.warn('[settings] 持久化失败: ' + e.message)
    }
  }
}

SettingsService.inject = ['config']

export default function settingsPlugin(ctx, cfg) {
  ctx.plugin(SettingsService, cfg)
}
