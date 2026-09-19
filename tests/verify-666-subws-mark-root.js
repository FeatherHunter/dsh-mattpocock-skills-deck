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
const NESTED = 'D:\\ilife\\packages\\skill-calorie'

console.log('=== #666 面板归属标志：取根 · 该不该出现 · 显示哪几行 ===')

// ── 真件一：内核里那把规整函数（与 verify-653 同口径，不是另写的仿制品）
const keyOfFn = new Function(noExport(read('src/shared/workspaceKey.js')) + '\nreturn keyOf')()

// ── 真件二：真实 locale 里的四行文案（zh 在前、en 在后，与文件里两处的顺序一致）
const locSrc = read('src/client/kernel/locale-panel.js')
const grabs = []
{
  const re = /'panel\.wsMarkTip':\s*'((?:[^'\\]|\\.)*)'/g
  let m
  while ((m = re.exec(locSrc)) !== null) grabs.push(m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'"))
}
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
  block + '\nreturn { rootOf: subwsMarkRootOf, cmpKey: subwsMarkCmpKey, shows: subwsMarkShows, relOf: subwsMarkRelOf, linesOf: subwsMarkLinesOf }'
)(keyOfFn, function (k) { return (k === 'panel.wsMarkTip') ? tmpl : k })
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

if (api.shows(NESTED, NESTED) === false) ok('B3 嵌套仓库（子目录自带 .git，根就是它自己）：不出现')
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

console.log('\nD) 组件与产物')
if (markSrc.indexOf('const shown = subwsMarkLinesOf(root, cwd, inited)') >= 0 && markSrc.indexOf("const aria = shown.join('；')") >= 0) ok('D1 组件的显示内容与 aria-label 都来自那组纯函数')
else bad('D1 组件没有走 subwsMarkLinesOf / aria 拼装')
if (markSrc.indexOf("host.call('wf.openFolder', { cwd: root })") >= 0) ok('D2 点击调的是宿主已有的打开文件夹能力')
else bad('D2 点击没有调 wf.openFolder')
for (const rel of ['client.js', 'package/lib/client.js']) {
  const t = read(rel)
  if (t.indexOf('subwsMarkRootOf') >= 0 && t.indexOf('subwsMarkLinesOf') >= 0) ok('D3 ' + rel + ' 带着这组纯函数')
  else bad('D3 ' + rel + ' 没带上这组纯函数（先跑 node scripts/build.mjs）')
}

if (failed) {
  console.log('\n=== FAIL（' + passed + ' 项通过） ===')
  process.exit(1)
}
console.log('\n=== PASS（' + passed + ' 项判据全过） ===')
