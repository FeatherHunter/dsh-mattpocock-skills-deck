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
 *   A 宿主那一侧的形状：上面那几行返回字面量还在；这一段里 ok:true 的落点恰好四个（写成一处 +
 *     跳过三处，客户端要翻的就是这几个）；跳过今天仍只有那三个取值；另核一条客户端口径：
 *     宿主回包里 placed 那个布尔，客户端一个字都不看；
 *   B 五种回执翻出来的人话：已创建、已覆盖（要写明覆盖了原来那一条）、三种跳过（回空串，不打扰人）、
 *     环境失败（如实说没写进工作区，并明说绑定照旧有效）、没有结果（回空串）；
 *   C adoptBoundRev 把回执记进会话状态（回执在顶层 / 回执在 res.value 里 / 两个字段同时在时取哪一份 /
 *     没有回执 / 回包整个缺席）且仍然返回 null；
 *   D workspaceFileNoteEl 没有结果回 null；有结果但纯 node 里没有 h 时也回 null（不抛）；
 *     给它一个 h（假节点工厂）就回一个 div 节点，节点里写的正是翻译出来那句话；
 *   E 构建产物：根 client.js（dev 产物）与 package/lib/client.js（发布产物）里确实有 workspaceFileNoteEl
 *     的定义，状态栏里也确实调用了它 —— 证明「一源两物」的拼接真的生效，而不是只在源文件里躺着；
 *   F 反证（本轮重做）：把 B 组那批语义判据收成一个可复用函数（runNoteCases），在内存里把翻译函数
 *     改坏（跳过也给人话 / 覆盖那句不再说覆盖 / 失败那句不再提绑定照旧有效 / 已创建谎称覆盖），
 *     对每个变异体跑同一批判据，断言「至少有一条红」—— 证明 B 组量的就是这几行，不是走过场。
 *
 * 判据钉到什么程度（写清楚，免得以后有人以为改个措辞就得动这里）：
 *   只量「同一句话里必须出现的几组词」，不钉整句：句式、语序、标点、多加的客套话都能改。
 *   钉住的几组词（括号里是判据同样认的同义表达）：
 *     工作区 / 配置文件（或设置文件）/ 原来（或原有、原本）/ 覆盖（或换掉、换成）/ 绑定 /
 *     有效（或不受影响、照旧）；失败那一档还要有一处「没能 / 没有 / 没写 / 未写 / 没存 / 失败」。
 *   另钉两条相对判据：已创建与已覆盖不许说成同一句、失败那句与「已经写进去」那两句不许说成同一句。
 *   跳过与没有结果两档必须回空串（状态栏那一行不占位）。
 *   这六组词是「用户第一次读就能看懂」的底线；要换说法，就连这里的判据一起改，别让门禁对着旧措辞发光。
 *
 * 本轮（对抗审查之后）改了什么，留给下一个人看：
 *   1) F 组重做：原来那三条「反证成立」是恒真的（锚里就含判据要找的词、替换文本必然非空），
 *      而且锚找不到时被 if (n) 静默跳过、门禁照样打印全过。现在改用同一批语义判据跑变异体，
 *      锚找不到走 SKIP，末尾有一条「跳过数必须为 0」把它算成红；
 *   2) E 组不再冻结展示位置：只要求状态栏里「至少有一处」调用点、产物里也带着同一处调用；
 *      挪位置、换容器、调顺序都不用改门禁；
 *   3) 条件断言改成取不到就红（D 组那五条原来躲在 if (elFnExpr) 里），末尾另有一条
 *      「断言条数恰为预期总数」兜住将来有人再加 if 又忘了报账。
 *
 * 两种取值路线，哪一条走哪种方式（实测结论写在这里，照做即可）：
 *   1) 行为断言（B/C/D 里凡是量真模块行为的那几条）走**真模块直接 import**：本文件是 ESM，用 import()
 *      取 src/client/kernel/store-prefs.js 的真身。实测（node v24.19.0，本仓 package.json 没有
 *      "type":"module"）导入**不抛**：它顶层的 window/localStorage 访问全都在 try 里
 *      （DEFAULT_PANEL_H / listPrefs / labelClicks / bannerFoldByCwd 那几段），拿不到就降级；
 *      Node 按语法探测把这些没声明类型的 .js 重新当 ESM 解析，同一进程里只打一条
 *      MODULE_TYPELESS_PACKAGE_JSON 警告（实测落在本门禁文件自己身上）—— 那条只是提醒加载方式，
 *      不改断言结论，tests/ 下既有的 ESM 门禁同样吃这条。所以这里不退回「只读文本断言」。
 *   2) 需要「有 h 的那一支」与「改坏之后必须红」这两处，按文本求值：走 tests/lib/eval-probe.js 的
 *      compileFn（与 tests/verify-683-choice-rev.js 对同一个文件的做法一致），把真身函数文本连同
 *      参数名（h / workspaceFileNoteOf）一起求值，仓库里不新增裸 eval 点。
 *
 * 用法：node tests/verify-workspace-file-note.js
 *   产物那几条（E 组）要求先跑 node scripts/build.mjs；源码改过而产物没重建时，E 组会红并提示重跑构建。
 *   本门禁还没挂进 package.json 的 scripts.verify 链（本票只允许新建这一个文件，不碰既有文件）；
 *   要挂的统筹者照 tests/verify-gitlab-single-write.js 的做法加一节 `node tests/verify-workspace-file-note.js` 即可。
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
// 「这一条跑不了」的计数：锚找不到、真身取不出这类情形走这里，末尾有一条断言要求它必须是 0。
//   不这么办的话，门禁会一边少跑判据、一边打印全过（上一版 F 组的毛病）。
let skipped = 0
const check = (ok, msg) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }
const skip = (msg) => { console.log('  SKIP ' + msg); skipped++ }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

