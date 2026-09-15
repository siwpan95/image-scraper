// harness 不变量测试 · engine（模板替换 / 哈希黄金值 / 任务构建守恒）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { subst, pyQuote, buildTasks } from '../src/engine.js'
import { hashName, makeStats } from '../src/downloader.js'

test('subst：{var} 模板替换（缺键保留原样，与 Python .format 缺键容错一致）', () => {
  assert.equal(subst('{a}-{b}', { a: 1, b: 'x' }), '1-x')
  assert.equal(subst('?q={query}&p={page}', { query: 'cat' }), '?q=cat&p={page}')
})

test('hashName：与 Python hashlib.md5 一致的黄金值', () => {
  // Python: hashlib.md5(b'abc').hexdigest()[:12] = 900150983cd2
  assert.equal(hashName('abc'), '900150983cd2')
  assert.equal(hashName('https://example.com/a.jpg').length, 12)
  assert.equal(hashName('https://example.com/a.jpg'), hashName('https://example.com/a.jpg')) // 稳定
})

test('pyQuote：对齐 urllib.parse.quote(s, safe="/")', () => {
  assert.equal(pyQuote('hello world'), 'hello%20world')
  assert.equal(pyQuote('a/b'), 'a/b') // '/' 在 safe 内
  assert.equal(pyQuote('猫'), encodeURIComponent('猫').toUpperCase())
})

test('buildTasks：URL 去重 + maxImages 截断 + 字段完整', () => {
  const cfg = { name: 't' }
  const active = { item: { url: { path: 'u' }, title: { path: 't' } }, parse: { format: 'json' } }
  const items = [
    { u: 'https://x/1.jpg', t: 'one' },
    { u: 'https://x/1.jpg', t: 'dup' }, // 重复 URL → 丢弃
    { u: 'https://x/2.jpg' },
    { u: 'https://x/3.jpg' },
  ]
  const tasks = buildTasks(items, { cfg, ctxVars: {}, maxImages: 2, active, sourceName: 't' })
  assert.equal(tasks.length, 2)
  assert.equal(tasks[0].url, 'https://x/1.jpg')
  assert.equal(tasks[0].title, 'one')
  assert.equal(tasks[1].url, 'https://x/2.jpg')
  for (const t of tasks) {
    assert.equal(t.source, 't')
    assert.equal(t.downloaded, false)
    assert.ok('meta' in t && 'referer' in t && 'width' in t && 'height' in t)
  }
})

test('makeStats：数据守恒不变量的载体字段齐全', () => {
  const s = makeStats()
  assert.deepEqual(Object.keys(s).sort(), ['endTime', 'errors', 'fetched', 'skipped', 'downloaded', 'startTime'].sort())
})
