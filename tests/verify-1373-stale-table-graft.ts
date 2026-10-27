// tests/verify-1373-stale-table-graft.ts —— 门禁：304 回包捎来的新工作路线读数必须落地（#1373）。
//
// 用户看到的样子：会话里明明调过 report（在办表接口），状态栏胶囊却一直是空的，
// 怎么刷新都不出现那张票。原因不在写的那一边 —— 账本里三笔 report 都记上了；
// 错在读的那一边：report 只改账本不改 issues/version，后续探测拿回 304，
// 客户端 304 那条路只在「本地完全没表」时才肯收新表。本地那份表是「有、但是旧的」
// （report 之前那次快照挂上去的），于是新表每次都被扔掉，胶囊永远是空的，
// 直到 issues 变化或手动强制刷新才好。
//
// 本门禁量四件事：
//   A. 决策函数 kernel/work-route-own.ts 的 adoptWorkRouteTableIfNewer：
//      本地缺表时也只收好读数（坏读数不许把「还没读到」改写成「读不出来」，见 A0）；
//      本地有表时，只收 ok:true 且（本地坏了、或来者 readout.at 更新）的那一份；
//      同旧、更旧、坏读数一律不换；任何坏形状都不抛错、不改调用方那份旧对象。
//   B. 真 304 现场：跑真 loadSnapshot，宿主回 {notModified:true + 新表}，
//      新表必须挂进当前会话快照，胶囊随之从 empty 翻成 ok（今天这条是红的）。
//   C. 迟到 304 现场：超时后回来的 304 同样把新表挂上，只补 selection 的老路不再丢表。
//   D. #1440：真宿主全程走一趟 304 —— 第二次带同一个版本号取快照，回包必须自带工作区根，
//      挂表那一步据此读得到表（304 是「内容没变」，不是失败，回包照样自含解释信息）。
//   E. #1440：面板浮层与胶囊都走「本机只读读数优先、快照兜底」那条选路，
//      304 挂上来的坏表不再把「读到的那张表」挡住；没读到时仍然如实说「读不出来」。
//
// 门禁归属: src/client/kernel/work-route-own.ts
// 门禁归属: src/refresh/rooms/client/snapshot-sync.ts
// 门禁归属: src/refresh/rooms/client/probe-scope-selection.ts
// 门禁归属: src/client/statusbar/SessionChainCapsule.ts
// 门禁归属: src/client/views/shared/workRouteTable.ts
// 门禁归属: src/refresh/rooms/host/session-snapshot-cache.ts
// 门禁归属: src/host/snapshotEnvelope.ts
// 门禁归属: src/refresh/rooms/host/work-route-readout.ts
//
// 用法（在插件根目录；不需要先构建，本门禁跑的是真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-1373-stale-table-graft.ts
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs, sourceText } from './lib/source-text.ts'
import { SNAP_WAIT_MS } from '../src/shared/time-config/values.js'
// #1440 D：真宿主 + 真信封 + 真读数口那一趟要用的五个模块（不伪造回包，绕开信封的旧用例不算数）。
import { createSnapshotEnvelope } from '../src/host/snapshotEnvelope.js'
import { createSnapshotComposer } from '../src/host/tracker/snapshot.js'
import { createWorkRouteTableReadout } from '../src/refresh/rooms/host/work-route-readout.js'
import { createSessionSnapshot } from '../src/refresh/rooms/host/session-snapshot-cache.js'
import { workspaceKeyOf } from '../src/refresh/contract/workspace-keys.js'
// #1553：在办表首列按行自适应 —— 表体一跑就要调它，叶子单测里按 1082 的做法补真身（不另抄规则）。
import { workRouteCellsFor } from '../src/client/kernel/ticket-label.js'
// #1564：整颗徽标收进共享叶子 ticketBadge.ts；本门禁按文本/模块单独加载视图叶子时闭包里没有这个名字，补上真身。
;(globalThis as any).ticketBadgeOf = (await import('../src/client/views/shared/ticketBadge.js')).ticketBadgeOf

let failed = false
let total = 0
const check = function (ok: any, msg: string): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
const tick = function (): Promise<void> {
  return new Promise(function (resolve) { setTimeout(resolve, 0) })
}
const T0 = '2026-10-21T12:00:00.000Z'
const T1 = '2026-10-22T08:00:00.000Z'
const T_OLD = '2026-10-20T08:00:00.000Z'

