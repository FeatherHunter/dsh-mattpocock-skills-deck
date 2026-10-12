// scripts/verify-parallel.mjs —— 并行跑 verify 链。
//
// 为什么要有它：`npm run verify` 是一条用 ` && ` 串起来的链（226 步），一步一个 node 进程、一步一个红就停。
// 实测（2026-10-12，28 逻辑核）：串行 517 秒，其中 17 步 ≥5 秒、合计 425 秒；而这些慢步几乎全是空等
// （CPU 采样：31.8 秒的墙钟里 31.7 秒是 idle）。它们不抢 CPU，所以并发跑几乎能线性省时间——
// 同一批 17 步并发实测墙钟 63.5 秒（等于最慢那一步），串行是 425.5 秒。
//
// 用法：
//   node scripts/verify-parallel.mjs                 # 全链，默认 8 路并发，遇红继续跑完并汇总
//   node scripts/verify-parallel.mjs --jobs 16       # 加并发（慢步多在等，核多就调大）
//   node scripts/verify-parallel.mjs --tier fast     # 跳过真浏览器的步骤（日常用）
//   node scripts/verify-parallel.mjs --changed       # 只跑「本次改动影响到」的步骤（见 scripts/lib/select-gates.mjs）
//   node scripts/verify-parallel.mjs --only log --only 1003   # 只跑文件名含这些子串的步骤
//   node scripts/verify-parallel.mjs --list          # 只列出将要跑的步骤，不跑
//   node scripts/verify-parallel.mjs --json out.json # 额外写一份机器可读的结果
//
// 退出码：全部通过 0；有失败 1。链条目仍以 package.json 的 scripts.verify 为唯一来源，本脚本不改它。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const has = (name) => args.includes(name)
const optOf = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const allOf = (name) => args.flatMap((a, i) => (a === name && args[i + 1] && !args[i + 1].startsWith('--') ? [args[i + 1]] : []))

function chainSteps() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const raw = String((pkg.scripts && pkg.scripts.verify) || '')
  const steps = []
  for (const piece of raw.split(' && ')) {
    const s = piece.trim()
    const m = /^node\s+(tests\/\S+\.(?:js|mjs|cjs))$/.exec(s)
    if (m) steps.push({ cmd: s, file: m[1] })
  }
  return steps
}

// 「真浏览器」的步骤：文件里出现 playwright。它们各自要起一个 Chromium，最慢的那扇 34.6 秒。
function isBrowserStep(step) {
  try {
    return /playwright|puppeteer/.test(fs.readFileSync(path.join(ROOT, step.file), 'utf8'))
  } catch (e) {
    return false
  }
}

// 冲突组：同一组里的步骤不许同时跑，因为它们会抢同一个仓外资源。
// 实测教训：verify-release-contract.js 与 verify-bundled-skills.js 都会跑 `npm pack --dry-run`，
// 并发时前者假红（单独跑 58 通过 0 失败）。这类假红会让人误以为代码坏了，所以宁可把它们排成一队。
function conflictGroupsOf(step) {
  const groups = []
  let src = ''
  try {
    src = fs.readFileSync(path.join(ROOT, step.file), 'utf8')
  } catch (e) {
    return groups
  }
  if (/npm pack|npm publish/.test(src)) groups.push('npm-pack')
  // 只是提一句「先跑 node scripts/build.mjs」的不算，真去构建（起子进程）的才算。
  // 路径有两种写法都要认：`scripts/build.mjs` 和 `path.join('scripts', 'build.mjs')`
  // （verify-settings-view.js 用的是后一种；漏认会让它跟别的构建并发，构建互相踩，出现假红）。
  if (/(scripts\/build\.mjs|['"]build\.mjs['"])/.test(src) && /spawnSync|execFileSync|execSync|spawn\(/.test(src)) {
    groups.push('build')
  }
  return groups
}
const groupLocks = new Map()
function acquire(groups) {
  let chain = Promise.resolve()
  let release = null
  const gate = new Promise((r) => (release = r))
  for (const g of groups) {
    const prev = groupLocks.get(g) || Promise.resolve()
    groupLocks.set(
      g,
      prev.then(() => gate)
    )
    chain = chain.then(() => prev)
  }
  return chain.then(() => release)
}

// 本次改动涉及哪些文件：git 的已改/新增/未跟踪都算（不改动仓库，只读）。
function changedPathsOfSync() {
  const out = []
  try {
    out.push(execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }))
    out.push(execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }))
  } catch (e) {
    return null
  }
  const set = new Set()
  for (const block of out) {
    for (const line of String(block).split(/\r?\n/)) {
      if (!line.trim()) continue
      const p = line.slice(3).trim().replace(/^"|"$/g, '')
      if (p.includes(' -> ')) set.add(p.split(' -> ')[1].trim())
      else set.add(p)
    }
  }
  return [...set].map((p) => p.replace(/\\/g, '/'))
}

