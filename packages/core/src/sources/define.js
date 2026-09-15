// @scraper/core/sources/define.js — 源插件的公共骨架。
//
// 每个源 = 一个 cordis 插件（id 形如 source-<name>，注册为 ctx['source-<name>']），
// 它只做一件事：把自己的声明（driver/parse/pagination/item + 自身配置 schema）注册进 ctx.sources。
//
// 这样「新增一个源」= 新增一个文件，不再需要改 CLI 参数表或中心化翻译表。
//
// 配置分层（sources.templateVars 按此优先级合成模板变量）：
//   CLI 显式值 > cordis.yml 显式值 > 源 schema 默认值 > 共享默认
import { Service } from 'cordis'

/** 只保留显式给出的键（yml 里写了才算） */
function pickExplicit(raw) {
  const out = {}
  for (const [k, v] of Object.entries(raw || {})) {
    if (v !== undefined) out[k] = v
  }
  return out
}

/**
 * @param {string} id 插件 id / 服务名，如 'source-bing'
 * @param {(ctx, cfg) => {def: object, schema?: object}} build
 */
export function defineSource(id, build) {
  class SourcePluginService extends Service {
    constructor(ctx, cfg) {
      super(ctx, id)
      const { def, schema } = build(ctx, cfg || {})
      if (!def || !def.name) throw new Error('[' + id + '] 源声明缺少 name')
      const raw = pickExplicit(cfg)
      def.schema = schema
      def.config = schema ? schema({ ...raw }) : { ...raw } // 全量（含 schema 默认）
      def.configExplicit = raw // yml 显式值
      ctx.effect(() => ctx.sources.register(def))
    }
  }
  SourcePluginService.inject = ['sources', 'settings', 'logfile']
  return function sourcePlugin(ctx, cfg) {
    ctx.plugin(SourcePluginService, cfg)
  }
}