// 把一份「一源一物」的真源码当模块跑起来：剥掉行首 export，把跨闭包名字按参数塞进来。
const loadSpliced = function (relPath: string, exportNames: string[], scope: Record<string, any>): any {
  const paramNames = Object.keys(scope)
  const fn = compileFn(paramNames, spliceableJs(relPath) + '\nreturn { ' + exportNames.join(', ') + ' }')
  return fn.apply(null, paramNames.map(function (k) { return scope[k] }))
}
// stateQueue：按序给 useState 注入初值（#1440 E 要让浮层一上来就是「开着、有坐标」）。
// setStateQueue 供同一份桩被多次渲染时重置队列 —— 否则第二次渲染会把第一次的初值用光。
const makeReactStub = function (stateQueue?: any[]): any {
  let q: any[] = Array.isArray(stateQueue) ? stateQueue.slice() : []
  return {
    createElement: function (type: any, props: any): any {
      return { type: type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
    },
    useContext: function (): any { return null },
    useState: function (v: any): any[] { const next = q.length ? q.shift() : v; return [next, function (): void {}] },
    setStateQueue: function (list: any[]): void { q = Array.isArray(list) ? list.slice() : [] },
    useRef: function (v: any): any { return { current: v } },
    useEffect: function (): void {},
  }
}
const loadLeaf = function (relPath: string, deps: Record<string, any>): any {
  const src = sourceText(relPath)
  const names: string[] = []
  const re = /^[ \t]*export[ \t]+(?:const|let|var|function|class)[ \t]+([A-Za-z_$][\w$]*)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) names.push(m[1])
  if (!names.length) throw new Error(relPath + ' 里没有找到 export 声明')
  const fn = compileFn(Object.keys(deps), spliceableJs(relPath) + '\nreturn { ' + names.join(', ') + ' }')
  return fn.apply(null, Object.keys(deps).map(function (k) { return deps[k] }))
}
// extra：额外注入的跨闭包名字（table 与 capsule 共用；#1440 起要能塞 ownWorkRouteSlotOf，测「本机只读读数优先」那条选路）。
// capsuleExtra：只给胶囊那一片（E4 要单独接 capsuleOwnRoutePick，对照「没接」与「接了」两种）。
const loadUiLeaves = function (extra?: Record<string, any>, capsuleExtra?: Record<string, any>): any {
  const tr = function (key: any): string { return String(key) }
  const tableDeps: any = {
    React: makeReactStub(),
    DswsCtx: null,
    Tip: function (p: any, c: any): any { return { type: 'Tip', props: p || {}, children: c === undefined ? [] : [c] } },
    tr: tr,
    h: function (): any { return {} },
    workRouteCellsFor: workRouteCellsFor,
  }
  const table: any = loadLeaf('src/client/views/shared/workRouteTable.js', Object.assign({}, tableDeps, extra || null))
  const capsuleDeps: any = {
    React: makeReactStub(),
    DswsCtx: null,
    tr: tr,
    Ic: function (p: any): any { return { type: 'Ic', props: p || {}, children: [] } },
    Tip: function (p: any, c: any): any { return { type: 'Tip', props: p || {}, children: c === undefined ? [] : [c] } },
    pushNav: function (): void {},
    findMapByIdentity: function (): any { return null },
    workRouteActionKeyOf: table.workRouteActionKeyOf,
    workRouteTableOf: table.workRouteTableOf,
  }
  const capsule: any = loadLeaf('src/client/statusbar/SessionChainCapsule.js', Object.assign({}, capsuleDeps, extra || null, capsuleExtra || null))
  return { table: table, capsule: capsule }
}

const emptyTableAt = function (at: string): any {
  return { ok: true, readout: { at: at, staleCount: 0, entries: [] } }
}
const ownTableAt = function (at: string): any {
  return {
    ok: true,
    readout: {
      at: at, staleCount: 0,
      entries: [{ ticketKey: '1373', title: '胶囊里该出现的那张票', sessionLabel: 'sess-B', action: 'report', actionAt: at, active: true, currentSession: true }],
    },
  }
}

