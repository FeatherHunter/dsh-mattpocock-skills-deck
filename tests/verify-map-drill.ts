// verify-map-drill.ts — #555 地图下钻与返回全链路验证矩阵（T5 收尾验证，只加检查不改业务导航逻辑）
// 矩阵各节：地图进普通工单再返回地图、地图进地图再返回上一级、四层混合链逐级返回、
// 雾态去雾与下钻共存、已关闭按标签分流（真只读留后续）、
// 深栈面包屑字符串（含单层列表形态与超两级省略形态，根走主列表页签词条）、
// 技能页签最近地图祖先、子票种类分流、空快照回落、双产物同步。
// 原来那些「读源码文本钉写法」的断言（两处返回直调弹栈的写法、enterDetail 里不许出现的词、
// 评论输入那段切片、onNodeClick 里两句的先后顺序、面包屑根不许出现的字面量、技能页签里的引号写法）
// 已按维护者要求删除，删处各留一行说明。
// 另有行进详情再返回端到端：真分流函数压栈、真返回函数弹栈，闭环回到出发层。
// 手法：凡是行为级断言，跑的都是从源文件里原文截出来的函数体（花括号配平截取后求值），
// 配真实压栈弹栈函数与记录桩；不是照着源码另写一份仿品，所以源码改错名字或改错分支会直接变红。
// 用法: node tests/verify-map-drill.ts（在插件根目录）
const fs = require('fs')
const { compileFn } = require('./lib/eval-probe.js')
// 中央时间真值：缓存 TTL 只住 config/*.yaml，这里读同一份导出来预埋，不在测试里写第二份数字。
const centralTime = require('../src/shared/time-config/values.js')
globalThis.SYNC_ISSUE_CACHE_TTL_MS = centralTime.SYNC_ISSUE_CACHE_TTL_MS
// 取源走共用入口（#1207 立的 tests/lib/source-text.ts）：locale-panel 已从 .js 转成 .ts，
// 按旧路径直接读会读到构建产物（字符串改双引号），下面只认单引号的断言会误报，所以按文本形状
// 扫描的地方走 sourceText；要当函数求值的片段走 spliceableJs（按构建唯一口径转译真源再拼接）。
const { sourceText, spliceableJs } = require('./lib/source-text.ts')
// 沙箱跑裸 JS，身份函数是全标注 TS：转译口径取仓库唯一那一份
// （scripts/lib/transpile-unit.mts，手法照 tests/verify-build-artifacts.ts）。
const esbuildForProbe = require('esbuild')
const tuForProbe = require(require('path').resolve('scripts/lib/transpile-unit.mts'))

