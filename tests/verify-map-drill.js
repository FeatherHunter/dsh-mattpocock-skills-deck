// verify-map-drill.js — #555 地图下钻与返回全链路验证矩阵（T5 收尾验证，只加检查不改业务导航逻辑）
// 矩阵十项：地图进普通工单再返回地图、地图进地图再返回上一级、四层混合链逐级返回、
// 雾态去雾与下钻共存、已关闭按标签分流（只读提示字符串保留，真只读留后续）、
// 深栈面包屑字符串（含单层列表形态与超两级省略形态，根走主列表页签词条）、
// 技能页签最近地图祖先、两处返回直调弹栈、子票种类分流、空快照回落。
// 另有行进详情再返回端到端：真分流函数压栈、真返回函数弹栈，闭环回到出发层。
// 手法：凡是行为级断言，跑的都是从源文件里原文截出来的函数体（花括号配平截取后求值），
// 配真实压栈弹栈函数与记录桩；不是照着源码另写一份仿品，所以源码改错名字或改错分支会直接变红。
// 用法: node tests/verify-map-drill.js（在插件根目录）
const fs = require('fs')
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

const mapSrc = fs.readFileSync('src/client/views/MapDetail.js', 'utf8')
const issueSrc = fs.readFileSync('src/client/views/IssueDetail.js', 'utf8')
const skillSrc = fs.readFileSync('src/client/views/SkillsTab.js', 'utf8')
const prefsSrc = fs.readFileSync('src/client/kernel/store-prefs.js', 'utf8')

// —— 真实导航函数（与 verify-nav-stack 同一加载手法：去行首 export，注入 emit 桩）
const srcNoExport = prefsSrc.replace(/^\s*export\s+/gm, '')
const nav = new Function('emit', srcNoExport + '\nreturn { peekNav, pushNav, popNav }')(
  function (st) { st.tick = (st.tick || 0) + 1 }
)
const eqStack = (st, arr) => JSON.stringify(st.navStack) === JSON.stringify(arr)

// ============ 一、四层混合链逐级返回（含两种两层链） ============
let st = { activeMap: null, activeIssue: null, navStack: [], tick: 0 }
nav.pushNav(st, 'map', 10); nav.pushNav(st, 'issue', 20); nav.pushNav(st, 'map', 30); nav.pushNav(st, 'issue', 40)
check(eqStack(st, [{ kind: 'map', n: 10 }, { kind: 'issue', n: 20 }, { kind: 'map', n: 30 }, { kind: 'issue', n: 40 }]), '矩阵：四层混合链压栈保留完整返回路（地图10/工单20/地图30/工单40）')
nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 10 }, { kind: 'issue', n: 20 }, { kind: 'map', n: 30 }]) && st.activeMap === 30 && st.activeIssue === null, '矩阵：四层链返回先回到地图30')
nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 10 }, { kind: 'issue', n: 20 }]) && st.activeIssue === 20 && st.activeMap === null, '矩阵：四层链再返回回到工单20')
nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 10 }]) && st.activeMap === 10 && st.activeIssue === null, '矩阵：四层链再返回回到地图10')
nav.popNav(st)
check(eqStack(st, []) && st.activeMap === null && st.activeIssue === null, '矩阵：四层链退空栈回列表')

st = { activeMap: null, activeIssue: null, navStack: [], tick: 0 }
nav.pushNav(st, 'map', 550); nav.pushNav(st, 'issue', 7); nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 550 }]) && st.activeMap === 550 && st.activeIssue === null, '矩阵：地图进普通工单再返回，回到地图550')
st = { activeMap: null, activeIssue: null, navStack: [], tick: 0 }
nav.pushNav(st, 'map', 550); nav.pushNav(st, 'map', 551); nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 550 }]) && st.activeMap === 550, '矩阵：地图进下一级地图再返回，回到上一级550')

