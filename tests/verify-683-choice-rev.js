#!/usr/bin/env node
/**
 * verify-683-choice-rev.js —— F1 的「修订号那条线」：客户端这一半（ADR 的 R2、R2b、§5 接线）。
 *
 * #1003 收尾后的口径：修订号那条线整条退役 —— 用户的选择只存在工作区配置文件里（宿主直接读文件），
 *   客户端既不上报「亲手选的哪条」，也不上报版本号。这一份量的是退役退干净了：
 *   - A：用户亲手选的那一条长什么样（后端 + 引用 + 点击时刻；不带标记、不带版本位）；
 *   - B：全仓扫描 —— src/ 下没有任何一处还提到 baseRev（漏一处就是那根管子没拔净）；
 *   - C：绑定回包不再往本地落版本号（本地没有镜像可落）；
 *   - D：宿主回的那条照旧优先（原样透传）；
 *   - G：R6b 的本地镜像不再垫底（秒显走快照缓存那条路）；
 *   - F：反证 —— 把实现做坏时上面该红的必须当场红（含 B 组那把扫描自己抓不抓得到漏改）。
 *
 * 做法：把 src/client/kernel/store-prefs.js 的真身文本喂进沙箱求值（真源 + 假 localStorage/window），
 *   再用改坏的那一份跑同一批断言 —— 该红的必须当场红。
 *
 * 用法：node tests/verify-683-choice-rev.js
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// 取源走共用入口（#1207 立，见 tests/lib/source-text.ts）：#1209 把 prompts.js 与 StatusBackend.js
// 的真源转成了 .ts，按 .js 路径直接读会读到真源旁边那份构建产物（esbuild 排版过，函数形状也变了）。
import { sourcePath, spliceableJs } from './lib/source-text.ts'
// 本文件按文本求值统一走共用入口 compileFn：把 store-prefs.js 真身与假 window/localStorage 一起求值（理由与用法见 tests/lib/eval-probe.js 文件头）。
import { compileFn } from './lib/eval-probe.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const PREFS_REL = 'src/client/kernel/store-prefs.js'
let passed = 0
let failed = 0
const check = (ok, msg) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }
const read = (rel) => fs.readFileSync(path.join(ROOT, sourcePath(rel)), 'utf8')
// #1003 收尾：版本位那根管子要拔净 —— 扫描一棵源码树下还有没有哪一处提到 baseRev，返回「文件:行号」清单。
//   真源扫的是 src/（B 组）；反证 F4 拿它扫一份塞了 baseRev 的临时副本，证明这把扫描抓得到漏改。
const scanBaseRev = function (rootDir) {
  const hits = []
  const walk = function (dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); return }
      if (!/\.(js|mjs|cjs|ts|mts)$/.test(e.name)) return
      fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(function (line, i) { if (line.includes('baseRev')) hits.push(path.relative(ROOT, p) + ':' + (i + 1)) })
    })
  }
  walk(rootDir)
  return hits
}

const prefsSrc = read(PREFS_REL)
const stripExports = (s) => s.replace(/^[ \t]*export[ \t]+/gm, '')
const wsKey = (p) => String(p == null ? '' : p).replace(/\\/g, '/').toLowerCase()

const makeHarness = function (srcText, opts) {
  const o = opts || {}
  const disk = {}
  Object.keys(o.disk || {}).forEach((k) => { disk[k] = o.disk[k] })
  const logs = []
  const localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(disk, k) ? disk[k] : null },
    setItem: function (k, v) { disk[k] = String(v) },
    removeItem: function (k) { delete disk[k] },
  }
  const win = { innerHeight: 800, addEventListener: function () {} }
  const body = stripExports(srcText) +
    '\n; return { userPickSelection: userPickSelection, adoptBoundRev: adoptBoundRev, keepUserPick: keepUserPick,' +
    ' userHintOf: userHintOf, getCachedSelection: getCachedSelection, selectionByCwd: selectionByCwd, SELECTION_BY_CWD_KEY: SELECTION_BY_CWD_KEY }'
  // 真源文本配假 window/localStorage：改走共用入口 compileFn，参数名逐个列出。
  const factory = compileFn(['window', 'localStorage', 'log', 'keyOf', 'wsKeyOf', 'emit', 'shared', 'stores'], body)
  const api = factory(win, localStorage, function (l, e, f) { logs.push({ l: l, e: e, f: f }) }, wsKey, wsKey, function () {}, {}, {})
  return { api: api, disk: disk, logs: logs }
}

console.log('修订号那条线已退役门禁（#1003：无标记、无版本位；宿主读文件）')

// ── A 乐观选择的形状：后端 + 引用 + 点击时刻（R2 作废）──────────────────────────
console.log('')
console.log('== A 用户点的那一条：后端 + 引用 + 点击时刻（无标记无版本位）==')
{
  const h = makeHarness(prefsSrc)
  const first = h.api.userPickSelection('markdown', { backend: 'markdown' }, null)
  check(first.backendId === 'markdown' && first.source === 'explicit', '构造函数给出后端 + source —— 实得 ' + JSON.stringify(first))
  check(first.userPicked !== true && first.rev === undefined, '不再盖亲手标记、不带版本位 —— 实得 ' + JSON.stringify(first))
  check(typeof first.pickedAt === 'number' && first.pickedAt > 0, '带上点击时刻 pickedAt（水合守卫认它）—— 实得 ' + first.pickedAt)
  const second = h.api.userPickSelection('github', null, { backendId: 'markdown', source: 'explicit', rev: 4 })
  check(second.rev === undefined, '上一条的版本位不再带到新选的那条上 —— 实得 ' + second.rev)
  check(second.ref === null, '没有仓库引用时 ref 记 null（形状不缺字段）')
  const third = h.api.userPickSelection('github', undefined, { backendId: 'markdown', rev: 4 })
  check(third.ref === null, 'ref 传 undefined 也记 null')
}

// ── B 全仓扫描：src/ 下没有任何一处还提版本位（#1003 收尾）────────────────────────
console.log('')
console.log('== B 全仓扫描：src/ 下没有任何一处还提到 baseRev ==')
{
  const hits = scanBaseRev(path.join(ROOT, 'src'))
  check(hits.length === 0, 'src/ 下 0 处提到 baseRev（版本位那根管子已拔净）—— 实得 ' + (hits.length ? hits.join('、') : '0 处'))
}

// ── C adoptBoundRev 恒空（§5 接线作废：本地无镜像可落）───────────────────────────
console.log('')
console.log('== C 绑定回包不再往本地落版本 ==')
{
  const h = makeHarness(prefsSrc)
  const st = { cwd: 'D:\\X', selection: { backendId: 'markdown', source: 'explicit', pickedAt: 1 } }
  check(h.api.adoptBoundRev(st, { ok: true, cwd: 'd:\\X', backendId: 'markdown', rev: 5 }) === null, '裸回包也回空（无处可落）')
  check(h.api.adoptBoundRev(st, { ok: true, value: { ok: true, rev: 7 } }) === null, '信封回包同样回空')
  check(st.selection.rev === undefined, '会话里那条不被加上版本位 —— 实得 ' + st.selection.rev)
}

// ── D keepUserPick 原样透传（R2b 作废：无标记可留）────────────────────────────────
console.log('')
console.log('== D keepUserPick 原样透传 ==')
{
  const h = makeHarness(prefsSrc)
  const incoming = { backendId: 'markdown', source: 'explicit', ref: null }
  check(h.api.keepUserPick({ backendId: 'markdown', pickedAt: 111 }, incoming) === incoming, '宿主回包原样透传')
  check(h.api.keepUserPick({ backendId: 'markdown' }, { backendId: 'gitlab', source: 'explicit' }).backendId === 'gitlab', '宿主回别的后端照旧用宿主的')
}

// ── G R6b：镜像垫底已撤（#1003）── 三档剩两档，第三档恒空 ─────────────────────────
console.log('')
console.log('== G R6b：本地镜像不再垫底 ==')
{
  // #1209：prompts 的真源已是 .ts，这里取的是「构建真正拼进闭包的那份 JavaScript」
  //   （spliceableJs = 真源过 esbuild + 剥行首 export），所以下面这条正则按转译后的形状写：
  //   没有 `export ` 前缀、`function(` 之间没有空格（esbuild 重新排版过）、收尾是 `};`。
  const promptsSrc = spliceableJs('src/client/kernel/prompts.js')
  const m = promptsSrc.match(/^const currentBackendId = function\(st\) \{[\s\S]*?\n\};/m)
  const fnSrc = m ? m[0] : ''
  check(!!fnSrc, '取到 prompts.js 里的 currentBackendId（真身，整段取出）')
  const mk = function (srcText) {
    const body = srcText.trim().replace(/^const currentBackendId = /, '')
    // 回读函数按生产行为恒空（镜像已退役）：改走共用入口 compileFn。
    return compileFn(['getCachedSelection'], 'return ' + body)(() => null)
  }
  const fn = mk(fnSrc)
  check(fn({ cwd: 'D:\\x', selection: { backendId: 'github' }, snapshot: null }) === 'github', '会话里已经答过就以会话为准（不看镜像）')
  check(fn({ cwd: 'D:\\x', selection: null, snapshot: { selection: { backendId: 'gitlab' } } }) === 'gitlab', '会话没答过但快照里带着后端时以快照为准')
  check(fn({ cwd: 'D:\\x', selection: null, snapshot: null }) === null, '都没回话时不再拿镜像垫（镜像已空；秒显走快照缓存那条路）')
  check(fn({ cwd: 'D:\\x', selection: null, snapshot: { selection: null } }) === null, '宿主回过“没有后端”时以宿主为准')
}

// ── F 反证：把实现做坏，上面该红的必须当场红 ──────────────────────────────────────────
console.log('')
console.log('== F 反证：把实现做坏，对应的那几条必须当场红 ==')
const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-683-rev-'))
const loadBroken = function (tag, from, to) {
  if (!prefsSrc.includes(from)) return { bad: '这道反证的改法在真源里找不到落点（源文本已变）' }
  const file = path.join(brokenDir, tag + '.js')
  fs.writeFileSync(file, prefsSrc.replace(from, to), 'utf8')
  return { src: fs.readFileSync(file, 'utf8') }
}
{
  // F1 构造函数里加回版本位 → A 组“无版本位”那条当场红
  const b1 = loadBroken('has-rev', 'ref: (ref === undefined ? null : ref), pickedAt: Date.now()', 'ref: (ref === undefined ? null : ref), pickedAt: Date.now(), rev: 1')
  check(!b1.bad, '反证 F1 的改法能在真源里落地（给乐观选择加回版本位）' + (b1.bad ? ' —— ' + b1.bad : ''))
  if (b1.src) {
    const h = makeHarness(b1.src)
    const second = h.api.userPickSelection('github', null, { backendId: 'markdown' })
    check(second.rev === 1, '反证 F1 成立：加回去之后构造出来的选择又带版本位了 —— 说明 A 组量的就是“无版本位”')
  }
  // F2 读数不再恒空
  const b2 = loadBroken('read-back', 'export const getCachedSelection = function (cwd) { return null }', 'export const getCachedSelection = function (cwd) { return { backendId: "github" } }')
  check(!b2.bad, '反证 F2 的改法能在真源里落地（把选择读数加回去）' + (b2.bad ? ' —— ' + b2.bad : ''))
  if (b2.src) {
    const h = makeHarness(b2.src)
    check(h.api.getCachedSelection('D:\\X') !== null, '反证 F2 成立：加回去之后读恒不为空 —— 说明退役门禁量的就是“读恒空”')
  }
}
// F4 扫描本身能抓到漏改：往一份临时副本里塞回一个 baseRev，B 组那把扫描必须点名点出来
{
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-683-rev-scan-'))
  fs.writeFileSync(path.join(probeDir, 'with-baserev.js'), 'const x = { baseRev: 0 }\n', 'utf8')
  const hits = scanBaseRev(probeDir)
  check(hits.length === 1, '反证 F4 成立：塞回一处 baseRev 后扫描当场点名 —— 说明 B 组量的就是「一处都没有」（实得 ' + hits.length + ' 处）')
  try { fs.rmSync(probeDir, { recursive: true, force: true }) } catch (e) {}
}
try { fs.rmSync(brokenDir, { recursive: true, force: true }) } catch (e) {}

console.log('')
console.log(failed ? '存在失败 — verify-683-choice-rev 未通过（' + passed + ' 项通过、' + failed + ' 项失败）' : '全部通过 — 修订号那条线门禁生效（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
