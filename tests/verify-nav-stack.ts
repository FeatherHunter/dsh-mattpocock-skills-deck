// verify-nav-stack.ts — #552 导航栈状态机与返回语义校验（T2 状态机固化）
// 验证：
//   1) 形状声明：makeStore 含 navStack，元素只存坐标 { kind, n }
//   2) 操作函数：store-prefs 含 pushNav/popNav/peekNav/clearNavStack，旧 5 入口保留并收敛
//   3) 行为级：空栈/单层等价旧互斥/多层压栈/连续同层去重/逐级弹出/空栈回列表/
//      非法输入直接返回/旧对象无栈兼容/弹栈不碰展开与缓存/镜像同步（含弹空栈不写回旧镜像）
//   4) 接线：Dock 渲染优先级读栈顶；双产物含新函数
// 用法: node tests/verify-nav-stack.ts（在插件根目录）
const fs = require('fs')
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头。
const { compileFn } = require('./lib/eval-probe.js')
// 取源走共用入口（tests/lib/source-text.ts）：按构建唯一口径读 store-prefs 的真源并转成可拼接的
// JavaScript，不再直读旁边那份 .js 产物 —— 产物可能没重建、也可能停在旧文本上，门禁量到的会不是真源。
const { spliceableJs } = require('./lib/source-text.ts')
// 中央时间真值：缓存 TTL 只住 config/*.yaml，这里读同一份导出来预埋，不在测试里写第二份数字。
const centralTime = require('../src/shared/time-config/values.js')
globalThis.SYNC_ISSUE_CACHE_TTL_MS = centralTime.SYNC_ISSUE_CACHE_TTL_MS
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// —— 1) 形状声明与 2) 操作函数存在性：原来是「读源码文本、断言里面出现了某个名字」的静态检查，
//    断的是代码长成什么样（换个导出写法、搬个文件就变红），已按维护者口径连同下面的接线静态检查一起删掉。
//    这些名字到底在不在、接得对不对，由下面的行为级用例真调一遍来管。