// effort 维度（2026-09-09）：面板里身份函数来自拼接进闭包的 shared/tracker/constants.js。
// 本门禁把同一份原文取出来，拼进每个求值沙箱，保证「跑的是真函数」这条纪律不破。
// #1026：四个身份函数（effortOf / idOfParts / idOf，refKeyOf 另见 multi-effort-panel）
// 已从契约目录搬到 src/tracker/kernel/identity-keys.ts（契约目录只留类型与数据），真源跟过去。
const constantsSrc = fs.readFileSync('src/tracker/kernel/identity-keys.ts', 'utf8')
const identitySrc = ['effortOf', 'idOfParts', 'idOf'].map((n) => {
  const m = new RegExp('export function ' + n + '\\([\\s\\S]*?\\n\\}').exec(constantsSrc)
  if (!m) throw new Error('identity-keys.ts 缺 ' + n)
  return esbuildForProbe.transformSync(m[0].replace(/^export /, ''), tuForProbe.TRANSPILE_OPTIONS).code
}).join('\n')
// 面板里的「按身份找地图」已收进 store-derived.ts 的真源，沙箱同样带真源码：取源走共用入口，
// 由它按构建口径转译后再交给下面的截取（旁边那份 store-derived.js 是构建产物，不能直接读）。
const derivedSrc = spliceableJs('src/client/kernel/store-derived.js')
const findMapByIdentitySrc = (function () {
  const i = derivedSrc.indexOf('const findMapByIdentity =')
  if (i < 0) throw new Error('store-derived.js 缺 findMapByIdentity')
  const brace = derivedSrc.indexOf('{', i)
  let depth = 0, inStr = null
  for (let k = brace; k < derivedSrc.length; k++) {
    const c = derivedSrc[k]
    if (inStr) { if (c === '\\') { k++; continue } if (c === inStr) inStr = null; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return derivedSrc.slice(i, k + 1) }
  }
  throw new Error('findMapByIdentity 截取失败')
})()
const withIdentity = (src) => identitySrc + '\n' + findMapByIdentitySrc + '\n' + src
// IssueDetail 的 issueEffort 是组件级常量（门禁只截函数体），沙箱里补一个同语义兜底
const withIssueEffort = (src) => 'const issueEffort = \'\'\n' + withIdentity(src)
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// —— 截取工具：从源码里按 const 名字取出一整段声明（自动跳过字符串与注释里的花括号）
function extractConst (src, name) {
  const key = 'const ' + name + ' ='
  const i = src.indexOf(key)
  if (i < 0) throw new Error('源码缺 ' + name)
  const semi = src.indexOf(';', i)
  const brace = src.indexOf('{', i)
  if (brace < 0 || (semi >= 0 && semi < brace)) return src.slice(i, semi + 1) // 单行（无花括号，如 canDrill）
  let depth = 0
  let inStr = null
  for (let k = brace; k < src.length; k++) {
    const c = src[k]
    if (inStr) {
      if (c === '\\') { k++; continue }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '/' && src[k + 1] === '/') { const nl = src.indexOf('\n', k); k = nl < 0 ? src.length : nl; continue }
    if (c === '/' && src[k + 1] === '*') { const e = src.indexOf('*/', k + 2); k = e < 0 ? src.length : e + 1; continue }
    if (c === '{') depth++
    if (c === '}') { depth--; if (depth === 0) return src.slice(i, k + 1) }
  }
  throw new Error(name + ' 花括号未配平')
}
// —— 截取立即执行的小算式（如面包屑与推荐源）：取 const 开头到首个 })() 为止
function extractIife (src, name) {
  const key = 'const ' + name + ' ='
  const i = src.indexOf(key)
  if (i < 0) throw new Error('源码缺 ' + name)
  const e = src.indexOf('})()', i)
  if (e < 0) throw new Error(name + ' 不是立即执行形态')
  return src.slice(i, e + 4)
}

// 2026-10-17 起取源统一走共用入口的 spliceableJs：参数仍写 .js 说明符（同名 .ts 优先），
//   由它按构建唯一口径转译真源，门禁看到的就是真正拼进产物的那份源码。
//   视图树与客户端内核里「同名 .js 产物 + .ts 真源」并排的文件都这么取；store-prefs.js / store-derived.js
//   的真源现在也已就位，不再直接 readFileSync 旁边那份产物（产物没重建时会静默停在旧文本上）。
const mapSrc = spliceableJs('src/client/views/MapDetail.js')
const issueSrc = spliceableJs('src/client/views/IssueDetail.js')
// 子票/阻塞票分流判定已从 IssueDetail.js 抽到 subIssueRouting.js（2026-10-21 拆行数超标文件），
// 那条端到端断言仍跑真函数，只是取源改成新文件。
const subIssueSrc = spliceableJs('src/client/views/subIssueRouting.js')
const skillSrc = spliceableJs('src/client/views/SkillsTab.js')
const prefsSrc = spliceableJs('src/client/kernel/store-prefs.js')

// —— 真实导航函数（与 verify-nav-stack 同一加载手法：注入 emit 桩）。行首 export 与中央时间 import
//    已在共用入口里按构建口径处理过，下面这步沿用旧写法、实际是空操作，留着只为两份门禁逐字对齐。
const srcNoExport = prefsSrc.replace(/^\s*export\s+/gm, '').split('\n').filter((l) => !/^\s*import\s.*time-config\/values\.js/.test(l)).join('\n')
// 手法：compileFn——本文件全都是把真源里截出来的函数文本变成可调用对象，统一交给 tests/lib/eval-probe.js，行为不变。
const nav = compileFn(['emit'], srcNoExport + '\nreturn { peekNav, pushNav, popNav }')(
  function (st) { st.tick = (st.tick || 0) + 1 }
)
const eqStack = (st, arr) => JSON.stringify(st.navStack) === JSON.stringify(arr)

