// @scraper/core — 通用注册表基类。
//
// 「能力即服务，服务即插件」的落点：驱动 / 解析器 / 分页器 / 图源 全部注册进对应的
// 注册表服务，运行时按名字解析，**不再有字符串 if 链**。
//
// 用法约定（驱动插件侧）：
//   ctx.effect(() => ctx.drivers.register('http', impl))   // 返回的 disposer 随插件卸载自动执行
import { Service } from 'cordis'

export class RegistryService extends Service {
  constructor(ctx, name, cfg) {
    super(ctx, name)
    this.map = new Map()
  }

  /** 注册一个实现；返回撤销函数（配合 ctx.effect 实现可逆注册） */
  register(name, impl) {
    if (!name || typeof name !== 'string') throw new Error('[registry] ' + this.name + ' 注册名非法: ' + name)
    this.map.set(name, impl)
    this.ctx.emit('registry/registered', { registry: this.name, name })
    this.ctx.logger.debug?.('[registry] ' + this.name + ' ← ' + name)
    return () => {
      this.map.delete(name)
      this.ctx.emit('registry/unregistered', { registry: this.name, name })
    }
  }

  /** 按名解析；未注册抛错（fail-loud，避免静默退化成「无任务」） */
  resolve(name) {
    const impl = this.map.get(name)
    if (!impl) {
      const available = [...this.map.keys()].join(', ') || '(空)'
      throw new Error('[registry] ' + this.name + ' 未注册: "' + name + '"（可用: ' + available + '）')
    }
    return impl
  }

  has(name) {
    return this.map.has(name)
  }

  names() {
    return [...this.map.keys()]
  }

  entries() {
    return [...this.map.entries()]
  }
}
