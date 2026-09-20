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

console.log('\nA) 取根：快照优先，wf.cwd 带回来的根作早到来源')
let got = api.rootOf({ cwd: SUB_DIR, snapshot: { workspaceRoot: ROOT_DIR } })
if (got === ROOT_DIR) ok('A1 快照带着工作区根时取到它（#666 修的就是这一条，旧写法这里恒为空）')
else bad('A1 快照带着工作区根时没取到：' + JSON.stringify(got))

// A2 改了：原先「没有快照就回空串」。现在 sessionWorkspaceRoot（wf.cwd 顺手带回来的根）也是来源之一，
//   所以「没有快照」还要再分两种情况 —— 有那个早到值就取它，没有才回空串。
if (api.rootOf({ cwd: SUB_DIR }) === '') ok('A2 快照与早到来源都没有时回空串（认不出根就不出现）')
else bad('A2 什么都没有时应回空串')

if (api.rootOf({ cwd: SUB_DIR, snapshot: {} }) === '') ok('A3 快照里没有这一项、也没有早到来源时回空串')
else bad('A3 快照缺这一项时应回空串')

if (api.rootOf({ cwd: SUB_DIR, workspaceRoot: ROOT_DIR }) === '') ok('A4 会话状态上那个没人写的字段不再算一档来源（旧病不许回来）')
else bad('A4 那个没人写的字段又被当来源读了')

// A5：wf.cwd 带回来的根是有效来源 —— 有它就能在快照到达之前先画出这枚标志
if (api.rootOf({ cwd: SUB_DIR, sessionWorkspaceRoot: ROOT_DIR }) === ROOT_DIR) ok('A5 wf.cwd 带回来的工作区根也算一档来源（快照没到也能先画）')
else bad('A5 早到来源没被采纳：' + JSON.stringify(api.rootOf({ cwd: SUB_DIR, sessionWorkspaceRoot: ROOT_DIR })))

// A6：两个来源都在时以**快照**为准。快照是面板正在显示的那份数据，早到那个只是先顶一下。
//   这一条挡住的是「快照换了工作区、早到那个还是旧的」这类串台。
if (api.rootOf({ cwd: SUB_DIR, snapshot: { workspaceRoot: 'D:\\other' }, sessionWorkspaceRoot: ROOT_DIR }) === 'D:\\other')
  ok('A6 两个来源都在时以快照为准（早到那个不许盖过正在显示的数据）')
else bad('A6 早到来源盖过了快照：' + JSON.stringify(api.rootOf({ cwd: SUB_DIR, snapshot: { workspaceRoot: 'D:\\other' }, sessionWorkspaceRoot: ROOT_DIR })))

