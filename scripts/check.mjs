// 质量门禁：全仓语法检查 + cordis.yml 校验 + package.json 校验 + harness 单测 + 装配冒烟。
// 对齐 private-radio-stations 的 scripts/check.mjs 范式；`--fast` 跳过单测与冒烟。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const NODE = process.env.NODE_EXE || 'node'
const fast = process.argv.includes('--fast')

const failures = []
function fail(msg) {
  failures.push(msg)
  console.error('  x ' + msg)
}
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
}
function collectJs(dir) {
  const out = []
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) {
      if (['node_modules', 'data', 'images', 'meta', 'logs'].includes(f)) continue
      out.push(...collectJs(p))
    } else if (f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs')) {
      out.push(p)
    }
  }
  return out
}

console.log('== check: syntax ==')
for (const dir of ['packages/core/src', 'packages/core/test', 'apps/cli/src']) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) continue
  for (const p of collectJs(abs)) {
    const r = run(NODE, ['--check', p])
    if (r.status !== 0) fail('syntax: ' + path.relative(ROOT, p) + '\n' + (r.stderr || '').slice(0, 600))
  }
}
console.log('   syntax ok')

console.log('== check: cordis.yml ==')
const { parseCordisYml, normalizeEntries } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/loader.js')))
for (const yml of ['apps/cli/cordis.yml']) {
  try {
    const doc = parseCordisYml(fs.readFileSync(path.join(ROOT, yml), 'utf8'))
    const { entries } = normalizeEntries(doc)
    if (!entries.length) throw new Error('no plugins')
    console.log('   ' + yml + ' ok (' + entries.length + ' plugins)')
  } catch (e) {
    fail(yml + ' invalid: ' + e.message)
  }
}

console.log('== check: package.json ==')
for (const pj of ['package.json', 'packages/core/package.json', 'apps/cli/package.json']) {
  try {
    JSON.parse(fs.readFileSync(path.join(ROOT, pj), 'utf8'))
    console.log('   ' + pj + ' ok')
  } catch (e) {
    fail(pj + ' invalid: ' + e.message)
  }
}

console.log('== check: git whitespace (staged) ==')
if (fs.existsSync(path.join(ROOT, '.git'))) {
  // 本机 git 可能需要 GIT_EXEC_PATH（PortableGit）；探测失败则跳过而非误报
  const gv = run('git', ['--version'])
  if (gv.status !== 0) {
    console.log('   git unavailable, skip')
  } else {
    const r = run('git', ['diff', '--cached', '--check'])
    if (r.status !== 0) fail('staged whitespace:\n' + (r.stdout || '') + (r.stderr || ''))
    else console.log('   whitespace ok')
  }
}

if (!fast) {
  console.log('== check: harness (invariants) ==')
  const r = run(NODE, ['--test'])
  if (r.status !== 0) fail('harness:\n' + (r.stdout || '') + (r.stderr || ''))
  else {
    const m = (r.stdout || '').match(/# (pass|fail) (\d+)/g)
    console.log('   ' + (m ? m.join(' | ') : 'tests ok'))
  }

  console.log('== check: smoke (--list-sources) ==')
  const s = run(NODE, ['apps/cli/src/index.js', '--list-sources'])
  if (s.status !== 0) fail('smoke exit=' + s.status + '\n' + (s.stderr || '').slice(0, 400))
  else console.log('   smoke ok (exit 0)')
}

if (failures.length) {
  console.error('\ncheck FAILED: ' + failures.length)
  process.exit(1)
}
console.log('\ncheck PASSED')
