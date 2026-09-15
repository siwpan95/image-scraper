// Bootstrap: 构建 Cordis 根 Context，按 cordis.yml 装配插件树，并接管优雅退出。
// 运行：node src/index.js  （或 npm start --workspace @scraper/cli -- --source picsum）
import { Context } from 'cordis'
import { start } from '@scraper/core'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const ctx = new Context()

// CLI 是一次性运行：默认不启用 patch 热重载（fs.watch 句柄会阻止进程退出）。
// 需要长驻 + 热重载时：SCRAPER_WATCH=1 node src/index.js
await start(ctx, {
  yamlPath: path.join(root, 'cordis.yml'),
  pluginsDir: path.join(__dirname, 'plugins'),
  root,
  watch: process.env.SCRAPER_WATCH === '1',
})

ctx.logger.info('image-scraper (Node.js + Cordis) started · 插件数=' + ctx.$loader.entries.length)

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  ctx.logger.info(`received ${signal}, shutting down`)
  ctx.emit('dispose')
  // 给 disposers（HTTP 连接池、curl 子进程等）一点时间收尾
  setTimeout(() => process.exit(0), 500)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

process.on('uncaughtException', (err) => {
  try { ctx.logger.error('uncaughtException: ' + (err && err.stack ? err.stack : err)) } catch { /* ignore */ }
  console.error(err)
})
process.on('unhandledRejection', (reason) => {
  try { ctx.logger.error('unhandledRejection: ' + (reason && reason.stack ? reason.stack : reason)) } catch { /* ignore */ }
  console.error(reason)
  // fail-loud：长驻服务拒绝半死不活
  setTimeout(() => process.exit(1), 200)
})
