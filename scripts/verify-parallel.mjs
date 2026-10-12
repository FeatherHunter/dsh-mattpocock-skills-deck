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
//   node scripts/verify-parallel.mjs --tasks         # 只打印排程（车厢与预计耗时），不跑
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
// 排法见下面 buildTasks：同一组的步骤合成一节车厢，由同一个工人依次跑完。
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
  // `.scratch/` 与 `.scratch_*` 是排查用的草稿（.scratch/ 已在 .gitignore 里，但有人会把草稿写在根目录的 .scratch_ 前缀文件里）。
  // 它们不是源码，不该让挑选规则判成「改了根目录横切文件 → 跑全链」。
  return [...set]
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => !/(^|\/)\.scratch/.test(p))
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
    child.on('exit', (code) => resolve({ ...step, code: code === null ? 1 : code, ms: Date.now() - started, at: started, out, err }))
    child.on('error', (e) => resolve({ ...step, code: 1, ms: Date.now() - started, at: started, out, err: String((e && e.message) || e) }))
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

// 排程：同组互斥的步骤合成一节「车厢」，一节车厢占一个工人、车厢里的步骤依次跑；
// 其余步骤各自成一节。然后按上一轮实测耗时从长到短排（LPT）——最长的先开工，
// 墙钟才不会被「两个 34 秒的长步一前一后」拖成两倍（实测：按链条目顺序排 70.6 秒，按耗时排约 40 秒）。
// 耗时来自上一轮实测，存在 node_modules/.cache 里（不进版本库）；第一次跑按链条目顺序，跑完就有了。
const TIMES_PATH = path.join(ROOT, 'node_modules', '.cache', 'dsh-verify-times.json')
function loadTimes() {
  try {
    const raw = JSON.parse(fs.readFileSync(TIMES_PATH, 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch (e) {
    return {}
  }
}
const times = loadTimes()
const knownMs = Object.values(times).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
const typicalMs = knownMs.length ? knownMs[Math.floor(knownMs.length / 2)] : 200
const estimateOf = (s) => (Number.isFinite(times[s.file]) ? times[s.file] : typicalMs)

function buildTasks(list) {
  const free = []
  const lanes = []
  for (const s of list) {
    const gs = conflictGroupsOf(s)
    if (!gs.length) {
      free.push({ key: s.file, steps: [s], estimate: estimateOf(s), groups: [] })
      continue
    }
    // 一个步骤可能同时属于多个组（既跑 npm pack 又真构建）：有共同组就并进同一节车厢，免得两个车厢互相抢。
    const lane = lanes.find((l) => l.groups.some((g) => gs.includes(g)))
    if (lane) {
      for (const g of gs) if (!lane.groups.includes(g)) lane.groups.push(g)
      lane.steps.push(s)
      lane.estimate += estimateOf(s)
    } else {
      lanes.push({ key: 'lane:' + gs.slice().sort().join('+'), steps: [s], estimate: estimateOf(s), groups: gs.slice() })
    }
  }
  // 预构建：源码刚改过时，第一次 `node scripts/build.mjs` 要真花 30 秒。链上有十几扇门禁各自会跑它，
  // 把它们排在车厢最前面先构建一次，后面的门禁就都命中构建缓存（各 0.2 秒），
  // 而且先读产物的门禁看到的一定是刚构建出来的产物，不会读到半旧的一份。
  // 说明：这不减少总工作量（构建与这些门禁本来就同在一节车厢里、只能串着跑），
  // 减掉的是「同一轮里反复重建」和「读到半旧产物」这两种意外。
  for (const lane of lanes) {
    if (!lane.groups.includes('build')) continue
    const prebuild = {
      cmd: 'node scripts/build.mjs',
      file: 'scripts/build.mjs',
      label: 'scripts/build.mjs（预构建：让后面十几扇门禁直接命中构建缓存）',
      // 预构建是提速手段，不是门禁：它失败不算链红（比如同一台机器上还有别人在构建，两边撞了）。
      // 真需要构建的门禁自己会再跑一次，失败会由它们如实报出来。
      optional: true
    }
    lane.steps.unshift(prebuild)
    lane.estimate += Math.max(estimateOf(prebuild), 30000)
  }
  return [...free, ...lanes].sort((a, b) => b.estimate - a.estimate)
}

const tasks = buildTasks(steps)
if (has('--tasks')) {
  console.log('排成 ' + tasks.length + ' 节车厢（按预计耗时从长到短）：')
  for (const t of tasks) {
    console.log('  ' + String(Math.round(t.estimate)).padStart(6) + 'ms  ' + (t.groups.length ? '[互斥 ' + t.groups.join('+') + '] ' : '') + t.key + '（' + t.steps.length + ' 步）')
    if (t.groups.length) for (const s of t.steps) console.log('         · ' + s.file)
  }
  process.exit(0)
}
console.log(
  '[并行门禁] 跑 ' +
    steps.length +
    ' 步，并发 ' +
    jobs +
    '（全链 ' +
    steps0.length +
    ' 步，档位 ' +
    tier +
    '，排成 ' +
    tasks.length +
    ' 节车厢，其中互斥组 ' +
    tasks.filter((t) => t.groups.length).length +
    ' 节）'
)

const started = Date.now()
const results = []
let cursor = 0
let stop = false
async function worker() {
  for (;;) {
    if (stop) return
    const i = cursor++
    if (i >= tasks.length) return
    for (const step of tasks[i].steps) {
      if (stop) return
      const r = await runStep(step)
      r.optional = !!step.optional
      results.push(r)
      const tag = r.code === 0 ? 'PASS' : step.optional ? 'WARN' : 'FAIL'
      console.log('  ' + tag + ' ' + String(r.ms).padStart(6) + ' ms  ' + (step.label || r.file))
      if (r.code !== 0 && !step.optional && !has('--keep-going')) {
        // 与串行链一样：遇红就停（已在跑的等它跑完再报）。
        stop = true
        return
      }
    }
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, worker))
const wall = Date.now() - started

// 记下这一轮每步花了多久，供下一次排程用（写不进去不算错）。
try {
  const merged = loadTimes()
  for (const r of results) if (r && Number.isFinite(r.ms)) merged[r.file] = r.ms
  fs.mkdirSync(path.dirname(TIMES_PATH), { recursive: true })
  fs.writeFileSync(TIMES_PATH, JSON.stringify(merged, null, 2))
} catch (e) {
  /* 缓存写不进去不影响判定 */
}

// 并发跑会碰到「抢同一个外部资源」造成的假红（实测：两扇门禁同时 `npm pack`、有人正在构建时别人读产物）。
// 所以并发跑完只当第一轮：凡是红的，再**一个一个串行复跑**一遍，以串行的结果为准。
// 这样既拿到并行的速度，又不会把假红当成真红报出去（真红会在复跑里再红一次）。
let failed = results.filter((r) => r.code !== 0 && !r.optional)
if (failed.length && !has('--no-retry-failed')) {
  console.log('')
  console.log('[并行门禁] 第一轮有 ' + failed.length + ' 步红，串行复跑一遍以排除「抢资源造成的假红」：')
  for (const f of failed) {
    const again = await runStep(f)
    // 第一轮的开工时刻与耗时原样留档：复跑会覆盖 ms，不留档就再也看不出「第一轮到底等了多久」。
    f.firstRound = { code: f.code, ms: f.ms, at: f.at, out: f.out, err: f.err }
    f.code = again.code
    f.ms = again.ms
    f.at = again.at
    f.out = again.out
    f.err = again.err
    f.flaky = again.code === 0
    console.log('  ' + (again.code === 0 ? '复跑绿（并发假红）' : '复跑仍红（真红）') + '  ' + String(again.ms).padStart(6) + ' ms  ' + f.file)
  }
  failed = results.filter((r) => r.code !== 0 && !r.optional)
}

const slow = [...results].sort((a, b) => b.ms - a.ms).slice(0, 10)
console.log('')
// 预构建不是链上的步骤，算总数时把它摘出去（它自己的耗时照旧打在明细里）。
const chainRan = results.filter((r) => steps.some((s) => s.file === r.file)).length
console.log('[并行门禁] 跑完 ' + chainRan + '/' + steps.length + ' 步，墙钟 ' + (wall / 1000).toFixed(1) + ' 秒；真红 ' + failed.length + ' 步')
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
  if (outPath) fs.writeFileSync(path.resolve(ROOT, outPath), JSON.stringify({ wallMs: wall, jobs, tier, results: results.map((r) => ({ file: r.file, code: r.code, ms: r.ms, at: r.at })) }, null, 2))
}
process.exit(failed.length ? 1 : 0)