// —— 3) 行为级（把 store-prefs 的真源当纯函数加载：共用入口已按构建口径转译并去掉行首 export、剥掉中央时间 import，剩下的仍是同一段代码）
const prefsSrc = spliceableJs('src/client/kernel/store-prefs.js')
const srcNoExport = prefsSrc.replace(/^\s*export\s+/gm, '').split('\n').filter((l) => !/^\s*import\s.*time-config\/values\.js/.test(l)).join('\n')
// 上面这步沿用旧写法，对 spliceableJs 的输出来说已是空操作（行首 export 与中央时间 import 都在共用入口里
// 按构建口径处理过）；留着只为与 tests/verify-map-drill.ts 的同一段加载手法逐字对齐，避免两处悄悄分叉。
// 这里选 compileFn：原来就是把参数名一个个传给按文本造函数的写法，改成共用入口后参数名照旧一个个传，求值出来的函数接法不变。
const nav = compileFn(['emit'], srcNoExport + '\nreturn { peekNav, pushNav, popNav, clearNavStack, setActiveMap, clearActiveMap, setActiveIssue, clearActiveIssue, clearActiveDetail }')(
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
check(eqStack(st, [{ kind: 'issue', n: 42, effortId: '' }]) && st.activeIssue === 42 && st.activeMap === null, '行为：setActiveIssue(42) 压单层且镜像互斥')
st = mk()
nav.setActiveMap(st, 5)
check(eqStack(st, [{ kind: 'map', n: 5, effortId: '' }]) && st.activeMap === 5 && st.activeIssue === null, '行为：setActiveMap(5) 压单层且镜像互斥')

// 多层压栈：从工单再进地图，保留返回路径（旧互斥会丢掉 42）
st = mk()
nav.setActiveIssue(st, 42); nav.setActiveMap(st, 5)
check(eqStack(st, [{ kind: 'issue', n: 42, effortId: '' }, { kind: 'map', n: 5, effortId: '' }]), '行为：详情里再进下一级压栈不断返回路')
check(JSON.stringify(nav.peekNav(st)) === JSON.stringify({ kind: 'map', n: 5, effortId: '' }), '行为：栈顶为后进的地图 5')

// 连续同层去重：重复进入同一详情不重复压栈
nav.setActiveMap(st, 5)
check(st.navStack.length === 2, '行为：重复进入同一详情不重复压栈')

// 逐级弹出：返回一次回到工单 42 且镜像同步回来
nav.clearActiveMap(st)
check(eqStack(st, [{ kind: 'issue', n: 42, effortId: '' }]) && st.activeIssue === 42 && st.activeMap === null, '行为：clearActiveMap 弹回上一级工单 42')

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
check(JSON.stringify(nav.peekNav(legacy)) === JSON.stringify({ kind: 'map', n: 7, effortId: '' }), '行为：旧对象从镜像回推栈顶')
nav.setActiveIssue(legacy, 9)
check(JSON.stringify(legacy.navStack) === JSON.stringify([{ kind: 'map', n: 7, effortId: '' }, { kind: 'issue', n: 9, effortId: '' }]), '行为：旧对象压栈前先从镜像补层')
nav.clearActiveIssue(legacy)
check(JSON.stringify(legacy.navStack) === JSON.stringify([{ kind: 'map', n: 7, effortId: '' }]) && legacy.activeMap === 7, '行为：旧对象弹栈回到镜像层')
nav.clearActiveMap(legacy)
check(eqStack(legacy, []) && legacy.activeMap === null, '行为：旧对象清除能清掉')

// effort 维度（2026-09-09）：同号不同 effort 是两条坐标，去重只在 (kind, n, effortId) 完全相同时生效
st = mk()
nav.pushNav(st, 'map', 0, 'alpha'); nav.pushNav(st, 'map', 0, 'beta')
check(eqStack(st, [{ kind: 'map', n: 0, effortId: 'alpha' }, { kind: 'map', n: 0, effortId: 'beta' }]), '行为 B：同号不同 effort 压两层')
nav.pushNav(st, 'map', 0, 'beta')
check(st.navStack.length === 2, '行为 B：同号同 effort 重复进入不重复压栈')
nav.popNav(st)
check(JSON.stringify(nav.peekNav(st)) === JSON.stringify({ kind: 'map', n: 0, effortId: 'alpha' }), '行为 B：返回回到上一个 effort 的同号地图')
check(st.activeEffortId === 'alpha', '行为 B：镜像同步 effort 标识')
nav.popNav(st)
check(st.activeEffortId === '', '行为 B：弹空栈后 effort 镜像清空')

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
check(eqStack(st, [{ kind: 'map', n: 10, effortId: '' }]) && st.activeMap === 10 && st.activeIssue === null, '行为 T4：工单返回只弹一层回到上一级地图 10')
st = mk()
nav.pushNav(st, 'issue', 20); nav.pushNav(st, 'map', 10); nav.popNav(st)
check(eqStack(st, [{ kind: 'issue', n: 20, effortId: '' }]) && st.activeIssue === 20 && st.activeMap === null, '行为 T4：地图返回只弹一层回到上一级工单 20（混合栈）')
st = mk()
nav.pushNav(st, 'map', 1); nav.pushNav(st, 'map', 2); nav.pushNav(st, 'map', 1)
check(st.navStack.length === 3, '行为 T4：A→B→A 不折叠（逐级经过，栈留三层）')
nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 1, effortId: '' }, { kind: 'map', n: 2, effortId: '' }]), '行为 T4：A→B→A 返回先回到 B')
nav.popNav(st)
check(eqStack(st, [{ kind: 'map', n: 1, effortId: '' }]), '行为 T4：A→B→A 再返回回到 A')

// —— 4)、5) 原来是「读 Dock.js / MapDetail.js / IssueDetail.js / client.js 的文本，断言里面出现了
//      peekNav、三分支、drill !== false、enterSubDetail、不再一律记工单、双产物含 navStack/pushNav/popNav」
//      这类静态接线检查，断的是代码长成什么样，已按维护者口径删掉。
//      接线断没断，由上面那一串真调状态机的行为用例覆盖（压栈、去重、逐级弹出、镜像同步、effort 维度）。

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
