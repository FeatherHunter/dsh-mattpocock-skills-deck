#!/usr/bin/env node
/**
 * verify-workspace-file-note.js —— #1012 客户端那一行「工作区配置文件写成什么样」的门禁。
 *
 * 这一行是干什么的：用户在门控窗（或切换弹窗）点确认之后，宿主会先把这次选择写进工作区配置文件
 *   （写成功才算这次选择生效），再把写入结果回给客户端；客户端把它记进会话状态，并在状态栏里
 *   如实显示一句话。宿主那一侧只算两种结果（见 src/host/workspaceCwd.js 的 writeWorkspaceRecord）：
 *     写成  { ok:true, placed:true, reason:'created' | 'overwritten' }
 *     没写成 { ok:false, error:{ kind:'env', reason, message } }（这次选择没有生效，主线提示会说清）
 *   #1138 改口径：以前「跳过」（没有后端、后端没注册、注册表问不到）也是一档 ok:true + skipped，
 *   今天这三种情况都不再静默跳过 —— 前一种根本记不下来，后两种当场如实报失败，所以宿主不再回
 *   带 skipped 的回执，本门禁也不再为那一档生成判据。
 *   客户端那一侧只负责把这份回执翻成人话，不重算判断（见 src/client/kernel/store-prefs.js 的
 *   workspaceFileNoteOf / workspaceFileNoteEl / adoptBoundRev）。
 *
 * 本门禁量四件事（组号沿用下面各节的标题）：
 *   B 回执翻出来的人话：已创建、已覆盖（要写明覆盖了原来那一条）、
 *     没写成（回空串 —— 那次失败由主线提示一条说清，这一行不再另说一遍，免得同一件事说两遍
 *     还让人以为「虽然报错但其实成了」）、没有结果（回空串）；
 *   C adoptBoundRev 把回执记进会话状态（回执在顶层 / 回执在 res.value 里 / 两个字段同时在时取哪一份 /
 *     没有回执 / 回包整个缺席）且仍然返回 null；
 *   D workspaceFileNoteEl 没有结果回 null；有结果但纯 node 里没有 h 时也回 null（不抛）；
 *     给它一个 h（假节点工厂）就回一个 div 节点，节点里写的正是翻译出来那句话；
 *   F 反证（本轮重做）：把 B 组那批语义判据收成一个可复用函数（runNoteCases），拿真模块里那个真身
 *     翻译函数包一层、在运行时按回执的字段改坏一处（没写成也说成写成了 / 覆盖那句不再说覆盖 /
 *     没写成还硬说一句 / 已创建谎称覆盖），对每个变异体跑同一批判据，断言「至少有一条红」——
 *     证明 B 组量的就是这几行，不是走过场。四个变异体都不碰真源文本、不依赖任何整句原文锚，
 *     所以真源换措辞（比如把「配置文件」说成「设置文件」）既不会让这一组丢锚，也不会让它假过。
 *
 * 判据钉到什么程度（写清楚，免得以后有人以为改个措辞就得动这里）：
 *   只量「同一句话里必须出现的几组词」，不钉整句：句式、语序、标点、多加的客套话都能改。
 *   钉住的几组词（括号里是判据同样认的同义表达）：
 *     工作区 / 配置文件（或设置文件）/ 原来（或原有、原本）/ 覆盖（或换掉、换成）。
 *   另钉两条相对判据：已创建与已覆盖不许说成同一句、没写成那一档（回空串）与「已经写进去」那两句
 *   不许说成同一句。
 *   没有结果与「没写成」两档必须回空串（状态栏那一行不占位：那次失败由主线提示一条说清）。
 *   上面这些只约束「意思」，不约束原文：F 组那四个变异体就是照这个口径写的 —— 它们只认回执的字段名，
 *   不认真源里的整句话，所以真源改措辞不用跟着动 F 组。
 *
 * 本轮（第二次对抗复核之后）改了什么，留给下一个人看：
 *   1) F 组不再对真源文本做字符串替换。上一版四个变异体各自钉一句整句原文当锚，锚找不到就 SKIP；
 *      可实测把真源里「配置文件」换成「设置文件」、把覆盖那句换成同义说法之后，B 组判据仍全绿，
 *      F 组却丢锚报红 —— 这与文件头「句式、语序、标点都能改」自相矛盾。现在四个变异体一律拿
 *      真身函数（真 import 出来的 workspaceFileNoteOf）包一层，按回执字段改坏某一档的说法，
 *      真源措辞怎么改都不丢锚；
 *   2) 给真源函数文本求值那条路（D 组「有 h 的那一支」）补上 try/catch 与形状校验。上一版这里没有兜底：
 *      真源里那个函数被压成一行时，非贪婪正则一路吞到后面另一个函数的收尾括号，先打印一条 PASS
 *      「取到函数表达式」，紧接着 SyntaxError 把整个进程带崩，收尾两道闸都跑不到。现在取不到函数体、
 *      切出来的文本形状不对、求值抛错，三种情形都按红报，并各给一句完整中文理由；
 *      顺带补了同一种崩法的另一处：真源把这三个导出名改掉/删掉时，B/C/D 三组会崩在「拿 undefined
 *      当函数调」上，现在也当场按红退出（正常路径不多不少一条断言）；
 *   3) 更早两轮的改动（留着看）：F 组原来那三条「反证成立」是恒真的（锚里就含判据要找的词、替换文本
 *      必然非空），所以改成跑同一批语义判据；条件断言改成取不到就红，末尾另有一条「断言条数恰为预期
 *      总数」兜住将来有人再加 if 又忘了报账。
 *   4) 清掉一切「读源码文本钉形状」的判据（仓库维护口径：这类门禁会因为等价重构 —— 改写法、搬文件、
 *      改注释 —— 而变红，浪费人的时间）：删掉 A 组（宿主返回字面量、这一段里 ok:true 的落点数、跳过
 *      三个取值去源文件核对、请求/回包字段名的正则）与 E 组（状态栏里有没有调用点、两个构建产物里有没有
 *      定义/调用、有没有去掉行首 export）两组纯文本判据，另删掉「翻译函数的函数体里不出现 placed」
 *      那一条。跳过那三个取值仍列在下面的 DOCUMENTED_SKIPS 里，只是不再去源文件核对了。抠真源文本
 *      求值那条路（D 组「有 h 的那一支」）与 B/C/F 三组的行为判据一条没动。
 *   5) #1138（2026-10-14）改口径：宿主不再回「跳过」那一档（今天没有后端名就根本记不下来 —— 如实报失败；
 *      后端没注册也是如实报失败；注册表拿不到同理），写不成也不再回 ok。所以本门禁把「跳过三种」那三档
 *      判据换成「没写成」那一档：翻译函数必须回空串（那次失败由主线提示说清，这一行再说一遍反而像是
 *      「虽然报错但其实成了」），并把 F 组第一个变异体从「跳过也给人话」改成「没写成也说成写成了」。
 *
 * 两种取值路线，哪一条走哪种方式（实测结论写在这里，照做即可）：
 *   1) 行为断言（B/C/D 里凡是量真模块行为的那几条）走**真模块直接 import**：本文件是 ESM，用 import()
 *      取 src/client/kernel/store-prefs.js 的真身。实测（node v24.19.0，本仓 package.json 没有
 *      "type":"module"）导入**不抛**：它顶层的 window/localStorage 访问全都在 try 里
 *      （DEFAULT_PANEL_H / listPrefs / labelClicks / bannerFoldByCwd 那几段），拿不到就降级；
 *      Node 按语法探测把这些没声明类型的 .js 重新当 ESM 解析，同一进程里只打一条
 *      MODULE_TYPELESS_PACKAGE_JSON 警告（实测落在本门禁文件自己身上）—— 那条只是提醒加载方式，
 *      不改断言结论，tests/ 下既有的 ESM 门禁同样吃这条。所以这里不退回「只读文本断言」。
 *   2) 需要「有 h 的那一支」这一处，按文本求值：走 tests/lib/eval-probe.js 的 compileFn（与
 *      tests/verify-683-choice-rev.js 对同一个文件的做法一致），把真身函数文本连同参数名
 *      （h / workspaceFileNoteOf）一起求值，仓库里不新增裸 eval 点。求值本身包在 try/catch 里，
 *      取不到函数体或求值抛错都按红报（见 D 组）。F 组不走这条路：它要的是真身函数本身，
 *      直接拿上面 import 进来的那个 —— 改回按文本求值，等于又把真源措辞请回来当依赖。
 *
 * 用法：node tests/verify-workspace-file-note.js
 *   本门禁已按目录约定自动进 verify 链（#1125；跑法见 scripts/verify-chain.js），
 *   也可以单跑：node tests/verify-workspace-file-note.js。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
// 按文本求值统一走共用入口 compileFn（理由与用法见 tests/lib/eval-probe.js 文件头）。
import { compileFn } from './lib/eval-probe.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const PREFS_REL = 'src/client/kernel/store-prefs.js'

let passed = 0
let failed = 0
// 「这一条跑不了」的计数：留给「判据确实没法跑」的情形，末尾有一条断言要求它必须是 0。
//   本文件今天已经没有一处调用 skip()：F 组改成包真身之后没有锚可丢，D 组取不到函数体按红报。
//   计数与末尾那道闸留着当规矩 —— 以后谁再想让某条判据「跑不了就算了」，它会在收尾处被算成红。
let skipped = 0
const check = (ok, msg) => { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }
const skip = (msg) => { console.log('  SKIP ' + msg); skipped++ }
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const prefsSrc = read(PREFS_REL)

// #1138：宿主今天不再回「跳过」那一档（那三种情况都不再静默跳过：没有后端名根本记不下来，如实报失败；
//   后端没注册、注册表拿不到同理，也是如实报失败）。所以这里不再有「跳过取值」这份名单，
//   B 组也不再为那一档生成判据 —— 改成「没写成」那一档：翻译函数回空串，那一行不占位。

// 判据认的同义表达：写成数组，命中任意一个就算有这层意思（理由见文件头「判据钉到什么程度」）。
const W_WORKSPACE = ['工作区']
const W_CONFIG_FILE = ['配置文件', '设置文件']
const W_COVER = ['覆盖', '换掉', '换成']
const W_ORIGINAL = ['原来', '原有', '原本']
const anyOf = (t, words) => words.some((w) => t.includes(w))
const isSentence = (t) => typeof t === 'string' && t !== ''
//   已创建：说得清是写进了工作区里的配置文件，且不许谎称覆盖。
const looksCreated = (t) => isSentence(t) && anyOf(t, W_WORKSPACE) && anyOf(t, W_CONFIG_FILE) && !anyOf(t, W_COVER)
//   已覆盖：必须写明覆盖了原来那一条（与「已创建」区分开）。
const looksOverwritten = (t) => isSentence(t) && anyOf(t, W_WORKSPACE) && anyOf(t, W_COVER) && anyOf(t, W_ORIGINAL)
//   没写成：期望空串。为什么不再由这一行说「没写进去、绑定照旧有效」——见函数头注释（#1138）：
//   那次失败由主线那条提示一条说清；再说一遍既重复，又容易让人以为「虽然报错但其实成了」。

// 从真源里整段取出一个函数表达式（`export const 名字 = function (...) { ... }` 的 `function ...` 那一段）。
//   写法与 tests/verify-683-choice-rev.js 取 currentBackendId 时同例：非贪婪取到行首四个空格那个闭括号。
const fnExprOf = function (srcText, name) {
  const re = new RegExp('export const ' + name + ' = (function \\([^)]*\\) \\{[\\s\\S]*?\\n    \\})')
  const m = srcText.match(re)
  return m ? m[1] : ''
}

console.log('工作区配置文件那一行门禁（#1012：绑定回执里「写进工作区配置文件」的结果翻成人话）')

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
// 这三个名字缺一个，下面 B/C/D 三组会直接崩在「拿 undefined 当函数调」上：栈一长串，看不出是哪扇门坏了，
//   收尾两道闸也跑不到。所以跟上面导入失败那条路一样处理：把话说清、按红退出，不再往下跑。
//   （这一条只在真源把导出名改掉/删掉时才会走到，正常路径一条断言都不多不少。）
const missingExports = ['adoptBoundRev', 'workspaceFileNoteOf', 'workspaceFileNoteEl'].filter((name) => typeof prefs[name] !== 'function')
if (missingExports.length) {
  console.log('')
  console.log('  FAIL 真模块缺少导出：' + missingExports.join('、') + ' —— B/C/D 三组都要直接调它们，缺一个就没法往下量。')
  console.log('       先确认这三个名字还在 ' + PREFS_REL + ' 里导出（一源两物的那一源），再跑本门禁。')
  console.log('')
  console.log('存在失败 — verify-workspace-file-note 未通过（' + passed + ' 项通过、' + (failed + 1) + ' 项失败）')
  process.exit(1)
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
//   「跳过」那几条按 skipValues 现场生成：宿主今天只算那三个取值，万一多出一种，
//   这里跟着多测一条翻译，不用等人想起来改门禁。
const buildNoteCases = function () {
  const cases = [
    { name: '已创建：回一句人话，说清了是写进工作区里的配置文件，且不谎称覆盖', wf: { ok: true, placed: true, reason: 'created' }, ok: (t) => looksCreated(t) },
    { name: '已覆盖：写明覆盖了原来那一条', wf: { ok: true, placed: true, reason: 'overwritten' }, ok: (t) => looksOverwritten(t) },
    { name: '已覆盖与已创建不是同一句（覆盖那条多说了「原来那条被换掉」）', wf: { ok: true, placed: true, reason: 'overwritten' }, ok: (t, say) => t !== say({ ok: true, placed: true, reason: 'created' }) },
  ]
  cases.push(
    { name: '没写成（带原因）：回空串 —— 那次失败由主线提示一条说清，这一行不再另说一遍', wf: { ok: false, error: { kind: 'env', reason: 'readonly', message: '磁盘只读，写不进去' } }, ok: (t) => t === '' },
    { name: '没写成（回包只给 ok:false、没带原因细节）：同样回空串（不因为没有细节就在这一行另说一句）', wf: { ok: false }, ok: (t) => t === '' },
    { name: '没写成那一档与「已经写进去」那两句都不是同一句（不许把没写成说成写成了）', wf: { ok: false, error: { kind: 'env', message: '磁盘只读，写不进去' } }, ok: (t, say) => t !== say({ ok: true, placed: true, reason: 'created' }) && t !== say({ ok: true, placed: true, reason: 'overwritten' }) },
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
console.log('== B 回执翻出来的人话 ==')
const NOTE_CASES = buildNoteCases()
// 固定 10 条：已创建 1 + 已覆盖 2（像不像、句不同）+ 没写成 3（回空串 2 条、与成功那两句不同 1 条）+ 没有结果 4。
const FIXED_CASE_COUNT = 10
check(
  NOTE_CASES.length === FIXED_CASE_COUNT,
  'B 组判据条数与回执档位对得上（固定 ' + FIXED_CASE_COUNT + ' 条 = 实得 ' + NOTE_CASES.length + ' 条；少一条就说明这批判据被人删过，F 组拿的是同一批，也会跟着变弱）',
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
    + '要改成「顶层给了 null 就表示确实没有、不再看信封」，动的是那一行，这条断言会跟着红）。'
    + '这一条量的是防御性边界，不是宿主回包的协议形状：宿主只会二选一 —— 要么顶层直接带 workspaceFile，要么整个回包装在 value 信封里，'
    + '两种形状不会同时出现（真同时出现时取哪一份，看上一条）。这里钉的是那行 `||` 的取舍，免得以后有人顺手把它写死成「顶层有键就不看信封」时没人察觉',
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
check(noteEl({ workspaceFileResult: { ok: false, error: { kind: 'env', message: '写不进去' } } }) === null, '没写成那一档翻出来是空串，所以同样回 null（那次失败由主线提示说，这一行不占位）')
let elThrew = null
let elInNode = 'unset'
try { elInNode = noteEl({ workspaceFileResult: { ok: true, placed: true, reason: 'created' } }) } catch (e) { elThrew = e }
check(elThrew === null, '纯 node 里调用「有结果」那一支不抛错（闭包里的 h 拿不到时被 catch 兜住）' + (elThrew ? '：' + String(elThrew.message || elThrew) : ''))
check(elInNode === null, '纯 node 里没有 h，落到 catch 回 null —— 这一条钉的就是「页面外调用不得炸」（实得 ' + JSON.stringify(elInNode) + '）')
// 有结果且有译文时该回一个节点：纯 node 里没有 h，这一支走不到，改用真身文本 + 假 h（路线 2）。
//   取不到函数体、切出来的文本形状不对、求值抛错，三种情形都按红报，各给一句完整的中文理由；
//   下面五条此时拿到的是一个「跑不了」的标记，跟着一起红 —— 不再静默跳过，也不让 SyntaxError 把进程带崩。
const fakeH = (tag, props, children) => ({ tag: tag, props: props, children: children })
const elFnExpr = fnExprOf(prefsSrc, 'workspaceFileNoteEl')
check(elFnExpr !== '', '从真源里整段取到 workspaceFileNoteEl 的函数表达式（取不到就红；下面五条拿不到真身，会跟着一起红 —— 上一版这里是个 if，静默跳过还打印全过）')
// 形状校验：切出来的必须**只有一个**函数表达式，不能一路吞到后面另一个函数的收尾括号去。
//   今天这个锚是非贪婪的「切到行首四个空格那个闭括号」（见 fnExprOf）；真源里那个函数被压成一行、
//   或函数之间少了换行时，它会一直吞到下一个满足同样写法的行，把后面的导出一起圈进来。
//   最省事的信号就是 export 这个词：一个函数表达式里不可能出现它。查的是「有没有 export」，
//   不是「行首有没有」—— 真源里每个导出都缩进了四个空格，只看行首会漏掉这种吞法。
const elFnLines = elFnExpr === '' ? 0 : elFnExpr.split('\n').length
const elFnShapeOk = elFnExpr !== '' && !/\bexport\b/.test(elFnExpr)
check(
  elFnShapeOk,
  '取到的那段文本形状对得上一个函数表达式（里面不出现 export 这个词；实得 ' + elFnLines + ' 行'
  + (elFnExpr === '' ? '，因为压根没取到' : (/\bexport\b/.test(elFnExpr) ? '，里面有 export —— 说明锚一路吞到了下面的导出' : '')) + '）',
)
// 求值自己兜住：取不到函数体、形状不对、求值抛错，都不许再往外冒（上一版正是这里把进程带崩的）。
let elFnEvalFail = ''
let elWithH = null
if (elFnExpr === '') elFnEvalFail = '取不到函数体：按现在的锚从真源里切不出 workspaceFileNoteEl 的函数表达式文本'
else if (!elFnShapeOk) elFnEvalFail = '取不到函数体：切出来的文本把下面的导出也吞了进来（里面有 export），不是一个函数表达式'
else {
  try {
    elWithH = compileFn(['h', 'workspaceFileNoteOf'], 'return ' + elFnExpr)(fakeH, noteOf)
  } catch (e) {
    elFnEvalFail = '函数体求值失败：' + String((e && e.message) || e)
  }
}
check(
  typeof elWithH === 'function',
  '把切出来的函数体文本求值成能跑的函数（取不到函数体、形状不对、求值抛错，三种都在这一条按红报；本次结果：' + (elFnEvalFail || '求值成功') + '）',
)
const callWithH = function (s) {
  if (typeof elWithH !== 'function') return '<<' + (elFnEvalFail || '取不到函数体') + '，这一条跑不了>>'
  try { return elWithH(s) } catch (e) { return '<<抛错：' + String((e && e.message) || e) + '>>' }
}
const nodeWithH = callWithH({ workspaceFileResult: { ok: true, placed: true, reason: 'created' } })
check(!!nodeWithH && nodeWithH.tag === 'div', '给它一个 h 就回一个 div 节点（状态栏那一行小灰字）—— 实得 ' + JSON.stringify(nodeWithH && nodeWithH.tag))
check(!!nodeWithH && nodeWithH.children === noteCreated, '节点里写的正是翻译出来那句话（实得「' + (nodeWithH && nodeWithH.children) + '」）')
check(!!nodeWithH && !!nodeWithH.props && !!nodeWithH.props.style, '回的那个节点自带 style（这一行怎么显示它自己说清，不靠调用方补样式）')
check(callWithH({ workspaceFileResult: { ok: false } }) === null, '有 h 时没写成那一档照旧回 null（没写成就没什么可占位的）')
check(callWithH({}) === null, '有 h 时没有结果照旧回 null')

// ── F 反证：改坏翻译函数，B 组那批判据必须当场红（本轮重做）────────────────────────
console.log('')
console.log('== F 反证：把翻译函数改坏，B 组同一批判据必须当场红 ==')
// 本轮改法：四个变异体都拿上面 import 进来的**真身函数**包一层，按回执的字段改掉某一档的说法，
//   别处一律转发给它。上一版是在真源文本上做字符串替换、每个变异体钉一句整句原文当锚：锚找不到就 SKIP，
//   而真源改个措辞（「配置文件」→「设置文件」、覆盖那句换个同义说法）就会丢锚报红 —— 与文件头
//   「句式、语序、标点都能改」自相矛盾。改成包装之后，这一组只依赖两样东西：回执的字段名，
//   以及「哪一档该说什么意思」，真源措辞怎么改都不影响。
//   每个变异体只改一处意思，红一条就算反证成立（末尾还要求几个变异体合起来掀红 ≥3 条不同判据）。
//   注意「改说成哪一句」也取自真身自己：跳过那一档改说成它给「已创建」回的那句、已创建那一档改说成
//   它给「已覆盖」回的那句 —— 这样连变异体里都不用抄真源的原文。代价是变异体的红相也依赖真身那两句
//   确实不一样、确实非空；真身自己坏了是 B 组先红的事，这一组不替它兜底。
const MUTANTS = [
  {
    name: 'F1 没写成也说成写成了（没写成那一档不再回空串，改说成已经写进去那一句）',
    // 回执是没写成（ok 不是 true，或带着 error）时，回「已写入那一句」而不是空串。
    wrap: (real) => (wf) => (wf && typeof wf === 'object' && (wf.ok === false || wf.error))
      ? real({ ok: true, placed: true, reason: 'created' })
      : real(wf),
  },
  {
    name: 'F2 覆盖那句丢掉（覆盖那一档不再说覆盖，改说成普通的已写入句）',
    // 回执是覆盖（ok:true 且 reason 为 overwritten）时，回不带「覆盖」意思的普通已写入句。
    wrap: (real) => (wf) => (wf && typeof wf === 'object' && wf.ok === true && wf.reason === 'overwritten')
      ? real({ ok: true, placed: true, reason: 'created' })
      : real(wf),
  },
  {
    name: 'F3 没写成还硬说一句（没写成那一档不再回空串，改说一句自定义的失败话）',
    // 回执没写成时，回一句自说自话的失败话。这一句必须自己写：真身那一档今天回的就是空串，
    //   没有第二个「非空但说错了」的分支可借 —— 所以它是本文件里唯一一句自带原文的变异体。
    //   它只要求「这是一句非空的、与成功那两句不同的话」，真源怎么改措辞都不会让它失去意义。
    wrap: (real) => (wf) => (wf && typeof wf === 'object' && (wf.ok === false || wf.error))
      ? '这次没能把选择写进工作区里的配置文件（下次再选一次可以重试）。'
      : real(wf),
  },
  {
    name: 'F4 已创建谎称覆盖（已创建那一档改说成覆盖了原来那一条）',
    // 回执是已创建（ok:true 且 reason 不是 overwritten）时，回「覆盖那一句」。
    wrap: (real) => (wf) => (wf && typeof wf === 'object' && wf.ok === true && wf.reason !== 'overwritten')
      ? real({ ok: true, placed: true, reason: 'overwritten' })
      : real(wf),
  },
]
const redNames = new Set()
for (const m of MUTANTS) {
  // 真身不是函数时（导入成功但没导出这一项）这里会一路抛错，runNoteCases 把它记成「抛错」按红算，
  //   不会静默变成绿灯：B 组那三条导出断言此时也已经红了。
  const fn = m.wrap(noteOf)
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
//   前者防的是「跑不了就 if 掉」：本文件今天没有一处调用 skip()，这道闸留着当规矩，谁再用谁在收尾被算成红；
//   后者防的是将来有人又加了个 if 把几条断言包起来、末尾还照旧打印全过。
console.log('')
check(skipped === 0, '本次没有一条判据因为「找不到锚 / 取不出真身」被跳过（实测跳过 ' + skipped + ' 条 —— 跳过一律在这里算红）')
// 上面所有 check 的条数 + 这一条自身 = 预期总数（下面这条自己也算一条，所以用 +1）。
//   #1138 从 51 降到 48：B 组原来有 3 条「跳过三种取值各回空串」，今天宿主不再回那一档（不再静默跳过），
//   这 3 条换成 3 条「没写成回空串/不与成功同句」，条数因此少了 3（10+3 → 10）。
const TOTAL_ASSERTIONS = 48
check(
  passed + failed + 1 === TOTAL_ASSERTIONS,
  '断言条数恰为预期总数（预期 ' + TOTAL_ASSERTIONS + ' 条，实得 ' + (passed + failed + 1) + ' 条）。两个方向都算：'
  + '少一条，说明有断言被人删了、或被条件语句挡掉了（那几条会一声不响地不跑）；'
  + '多一条，说明合法新增了判据、或多出一档跳过跟着多测了一条翻译，而这个常量没跟着改。'
  + '对不上就按这次实得的数把这个常量改过来，别让这道闸失灵',
)

console.log('')
console.log(failed
  ? '存在失败 — verify-workspace-file-note 未通过（' + passed + ' 项通过、' + failed + ' 项失败、' + skipped + ' 项跳过）'
  : '全部通过 — 工作区配置文件那一行门禁生效（' + passed + ' 项断言' + (skipped ? '、' + skipped + ' 项跳过' : '') + '）')
process.exit(failed ? 1 : 0)
