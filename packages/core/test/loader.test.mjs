// harness 不变量测试 · loader（行式 yml / patch 叠加 / 闭包）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCordisYml, normalizeEntries, composeEntries, affectedClosure,
} from '../src/loader.js'

test('normalizeEntries：行式数组 → 统一 Entry', () => {
  const doc = parseCordisYml(`
plugins:
  - id: alpha
    module: './a.js'
    config:
      port: 1
  - id: beta
    disabled: true
`)
  const { entries, legacy } = normalizeEntries(doc)
  assert.equal(legacy, false)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].id, 'alpha')
  assert.equal(entries[0].config.port, 1)
  assert.equal(entries[0].source, 'base')
  assert.equal(entries[1].disabled, true)
})

test('normalizeEntries：旧 map 形式 → legacy:true', () => {
  const doc = parseCordisYml(`
plugins:
  gamma:
    key: v
  delta: {}
`)
  const { entries, legacy } = normalizeEntries(doc)
  assert.equal(legacy, true)
  assert.deepEqual(entries.map((e) => e.id).sort(), ['delta', 'gamma'])
})

test('normalizeEntries：缺 id 点名抛错', () => {
  const doc = parseCordisYml(`
plugins:
  - module: './x.js'
`)
  assert.throws(() => normalizeEntries(doc), /缺少 id/)
})

test('composeEntries：按 id 覆盖（config 浅合并 + source 标记）', () => {
  const base = normalizeEntries(parseCordisYml(`
plugins:
  - id: alpha
    config: { a: 1, b: 2 }
  - id: beta
`)).entries
  const merged = composeEntries(base, [{ id: 'alpha', config: { b: 99 } }])
  const alpha = merged.find((e) => e.id === 'alpha')
  assert.equal(alpha.source, 'patch')
  assert.equal(alpha.config.a, 1) // 未覆盖键保留
  assert.equal(alpha.config.b, 99) // 覆盖生效
})

test('composeEntries：disabled 开关与 before: 锚点插入', () => {
  const base = normalizeEntries(parseCordisYml(`
plugins:
  - id: first
  - id: second
`)).entries
  const merged = composeEntries(base, [
    { id: 'extra', config: {} }, // 未知 id → 追加
    { id: 'injected', module: './i.js', before: 'second' },
    { id: 'first', disabled: true },
  ])
  const ids = merged.map((e) => e.id)
  assert.deepEqual(ids, ['first', 'injected', 'second', 'extra'])
  assert.equal(merged.find((e) => e.id === 'first').disabled, true)
  assert.equal(merged.find((e) => e.id === 'injected').source, 'patch')
})

test('affectedClosure：依赖闭包 = 根 + 传递依赖它的插件', () => {
  // c 依赖 b，b 依赖 a（inject 指向被依赖者）→ 改 a 需要逆序重载 c、b
  const entries = [
    { id: 'a', inject: [] },
    { id: 'b', inject: ['a'] },
    { id: 'c', inject: ['b'] },
    { id: 'unrelated', inject: [] },
  ]
  const closure = affectedClosure(entries, ['a'])
  assert.ok(closure instanceof Set)
  assert.deepEqual([...closure].sort(), ['a', 'b', 'c'])
})
