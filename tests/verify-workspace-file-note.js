#!/usr/bin/env node
/**
 * verify-workspace-file-note.js —— #1012 客户端那一行「工作区配置文件写成什么样」的门禁。
 *
 * 这一行是干什么的：用户在门控窗（或切换弹窗）点确认之后，宿主除了绑定后端，还会把「这次选择写进
 *   工作区配置文件」的结果一起回给客户端；客户端把它记进会话状态，并在状态栏里如实显示一句话。
 *   宿主那一侧只算三种结果（见 src/host/workspaceCwd.js 的 writeWorkspaceFileOnFirstBind）：
 *     写成  { ok:true, placed:true, reason:'created' | 'overwritten' }
 *     跳过  { ok:true, skipped:'explicit-none' | 'unregistered' | 'registry-unavailable' }（正常不做）
 *     失败  { ok:false, error:{ kind:'env', message } }（没写进工作区，但绑定照旧有效）
 *   客户端那一侧只负责把这份回执翻成人话，不重算判断（见 src/client/kernel/store-prefs.js 的
 *   workspaceFileNoteOf / workspaceFileNoteEl / adoptBoundRev）。
 *
 * 本门禁量六件事：
 *   A 宿主那一侧的形状：上面那几行返回字面量还在，跳过今天仍只有那三个取值（客户端翻译与它同一套词）；
 *   B 五种回执翻出来的人话：已创建、已覆盖（要写明覆盖了原来那一条）、三种跳过（回空串，不打扰人）、
 *     环境失败（如实说没写进工作区，并明说绑定照旧有效）、没有结果（回空串）；
 *   C adoptBoundRev 把回执记进会话状态（回执在顶层 / 回执在 res.value 里 / 没有回执记空三种）且仍然返回 null；
 *   D workspaceFileNoteEl 没有结果回 null；有结果但纯 node 里没有 h 时也回 null（不抛）；
 *     给它一个 h（假节点工厂）就回一个 div 节点，节点里写的正是翻译出来那句话；
 *   E 构建产物：根 client.js（dev 产物）与 package/lib/client.js（发布产物）里确实有 workspaceFileNoteEl
 *     的定义与状态栏的两处调用点 —— 证明「一源两物」的拼接真的生效，而不是只在源文件里躺着；
 *   F 反证：把翻译函数改坏（跳过也给人话、覆盖那句不说覆盖、失败那句不提绑定照旧有效），
 *     B 组对应的那几条必须当场红 —— 证明 B 组量的就是那几行，不是走过场。
 *
 * 两种取值路线，哪一条走哪种方式（实测结论写在这里，照做即可）：
 *   1) 行为断言（B/C/D 里凡是量真模块行为的那几条）走**真模块直接 import**：本文件是 ESM，用 import()
 *      取 src/client/kernel/store-prefs.js 的真身。实测（node v24.19.0，本仓 package.json 没有
 *      "type":"module"）导入**不抛**：它顶层的 window/localStorage 访问全都在 try 里
 *      （DEFAULT_PANEL_H / listPrefs / labelClicks / bannerFoldByCwd 那几段），拿不到就降级；
 *      Node 按语法探测把它重新当 ESM 解析并打一条 MODULE_TYPELESS_PACKAGE_JSON 警告 —— 那条只是
 *      提醒加载方式，不改断言结论，tests/ 下既有的 ESM 门禁同样吃这条。所以这里不退回「只读文本断言」。
 *   2) 需要「有 h 的那一支」与「改坏之后必须红」这两处，按文本求值：走 tests/lib/eval-probe.js 的
 *      compileFn（与 tests/verify-683-choice-rev.js 对同一个文件的做法一致），把真身函数文本连同
 *      参数名（h / workspaceFileNoteOf）一起求值，仓库里不新增裸 eval 点。
 *
 * 用法：node tests/verify-workspace-file-note.js
 *   产物那几条（E 组）要求先跑 node scripts/build.mjs；源码改过而产物没重建时，E 组会红并提示重跑构建。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
// 按文本求值统一走共用入口 compileFn（理由与用法见 tests/lib/eval-probe.js 文件头）。
import { compileFn } from './lib/eval-probe.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const PREFS_REL = 'src/client/kernel/store-prefs.js'
const HOST_REL = 'src/host/workspaceCwd.js'
const STATUSBAR_REL = 'src/client/statusbar/StatusBar.js'
// 产物真路径（本仓没有 src/client/client.js 这个文件，别照名字猜）：
//   根 client.js 是 scripts/build.mjs 写的 dev 产物（cordis_define 函数体形态），
//   package/lib/client.js 是同一份函数体外加 ModuleLoader 工厂壳的发布产物。
const ARTIFACTS = ['client.js', 'package/lib/client.js']

let passed = 0
let failed = 0
const check = (ok, msg) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

const prefsSrc = read(PREFS_REL)
const hostSrc = read(HOST_REL)

// 宿主那一侧今天只算这三个跳过取值（下面 A 组会去源文件里核对，B 组按核对结果逐个喂给翻译函数）。
const DOCUMENTED_SKIPS = ['explicit-none', 'unregistered', 'registry-unavailable']

// 翻译结果该长什么样：只量「人能不能读懂」的硬要求，不钉死整句措辞（措辞以后可以改，语义不许改）。
//   已创建：说得清是写进了工作区里的配置文件，且不许谎称覆盖。
const looksCreated = (t) => typeof t === 'string' && t !== '' && t.includes('工作区') && t.includes('配置文件') && !t.includes('覆盖')
//   已覆盖：必须写明覆盖了原来那一条（与「已创建」区分开）。
const looksOverwritten = (t) => typeof t === 'string' && t !== '' && t.includes('工作区') && t.includes('覆盖') && t.includes('原来')
//   环境失败：如实说没写进工作区，并明说绑定照旧有效（用户别以为绑定也跟着废了）。
const looksEnvFail = (t) => typeof t === 'string' && t !== '' && t.includes('工作区') && /(没能|没有|没写|未写|没存|失败)/.test(t) && t.includes('绑定') && t.includes('有效')

// 从真源里整段取出一个函数表达式（`export const 名字 = function (...) { ... }` 的 `function ...` 那一段）。
//   写法与 tests/verify-683-choice-rev.js 取 currentBackendId 时同例：非贪婪取到行首四个空格那个闭括号。
const fnExprOf = function (srcText, name) {
  const re = new RegExp('export const ' + name + ' = (function \\([^)]*\\) \\{[\\s\\S]*?\\n    \\})')
  const m = srcText.match(re)
  return m ? m[1] : ''
}

console.log('工作区配置文件那一行门禁（#1012：绑定回执里「写进工作区配置文件」的结果翻成人话）')

// ── A 宿主那一侧的形状：翻译要对得上宿主真能回的那几个值 ─────────────────────────
console.log('')
console.log('== A 宿主那一侧的形状（' + HOST_REL + ' 的 writeWorkspaceFileOnFirstBind）==')
const hostBindBody = (function () {
  const i = hostSrc.indexOf('async function writeWorkspaceFileOnFirstBind')
  const j = hostSrc.indexOf('async function migrateChoiceToFile')
  return (i >= 0 && j > i) ? hostSrc.slice(i, j) : ''
})()
check(hostBindBody !== '', '整段取到 writeWorkspaceFileOnFirstBind 的函数体（下面几个取值都从这一段里认，不认别处的同名写法）')
const hostSkips = Array.from(new Set((hostBindBody.match(/skipped:\s*'([^']+)'/g) || []).map((s) => s.replace(/[^']*'([^']+)'[^']*/, '$1')))).sort()
check(
  hostSkips.length === 3 && hostSkips.join(',') === DOCUMENTED_SKIPS.slice().sort().join(','),
  '跳过一档今天只有那三个取值（实得 ' + JSON.stringify(hostSkips) + '；多出一个就说明客户端那边该同步看一眼怎么翻）',
)
check(
  /return\s*\{\s*ok:\s*true,\s*placed:\s*true,\s*reason:\s*existed\s*\?\s*'overwritten'\s*:\s*'created'\s*\}/.test(hostBindBody),
  '写成那一档回的是 { ok:true, placed:true, reason: existed ? \'overwritten\' : \'created\' }（客户端就按 reason 分「新建」与「覆盖」两句）',
)
const envFailSites = (hostBindBody.match(/ok:\s*false,\s*error:\s*\{\s*kind:\s*'env'/g) || []).length
check(
  envFailSites >= 2,
  '失败那一档回的是 { ok:false, error:{ kind:\'env\', message } }（这一段里两处落点：拿不到文件通道、写文件本身抛错；实得 ' + envFailSites + ' 处）',
)
check(
  /workspaceFile:\s*workspaceFile/.test(hostSrc),
  '这份结果挂在绑定回执的 workspaceFile 字段上（客户端就是从这儿取的，不是另编一个字段名）',
)

// ── 真模块直取（路线 1）：B/C/D 里量行为的那几条都拿真身函数来跑 ────────────────────
let prefs = null
try {
  prefs = await import(pathToFileURL(path.join(ROOT, PREFS_REL)).href)
} catch (e) {
  console.log('')
  console.log('  FAIL 真模块导入失败：' + String((e && e.message) || e))
  console.log('       —— 这条路线的前提是「顶层 window/localStorage 访问都在 try 里」，导入一旦抛，')
  console.log('          本门禁要么改走读文本断言，要么先修顶层那几段；此处不再往下猜结论。')
  console.log('')
  console.log('存在失败 — verify-workspace-file-note 未通过（0 项通过、1 项失败）')
  process.exit(1)
}
for (const name of ['adoptBoundRev', 'workspaceFileNoteOf', 'workspaceFileNoteEl']) {
  check(typeof prefs[name] === 'function', '真模块导出了 ' + name + '（一源两物的那一源上有它，拼接才可能带上它）')
}
const noteOf = prefs.workspaceFileNoteOf
const adoptBoundRev = prefs.adoptBoundRev
const noteEl = prefs.workspaceFileNoteEl

// ── B 五种回执翻出来的人话 ──────────────────────────────────────────────────────
console.log('')
console.log('== B 五种回执翻出来的人话 ==')
const noteCreated = noteOf({ ok: true, placed: true, reason: 'created' })
check(looksCreated(noteCreated), '已创建：回一句人话，说清了是写进工作区里的配置文件，且不谎称覆盖（实得「' + noteCreated + '」）')
const noteOverwritten = noteOf({ ok: true, placed: true, reason: 'overwritten' })
check(looksOverwritten(noteOverwritten), '已覆盖：写明覆盖了原来那一条（实得「' + noteOverwritten + '」）')
check(noteOverwritten !== noteCreated, '已覆盖与已创建不是同一句（覆盖那条多说了「原来那条被换掉」，两句话不许合并成一句）')
const skipValues = Array.from(new Set(DOCUMENTED_SKIPS.concat(hostSkips))).sort()
for (const v of skipValues) {
  const t = noteOf({ ok: true, skipped: v })
  check(t === '', '跳过（' + v + '）回空串 —— 正常不做，不打扰人（实得「' + t + '」）')
}
const noteEnvFail = noteOf({ ok: false, error: { kind: 'env', message: '磁盘只读，写不进去' } })
check(looksEnvFail(noteEnvFail), '环境失败：如实说没写进工作区，并明说绑定照旧有效（实得「' + noteEnvFail + '」）')
check(noteEnvFail !== noteCreated && noteEnvFail !== noteOverwritten, '环境失败那句与「已经写进去」那两句不是同一句（不许把没写成说成写成了）')
check(noteOf({ ok: false }) === noteEnvFail, '回包只给了 ok:false、没带 error 细节时，说的还是同一句失败话（失败就是失败，不因为没有细节就闭嘴）')
for (const c of [['null', null], ['undefined', undefined], ['空串', ''], ['不是对象的东西', 'x']]) {
  const t = noteOf(c[1])
  check(t === '', '没有结果（' + c[0] + '）回空串 —— 状态栏那一行不占位（实得「' + t + '」）')
}

// ── C adoptBoundRev 记状态，且仍然返回 null ──────────────────────────────────────
console.log('')
console.log('== C adoptBoundRev 把回执记进会话状态，返回值仍是 null ==')
{
  const receipt = { ok: true, placed: true, reason: 'created' }
  const st1 = {}
  const r1 = adoptBoundRev(st1, { ok: true, cwd: 'd:\\X', backendId: 'markdown', workspaceFile: receipt })
  check(st1.workspaceFileResult === receipt, '有回执：把 res.workspaceFile 原样记进 st.workspaceFileResult（记的是宿主那一份，不复制成自己的形状）')
  check(r1 === null, '有回执时返回值仍然是 null（本地没有修订号可落，调用方照旧判绑定成败）')
  const st2 = {}
  const r2 = adoptBoundRev(st2, { ok: true, value: { ok: true, workspaceFile: receipt } })
  check(st2.workspaceFileResult === receipt, '回执装在 res.value 里（信封形态的回包）也认得出这一项')
  check(r2 === null, '信封形态下返回值同样是 null')
  const st3 = { workspaceFileResult: receipt }
  const r3 = adoptBoundRev(st3, { ok: true, cwd: 'd:\\X', backendId: 'markdown', rev: 7 })
  check(st3.workspaceFileResult === null, '没有回执：记 null（每次调用整条替换，上一次那句不许一直挂在那儿误导人）')
  check(r3 === null, '没有回执时返回值同样是 null')
  check(adoptBoundRev(null, { ok: true, workspaceFile: receipt }) === null, '会话状态传 null 时不抛错、也回 null')
}

// ── D workspaceFileNoteEl：没有结果回 null；纯 node 里没有 h 也不许炸 ───────────────
console.log('')
console.log('== D workspaceFileNoteEl 什么时候回 null、什么时候回节点 ==')
check(noteEl({}) === null, '没有结果时回 null（不占位，现有布局一个像素都不动）')
check(noteEl({ workspaceFileResult: null }) === null, '结果记成 null 时回 null')
check(noteEl(null) === null && noteEl(undefined) === null, '会话状态本身缺席时也回 null（调用方不必先判空）')
check(noteEl({ workspaceFileResult: { ok: true, skipped: 'unregistered' } }) === null, '跳过那一档翻出来是空串，所以同样回 null（正常不做就不占位）')
let elThrew = null
let elInNode = 'unset'
try { elInNode = noteEl({ workspaceFileResult: { ok: true, placed: true, reason: 'created' } }) } catch (e) { elThrew = e }
check(elThrew === null, '纯 node 里调用「有结果」那一支不抛错（闭包里的 h 拿不到时被 catch 兜住）' + (elThrew ? '：' + String(elThrew.message || elThrew) : ''))
check(elInNode === null, '纯 node 里没有 h，落到 catch 回 null —— 这一条钉的就是「页面外调用不得炸」（实得 ' + JSON.stringify(elInNode) + '）')
// 有结果且有译文时该回一个节点：纯 node 里没有 h，这一支走不到，改用真身文本 + 假 h（路线 2）。
const elFnExpr = fnExprOf(prefsSrc, 'workspaceFileNoteEl')
check(elFnExpr !== '', '从真源里整段取到 workspaceFileNoteEl 的函数表达式（下面拿它配一个假 h 求值）')
if (elFnExpr) {
  const fakeH = (tag, props, children) => ({ tag: tag, props: props, children: children })
  const makeEl = compileFn(['h', 'workspaceFileNoteOf'], 'return ' + elFnExpr)
  const withH = makeEl(fakeH, noteOf)
  const node = withH({ workspaceFileResult: { ok: true, placed: true, reason: 'created' } })
  check(!!node && node.tag === 'div', '给它一个 h 就回一个 div 节点（状态栏那一行小灰字）—— 实得 ' + JSON.stringify(node && node.tag))
  check(!!node && node.children === noteCreated, '节点里写的正是翻译出来那句话（实得「' + (node && node.children) + '」）')
  check(!!node && !!node.props && !!node.props.style, '那一行带着自己的样式（不靠调用方补样式，字号颜色都在这一个节点上说清）')
  check(withH({ workspaceFileResult: { ok: true, skipped: 'explicit-none' } }) === null, '有 h 时跳过那一档照旧回 null（跳过就是不占位）')
  check(withH({}) === null, '有 h 时没有结果照旧回 null')
}

// ── E 构建产物：拼接真的生效（定义在产物里，状态栏两处调用点也在）─────────────────────
console.log('')
console.log('== E 构建产物：一源两物的拼接真的生效 ==')
for (const rel of ARTIFACTS) {
  if (!exists(rel)) {
    check(false, rel + ' 存在（缺了就先跑 node scripts/build.mjs；本仓没有 src/client/client.js 这个文件，产物真路径就是这两个）')
    continue
  }
  const txt = read(rel)
  check(/const workspaceFileNoteEl = function \(s\) \{/.test(txt), rel + ' 里有 workspaceFileNoteEl 的定义（内核那一片被拼进来了）')
  check(!/export const workspaceFileNoteEl/.test(txt), rel + ' 里那一行开头不再带 export（拼接时按约定去掉了行首 export，说明它确实走的是拼接这条路）')
  check(/const txt = \(s && s\.workspaceFileResult\) \? workspaceFileNoteOf\(s\.workspaceFileResult\) : ''/.test(txt), rel + ' 里那一行读的是会话状态里的 workspaceFileResult')
  check(txt.includes('[modalSeat, workspaceFileNoteEl(s), capsule]'), rel + ' 里有状态栏「没有横幅」那一支的调用点（胶囊上方那一行）')
  check(txt.includes('stepBanner, workspaceFileNoteEl(s),'), rel + ' 里有状态栏「有横幅」那一支的调用点（黄条下面那一行）')
}
const statusSrc = read(STATUSBAR_REL)
check(statusSrc.includes('[modalSeat, workspaceFileNoteEl(s), capsule]'), STATUSBAR_REL + ' 源里也有那一处调用点（产物里那两处不是从别处飘来的旧货）')
check(statusSrc.includes('stepBanner, workspaceFileNoteEl(s),'), STATUSBAR_REL + ' 源里另一处调用点也还在')

// ── F 反证：把翻译函数改坏，B 组对应的那几条必须当场红 ─────────────────────────────
console.log('')
console.log('== F 反证：把翻译函数改坏，B 组对应的那几条必须当场红 ==')
const noteFnFrom = function (srcText) {
  const expr = fnExprOf(srcText, 'workspaceFileNoteOf')
  if (!expr) return null
  return compileFn([], 'return ' + expr)()
}
{
  // F1 跳过也给人话 → B 组「跳过回空串」那几条当场红
  const broken = prefsSrc.replace("if (wf.skipped) return ''", "if (wf.skipped) return '已把这次选择写进工作区里的配置文件。'")
  check(broken !== prefsSrc, '反证 F1 的改法能在真源里落地（把「跳过回空串」那一行改成也给人话）')
  const n = broken !== prefsSrc ? noteFnFrom(broken) : null
  if (n) {
    const t = n({ ok: true, skipped: 'explicit-none' })
    check(t !== '', '反证 F1 成立：改坏之后跳过也给人话了（实得「' + t + '」）—— 说明 B 组那几条量的就是这一行')
  }
}
{
  // F2 覆盖那句不再说覆盖 → B 组「已覆盖要写明覆盖了原来那一条」当场红
  const broken = prefsSrc.replace('（覆盖了原来那一条）。', '。')
  check(broken !== prefsSrc, '反证 F2 的改法能在真源里落地（把「覆盖了原来那一条」那句删掉）')
  const n = broken !== prefsSrc ? noteFnFrom(broken) : null
  if (n) {
    const t = n({ ok: true, placed: true, reason: 'overwritten' })
    check(!looksOverwritten(t), '反证 F2 成立：改坏之后覆盖那句不再命中「写明覆盖了原来那一条」（实得「' + t + '」）')
  }
}
{
  // F3 失败那句不再提绑定照旧有效 → B 组「明说绑定照旧有效」当场红
  const broken = prefsSrc.replace('（绑定照旧有效，下次再选一次可以重试）', '（下次再选一次可以重试）')
  check(broken !== prefsSrc, '反证 F3 的改法能在真源里落地（把「绑定照旧有效」那句删掉）')
  const n = broken !== prefsSrc ? noteFnFrom(broken) : null
  if (n) {
    const t = n({ ok: false, error: { kind: 'env', message: '磁盘只读' } })
    check(!looksEnvFail(t), '反证 F3 成立：改坏之后失败那句不再命中「明说绑定照旧有效」（实得「' + t + '」）')
  }
}

console.log('')
console.log(failed
  ? '存在失败 — verify-workspace-file-note 未通过（' + passed + ' 项通过、' + failed + ' 项失败）'
  : '全部通过 — 工作区配置文件那一行门禁生效（' + passed + ' 项断言）')
process.exit(failed ? 1 : 0)