// A7：早到那个是空串／空白时当作没有，不能拿它顶替一个根
if (api.rootOf({ cwd: SUB_DIR, sessionWorkspaceRoot: '   ' }) === '') ok('A7 早到来源是空白时当作没有（不拿空串顶替）')
else bad('A7 空白值被当成了根')

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

  // E1b：快照**一点都还没到**，只有 wf.cwd 带回来的那个根时也要画得出来。
  //   这正是「面板一打开就能看到」那件事的门禁：原先只能等一整份仓库快照，缓存没命中就是几十秒。
  const rEarly = await renderMark({ cwd: SUB_DIR, sessionWorkspaceRoot: ROOT_DIR })
  if (rEarly.isSub === true && /面板数据来自工作区 /.test(rEarly.html)) ok('E1b 快照还没到、只有 wf.cwd 带回来的根时，标志也画得出来（面板一打开就能看到）')
  else bad('E1b 只有早到来源时没画出来：' + JSON.stringify(rEarly.html.slice(0, 160)))

  // E1c：两个都在时，画面上的路径要以**快照**为准（早到那个只是先顶一下，不许盖过正在显示的数据）。
  //   断言用浮层里真实显示的那句话，不拿正则去抠 HTML —— 反斜杠在 HTML 里是转义的，抠出来容易连断言一起写错。
  const rBoth = await renderMark({ cwd: SUB_DIR, snapshot: { ok: true, maps: [], workspaceRoot: ROOT_DIR }, sessionWorkspaceRoot: 'D:\\somewhere-else' })
  const bothText = String(tipTextOf(rBoth.tipCalls))
  if (rBoth.isSub === true && bothText.indexOf('面板数据来自工作区 ' + ROOT_DIR) >= 0 && bothText.indexOf('somewhere-else') < 0)
    ok('E1c 两个来源都在时以快照为准（画面里是快照那个根，早到那个不出现）')
  else bad('E1c 早到来源盖过了快照：' + JSON.stringify(bothText.slice(0, 120)))

  if (/width="13"/.test(r.html) && /height="13"/.test(r.html)) ok('E2 图标是 #650 定稿的 13×13 绘制')
  else bad('E2 图标尺寸不是 13×13：' + r.html.slice(0, 200))
  // E3：外框尺寸要与面板头部左右两颗邻居按钮一模一样。这一条是维护者 2026-09-19 在真机上按截图
  //   指出的「宽高没有和右边两个对齐」，当时量出来是 40 像素对 32 像素。真因是：邻居两颗按钮都是
  //   style 里 width/height 16 + 1 像素边框（本站默认 content-box，所以外框就是 16×16），而这枚标志
  //   原先写 18 + 1 像素边框、又没写 border-box，外框成了 20×20。用无头 Chrome 量过：改前 20.00×20.00，
  //   改后 16.00×16.00，与两颗邻居一致。
  //   这里的期望值不是写死的 16，而是**从邻居按钮的真源里读出来的** —— 邻居哪天改尺寸，这一条会跟着变，
  //   不会变成钉死一个已经过时的数字。
  const neighbourSize = function (rel, label) {
    const src = read(rel)
    // 取的是按钮那颗盒子的尺寸，不是它里面图标的尺寸：按钮这边的写法紧跟着 flex: 'none' 与 border，
    //   而图标那边是 Ic({ n: …, size: … })（字面量里没有 width/height 这一段）。锚在 flex 上才不会抓错。
    const re = /width:\s*(\d+),\s*height:\s*(\d+),\s*borderRadius:\s*\d+,\s*flex:\s*'none'[\s\S]{0,160}?border:\s*'1px solid/g
    const hits = []
    let m
    while ((m = re.exec(src)) !== null) hits.push({ w: Number(m[1]), h: Number(m[2]) })
    if (!hits.length) return null
    return { w: hits[0].w, h: hits[0].h, count: hits.length, label: label }
  }
  const swap = neighbourSize('src/client/panel/Dock.js', '切换后端')
  const palette = neighbourSize('src/client/views/labels/LabelColorEntry.js', '标签配色')
  const markBox = /box-sizing: ?border-box;[^"]*?width: ?(\d+)px; ?height: ?(\d+)px/.exec(r.html)
  if (!swap || !palette || !markBox) bad('E3 没读到三颗按钮的尺寸（邻居 ' + JSON.stringify([swap, palette]) + '，标志 ' + JSON.stringify(markBox && markBox.slice(1)) + '）')
  else if (swap.w !== palette.w || swap.h !== palette.h) bad('E3 两颗邻居按钮自己就不一般大，这条判据的前提不成立：' + JSON.stringify([swap, palette]))
  else if (Number(markBox[1]) === swap.w && Number(markBox[2]) === swap.h) ok('E3 标志外框 ' + markBox[1] + '×' + markBox[2] + '，与左右两颗邻居按钮（' + swap.label + ' / ' + palette.label + '，外框 ' + swap.w + '×' + swap.h + '）一样大')
  else bad('E3 标志外框 ' + markBox[1] + '×' + markBox[2] + ' 与邻居的 ' + swap.w + '×' + swap.h + ' 不一致（维护者指出的「宽高没对齐」就是这个）')
  const boxSizingOk = /box-sizing: ?border-box/.test(r.html)
  if (boxSizingOk) ok('E3b 边框算在尺寸里（border-box），不会在 16 外面再加 2 像素')
  else bad('E3b 没写 border-box：1 像素边框会另加，外框比邻居大一圈')

  // E3c：边框与里面的图形要用**同一个红**。原来图形用的是 currentColor，跟着所在那一行的字色走
  //   （头部那行字色是浅色的），于是画出来是个浅色文件夹配一个红边框，两截颜色 —— 维护者 2026-09-19
  //   在真机上指出这一点，所以图形颜色写死成与边框同一处常量。
  //   两边写法不一样（style 里的颜色浏览器会算成 rgb(...)，SVG 属性上是十六进制），所以先归一再比。
  const toRgb = function (v) {
    const s = String(v || '').trim()
    let m = /^#([0-9a-f]{6})$/i.exec(s)
    if (m) { const n = parseInt(m[1], 16); return 'rgb(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ') + ')' }
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s)
    if (m) return 'rgb(' + [m[1], m[2], m[3]].join(', ') + ')'
    return s.toLowerCase()
  }
  const markStyle = (/<span[^>]*data-subws-mark="1"[^>]*style="([^"]*)"/.exec(r.html) || [])[1] || ''
  const borderCol = toRgb((/border: ?1px solid ([^;"]+)/.exec(markStyle) || [])[1] || '')
  const svgTag = (/<svg([^>]*)>/.exec(r.html) || [])[1] || ''
  const rectTag = (/<rect([^>]*)>/.exec(r.html) || [])[1] || ''
  const strokeCol = toRgb((/stroke="([^"]+)"/.exec(svgTag) || [])[1] || '')          // 文件夹轮廓的描边
  const fillCol = toRgb((/fill="([^"]+)"/.exec(rectTag) || [])[1] || '')             // 里面那块实心方块
  if (borderCol && strokeCol === borderCol && fillCol === borderCol) ok('E3c 边框、文件夹轮廓、里面那块是同一个红（' + borderCol + '），不会一半红一半浅色')
  else bad('E3c 框与图形颜色不一致：边框 ' + JSON.stringify(borderCol) + '，轮廓描边 ' + JSON.stringify(strokeCol) + '，方块填充 ' + JSON.stringify(fillCol))
  if (!/currentcolor/i.test(strokeCol) && !/currentcolor/i.test(fillCol)) ok('E3c2 图形颜色写死了，不跟外层字色漂移')
  else bad('E3c2 图形还在用 currentColor，会跟着外层字色变')

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

// ── G. 宿主那条轻电话顺手带回来的工作区根（2026-09-19 加，治「面板打开几十秒才出现标志」）────────
// 这一段不另写仿制品：真的是 src/host/sessionLifecycle.js 里那个电话体，只把它依赖的服务换成夹具。
//   两件事都要断：① 算得出来时字段在、值是对的；② 算不出来时它只是少了这个字段，电话本身照常成功
//   （这条电话原本只答 cwd，不能因为算根出问题就把它的行为改坏）。
console.log('\nG) wf.cwd 顺手带回工作区根：算得出来就带上，算不出来不许影响它原有的答复')
try {
  const fsx = require('fs')
  const nodePath = require('path')
  const nodeOs = require('os')
  const { pathToFileURL } = require('url')
  const fsp = fsx.promises

  const wm = await import(pathToFileURL(nodePath.join(root, 'src/host/workspaceKey.js')).href)
  const mod = await import(pathToFileURL(nodePath.join(root, 'src/host/sessionLifecycle.js')).href)
  const fsSvc = {
    async resolve(p) { return { path: String(p), targetKey: String(p) } },
    async lstat(p) { return fsp.lstat(String(p)) },
    async stat(t) { return fsp.stat(String(t)) },
    async listDir(t) { return fsp.readdir(String(t)) },
  }

  // 一个最小的 ctx：只提供那条电话要用的 sessions.get
  const makePhone = function (cwdOfSession, canonical) {
    const life = mod.createSessionLifecycle({
      ctx: {
        get: function (k) {
          if (k !== 'sessions') return undefined
          return { get: function () { return cwdOfSession ? { header: { cwd: cwdOfSession } } : { header: {} } } }
        },
      },
      DEFAULT_CWD: 'D:\\',
      errText: function (e) { return String((e && e.message) || e) },
      getDetectionService: async function () { return null },
      getTrackerRegistry: async function () { return null },
      getPlatform: async function () { return { os: process.platform, path: nodePath } },
      canonicalKey: canonical,
      logCtx: null,
    })
    return life.handleCwd
  }

  // ① 能算出根：字段在，且就是 canonicalKey 算出来的那个值（与快照里那个 workspaceRoot 同一把尺子）
  const markedRoot = 'd:/ilife'
  const okPhone = makePhone('D:\\ilife\\packages\\skill-calorie', async function () { return markedRoot })
  const r1 = await okPhone({ sessionId: 'sid-1' })
  if (r1 && r1.ok === true && r1.cwd === 'D:\\ilife\\packages\\skill-calorie' && r1.workspaceRoot === markedRoot)
    ok('G1 算得出根时，回包里既保留了原来的 cwd，也多带上 workspaceRoot（值是 canonicalKey 算的）')
  else bad('G1 回包不对：' + JSON.stringify(r1))

  // ② 算不出来：只是少了这个字段，电话本身照样成功、cwd 照旧回
  const badPhone = makePhone('D:\\ilife\\packages\\skill-calorie', async function () { throw new Error('探不通') })
  const r2 = await badPhone({ sessionId: 'sid-2' })
  if (r2 && r2.ok === true && r2.cwd === 'D:\\ilife\\packages\\skill-calorie' && !('workspaceRoot' in r2))
    ok('G2 算根失败时：电话照常成功、cwd 照旧回，只是不带那个字段（不把原有行为改坏）')
  else bad('G2 算根失败后回包变了：' + JSON.stringify(r2))

  // ③ 客户端没给 canonicalKey（老版本宿主／单元环境）：同样不许影响答复
  const noDepPhone = makePhone('D:\\ilife\\packages\\skill-calorie', undefined)
  const r3 = await noDepPhone({ sessionId: 'sid-3' })
  if (r3 && r3.ok === true && r3.cwd === 'D:\\ilife\\packages\\skill-calorie' && !('workspaceRoot' in r3))
    ok('G3 没给算根的依赖时一样照常答复（只是不带字段）')
  else bad('G3 缺依赖时回包变了：' + JSON.stringify(r3))

  // ④ 少了 sessionId / 会话没有 cwd：原有那两条失败分支不许动
  const r4 = await okPhone({})
  if (r4 && r4.ok === false && r4.error === '缺少 sessionId') ok('G4 没给 sessionId 时仍是原来那句「缺少 sessionId」')
  else bad('G4 缺 sessionId 的分支变了：' + JSON.stringify(r4))
  const r5 = await makePhone('', async function () { return markedRoot })({ sessionId: 'sid-5' })
  if (r5 && r5.ok === false && !('workspaceRoot' in r5)) ok('G5 会话没有 cwd 时仍是失败答复，且不带工作区根')
  else bad('G5 无 cwd 的分支变了：' + JSON.stringify(r5))

  // ⑤ ④ 的分支里那条 canonicalKey，与快照那条路是同一把尺子：拿真盘再验一次它停在工作区根上
  const base = fsx.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'subws666g-'))
  const wsRoot = nodePath.join(base, 'ws-root')
  const deep = nodePath.join(wsRoot, 'packages', 'skill-calorie')
  fsx.mkdirSync(deep, { recursive: true })
  fsx.writeFileSync(nodePath.join(wsRoot, '.git'), 'gitdir: somewhere\n')
  const canon = async function (raw) {
    return wm.canonicalWorkspaceKey(raw, { getPlatform: async function () { return { os: process.platform, path: nodePath } }, getFs: function () { return fsSvc } })
  }
  const realPhone = makePhone(deep, canon)
  const r6 = await realPhone({ sessionId: 'sid-6' })
  if (r6 && r6.workspaceRoot && String(r6.workspaceRoot) === String(await canon(deep)))
    ok('G6 真盘上跑一遍：带回来的工作区根就是 canonicalKey 在子目录上算出来的那个（与快照同一个来源）')
  else bad('G6 真盘上算出来的根不对：' + JSON.stringify(r6))
  const linesEarly = api.linesOf(r6 && r6.workspaceRoot, deep, true)
  if (linesEarly.length === 3 && linesEarly[0] === '面板数据来自工作区 ' + wsRoot)
    ok('G7 把这个早到的根直接喂给标志，第一行就是那个工作区（面板一打开就能画）')
  else bad('G7 早到的根喂给标志画不出来：' + JSON.stringify(linesEarly))
  fsx.rmSync(base, { recursive: true, force: true })
} catch (e) {
  bad('G 组没跑起来：' + ((e && e.message) || e))
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