// ---------------------------------------------------------------------------------------------
// A. 决策函数真值表
// ---------------------------------------------------------------------------------------------
const partA = function (own: any, ui: any): void {
  console.log('#1373 A. adoptWorkRouteTableIfNewer 只收更新的、好的读数')
  const graft = own.adoptWorkRouteTableIfNewer
  check(typeof graft === 'function', 'work-route-own.ts 交得出 adoptWorkRouteTableIfNewer')

  // A0（#1440）本地缺表 + 来者是坏读数 → 不收。缺表是「还没读到」，坏读数一旦挂上就变成
  //   「读不出来」：面板会画坏表，而且要等下一次带 at 的读数来了才能翻回来。
  const st0: any = { snapshot: { ok: true, maps: [] } }
  check(graft(st0, { workRouteTable: { ok: false, reason: 'host.work-route.no-workspace' } }) === false,
    '本地缺表时坏读数也不收（不把「还没读到」改写成「读不出来」）')
  check(st0.snapshot.workRouteTable === undefined, '本地缺表 + 坏读数：快照里不出现那个字段')

  // A1. 本地完全没表：照旧收（#1355 那条老行为不断）。
  const st1: any = { snapshot: { ok: true, maps: [] } }
  const inc1: any = ownTableAt(T1)
  check(graft(st1, { workRouteTable: inc1 }) === true, '本地缺表时收下新表')
  check(st1.snapshot.workRouteTable === inc1, '收的是来者那份原对象')

  // A2. 本地有表但是空的 + 来者更新且 ok → 换，胶囊随之从 empty 翻 ok。
  const st2: any = { snapshot: { ok: true, maps: [], workRouteTable: emptyTableAt(T0) } }
  const before2: any = st2.snapshot
  const capBefore: any = ui.capsule.sessionChainCapsuleOf(st2, 'sess-B')
  check(capBefore.state === 'empty', '前置：旧表是空的，胶囊正是 empty（实得 ' + capBefore.state + '）')
  const inc2: any = ownTableAt(T1)
  check(graft(st2, { workRouteTable: inc2 }) === true, '有旧表 + 来者更新时换上新表')
  check(st2.snapshot.workRouteTable === inc2, '换上去的是新表那份原对象')
  check(st2.snapshot !== before2 && before2.workRouteTable !== inc2, '换表不原地改旧快照（旧对象还留着旧表）')
  const capAfter: any = ui.capsule.sessionChainCapsuleOf(st2, 'sess-B')
  check(capAfter.state === 'ok' && !!capAfter.entry && capAfter.entry.ticketKey === '1373',
    '换表后胶囊翻成 ok 且列的是本会话那张票（实得 ' + JSON.stringify({ state: capAfter.state, key: capAfter.entry && capAfter.entry.ticketKey }) + '）')

  // A3. 来者更旧 → 不换。
  const st3: any = { snapshot: { ok: true, maps: [], workRouteTable: ownTableAt(T1) } }
  const keep3: any = st3.snapshot.workRouteTable
  check(graft(st3, { workRouteTable: ownTableAt(T_OLD) }) === false, '来者 readout.at 更旧时不换')
  check(st3.snapshot.workRouteTable === keep3, '旧表原对象还在')

  // A4. 来者是坏读数（ok:false）→ 不换，不拿坏的顶掉好的。
  const st4: any = { snapshot: { ok: true, maps: [], workRouteTable: ownTableAt(T1) } }
  const keep4: any = st4.snapshot.workRouteTable
  check(graft(st4, { workRouteTable: { ok: false, reason: 'unreadable' } }) === false, '来者 ok:false 时不换')
  check(st4.snapshot.workRouteTable === keep4, '好表没被坏读数顶掉')

  // A5. 本地是坏读数 + 来者是好的 → 换（坏状态能自愈）。
  const st5: any = { snapshot: { ok: true, maps: [], workRouteTable: { ok: false, reason: 'unreadable' } } }
  const inc5: any = ownTableAt(T1)
  check(graft(st5, { workRouteTable: inc5 }) === true, '本地坏表 + 来者好表时换上好的')
  check(st5.snapshot.workRouteTable === inc5, '好表挂上去了')

  // A6. 时间戳打平 → 不算更新，不折腾。
  const st6: any = { snapshot: { ok: true, maps: [], workRouteTable: ownTableAt(T1) } }
  const keep6: any = st6.snapshot.workRouteTable
  check(graft(st6, { workRouteTable: ownTableAt(T1) }) === false, 'readout.at 打平时不换')
  check(st6.snapshot.workRouteTable === keep6, '打平时旧表不动')

  // A7. 坏形状不抛错、不动手。
  check(graft(null, { workRouteTable: ownTableAt(T1) }) === false, 'st 为空时回 false')
  check(graft({ snapshot: null }, { workRouteTable: ownTableAt(T1) }) === false, '快照为空时回 false')
  check(graft({ snapshot: {} }, null) === false, '回包为空时回 false')
  check(graft({ snapshot: {} }, {}) === false, '回包里没表时回 false')
}

