// verify-nav-stack.js — #552 导航栈状态机与返回语义校验（T2 状态机固化）
// 验证：
//   1) 形状声明：makeStore 含 navStack，元素只存坐标 { kind, n }
//   2) 操作函数：store-prefs 含 pushNav/popNav/peekNav/clearNavStack，旧 5 入口保留并收敛
//   3) 行为级：空栈/单层等价旧互斥/多层压栈/连续同层去重/逐级弹出/空栈回列表/
//      非法输入直接返回/旧对象无栈兼容/弹栈不碰展开与缓存/镜像同步（含弹空栈不写回旧镜像）
//   4) 接线：Dock 渲染优先级读栈顶；双产物含新函数
// 用法: node tests/verify-nav-stack.js（在插件根目录）
const fs = require('fs')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// —— 1) 形状声明
const snapSrc = fs.readFileSync('src/client/kernel/store-snapshot.js', 'utf8')
check(snapSrc.includes('navStack: []'), 'makeStore 含 navStack: []')
check(snapSrc.includes('activeMap') && snapSrc.includes('activeIssue'), 'makeStore 保留 activeMap/activeIssue 镜像字段')

// —— 2) 操作函数存在
const prefsSrc = fs.readFileSync('src/client/kernel/store-prefs.js', 'utf8')
;['pushNav', 'popNav', 'peekNav', 'clearNavStack', 'syncNavMirror', 'seedNavFromMirror', 'peekStackNav'].forEach((f) => {
  check(new RegExp('export\\s+(const|let|function)\\s+' + f + '\\b').test(prefsSrc), 'store-prefs 导出 ' + f)
})
;['setActiveMap', 'clearActiveMap', 'setActiveIssue', 'clearActiveIssue', 'clearActiveDetail'].forEach((f) => {
  check(new RegExp('export\\s+(const|let|function)\\s+' + f + '\\b').test(prefsSrc), '旧入口保留 ' + f)
})
check(prefsSrc.includes("kind === 'map'") && prefsSrc.includes("kind === 'issue'"), '栈元素只记种类 map/issue')

// —— 3) 行为级（把 store-prefs 当纯函数加载：去行首 export，注入 emit 桩）
const srcNoExport = prefsSrc.replace(/^\s*export\s+/gm, '')
const nav = new Function('emit', srcNoExport + '\nreturn { peekNav, pushNav, popNav, clearNavStack, setActiveMap, clearActiveMap, setActiveIssue, clearActiveIssue, clearActiveDetail }')(
  function (st) { st.tick = (st.tick || 0) + 1 }
)
const mk = () => ({ activeMap: null, activeIssue: null, navStack: [], tick: 0 })
const eqStack = (st, arr) => JSON.stringify(st.navStack) === JSON.stringify(arr)

// 空栈：看栈顶为 null，弹栈为 null 且不崩
let st = mk()
check(nav.peekNav(st) === null, '行为：空栈看栈顶为 null')
check(nav.popNav(st) === null && eqStack(st, []), '行为：空栈弹栈为 null 且不崩')

// 单层等价旧互斥：置工单只亮工单镜像，置地图只亮地图镜像
st = mk()
nav.setActiveIssue(st, 42)
check(eqStack(st, [{ kind: 'issue', n: 42 }]) && st.activeIssue === 42 && st.activeMap === null, '行为：setActiveIssue(42) 压单层且镜像互斥')
st = mk()
nav.setActiveMap(st, 5)
check(eqStack(st, [{ kind: 'map', n: 5 }]) && st.activeMap === 5 && st.activeIssue === null, '行为：setActiveMap(5) 压单层且镜像互斥')

// 多层压栈：从工单再进地图，保留返回路径（旧互斥会丢掉 42）
st = mk()
nav.setActiveIssue(st, 42); nav.setActiveMap(st, 5)
check(eqStack(st, [{ kind: 'issue', n: 42 }, { kind: 'map', n: 5 }]), '行为：详情里再进下一级压栈不断返回路')
check(JSON.stringify(nav.peekNav(st)) === JSON.stringify({ kind: 'map', n: 5 }), '行为：栈顶为后进的地图 5')

// 连续同层去重：重复进入同一详情不重复压栈
nav.setActiveMap(st, 5)
check(st.navStack.length === 2, '行为：重复进入同一详情不重复压栈')

// 逐级弹出：返回一次回到工单 42 且镜像同步回来
nav.clearActiveMap(st)
check(eqStack(st, [{ kind: 'issue', n: 42 }]) && st.activeIssue === 42 && st.activeMap === null, '行为：clearActiveMap 弹回上一级工单 42')

// 空栈回列表：再返回一次栈空且双镜像为 null
nav.clearActiveIssue(st)
check(eqStack(st, []) && st.activeIssue === null && st.activeMap === null, '行为：弹空栈后双镜像为 null（回列表）')

// clearActiveDetail 等于清空栈
st = mk()
nav.setActiveMap(st, 8); nav.setActiveIssue(st, 9); nav.clearActiveDetail(st)
check(eqStack(st, []) && st.activeIssue === null && st.activeMap === null, '行为：clearActiveDetail 清空栈')

// 非法输入直接返回：坏种类/非数字/null 不污染栈
st = mk()
const topBefore = nav.peekNav(st)
check(nav.pushNav(st, 'nope', 3) === topBefore && nav.pushNav(st, 'map', NaN) === topBefore && nav.pushNav(st, 'issue', null) === topBefore && eqStack(st, []), '行为：非法输入直接返回且不污染栈')