// ============ 一、四层混合链逐级返回（含两种两层链） ============
let st = { activeMap: null, activeIssue: null, navStack: [], tick: 0 }
nav.pushNav(st, 'map', 10); nav.pushNav(st, 'issue', 20); nav.pushNav(st, 'map', 30); nav.pushNav(st, 'issue', 40)
check(eqStack(st, [{ kind: 'map', n: 10, effortId: '' }, { kind: 'issue', n: 20, effortId: '' }, { kind: 'map', n: 30, effortId: '' }, { kind: 'issue', n: 40, effortId: '' }]), '矩阵：四层混合链压栈保留完整返回路（地图10/工单20/地图30/工单40）')
nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 10, effortId: '' }, { kind: 'issue', n: 20, effortId: '' }, { kind: 'map', n: 30, effortId: '' }]) && st.activeMap === 30 && st.activeIssue === null, '矩阵：四层链返回先回到地图30')
nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 10, effortId: '' }, { kind: 'issue', n: 20, effortId: '' }]) && st.activeIssue === 20 && st.activeMap === null, '矩阵：四层链再返回回到工单20')
nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 10, effortId: '' }]) && st.activeMap === 10 && st.activeIssue === null, '矩阵：四层链再返回回到地图10')
nav.popNav(st)
check(eqStack(st, []) && st.activeMap === null && st.activeIssue === null, '矩阵：四层链退空栈回列表')

st = { activeMap: null, activeIssue: null, navStack: [], tick: 0 }
nav.pushNav(st, 'map', 550); nav.pushNav(st, 'issue', 7); nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 550, effortId: '' }]) && st.activeMap === 550 && st.activeIssue === null, '矩阵：地图进普通工单再返回，回到地图550')
st = { activeMap: null, activeIssue: null, navStack: [], tick: 0 }
nav.pushNav(st, 'map', 550); nav.pushNav(st, 'map', 551); nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 550, effortId: '' }]) && st.activeMap === 550, '矩阵：地图进下一级地图再返回，回到上一级550')

// ============ 一补、行进详情再返回端到端（真分流函数进，真返回函数出） ============
const e2eMapSrc = ['hasMapTag', 'enterDetail', 'goBack'].map((n) => extractConst(mapSrc, n)).join('\n')
const e2eSubSrc = ['subLabelsOf', 'subHasRoutingInfo', 'subHasMapTag', 'enterSubDetail'].map((n) => extractConst(subIssueSrc, n)).join('\n') + '\n// 新文件里的 enterSubDetail 显式收 st 与 effort；沙箱外层已有这两个名字，包一层保持原调用形状\nconst enterSubDetailBound = function (x) { return enterSubDetail(st, x, issueEffort) }\n' + extractConst(issueSrc, 'goBack').replace('const goBack =', 'const goBackIssue =')
const runE2E2 = (bundle, names, t, seedStack, maps) => {
  const s = { activeMap: null, activeIssue: null, navStack: seedStack.map((e) => ({ kind: e[0], n: e[1], effortId: '' })), tick: 0, snapshot: { maps: maps } }
  // 手法：compileFn——同上，参数名收进数组传给共用入口。
  const fn = compileFn(['st', 'pushNav', 'popNav'], (names.indexOf('enterSubDetail') >= 0 ? withIssueEffort(bundle) : withIdentity(bundle)) + '\nreturn { ' + names + ' }')
  return { s: s, api: fn(s, function (a, k, n, e) { return nav.pushNav(a, k, n, e) }, function (a) { return nav.popNav(a) }) }
}
let e = runE2E2(e2eMapSrc, 'enterDetail, goBack', null, [['map', 550]], [{ number: 550 }])
e.api.enterDetail({ number: 7, labels: [{ name: 'bug' }], state: 'OPEN' })
check(eqStack(e.s, [{ kind: 'map', n: 550, effortId: '' }, { kind: 'issue', n: 7, effortId: '' }]), '端到端：地图行进普通工单压栈')
e.api.goBack()
check(eqStack(e.s, [{ kind: 'map', n: 550, effortId: '' }]) && e.s.activeMap === 550, '端到端：工单返回弹栈回到地图550')
e = runE2E2(e2eMapSrc, 'enterDetail, goBack', null, [['map', 550]], [{ number: 550 }, { number: 551 }])
e.api.enterDetail({ number: 551, labels: [{ name: 'wayfinder:map' }], state: 'OPEN' })
check(eqStack(e.s, [{ kind: 'map', n: 550, effortId: '' }, { kind: 'map', n: 551, effortId: '' }]), '端到端：地图行进下一级地图压栈')
e.api.goBack()
check(eqStack(e.s, [{ kind: 'map', n: 550, effortId: '' }]) && e.s.activeMap === 550, '端到端：地图返回弹栈回到上一级550')
e = runE2E2(e2eSubSrc, 'enterSubDetailBound, goBackIssue', null, [['issue', 20]], [{ number: 551 }])
e.api.enterSubDetailBound({ number: 551, labels: [{ name: 'wayfinder:map' }] })
check(eqStack(e.s, [{ kind: 'issue', n: 20, effortId: '' }, { kind: 'map', n: 551, effortId: '' }]), '端到端：子票按标签进地图压栈')
e.api.goBackIssue()
check(eqStack(e.s, [{ kind: 'issue', n: 20, effortId: '' }]) && e.s.activeIssue === 20, '端到端：子票层返回弹栈回到工单20')