// ---------------------------------------------------------------------------------------------
// B + C 共用的真 loadSnapshot 台架（手法与 verify-1355 的 partB 同源）
// ---------------------------------------------------------------------------------------------
const stripTimeConfigImport = function (s: string): string {
  return s.split('\n').filter(function (l) { return !/^\s*import\s.*time-config\/values\.js/.test(l) }).join('\n')
}
const makeSnapMod = function (adoptFn: any, hostCall: any): any {
  const calls: any[] = []
  const snapSrc = spliceableJs('src/refresh/rooms/client/staleness-indicator.js')
    + '\n' + stripTimeConfigImport(spliceableJs('src/refresh/rooms/client/snapshot-sync.js'))
    + '\n' + spliceableJs('src/refresh/rooms/client/probe-scope-selection.js')
  const scope: Record<string, any> = {
    SNAP_WAIT_MS: SNAP_WAIT_MS,
    host: { call: function (method: any, params: any): any { calls.push({ method: method, params: params }); return hostCall(method, params) } },
    wsKeyOf: function (p: any): string { return String(p || '').replace(/\\/g, '/').toLowerCase() },
    tr: function (k: any): string { return String(k) },
    log: function (): void {},
    isEnabled: function (): boolean { return false },
    dswsLogHash: function (s: any): string { return 'h' + String(s || '').length },
    dswsLogTrunc: function (s: any): string { return String(s || '').slice(0, 120) },
    emit: function (): void {},
    hydrateFromCache: function (): boolean { return false },
    getCachedSnapshot: function (): any { return null },
    setCachedSnapshot: function (): void {},
    diskGetSnapshot: async function (): Promise<any> { return null },
    getProbeAt: function (): number { return 0 },
    touchProbeAt: function (): void {},
    lastProbeAtByCwd: new Map(),
    rememberWorkspaceRoot: function (): void {},
    applySnapshotSelection: function (st: any, snap: any): void {
      if (snap.selection !== undefined) st.selection = snap.selection
      if (snap.repository !== undefined) st.repository = snap.repository
    },
    startAutoProbe: function (): void {},
    scheduleFlashClear: function (): void {},
    flash: function (): void {},
    diffSnapshots: function (): any { return { added: [], changed: [], removed: [] } },
    getSnapshotVersion: function (): string { return '' },
    getCwdSync: function (): any { return null },
    setPresentationMap: function (): void {},
    lcApplySavedColorsOnInstall: function (): void {},
    userHintOf: function (): any { return undefined },
    _snapRequestKeyWas: function (): boolean { return true },
    reportWorkspaceAttention: function (): void {},
    askSelectionOnce: function (): void {},
    mergeSelection: function (): boolean { return false },
    setCachedSetupLayout: function (): void {},
    adoptWorkRouteTableIfNewer: adoptFn,
    shared: {},
    stores: {},
    timer: { timeout: function (fn: any, ms: number): any { return setTimeout(fn, ms) } },
    setTimeout: setTimeout, clearTimeout: clearTimeout, AbortController: AbortController,
    console: { log: function (): void {}, warn: function (): void {}, error: function (): void {} },
  }
  const body = 'with (scope) {\n' + snapSrc + '\n; return { loadSnapshot: loadSnapshot, installLate: _installLateSnapshot }\n}'
  const mod = compileFn(['scope'], body)(scope)
  return { loadSnapshot: mod.loadSnapshot, installLate: mod.installLate, calls: calls }
}

const baseSt = function (): any {
  return {
    cwd: 'D:\\ws1373', sessionId: 'sess-B', selection: { backendId: 'github' },
    snapshot: { ok: true, maps: [], issues: [], thinTickets: [], version: 'vA', generatedMs: Date.now(), workRouteTable: emptyTableAt(T0) },
    sessionWorkspaceRoot: 'D:\\ws1373', _wsRootAsked: true,
    snapMode: 'real', snapLoading: false, selPending: false, backendModules: { list: [] },
  }
}

