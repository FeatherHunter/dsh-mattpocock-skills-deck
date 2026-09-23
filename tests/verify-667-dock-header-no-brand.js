#!/usr/bin/env node
/**
 * verify-667-dock-header-no-brand.js — 面板头部不再有品牌图标与文字（#667 门禁）
 *
 * 这一票要的东西（维护者 2026-09-19 原话）：「希望 MattSkills 这个文字在右侧面板中消失，包括那个 LOGO。
 *   此外状态胶囊栏的不要消失」。落到代码上就是：面板头部那一行里、**仓库名左侧**的品牌那一段去掉
 *   （罗盘图标 + 「MattSkills」字样），其余元素一个不动；同时两条边界不许碰 ——
 *   DSH 右栏那个标签页上的名字不改（那是注册标签类型时给的名字），状态胶囊栏照旧。
 *
 * 为什么这道门要真起浏览器量，而不是只断源码文本：
 *   本票的判据有一半是**几何的** ——「左边不再有那一段」等于「这一行的第一个元素就是仓库芯片、且紧贴左内边距」；
 *   「别让去掉之后留下空位或撑破」等于「一行不溢出、窄面板下也一样」。断源码只能证明「源码里没有那两段字」，
 *   证明不了画出来的是什么、位置对不对 —— #666 那次的缺陷恰恰长在「源码全在、纯函数全对，
 *   组件每次却返回 null」这一层，只断文本拦不住它。所以这里把**真产物**（package/lib/client.js）挂进
 *   真 Chromium，走真 rpc 载体（connection.rpc.call）喂一份带仓库的快照，再量那一行。
 *
 * 四组：
 *   A 源码层：头部那一段不再有品牌图标的画法与文字、它的第一个孩子就是仓库芯片那一段；两处「不碰」的还带着品牌；
 *     两份产物里也带着这次改动（改完 src 忘了重建产物，红在这里）。
 *   B 真渲染层（真 Chromium + 真产物 + 真数据）：头部第一个孩子是仓库芯片、贴着左内边距（左侧没有空位）、
 *     整行没有品牌字样也没有罗盘图形、一行不溢出；360 像素窄面板下这四条照旧（#28 那条收缩链还在跑）。
 *   C 反向两处照旧：DSH 右栏标签页的名字仍是「MattSkills」；状态胶囊栏里那枚品牌图标与字样仍在，
 *     而且仍是折叠优先级 1（最先收）。
 *   D 反证：把一段旧的品牌标记插回头部最前面，B 的那几条必须当场变红 —— 否则这道门量的是死数据，是假绿。
 *   E 整行逐字折叠（2026-09-22 维护者第三轮定，按面板真实宽度每 6 像素扫一档）：这一行里会随宽度变短的东西
 *     （仓库名那一长串 / 刷新按钮上的字 / 时间标签那句相对时间 / 三颗单字形小图标）**不许整块一下子不见**——
 *     一次让步最多只能少一个字符。核心断言就是这句话的可执行版：任意相邻两档之间，版面上的可见字符数最多减 1；
 *     另加：完整仓库名与完整的上次更新说法在每一档的悬停提示里都读得到，刷新那颗齿轮图标每一档都还在。
 *   F 源码层：一串字的元素身上不许挂折叠类（不许整块消失）；单字形小图标的折叠标记要落在不写死 display 的那层。
 *   G 判据层（纯函数，不开浏览器）：把 panel/headFold.js 那条阶梯喂一份同形数据，逐档核对「最多少一个字符」与让位顺序。
 *
 * 依赖：playwright（含 chromium）与 esbuild，都在本仓 devDependencies。全程本机，不碰真仓库、不用登录令牌。
 * 运行：node tests/verify-667-dock-header-no-brand.js
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'

let passed = 0, failed = 0
function ok(msg) { passed++; console.log('  PASS ' + msg) }
function bad(msg) { failed++; console.log('  FAIL ' + msg) }
function check(cond, msg) { if (cond) ok(msg); else bad(msg) }

const DOCK = 'src/client/panel/Dock.js'
const STATUS = 'src/client/statusbar/StatusBar.js'
const ROUTER = 'src/client/kernel/router.js'
const ASSEMBLY = 'src/client/panelAssembly.js'
const SETTINGS = 'src/client/views/SettingsPage.js'
const ICONS = 'src/client/kernel/icons.js'
const ARTIFACTS = ['client.js', 'package/lib/client.js']

const read = (rel) => readFileSync(resolve(rel), 'utf8')
const missing = [DOCK, STATUS, ROUTER, ASSEMBLY, SETTINGS, ICONS, ...ARTIFACTS].filter((rel) => !existsSync(resolve(rel)))
for (const rel of missing) bad(rel + ' 读不到' + (ARTIFACTS.indexOf(rel) >= 0 ? '（先跑 node scripts/build.mjs 重建产物）' : ''))

console.log('=== #667 面板头部不再有品牌图标与文字（状态胶囊栏与标签页名字照旧）===')
console.log('')
console.log('A) 源码层：头部那一段里不再有品牌那两样，且从仓库芯片开始')

const dockSrc = existsSync(resolve(DOCK)) ? read(DOCK) : ''
// 头部那一行整段：从它的 ref 起，到下一段（Pending / MultiHit 黄条）之前。
//   不按行号取，行号会漂；也不按「第一个孩子」取，那样反证那一步就没法插东西。
const headStart = dockSrc.indexOf('ref: headRef')
const headEnd = dockSrc.indexOf('// #155 Q5：Pending / MultiHit 黄条')
const headBlock = (headStart >= 0 && headEnd > headStart) ? dockSrc.slice(headStart, headEnd) : ''
if (!headBlock) {
  bad('A 没取到头部那一段（Dock.js 里 ref: headRef 到「Pending / MultiHit 黄条」之间）')
} else {
  // 判「没有品牌」时先把注释剥掉：注释里提到「MattSkills」是在讲这件事的来历，不是画在界面上的东西。
  const headCode = headBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  if (!/data-head-title/.test(headCode)) ok('A1 标题字那个元素的钩子（data-head-title）不在这段里了')
  else bad('A1 头部还写着 data-head-title —— 标题字元素又回来了')

  if (!/tr\(\s*'panel\.title'\s*\)/.test(headCode)) ok('A2 这段代码里不再出现 tr(\'panel.title\')（品牌字样不画在这一行）')
  else bad("A2 头部这一段里还有 tr('panel.title') —— 品牌字样会画在仓库名左侧")

  if (!/scheme:\s*'compass'/.test(headCode) && !/n:\s*'compass'/.test(headCode)) ok('A3 罗盘图标（compass）不在这段里了（两种写法都查过）')
  else bad('A3 头部这一段里还画着罗盘图标')

  // 第一个孩子必须就是仓库芯片那一段：`}, [` 之后第一个代码 token 是那段 (function(){ ... })()
  const firstTok = (/},\s*\[\s*([\s\S]{0,60})/.exec(headCode) || [])[1] || ''
  check(/^\(function\s*\(\s*\)\s*\{/.test(firstTok.trim()),
    'A4 头部这一行的第一个孩子就是仓库芯片那一段（实测开头：' + JSON.stringify(firstTok.trim().slice(0, 30)) + '）')

  for (const [needle, label] of [
    ['data-repo-chip', '仓库芯片'],
    ['h(SubworkspaceMark', '归属标志'],
    ['data-repo-switch', '切换后端按钮'],
    ['h(LabelColorEntry', '标签配色入口'],
    ['data-head-refresh', '刷新按钮'],
    ['data-head-updated', '上次更新时间控件'],
  ]) {
    check(headCode.indexOf(needle) >= 0, 'A5 其余元素还在：' + label)
  }

  // #28 那条自适应收缩链：去掉标题字之后只剩仓库名一条，且三段（全长 → 短名 → 交给芯片自己省略）都在。
  //   这一段要把整台折叠机都取到（2026-09-22 起这台机器里还管头部右侧那两个控件的逐级收回），
  //   所以按「到下一段注释为止」取，不按固定字数截口 —— 截口会随着机器变长而漏掉后半段。
  const fitStart = dockSrc.indexOf('const applyHead = function')
  const fitStop = dockSrc.indexOf('// #670', fitStart)
  const fitBlock = fitStart >= 0 ? dockSrc.slice(fitStart, fitStop > fitStart ? fitStop : fitStart + 3000) : ''
  check(!!fitBlock && fitBlock.indexOf('titleEl') < 0, 'A6 头部自适应里不再找那个标题字元素（原先那段「先隐藏标题」已随元素一起去掉）')
  // A7（2026-09-22 第三轮改写）：仓库名不再是「全长 / 短名 / 交给芯片自己省略」三段，也不再靠 flex 收缩截断
  //   （那样一次会掉好几个字）。现在的判据是：折叠机照 panel/headFold.js 那条阶梯一档一档推，仓库名的那串字
  //   由阶梯算出来写进去 —— 「一次最多少一个字符」这条在 G 组逐档核对，这里只钉「机器拿的是阶梯算的字」。
  check(!!fitBlock && /headFoldStateAt\(/.test(fitBlock) && /nameEl\.textContent = st\.name/.test(fitBlock),
    'A7 折叠机画的是阶梯算出来的那串字（headFoldStateAt + 写进仓库名那个元素）')
  check(!!fitBlock && /for \(let t = 1; t <= headLadder\.steps\.length; t\+\+\)/.test(fitBlock) && /settle\(headLadder\.steps\.length\)/.test(fitBlock),
    'A8 折叠机是一档一档推的（先试第 1 档、放不下再试第 2 档…推到阶梯走完为止），不是一刀切')

  // A13-A15（2026-09-22 维护者定）：这一行右侧放两个各自独立的控件 —— 左边一颗「刷新」，右边一个装时间的盒子。
  //   两个控件之间只用间距，不许用「·」之类的分隔符把它们粘成一句。
  //   这两条静态判据就是「两个独立元素 + 之间没有分隔符」这件事在源码上的样子（反证：插一个「·」进去必红）。
  const ri = headCode.indexOf('data-head-refresh')
  const ui = headCode.indexOf('data-head-updated')
  check(ri >= 0 && ui > ri, 'A13 两个控件各有一个钩子，且刷新按钮在时间控件之前（实测下标 ' + ri + ' / ' + ui + '）')
  if (ri >= 0 && ui > ri) {
    const between = headCode.slice(ri, ui)
    check(between.indexOf('·') < 0, 'A14 两个控件之间没有分隔符「·」（实测之间那段代码的尾巴：' + JSON.stringify(between.slice(-48)) + '）')
    check(between.indexOf('h(') >= 0, 'A15 时间控件在刷新按钮之后另起一个元素（不是把两个钩子写在同一个元素上）')
  }

  // F 组（2026-09-22 第三轮，维护者要求）：这一行的逐字折叠在源码上必须满足两条 ——
  //   一串字的元素永远不整块消失（不许在它身上挂折叠类），单字形小图标的折叠标记必须落在不写死 display 的那一层
  //   （上一轮踩过：标记落在自己写着 display 的元素上，CSS 那条 .dsws-folded 规则盖不住它）。
  const nameLine = headBlock.split(/\r?\n/).filter((l) => /'data-repo-text'/.test(l))[0] || ''
  check(!!nameLine && nameLine.indexOf('dsws-folded') < 0,
    'F1 仓库名那串字身上没有折叠类（它是逐字变短的，不许整块消失；实测那一行含 dsws-folded：' + (nameLine.indexOf('dsws-folded') >= 0) + '）')
  const textSpanLines = headBlock.split(/\r?\n/).filter((l) => /'data-head-refresh-text'|'data-updated-ago'/.test(l))
  check(textSpanLines.length === 2 && textSpanLines.every((l) => l.indexOf('dsws-folded') < 0),
    'F2 刷新按钮的字与时间标签那两串字身上也没有折叠类（实测命中 ' + textSpanLines.length + ' 行，带折叠类的 ' + textSpanLines.filter((l) => l.indexOf('dsws-folded') >= 0).length + ' 行）')
  const iconTags = headBlock.match(/h\('span', \{[^}]*'data-head-icon'[^}]*\}/g) || []
  check(iconTags.length === 3 && iconTags.every((s) => s.indexOf('display') < 0),
    'F3 三颗单字形小图标的标记落在**不写死 display** 的那一层上（写了就会盖住 .dsws-folded 那条规则；实测那三处标记各自的属性对象：' + JSON.stringify(iconTags.join(' / ')) + '）')
  const gearLines = headBlock.split(/\r?\n/).filter((l) => /dsws-rficon|'data-head-refresh':/.test(l))
  check(gearLines.length >= 2 && gearLines.every((l) => l.indexOf('data-head-icon') < 0 && l.indexOf('dsws-folded') < 0),
    'F4 刷新那颗齿轮图标不在阶梯里（它身上既没有小图标的标记、也没有折叠类，谁也收不走它；实测命中 ' + gearLines.length + ' 行）')
}

console.log('')
console.log('G) 逐字阶梯的判据本身（纯函数，不开浏览器）：相邻两档之间每个元素最多少一个字符')
// 维护者这一轮的核心要求是「一次让步最多少一个字符」，这条判据最该被逐档核对 —— 所以先不画界面：
//   把 panel/headFold.js 那两个纯函数跑起来，喂一份与真机同形的数据（本仓那个长名 + 中文的刷新与时间），
//   一档一档看每个元素少几个字。E 组在真浏览器里量的正是同一个判据，这里先给它一个快而稳的底座。
const headFoldSrc = existsSync(resolve('src/client/panel/headFold.js')) ? readFileSync(resolve('src/client/panel/headFold.js'), 'utf8') : ''
const headFold = (function () {
  if (!headFoldSrc) return null
  try {
    // 与 scripts/build.mjs 拼接时同一套做法：剥掉行首 export，丢进同一个作用域里跑。
    return new Function(headFoldSrc.replace(/^[ \t]*export[ \t]+/gm, '') + '\nreturn { headFoldLadderOf, headFoldStateAt }')()
  } catch (e) { return null }
})()
if (!headFold) {
  bad('G 读不到 src/client/panel/headFold.js，或者它跑不起来')
} else {
  const SAMPLE = { name: 'FeatherHunter/dsh-mattpocock-skills-deck', refresh: '刷新', time: '3 分钟前', icons: ['palette', 'switch', 'mark'] }
  // 英文那一套也跑一遍：中文一个字 11 像素、英文一个字母只有 5 像素上下，两种字宽下的阶梯都得满足
  //   「相邻两档之间每个元素最多少一个字符」—— 这一条与语言的字宽无关，纯函数这边两种都量。
  const SAMPLE_EN = { name: 'FeatherHunter/dsh-mattpocock-skills-deck', refresh: 'Refresh', time: '3 min ago', icons: ['palette', 'switch', 'mark'] }
  // 数「从这一档到下一档，每个元素各少了几个字」——这条尺子本身就是这组断言的判据，所以先把它单独写出来：
  //   仓库名末尾那个省略号是记号，不算被减掉的名字（不然一步减两个字也能糊过去）。
  const visible = (s) => String(s == null ? '' : s).replace(/\s+/g, '')
  const nameBody = (s) => { const v = visible(s); return v.slice(-1) === '…' ? v.slice(0, -1) : v }
  const stepDrop = (a, b) => Math.max(
    visible(a.refresh).length - visible(b.refresh).length,
    visible(a.time).length - visible(b.time).length,
    nameBody(a.name).length - nameBody(b.name).length,
  )
  const dropTable = function (sample) {
    const ladder = headFold.headFoldLadderOf(sample)
    const states = []
    for (let t = 0; t <= ladder.steps.length; t++) states.push(headFold.headFoldStateAt(ladder, t))
    const drops = []
    for (let i = 1; i < states.length; i++) drops.push({ step: i, el: (ladder.steps[i - 1] || {}).el, d: stepDrop(states[i - 1], states[i]) })
    return { ladder: ladder, states: states, drops: drops }
  }
  const zhRun = dropTable(SAMPLE)
  const enRun = dropTable(SAMPLE_EN)
  const ladder = zhRun.ladder
  const states = zhRun.states
  const worstZh = zhRun.drops.reduce((m, x) => Math.max(m, x.d), 0)
  const worstEn = enRun.drops.reduce((m, x) => Math.max(m, x.d), 0)
  const whereOf = (run) => run.drops.filter((x) => x.d === run.drops.reduce((m, y) => Math.max(m, y.d), 0)).map((x) => '第' + x.step + '步(' + x.el + ')').join('、')
  check(worstZh <= 1 && worstEn <= 1,
    'G1 每一档之间每个元素最多少一个字符（实测中文那一套最多一次少 ' + worstZh + ' 个字' + (worstZh ? '：' + whereOf(zhRun) : '') + '；英文那一套最多 ' + worstEn + ' 个字' + (worstEn ? '：' + whereOf(enRun) : '') + '；中文阶梯共 ' + ladder.steps.length + ' 档、英文共 ' + enRun.ladder.steps.length + ' 档）')
  const firstOf = (el) => ladder.steps.findIndex((s) => s.el === el)
  const lastOf = (el) => ladder.steps.reduce((m, s, i) => (s.el === el ? i : m), -1)
  check(firstOf('refresh') === 0 && lastOf('refresh') < firstOf('time') && lastOf('time') < firstOf('name') && lastOf('name') < firstOf('icon'),
    'G2 让位顺序：先刷新的字，再时间标签，再仓库名，最后才是小图标（实测各段：刷新 ' + firstOf('refresh') + '–' + lastOf('refresh') + ' / 时间 ' + firstOf('time') + '–' + lastOf('time') + ' / 仓库名 ' + firstOf('name') + '–' + lastOf('name') + ' / 小图标 ' + firstOf('icon') + '–' + lastOf('icon') + '）')
  check(ladder.steps.filter((s) => s.el === 'icon').map((s) => s.id).join(',') === 'palette,switch,mark',
    'G3 三颗单字形小图标从最右一颗开始一颗一颗撤，齿轮（刷新那颗）不在阶梯里（实测 ' + JSON.stringify(ladder.steps.filter((s) => s.el === 'icon').map((s) => s.id)) + '）')
  const last = states[states.length - 1]
  check(last.name === '…' && last.refresh === '' && last.time === '' && Object.keys(last.icons).length === 3,
    'G4 走到最后一档：仓库名只剩一个省略号记号、刷新与时间的字都不剩、三颗小图标都撤了（实测 ' + JSON.stringify({ name: last.name, refresh: last.refresh, time: last.time, icons: Object.keys(last.icons) }) + '）')
  check(states[0].name === SAMPLE.name && ladder.name === SAMPLE.name,
    'G5 第 0 档画的就是完整仓库名，完整那串一直拿在阶梯里（界面上一格一格减，判据这边一个字都没丢；实测 ' + JSON.stringify(states[0].name) + '）')
  // 自带反证：这把尺子抓得住「一次掉两个字符」吗？拿两处故意做坏的样子喂进去看。
  const badNameDrop = stepDrop({ name: 'abcd', refresh: '', time: '' }, { name: 'ab…', refresh: '', time: '' })
  const badRefreshDrop = stepDrop({ name: '', refresh: '刷新', time: '' }, { name: '', refresh: '', time: '' })
  check(badNameDrop === 2 && badRefreshDrop === 2,
    'G6 自带反证：一次掉两个字符的坏样子会被这把尺子抓住（实测仓库名一步掉 ' + badNameDrop + ' 个字、刷新的字一步掉 ' + badRefreshDrop + ' 个字）')
}

console.log('')
console.log('B-pre) 两处「这次不碰」的源码：品牌还长在原来的地方')
const statusSrc = existsSync(resolve(STATUS)) ? read(STATUS) : ''
const assemblySrc = existsSync(resolve(ASSEMBLY)) ? read(ASSEMBLY) : ''
const routerSrc = existsSync(resolve(ROUTER)) ? read(ROUTER) : ''
const settingsSrc = existsSync(resolve(SETTINGS)) ? read(SETTINGS) : ''
check(/data-fold-priority':\s*1[\s\S]{0,40}tr\('panel\.title'\)/.test(statusSrc),
  "A8 状态胶囊栏里那枚品牌字样还在（data-fold-priority 1 + tr('panel.title')）")
check(/Icon\(\{\s*scheme:\s*s\.ui\.icon/.test(statusSrc), 'A9 状态胶囊栏里那枚品牌图标还在')
check(/title:\s*function\s*\(\)\s*\{\s*return tr\('panel\.title'\)\s*\}/.test(assemblySrc) || /title:\s*function\s*\(\)\s*\{\s*return tr\('panel\.title'\)\s*\}/.test(routerSrc),
  'A10 注册标签类型时给的名字仍是 tr(\'panel.title\')（DSH 标签页上那行字不变）')
check(/DeckNativeTabTitle\s*=\s*function\s*\(\)\s*\{\s*return h\('span',\s*null,\s*tr\('panel\.title'\)\)\s*\}/.test(routerSrc),
  'A11 右栏标题栏那格仍画品牌字样（DeckNativeTabTitle 没动）')
check(/Icon\(\{\s*scheme:\s*'compass'[\s\S]{0,200}?tr\('panel\.title'\)/.test(settingsSrc),
  'A12 设置页开头那处品牌（罗盘 + 字样）仍在')

console.log('')
console.log('C-pre) 两份产物里也带着这次改动（改完 src 忘了重建产物就红在这里）')
const artifacts = {}
for (const rel of ARTIFACTS) artifacts[rel] = existsSync(resolve(rel)) ? read(rel) : ''
for (const rel of ARTIFACTS) {
  const t = artifacts[rel]
  if (!t) continue
  check(t.indexOf('data-head-title') < 0, rel + ' 里没有标题字那个钩子')
  check(t.indexOf('data-repo-chip') >= 0, rel + ' 里仓库芯片那一段在')
  check(t.indexOf('这一行的第一个元素就是仓库芯片') >= 0, rel + ' 是从当前 src 重新构建出来的（带着这一版头部注释）')
}

// ---------- 真渲染层：真 Chromium + 真产物 + 真 rpc 载体 ----------
const CLIENT = 'package/lib/client.js'
if (!existsSync(resolve(CLIENT))) {
  console.log('')
  console.log('产物缺失，B/C/D 三组跳过')
  console.log('')
  console.log(passed + ' 条通过，' + failed + ' 条失败')
  process.exit(1)
}

// 喂给面板的那份数据，照宿主真会给的样子写：工作区根是折算过的键（小写 + 正斜杠），
//   会话所选目录是用户自己的写法（子目录）。归属标志因此会出现在头部 —— 这一行是「真的一整行」。
const CWD = 'D:\\ilife\\packages\\skill-calorie'
const SNAP = {
  ok: true,
  version: 'verify-667',
  // 取数时刻写成「三分钟前」这么远：头部那个小时间标签因此有一句确定的相对时间可量
  //   （E 组要断言它画的是一句相对时间，写死一个 1970 年的一刻就只能量到「两万天前」那种废话）。
  generatedMs: Date.now() - 3 * 60 * 1000,
  workspaceRoot: 'd:/ilife',
  maps: [],
  checks: null,
  isLocal: false,
  tickets: [],
  groups: {},
  repository: { name: 'FeatherHunter/dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck', backend: 'github' },
  selection: { backendId: 'github', source: 'explicit' },
}
// 罗盘图形那几笔从真源里读出来（不在这里另抄一份字面量）：头部不该再出现这段图形。
const compassPoints = (/case 'compass':[\s\S]{0,220}?points:\s*'([^']+)'/.exec(existsSync(resolve(ICONS)) ? read(ICONS) : '') || [])[1] || ''
check(!!compassPoints, '罗盘图形那几笔从 icons.js 真源里取到了（' + JSON.stringify(compassPoints) + '）')

// 探针入口：浏览器里没有模块解析器，所以入口连同 React 一起打包成一段经典脚本。
const ENTRY = `
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
window.React = React
window.__RDOM__ = ReactDOMClient
const CWD = window.__CWD__
const SNAP = window.__SNAP__
const COMPASS = window.__COMPASS__
let loaded = null
window.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
window.eval(window.__CLIENT_SRC__)
const dict = {}
const trFn = (k, p) => {
  let s = dict[k] !== undefined ? dict[k] : k
  if (p) s = s.replace(/\\{(\\w+)\\}/g, (m, n) => (n in p ? String(p[n]) : m))
  return s
}
const regs = []
const nativeTypes = []
const rpcMethods = []
const reply = (method) => {
  if (method === 'cwd') return { ok: true, cwd: CWD }
  if (method === 'snapshot' || method === 'refresh') return SNAP
  if (method === 'chain') return { ok: true, snapshot: { steps: [] }, chain: [], fullChain: null, resolved: [] }
  if (method === 'registry') return { ok: true, modules: [{ id: 'github', label: 'GitHub' }, { id: 'markdown', label: 'Markdown' }] }
  return { ok: true }
}
const services = {
  slots: { register: (m, c) => { regs.push({ m, c }); return () => {} }, inject: (n, f) => { try { f() } catch (e) {} } },
  sidebarRightTabs: { register: (d) => { nativeTypes.push(d); return () => {} } },
  connection: { rpc: { call: async (channel, endpoint, body) => { rpcMethods.push(body && body.method); return { ok: true, value: reply(body && body.method) } } } },
  // 这一页只用中文那一半词条（原来中英都并进来，英文覆盖中文）：E 组那台「每 6 像素扫一档、断言可见字符数最多减 1」
  //   的尺子，只有在「一个字符至少 6 像素宽」时才分得清一格 —— 中文字 11 像素、拉丁字母只有五点几像素。
  //   英文界面上一次真掉两个字母，尺子也会报「减 2」，但那是尺子分不出来，不是设计漏了一格；
  //   所以英文那一套「一次最多少一个字符」改由 G 组用英文样本单独量（纯函数，与字宽无关）。
  locale: { register: (ns, d) => { Object.assign(dict, (d && d.zh) || {}); return () => {} }, bind: () => trFn },
  workspaces: { list: async () => [] },
  sessions: { list: async () => [] },
  timer: { timeout: (f, ms) => setTimeout(f, ms) },
}
const ctx = { get: (k) => services[k], effect: (f) => { f(); return () => {} }, inject: (deps, cb) => { cb(ctx); return { dispose: () => {} } } }
loaded.factory((m) => (m === 'react' ? React : m === 'react-dom' ? ReactDOMClient : {})).apply(ctx)
const find = (name) => regs.filter((r) => r.m && r.m.name === name)[0]
const body = find('sidebar.right.pane.tab')
const titleComp = find('sidebar.right.pane.tab.title')
const capsuleComp = find('conversation.input.dock')

window.__WAIT__ = (pred, ms) => new Promise((res) => {
  const t0 = Date.now()
  const tick = () => { if (pred() || Date.now() - t0 > ms) res(!!pred()); else setTimeout(tick, 25) }
  tick()
})

window.__MOUNT__ = async function () {
  if (!body) return { error: 'no tab body registration', names: regs.map((r) => r.m && r.m.name) }
  const host = document.createElement('div')
  host.id = 'mount'
  host.style.cssText = 'height:600px'
  document.getElementById('pane').appendChild(host)
  window.__RDOM__.createRoot(host).render(React.createElement(body.c, body.m.inject ? body.m.inject('sess-1') : { sessionId: 'sess-1' }))
  // 标签内容体是「先出空壳、两跳之后再挂真面板」的（#603），所以要等那枚仓库芯片真的画出来。
  const arrived = await window.__WAIT__(() => !!document.querySelector('[data-repo-chip]'), 8000)
  return { ok: !!document.querySelector('[data-dsws-host]'), chipArrived: arrived, rpcMethods: rpcMethods.slice(0, 12), mounted: !!host }
}

window.__ROW__ = function () {
  const dock = document.querySelector('[data-dsws-host]')
  if (!dock) return null
  // 头部那一行 = 面板根节点里、装着仓库芯片的那个直接子节点。
  //   不写死「第一个孩子」：反证那一步要往它前面插东西，写死了就量不到。
  let row = dock.querySelector('[data-repo-chip]')
  while (row && row.parentElement !== dock) row = row.parentElement
  return row || dock.firstElementChild
}

window.__MEASURE__ = function () {
  const dock = document.querySelector('[data-dsws-host]')
  const row = window.__ROW__()
  if (!dock || !row) return { error: 'no row' }
  const rr = row.getBoundingClientRect()
  const padL = parseFloat(getComputedStyle(row).paddingLeft) || 0
  const kids = Array.from(row.children)
  const idxOf = (sel) => kids.findIndex((el) => el.matches(sel) || !!el.querySelector(sel))
  const first = row.firstElementChild
  const fr = first ? first.getBoundingClientRect() : null
  const chipEl = row.querySelector('[data-repo-chip]')
  const cr = chipEl ? chipEl.getBoundingClientRect() : null
  return {
    ok: true,
    rowText: (row.textContent || '').replace(/\\s+/g, ' ').trim(),
    rowWidth: Math.round(rr.width * 100) / 100,
    rowOverflow: row.scrollWidth - row.clientWidth,
    paddingLeft: padL,
    firstTag: first ? first.tagName.toLowerCase() : null,
    firstIsChip: !!first && (first.matches('[data-repo-chip]') || !!first.querySelector('[data-repo-chip]')),
    firstText: first ? (first.textContent || '').replace(/\\s+/g, ' ').trim() : '',
    // 左边有没有「空位」这件事，量的是**仓库芯片自己**离左内边距多远：
    //   它左边什么都没有时是 0；那一段品牌回来（或将来插进别的什么东西）时，它就被推开了。
    chipLeftGap: cr ? Math.round((cr.left - rr.left - padL) * 100) / 100 : null,
    hasCompass: !!row.querySelector('polygon[points="' + COMPASS + '"]'),
    chipIdx: idxOf('[data-repo-chip]'),
    markIdx: idxOf('[data-subws-mark]'),
    switchIdx: idxOf('[data-repo-switch]'),
    paletteIdx: idxOf('[data-label-colors]'),
    refreshIdx: idxOf('[data-head-refresh]'),
    updatedIdx: idxOf('[data-head-updated]'),
    // 两个控件之间到底有没有文字：把它们之间的兄弟节点的文字拼起来看，空的才算「只用间距分开」。
    betweenControlsText: (function () {
      const a = idxOf('[data-head-refresh]'), b = idxOf('[data-head-updated]')
      if (a < 0 || b < 0 || b <= a) return null
      return kids.slice(a + 1, b).map(function (el) { return el.textContent || '' }).join('')
    })(),
    childCount: kids.length,
    childTags: kids.map((el) => el.tagName.toLowerCase()).join(','),
  }
}

window.__RESIZE__ = function (w) {
  document.getElementById('pane').style.width = w + 'px'
  return w
}

// E 组用：把面板宽度设成 w，然后等这一行那一档真的定下来（连续三次读到同一个档号才算定）。
//   档号不是写死的阈值算出来的，是 panel/Dock.js 那台头部折叠机按这一行的真实可用宽度量出来的。
window.__SETTLE_WIDTH__ = async function (w) {
  document.getElementById('pane').style.width = w + 'px'
  const row = window.__ROW__()
  if (!row) return null
  let last = null, same = 0
  for (let i = 0; i < 60; i++) {
    await new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 16) }) })
    const cur = row.getAttribute('data-head-tier')
    if (cur === last) { same++; if (same >= 3) return cur } else { last = cur; same = 0 }
  }
  return last
}

// E 组用：头部第一行此刻的样子。这里只读画出来的结果 —— 三串字各自现在是什么（空白不算字）、
//   那几颗单字形小图标还剩几颗、齿轮在不在、两条完整信息（完整仓库名 / 完整的上次更新说法）读不读得到。
window.__HEAD_ROW__ = function () {
  const row = window.__ROW__()
  if (!row) return { error: 'no row' }
  const vis = function (el) {
    if (!el) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const text = function (el) { return (el && vis(el)) ? (el.textContent || '').replace(/\\s+/g, '') : '' }
  const nameEl = row.querySelector('[data-repo-text]')
  const rfEl = row.querySelector('[data-head-refresh-text]')
  const tmEl = row.querySelector('[data-updated-ago]')
  const chipEl = row.querySelector('[data-repo-chip]')
  const timeEl = row.querySelector('[data-head-updated]')
  const icons = {}
  Array.from(row.querySelectorAll('[data-head-icon]')).forEach(function (el) { icons[el.getAttribute('data-head-icon')] = vis(el) })
  const name = text(nameEl), refresh = text(rfEl), time = text(tmEl)
  return {
    ok: true,
    tier: Number(row.getAttribute('data-head-tier')),
    rowWidth: Math.round(row.getBoundingClientRect().width * 100) / 100,
    rowOverflow: row.scrollWidth - row.clientWidth,
    clientW: row.clientWidth,
    scrollW: row.scrollWidth,
    kidRects: Array.from(row.children).map(function (el) {
      const r = el.getBoundingClientRect()
      return el.tagName.toLowerCase() + ':' + Math.round(r.width) + '@' + Math.round(r.right - row.getBoundingClientRect().left)
    }).join(' '),
    nameRectW: nameEl ? Math.round(nameEl.getBoundingClientRect().width * 10) / 10 : null,
    nameTextLen: nameEl ? (nameEl.textContent || '').length : null,
    chipKids: (function () {
      const c = row.querySelector('[data-repo-chip]')
      if (!c) return null
      return Array.from(c.children).map(function (el) { return el.tagName.toLowerCase() + ':' + Math.round(el.getBoundingClientRect().width * 10) / 10 }).join(' ')
    })(),
    rowText: (row.textContent || '').replace(/\\s+/g, ' ').trim(),
    name: name, refresh: refresh, time: time,
    chars: name.length + refresh.length + time.length,
    chipAria: chipEl ? chipEl.getAttribute('aria-label') : null,
    timeAria: timeEl ? timeEl.getAttribute('aria-label') : null,
    gearVisible: vis(row.querySelector('.dsws-rficon')),
    icons: icons,
    iconsLeft: Object.keys(icons).filter(function (k) { return icons[k] }).length,
  }
}

// 反证用：把改动前那一段（罗盘图标 + 品牌字样）照原样插回头部最前面。
window.__INSERT_OLD_BRAND__ = function () {
  const row = window.__ROW__()
  if (!row) return { error: 'no row' }
  const NS = 'http://www.w3.org/2000/svg'
  const icon = document.createElementNS(NS, 'svg')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('width', '15')
  icon.setAttribute('height', '15')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  const circle = document.createElementNS(NS, 'circle')
  circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '9')
  const poly = document.createElementNS(NS, 'polygon')
  poly.setAttribute('points', COMPASS)
  icon.appendChild(circle); icon.appendChild(poly)
  const word = document.createElement('span')
  word.setAttribute('data-head-title', '1')
  word.textContent = dict['panel.title'] || 'MattSkills'
  word.style.cssText = 'font-weight:600;font-size:13px;flex:none;white-space:nowrap'
  row.insertBefore(word, row.firstElementChild)
  row.insertBefore(icon, row.firstElementChild)
  return { ok: true, brandWord: word.textContent }
}

window.__TAB_TITLE__ = async function () {
  if (!titleComp) return { error: 'no tab title registration' }
  const host = document.createElement('div')
  document.body.appendChild(host)
  window.__RDOM__.createRoot(host).render(React.createElement(titleComp.c, {}))
  await window.__WAIT__(() => (host.textContent || '').trim().length > 0, 3000)
  return {
    text: (host.textContent || '').trim(),
    typeTitle: (nativeTypes[0] && typeof nativeTypes[0].title === 'function') ? String(nativeTypes[0].title()) : null,
    kind: nativeTypes[0] && nativeTypes[0].kind,
  }
}

window.__CAPSULE__ = async function () {
  if (!capsuleComp) return { error: 'no statusbar registration' }
  const host = document.createElement('div')
  host.style.cssText = 'width:780px'
  document.body.appendChild(host)
  const props = Object.assign(
    capsuleComp.m.inject ? capsuleComp.m.inject('sess-1') : { sessionId: 'sess-1' },
    { session: { cwd: CWD }, useSessions: () => null, inputActions: null },
  )
  let thrown = null
  try {
    window.__RDOM__.createRoot(host).render(React.createElement(capsuleComp.c, props))
  } catch (e) { thrown = String((e && e.message) || e) }
  const arrived = await window.__WAIT__(() => !!host.querySelector('.dsws-capsule'), 5000)
  const cap = host.querySelector('.dsws-capsule')
  const word = cap && cap.querySelector('.dsws-capsule-word')
  const fold = cap && cap.querySelector('[data-fold-priority]')
  return {
    ok: !!cap,
    thrown: thrown,
    arrived: arrived,
    wordText: word ? (word.textContent || '').trim() : '',
    wordHasIcon: !!(word && word.querySelector('svg')),
    foldPriority: fold ? fold.getAttribute('data-fold-priority') : null,
    foldText: fold ? (fold.textContent || '').trim() : '',
  }
}
window.__PROBE_READY__ = true
`

const { build } = await import('esbuild')
const bundled = await build({
  stdin: { contents: ENTRY, resolveDir: resolve('.'), sourcefile: 'verify-667-probe.js', loader: 'js' },
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error',
})
const probeJs = bundled.outputFiles[0].text

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#10131a}
#pane{width:460px;height:600px;display:flex;flex-direction:column}
</style></head>
<body><div id="pane"></div>
<script>window.__CLIENT_SRC__ = ${JSON.stringify(artifacts[CLIENT] || read(CLIENT))};</script>
<script>window.__CWD__ = ${JSON.stringify(CWD)};window.__SNAP__ = ${JSON.stringify(SNAP)};window.__COMPASS__ = ${JSON.stringify(compassPoints)};</script>
<script>${probeJs}</script></body></html>`

// 页面要落在一个真 origin 上：插件启动时要读 localStorage（调试开关那些），
//   about:blank / file:// 上读它会直接抛，探针根本跑不起来。所以起一个本机临时小服务器。
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port + '/'

const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + (e && e.message)))
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()) })
  await page.goto(origin, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__PROBE_READY__ === true, null, { timeout: 15000 })

  console.log('')
  console.log('B) 真渲染：460 像素宽（面板的常态宽度）下的头部那一行')
  const mounted = await page.evaluate(() => window.__MOUNT__())
  if (!mounted.ok || !mounted.chipArrived) {
    bad('B 面板没挂起来：' + JSON.stringify(mounted) + ' / 页面错误 ' + JSON.stringify(pageErrors.slice(0, 3)))
  } else {
    ok('B0 面板挂起来了，头部那枚仓库芯片也画出来了（rpc 载体上走过：' + JSON.stringify(mounted.rpcMethods.slice(0, 6)) + '）')
    const m = await page.evaluate(() => window.__MEASURE__())
    if (m.error) {
      bad('B 没量到头部那一行：' + JSON.stringify(m))
    } else {
      check(m.firstIsChip, 'B1 头部这一行的第一个元素就是仓库芯片（实测第一个：<' + m.firstTag + '> ' + JSON.stringify(m.firstText.slice(0, 40)) + '）')
      check(m.chipLeftGap !== null && Math.abs(m.chipLeftGap) <= 1.5,
        'B2 仓库芯片自己贴着左内边距：它左边什么都没有、也没有留下空位（实测芯片左偏 ' + m.chipLeftGap + ' 像素，这一行的内边距 ' + m.paddingLeft + '）')
      check(m.rowText.indexOf('MattSkills') < 0, 'B3 整行看不到品牌字样（实测这一行的字：' + JSON.stringify(m.rowText.slice(0, 80)) + '）')
      check(!m.hasCompass, 'B4 整行没有罗盘那几笔图形（' + JSON.stringify(m.hasCompass) + '）')
      check(m.rowOverflow <= 1, 'B5 一行不溢出（scrollWidth-clientWidth = ' + m.rowOverflow + '）')
      check(m.chipIdx === 0, 'B6 仓库芯片是第 0 个孩子（实测下标 ' + m.chipIdx + '）')
      check(m.markIdx > 0 && m.switchIdx > m.markIdx && m.paletteIdx > m.switchIdx && m.refreshIdx > m.paletteIdx && m.updatedIdx > m.refreshIdx,
        'B7 其余元素的相对次序不变：芯片 → 归属标志 → 切换后端 → 标签配色 → 刷新 → 上次更新（实测下标 ' + JSON.stringify([m.chipIdx, m.markIdx, m.switchIdx, m.paletteIdx, m.refreshIdx, m.updatedIdx]) + '）')
      check(m.betweenControlsText === '',
        'B8 刷新按钮与「上次更新」时间控件之间没有任何文字（两个独立控件，只靠间距分开；实测之间读到 ' + JSON.stringify(m.betweenControlsText) + '）')
      console.log('     （这一行实测有 ' + m.childCount + ' 个孩子：' + m.childTags + '）')
    }

    console.log('')
    console.log('B-narrow) 360 像素窄面板（低于 380，会走窄档样式）下这四条照旧')
    await page.evaluate(() => window.__RESIZE__(360))
    await page.waitForTimeout(400)
    const n = await page.evaluate(() => window.__MEASURE__())
    if (n.error) {
      bad('B-narrow 没量到头部那一行：' + JSON.stringify(n))
    } else {
      check(n.rowWidth <= 361, 'Bn0 面板确实变窄了（实测宽 ' + n.rowWidth + '）')
      check(n.firstIsChip, 'Bn1 窄面板下第一个元素仍是仓库芯片（实测 ' + JSON.stringify(n.firstText.slice(0, 40)) + '）')
      check(n.chipLeftGap !== null && Math.abs(n.chipLeftGap) <= 1.5, 'Bn2 窄面板下仓库芯片仍贴着左内边距、左边没有空位（实测芯片左偏 ' + n.chipLeftGap + ' 像素）')
      check(n.rowText.indexOf('MattSkills') < 0 && !n.hasCompass, 'Bn3 窄面板下没有品牌字样也没有罗盘图形')
      check(n.rowOverflow <= 1, 'Bn4 窄面板下一行不溢出（scrollWidth-clientWidth = ' + n.rowOverflow + '）—— 去掉那一段没有把这一行撑破')
      check(n.switchIdx > 0 && n.paletteIdx > 0 && n.refreshIdx > 0 && n.updatedIdx > n.refreshIdx,
        'Bn5 窄面板下这几件都还在：切换后端 / 标签配色 / 刷新按钮 / 时间标签（实测下标 ' + JSON.stringify([n.switchIdx, n.paletteIdx, n.refreshIdx, n.updatedIdx]) + '）')
    }

    console.log('')
    console.log('C) 反向：这次不许碰的两处照旧')
    const t = await page.evaluate(() => window.__TAB_TITLE__())
    check(t.text === 'MattSkills', 'C1 DSH 右栏那格标签标题画的仍是「MattSkills」（实测 ' + JSON.stringify(t.text) + '）')
    check(t.typeTitle === 'MattSkills', 'C2 注册标签类型时给的名字仍是「MattSkills」（实测 ' + JSON.stringify(t.typeTitle) + '，kind ' + JSON.stringify(t.kind) + '）')
    const cap = await page.evaluate(() => window.__CAPSULE__())
    if (!cap.ok) {
      bad('C3 状态胶囊栏没挂起来：' + JSON.stringify(cap))
    } else {
      check(cap.wordText.indexOf('MattSkills') >= 0, 'C3 状态胶囊栏里那枚品牌字样仍在（实测 ' + JSON.stringify(cap.wordText) + '）')
      check(cap.wordHasIcon, 'C4 状态胶囊栏里那枚品牌图标仍在')
      check(cap.foldPriority === '1' && cap.foldText === cap.wordText,
        'C5 品牌那一段仍是折叠优先级 1（最先收）（实测 priority ' + JSON.stringify(cap.foldPriority) + '）')
    }

    console.log('')
    console.log('E) 整行逐字折叠（按面板真实宽度跑，每 6 像素一档）：不许有超过一个字符的东西突然不见')
    // 做法照状态栏胶囊那一套：面板宽度是用户拖出来的，所以按头部这一行的真实可用宽度逐级收，不认视口宽度。
    //   档号 = 已经走了几步（阶梯表在 panel/headFold.js：先刷新的字、再时间标签、再仓库名、最后三颗小图标）。
    //   核心判据是维护者那句话的可执行版：任意相邻两档之间，版面上的**可见字符数最多减 1**。
    //   宽度从 900 一路收到 108（阶梯在这个宽度上正好走完：只剩齿轮与仓库名那个省略号；再窄就该溢出，
    //   而不是继续掉字了），每一档的实况都记下来。
    const MIN_W = 108
    const REL = /(刚刚|分钟前|小时前|天前|just now|min ago|h ago|d ago)/
    const TIP = /(上次更新|Updated)/
    const CLOCK = /(取数时刻|read at)\s*\d{2}:\d{2}/
    const samples = []
    let headErr = null
    for (let w = 900; w >= MIN_W; w -= 6) {
      const tier = await page.evaluate((x) => window.__SETTLE_WIDTH__(x), w)
      if (tier === null) { headErr = { error: 'no row at ' + w }; break }
      const m = await page.evaluate(() => window.__HEAD_ROW__())
      if (m && m.error) { headErr = m; break }
      samples.push({ w: w, m: m })
    }
    // 把面板宽度定到某一档，再悬停指定控件，读回悬停提示里所有字（提示是 fixed 定位的浮层，只在这时候才画）。
    //   每次先把鼠标挪开、等上一条提示收掉，免得读到上一条的残留。
    const tipAt = async function (w, sel) {
      await page.evaluate((x) => window.__SETTLE_WIDTH__(x), w)
      await page.mouse.move(3, 3)
      await page.waitForTimeout(320)
      await page.hover(sel)
      await page.waitForTimeout(700)
      const tips = await page.evaluate(() => Array.from(document.querySelectorAll('div'))
        .filter((el) => el.style && el.style.position === 'fixed' && el.style.zIndex === '2147483000')
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()))
      return tips.join(' | ')
    }
    if (headErr) {
      bad('E 没量到头部那一行：' + JSON.stringify(headErr))
    } else {
      // 先把这个宽度扫出来的阶梯表打印出来（报告要逐个元素列「宽度档 → 渲染成什么」，这张表就是它的出处）：
      //   每个档号第一次出现的那一档：宽度 → 仓库名 / 刷新的字 / 时间的字 / 小图标剩几颗。
      const firstAt = {}
      samples.forEach((s) => { if (!(s.m.tier in firstAt)) firstAt[s.m.tier] = s })
      console.log('     （宽度 → 渲染成什么；每档第一次出现的那一处）')
      Object.keys(firstAt).map(Number).sort((a, b) => a - b).forEach((t) => {
        const s = firstAt[t]
        console.log('       第 ' + t + ' 档 @ ' + s.w + 'px：仓库名 ' + JSON.stringify(s.m.name) + ' / 刷新的字 ' + JSON.stringify(s.m.refresh) + ' / 时间的字 ' + JSON.stringify(s.m.time) + ' / 小图标剩 ' + s.m.iconsLeft + ' 颗 / 齿轮在 ' + s.m.gearVisible)
      })
      console.log('     （窄段实况：宽度、档号、可见字符数、行溢出、clientWidth/scrollWidth、每个孩子的 宽@右缘）')
      samples.slice(-14).forEach((s) => {
        console.log('       ' + s.w + 'px 第' + s.m.tier + '档 字' + s.m.chars + ' 溢' + s.m.rowOverflow + ' cw' + s.m.clientW + ' sw' + s.m.scrollW + ' | 名span 宽' + s.m.nameRectW + ' 长' + s.m.nameTextLen + ' | 芯片孩子 ' + s.m.chipKids + ' | ' + s.m.kidRects)
      })
      // 一、核心判据：任意相邻两档之间，版面上那几个元素的可见字符数最多减 1
      let worst = null
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1].m, b = samples[i].m
        const drop = a.chars - b.chars
        if (!worst || drop > worst.drop) worst = { drop: drop, w: samples[i].w, from: a.name + '|' + a.refresh + '|' + a.time, to: b.name + '|' + b.refresh + '|' + b.time }
      }
      check(!!worst && worst.drop <= 1,
        'E1 任意相邻两档之间，版面上的可见字符数最多减 1（实测最多减 ' + (worst ? worst.drop : '?') + ' 个，出现在 ' + (worst ? worst.w : '?') + ' 像素那一档：' + JSON.stringify(worst ? worst.from : '') + ' → ' + JSON.stringify(worst ? worst.to : '') + '）')
      // 二、档号只升不降（同一个宽度上不来回跳）
      let maxTier = -1, monotone = true
      const tiers = samples.map((s) => s.m.tier)
      for (const n of tiers) { if (n < maxTier) monotone = false; if (n > maxTier) maxTier = n }
      check(monotone, 'E2 面板越窄档号只升不降（实测档号 ' + tiers.join(',') + '）')
      // 三、齿轮图标每一档都在（它是这个控件唯一还能点的入口，永不让位）
      const noGear = samples.filter((s) => s.m.gearVisible !== true).map((s) => s.w)
      check(noGear.length === 0, 'E3 刷新那颗齿轮图标每一档都在（最后一档也在；实测不在的宽度 ' + JSON.stringify(noGear) + '）')
      // 四、最窄那一档：仓库名只剩一个省略号记号、三颗小图标都撤了、刷新与时间的字都不剩
      const lastOne = samples[samples.length - 1]
      const lastS = lastOne.m
      check(lastS.tier === maxTier && lastS.name === '…' && lastS.iconsLeft === 0 && lastS.refresh === '' && lastS.time === '',
        'E4 最窄那一档只剩齿轮与仓库名那个省略号记号（实测 ' + JSON.stringify({ w: lastOne.w, tier: lastS.tier, name: lastS.name, refresh: lastS.refresh, time: lastS.time, iconsLeft: lastS.iconsLeft }) + '）')
      // 五、信息不丢：完整仓库名每一档都读得到（芯片的 aria-label 始终是完整那一串，不随宽度变短）
      const fullName = samples[0].m.name
      const nameBad = samples.filter((s) => s.m.chipAria !== fullName).map((s) => s.w)
      check(fullName.length > 10 && nameBad.length === 0,
        'E5 完整仓库名每一档都读得到（实测 ' + JSON.stringify(fullName) + '；对不上的宽度 ' + JSON.stringify(nameBad) + '）')
      // 六、信息不丢：完整的上次更新说法每一档都读得到（时间标签那条悬停提示始终带着完整说法与精确时刻）
      const timeBad = samples.filter((s) => !TIP.test(s.m.timeAria || '') || !CLOCK.test(s.m.timeAria || '')).map((s) => s.w)
      check(timeBad.length === 0,
        'E6 完整的上次更新说法每一档都读得到（实测第一档 ' + JSON.stringify(samples[0].m.timeAria) + '；不合格的宽度 ' + JSON.stringify(timeBad) + '）')
      // 七、版面上不出现整句说法（「上次更新」这类字只在悬停提示里）
      check(!TIP.test(samples[0].m.rowText),
        'E7 版面上不出现「上次更新」这类整句说法（实测这一行的字 ' + JSON.stringify(samples[0].m.rowText.slice(0, 90)) + '）')
      // 八、悬停抽查（最宽、最窄各一处，中间每 18 档抽一处）：芯片的提示里是完整仓库名；
      //   时间标签还在就悬停它、不在就悬停刷新按钮 —— 两条路的提示里都要有完整说法与精确时刻。
      const picks = samples.filter((s, i) => i === 0 || i === samples.length - 1 || i % 18 === 0)
      for (const s of picks) {
        const chipTip = await tipAt(s.w, '[data-repo-chip]')
        check(chipTip.indexOf(fullName) >= 0,
          'E8 悬停仓库芯片（' + s.w + ' 像素，第 ' + s.m.tier + ' 档）：提示里是完整仓库名（实测 ' + JSON.stringify(chipTip.slice(0, 120)) + '）')
        const onTime = s.m.time !== ''
        const rfTip = await tipAt(s.w, onTime ? '[data-head-updated]' : '[data-head-refresh]')
        check(TIP.test(rfTip) && REL.test(rfTip) && CLOCK.test(rfTip),
          'E9 悬停「' + (onTime ? '时间标签' : '刷新按钮') + '」（' + s.w + ' 像素，第 ' + s.m.tier + ' 档）：提示里仍有完整说法 + 相对时间 + 精确时刻（实测 ' + JSON.stringify(rfTip.slice(0, 140)) + '）')
      }
    }

    console.log('')
    console.log('D) 反证：把改动前那一段插回头部最前面，B 的那几条必须当场变红')
    const ins = await page.evaluate(() => window.__INSERT_OLD_BRAND__())
    if (ins.error) {
      bad('D 反证没插进去：' + JSON.stringify(ins))
    } else {
      const a = await page.evaluate(() => window.__MEASURE__())
      check(a.ok && a.firstIsChip === false, 'D1 插回品牌之后，第一个元素不再是仓库芯片了（这道门量的确实是当场那一行）')
      check(a.ok && a.chipLeftGap > 1, 'D2 插回品牌之后，仓库芯片被那段字挤到了右边（实测芯片左偏 ' + a.chipLeftGap + ' 像素 —— 旧写法下 B2 那条会红）')
      check(a.ok && a.rowText.indexOf(ins.brandWord) >= 0, 'D3 插回品牌之后整行读到了品牌字样（' + JSON.stringify(ins.brandWord) + ' —— B3 那条在旧写法下会红）')
      check(a.ok && a.hasCompass === true, 'D4 插回品牌之后整行读到了罗盘图形（B4 那条在旧写法下会红）')
    }
  }
  await page.close()
} finally {
  await browser.close()
  await new Promise((r) => server.close(r))
}

console.log('')
console.log(passed + ' 条通过，' + failed + ' 条失败')
console.log(failed ? '=== FAIL：面板头部还不是「从仓库芯片开始」的样子 ===' : '=== OK：#667 面板头部无品牌、两处照旧 ===')
process.exit(failed ? 1 : 0)
