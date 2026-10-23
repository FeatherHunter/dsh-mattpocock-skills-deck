// tests/verify-1373-stale-table-graft.ts —— 门禁：304 回包捎来的新工作路线读数必须落地（#1373）。
//
// 用户看到的样子：会话里明明调过 report（在办表接口），状态栏胶囊却一直是空的，
// 怎么刷新都不出现那张票。原因不在写的那一边 —— 账本里三笔 report 都记上了；
// 错在读的那一边：report 只改账本不改 issues/version，后续探测拿回 304，
// 客户端 304 那条路只在「本地完全没表」时才肯收新表。本地那份表是「有、但是旧的」
// （report 之前那次快照挂上去的），于是新表每次都被扔掉，胶囊永远是空的，
// 直到 issues 变化或手动强制刷新才好。
//
// 本门禁量三件事：
//   A. 决策函数 kernel/work-route-own.ts 的 adoptWorkRouteTableIfNewer：
//      本地缺表照旧收；本地有表时，只收 ok:true 且（本地坏了、或来者 readout.at 更新）的那一份；
//      同旧、更旧、坏读数一律不换；任何坏形状都不抛错、不改调用方那份旧对象。
//   B. 真 304 现场：跑真 loadSnapshot，宿主回 {notModified:true + 新表}，
//      新表必须挂进当前会话快照，胶囊随之从 empty 翻成 ok（今天这条是红的）。
//   C. 迟到 304 现场：超时后回来的 304 同样把新表挂上，只补 selection 的老路不再丢表。
//
// 门禁归属: src/client/kernel/work-route-own.ts
// 门禁归属: src/refresh/rooms/client/snapshot-sync.ts
// 门禁归属: src/refresh/rooms/client/probe-scope-selection.ts
// 门禁归属: src/client/statusbar/SessionChainCapsule.ts
// 门禁归属: src/client/views/shared/workRouteTable.ts
//
// 用法（在插件根目录；不需要先构建，本门禁跑的是真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-1373-stale-table-graft.ts
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs, sourceText } from './lib/source-text.ts'
import { SNAP_WAIT_MS } from '../src/shared/time-config/values.js'

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
const makeReactStub = function (): any {
  return {
    createElement: function (type: any, props: any): any {
      return { type: type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
    },
    useContext: function (): any { return null },
    useState: function (v: any): any[] { return [v, function (): void {}] },
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
const loadUiLeaves = function (): any {
  const tr = function (key: any): string { return String(key) }
  const table: any = loadLeaf('src/client/views/shared/workRouteTable.js', {
    React: makeReactStub(),
    DswsCtx: null,
    Tip: function (p: any, c: any): any { return { type: 'Tip', props: p || {}, children: c === undefined ? [] : [c] } },
    tr: tr,
    h: function (): any { return {} },
  })
  const capsule: any = loadLeaf('src/client/statusbar/SessionChainCapsule.js', {
    React: makeReactStub(),
    DswsCtx: null,
    tr: tr,
    Ic: function (p: any): any { return { type: 'Ic', props: p || {}, children: [] } },
    Tip: function (p: any, c: any): any { return { type: 'Tip', props: p || {}, children: c === undefined ? [] : [c] } },
    pushNav: function (): void {},
    findMapByIdentity: function (): any { return null },
    workRouteActionKeyOf: table.workRouteActionKeyOf,
    workRouteTableOf: table.workRouteTableOf,
  })
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

async function main(): Promise<void> {
  const own: any = loadSpliced('src/client/kernel/work-route-own.js',
    ['adoptWorkRouteTableIfNewer'], { snapNeedsOwnWorkRoute: function (): boolean { return false } })
  const ui: any = loadUiLeaves()
  partA(own, ui)
  await partB(own, ui)
  await partC(own)
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