// ---------------------------------------------------------------------------------------------
// B. 真 304 现场：版本没变 + 宿主捎了新表 → 新表必须落地
// ---------------------------------------------------------------------------------------------
const partB = async function (own: any, ui: any): Promise<void> {
  console.log('#1373 B. 304 回包捎来的新表挂进当前会话快照')
  const fresh: any = ownTableAt(T1)
  const m = makeSnapMod(own.adoptWorkRouteTableIfNewer, function (): any {
    return Promise.resolve({ notModified: true, workRouteTable: fresh })
  })
  const st: any = baseSt()
  const capBefore: any = ui.capsule.sessionChainCapsuleOf(st, 'sess-B')
  check(capBefore.state === 'empty', '前置：report 之前挂的旧表是空的，胶囊正是 empty（实得 ' + capBefore.state + '）')
  m.loadSnapshot(st, true, true)
  await tick(); await tick(); await tick()
  check(m.calls.length === 1 && m.calls[0].method === 'wf.refresh', '只发了一次强制刷新（实得 ' + JSON.stringify(m.calls.map(function (c: any) { return c.method })) + '）')
  check(!!st.snapshot && st.snapshot.workRouteTable === fresh, '304 捎来的新表挂进了当前会话快照')
  const capAfter: any = ui.capsule.sessionChainCapsuleOf(st, 'sess-B')
  check(capAfter.state === 'ok' && !!capAfter.entry && capAfter.entry.ticketKey === '1373',
    '胶囊从 empty 翻成 ok（实得 ' + JSON.stringify({ state: capAfter.state, key: capAfter.entry && capAfter.entry.ticketKey }) + '）')
}