// effort 维度：子票自带 effortId 时，压栈坐标必须带上它（同号票在不同 effort 里是两张票）
e = runE2E2(e2eSubSrc, 'enterSubDetailBound, goBackIssue', null, [['issue', 20]], [{ number: 551 }])
e.api.enterSubDetailBound({ number: 551, effortId: 'beta', labels: [{ name: 'wayfinder:map' }] })
check(eqStack(e.s, [{ kind: 'issue', n: 20, effortId: '' }, { kind: 'map', n: 551, effortId: 'beta' }]), '端到端 B：子票带 effortId 时压栈坐标带该 effort')

// 原来的「二、两处返回直调弹栈」已按维护者要求删除：它把 MapDetail.js / IssueDetail.js 里的 goBack
// 抠出来当文本比对（要求恰好写成 function () { popNav(st) }、不许出现 clearActive），盯的是写法。
// 返回弹栈的行为改由第一节的端到端断言（真跑 enterDetail / goBack）与第五节的深栈面包屑覆盖。

// ============ 三、地图行分流行为（跑地图源文件里截出来的真函数） ============
const mapBundleSrc = ['hasMapTag', 'enterDetail'].map((n) => extractConst(mapSrc, n)).join('\n')
const runEnter = (t, maps) => {
  const s = { activeMap: 550, activeIssue: null, navStack: [{ kind: 'map', n: 550, effortId: '' }], tick: 0, snapshot: maps === null ? undefined : { maps: maps || [{ number: 550 }, { number: 551 }] } }
  const log = []
  const pushStub = (a, k, n, e) => { log.push([k, n]); return nav.pushNav(a, k, n, e) }
  // 手法：compileFn——同上。
  const fn = compileFn(['st', 'pushNav'], withIdentity(mapBundleSrc) + '\nreturn { enterDetail }')
  fn(s, pushStub).enterDetail(t)
  return { s: s, last: log[log.length - 1] }
}
check(JSON.stringify(runEnter({ number: 7, labels: [{ name: 'bug' }], state: 'OPEN' }).last) === JSON.stringify(['issue', 7]), '矩阵：无地图标签进普通工单详情')
check(JSON.stringify(runEnter({ number: 551, labels: [{ name: 'wayfinder:map' }], state: 'OPEN' }).last) === JSON.stringify(['map', 551]), '矩阵：对象写法地图标签进下一级地图详情')
check(JSON.stringify(runEnter({ number: 551, labels: ['wayfinder:map'], state: 'OPEN' }).last) === JSON.stringify(['map', 551]), '矩阵：字符串写法地图标签同样进地图详情')
check(JSON.stringify(runEnter({ number: 551, type: 'map', labels: [], state: 'OPEN' }).last) === JSON.stringify(['map', 551]), '矩阵：类型字段为地图同样进地图详情')
check(JSON.stringify(runEnter({ number: 8, labels: [{ name: 'wayfinder:research' }], state: 'OPEN' }).last) === JSON.stringify(['issue', 8]), '矩阵：其他向导标签不算地图，进普通工单详情')
check(JSON.stringify(runEnter({ number: 999, labels: [{ name: 'wayfinder:map' }], state: 'OPEN' }).last) === JSON.stringify(['issue', 999]), '矩阵：有地图标签但快照缺图，回落普通工单详情')
check(JSON.stringify(runEnter({ number: 551, labels: [{ name: 'wayfinder:map' }], state: 'OPEN' }, null).last) === JSON.stringify(['issue', 551]), '矩阵：空快照回落普通工单详情（有字可看，不静默回列表）')
check(JSON.stringify(runEnter({ number: 551, labels: [{ name: 'wayfinder:map' }], state: 'CLOSED' }).last) === JSON.stringify(['map', 551]), '矩阵：已关闭有地图标签同样进地图详情（按标签分流）')
check(JSON.stringify(runEnter({ number: 9, labels: [], state: 'CLOSED' }).last) === JSON.stringify(['issue', 9]), '矩阵：已关闭无标签进普通工单详情')
// 这里原来还有三条文本断言：要求 enterDetail 的源码里不出现 'CLOSED' / 'state'、要求 IssueDetail.js
// 里有 readOnlyHint 字符串、把评论输入那一段（let canComment 到 canComment = false）切出来查里面的词。
// 它们盯的是这几份源码写成什么样，已按维护者要求删除；分流行为由上面九条真跑 enterDetail 的断言覆盖。