async function selectChanged() {
  const modPath = path.join(ROOT, 'scripts', 'lib', 'select-gates.mjs')
  if (!fs.existsSync(modPath)) {
    console.log('[并行门禁] 还没有 scripts/lib/select-gates.mjs，--changed 退回全链')
    return null
  }
  const changed = changedPathsOfSync()
  if (changed === null) {
    console.log('[并行门禁] 读不到 git 状态，--changed 退回全链')
    return null
  }
  const { selectGates } = await import(pathToFileURL(modPath).href)
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'gate-map.json'), 'utf8'))
  // 注意：归属表里的步骤写法是 `node tests/xxx.js`，要和它同一格式，否则一条都对不上。
  const picked = selectGates({ changedPaths: changed, map, chainSteps: chainSteps().map((s) => s.cmd) })
  if (!picked.fullChain && (!picked.steps || !picked.steps.length)) {
    // 一条都没选中说明挑选规则失效了。宁可跑全链，也绝不「什么都没跑却报成功」。
    console.log('[并行门禁] 挑选规则一条都没选中，这是异常情况，退回全链（请检查 tests/gate-map.json 与 scripts/lib/select-gates.mjs）')
    return null
  }
  console.log('[并行门禁] 改动 ' + changed.length + ' 个文件；选中 ' + picked.steps.length + ' 步' + (picked.fullChain ? '（全链，原因：' + picked.fullChainReason + '）' : ''))
  // 全链时挑选规则会把同一个理由按步数重复给出来，这里去重后再打，免得刷屏。
  const reasonTexts = []
  for (const r of picked.reasons || []) {
    const text = typeof r === 'string' ? r : r && (r.reason || r.why || r.text) ? r.reason || r.why || r.text : JSON.stringify(r)
    if (text && !reasonTexts.includes(text)) reasonTexts.push(text)
  }
  for (const text of reasonTexts.slice(0, 8)) {
    console.log('    · ' + text)
  }
  return picked.fullChain ? null : picked.steps
}

function runStep(step) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, [step.file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('exit', (code) => resolve({ ...step, code: code === null ? 1 : code, ms: Date.now() - started, out, err }))
    child.on('error', (e) => resolve({ ...step, code: 1, ms: Date.now() - started, out, err: String((e && e.message) || e) }))
  })
}

const steps0 = chainSteps()
if (!steps0.length) {
  console.error('[并行门禁] 读不出 package.json 的 scripts.verify')
  process.exit(1)
}

const only = allOf('--only')
const tier = optOf('--tier', 'full')
let steps = steps0
if (only.length) steps = steps.filter((s) => only.some((o) => s.file.includes(o)))
if (tier === 'fast' || tier === 'default') steps = steps.filter((s) => !isBrowserStep(s))
if (has('--changed')) {
  const picked = await selectChanged()
  if (picked) {
    const set = new Set(picked)
    steps = steps.filter((s) => set.has(s.file))
  }
}

if (has('--list')) {
  console.log('将要跑 ' + steps.length + ' 步（全链 ' + steps0.length + ' 步）：')
  for (const s of steps) console.log('  ' + s.file)
  process.exit(0)
}
if (!steps.length) {
  console.log('[并行门禁] 没有匹配的步骤')
  process.exit(0)
}

