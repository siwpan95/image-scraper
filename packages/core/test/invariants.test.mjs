// harness 不变量测试 · 数据守恒 + 事件配对 + 跨运行去重（端到端 mini-run）
//
// 装配最小服务树（对齐 cordis.yml 的顺序即拓扑纪律），
// 用本地 http server 同时充当「API + 图片源」，跑一个真实源两轮：
//   第一轮 downloaded == fetched；第二轮全部 skipped（同 md5 文件名命中已存在）
// 并断言 ROADMAP §11.5 的守恒不变量：fetched ≥ downloaded + skipped + errors。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { Context } from 'cordis'

import configPlugin from '../src/config.js'
import logfilePlugin from '../src/logfile.js'
import settingsPlugin from '../src/settings.js'
import proxyPlugin from '../src/proxy.js'
import httpPlugin from '../src/http.js'
import mediaPlugin from '../src/media.js'
import storagePlugin from '../src/storage.js'
import parsersPlugin from '../src/parsers.js'
import parserJsonPlugin from '../src/parser-json.js'
import paginatorsPlugin from '../src/paginators.js'
import paginatorNonePlugin from '../src/paginator-none.js'
import downloaderPlugin from '../src/downloader.js'
import driversPlugin from '../src/drivers.js'
import driverHttpPlugin from '../src/driver-http.js'
import sourcesPlugin from '../src/sources.js'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'scraper-inv-'))
let server, base, ctx
let regCount = 0, unregCount = 0

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/api')) {
      const data = [1, 2, 3].map((i) => ({ url: `${base}/img/${i}.png` }))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data }))
    } else {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(Buffer.alloc(1024, 7)) // 1KB 内容 > minBytes(300)
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = 'http://127.0.0.1:' + server.address().port

  ctx = new Context()
  // 顺序即拓扑：被依赖者在前；await fiber（对齐 loader.start 的逐个 await 审计）
  await ctx.plugin(configPlugin, { root: ROOT, outputDir: path.join(ROOT, 'images'), metaDir: path.join(ROOT, 'meta') })
  await ctx.plugin(logfilePlugin, { file: path.join(ROOT, 'logs', 'test.log') })
  await ctx.plugin(settingsPlugin, {})
  await ctx.plugin(proxyPlugin, {})
  await ctx.plugin(httpPlugin, {})
  await ctx.plugin(mediaPlugin, {})
  await ctx.plugin(storagePlugin, {})
  await ctx.plugin(parsersPlugin, {})
  await ctx.plugin(parserJsonPlugin, {})
  await ctx.plugin(paginatorsPlugin, {})
  await ctx.plugin(paginatorNonePlugin, {})
  await ctx.plugin(downloaderPlugin, {})
  await ctx.plugin(driversPlugin, {})
  await ctx.plugin(driverHttpPlugin, {})
  await ctx.plugin(sourcesPlugin, {})

  ctx.on('source/registered', () => { regCount += 1 })
  ctx.on('source/unregistered', () => { unregCount += 1 })

  ctx.sources.register({
    name: 'invariant-mock',
    display: '不变量测试源',
    driver: 'http',
    request: { method: 'GET', url: base + '/api', pagination: { type: 'none' } },
    parse: { format: 'json', list_path: 'data' },
    item: { url: { path: 'url' } },
  })
})

after(async () => {
  ctx.emit('dispose')
  server.close()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

function assertConservation(stats, label) {
  // ROADMAP §11.5：fetched ≥ downloaded + skipped + errors
  assert.ok(
    stats.fetched >= stats.downloaded + stats.skipped + stats.errors,
    `[${label}] 守恒失败: fetched=${stats.fetched} < ${stats.downloaded}+${stats.skipped}+${stats.errors}`,
  )
}

test('第一轮：全量下载，任务/下载/元数据一致', async () => {
  const r = await ctx.sources.run('invariant-mock', { maxImages: 5 })
  assert.equal(r.ok, true)
  const s = r.stats
  assert.equal(s.fetched, 3)
  assert.equal(s.downloaded, 3)
  assert.equal(s.skipped, 0)
  assert.equal(s.errors, 0)
  assertConservation(s, 'round1')
  const files = fs.readdirSync(path.join(ROOT, 'images', 'invariant-mock'))
  assert.equal(files.length, 3)
  assert.ok(files.every((f) => f.startsWith('invariant-mock_') && f.endsWith('.png')))
  // 元数据落盘：下载条数 == 3
  const metas = fs.readdirSync(path.join(ROOT, 'meta')).filter((f) => f.startsWith('invariant-mock_') && !f.startsWith('failed_'))
  const last = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', metas[metas.length - 1]), 'utf8'))
  assert.equal(last.images.length, 3)
})

test('第二轮：跨运行去重，全部 skipped 且不产生新文件', async () => {
  const before = fs.readdirSync(path.join(ROOT, 'images', 'invariant-mock')).length
  const r = await ctx.sources.run('invariant-mock', { maxImages: 5 })
  assert.equal(r.ok, true)
  const s = r.stats
  assert.equal(s.fetched, 3)
  assert.equal(s.downloaded, 0)
  assert.equal(s.skipped, 3)
  assert.equal(s.errors, 0)
  assertConservation(s, 'round2')
  const after = fs.readdirSync(path.join(ROOT, 'images', 'invariant-mock')).length
  assert.equal(after, before)
})

test('失败清单链路：下载失败 URL 进 failed_*.json 并可被 readFailed 读回', async () => {
  const failed = [{ url: base + '/never-exists.bin', referer: '', source: 'invariant-mock', title: '', author: '', width: 0, height: 0, meta: {} }]
  const f = ctx.storage.writeFailed('invariant-mock', failed)
  assert.ok(fs.existsSync(f.file))
  const back = ctx.storage.readFailed(f.file)
  assert.equal(back.count, 1)
  assert.equal(back.tasks[0].url, base + '/never-exists.bin')
})

test('事件配对：source/registered ↔ source/unregistered，dispose 后注册表清空', () => {
  const dispose = ctx.sources.register({ name: 'pairing-test', driver: 'http', request: { url: base + '/api' }, parse: { format: 'json' }, item: { url: { path: 'url' } } })
  assert.equal(regCount, 2) // before 里的 1 次 + 本次
  assert.ok(ctx.sources.has('pairing-test'))
  dispose()
  assert.equal(unregCount, 1)
  assert.equal(ctx.sources.has('pairing-test'), false)
})