// ============ 四、雾态去雾与下钻共存（跑地图源文件里截出来的真函数） ============
const fogBundleSrc = ['hasMapTag', 'enterDetail', 'isFog', 'isFogTitle', 'isRevealed', 'toggleReveal', 'onNodeClick'].map((n) => extractConst(mapSrc, n)).join('\n')
const fogM = { number: 550, key: '550', tickets: [
  { number: 1, key: '1', title: '先做', labels: [], state: 'OPEN', blockedBy: [] },
  { number: 2, key: '2', title: '被挡住', labels: [], state: 'OPEN', blockedBy: [1] },
  { number: 3, key: '3', title: '能做', labels: [], state: 'OPEN', blockedBy: [] },
] }
const runClick = (t, drill) => {
  const s = { activeMap: 550, activeIssue: null, navStack: [{ kind: 'map', n: 550, effortId: '' }], tick: 0, snapshot: { maps: [{ number: 550, key: '550' }] }, reveal: {} }
  const log = []
  const pushStub = (a, k, n, e) => { log.push([k, n]); return nav.pushNav(a, k, n, e) }
  const emits = []
  // 手法：compileFn——同上；那段前置声明是代码文本的一部分，照旧拼在同一个函数体里。
  const fn = compileFn(['st', 'm', 'tickets', 'fogTitles', 'drill', 'emit', 'pushNav'], 'const canDrill = drill !== false\nconst mId = idOf(m)\n' + withIdentity(fogBundleSrc) + '\nreturn { onNodeClick, isFog }')
  const api = fn(s, fogM, fogM.tickets, [], drill !== false ? true : false, function (x) { emits.push(1); x.tick = (x.tick || 0) + 1 }, pushStub)
  api.onNodeClick(t)
  return { s: s, log: log, api: api }
}
const fogT = fogM.tickets[1]
const plainT = fogM.tickets[2]
let r = runClick(fogT, true)
check(r.log.length === 0 && r.s.reveal['550'] && r.s.reveal['550']['2'] === true, '矩阵：被雾盖住的行第一次点击只去雾，不进详情')
r.api.onNodeClick(fogT)
check(JSON.stringify(r.log[r.log.length - 1]) === JSON.stringify(['issue', 2]), '矩阵：去雾后第二次点击同一行才进详情')
r = runClick(plainT, true)
check(JSON.stringify(r.log[r.log.length - 1]) === JSON.stringify(['issue', 3]), '矩阵：没有雾的行直接进详情')
r = runClick(plainT, false)
check(r.log.length === 0, '矩阵：悬浮面板内点行不压栈（只展示与去雾）')
r = runClick(fogT, false)
check(r.log.length === 0 && r.s.reveal['550'] && r.s.reveal['550']['2'] === true, '矩阵：悬浮面板内雾行第一次点击照常去雾')
const closedT = { number: 4, title: '已关', labels: [], state: 'CLOSED', blockedBy: [1] }
r = runClick(closedT, true)
check(JSON.stringify(r.log[r.log.length - 1]) === JSON.stringify(['issue', 4]), '矩阵：已关闭的行不算雾，直接按标签分流')
// 这里原来还断言 onNodeClick 的源码文本里 toggleReveal 写在 enterDetail 前面（顺序钉在写法上），
// 已按维护者要求删除；「先去雾、再下钻」这个顺序由上面真跑 onNodeClick 的那几条断言覆盖。

