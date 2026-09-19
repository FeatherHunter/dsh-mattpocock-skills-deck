#!/usr/bin/env node
/**
 * verify-666-subws-mark-root.js — 面板归属标志：取根、该不该出现、出现时是哪几行（#666 门禁）
 *
 * 治的是什么：#653 落地的那枚「当前目录属于工作区 X」标志，读的是会话状态上的 st.workspaceRoot，
 *   而客户端里没有任何地方给那个字段赋过值 —— 于是「是不是子目录」这一判恒为假，这枚标志在任何机器、
 *   任何会话上都没亮过。当时两条子目录门禁（verify-653 / verify-656）断的全是「所选目录 → 工作区根」
 *   那张表和源文件里的文本：断得到表，断不到「取根这一步有没有值」，更断不到「这枚标志到底显示哪几行」。
 *
 * 本门禁把这两样都断上，而且尽量用真件：
 *   A. 取根：唯一来源是面板正在显示的那份快照（宿主带回来的原始路径）；快照没有它就不出现（不猜、不谎报）；
 *      会话状态上那个没人写的字段不再算一档来源（旧病不许回来）。
 *   B. 该不该出现：子目录会话出现；根会话、嵌套仓库、无仓库目录、cwd 空、快照没到都不出现；
 *      大小写或斜杠写法不同仍算同一条目录。
 *   C. 出现时是哪几行：拿真实 locale 里的 panel.wsMarkTip 拼（中英各跑一遍），{root} / {rel} 都填好、
 *      相对尾巴用 › 连、不吐反斜杠；第四行「…还未初始化」只在根确实没初始化时才有，且排在最后一行。
 *   D. 组件与产物：组件确实走这几个纯函数、aria-label 是三行用「；」连起来、点击调的是 wf.openFolder；
 *      两份产物都带上这几个函数名。
 *   E. 真渲染一遍：把组件放进真浏览器环境（真 jsdom + 真 React）画一次，断言「画出来了没有、画成什么样、
 *      点一下干什么、根会话里一行都不画、自动展开只一次」。本票的病因恰恰是「纯函数全对、源码全在，
 *      组件却每次都返回 null」，所以只断 A～D 拦不住它 —— 这一组就是为这件事补的。
 *   F. 真盘上溯：在真目录上跑一遍宿主的锚根判定（自带 .git 就停在那层），证明快照里那个 workspaceRoot
 *      真的是「从子目录一路往上找到的根」，而不是把所选目录原样回传。
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
let failed = false
let passed = 0
const ok = (msg) => { passed++; console.log('  PASS ' + msg) }
const bad = (msg) => { failed = true; console.log('  FAIL ' + msg) }

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const noExport = (s) => s.replace(/^\s*export\s+/gm, '')

const ROOT_DIR = 'D:\\ilife'
const SUB_DIR = 'D:\\ilife\\packages\\skill-calorie'
// 嵌套仓库：子目录自己带 .git，那时工作区根就是它自己 —— 与 SUB_DIR 不是同一条，别写成同一条。
const NESTED_DIR = 'D:\\ilife\\packages\\skill-calorie\\vendor\\nested'
// 无仓库目录：一路到顶都没有标记，工作区根就是所选目录自己。
const PLAIN_DIR = 'D:\\scratch\\no-repo\\sub'

// E 组与 F 组都要渲染组件，所以在模块这一层就把它取来（渲染环境由 tests/lib 里那个工具搭）。
// 规整函数与浮层文案也从这个工具里取，不在本文件另抄一份 —— 两处各写一份会各自漂。
const { renderMark, tipTextOf, keyOfFn, tipsFromLocale } = require('./lib/render-subws-mark.js')

console.log('=== #666 面板归属标志：取根 · 该不该出现 · 显示哪几行 ===')

// ── 真件一：内核里那把规整函数（与 verify-653 同口径，不是另写的仿制品）
const keyOf = keyOfFn()

// ── 真件二：真实 locale 里的四行文案（zh 在前、en 在后，与文件里两处的顺序一致）
const grabs = tipsFromLocale()
if (grabs.length === 2) ok('C0 真实 locale 里 panel.wsMarkTip 中英各一条')
else bad('C0 真实 locale 里 panel.wsMarkTip 应有中英两条，实际 ' + grabs.length + ' 条')

// ── 真件三：真假两半 —— 纯函数块从真源里原样取出来
const markSrc = read('src/client/views/SubworkspaceMark.js')
const start = markSrc.indexOf('export const subwsMarkRootOf')
const end = markSrc.indexOf('export const SubworkspaceMark')
if (start < 0 || end < 0 || end <= start) {
  bad('真源里找不到那组纯函数（subwsMarkRootOf … SubworkspaceMark 之间）')
  console.log('\n=== FAIL ===')
  process.exit(1)
}
const block = noExport(markSrc.slice(start, end))
const makeApi = (tmpl) => new Function(
  'keyOf', 'tr',
  block + '\nreturn { rootOf: subwsMarkRootOf, cmpKey: subwsMarkCmpKey, shows: subwsMarkShows, relOf: subwsMarkRelOf, rootShown: subwsMarkRootShown, linesOf: subwsMarkLinesOf }'
)(keyOf, function (k) { return (k === 'panel.wsMarkTip') ? tmpl : k })
const api = makeApi(grabs[0] || '')
const apiEn = makeApi(grabs[1] || '')

console.log('\nA) 取根：唯一来源是面板正在显示的那份快照')
let got = api.rootOf({ cwd: SUB_DIR, snapshot: { workspaceRoot: ROOT_DIR } })
if (got === ROOT_DIR) ok('A1 快照带着工作区根时取到它（#666 修的就是这一条，旧写法这里恒为空）')
else bad('A1 快照带着工作区根时没取到：' + JSON.stringify(got))

if (api.rootOf({ cwd: SUB_DIR }) === '') ok('A2 一点快照都还没到时回空串（认不出根就不出现）')
else bad('A2 没有快照时应回空串')

if (api.rootOf({ cwd: SUB_DIR, snapshot: {} }) === '') ok('A3 快照里没有这一项时回空串')
else bad('A3 快照缺这一项时应回空串')

if (api.rootOf({ cwd: SUB_DIR, workspaceRoot: ROOT_DIR }) === '') ok('A4 会话状态上那个没人写的字段不再算一档来源（旧病不许回来）')
else bad('A4 那个没人写的字段又被当来源读了')

console.log('\nB) 该不该出现')
if (api.shows(ROOT_DIR, SUB_DIR) === true) ok('B1 子目录会话：出现')
else bad('B1 子目录会话应出现')

if (api.shows(ROOT_DIR, ROOT_DIR) === false) ok('B2 根会话（所选目录就是工作区根）：不出现')
else bad('B2 根会话不该出现')

if (api.shows(NESTED_DIR, NESTED_DIR) === false) ok('B3 嵌套仓库（子目录自带 .git，根就是它自己）：不出现')
else bad('B3 嵌套仓库不该出现')

if (api.shows('', SUB_DIR) === false && api.shows(ROOT_DIR, '') === false) ok('B4 缺根或缺所选目录：不出现')
else bad('B4 缺一半时不该出现')

if (api.shows('d:/ilife', 'D:\\ilife') === false) ok('B5 大小写与斜杠写法不同仍算同一条目录（走内核那把规整函数）：不出现')
else bad('B5 同一条目录的两种写法被当成了子目录')

console.log('\nC) 出现时是哪几行（用真实 locale 文案拼）')
let lines = api.linesOf(ROOT_DIR, SUB_DIR, true)
if (lines.length === 3) ok('C1 根已初始化：三行')
else bad('C1 根已初始化时应为三行，实际 ' + lines.length + '：' + JSON.stringify(lines))

if (lines[0] === '面板数据来自工作区 D:\\ilife') ok('C2 第一行＝这份数据是谁的（显示原始路径，不是折算过的键）')
else bad('C2 第一行不对：' + JSON.stringify(lines[0]))

if (lines[1] === '当前目录是它的子目录：packages › skill-calorie') ok('C3 第二行＝相对关系（› 连接，不吐反斜杠）')
else bad('C3 第二行不对：' + JSON.stringify(lines[1]))

if (lines[2] === '点一下打开 D:\\ilife') ok('C4 第三行＝点一下干什么')
else bad('C4 第三行不对：' + JSON.stringify(lines[2]))

lines = api.linesOf(ROOT_DIR, SUB_DIR, false)
if (lines.length === 4 && /还未初始化$/.test(lines[3])) ok('C5 根确实没初始化：补第四行，且排在最后一行')
else bad('C5 第四行不对：' + JSON.stringify(lines))

if (api.linesOf(ROOT_DIR, ROOT_DIR, true).length === 0) ok('C6 不出现时一行都不给（空数组＝组件返回空）')
else bad('C6 不出现时应为空数组')

lines = apiEn.linesOf(ROOT_DIR, SUB_DIR, true)
if (lines.length === 3 && lines[0] === 'Panel data comes from workspace D:\\ilife' && lines[2] === 'Click to open D:\\ilife') ok('C7 英文模板同样拼得出三行（中英两条文案走同一条拼装）')
else bad('C7 英文拼装不对：' + JSON.stringify(lines))

// C8～C11 是「相对尾巴」那一段的边界。它原先按字符前缀切，于是名字以根开头的兄弟目录会被切出
//   残留片段（D:\ilife-other\x → 「-other › x」），大小写写法不同时又会退回整条带反斜杠的路径。
//   这两样都不该说给用户听，所以改成逐段走，并在这里逐条钉住。
const relOf = api.relOf
if (relOf('D:\\ilife', 'D:\\ilife-other\\x') === 'D: › ilife-other › x') ok('C8 名字以根开头的兄弟目录：不按字符切，整段列出（不出现「-other」这种残留）')
else bad('C8 兄弟目录被当成了子目录切开：' + JSON.stringify(relOf('D:\\ilife', 'D:\\ilife-other\\x')))

if (relOf('D:\\ilife', 'D:\\ilife2') === 'D: › ilife2') ok('C9 另一条前缀相同但不同名字的目录：同样整段列出')
else bad('C9 前缀相同的别的目录被切开了：' + JSON.stringify(relOf('D:\\ilife', 'D:\\ilife2')))

if (relOf('D:\\ilife', 'd:/ILIFE/packages/skill-calorie') === 'packages › skill-calorie') ok('C10 大小写与斜杠写法不同，仍然算在根下面，照样切出干净尾巴')
else bad('C10 写法不同就切不出来了：' + JSON.stringify(relOf('D:\\ilife', 'd:/ILIFE/packages/skill-calorie')))

if (relOf('D:\\ilife', 'D:\\ilife\\.tmp-666\\a') === '.tmp-666 › a') ok('C11 带点的目录名照常切（不把 . 当成特殊意思）')
else bad('C11 带点的目录名切得不对：' + JSON.stringify(relOf('D:\\ilife', 'D:\\ilife\\.tmp-666\\a')))

// C12～C14 是「显示成哪种写法」那一段。宿主放进快照的工作区根是**折算过的键**（Windows 上小写折叠、
//   反斜杠转正斜杠），直接拿去显示会说出「面板数据来自工作区 d:\ilife」—— 而 #650 定稿的文案是
//   `D:\ilife`。显示用的写法按会话原始目录（st.cwd，走 wf.cwd 拿的 header.cwd）逐段还原。
//   这三条喂的都是宿主真会给的值，不是手上写好的干净常量。
const rootShown = api.rootShown
if (rootShown('d:\\ilife', 'D:\\ilife\\packages\\skill-calorie') === 'D:\\ilife') ok('C12 宿主回的是小写键时，显示还原成原始写法 D:\\ilife（本票修过的那条）')
else bad('C12 显示没有还原成原始写法：' + JSON.stringify(rootShown('d:\\ilife', 'D:\\ilife\\packages\\skill-calorie')))

if (api.linesOf('d:\\ilife', 'D:\\ilife\\packages\\skill-calorie', true)[0] === '面板数据来自工作区 D:\\ilife') ok('C13 第一行真的说出「面板数据来自工作区 D:\\ilife」（不是 d:\\ilife）')
else bad('C13 第一行没有用原始写法：' + JSON.stringify(api.linesOf('d:\\ilife', 'D:\\ilife\\packages\\skill-calorie', true)[0]))

if (rootShown('d:\\ilife-other', 'D:\\ilife-other\\x') === 'D:\\ilife-other') ok('C14 前缀相同的另一条目录：还原用的是它自己的写法，不会串到 D:\\ilife 上')
else bad('C14 前缀相同的目录被串了写法：' + JSON.stringify(rootShown('d:\\ilife-other', 'D:\\ilife-other\\x')))

console.log('\nD) 组件与产物')
if (markSrc.indexOf('const shown = subwsMarkLinesOf(root, cwd, inited)') >= 0 && markSrc.indexOf("const aria = shown.join('；')") >= 0) ok('D1 组件的显示内容与 aria-label 都来自那组纯函数')
else bad('D1 组件没有走 subwsMarkLinesOf / aria 拼装')
if (markSrc.indexOf("host.call('wf.openFolder', { cwd: shownRoot })") >= 0) ok('D2 点击调的是宿主已有的打开文件夹能力，用的是浮层里写着的那条路径')
else bad('D2 点击没有调 wf.openFolder / 用的不是显示的那条路径')
for (const rel of ['client.js', 'package/lib/client.js']) {
  const t = read(rel)
  if (t.indexOf('subwsMarkRootOf') >= 0 && t.indexOf('subwsMarkLinesOf') >= 0) ok('D3 ' + rel + ' 带着这组纯函数')
  else bad('D3 ' + rel + ' 没带上这组纯函数（先跑 node scripts/build.mjs）')
}

// ── E / F 两组要真起浏览器环境、真读一次盘，所以是异步的；本文件前面全是同步断言，收在这里跑 ──
async function main() {

// ── E. 真把那枚标志画出来看一眼 ─────────────────────────────────────────────
// 前面 A～D 断的都是「纯函数算得对不对」与「源码里有没有那句话」。本票的病因恰恰在这两者之外：
//   组件读了没人写的字段 → 每一次都返回 null，纯函数全对、源码全在，界面上照样什么都没有。
//   所以这里把组件放进真浏览器环境（真 jsdom + 真 React，关起门来只把 Tip 与 host 换成替身）
//   渲染一遍，断言「画出来了没有、画成什么样、点一下干什么」。
console.log('\nE) 真渲染一遍：这枚标志到底画不画得出来（本票缺陷就长在这一层）')
try {
  const subStore = { cwd: SUB_DIR, snapshot: { ok: true, maps: [], workspaceRoot: ROOT_DIR } }
  const r = await renderMark(subStore, { click: true })

  if (r.isSub === true) ok('E1 子目录会话里真的画出了这枚标志（不再恒为 null）')
  else bad('E1 子目录会话里一个标志都没画出来（#666 的病又回来了）')

  if (/width="13"/.test(r.html) && /height="13"/.test(r.html)) ok('E2 图标是 #650 定稿的 13×13 绘制')
  else bad('E2 图标尺寸不是 13×13：' + r.html.slice(0, 200))
  if (/width: ?18px/.test(r.html) && /height: ?18px/.test(r.html)) ok('E3 标志的点击区是 18 像素（#650 定的「永不挤掉」）')
  else bad('E3 点击区不是 18 像素：' + r.html.slice(0, 200))

  const aria = (/aria-label="([^"]*)"/.exec(r.html) || [])[1] || ''
  const ariaLines = aria.split('；')
  if (ariaLines.length === 3) ok('E4 aria-label 把三句话用「；」连成一句念出来（读屏用户没有悬停这个动作）')
  else bad('E4 aria-label 不是三句拼一句，实际 ' + ariaLines.length + ' 句：' + JSON.stringify(aria))
  if (ariaLines[0] === '面板数据来自工作区 ' + ROOT_DIR && ariaLines[1] === '当前目录是它的子目录：packages › skill-calorie' && ariaLines[2] === '点一下打开 ' + ROOT_DIR)
    ok('E5 aria-label 三句话逐字对（含 › 连接的相对尾巴，不吐反斜杠）')
  else bad('E5 aria-label 三句不对：' + JSON.stringify(ariaLines))

  // 浮层内容：真 locale 的文案拼出来的三行，与 E5 同一批字
  const tipContent = r.tipCalls.length ? r.tipCalls[0].content : null
  if (tipContent) ok('E6 浮层内容确实交给了 Tip')
  else bad('E6 没有给 Tip 任何内容')
  // 「自动展开」是挂载后副作用里起的，Tip 会被调用不止一次（第一次还没带 visible），
  //   所以问的是「有没有哪一次带着 visible=true」，不是「第一次带没带」。
  const everVisible = r.tipCalls.some(function (c) { return c.visible === true })
  if (everVisible) ok('E7 第一次出现自动展开一次浮层（没字的图标不悬停就没人知道）')
  else bad('E7 第一次出现没有自动展开（tipCalls=' + JSON.stringify(r.tipCalls.map(function (c) { return c.visible })) + '）')

  if (r.hasLink === true) ok('E8 标志外面那圈可点的链接画出来了')
  else bad('E8 渲染结果里没有可点的链接')
  const call = r.hostCalls[0]
  if (call && call.method === 'wf.openFolder' && call.args && call.args.cwd === ROOT_DIR) ok('E9 点一下真的调 wf.openFolder 打开工作区根')
  else bad('E9 点击没有调 wf.openFolder 打开工作区根，实测 ' + JSON.stringify(r.hostCalls))

  // 反向：根会话里同一个组件一行都不画
  const rRoot = await renderMark({ cwd: ROOT_DIR, snapshot: { ok: true, maps: [], workspaceRoot: ROOT_DIR } })
  if (rRoot.isSub === false && rRoot.html.trim() === '') ok('E10 根会话里一行都不画（实测渲染结果为空）')
  else bad('E10 根会话里画出了东西：' + JSON.stringify(rRoot.html.slice(0, 120)))

  // 不再打扰：这个工作区自动展开过一次之后，第二次进来不再自动弹。
  //   问的是「有没有哪一次带着 visible=true」：第一次调用发生在挂载效果之前，那时它还没有这个值。
  const rSeen = await renderMark(subStore, { autoShown: true })
  const seenStillOpens = rSeen.tipCalls.some(function (c) { return c.visible === true })
  if (rSeen.isSub === true && seenStillOpens === false) ok('E11 同一个工作区里展开过一次之后不再自动弹（但标志照常在）')
  else bad('E11 自动展开的「只一次」没守住：标志在=' + rSeen.isSub + '，还自动弹=' + seenStillOpens)

  // 反向第二个：嵌套仓库（子目录自带 .git，那时工作区根就是它自己）也不画。
  //   上面 B3 断的是纯函数；这里把同一个情形渲染一次，免得只靠纯函数那一层说话。
  const rNested = await renderMark({ cwd: NESTED_DIR, snapshot: { ok: true, maps: [], workspaceRoot: NESTED_DIR } })
  if (rNested.isSub === false && rNested.html.trim() === '') ok('E12 嵌套仓库（子目录自带 .git）里也是一行都不画')
  else bad('E12 嵌套仓库里画出了东西：' + JSON.stringify(rNested.html.slice(0, 120)))

  // 反向第三个：没有仓库的目录（一路到顶都没标记，根就是它自己）同样不画。
  const rPlain = await renderMark({ cwd: PLAIN_DIR, snapshot: { ok: true, maps: [], workspaceRoot: PLAIN_DIR } })
  if (rPlain.isSub === false && rPlain.html.trim() === '') ok('E13 无仓库目录里一行都不画')
  else bad('E13 无仓库目录里画出了东西：' + JSON.stringify(rPlain.html.slice(0, 120)))

  // 第四行「…还未初始化」的真触发：链上那一步状态是 done 就不出，是 current 才出。
  //   （链还没加载、那一步根本不存在时，按「拿不准就不多说」处理 —— 也不出。）
  const rNotInit = await renderMark(subStore, { chainInit: 'current' })
  const notInitLines = String(tipTextOf(rNotInit.tipCalls))
  if (/还未初始化/.test(notInitLines)) ok('E14 根确实没初始化时，第四行真的画进浮层里')
  else bad('E14 根没初始化却没画第四行：' + JSON.stringify(notInitLines.slice(0, 160)))
  const rInit = await renderMark(subStore, { chainInit: 'done' })
  const initLines = String(tipTextOf(rInit.tipCalls))
  if (!/还未初始化/.test(initLines)) ok('E15 根已初始化时不画第四行（不写安慰话）')
  else bad('E15 根已初始化却多画了第四行：' + JSON.stringify(initLines.slice(0, 160)))
} catch (e) {
  bad('E 组渲染没跑起来：' + ((e && e.message) || e))
}

// ── F. 宿主那半条链：它到底往快照里放了什么 ─────────────────────────────────
// E 组证明的是「快照里带着工作区根时画得出来」，而且喂的是手上写好的常量。还差最要紧的一问：
//   宿主真会给什么？答案是 canonicalKey() —— 它经 workspaceKey.js 的 resolveWorkspaceRoot 锚到工作区根，
//   同时把大小写折叠掉。这一组就在真盘上跑它，再把**它真实产出的那个字符串**喂给标志，看画出来的话对不对。
//   （“自带 .git 就停在那一层、嵌套仓库自成一套、30 秒缓存”这些锚定规则由 tests/verify-656-subworkspace-acceptance.js
//   守，不在这里再断一遍；这里只断本票要的那条链：宿主产出 → 客户端显示。）
console.log('\nF) 宿主产出的那个值，喂给标志对不对（真盘上跑一遍 canonicalWorkspaceKey）')
try {
  const fsx = require('fs')
  const nodePath = require('path')
  const nodeOs = require('os')
  const { pathToFileURL } = require('url')
  const fsp = fsx.promises

  // 夹具放系统临时目录：盘根在 Linux 与 macOS 上不可写，放那儿会让这条门禁在 CI 上变红。
  const base = fsx.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'subws666-'))
  const wsRoot = nodePath.join(base, 'ws-root')
  const deep = nodePath.join(wsRoot, 'packages', 'skill-calorie')
  fsx.mkdirSync(deep, { recursive: true })
  fsx.writeFileSync(nodePath.join(wsRoot, '.git'), 'gitdir: somewhere\n')   // 根上自带 .git（文件形态也算）
  const fsp2 = fsp
  let probes = 0
  /** 照 DSH 文件服务的形状做一个真读盘的服务：lstat 收路径，stat / listDir 收 resolve 出来的 target。 */
  const fsSvc = {
    async resolve(p) { return { path: String(p), targetKey: String(p) } },
    async lstat(p) { probes++; return fsp2.lstat(String(p)) },
    async stat(t) { probes++; return fsp2.stat(String(t)) },
    async listDir(t) { probes++; return fsp2.readdir(String(t)) },
  }
  const wm = await import(pathToFileURL(nodePath.join(root, 'src/host/workspaceKey.js')).href)
  const deps = { getPlatform: async function () { return { os: process.platform, path: nodePath } }, getFs: function () { return fsSvc } }

  // 宿主那条路：handleSnapshot 开头 canonicalKey(args.cwd)，再原样放进快照
  const canonDeep = await wm.canonicalWorkspaceKey(deep, deps)
  probes = 0
  const canonAgain = await wm.canonicalWorkspaceKey(deep, deps)
  if (probes === 0) ok('F1 宿主那个算法第二回直接命中缓存，一次盘都没读（高频路径不算重账）')
  else bad('F1 第二回又去读盘了：探测 ' + probes + ' 次')
  if (canonDeep === canonAgain) ok('F2 同一个目录两次算出来是同一个值（稳定，不会一会儿一个样）')
  else bad('F2 两次算出来不一样：' + JSON.stringify([canonDeep, canonAgain]))

  // 关键一条：把关掉大小写的那个真实产出，连同会话原始目录一起喂给标志，看画出来的是哪种写法
  const hostValue = canonDeep                       // 宿主放进快照的 workspaceRoot，就是它
  const sessionCwd = deep                           // 会话原始目录（wf.cwd 回的是 header.cwd，保留用户写法）
  const fLines = api.linesOf(hostValue, sessionCwd, true)
  if (fLines.length === 3 && fLines[0] === '面板数据来自工作区 ' + wsRoot && fLines[2] === '点一下打开 ' + wsRoot)
    ok('F3 宿主真给的那个值，画出来还是用户自己的写法（不会显示成小写或正斜杠）')
  else bad('F3 宿主真给的值画出来写法不对：' + JSON.stringify(fLines))
  if (fLines[1] === '当前目录是它的子目录：packages › skill-calorie')
    ok('F4 同一份数据里，相对尾巴也是对的（packages › skill-calorie）')
  else bad('F4 相对尾巴不对：' + JSON.stringify(fLines[1]))

  // 反向：这一份数据就该出现标志，而它的根会话版本不该出现
  const fSubStore = { cwd: sessionCwd, snapshot: { ok: true, maps: [], workspaceRoot: hostValue } }
  const rHost = await renderMark(fSubStore)
  if (rHost.isSub === true && /面板数据来自工作区 /.test(rHost.html)) ok('F5 宿主真给的那份快照，渲染出来确实有这枚标志')
  else bad('F5 宿主真给的那份快照没画出标志：' + JSON.stringify(rHost.html.slice(0, 160)))
  const rHostRoot = await renderMark({ cwd: wsRoot, snapshot: { ok: true, maps: [], workspaceRoot: hostValue } })
  if (rHostRoot.isSub === false) ok('F6 同一个工作区的根会话里不画（那时根就是它自己）')
  else bad('F6 根会话里画出来了')

  fsx.rmSync(base, { recursive: true, force: true })
} catch (e) {
  bad('F 组没跑起来：' + ((e && e.message) || e))
}

if (failed) {
  console.log('\n=== FAIL（' + passed + ' 项通过） ===')
  process.exit(1)
}
console.log('\n=== PASS（' + passed + ' 项判据全过） ===')

}

// 起跑与兜底：E / F 两组里任何一处抛出没被接住，都要以「失败」收场，不能静静退出成 0。
main().catch(function (e) {
  console.log('\n=== FAIL（A～D 组跑完后 E/F 组异常） ===')
  console.log(String((e && e.stack) || e))
  process.exit(2)
})