const jobs = Math.max(1, Number(optOf('--jobs', String(Math.min(8, Math.max(2, os.cpus().length - 1))))) || 8)
console.log('[并行门禁] 跑 ' + steps.length + ' 步，并发 ' + jobs + '（全链 ' + steps0.length + ' 步，档位 ' + tier + '）')

const started = Date.now()
const results = []
let cursor = 0
async function worker() {
  for (;;) {
    const i = cursor++
    if (i >= steps.length) return
    const step = steps[i]
    const groups = conflictGroupsOf(step)
    const release = groups.length ? await acquire(groups) : null
    let r = null
    try {
      r = await runStep(step)
    } finally {
      if (release) release()
    }
    results.push(r)
    const tag = r.code === 0 ? 'PASS' : 'FAIL'
    console.log('  ' + tag + ' ' + String(r.ms).padStart(6) + ' ms  ' + r.file)
    if (r.code !== 0 && !has('--keep-going')) {
      // 与串行链一样：遇红就停（已在跑的等它跑完再报）。
      cursor = steps.length
    }
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, steps.length) }, worker))
const wall = Date.now() - started

// 并发跑会碰到「抢同一个外部资源」造成的假红（实测：两扇门禁同时 `npm pack`、有人正在构建时别人读产物）。
// 所以并发跑完只当第一轮：凡是红的，再**一个一个串行复跑**一遍，以串行的结果为准。
// 这样既拿到并行的速度，又不会把假红当成真红报出去（真红会在复跑里再红一次）。
let failed = results.filter((r) => r.code !== 0)
if (failed.length && !has('--no-retry-failed')) {
  console.log('')
  console.log('[并行门禁] 第一轮有 ' + failed.length + ' 步红，串行复跑一遍以排除「抢资源造成的假红」：')
  for (const f of failed) {
    const again = await runStep(f)
    f.firstRound = { code: f.code, ms: f.ms, out: f.out, err: f.err }
    f.code = again.code
    f.ms = again.ms
    f.out = again.out
    f.err = again.err
    f.flaky = again.code === 0
    console.log('  ' + (again.code === 0 ? '复跑绿（并发假红）' : '复跑仍红（真红）') + '  ' + String(again.ms).padStart(6) + ' ms  ' + f.file)
  }
  failed = results.filter((r) => r.code !== 0)
}

const slow = [...results].sort((a, b) => b.ms - a.ms).slice(0, 10)
console.log('')
console.log('[并行门禁] 跑完 ' + results.length + '/' + steps.length + ' 步，墙钟 ' + (wall / 1000).toFixed(1) + ' 秒；真红 ' + failed.length + ' 步')
const flaky = results.filter((r) => r.flaky)
if (flaky.length) console.log('  并发假红（复跑已绿）' + flaky.length + ' 步：' + flaky.map((f) => f.file.replace('tests/', '')).join('、'))
if (slow.length) {
  console.log('  最慢的几步：')
  for (const r of slow) console.log('    ' + String(r.ms).padStart(6) + ' ms  ' + (r.code === 0 ? 'PASS' : 'FAIL') + '  ' + r.file)
}
for (const f of failed) {
  console.log('')
  console.log('=== FAIL ' + f.file + '（退出码 ' + f.code + '）===')
  const text = (f.out + (f.err ? '\n[stderr]\n' + f.err : '')).trimEnd()
  const lines = text.split(/\r?\n/)
  const tail = lines.length > 40 ? lines.slice(-40) : lines
  if (lines.length > 40) console.log('  …（前 ' + (lines.length - 40) + ' 行省略）')
  for (const l of tail) console.log('  ' + l)
}

if (has('--json')) {
  const outPath = optOf('--json', '')
  if (outPath) fs.writeFileSync(path.resolve(ROOT, outPath), JSON.stringify({ wallMs: wall, jobs, tier, results: results.map((r) => ({ file: r.file, code: r.code, ms: r.ms })) }, null, 2))
}
process.exit(failed.length ? 1 : 0)
