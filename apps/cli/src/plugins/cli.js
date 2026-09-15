// 应用插件：cli —— 命令行入口。
//
// 设计要点：CLI 只负责收集「用户显式传入」的参数（其余键不设置），
// 交给 ctx.sources.templateVars 按优先级合成（CLI 显式 > yml 显式 > 源 schema 默认 > 共享默认）。
// 源专属参数（如 picsum 的 picsum_query）不在这里硬编码，而是写进 cordis.yml 的源 config —— 这正是
// 消灭 Python 版 _build_ctx 中心化参数表的意义。
import { Service } from 'cordis'

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const key = a.slice(2)
    const eq = key.indexOf('=')
    if (eq >= 0) { out[key.slice(0, eq)] = key.slice(eq + 1); continue }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++ }
    else out[key] = true
  }
  return out
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

class CliService extends Service {
  constructor(ctx, cfg) {
    super(ctx, 'cli')
    // ready 由 loader 在全部插件应用后发出
    ctx.on('ready', () => {
      this.main().catch((e) => {
        ctx.logger.error('[cli] 执行失败: ' + (e && e.stack ? e.stack : e))
        process.exitCode = 1
      })
    })
  }

  help() {
    const names = this.ctx.sources.names()
    return [
      '用法: node src/index.js [--source <名|all>] [选项]',
      '',
      '源 (' + names.length + '): ' + names.join(', '),
      '',
      '通用选项:',
      '  --source <名|all>     要跑的源（默认 picsum；all=并行跑全部已挂载源）',
      '  --max-images N        每源最大下载数（默认 100）',
      '  --concurrency N       并发下载数（默认 5）',
      '  --proxy <url>         代理（http/https/socks5；仅对 needs_proxy 的源自动启用）',
      '  --auto-proxy          自动探测/拉取可用代理',
      '  --retries N           下载失败重试次数（默认 3）',
      '  --rate-limit N        请求速率上限（请求/秒，0=不限）',
      '  --speed-limit N       下载速度上限（KB/s，0=不限）',
      '  --query <词>          搜索关键词',
      '  --pages N             翻页数',
      '  --tags <词>           booru 标签',
      '  --booru-rating <s|q|e> booru 分级',
      '  --booru-limit N       booru 每页条数',
      '  --booru-exclude <a,b> 标签黑名单（逗号分隔，转 -tag）',
      '  --url <url>           指定网页（webpage 源）',
      '  --nsfw                包含 NSFW',
      '  --dump-config         打印插件树后退出',
      '  --list-sources        列出已挂载源后退出',
      '  --help                本帮助',
      '',
      '源专属参数（如 picsum 的 picsum_query）请写在 cordis.yml 对应源行的 config 里 ——',
      '这取代了 Python 版 80 行的中心化参数翻译表 _build_ctx()。',
    ].join('\n')
  }

  dumpConfig() {
    const entries = this.ctx.$loader.entries
    const lines = []
    lines.push('插件树（' + entries.length + ' 行，来源 base/patch）:')
    for (const e of entries) {
      const tags = []
      if (e.module) tags.push('module=' + e.module)
      if (e.disabled) tags.push('disabled')
      if (e.hot) tags.push('hot')
      if (e.inject && e.inject.length) tags.push('inject=[' + e.inject.join(',') + ']')
      lines.push('  ' + String(e.id).padEnd(26) + (tags.length ? '  ' + tags.join(' ') : ''))
    }
    const patch = entries.filter((e) => e.source === 'patch').map((e) => e.id)
    if (patch.length) lines.push('  （其中 ' + patch.length + ' 行来自 patch: ' + patch.join(', ') + '）')
    return lines.join('\n')
  }

