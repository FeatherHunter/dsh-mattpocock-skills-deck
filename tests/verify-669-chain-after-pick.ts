#!/usr/bin/env node
/**
 * verify-669-chain-after-pick.js — 「选完后端立刻重取一次链，且晚到的旧结果不许盖回新快照」门禁（#669）
 *
 * 起因（用户在真机上报）：点完蓝条的「确认并继续」，那条该出现的横幅要等一会儿才出来。
 *   查明之后：这条路（`statusbar/StatusBackend.js` 的 `confirmStatusGate`）绑定成功只重取了快照，
 *   **没有重取链**；链要等「上一轮链探测结束时挂上的 8 秒定时器」到点才更新。
 *   实测：点确认 → 横幅出现 11.4 秒，其中 8.16 秒纯等定时器，1.7 秒是这一轮链探测本身；
 *   只补一次立刻重取 → 1.73 秒。同仓另外两条路本来就是一对（`kernel/store-switch.js`、`views/NoRepoCard.js`），
 *   只有蓝条这条门控路少了后半句。
 * 补上那次重取之后又带出后半件（C、D 两组钉的就是它）：选后端之前那次链请求还飞着，它不带 backendId、
 *   回包里没有后端段；旧的那次晚回来如果照写，界面就从「还没有远端仓库」退回「什么都没有」。
 *
 * 断三组（A、C 都用真身求值，不测 DOM）：
 *   A 行为层：把 StatusBackend.js 取出来在沙箱里求值、调真的 confirmStatusGate，断言
 *     「绑定成功之后确实又发了一次链重取，而且是 force 的那一次」。
 *   B 源码层（已整段删除）：原先读 `statusbar/StatusBackend.js` 与 `probe-chain.js` 的源码文本，
 *     用 indexOf / 正则断言里面有哪些字符串、谁在谁前面、某个名字出现几次。这类断言会因为等价重构
 *     （换写法、搬位置、改注释）而变红，所以拆掉了；「那道守卫按两问判、旧写法已消失」改由 C、D 两组守 ——
 *     C 把那道守卫的真身拉进沙箱按六种竞态现场逐条量，D 再把守卫做坏四次，量对应断言当场红。
 *   C 行为层（竞态）：把 `probe-chain.js` 真身取出来，喂一个可以按任意顺序回包的假 host，走六种现场 ——
 *     旧结果晚到、顺序正常、中途换后端、两个工作区各自在飞、同一个键上两次重取、同键非 force 并发 ——
 *     每一种都必须留下该留的那一份（会话状态与共享缓存都不许被旧结果盖）。
 *   D 反证：把守卫整段摘掉 / 只留第一问 / 只留第二问 / 把按键隔离改成全局一份，
 *     C 里对应的那几条必须当场量不通过；哪一条都量不出来，说明这一门是假绿的。
 *
 * 用法：node tests/verify-669-chain-after-pick.js
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// 本文件按文本求值走共用入口 compileFn：真源文本配假零件造成模块（理由与用法见 tests/lib/eval-probe.js 文件头）。
import { compileFn } from './lib/eval-probe.js'
// 取源走共用入口（#1207 立）：spliceableJs 给「可以直接当函数体求值」的 JavaScript 文本
// （.ts 会先按构建那份口径转译；手写 .js 原样返回并剥掉行首 export）。本文件只求值、不扫文本形状，所以只要它。
import { spliceableJs } from './lib/source-text.ts'

let passed = 0
let failed = 0
function check (ok: unknown, msg: string): void { if (ok) { console.log('  PASS ' + msg); passed++ } else { console.log('  FAIL ' + msg); failed++ } }

// read 留给还没迁移的 .js（probe-chain.js 那一份）：它没有同名 .ts，spliceableJs 会原样读。
const read = (rel: string): string => readFileSync(resolve(rel), 'utf8')
const sbSrc = spliceableJs('src/client/statusbar/StatusBackend.js')
const chainSrc = read('src/client/kernel/probe-chain.js')

// 沙箱里那几个会话对象的形状：真身在求值时往 selection / chainSnapshot 里写，测试侧按同一形状读。
interface ChainState {
  cwd: string
  selection: Record<string, unknown> | null
  chainSnapshot: { id: string } | null
}

console.log('== A 行为层：真的调一次 confirmStatusGate，看它绑完之后有没有重取链 ==')
{
  // 这份文本已经是「可以当函数体求值」的形态：spliceableJs 交出来的片段里行首 export 已经剥掉
  //   （它过的就是构建拼闭包那一步 inlineExportDeclarations + toSpliceableFragment），所以这里不再自己剥。
  const body = sbSrc
  const calls: { bind: any[]; snapshot: any[]; chain: any[]; flashes: any[] } = { bind: [], snapshot: [], chain: [], flashes: [] }
  const sandbox: Record<string, any> = {
    tr: (k: unknown) => String(k),
    emit: () => {},
    firstBackendIdOf: () => 'github',
    setCachedSelection: () => {},
    setPresentationMap: () => {},
    labelOf: (id: unknown) => String(id),
    flash: (st: unknown, t: unknown) => calls.flashes.push(String(t)),
    loadSnapshot: (st: unknown, a: unknown, b: unknown) => calls.snapshot.push({ force: a, mode: b }),
    loadChain: (st: unknown, force: unknown) => calls.chain.push({ force: force }),
    moduleMetaOf: () => null,
    injectSetupDecision: () => 'setup-card',
    host: { call: (method: string, params: any) => { calls.bind.push({ method: method, params: params }); return Promise.resolve({ ok: true }) } },
    console: { log () {}, warn () {}, error () {} },
  }
  const names = Object.keys(sandbox)
  // 把 StatusBackend.js 真身配假零件造成模块：改走共用入口 compileFn，参数名沿用 sandbox 的键。
  const mod = compileFn(names, body + '\n;return { confirmStatusGate: confirmStatusGate }')(...names.map((n) => sandbox[n]))
  const st: ChainState = { cwd: 'D:\\tmp\\669-demo', selection: null, snapshot: null, gateModalOpen: true, gateModalSource: 'status', gateSelected: 'github' } as unknown as ChainState
  mod.confirmStatusGate(st)
  await new Promise((r) => setTimeout(r, 0))
  check(calls.bind.length === 1 && calls.bind[0].method === 'wf.bind', '照旧打了一通绑定电话（实得 ' + JSON.stringify(calls.bind.map((c: any) => c.method)) + '）')
  check(calls.snapshot.length === 1, '照旧重取了一次快照（实得 ' + calls.snapshot.length + ' 次）')
  check(calls.chain.length === 1, '绑定成功之后确实又重取了一次链（实得 ' + calls.chain.length + ' 次）')
  check(calls.chain.length === 1 && calls.chain[0].force === true, '而且那一次是 force（绕过缓存，实得 force=' + (calls.chain[0] && calls.chain[0].force) + '）')
  check(calls.chain.length === 1 && calls.chain[0].force === true && calls.snapshot.length === 1, '两条重取都在绑定成功那一支里（不是失败分支）')
}

console.log('')
console.log('')
// 【已删除】原先这里是 B 组「源码层」：读 src/client/statusbar/StatusBackend.js 与
//   src/client/kernel/probe-chain.js 的源码文本，用 indexOf / 正则断言里面有哪几段字符串、
//   谁出现在谁前面、某个名字出现了几次、某个旧名字不许再出现（连注释里那句「注入决策」也在量）。
//   落点是手写源码的写法与先后，等价重构（换写法、搬位置、改注释）就会红，所以整段拆掉。
//   同一件事改由 C 组守：那一段把 probe-chain.js 的真身取出来、喂假 host，按六种竞态现场逐条量
//   「留下的该是哪一份」（旧结果晚到不许盖新的、换后端 / 换工作区 / 同键先后 / 并发去重都各有一条）；
//   A 组则真调一次 confirmStatusGate，量它绑完之后确实重取了一次链。

// ── C 组用的沙箱：把 probe-chain.js 真身取出来，喂一个可以按任意顺序回包的假 host ──────────────
const stripExports = (s: string): string => s.replace(/^[ \t]*export[ \t]+/gm, '')
const deferredOf = () => { let res: (value: any) => void = () => {}; const p = new Promise<any>((r) => { res = r }); return { p: p, res: res } }
const tick = () => new Promise((r) => setTimeout(r, 0))

function makeChain (srcText: string) {
  const calls: any[] = []
  const cache = new Map()
  const keyOf = (cwd: unknown, bid: unknown, lang: unknown): string => String(cwd) + '|' + String(bid || '') + '|' + String(lang || '')
  // #1003 退役 hint 上报（宿主读文件）：真身恒返回空，链请求不再带后端，下列现场只量“发了几次、 stale 怎么判”。
  const hintLine = read('src/client/kernel/store-prefs.js').split('\n').filter((l) => l.indexOf('export const userHintOf = function') >= 0)[0] || ''
  // 从真源切出一行函数表达式求值：改走共用入口 compileFn，这段源码不需要外部变量，参数表传空数组。
  const userHintOf = compileFn([], 'return ' + hintLine.trim().replace(/^export const userHintOf = /, ''))()
  const sandbox: Record<string, any> = {
    host: { call: (method: string, params: any) => { const d = deferredOf(); calls.push({ method: method, params: params, d: d }); return d.p } },
    userHintOf: userHintOf,
    wsKeyOf: (p: unknown) => String(p || '').replace(/\\/g, '/').toLowerCase(),
    getChainCacheKey: keyOf,
    getCachedChain: (cwd: unknown, bid: unknown, lang: unknown) => cache.get(keyOf(cwd, bid, lang)) || null,
    setCachedChain: (cwd: unknown, bid: unknown, lang: unknown, snap: unknown) => { cache.set(keyOf(cwd, bid, lang), snap) },
    promptLang: () => 'zh',
    isEnabled: () => false,
    log: () => {},
    dswsLogHash: (s: unknown) => 'h' + String(s || '').length,
    dswsLogTrunc: (s: unknown) => String(s || '').slice(0, 120),
    emit: () => {},
    nowStr: () => '00:00:00',
    timer: null,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    console: { log () {}, warn () {}, error () {} },
  }
  const names = Object.keys(sandbox)
  // 要取哪几个名字，**按真源里还有哪些**来定：#709（T5）把链的 8 秒自轮询那一对排期/取消函数
  //   （scheduleChainAutoRefresh / cancelChainAutoRefresh）整体退役了，再按老名字去要，就会在求值这一步
  //   抛 ReferenceError —— 那是门禁自己的桩表过期，C 组连行为都量不到，不是实现坏。
  //   现在按名字在真源里存不存在来挑：有就取出来用，没有就不取。
  const want = ['loadChain', 'chainEventRefresh', 'scheduleChainAutoRefresh', 'cancelChainAutoRefresh']
  const have = want.filter(function (n) { return new RegExp('(?:const|let|var|function)\\s+' + n + '\\b').test(srcText) })
  const body = stripExports(srcText) + '\n;return { ' + have.join(', ') + ' }'
  // 同一手法：probe-chain.js 真身配假 host，统一走共用入口 compileFn。
  const mod = compileFn(names, body)(...names.map((n) => sandbox[n]))
  return { loadChain: mod.loadChain, chainEventRefresh: mod.chainEventRefresh, calls: calls, cache: cache }
}
const snapOf = (id: string) => ({ ok: true, fullSnapshot: { id: id, steps: [{ status: 'done' }] } })
const NEW10 = '新（10 步，有仓库那一段）'

// 六种现场各走一遍，返回每一步实得的东西（C 组断言、D 组反证共用同一套量法）。
//   每个现场都新开一个沙箱：序号与在途登记都是模块级的，混在一起量不准。
const runScenarios = async function (srcText: string): Promise<Record<string, any>> {
  const out: Record<string, any> = {}

  // 现场 1：全新空目录里，先开一次不带后端的链；用户选 GitHub、紧接着 force 重取一次；
  //   最坏顺序 —— 新的先回来，旧的后回来。
  {
    const c = makeChain(srcText)
    const st: ChainState = { cwd: 'D:\\demo1', selection: null, chainSnapshot: null }
    c.loadChain(st, false)
    st.selection = { backendId: 'github', source: 'explicit', pickedAt: Date.now() } // 用户在门控窗点确认选出来的那条（乐观，会话内存）
    c.loadChain(st, true)
    out.scenarioOneSent = c.calls.length === 2 && !c.calls[0].params.backendId && !c.calls[1].params.backendId
    c.calls[1].d.res(snapOf(NEW10))
    await tick()
    c.calls[0].d.res(snapOf('旧（6 步，没有仓库那一段）'))
    await tick()
    out.afterStaleLate = st.chainSnapshot && st.chainSnapshot.id
    out.newKeyCache = (c.cache.get('d:/demo1|github|zh') || {}).id || null
    out.staleKeyCacheEmpty = !c.cache.get('d:/demo1||zh')
  }

  // 现场 2：顺序正常（旧的先回、新的后回）—— 也必须留下新的那一份。
  {
    const c = makeChain(srcText)
    const st: ChainState = { cwd: 'D:\\demo2', selection: null, chainSnapshot: null }
    c.loadChain(st, false)
    st.selection = { backendId: 'github', userPicked: true } // #669 第 6 件：这一处是「用户在门控窗点确认选出来的那条」，只有带标记的才当 hint 上报
    c.loadChain(st, true)
    c.calls[0].d.res(snapOf('旧（6 步）'))
    await tick()
    c.calls[1].d.res(snapOf('新（10 步）'))
    await tick()
    out.afterNormalOrder = st.chainSnapshot && st.chainSnapshot.id
  }

  // 现场 3：一个会话中途换后端（github → 本地 Markdown），前一次重取还飞着；
  //   新后端那次先回来，旧后端那次晚回来 —— 晚回来的那份不许把新链盖成旧后端的链。
  {
    const c = makeChain(srcText)
    const st: ChainState = { cwd: 'D:\\demo3', selection: { backendId: 'github', userPicked: true }, chainSnapshot: { id: '初始' } }
    c.loadChain(st, true)
    st.selection = { backendId: 'markdown', userPicked: true } // 同上：切换（用户亲手选的那一下）
    c.loadChain(st, true)
    c.calls[1].d.res(snapOf('markdown 的链（新）'))
    await tick()
    c.calls[0].d.res(snapOf('github 的链（旧，晚到）'))
    await tick()
    out.afterSwitchBackend = st.chainSnapshot && st.chainSnapshot.id
  }

  // 现场 4：两个工作区各自在飞（同一个页面里两个会话）—— 谁都不许把对方顶掉。
  {
    const c = makeChain(srcText)
    const stA: ChainState = { cwd: 'D:\\wsA', selection: { backendId: 'github', userPicked: true }, chainSnapshot: null }
    const stB: ChainState = { cwd: 'D:\\wsB', selection: { backendId: 'github', userPicked: true }, chainSnapshot: null }
    c.loadChain(stA, true)   // A 工作区先发
    c.loadChain(stB, true)   // B 工作区后发（键不同）
    c.calls[0].d.res(snapOf('A 工作区的链'))
    c.calls[1].d.res(snapOf('B 工作区的链'))
    await tick()
    out.crossA = stA.chainSnapshot && stA.chainSnapshot.id
    out.crossB = stB.chainSnapshot && stB.chainSnapshot.id
  }

  // 现场 5：同一个键上两次重取（事件带起来的那次与手动重查撞上）—— 先发的那次晚回来，不许盖掉后发的那次。
  {
    const c = makeChain(srcText)
    const st: ChainState = { cwd: 'D:\\demo5', selection: { backendId: 'github', userPicked: true }, chainSnapshot: { id: '初始' } }
    c.loadChain(st, true)
    c.loadChain(st, true)
    c.calls[1].d.res(snapOf('后一次（新）'))
    await tick()
    c.calls[0].d.res(snapOf('前一次（旧，晚到）'))
    await tick()
    out.sameKeyLateOld = st.chainSnapshot && st.chainSnapshot.id
  }

  // 现场 6（回归）：非 force 的同键并发照旧复用一次请求，两个调用方都拿到同一份快照。
  {
    const c = makeChain(srcText)
    const st: ChainState = { cwd: 'D:\\demo6', selection: { backendId: 'github', userPicked: true }, chainSnapshot: null }
    const p1 = c.loadChain(st, false)
    const p2 = c.loadChain(st, false)
    c.calls[0].d.res(snapOf('同键非 force 的一次'))
    const both = await Promise.all([p1, p2])
    out.dedupeCalls = c.calls.length
    out.dedupeSamePromise = p1 === p2
    out.dedupeBothGot = !!(both[0] && both[1] && both[0].id === '同键非 force 的一次' && both[1].id === '同键非 force 的一次')
  }

  return out
}

console.log('')
console.log('== C 行为层：六种竞态现场，每一种都要留下该留的那一份 ==')
const real = await runScenarios(chainSrc)
check(real.scenarioOneSent, '现场 1 确实先后发出了两次（都不带后端：宿主按文件判，不靠上报）')
check(real.afterStaleLate === NEW10, '现场 1 旧结果晚到之后，会话状态里仍是新快照（实得「' + real.afterStaleLate + '」）')
check(real.newKeyCache === NEW10, '现场 1 新快照进了共享缓存（实得「' + real.newKeyCache + '」）')
check(real.staleKeyCacheEmpty, '现场 1 被判过期的那一次一个字都没落（连它自己那把键的共享缓存也没写）')
check(real.afterNormalOrder === '新（10 步）', '现场 2 顺序正常时留下的是新快照（实得「' + real.afterNormalOrder + '」）')
check(real.afterSwitchBackend === 'markdown 的链（新）', '现场 3 换完后端留下的是新后端那条链（实得「' + real.afterSwitchBackend + '」）')
check(real.crossA === 'A 工作区的链' && real.crossB === 'B 工作区的链', '现场 4 两个工作区互不顶掉（实得 A=「' + real.crossA + '」B=「' + real.crossB + '」）')
check(real.sameKeyLateOld === '后一次（新）', '现场 5 同一个键上先发的那次晚回来，盖不掉后发的那次（实得「' + real.sameKeyLateOld + '」）')
check(real.dedupeCalls === 1 && real.dedupeSamePromise && real.dedupeBothGot, '现场 6 同键非 force 并发照旧只发一次请求、两个调用方都拿到（实得 ' + real.dedupeCalls + ' 次）')

console.log('')
console.log('== E 层：退休的 8 秒自轮询，它的活由几条真实事件路接着做（而且都走内核那一个事件入口）==')
{
  // 从前这条链「只要还没全绿，就自己排一次 8 秒后的 force 重取，直到全绿才停」。那个自续循环在
  //   #709（T5）整体退役（见 tests/verify-709-no-self-continuing-timers.ts）。接手的是真实事件路，
  //   它们都从 probe-chain.js 的链事件入口 chainEventRefresh 过（下面逐条量「哪一路、在哪个文件、带什么原因」）：
  //     ① 切进工作区（打开检查页）—— 这一路**不绕过缓存**（缓存优先，下面当场跑一遍量它）；
  //     ② 人亲手点「重新检查」（检查页上的按钮、refreshAll 那条静默路）；
  //     ③ 做完可能改变它的动作（绑定后端、配置派生）；
  //     ④ 写入成功之后那一路发生在宿主侧（chainBackoff.noteWriteActivity），不发客户端这一条。
  //   这几条都照真源当下的落点量：谁改了落点这里会红，不会假绿。
  const lineIn = function (rel: string, re: RegExp): string { return ((read(rel).split(/\r?\n/)).filter(function (l) { return re.test(l) })[0] || '').trim() }
  // 【已删除】原先这里列了一张六行的「哪一路走事件入口」清单（读 ChecksTab.js / probe-auto.js /
  //   store-switch.js / slotRenderer-repo-sync.js 的源码文本，按正则找那一行在不在），末尾还有一条对
  //   probe-chain.js 的同类断言。落点是源码里那一行的写法，等价重构就会红，整段拆掉。
  //   「几条路真的都走同一个事件入口」由下面那一段守：把 ChecksTab.js 里那一行真抠出来跑一遍，量
  //   「共享缓存里有就直接秒显、一次 host.call 都不发」，再拿同一个入口的缺省行为当对照。

  // ①「打开检查页」这一路必须是缓存优先（不联网）。判据不认注释、认取数路径：把真源里那一行当场跑起来，
  //   先往共享缓存里放一份链 —— 必须一次 host.call 都不发，直接把缓存那份铺到会话上。
  //   再照事件入口的缺省行为跑一次（缺省是绕过缓存）作对照：那一次必须真发请求、真写回会话状态。
  //   这两条合起来就是「打开检查页不联网」的机器证据（谁把第三参数删了、或改成 true，这里当场红）。
  const openChecksLine = lineIn('src/client/views/ChecksTab.js', /chainEventRefresh\(st, whyEnter/)
  const runOpenChecksLine = async function () {
    const c = makeChain(chainSrc)
    const st: ChainState = { cwd: 'D:\\demo8', selection: { backendId: 'github', userPicked: true }, chainSnapshot: null }
    // 共享缓存里那一份链快照的形状与运行时一致（缓存存的是快照本体，不是回包外层）。
    c.cache.set('d:/demo8|github|zh', { id: '共享缓存里那一份', steps: [{ status: 'done' }] })
    const deps: Record<string, any> = {
      st: st, whyEnter: 'enter-workspace',
      chainEventRefresh: c.chainEventRefresh, loadChain: c.loadChain,
      CHAIN_EVENT_REASONS: { enterWorkspace: 'enter-workspace', userRecheck: 'user-recheck', actionDone: 'action-done', writeDone: 'write-done' },
      React: { useEffect: function (fn: () => void) { fn() } },
      console: { log () {}, warn () {}, error () {} },
    }
    const names = Object.keys(deps)
    // 把真源里那一行当场跑起来：改走共用入口 compileFn，参数名按 deps 的键给。
    compileFn(names, openChecksLine).apply(null, names.map(function (k) { return deps[k] }))
    await tick()
    return { calls: c.calls.length, got: st.chainSnapshot && st.chainSnapshot.id, c: c }
  }
  const openNoForce = await runOpenChecksLine()
  check(openNoForce.calls === 0 && openNoForce.got === '共享缓存里那一份', '切进工作区那一路：共享缓存里有就直接秒显，一次 host.call 都不发（实得发 ' + openNoForce.calls + ' 次、铺上「' + openNoForce.got + '」）')
  if (openNoForce.c.calls[0]) openNoForce.c.calls[0].d.res(snapOf('缓存优先那一份'))
  const c2 = makeChain(chainSrc)
  const st2: ChainState = { cwd: 'D:\\demo8', selection: { backendId: 'github', userPicked: true }, chainSnapshot: null }
  c2.cache.set('d:/demo8|github|zh', snapOf('共享缓存里那一份'))
  const p2 = c2.chainEventRefresh(st2, 'enter-workspace')
  await tick()
  check(c2.calls.length === 1, '对照：同一个入口缺省（绕过缓存）时会真发一次请求 —— 上面那条不是「什么都不做」蒙过去的（实得发 ' + c2.calls.length + ' 次）')
  if (c2.calls[0]) c2.calls[0].d.res(snapOf('绕过缓存取回来的那一份'))
  await tick()
  if (p2 && p2.catch) await p2.catch(function () {})
  check(st2.chainSnapshot && st2.chainSnapshot.id === '绕过缓存取回来的那一份', '对照那一次的回包照旧写进会话状态（实得「' + (st2.chainSnapshot && st2.chainSnapshot.id) + '」）')

  // ②③ 那几路仍旧要把「为什么重取」带给宿主，宿主凭它判退避。
  const c3 = makeChain(chainSrc)
  const st3: ChainState = { cwd: 'D:\\demo9', selection: { backendId: 'github', userPicked: true }, chainSnapshot: null }
  const p3 = c3.chainEventRefresh(st3, 'action-done')
  await tick()
  const one3 = (c3.calls[0] && c3.calls[0].params) || {}
  check(c3.calls.length === 1 && one3.force === true && one3.trigger === 'action-done', '绕过缓存那几路：真的发一次 force 重取，并把「为什么重取」带给宿主（实得 force=' + JSON.stringify(one3.force) + ' trigger=' + JSON.stringify(one3.trigger) + '）')
  if (c3.calls[0]) c3.calls[0].d.res(snapOf('事件带起来的那一份'))
  await tick()
  if (p3 && p3.catch) await p3.catch(function () {})
  check(st3.chainSnapshot && st3.chainSnapshot.id === '事件带起来的那一份', '这一份回包照旧写进会话状态（实得「' + (st3.chainSnapshot && st3.chainSnapshot.id) + '」）')
}

console.log('')
console.log('== D 反证：把守卫做坏，C 里对应的那几条必须当场量不通过 ==')
{
  // 每一版都对着真源改一处（改不动就当场报错：反证没造出来 = 这一门本身坏了），
  //   然后要求「该红的那几条」确实红了 —— 红不出来就说明 C 那一问在量空气。
  const variants = [
    {
      label: '守卫整段摘掉',
      patches: [['if (_chainRespStale(norm, _mySeq, st)) {', 'if (false) {']],
      must: ['现场 1 会话状态', '现场 1 过期那一次不落', '现场 3 换后端', '现场 5 同键先后'],
    },
    {
      label: '只留第一问（同一个键上有没有更新的一次）',
      patches: [['try { return _chainKeyOfState(state) !== key } catch (eK) { return true }', 'return false']],
      must: ['现场 1 会话状态', '现场 1 过期那一次不落', '现场 3 换后端'],
    },
    {
      label: '只留第二问（这个会话还要不要这条链）',
      patches: [['try { if (_chainLatestByKey.get(key) !== seq) return true } catch (eS) { return true }', 'if (false) { }']],
      must: ['现场 5 同键先后'],
    },
    {
      label: '把按键隔离改成全局一份',
      patches: [['_chainLatestByKey.set(norm, _mySeq)', '_chainLatestByKey.set("全局", _mySeq)'], ['_chainLatestByKey.get(norm)', '_chainLatestByKey.get("全局")']],
      must: ['现场 4 跨工作区'],
    },
  ]
  const worse = (key: string, got: Record<string, any>): boolean => {
    if (key === '现场 1 会话状态') return got.afterStaleLate !== NEW10
    if (key === '现场 1 过期那一次不落') return got.staleKeyCacheEmpty === false
    if (key === '现场 3 换后端') return got.afterSwitchBackend !== 'markdown 的链（新）'
    if (key === '现场 4 跨工作区') return got.crossA !== 'A 工作区的链' || got.crossB !== 'B 工作区的链'
    if (key === '现场 5 同键先后') return got.sameKeyLateOld !== '后一次（新）'
    return false
  }
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]
    let broken = chainSrc
    let patched = true
    for (const pair of v.patches) {
      if (broken.indexOf(pair[0]) < 0) { patched = false; break }
      broken = broken.replace(pair[0], pair[1])
    }
    if (!patched) { check(false, '反证 ' + (i + 1) + '（' + v.label + '）：没能在真源里找到要改的那一段，这道反证本身坏了'); continue }
    const got = await runScenarios(broken)
    const notRed = v.must.filter((k) => !worse(k, got))
    check(notRed.length === 0, '反证 ' + (i + 1) + '（' + v.label + '）：该红的都红了（' + (notRed.length ? '这几条没红，C 那几个断言量不住它：' + notRed.join(' / ') : v.must.join('、')) + '）')
  }
}

console.log('')
console.log(failed ? 'FAIL ' + passed + ' 项通过 / ' + failed + ' 项未过' : 'PASS 全部 ' + passed + ' 项检查通过')
process.exit(failed ? 1 : 0)