// ---------------------------------------------------------------------------------------------
// C. 迟到 304 现场：超时后回来的 304 同样不丢表
// ---------------------------------------------------------------------------------------------
const partC = async function (own: any): Promise<void> {
  console.log('#1373 C. 迟到的 304 同样把新表挂上')
  // _snapRequestKeyWas 是 probe-select 真源自带的（行 105），这里不 mock —— 给它要的三个名字就行。
  const norm = function (x: any): string { return String(x || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }
  const scope: Record<string, any> = {
    _snapRespStale: function (): boolean { return false },
    wsKeyOf: norm,
    keyOf: norm,
    workspaceRootByCwd: {},
    mergeSelection: function (): boolean { return false },
    emit: function (): void {},
    setCachedRepository: function (): void {},
    setCachedSnapshot: function (): void {},
    isEnabled: function (): boolean { return false },
    log: function (): void {},
    dswsLogHash: function (s: any): string { return 'h' + String(s || '').length },
    adoptWorkRouteTableIfNewer: own.adoptWorkRouteTableIfNewer,
    diffSnapshots: function (): any { return { added: [], changed: [], removed: [] } },
    flash: function (): void {},
    tr: function (k: any): string { return String(k) },
    scheduleFlashClear: function (): void {},
    lcApplySavedColorsOnInstall: function (): void {},
    applySnapshotSelection: function (): void {},
    setCachedSetupLayout: function (): void {},
    touchProbeAt: function (): void {},
    startAutoProbe: function (): void {},
  }
  const late: any = loadSpliced('src/refresh/rooms/client/probe-scope-selection.js', ['_installLateSnapshot'], scope)
  const fresh: any = ownTableAt(T1)
  const st: any = baseSt()
  const mine: any = { gaveUp: true, done: false, seq: 7, reqBackend: 'github' }
  const r: any = late._installLateSnapshot(st, { notModified: true, workRouteTable: fresh }, 'd:/ws1373', mine)
  check(r === true, '迟到 304 落地回 true（装上了）')
  check(!!st.snapshot && st.snapshot.workRouteTable === fresh, '迟到 304 的新表挂进了快照')
  check(mine.done === true, '这一次记为已装（不挡后面的请求）')

  // C2. 迟到的表更旧 → 不换，但也不报错。
  const st2: any = baseSt()
  st2.snapshot.workRouteTable = ownTableAt(T1)
  const keep: any = st2.snapshot.workRouteTable
  const mine2: any = { gaveUp: true, done: false, seq: 8, reqBackend: 'github' }
  const r2: any = late._installLateSnapshot(st2, { notModified: true, workRouteTable: ownTableAt(T_OLD) }, 'd:/ws1373', mine2)
  check(r2 === false, '迟到的表更旧时回 false（没换东西）')
  check(st2.snapshot.workRouteTable === keep, '旧表原对象还在')
}

// ---------------------------------------------------------------------------------------------
// D（#1440）真宿主 + 真信封 + 真读数口：304 回包必须自带工作区根，挂表那一步才读得到
// ---------------------------------------------------------------------------------------------
// 为什么不能只伪造一份 304 回包：那样绕过了 withWorkRouteTable 这一层，而本票的病正是
//   「信封拿不到根 → 挂一张坏表」，病就长在这一层。这里让真宿主（createSessionSnapshot）、
//   真信封（createSnapshotEnvelope）、真读数口（createWorkRouteTableReadout）全程走一趟，
//   用一份刚组出来的内容版号换出真 304，再断言回包上的根与表。
const partD = async function (): Promise<void> {
  console.log('#1440 D. 真宿主全程走一趟 304：回包自带工作区根，挂表读得到')
  const ROOT = 'D:\\ws1440'
  const SID = 'sess-1440'
  const REF = { backend: 'markdown', refId: ROOT, name: 'ws1440', url: '' }
  const readout = {
    at: T1, staleCount: 0,
    entries: [{ ticketKey: '1440', title: '304 回包缺根那张票', sessionLabel: SID, action: 'report', actionAt: T1, active: true, currentSession: true }],
  }
  let reads = 0
  const tableReadout = createWorkRouteTableReadout({
    read: function (): any { reads += 1; return { ok: true, readout: readout } },
    rootKeyOf: function (root: any): any { return workspaceKeyOf(root) },
    now: function (): number { return Date.parse(T1) },
  })
  const quiet = { fire: function (): void {}, isEnabled: function (): boolean { return false } }
  const envelope: any = createSnapshotEnvelope({
    getGhPath: function (): any { return null },
    getGhLastError: function (): any { return null },
    adoptSnapshot: function (snap: any): any { return snap },
    logCtx: quiet,
    workRouteTableReadout: tableReadout,
    workRouteTableField: 'workRouteTable',
  })
  const tracker = { list: async function (): Promise<any> { return { ok: true, data: [] } } }
  const registry: any = {
    describe: function (): any { return REF },
    get: function (): any { return tracker },
  }
  const deps: any = {
    envelope: envelope,
    canonicalKey: async function (s: string): Promise<string> { return s },
    selectEarly: async function (): Promise<any> { return { backendId: 'markdown', source: 'local', pending: false, rev: 3 } },
    isComposerSelection: function (): boolean { return true },
    getTrackerRegistry: async function (): Promise<any> { return registry },
    getPlatform: async function (): Promise<any> { return {} },
    ctx: { get: function (): any { return null } },
    getCache: function (): any { return { ts: 0, snapshot: null } },
    setCache: function (): void {},
    CACHE_MS: 60000,
    cacheSnapshotIsCurrent: async function (): Promise<any> { return false },
    upcaseSnapStates: function (s: any): any { return s },
    computeLevels: function (): any { return { byNumber: {}, byKey: {} } },
    groupTickets: function (t: any[]): any { return { total: t.length, open: t.length, closed: 0, frontier: 0, claimed: 0, blocked: 0, levels: [], levelOf: {} } },
    getRepoRoot: async function (c: string): Promise<string> { return c },
    getRepoKey: async function (): Promise<any> { return null },
    readDiskCache: async function (): Promise<any> { return null },
    writeDiskCache: async function (): Promise<void> {},
    adoptSnapshot: function (s: any): any { return s },
    detectionExec: async function (): Promise<any> { return {} },
    getGhPath: function (): any { return null },
    getGhLastError: function (): any { return null },
    errText: function (e: any): string { return String((e && e.message) || e) },
    DEFAULT_CWD: ROOT,
    logCtx: quiet,
    getChoiceStore: async function (): Promise<any> { return null },
  }
  const phone: any = createSessionSnapshot(deps)
  const first: any = await phone.handleSnapshot({ cwd: ROOT, sessionId: SID })
  check(!!first && first.ok === true && first.notModified !== true, '前置：第一次取快照走重建，回的是整份快照（实得 ' + JSON.stringify(first && { ok: first.ok, notModified: first.notModified }) + '）')
  check(!!first && first.workspaceRoot === ROOT, '前置：整份快照自带工作区根')
  check(!!first && !!first.workRouteTable && first.workRouteTable.ok === true, '前置：整份快照挂的是读得到的那张表')
  // 版号是快照内容的纯函数（snapshotVersionOf），同样内容再组一次就得到同一个号。
  // 用它当 ifNoneMatch，真宿主会走「重建后版号对上」那条 304 出口 —— 不是伪造回包。
  const probe: any = createSnapshotComposer(registry, { snapshotTtl: 60000 })
  const replay: any = await probe.composeSnapshot('markdown', REF, { cwd: ROOT }, { ifNoneMatch: '' })
  const version = String((replay && replay.version) || '')
  check(!!replay && replay.ok === true && replay.notModified !== true && version !== '', '探针自己组一次，拿到宿主内部那枚内容版号（实得 ' + JSON.stringify(version) + '）')
  const second: any = await phone.handleSnapshot({ cwd: ROOT, sessionId: SID, ifNoneMatch: version })
  check(!!second && second.notModified === true && second.status === 304, '第二次带同一个版号取快照，宿主回 304（实得 ' + JSON.stringify({ notModified: second && second.notModified, status: second && second.status }) + '）')
  check(!!second && second.workspaceRoot === ROOT, '304 回包自带工作区根（实得 ' + JSON.stringify(second && second.workspaceRoot) + '）')
  const secondTable: any = second && second.workRouteTable
  check(!!secondTable && secondTable.ok === true, '304 回包上的工作路线表是读得到的那一份（实得 ' + JSON.stringify(secondTable && (secondTable.reason || secondTable.ok)) + '）')
  check(!!secondTable && !!secondTable.readout && Array.isArray(secondTable.readout.entries) && secondTable.readout.entries.length === 1 && secondTable.readout.entries[0].ticketKey === '1440', '304 回包里那张表就是刚才那条在办记录')
  check(reads >= 2, '两份回包各现算了一次读数（实得 ' + reads + ' 次）')
}

// ---------------------------------------------------------------------------------------------
// E（#1440）面板浮层与胶囊同一条选路：本机只读读数优先、快照兜底
// ---------------------------------------------------------------------------------------------
// 快照里挂的那张表在 304 缺根时是坏的；只读电话（wf.workRoute）不经过快照。
// 面板浮层要是只读快照，就会一直画「读不出来」；这条用例量「坏表不再挡住读到的那张」。
const partE = function (): void {
  console.log('#1440 E. 面板浮层与胶囊都走「本机读数优先、快照兜底」')
  const ROOT = 'D:\\ws1440'
  const SID = 'sess-1440'
  const SLOT_KEY = SID + '|' + ROOT
  const slotOf = function (st: any): any {
    const slot = st && st.ownWorkRoute
    if (!slot || typeof slot !== 'object') return null
    return String(slot.key || '') === SLOT_KEY ? slot : null
  }
  const uiState = { open: true, pos: { right: 12, top: 40, width: 600, maxHeight: 400 } }
  const extra: any = {
    ownWorkRouteSlotOf: slotOf,
    React: makeReactStub(),
    Ic: function (p: any): any { return { type: 'Ic', props: p || {}, children: [] } },
    portalTop: function (node: any): any { return { type: 'Portal', props: {}, children: [node] } },
    DSW_VERSION: '0.0.0-test',
  }
  const ui: any = loadUiLeaves(extra)
  const table: any = ui.table
  const badTable = { ok: false, reason: 'host.work-route.no-workspace' }
  const stOf = function (slot: any, withBadTable: boolean): any {
    const st: any = { cwd: ROOT, sessionId: SID, snapshot: { ok: true, maps: [] } }
    if (withBadTable) st.snapshot.workRouteTable = badTable
    if (slot) st.ownWorkRoute = slot
    return st
  }
  const findNode = function (node: any, pred: any): any {
    if (!node) return null
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) { const hit = findNode(node[i], pred); if (hit) return hit }
      return null
    }
    if (typeof node !== 'object') return null
    if (pred(node)) return node
    return Array.isArray(node.children) ? findNode(node.children, pred) : null
  }
  const attrOf = function (node: any): any {
    return (node && node.props && node.props['data-work-route-table'] !== undefined) ? node.props['data-work-route-table'] : undefined
  }
  const renderTrigger = function (st: any): any {
    extra.React.setStateQueue([uiState])
    return table.WorkRouteTrigger({ st: st })
  }
  const treeAt = function (st: any): any {
    const tree = table.WorkRouteTable({ st: st })
    const sec = findNode(tree, function (n: any) { return attrOf(n) !== undefined })
    return { tree: tree, state: attrOf(sec) }
  }
  const popoverAt = function (st: any): any {
    const trigger = renderTrigger(st)
    const pop = findNode(trigger, function (n: any) { return !!(n && n.props && n.props['data-work-route-popover'] !== undefined) })
    return { trigger: trigger, pop: pop }
  }
  const popTableState = function (pop: any): any {
    const bodyEl = pop ? findNode(pop, function (n: any) { return !!(n && n.type === table.WorkRouteTable) }) : null
    if (!bodyEl) return undefined
    const body = table.WorkRouteTable(bodyEl.props)
    const sec = findNode(body, function (n: any) { return attrOf(n) !== undefined })
    return attrOf(sec)
  }
  const popHas = function (pop: any, name: string): boolean {
    return !!findNode(pop, function (n: any) { return !!(n && n.props && n.props[name] !== undefined) })
  }

  // E1. 本机读数已到 + 快照挂坏表 → 面板与浮层都画读到的那张。
  const slotReady = { key: SLOT_KEY, state: 'ready', reason: '', at: T1, tries: 1, raw: ownTableAt(T1) }
  const st1: any = stOf(slotReady, true)
  const pick1: any = table.ownRoutePickOf(st1)
  check(!!pick1 && !!pick1.view && pick1.view.state === 'ok', '选路：本机读数优先，快照挂坏表时仍回 ok（实得 ' + JSON.stringify(pick1 && pick1.view && pick1.view.state) + '）')
  check(!!pick1 && pick1.fallback === null, '读到过就不画「正在读」')
  const panel1: any = treeAt(st1)
  check(panel1.state === 'ok', '面板里的表画成 ok 那一档（实得 ' + JSON.stringify(panel1.state) + '）')
  check(findNode(panel1.tree, function (n: any) { return attrOf(n) === 'unreadable' }) === null, '面板不再画「读不出来」')
  const popup1: any = popoverAt(st1)
  check(!!popup1.pop, '浮层开着（注入的界面状态就是打开）')
  check(popTableState(popup1.pop) === 'ok', '浮层里的表也是读到的那份（实得 ' + JSON.stringify(popTableState(popup1.pop)) + '）')

  // E2. 本机读数还没到 + 快照没表 → 浮层写「正在读」，不写成「还没有」。
  const slotLoading = { key: SLOT_KEY, state: 'loading', reason: '', at: '', tries: 0, raw: null }
  const st2: any = stOf(slotLoading, false)
  const pick2: any = table.ownRoutePickOf(st2)
  check(!!pick2 && !!pick2.fallback && pick2.fallback.state === 'loading', '一次都没读到时选路给「正在读」那一档')
  const popup2: any = popoverAt(st2)
  check(!!popup2.pop && popHas(popup2.pop, 'data-work-route-loading'), '浮层里写「正在读」')
  check(!popup2.pop || !popHas(popup2.pop, 'data-work-route-idle'), '不写成「还没有」——那是另一个修法方向')

  // E3. 本机读数没到 + 快照挂坏表 → 仍如实说「读不出来」，不拿空态盖住失败。
  const st3: any = stOf(null, true)
  const pick3: any = table.ownRoutePickOf(st3)
  check(!!pick3 && !!pick3.view && pick3.view.state === 'unreadable', '没读到本机读数时仍如实说「读不出来」（实得 ' + JSON.stringify(pick3 && pick3.view && pick3.view.state) + '）')
  check(treeAt(st3).state === 'unreadable', '面板画「读不出来」那一档')

  // E4. 胶囊展开列表/计数与面板同一条选路：同一份坏表，没接选路时 unreadable，接上后 ok。
  const capBefore: any = ui.capsule.sessionChainCapsuleOf(st1, SID)
  check(capBefore.state === 'unreadable', '胶囊没接这条选路时，坏表照旧画成「读不出来」（实得 ' + JSON.stringify(capBefore.state) + '）')
  const ui2: any = loadUiLeaves(extra, { capsuleOwnRoutePick: table.ownRoutePickOf })
  const capAfter: any = ui2.capsule.sessionChainCapsuleOf(st1, SID)
  check(capAfter.state === 'ok' && !!capAfter.entry && capAfter.entry.ticketKey === '1373', '胶囊接上同一条选路后翻成 ok（实得 ' + JSON.stringify({ state: capAfter.state, key: capAfter.entry && capAfter.entry.ticketKey }) + '）')
}

async function main(): Promise<void> {
  const own: any = loadSpliced('src/client/kernel/work-route-own.js',
    ['adoptWorkRouteTableIfNewer'], { snapNeedsOwnWorkRoute: function (): boolean { return false } })
  const ui: any = loadUiLeaves()
  partA(own, ui)
  await partB(own, ui)
  await partC(own)
  await partD()
  partE()
}

main().then(function (): void {
  console.log('')
  if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
  else console.log('OK：' + total + ' 条断言全部通过')
  if (failed) process.exitCode = 1
  const t: any = setTimeout(function (): void { process.exit(failed ? 1 : 0) }, 200)
  if (t && typeof t.unref === 'function') t.unref()
}, function (err: any): void {
  console.error('门禁脚本自身出错：', err)
  process.exitCode = 1
})