// ============ 一补、行进详情再返回端到端（真分流函数进，真返回函数出） ============
const e2eMapSrc = ['hasMapTag', 'findMapInSnapshot', 'enterDetail', 'goBack'].map((n) => extractConst(mapSrc, n)).join('\n')
const e2eSubSrc = ['subLabelsOf', 'subHasRoutingInfo', 'subHasMapTag', 'findMapLocal', 'enterSubDetail'].map((n) => extractConst(issueSrc, n)).join('\n') + '\n' + extractConst(issueSrc, 'goBack').replace('const goBack =', 'const goBackIssue =')
const runE2E2 = (bundle, names, t, seedStack, maps) => {
  const s = { activeMap: null, activeIssue: null, navStack: seedStack.map((e) => ({ kind: e[0], n: e[1] })), tick: 0, snapshot: { maps: maps } }
  const fn = new Function('st', 'pushNav', 'popNav', bundle + '\nreturn { ' + names + ' }')
  return { s: s, api: fn(s, function (a, k, n) { return nav.pushNav(a, k, n) }, function (a) { return nav.popNav(a) }) }
}
let e = runE2E2(e2eMapSrc, 'enterDetail, goBack', null, [['map', 550]], [{ number: 550 }])
e.api.enterDetail({ number: 7, labels: [{ name: 'bug' }], state: 'OPEN' })
check(eqStack(e.s, [{ kind: 'map', n: 550 }, { kind: 'issue', n: 7 }]), '端到端：地图行进普通工单压栈')
e.api.goBack()
check(eqStack(e.s, [{ kind: 'map', n: 550 }]) && e.s.activeMap === 550, '端到端：工单返回弹栈回到地图550')
e = runE2E2(e2eMapSrc, 'enterDetail, goBack', null, [['map', 550]], [{ number: 550 }, { number: 551 }])
e.api.enterDetail({ number: 551, labels: [{ name: 'wayfinder:map' }], state: 'OPEN' })
check(eqStack(e.s, [{ kind: 'map', n: 550 }, { kind: 'map', n: 551 }]), '端到端：地图行进下一级地图压栈')
e.api.goBack()
check(eqStack(e.s, [{ kind: 'map', n: 550 }]) && e.s.activeMap === 550, '端到端：地图返回弹栈回到上一级550')
e = runE2E2(e2eSubSrc, 'enterSubDetail, goBackIssue', null, [['issue', 20]], [{ number: 551 }])
e.api.enterSubDetail({ number: 551, labels: [{ name: 'wayfinder:map' }] })
check(eqStack(e.s, [{ kind: 'issue', n: 20 }, { kind: 'map', n: 551 }]), '端到端：子票按标签进地图压栈')
e.api.goBackIssue()
check(eqStack(e.s, [{ kind: 'issue', n: 20 }]) && e.s.activeIssue === 20, '端到端：子票层返回弹栈回到工单20')

// ============ 二、两处返回直调弹栈（判别式：要求直接调用，不用或条件） ============
const mapGoBack = extractConst(mapSrc, 'goBack')
const issueGoBack = extractConst(issueSrc, 'goBack')
check(mapGoBack.replace(/\s+/g, ' ').includes('function () { popNav(st) }'), '矩阵：地图详情返回直调弹栈（只退一层）')
check(issueGoBack.replace(/\s+/g, ' ').includes('function () { popNav(st) }'), '矩阵：工单详情返回直调弹栈（只退一层）')
check(!mapGoBack.includes('clearActive') && !issueGoBack.includes('clearActive'), '矩阵：两处返回都不绕旧按种类守卫入口（混合栈也只退一级）')