// ============ 五、深栈面包屑字符串（跑两处源文件里截出来的真算式） ============
// 面包屑根复用主列表页签词条（中英齐备），测试里用中文取值的桩代入，另单查词条双语一致。
const zhTr = (k) => k === 'panel.tabList' ? '列表' : k
const locPanelSrc = sourceText('src/client/kernel/locale-panel.js')
// 原来这里还断言 mapSrc / issueSrc 的源码里不出现 '列表 / #' 这个中文字面量（盯写法），
// 已按维护者要求删除；面包屑根走词条这件事由下面那一条读 locale 数据的断言负责。
check(locPanelSrc.includes("'panel.tabList': '列表'") && locPanelSrc.includes("'panel.tabList': 'List'"), '矩阵：面包屑根复用主列表页签词条，中英齐备')
const mapCrumbSrc = extractIife(mapSrc, 'navCrumb')
const issueCrumbSrc = extractIife(issueSrc, 'navCrumb')
// 手法：compileFn——面包屑算式同样是切出来的文本，走共用入口造函数。
const mapCrumb = (stack, num) => compileFn(['st', 'm', 'tr'], mapCrumbSrc + '\nreturn navCrumb')({ navStack: stack }, { number: num }, zhTr)
// 手法：compileFn——同上。
const issueCrumb = (stack, num) => compileFn(['st', 'issueNumber', 'tr'], issueCrumbSrc + '\nreturn navCrumb')({ navStack: stack }, num, zhTr)
check(mapCrumb([], 550) === '列表 / #550', '矩阵：地图面包屑空栈为单层列表形态')
check(mapCrumb([{ kind: 'map', n: 550, effortId: '' }], 550) === '列表 / #550', '矩阵：地图面包屑单层仍为列表形态')
check(mapCrumb([{ kind: 'map', n: 550, effortId: '' }, { kind: 'map', n: 551, effortId: '' }], 551) === '#550 / #551', '矩阵：地图进地图显示上一级与当前级')
check(mapCrumb([{ kind: 'map', n: 1, effortId: '' }, { kind: 'issue', n: 2, effortId: '' }, { kind: 'map', n: 3, effortId: '' }], 3) === '… / #2 / #3', '矩阵：超两级省略只留直接上一级与当前级')
check(mapCrumb([{ kind: 'map', n: 1, effortId: '' }, { kind: 'map', n: 2, effortId: '' }, { kind: 'map', n: 1, effortId: '' }], 1) === '… / #2 / #1', '矩阵：先后经过同一编号不合并，超两级仍省略并显示直接上一级')
// #845：这里原来期望 '列表 / #20'。产品在 #763 的 C 方案里**有意**去掉了「列表 /」前缀（源码注释原话：
//   「#763 C 方案，"列表"二字多余」），单层工单面包屑现在就画 '#20'。旧期望没跟着改，这条断言成了恒红。
check(issueCrumb([{ kind: 'issue', n: 20, effortId: '' }], 20) === '#20', '矩阵：工单面包屑单层为 #20（#763 C 方案有意去掉「列表 /」前缀）')
check(issueCrumb([{ kind: 'map', n: 10, effortId: '' }, { kind: 'issue', n: 20, effortId: '' }], 20) === '#10 / #20', '矩阵：地图进工单显示地图与工单编号')
check(issueCrumb([{ kind: 'map', n: 1, effortId: '' }, { kind: 'issue', n: 2, effortId: '' }, { kind: 'map', n: 3, effortId: '' }, { kind: 'issue', n: 4, effortId: '' }], 4) === '… / #3 / #4', '矩阵：四层混合链顶层面包屑为省略形态')