  async main() {
    const args = parseArgs(process.argv.slice(2))
    const log = this.ctx.logger

    if (args.help || args.h) { console.log(this.help()); return }
    if (args['dump-config']) { console.log(this.dumpConfig()); return }
    if (args['list-sources']) {
      for (const n of this.ctx.sources.names()) {
        const d = this.ctx.sources.get(n)
        console.log('  ' + n.padEnd(24) + (d.display || ''))
      }
      return
    }

    // 组装 run 选项：**只收集显式传入的键**
    const opts = {}
    if (args['max-images'] !== undefined) opts.maxImages = num(args['max-images'])
    if (args.concurrency !== undefined) opts.concurrency = num(args.concurrency)
    if (args.retries !== undefined) opts.retries = num(args.retries)
    if (args['rate-limit'] !== undefined) opts.rateLimit = num(args['rate-limit'])
    if (args['speed-limit'] !== undefined) opts.speedLimit = num(args['speed-limit'])
    if (args.query !== undefined) opts.query = String(args.query)
    if (args.pages !== undefined) opts.pages = num(args.pages)
    if (args.tags !== undefined) opts.tags = String(args.tags)
    if (args['booru-rating'] !== undefined) opts.rating = String(args['booru-rating'])
    if (args['booru-limit'] !== undefined) opts.limit = num(args['booru-limit'])
    if (args['booru-exclude'] !== undefined) opts.exclude = String(args['booru-exclude'])
    if (args.url !== undefined) opts.url = String(args.url)
    if (args.tab !== undefined) opts.tab = String(args.tab)
    if (args.size !== undefined) opts.size = String(args.size)
    if (args.scrolls !== undefined) opts.scrolls = num(args.scrolls)
    if (args.content_url !== undefined) opts.contentUrl = String(args.content_url)
    if (args['mj-index'] !== undefined) opts.mjIndex = num(args['mj-index'])
    if (args['no-headless']) opts.headless = false
    if (args.nsfw) opts.nsfw = true
    if (args['auto-proxy']) opts.autoProxy = true
    if (args.proxy !== undefined) {
      opts.proxy = String(args.proxy)
      opts.explicitProxy = true
    }

    // 选择源
    const available = this.ctx.sources.names()
    let targets
    if (!args.source || args.source === true) targets = ['picsum']
    else if (args.source === 'all') targets = available
    else {
      targets = String(args.source).split(',').map((s) => s.trim()).filter(Boolean)
      const unknown = targets.filter((t) => !available.includes(t))
      if (unknown.length) {
        log.error('未知源: ' + unknown.join(', ') + '（可用: ' + available.join(', ') + '）')
        process.exitCode = 1
        return
      }
    }

    log.info('='.repeat(64))
    log.info(`多源图片爬虫 (Cordis) | 源=${targets.join(',')} | 每源 max=${opts.maxImages ?? 100}`)
    log.info('='.repeat(64))

    const t0 = Date.now()
    const results = await this.ctx.scheduler.runMany(targets, opts)

    log.info('='.repeat(64))
    log.info('总览:')
    for (const [name, r] of Object.entries(results)) {
      if (r.ok) {
        const s = r.stats
        log.info(`  ${name.padEnd(24)} 获取 ${s.fetched} | 下载 ${s.downloaded} | 跳过 ${s.skipped} | 失败 ${s.errors} | ${s.endTime - s.startTime}s`)
      } else {
        log.info(`  ${name.padEnd(24)} ${r.reason}${r.message ? ' — ' + r.message : ''}`)
      }
    }
    log.info(`总耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    log.info('='.repeat(64))

    // 一次性 CLI：主动触发 dispose（关闭单例浏览器等长活句柄）后退出。
    // 若放任自然退出，Playwright 等残留连接断开时会抛 unhandledRejection，
    // 触发 fail-loud 分支把退出码污染成 1。
    this.ctx.emit('dispose')
    const failed = Object.values(results).filter((r) => !r.ok)
    const code = failed.length === targets.length ? 1 : 0
    setTimeout(() => process.exit(code), 500)
  }
}

CliService.inject = ['sources', 'scheduler', 'logfile']

export default function cliPlugin(ctx, cfg) {
  ctx.plugin(CliService, cfg)
}