// ============ 三、地图行分流行为（跑地图源文件里截出来的真函数） ============
const mapBundleSrc = ['hasMapTag', 'findMapInSnapshot', 'enterDetail'].map((n) => extractConst(mapSrc, n)).join('\n')
const runEnter = (t, maps) => {
  const s = { activeMap: 550, activeIssue: null, navStack: [{ kind: 'map', n: 550 }], tick: 0, snapshot: maps === null ? undefined : { maps: maps || [{ number: 550 }, { number: 551 }] } }
  const log = []
  const pushStub = (a, k, n) => { log.push([k, n]); return nav.pushNav(a, k, n) }
  const fn = new Function('st', 'pushNav', mapBundleSrc + '\nreturn { enterDetail }')
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
check(!extractConst(mapSrc, 'enterDetail').includes('CLOSED') && !extractConst(mapSrc, 'enterDetail').includes('state'), '矩阵：分流入口无已关闭特判')
check(issueSrc.includes('readOnlyHint'), '矩阵：工单详情保留只读提示字符串（真只读留后续，见报告）')
// 实证：评论输入区的显隐只看评论通路有没有数据、是不是拉取请求，不看已关闭；
// 所以已关闭且有评论的工单今天仍有输入框，真只读是后续票的事，本票不断言它。
const ccStart = issueSrc.indexOf('let canComment')
const ccEnd = issueSrc.indexOf('canComment = false', ccStart) + 'canComment = false'.length
const ccBlock = issueSrc.slice(ccStart, ccEnd)
check(ccBlock.includes('isPullRequest') && !/state|CLOSED/.test(ccBlock), '实证：评论输入显隐不看已关闭（只看评论通路与是否拉取请求）')

// ============ 四、雾态去雾与下钻共存（跑地图源文件里截出来的真函数） ============
const fogBundleSrc = ['hasMapTag', 'findMapInSnapshot', 'enterDetail', 'isFog', 'isFogTitle', 'isRevealed', 'toggleReveal', 'onNodeClick'].map((n) => extractConst(mapSrc, n)).join('\n')
const fogM = { number: 550, tickets: [
  { number: 1, title: '先做', labels: [], state: 'OPEN', blockedBy: [] },
  { number: 2, title: '被挡住', labels: [], state: 'OPEN', blockedBy: [1] },
  { number: 3, title: '能做', labels: [], state: 'OPEN', blockedBy: [] },
] }
const runClick = (t, drill) => {
  const s = { activeMap: 550, activeIssue: null, navStack: [{ kind: 'map', n: 550 }], tick: 0, snapshot: { maps: [{ number: 550 }] }, reveal: {} }
  const log = []
  const pushStub = (a, k, n) => { log.push([k, n]); return nav.pushNav(a, k, n) }
  const emits = []
  const fn = new Function('st', 'm', 'tickets', 'fogTitles', 'drill', 'emit', 'pushNav', 'const canDrill = drill !== false\n' + fogBundleSrc + '\nreturn { onNodeClick, isFog }')
  const api = fn(s, fogM, fogM.tickets, [], drill !== false ? true : false, function (x) { emits.push(1); x.tick = (x.tick || 0) + 1 }, pushStub)
  api.onNodeClick(t)
  return { s: s, log: log, api: api }
}
const fogT = fogM.tickets[1]
const plainT = fogM.tickets[2]
let r = runClick(fogT, true)
check(r.log.length === 0 && r.s.reveal[550] && r.s.reveal[550][2] === true, '矩阵：被雾盖住的行第一次点击只去雾，不进详情')
r.api.onNodeClick(fogT)
check(JSON.stringify(r.log[r.log.length - 1]) === JSON.stringify(['issue', 2]), '矩阵：去雾后第二次点击同一行才进详情')
r = runClick(plainT, true)
check(JSON.stringify(r.log[r.log.length - 1]) === JSON.stringify(['issue', 3]), '矩阵：没有雾的行直接进详情')
r = runClick(plainT, false)
check(r.log.length === 0, '矩阵：悬浮面板内点行不压栈（只展示与去雾）')
r = runClick(fogT, false)
check(r.log.length === 0 && r.s.reveal[550] && r.s.reveal[550][2] === true, '矩阵：悬浮面板内雾行第一次点击照常去雾')
const closedT = { number: 4, title: '已关', labels: [], state: 'CLOSED', blockedBy: [1] }
r = runClick(closedT, true)
check(JSON.stringify(r.log[r.log.length - 1]) === JSON.stringify(['issue', 4]), '矩阵：已关闭的行不算雾，直接按标签分流')
const onNodeSrc = extractConst(mapSrc, 'onNodeClick')
check(onNodeSrc.indexOf('toggleReveal') >= 0 && onNodeSrc.indexOf('toggleReveal') < onNodeSrc.indexOf('enterDetail'), '矩阵：点击先判雾去雾、再谈下钻（顺序写死）')

// ============ 五、深栈面包屑字符串（跑两处源文件里截出来的真算式） ============
// 面包屑根复用主列表页签词条（中英齐备），测试里用中文取值的桩代入，另单查词条双语一致。
const zhTr = (k) => k === 'panel.tabList' ? '列表' : k
const locPanelSrc = fs.readFileSync('src/client/kernel/locale-panel.js', 'utf8')
check(!mapSrc.includes("'列表 / #'") && !issueSrc.includes("'列表 / #'"), '矩阵：两处面包屑根不再锁死中文字符串（走词条，导航逻辑未动）')
check(locPanelSrc.includes("'panel.tabList': '列表'") && locPanelSrc.includes("'panel.tabList': 'List'"), '矩阵：面包屑根复用主列表页签词条，中英齐备')
const mapCrumbSrc = extractIife(mapSrc, 'navCrumb')
const issueCrumbSrc = extractIife(issueSrc, 'navCrumb')
const mapCrumb = (stack, num) => new Function('st', 'm', 'tr', mapCrumbSrc + '\nreturn navCrumb')({ navStack: stack }, { number: num }, zhTr)
const issueCrumb = (stack, num) => new Function('st', 'issueNumber', 'tr', issueCrumbSrc + '\nreturn navCrumb')({ navStack: stack }, num, zhTr)
check(mapCrumb([], 550) === '列表 / #550', '矩阵：地图面包屑空栈为单层列表形态')
check(mapCrumb([{ kind: 'map', n: 550 }], 550) === '列表 / #550', '矩阵：地图面包屑单层仍为列表形态')
check(mapCrumb([{ kind: 'map', n: 550 }, { kind: 'map', n: 551 }], 551) === '#550 / #551', '矩阵：地图进地图显示上一级与当前级')
check(mapCrumb([{ kind: 'map', n: 1 }, { kind: 'issue', n: 2 }, { kind: 'map', n: 3 }], 3) === '… / #2 / #3', '矩阵：超两级省略只留直接上一级与当前级')
check(mapCrumb([{ kind: 'map', n: 1 }, { kind: 'map', n: 2 }, { kind: 'map', n: 1 }], 1) === '… / #2 / #1', '矩阵：先后经过同一编号不合并，超两级仍省略并显示直接上一级')
check(issueCrumb([{ kind: 'issue', n: 20 }], 20) === '列表 / #20', '矩阵：工单面包屑单层为列表形态')
check(issueCrumb([{ kind: 'map', n: 10 }, { kind: 'issue', n: 20 }], 20) === '#10 / #20', '矩阵：地图进工单显示地图与工单编号')
check(issueCrumb([{ kind: 'map', n: 1 }, { kind: 'issue', n: 2 }, { kind: 'map', n: 3 }, { kind: 'issue', n: 4 }], 4) === '… / #3 / #4', '矩阵：四层混合链顶层面包屑为省略形态')

// ============ 六、技能页签最近地图祖先（跑源文件里截出来的真算式） ============
const recSrc = extractIife(skillSrc, 'recMapNum')
const recOf = (s) => new Function('st', recSrc + '\nreturn recMapNum')(s)
check(recOf({ navStack: [{ kind: 'map', n: 10 }, { kind: 'map', n: 20 }] }) === 20, '矩阵：栈顶是地图时推荐源就是它自己')
check(recOf({ navStack: [{ kind: 'map', n: 10 }, { kind: 'issue', n: 20 }] }) === 10, '矩阵：栈顶是工单时推荐源是把它带进来的地图')
check(recOf({ navStack: [{ kind: 'map', n: 1 }, { kind: 'issue', n: 2 }, { kind: 'map', n: 3 }, { kind: 'issue', n: 4 }] }) === 3, '矩阵：深栈取最近的地图祖先')
check(recOf({ navStack: [{ kind: 'issue', n: 5 }] }) === null, '矩阵：纯工单栈无地图祖先，回通用推荐')
check(recOf({ navStack: [] }) === null, '矩阵：空栈回通用推荐')
check(recOf({ activeMap: 7 }) === 7, '矩阵：旧对象无栈时按镜像兜底')
check(skillSrc.includes("e.kind === 'map'") && skillSrc.includes('recMapNum'), '矩阵：推荐源从栈顶往下找第一个地图层')

// ============ 七、子票与阻塞票种类分流（跑工单源文件里截出来的真函数） ============
const subBundleSrc = ['subLabelsOf', 'subHasRoutingInfo', 'subHasMapTag', 'findMapLocal', 'enterSubDetail'].map((n) => extractConst(issueSrc, n)).join('\n')
const runSub = (x, maps) => {
  const s = { activeMap: null, activeIssue: 20, navStack: [{ kind: 'issue', n: 20 }], tick: 0, snapshot: maps === null ? undefined : { maps: maps || [{ number: 551 }] } }
  const log = []
  const pushStub = (a, k, n) => { log.push([k, n]); return nav.pushNav(a, k, n) }
  const fn = new Function('st', 'pushNav', subBundleSrc + '\nreturn { enterSubDetail }')
  fn(s, pushStub).enterSubDetail(x)
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
;['enterDetail', 'enterSubDetail', 'navCrumb', 'recMapNum', 'canDrill', 'drill: false'].forEach((k) => {
  check(cli.includes(k) && pcli.includes(k), '矩阵：双产物含 ' + k)
})
check(cli.includes('… / ') && pcli.includes('… / '), '矩阵：双产物含超深省略号面包屑')
check(cli.includes("tr('panel.tabList')") && pcli.includes("tr('panel.tabList')"), '矩阵：双产物面包屑根走词条')

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