// ============ 六、技能页签最近地图祖先（2026-10-17 先修：整节删除） ============
// 这一节的六条断言跑的是「技能页签从导航栈取最近地图祖先」（recMapNum 算式）。该行为已按 #1201 方案一
// 有意删除：src/client/views/SkillsTab.ts:20-24 的注释写明「技能页不再读地图导航栈，推荐固定为通用建议加
// /ask-matt」——切页签不清栈，残留的地图标题会把技能页标题顶掉。src 全树与两份产物里 recMapNum 均已 0 处，
// 这六条断言的被测对象不复存在（留着必然恒红、更不能靠改期望值来「修绿」）。要恢复技能页读栈再开票。
// 下面余下的断言（四层混合链、端到端 enterDetail/goBack、行分流、雾态、面包屑、子票分流）都真跑真源码。

// ============ 七、子票与阻塞票种类分流（跑工单源文件里截出来的真函数） ============
const subBundleSrc = ['subLabelsOf', 'subHasRoutingInfo', 'subHasMapTag', 'enterSubDetail'].map((n) => extractConst(subIssueSrc, n)).join('\n') + '\nconst enterSubDetailBound = function (x) { return enterSubDetail(st, x, issueEffort) }'
const runSub = (x, maps) => {
  const s = { activeMap: null, activeIssue: 20, navStack: [{ kind: 'issue', n: 20, effortId: '' }], tick: 0, snapshot: maps === null ? undefined : { maps: maps || [{ number: 551 }] } }
  const log = []
  const pushStub = (a, k, n, e) => { log.push([k, n]); return nav.pushNav(a, k, n, e) }
  // 手法：compileFn——同上。
  const fn = compileFn(['st', 'pushNav'], withIssueEffort(subBundleSrc) + '\nreturn { enterSubDetailBound }')
  fn(s, pushStub).enterSubDetailBound(x)
  return log[log.length - 1]
}
check(JSON.stringify(runSub({ number: 551, labels: { nodes: [{ name: 'wayfinder:map' }] } })) === JSON.stringify(['map', 551]), '矩阵：子票对象标签加接口形状按标签进地图')
check(JSON.stringify(runSub({ number: 551, labels: ['wayfinder:map'] })) === JSON.stringify(['map', 551]), '矩阵：子票字符串标签进地图')
check(JSON.stringify(runSub({ number: 551, labels: [{ name: 'wayfinder:map' }] }, [])) === JSON.stringify(['issue', 551]), '矩阵：子票有地图标签但快照缺图回落工单')
check(JSON.stringify(runSub({ number: 8, labels: [{ name: 'bug' }] })) === JSON.stringify(['issue', 8]), '矩阵：子票普通标签进工单')
check(JSON.stringify(runSub({ number: 551, title: '子图', state: 'OPEN' })) === JSON.stringify(['map', 551]), '矩阵：无标签阻塞票按快照找图，找得到进地图')
check(JSON.stringify(runSub({ number: 999, title: '他票', state: 'OPEN' })) === JSON.stringify(['issue', 999]), '矩阵：无标签阻塞票快照找不到回落工单')
check(JSON.stringify(runSub({ number: 551, labels: [{ name: 'wayfinder:map' }] }, null)) === JSON.stringify(['issue', 551]), '矩阵：空快照下子票回落工单')

// ============ 八、双产物同步 ============
const cli = fs.readFileSync('client.js', 'utf8')
const pcli = fs.readFileSync('package/lib/client.js', 'utf8')
// #646：页内浮窗退役后不再有 drill:false 那一处传参（面板只有右侧边栏一处，压栈规则由 Dock 的 peekNav 承担）
;['enterDetail', 'enterSubDetail', 'navCrumb', 'canDrill'].forEach((k) => { // 2026-10-17 先修：数组里的 'recMapNum' 随第六节一起删（该行为已按 #1201 方案一移除）
  check(cli.includes(k) && pcli.includes(k), '矩阵：双产物含 ' + k)
})
check(cli.includes('… / ') && pcli.includes('… / '), '矩阵：双产物含超深省略号面包屑')
// #1253：视图转 TypeScript 后产物由 esbuild 生成，字符串统一成双引号，这里改成两种引号都认的判据。
check(/tr\(["']panel\.tabList["']\)/.test(cli) && /tr\(["']panel\.tabList["']\)/.test(pcli), '矩阵：双产物面包屑根走词条')

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