const prefsSrc = read(PREFS_REL)
const hostSrc = read(HOST_REL)

// 宿主那一侧今天只算这三个跳过取值（下面 A 组会去源文件里核对，B 组按核对结果逐个喂给翻译函数）。
const DOCUMENTED_SKIPS = ['explicit-none', 'unregistered', 'registry-unavailable']

// 判据认的同义表达：写成数组，命中任意一个就算有这层意思（理由见文件头「判据钉到什么程度」）。
const W_WORKSPACE = ['工作区']
const W_CONFIG_FILE = ['配置文件', '设置文件']
const W_COVER = ['覆盖', '换掉', '换成']
const W_ORIGINAL = ['原来', '原有', '原本']
const W_BIND = ['绑定']
const W_STILL_OK = ['有效', '不受影响', '照旧']
const RE_NOT_WRITTEN = /(没能|没有|没写|未写|没存|失败)/
const anyOf = (t, words) => words.some((w) => t.includes(w))
const isSentence = (t) => typeof t === 'string' && t !== ''
//   已创建：说得清是写进了工作区里的配置文件，且不许谎称覆盖。
const looksCreated = (t) => isSentence(t) && anyOf(t, W_WORKSPACE) && anyOf(t, W_CONFIG_FILE) && !anyOf(t, W_COVER)
//   已覆盖：必须写明覆盖了原来那一条（与「已创建」区分开）。
const looksOverwritten = (t) => isSentence(t) && anyOf(t, W_WORKSPACE) && anyOf(t, W_COVER) && anyOf(t, W_ORIGINAL)
//   环境失败：如实说没写进工作区，并明说绑定照旧有效（用户别以为绑定也跟着废了）。
const looksEnvFail = (t) => isSentence(t) && anyOf(t, W_WORKSPACE) && RE_NOT_WRITTEN.test(t) && anyOf(t, W_BIND) && anyOf(t, W_STILL_OK)

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
// 闭合性：这一段里 ok:true 的落点要恰好四个 —— 写成一处（带 placed）加跳过三处，客户端翻的就是这四个；
//   多出第五个（例如新增一档「没写成但也算 ok」）就说明客户端那边少翻了一句，这里先红。
const okTrueSites = (hostBindBody.match(/return\s*\{\s*ok:\s*true\s*,/g) || []).length
check(
  okTrueSites === 4,
  '这一段里 ok:true 的落点恰好四个（写成一处 + 跳过' + hostSkips.length + '处；实得 ' + okTrueSites + ' 处 —— 少一个说明聚合口径变了，多一个说明客户端那边少翻了一档）',
)
check(
  okTrueSites === hostSkips.length + 1,
  '四个 ok:true 落点 = 三处跳过 + 一处写成（跳过取值 ' + hostSkips.length + ' 个、写成落点 1 个、实测 ok:true 共 ' + okTrueSites + ' 个）—— 两边对得上，说明没有第五种 ok:true 形态漏在客户端视野外',
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

// ── A 续：客户端不看 placed（宿主回包里的那个布尔改不改，都不该动这一行显示的话）──────────
console.log('')
console.log('== A 续 客户端不看 placed（写成那一档回包里的布尔，翻人话时用不上）==')
const noteCreated = noteOf({ ok: true, placed: true, reason: 'created' })
{
  // 三种喂法：给 true、给 false、干脆不给这一项。翻出来的话必须一模一样 ——
  //   也就是说客户端判「写进去了」靠的是 reason（宿主只在写成那一档给），不是 placed。
  const withFalse = noteOf({ ok: true, placed: false, reason: 'created' })
  const withoutIt = noteOf({ ok: true, reason: 'created' })
  check(
    noteCreated === withFalse && noteCreated === withoutIt,
    '客户端不看 placed：这一项给 true、给 false、不给，翻出来的都是同一句（三种实得「' + noteCreated + '」/「' + withFalse + '」/「' + withoutIt + '」）',
  )
}

// ── B 五种回执翻出来的人话 ──────────────────────────────────────────────────────
// B 组那批语义判据写成一张可复用的清单：每一条 = { name, wf（喂进去的回执）, ok(t, say) }。
//   t 是这个回执翻出来的话；say(另一个回执) 是同批里另一条翻出来的话（用来量「两句不许合并成一句」）。
//   「跳过」那几条按 skipValues 现场生成：宿主今天只有三个取值（A 组已核对），万一多出一种，
//   这里跟着多测一条翻译，不用等人想起来改门禁。
const buildNoteCases = function (skipValues) {
  const cases = [
    { name: '已创建：回一句人话，说清了是写进工作区里的配置文件，且不谎称覆盖', wf: { ok: true, placed: true, reason: 'created' }, ok: (t) => looksCreated(t) },
    { name: '已覆盖：写明覆盖了原来那一条', wf: { ok: true, placed: true, reason: 'overwritten' }, ok: (t) => looksOverwritten(t) },
    { name: '已覆盖与已创建不是同一句（覆盖那条多说了「原来那条被换掉」）', wf: { ok: true, placed: true, reason: 'overwritten' }, ok: (t, say) => t !== say({ ok: true, placed: true, reason: 'created' }) },
  ]
  for (const v of skipValues) {
    cases.push({ name: '跳过（' + v + '）回空串 —— 正常不做，不打扰人', wf: { ok: true, skipped: v }, ok: (t) => t === '' })
  }
  cases.push(
    { name: '环境失败：如实说没写进工作区，并明说绑定照旧有效', wf: { ok: false, error: { kind: 'env', message: '磁盘只读，写不进去' } }, ok: (t) => looksEnvFail(t) },
    { name: '环境失败那句与「已经写进去」那两句不是同一句（不许把没写成说成写成了）', wf: { ok: false, error: { kind: 'env', message: '磁盘只读，写不进去' } }, ok: (t, say) => t !== say({ ok: true, placed: true, reason: 'created' }) && t !== say({ ok: true, placed: true, reason: 'overwritten' }) },
    { name: '回包只给了 ok:false、没带 error 细节时，说的还是同一句失败话（失败就是失败，不因为没有细节就闭嘴）', wf: { ok: false }, ok: (t, say) => t === say({ ok: false, error: { kind: 'env', message: '磁盘只读，写不进去' } }) },
  )
  for (const c of [['null', null], ['undefined', undefined], ['空串', ''], ['不是对象的东西', 'x']]) {
    cases.push({ name: '没有结果（' + c[0] + '）回空串 —— 状态栏那一行不占位', wf: c[1], ok: (t) => t === '' })
  }
  return cases
}
// 对任何一个「回执 → 人话」的函数跑完整批，回一份 { name, t, ok } 清单。
//   B 组拿真函数跑一次、逐条打印；F 组拿内存里改坏的变异体跑同一批，只看「有没有红」。
const runNoteCases = function (noteFn) {
  const say = (wf) => {
    try {
      const t = noteFn(wf)
      return typeof t === 'string' ? t : '<<不是字符串：' + JSON.stringify(t) + '>>'
    } catch (e) { return '<<抛错：' + String((e && e.message) || e) + '>>' }
  }
  return NOTE_CASES.map(function (c) {
    const t = say(c.wf)
    let ok = false
    try { ok = c.ok(t, say) === true } catch (e) { ok = false }
    return { name: c.name, t: t, ok: ok }
  })
}
console.log('')
console.log('== B 五种回执翻出来的人话 ==')
const skipValues = Array.from(new Set(DOCUMENTED_SKIPS.concat(hostSkips))).sort()
const NOTE_CASES = buildNoteCases(skipValues)
// 固定 10 条：已创建 1 + 已覆盖 2（像不像、句不同）+ 环境失败 2（像不像、句不同）+ 只给 ok:false 1 + 没有结果 4。
const FIXED_CASE_COUNT = 10
check(
  NOTE_CASES.length === FIXED_CASE_COUNT + skipValues.length,
  'B 组判据条数与回执档位对得上（固定 ' + FIXED_CASE_COUNT + ' 条 + 跳过 ' + skipValues.length + ' 档 = 实得 ' + NOTE_CASES.length + ' 条；少一条就说明这批判据被人删过，F 组拿的是同一批，也会跟着变弱）',
)
const casesB = runNoteCases(noteOf)
for (const c of casesB) check(c.ok, c.name + '（实得「' + c.t + '」）')

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
  // 下面五条按对抗审查补：回包整个缺席（null / undefined 两种写法）、两个字段同时在时取哪一份、
  //   以及顶层显式为 null 时的两种去向。
  const st4 = { workspaceFileResult: receipt }
  const r4 = adoptBoundRev(st4, null)
  check(r4 === null && st4.workspaceFileResult === null, '回包整个是 null（连 res 都没有）：记 null、回 null，不抛错（上一次那句也清掉了）')
  const st5 = { workspaceFileResult: receipt }
  const r5 = adoptBoundRev(st5, undefined)
  check(r5 === null && st5.workspaceFileResult === null, '回包是 undefined：同样记 null、回 null，不抛错')
  const envelopeReceipt = { ok: true, placed: true, reason: 'overwritten' }
  const st6 = {}
  adoptBoundRev(st6, { ok: true, workspaceFile: receipt, value: { ok: true, workspaceFile: envelopeReceipt } })
  check(st6.workspaceFileResult === receipt, '两个字段同时带着回执时取顶层那一份（res.workspaceFile 是宿主回包的正式位置，信封里那份只在顶层没带时兜底）')
  const st7 = {}
  adoptBoundRev(st7, { ok: true, workspaceFile: null, value: { ok: true, workspaceFile: envelopeReceipt } })
  check(
    st7.workspaceFileResult === envelopeReceipt,
    '顶层 workspaceFile 是 null、信封里有值时：null 按「这一项没带」处理，照信封里那一份记（实现在 store-prefs.js 里是 `res.workspaceFile || res.value.workspaceFile`；'
    + '要改成「顶层给了 null 就表示确实没有、不再看信封」，动的是那一行，这条断言会跟着红）',
  )
  const st8 = { workspaceFileResult: receipt }
  adoptBoundRev(st8, { ok: true, workspaceFile: null, value: { ok: true } })
  check(st8.workspaceFileResult === null, '顶层是 null、信封里也没有这一项：按无回执处理，记 null（不留下上一次那句）')
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
//   取不到函数表达式就直接红：下面五条拿到的会是一个「跑不了」的标记，条条红，不再静默跳过。
const fakeH = (tag, props, children) => ({ tag: tag, props: props, children: children })
const elFnExpr = fnExprOf(prefsSrc, 'workspaceFileNoteEl')
check(elFnExpr !== '', '从真源里整段取到 workspaceFileNoteEl 的函数表达式（取不到就红；下面五条拿不到真身，会跟着一起红 —— 上一版这里是个 if，静默跳过还打印全过）')
const callWithH = (function () {
  if (!elFnExpr) return function () { return '<<没取到 workspaceFileNoteEl 的函数表达式，这一条跑不了>>' }
  const withH = compileFn(['h', 'workspaceFileNoteOf'], 'return ' + elFnExpr)(fakeH, noteOf)
  return function (s) {
    try { return withH(s) } catch (e) { return '<<抛错：' + String((e && e.message) || e) + '>>' }
  }
})()
const nodeWithH = callWithH({ workspaceFileResult: { ok: true, placed: true, reason: 'created' } })
check(!!nodeWithH && nodeWithH.tag === 'div', '给它一个 h 就回一个 div 节点（状态栏那一行小灰字）—— 实得 ' + JSON.stringify(nodeWithH && nodeWithH.tag))
check(!!nodeWithH && nodeWithH.children === noteCreated, '节点里写的正是翻译出来那句话（实得「' + (nodeWithH && nodeWithH.children) + '」）')
check(!!nodeWithH && !!nodeWithH.props && !!nodeWithH.props.style, '回的那个节点自带 style（这一行怎么显示它自己说清，不靠调用方补样式）')
check(callWithH({ workspaceFileResult: { ok: true, skipped: 'explicit-none' } }) === null, '有 h 时跳过那一档照旧回 null（跳过就是不占位）')
check(callWithH({}) === null, '有 h 时没有结果照旧回 null')

// ── E 构建产物：拼接真的生效（定义与调用点都在产物里）─────────────────────────────
console.log('')
console.log('== E 构建产物：一源两物的拼接真的生效 ==')
// 调用点只要求「挂上了」，**不冻结展示位置**：这一行放胶囊上方还是黄条下方、包在哪个容器里、
//   排在第几个，都属于展示形态，挪位置/换容器/调顺序都不用改这里；只要状态栏还在调用它，
//   产物里就该带着同一处调用。要冻结展示位置的话，先当产品决定写下来，再加断言。
const statusSrc = read(STATUSBAR_REL)
const srcSites = (statusSrc.match(/workspaceFileNoteEl\(s\)/g) || []).length
const firstSite = ((statusSrc.match(/[^\n]*workspaceFileNoteEl\(s\)[^\n]*/) || [''])[0]).trim()
check(
  srcSites >= 1,
  STATUSBAR_REL + ' 里至少有一处调用点（实得 ' + srcSites + ' 处；第一处是「' + firstSite.slice(0, 60) + '…」）',
)
for (const rel of ARTIFACTS) {
  if (!exists(rel)) {
    check(false, rel + ' 存在（缺了就先跑 node scripts/build.mjs；本仓没有 src/client/client.js 这个文件，产物真路径就是这两个）')
    continue
  }
  const txt = read(rel)
  check(/const workspaceFileNoteEl = function \(s\) \{/.test(txt), rel + ' 里有 workspaceFileNoteEl 的定义（内核那一片被拼进来了）')
  check(!/export const workspaceFileNoteEl/.test(txt), rel + ' 里那一行开头不再带 export（拼接时按约定去掉了行首 export，说明它确实走的是拼接这条路）')
  check(/const txt = \(s && s\.workspaceFileResult\) \? workspaceFileNoteOf\(s\.workspaceFileResult\) : ''/.test(txt), rel + ' 里那一行读的是会话状态里的 workspaceFileResult')
  const sites = (txt.match(/workspaceFileNoteEl\(s\)/g) || []).length
  check(sites >= 1, rel + ' 里至少有一处调用点（实得 ' + sites + ' 处；不冻结展示位置 —— 状态栏换了个位置放它也是过，只要还调用它）')
}

// ── F 反证：改坏翻译函数，B 组那批判据必须当场红（本轮重做）────────────────────────
console.log('')
console.log('== F 反证：把翻译函数改坏，B 组同一批判据必须当场红 ==')
const noteFnFrom = function (srcText) {
  const expr = fnExprOf(srcText, 'workspaceFileNoteOf')
  if (!expr) return null
  try { return compileFn([], 'return ' + expr)() } catch (e) { return null }
}
// 每个变异体只在真源文本上改一处，改完求值成函数，喂 B 组那同一批语义判据（runNoteCases）。
//   红一条就算反证成立。锚找不到走 SKIP（源码改过措辞就会这样），末尾「跳过数必须为 0」会把它算成红 ——
//   不再用「替换文本必然非空」这种恒真的话当结论。
const MUTANTS = [
  {
    name: 'F1 跳过也给人话（把「跳过回空串」那一行改成也说写进去了）',
    from: "if (wf.skipped) return ''",
    to: "if (wf.skipped) return '已把这次选择写进工作区里的配置文件。'",
  },
  {
    name: 'F2 覆盖那句不再说覆盖（把「覆盖了原来那一条」删掉）',
    from: '（覆盖了原来那一条）。',
    to: '。',
  },
  {
    name: 'F3 失败那句不再提绑定照旧有效（把「绑定照旧有效」删掉）',
    from: '（绑定照旧有效，下次再选一次可以重试）',
    to: '（下次再选一次可以重试）',
  },
  {
    name: 'F4 已创建谎称覆盖（把那句加上「覆盖了原来那一条」）',
    from: "return '已把这次选择写进工作区里的配置文件。'",
    to: "return '已把这次选择写进工作区里的配置文件（覆盖了原来那一条）。'",
  },
]
const redNames = new Set()
for (const m of MUTANTS) {
  const mutated = prefsSrc.split(m.from).join(m.to)
  if (mutated === prefsSrc) { skip('反证 ' + m.name + '：真源里找不到那段锚（' + m.from + '），这一条跑不了'); continue }
  const fn = noteFnFrom(mutated)
  if (typeof fn !== 'function') { skip('反证 ' + m.name + '：改过的源里取不出 workspaceFileNoteOf 的函数体，这一条跑不了'); continue }
  const red = runNoteCases(fn).filter((c) => !c.ok)
  for (const c of red) redNames.add(c.name)
  check(
    red.length >= 1,
    '反证 ' + m.name + '：B 组同一批判据在改坏的翻译函数上当场红（实红 ' + red.length + ' 条：' + red.map((c) => c.name).join('；') + '）',
  )
}
check(
  redNames.size >= 3,
  '几个变异体合起来至少掀红 3 条不同判据（实得 ' + redNames.size + ' 条 —— 说明 B 组那批不是一条判据在撑场面）',
)

// ── 收尾两道闸：不许静默跳过、不许漏跑断言 ─────────────────────────────────────────
//   前者防的是「锚找不到就 if 掉」（上一版 F 组的毛病），输出里带 SKIP 的行就是它；
//   后者防的是将来有人又加了个 if 把几条断言包起来、末尾还照旧打印全过。
console.log('')
check(skipped === 0, '本次没有一条判据因为「找不到锚 / 取不出真身」被跳过（实测跳过 ' + skipped + ' 条 —— 跳过一律在这里算红）')
// 上面所有 check 的条数 + 这一条自身 = 预期总数（下面这条自己也算一条，所以用 +1）。
const TOTAL_ASSERTIONS = 65
check(
  passed + failed + 1 === TOTAL_ASSERTIONS,
  '断言条数恰为预期总数（预期 ' + TOTAL_ASSERTIONS + ' 条，实得 ' + (passed + failed + 1) + ' 条 —— 对不上说明有断言被条件语句挡掉了）',
)

console.log('')
console.log(failed
  ? '存在失败 — verify-workspace-file-note 未通过（' + passed + ' 项通过、' + failed + ' 项失败、' + skipped + ' 项跳过）'
  : '全部通过 — 工作区配置文件那一行门禁生效（' + passed + ' 项断言' + (skipped ? '、' + skipped + ' 项跳过' : '') + '）')
process.exit(failed ? 1 : 0)