// 传 null 等于清除：setActiveMap(null) 清掉栈顶地图
st = mk()
nav.setActiveMap(st, 5); nav.setActiveMap(st, null)
check(eqStack(st, []) && st.activeMap === null, '行为：setActiveMap(null) 清掉栈顶')

// 旧对象无栈兼容：没有 navStack 数组也能从镜像回推、压栈前补层、清除能清掉
const legacy = { activeMap: 7, activeIssue: null, tick: 0 }
check(JSON.stringify(nav.peekNav(legacy)) === JSON.stringify({ kind: 'map', n: 7 }), '行为：旧对象从镜像回推栈顶')
nav.setActiveIssue(legacy, 9)
check(JSON.stringify(legacy.navStack) === JSON.stringify([{ kind: 'map', n: 7 }, { kind: 'issue', n: 9 }]), '行为：旧对象压栈前先从镜像补层')
nav.clearActiveIssue(legacy)
check(JSON.stringify(legacy.navStack) === JSON.stringify([{ kind: 'map', n: 7 }]) && legacy.activeMap === 7, '行为：旧对象弹栈回到镜像层')
nav.clearActiveMap(legacy)
check(eqStack(legacy, []) && legacy.activeMap === null, '行为：旧对象清除能清掉')

// 弹栈不碰展开与缓存：上一级的滚动展开位与详情缓存原样保留
st = mk()
st.expLabels = { a: true }; st.issueCache = { 42: { x: 1 } }
nav.setActiveMap(st, 1); nav.setActiveIssue(st, 2); nav.popNav(st)
check(JSON.stringify(st.expLabels) === JSON.stringify({ a: true }), '行为：弹栈保留展开收起')
check(JSON.stringify(st.issueCache) === JSON.stringify({ 42: { x: 1 } }), '行为：弹栈保留详情缓存（不强制重刷）')

// 镜像同步：弹空栈不写回旧镜像（回归：同步必须只读栈，不能读镜像兜底）
st = mk()
nav.setActiveIssue(st, 42); nav.popNav(st)
check(st.activeIssue === null && st.activeMap === null, '行为：弹空栈后镜像为 null（不写回旧镜像）')

// T4 #554：深栈下只弹一层回到上一级（含上一级为工单的混合栈）；A→B→A 不折叠、逐级经过
st = mk()
nav.pushNav(st, 'map', 10); nav.pushNav(st, 'issue', 20); nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 10 }]) && st.activeMap === 10 && st.activeIssue === null, '行为 T4：工单返回只弹一层回到上一级地图 10')
st = mk()
nav.pushNav(st, 'issue', 20); nav.pushNav(st, 'map', 10); nav.popNav(st)
check(eqStack(st, [{ kind: 'issue', n: 20 }]) && st.activeIssue === 20 && st.activeMap === null, '行为 T4：地图返回只弹一层回到上一级工单 20（混合栈）')
st = mk()
nav.pushNav(st, 'map', 1); nav.pushNav(st, 'map', 2); nav.pushNav(st, 'map', 1)
check(st.navStack.length === 3, '行为 T4：A→B→A 不折叠（逐级经过，栈留三层）')
nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 1 }, { kind: 'map', n: 2 }]), '行为 T4：A→B→A 返回先回到 B')
nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 1 }]), '行为 T4：A→B→A 再返回回到 A')

// —— 4) 接线与双产物
const dockSrc = fs.readFileSync('src/client/panel/Dock.js', 'utf8')
check(dockSrc.includes('peekNav'), 'Dock 渲染优先级读栈顶')
check(dockSrc.includes('hasIssueDetail') && dockSrc.includes('h(MapDetail') && dockSrc.includes('h(IssueDetail') && dockSrc.includes('h(ListTab'), 'Dock 保留 地图详情/工单详情/列表 三分支')

// —— 5) T4 整改：悬浮面板禁压栈 + 子票阻塞票分流（只查源码接线，行为由上面状态机覆盖）
const mapViewSrc = fs.readFileSync('src/client/views/MapDetail.js', 'utf8')
const overlaySrc = fs.readFileSync('src/client/panel/Overlay.js', 'utf8')
const issueViewSrc = fs.readFileSync('src/client/views/IssueDetail.js', 'utf8')
check(overlaySrc.includes('drill: false'), 'T4整改：悬浮面板内地图详情禁压栈（传 drill:false，只去雾与展示）')
check(mapViewSrc.includes('drill !== false') && mapViewSrc.includes('if (canDrill) enterDetail(t)'), 'T4整改：地图行点进详情只在停靠栏生效')
check(issueViewSrc.includes('enterSubDetail') && issueViewSrc.includes('findMapLocal'), 'T4整改：子票阻塞票按标签/快照分流（无标签按快照找图，找不到回落工单）')
check(!issueViewSrc.includes("pushNav(st, 'issue', s.number)") && !issueViewSrc.includes("pushNav(st, 'issue', b.number)"), 'T4整改：子票阻塞票不再一律记工单')
const cli = fs.readFileSync('client.js', 'utf8')
const pcli = fs.readFileSync('package/lib/client.js', 'utf8')
check(cli.includes('navStack') && pcli.includes('navStack'), '双产物含 navStack')
check(cli.includes('pushNav') && pcli.includes('pushNav') && cli.includes('popNav') && pcli.includes('popNav'), '双产物含 pushNav/popNav')
check(cli.includes('peekNav') && pcli.includes('peekNav'), '双产物含 peekNav')

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
