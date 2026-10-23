// tests/verify-1355-cross-session-table.ts —— 门禁：状态栏胶囊不许显示别的会话的工作路线（#1355）。
//
// 用户看到的样子：同一个工作区里开着两个会话，A 会话动过几张票；切到 B 会话（或者 B 刚打开）时，
// 状态栏胶囊里列出来的却是 A 动过的那几张，B 自己一张也没动过。原因不是宿主算错了 —— 宿主每次回包
// 都按「请求里那个会话号」现算工作路线；错在客户端：快照缓存按工作区共享，而缓存里却存着「当时请求
// 那个会话」的读数，B 水合到 A 的快照，就把 A 的行当成自己的行。
//
// 修复分三处（都在客户端，不改宿主回执形状）：
//   一、落缓存时把 workRouteTable 剥掉 —— 内存 LRU 与 IndexedDB 两条路都不留，也不动调用方手里那份；
//   二、水合时把旧版本缓存里已经带上的表剥掉再装，并且不原地改那份老对象（它可能正被别的会话当快照用）；
//   三、装上的快照缺本会话的表时，不看 60 秒新鲜期，补发一次带当前会话号的强制请求；回包里的表挂回快照。
//
// 本门禁量五件事：
//   A. 缓存与水合不串：落缓存不改调用方、内存与磁盘条目都无表、水合旧条目先剥表、判据真值表；
//   B. 补拉真的发生：快照仍在新鲜期内也发 wf.refresh，请求参数带当前会话号；不搭别的会话的在途车
//      （普通、强制、还没有快照三种现场都不搭，迟到的别人的回包也装不进本会话）；回包里的表装得进快照、
//      判据随之转 false；回包没带表时胶囊回 idle，换目录接线再补一次；
//   C. 三处接线（换目录 / 挂载 / 切会话）共用同一个决策函数：缺表一律强制静默补拉，表在手时旧行为一个字不丢，
//      同一份快照只补一次。这里直接测 kernel/work-route-own.ts 的那个函数，不读状态栏源码文本钉声明写法
//      （维护者 2026-10-12 已整批删掉那类断言，见 tests/verify-kernel.ts 开头）；
//   D. 判据层：交来的快照没有表时胶囊回 idle（不冒充「没有记录」），表里只有别人的行时回 empty
//      （绝不挑一行当自己的），有自己的行时才回 ok；
//   E. 同工作区扇出与探测补丁：宿主回包或手动刷新拿到的表只归请求它的那个会话，扇出给同组其他会话的快照
//      先剥表，再给每个接手方补一次带自己会话号的请求（真机现场就是 B 看到 A 的行）。
//
// 门禁归属: src/refresh/rooms/client/snapshot-cache-store.ts
// 门禁归属: src/client/kernel/work-route-own.ts
// 门禁归属: src/refresh/rooms/client/snapshot-sync.ts
// 门禁归属: src/refresh/rooms/client/staleness-indicator.ts
// 门禁归属: src/refresh/rooms/client/probe-scope-selection.ts
// 门禁归属: src/refresh/rooms/client/refresh-timer.ts
// 门禁归属: src/client/kernel/api-new-session.ts
// 门禁归属: src/client/statusbar/StatusBar.ts
// 门禁归属: src/client/statusbar/SessionChainCapsule.ts
// 门禁归属: src/client/views/shared/workRouteTable.ts
//
// 用法（在插件根目录；不需要先构建，本门禁跑的是真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-1355-cross-session-table.ts
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs, sourceText } from './lib/source-text.ts'
// 中央时间真值：快照等待只住 config/*.yaml，这里读同一份导出，不在测试里写第二份数字。
import { SNAP_WAIT_MS } from '../src/shared/time-config/values.js'

let failed = false
let total = 0
const check = function (ok: any, msg: string): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
const sleep = function (ms: number): Promise<void> {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}
const tick = function (): Promise<void> {
  return new Promise(function (resolve) { setTimeout(resolve, 0) })
}
const ISO = '2026-10-21T12:00:00.000Z'

// ---------------------------------------------------------------------------------------------
// 把一份「一源一物」的真源码当模块跑起来：剥掉行首 export（spliceableJs 已做），把跨闭包名字
// 按参数塞进来，末尾交出这门禁要用的几个出口。手法与 tests/verify-907-chain-titles.ts 同源。
// ---------------------------------------------------------------------------------------------
const loadSpliced = function (relPath: string, exportNames: string[], scope: Record<string, any>): any {
  const paramNames = Object.keys(scope)
  const fn = compileFn(paramNames, spliceableJs(relPath) + '\nreturn { ' + exportNames.join(', ') + ' }')
  return fn.apply(null, paramNames.map(function (k) { return scope[k] }))
}

// ---------------------------------------------------------------------------------------------
// A. 缓存与水合：会话相关的读数不许跟着按工作区共享的缓存走
// ---------------------------------------------------------------------------------------------
const partA = async function (): Promise<any> {
  console.log('#1355 A. 缓存与水合不把别的会话的工作路线带过来')

  // 假 IndexedDB：够 diskPutSnapshot 跑完一条 put 即可，把落盘条目记下来给断言看。
  const diskPuts: any[] = []
  const fakeDb = {
    createObjectStore: function (): void {},
    transaction: function (): any {
      return {
        objectStore: function (): any {
          return {
            put: function (entry: any, key: any): void { diskPuts.push({ entry: entry, key: key }) },
            getAll: function (): any { return {} },
            delete: function (): void {},
          }
        },
      }
    },
  }
  const fakeWindow = {
    indexedDB: {
      open: function (): any {
        const req: any = { result: fakeDb }
        setTimeout(function () {
          try { if (typeof req.onupgradeneeded === 'function') req.onupgradeneeded() } catch (e) {}
          try { if (typeof req.onsuccess === 'function') req.onsuccess() } catch (e) {}
        }, 0)
        return req
      },
    },
  }

  const store: any = loadSpliced('src/refresh/rooms/client/snapshot-cache-store.js', [
    'makeStore', 'setCachedSnapshot', 'getCachedSnapshot', 'getCachedEntry',
    'hydrateFromCache', 'snapNeedsOwnWorkRoute', 'snapshotByCwd', 'wsKeyOf', 'emit',
  ], {
    keyOf: function (x: any): string { return String(x || '').replace(/\\/g, '/').toLowerCase() },
    migrateCachedChoiceToKey: function (): void {},
    DEFAULT_PANEL_H: 520,
    listPrefs: { stateFilter: 'all', sortKey: 'number', sortDir: 'asc' },
    isEnabled: function (): boolean { return false },
    log: function (): void {},
    dswsLogHash: function (s: any): string { return 'h' + String(s || '').length },
    promptLang: function (): string { return 'zh' },
    nowStr: function (): string { return '00:00:00' },
    ctx: { get: function (): any { return null } },
    namingGuardianEvent: function (): void {},
    installDialogSignals: function (): void {},
    getCachedRepository: function (): any { return null },
    setCachedRepository: function (): void {},
    setPresentationMap: function (): void {},
    keepUserPick: function (a: any, b: any): any { return b },
    React: null,
    timer: { timeout: function (fn: any, ms: number): any { return setTimeout(fn, ms) } },
    STORE_NOTICE_DISMISS_MS: 5000,
    window: fakeWindow,
  })

  // A1. 落缓存不改调用方手里那份，且内存条目按「工作区键」存一份不带表的浅拷贝。
  const cwdA = 'D:\\ws1355-a'
  const snapA: any = {
    ok: true, maps: [], version: 'v1', generatedMs: 1700000000000,
    workRouteTable: { ok: true, readout: { at: ISO, staleCount: 0, entries: [] } },
    notModified: true, status: 304, cached: true,
  }
  store.setCachedSnapshot(cwdA, snapA)
  check(snapA.workRouteTable !== undefined && snapA.notModified === true && snapA.status === 304 && snapA.cached === true,
    '落缓存不改调用方手里那份（工作路线表与三个响应传输态标记都还在）')
  const entA: any = store.getCachedEntry(cwdA)
  check(!!entA && entA.snapshot !== snapA, '内存条目存的是一份浅拷贝，不是调用方那个对象')
  check(!!entA && entA.snapshot.workRouteTable === undefined && entA.snapshot.notModified === undefined
    && entA.snapshot.status === undefined && entA.snapshot.cached === undefined,
    '内存条目里没有工作路线表，也没有 notModified / status / cached')
  await sleep(20)
  const putA: any = diskPuts.filter(function (p) { return p.key === store.wsKeyOf(cwdA) }).pop()
  check(!!putA && putA.entry && putA.entry.snapshot && putA.entry.snapshot.workRouteTable === undefined,
    '磁盘条目同样没有工作路线表')

  // A2. 升级前的存量：缓存条目里带着表，水合到另一个会话时要先剥掉再装。
  const cwdB = 'D:\\ws1355-b'
  const oldSnap: any = {
    ok: true, maps: [], version: 'vOld', generatedMs: 1700000001000,
    selection: { backendId: 'github' },
    workRouteTable: {
      ok: true,
      readout: {
        at: ISO, staleCount: 0,
        entries: [{ ticketKey: '999', title: '甲会话动过的票', sessionLabel: 'sess-A', action: 'report', actionAt: ISO, active: true, currentSession: true }],
      },
    },
  }
  store.snapshotByCwd.set(store.wsKeyOf(cwdB), { snapshot: oldSnap, version: 'vOld', ts: Date.now(), key: store.wsKeyOf(cwdB) })
  const stB: any = store.makeStore()
  stB.sessionId = 'sess-B'
  stB.cwd = cwdB
  const changed: boolean = store.hydrateFromCache(stB)
  check(changed === true, '带表的旧缓存能水合进新会话（实得 ' + String(changed) + '）')
  check(!!stB.snapshot && stB.snapshot.workRouteTable === undefined, '水合装进来的快照里没有别人的工作路线表')
  check(!!stB.snapshot && stB.snapshot !== oldSnap, '水合装的是另一份对象，不是缓存里那份老对象')
  check(oldSnap.workRouteTable !== undefined, '没有原地改那份老对象（它可能正被同工作区另一个会话当快照用）')
  const entB: any = store.getCachedEntry(cwdB)
  check(!!entB && entB.snapshot === stB.snapshot && entB.snapshot.workRouteTable === undefined,
    '缓存条目也换成了没有表的那一份（升级前的存量顺手清掉）')
  check(store.snapNeedsOwnWorkRoute(stB) === true, 'B 手上缺自己的表 → 判据说要补拉')
  await sleep(20)
  const putB: any = diskPuts.filter(function (p) { return p.key === store.wsKeyOf(cwdB) }).pop()
  check(!!putB && putB.entry && putB.entry.snapshot && putB.entry.snapshot.workRouteTable === undefined,
    '磁盘里那条旧条目也被换成了没有表的版本（升级前的存量不只清内存）')

  // A3. 判据真值表：只回答「缺不缺表」，不回答「行是不是自己的」。
  const T = store.snapNeedsOwnWorkRoute
  check(T(null) === false && T(undefined) === false, '没有会话状态时不补拉')
  check(T({ snapshot: {} }) === false, '没有会话号时不补拉')
  check(T({ sessionId: 'sess-B', snapshot: null }) === false, '还没有快照时不补拉')
  check(T({ sessionId: 'sess-B', snapshot: {} }) === true, '快照里没有这个字段 → 要补拉')
  check(T({ sessionId: 'sess-B', snapshot: { workRouteTable: null } }) === true, '字段是 null → 要补拉')
  check(T({ sessionId: 'sess-B', snapshot: { workRouteTable: { ok: false, reason: 'host.work-route.read-failed' } } }) === false,
    '宿主明确说读不到也算有读数，不再反复补拉')
  check(T({ sessionId: 'sess-B', snapshot: { workRouteTable: { ok: true, readout: { at: ISO, staleCount: 0, entries: [] } } } }) === false,
    '宿主说读到了、就是空的，也算有读数')
  check(T({ sessionId: 'sess-B', snapshot: {}, snapLoading: true }) === false, '正在刷新时不判缺（忙的判据收在判据里，不靠调用方各写一遍）')
  check(T({ sessionId: 'sess-B', snapshot: {}, selPending: true }) === false, '后端选择还说不准时不判缺')

  // A4. 坏形状不落缓存（原有守卫不能因为这次改动松掉）。
  const cwdC = 'D:\\ws1355-c'
  store.setCachedSnapshot(cwdC, { ok: false, maps: [] })
  store.setCachedSnapshot(cwdC, { ok: true, maps: null })
  check(store.getCachedEntry(cwdC) === null, 'ok 不是 true 或 maps 不是数组时不落缓存')

  return { store: store }
}

// ---------------------------------------------------------------------------------------------
// D 的前半：把界面两层真叶子装起来（在办表读数叶子 + 胶囊判据）。
// ---------------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------------
// B. 缺表时补拉真的发出去：新鲜期内也发、带当前会话号、不搭别的会话的在途车
// ---------------------------------------------------------------------------------------------
const partB = async function (store: any, ui: any): Promise<void> {
  console.log('#1355 B. 缺自己的表时补发一次带当前会话号的强制请求')

  const staleSrc = spliceableJs('src/refresh/rooms/client/staleness-indicator.js')
  // probe-snapshot 顶部那行中央时间引用在拼好的闭包里非法，求值前整行剥掉；值由 scope 的 SNAP_WAIT_MS 提供。
  const stripTimeConfigImport = function (s: string): string {
    return s.split('\n').filter(function (l) { return !/^\s*import\s.*time-config\/values\.js/.test(l) }).join('\n')
  }
  const snapSrc = staleSrc + '\n' + stripTimeConfigImport(spliceableJs('src/refresh/rooms/client/snapshot-sync.js'))
    + '\n' + spliceableJs('src/refresh/rooms/client/probe-scope-selection.js')

  // #1355：剥表、补拉、三处接线共用决策这三件的真源在 kernel/work-route-own.ts；
  //   下面 B4 的生产路径与 E 的扇出都直接跑它（不再读界面源码文本、也不手写一遍判断）。
  // #1436：缺表不再发强制整份刷新（那支真机中位 25 秒），改由首帧只读电话 wf.workRoute 读本机存档；
  //   所以这里只测决策与剥表，读取本身在 tests/verify-1436-own-work-route.ts 里测。
  const ownSrc = loadSpliced('src/client/kernel/work-route-own.js',
    ['snapshotWithoutWorkRoute', 'snapshotRequestPlan', 'runSnapshotRequestPlan', 'adoptWorkRouteTableIfNewer'],
    { snapNeedsOwnWorkRoute: store.snapNeedsOwnWorkRoute })

  const deferredOf = function (): any {
    let res: any = function (): void {}
    const p = new Promise<any>(function (r) { res = r })
    return { p: p, res: res }
  }
  const makeSnapMod = function (store?: any): any {
    const calls: any[] = []
    const scope: Record<string, any> = {
      SNAP_WAIT_MS: SNAP_WAIT_MS,
      host: { call: function (method: any, params: any): any { const d = deferredOf(); calls.push({ method: method, params: params, d: d }); return d.p } },
      wsKeyOf: store && store.wsKeyOf ? store.wsKeyOf : function (p: any): string { return String(p || '').replace(/\\/g, '/').toLowerCase() },
      tr: function (k: any): string { return String(k) },
      log: function (): void {},
      isEnabled: function (): boolean { return false },
      dswsLogHash: function (s: any): string { return 'h' + String(s || '').length },
      dswsLogTrunc: function (s: any): string { return String(s || '').slice(0, 120) },
      emit: store ? store.emit : function (): void {},
      hydrateFromCache: store ? store.hydrateFromCache : function (): boolean { return false },
      getCachedSnapshot: store ? store.getCachedSnapshot : function (): any { return null },
      setCachedSnapshot: store ? store.setCachedSnapshot : function (): void {},
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
      nowStr: function (): string { return '00:00:00' },
      lcApplySavedColorsOnInstall: function (): void {},
      promptLang: function (): string { return 'zh' },
      userHintOf: function (): any { return undefined },
      _snapRequestKeyWas: function (): boolean { return true },
      reportWorkspaceAttention: function (): void {},
      askSelectionOnce: function (): void {},
      // #1373：304 分支的收表判据住在 work-route-own，台架把真函数递进去（不是 mock），跑的才是生产判据。
      adoptWorkRouteTableIfNewer: ownSrc.adoptWorkRouteTableIfNewer,
      mergeSelection: function (): boolean { return false },
      setCachedSetupLayout: function (): void {},
      shared: {},
      stores: {},
      timer: { timeout: function (fn: any, ms: number): any { return setTimeout(fn, ms) } },
      setTimeout: setTimeout, clearTimeout: clearTimeout, AbortController: AbortController,
      console: { log: function (): void {}, warn: function (): void {}, error: function (): void {} },
    }
    const body = 'with (scope) {\n' + snapSrc + '\n; return { loadSnapshot: loadSnapshot, pendingSnapshotByCwd: pendingSnapshotByCwd }\n}'
    const mod = compileFn(['scope'], body)(scope)
    return { loadSnapshot: mod.loadSnapshot, calls: calls, pending: mod.pendingSnapshotByCwd }
  }

  const tableB = {
    ok: true,
    readout: {
      at: ISO, staleCount: 0,
      entries: [{ ticketKey: '1920', title: '乙会话自己的票', sessionLabel: 'sess-B', action: 'report', actionAt: ISO, active: true, currentSession: true }],
    },
  }

  // B1. 快照还在 60 秒新鲜期内，缺表也必须另发一次；回包里的表要挂回本会话快照。
  const m1 = makeSnapMod()
  const st1: any = {
    cwd: 'D:\\ws1355', sessionId: 'sess-B', selection: { backendId: 'github' },
    snapshot: { ok: true, maps: [], issues: [], thinTickets: [], version: 'vA', generatedMs: Date.now() },
    // loadSnapshot 会顺手问一次 wf.cwd 要工作区根；这里先填好，免得它混进「快照请求」的计数里。
    sessionWorkspaceRoot: 'D:\\ws1355', _wsRootAsked: true,
    snapMode: 'real', snapLoading: false, selPending: false, backendModules: { list: [] },
  }
  check(Date.now() - st1.snapshot.generatedMs < 60000,
    '前置：手上这份快照仍在 60 秒新鲜期内（实得 ' + (Date.now() - st1.snapshot.generatedMs) + 'ms）')
  m1.loadSnapshot(st1, true, true)
  await tick()
  check(m1.calls.length === 1, '缺自己的表时确实发了一次请求（实得 ' + m1.calls.length + ' 次）')
  const c1: any = m1.calls[0] || {}
  check(c1.method === 'wf.refresh', '走的是强制刷新（实得 ' + String(c1.method) + '）')
  check(!!c1.params && c1.params.sessionId === 'sess-B', '请求参数带着当前会话号（实得 ' + JSON.stringify(c1.params && c1.params.sessionId) + '）')
  check(!!c1.params && String(c1.params.cwd || '').indexOf('ws1355') >= 0, '请求参数带着工作区目录')
  if (c1.d) {
    c1.d.res({ ok: true, maps: [], issues: [], thinTickets: [], version: 'vB', generatedMs: Date.now() + 10, workRouteTable: tableB })
  }
  await tick()
  check(!!st1.snapshot && !!st1.snapshot.workRouteTable, '回包里的工作路线表装进了本会话快照')
  check(store.snapNeedsOwnWorkRoute(st1) === false, '补到表之后判据转 false（不会再补拉）')
  const cap1: any = ui.capsule.sessionChainCapsuleOf(st1, 'sess-B')
  check(cap1.state === 'ok' && !!cap1.entry && cap1.entry.ticketKey === '1920',
    '胶囊这时显示的是本会话自己的票（实得 ' + JSON.stringify(cap1.entry && cap1.entry.ticketKey) + '）')

  // B2. 另一个会话有普通请求在途时，B 的补拉不能搭那趟车（force 不复用非 force）。
  const m2 = makeSnapMod()
  const mkSt = function (sid: string): any {
    return {
      cwd: 'D:\\ws1355', sessionId: sid, selection: { backendId: 'github' },
      snapshot: { ok: true, maps: [], issues: [], thinTickets: [], version: 'vA', generatedMs: Date.now() },
      sessionWorkspaceRoot: 'D:\\ws1355', _wsRootAsked: true,
      snapMode: 'real', snapLoading: false, selPending: false, backendModules: { list: [] },
    }
  }
  const stA = mkSt('sess-A')
  const stB2 = mkSt('sess-B')
  m2.loadSnapshot(stA, false, false)
  await tick()
  check(m2.calls.length === 1, 'A 会话先发了一次普通快照请求（实得 ' + m2.calls.length + ' 次）')
  m2.loadSnapshot(stB2, true, true)
  await tick()
  check(m2.calls.length === 2, 'B 缺表时另发一次，不搭 A 的在途车（实得 ' + m2.calls.length + ' 次）')
  const cB: any = m2.calls[1] || {}
  check(cB.method === 'wf.refresh' && !!cB.params && cB.params.sessionId === 'sess-B',
    'B 那次是强制刷新，且带的是 B 自己的会话号（实得 ' + JSON.stringify({ method: cB.method, sid: cB.params && cB.params.sessionId }) + '）')
  // 收尾：把两个 deferred 都回掉（A 那份会被判过期丢掉），别让 30 秒计时器把进程拖住。
  if (m2.calls[0] && m2.calls[0].d) m2.calls[0].d.res({ ok: true, maps: [], version: 'vA', generatedMs: Date.now() })
  if (cB.d) cB.d.res({ ok: true, maps: [], issues: [], thinTickets: [], version: 'vB', generatedMs: Date.now() + 5, workRouteTable: tableB })
  await tick()
  check(!!stB2.snapshot && !!stB2.snapshot.workRouteTable, 'B 自己那份回包装上了（没有被 A 的迟到回包顶掉）')

  // B3. 补拉撞上 304（内容一个字没变）：回包里的表也要挂回本会话快照，否则胶囊会一直空着。
  const m3 = makeSnapMod()
  const st3: any = {
    cwd: 'D:\\ws1355', sessionId: 'sess-B', selection: { backendId: 'github' },
    snapshot: { ok: true, maps: [], issues: [], thinTickets: [], version: 'vA', generatedMs: Date.now() - 120000 },
    sessionWorkspaceRoot: 'D:\\ws1355', _wsRootAsked: true,
    snapMode: 'real', snapLoading: false, selPending: false, backendModules: { list: [] },
  }
  m3.loadSnapshot(st3, true, true)
  await tick()
  const c3: any = m3.calls[0] || {}
  check(m3.calls.length === 1 && c3.method === 'wf.refresh', '缺表补拉撞上「内容没变」时，同样先发出一次强制请求（实得 ' + m3.calls.length + ' 次）')
  if (c3.d) c3.d.res({ ok: true, notModified: true, status: 304, version: 'vA', generatedMs: st3.snapshot.generatedMs, workRouteTable: tableB })
  await tick()
  check(!!st3.snapshot && !!st3.snapshot.workRouteTable, '304 回包里的工作路线表挂回了本会话快照（版本没变也不丢这一眼）')
  check(store.snapNeedsOwnWorkRoute(st3) === false, '304 补到表之后判据也转 false（不会反复补拉）')

  const tableA4: any = {
    ok: true,
    readout: {
      at: ISO, staleCount: 0,
      entries: [{ ticketKey: '999', title: '甲会话动过的票', sessionLabel: 'sess-A', action: 'report', actionAt: ISO, active: true, currentSession: true }],
    },
  }

  // B4. 跨会话不搭车（#1355 的根修）：A 有普通请求在途时，B 的普通请求也照发自己那一份，迟到的 A 回包装不到 B 身上；
  //     B 那份回包若没带表，换目录接线接手后要再补一次带 B 会话号的请求。
  const m4 = makeSnapMod(store)
  const stA4: any = mkSt('sess-A')
  const stB4: any = mkSt('sess-B')
  m4.loadSnapshot(stA4, false, false)
  await tick()
  check(m4.calls.length === 1, 'B4 前置：A 先发一次普通快照请求（实得 ' + m4.calls.length + ' 次）')
  m4.loadSnapshot(stB4, false, false)
  await tick()
  check(m4.calls.length === 2, 'B 的普通请求不搭 A 的在途车（跨会话不复用，实得 ' + m4.calls.length + ' 次）')
  const cA4: any = m4.calls[0] || {}
  const cB4: any = m4.calls[1] || {}
  check(!!cB4.params && cB4.params.sessionId === 'sess-B',
    'B 那次请求带的是 B 自己的会话号（实得 ' + JSON.stringify(cB4.params && cB4.params.sessionId) + '）')
  if (cA4.d) cA4.d.res({ ok: true, maps: [], issues: [], thinTickets: [], version: 'vA4', generatedMs: Date.now(), workRouteTable: tableA4 })
  await tick()
  await tick()
  // 同一工作区「最新一次请求优先」的旧口径（#669）仍然生效：B 后来那份请求把 A 的序号顶掉了，
  //   所以 A 这份迟到的回包被判过期丢弃 —— 无论它带没带表，都进不了任何一个会话。
  check(!stA4.snapshot || stA4.snapshot.workRouteTable === undefined, 'A 那份迟到的回包被同工作区更新的一次请求顶掉，没有把表装回自己')
  check(!stB4.snapshot || stB4.snapshot.workRouteTable === undefined, 'A 的表也没有装进 B（两个会话各发各的，谁的读数归谁）')
  // B 自己那份回包故意不带表（宿主只回了共享的部分）：生产接线接手后必须再补一次带 B 会话号的请求。
  if (cB4.d) cB4.d.res({ ok: true, maps: [], issues: [], thinTickets: [], version: 'vB4', generatedMs: Date.now() + 10 })
  await tick()
  await tick()
  check(store.snapNeedsOwnWorkRoute(stB4) === true, 'B 的回包没带表 → 判据说缺自己的表')
  const capIdle: any = ui.capsule.sessionChainCapsuleOf(stB4, 'sess-B')
  check(capIdle.state === 'idle', '这时 B 的胶囊回 idle，绝不显示 A 那几行（实得 ' + String(capIdle.state) + '）')
  // #1436：换目录那条接线（StatusBar.apply）拿到这份缺表快照后，快照决策照旧只看新鲜度——
  //   这份快照水合过且新鲜，所以它不发请求；缺的那张名单交给首帧只读电话（另测），不再触发整份重建。
  const fired: boolean = ownSrc.runSnapshotRequestPlan(stB4, true, 'apply', true, m4.loadSnapshot)
  check(fired === false && m4.calls.length === 2,
    'B4：缺表不再触发整份重建（水合且新鲜时决策为不发，实得 ' + String(fired) + ' / ' + m4.calls.length + ' 次）')

  // B5. 两个会话都发强制请求：force 搭 force 原来是允许的，跨会话一律不搭。
  const m5 = makeSnapMod()
  const stA5: any = mkSt('sess-A')
  const stB5: any = mkSt('sess-B')
  m5.loadSnapshot(stA5, true, true)
  await tick()
  m5.loadSnapshot(stB5, true, true)
  await tick()
  check(m5.calls.length === 2 && !!m5.calls[1].params && m5.calls[1].params.sessionId === 'sess-B',
    '两个会话都强制刷新时也不互相搭车（实得 ' + m5.calls.length + ' 次）')
  if (m5.calls[0] && m5.calls[0].d) m5.calls[0].d.res({ ok: true, maps: [], issues: [], thinTickets: [], version: 'vA5', generatedMs: Date.now(), workRouteTable: tableA4 })
  if (m5.calls[1] && m5.calls[1].d) m5.calls[1].d.res({ ok: true, maps: [], issues: [], thinTickets: [], version: 'vB5', generatedMs: Date.now() + 10, workRouteTable: tableB })
  await tick()
  check(!!stB5.snapshot && !!stB5.snapshot.workRouteTable, 'B 拿到的是自己那份带表的回包（没有被 A 的顶掉）')

  // B6. B 手上还没有快照、A 有普通请求在途：同样不搭车，B 自己发（首开那一帧的现场）。
  const m6 = makeSnapMod()
  const stA6: any = mkSt('sess-A')
  const stB6: any = mkSt('sess-B')
  stB6.snapshot = null
  m6.loadSnapshot(stA6, false, false)
  await tick()
  m6.loadSnapshot(stB6, false, false)
  await tick()
  check(m6.calls.length === 2 && !!m6.calls[1].params && m6.calls[1].params.sessionId === 'sess-B',
    'B 还没有快照时也不搭 A 的在途车，发的是自己那份（实得 ' + m6.calls.length + ' 次）')
  if (m6.calls[0] && m6.calls[0].d) m6.calls[0].d.res({ ok: true, maps: [], issues: [], thinTickets: [], version: 'vA6', generatedMs: Date.now() })
  if (m6.calls[1] && m6.calls[1].d) m6.calls[1].d.res({ ok: true, maps: [], issues: [], thinTickets: [], version: 'vB6', generatedMs: Date.now() + 10, workRouteTable: tableB })
  await tick()
  check(!!stB6.snapshot && !!stB6.snapshot.workRouteTable, 'B 首开拿到自己的回包与表')
}

// ---------------------------------------------------------------------------------------------
// C. 三处接线（换目录 / 挂载 / 切会话）共用同一个决策：直接跑状态栏真正调的那个函数
//    从前这一节读状态栏源码文本、用正则挑出三条 useEffect 再逐条 eval —— 那是在钉「源码长什么样」，
//    维护者 2026-10-12 已整批删掉这类断言（见 tests/verify-kernel.ts 开头）。判断现在住在
//    kernel/work-route-own.ts，状态栏每条接线只剩一行调用，于是这里测那个函数就够：
//    判据抽到哪、接线怎么写、声明换成箭头函数，都不会误红。
// ---------------------------------------------------------------------------------------------
const partC = function (store: any): void {
  console.log('#1355 C. 换目录 / 挂载 / 切会话共用同一个决策函数')
  const own = loadSpliced('src/client/kernel/work-route-own.js',
    ['snapshotWithoutWorkRoute', 'snapshotRequestPlan', 'runSnapshotRequestPlan'],
    { snapNeedsOwnWorkRoute: store.snapNeedsOwnWorkRoute })

  const tableB: any = {
    ok: true,
    readout: {
      at: ISO, staleCount: 0,
      entries: [{ ticketKey: '1920', title: '乙会话自己的票', sessionLabel: 'sess-B', action: 'report', actionAt: ISO, active: true, currentSession: true }],
    },
  }
  const stNeed: any = { sessionId: 'sess-B', snapshot: { ok: true, maps: [] }, snapLoading: false, selPending: false }
  const stHave: any = { sessionId: 'sess-B', snapshot: { ok: true, maps: [], workRouteTable: tableB }, snapLoading: false, selPending: false }
  const modes = ['apply', 'mount', 'switch']

  // C1. 缺表：#1436 起快照决策不再看有没有表（缺的名单由只读电话补），只按 mode 与新鲜期走。
  //   真值表：switch 一律不发；水合过且新鲜 → 不发；挂载未满足时静默；换目录未水合时不静默（保留加载反馈）。
  let needOk = true
  let needCases = 0
  modes.forEach(function (mode: any): void {
    ;[true, false].forEach(function (hydrated: any): void {
      ;[true, false].forEach(function (fresh: any): void {
        needCases += 1
        const plan: any = own.snapshotRequestPlan(stNeed, hydrated, mode, fresh)
        const want: any = (mode === 'switch' || (hydrated && fresh))
          ? null
          : { force: false, silent: mode === 'mount' ? true : !!hydrated, why: undefined }
        const same: boolean = (want === null)
          ? plan === null
          : (!!plan && plan.force === want.force && plan.silent === want.silent && plan.why === want.why)
        if (!same) needOk = false
      })
    })
  })
  check(needOk, '缺表不再是补拉理由：三条接线 × 是否水合 × 是否新鲜共 ' + needCases + ' 种组合都只按快照自己的新鲜度走')

  // C2. 表在手：旧行为一个字不丢 —— 切会话不发；挂载与换目录按「水合过且新鲜」决定。
  check(own.snapshotRequestPlan(stHave, true, 'switch', true) === null
    && own.snapshotRequestPlan(stHave, false, 'switch', false) === null,
    '表在手时切会话一律不发（cwd 已就位、换目录那条不跑，首帧那一处归挂载那条）')
  check(own.snapshotRequestPlan(stHave, true, 'mount', true) === null,
    '表在手、水合过且新鲜 → 挂载时不发（配额友好）')
  const mountStale: any = own.snapshotRequestPlan(stHave, false, 'mount', false)
  check(!!mountStale && mountStale.force === false && mountStale.silent === true,
    '表在手但快照不新鲜 → 挂载时照旧发普通静默请求（旧行为保留）')
  const applyWarm: any = own.snapshotRequestPlan(stHave, true, 'apply', false)
  check(!!applyWarm && applyWarm.force === false && applyWarm.silent === true,
    '表在手、水合过但已不新鲜 → 换目录时照旧发普通静默请求')
  const applyCold: any = own.snapshotRequestPlan(stHave, false, 'apply', false)
  check(!!applyCold && applyCold.force === false && applyCold.silent === false,
    '表在手、没水合过（普通冷启动）→ 换目录时照旧发普通请求、不静默（保留加载中反馈）')

  // C3. 真发那一步：按决策调用传进来的 loadSnapshot，参数逐格对上；决策说不发就一次也不碰。
  const calls: any[] = []
  const load = function (st: any, force: any, silent: any, why: any): void { calls.push({ st: st, force: force, silent: silent, why: why }) }
  const stCold: any = { sessionId: 'sess-B', snapshot: null, snapLoading: false, selPending: false }
  check(own.runSnapshotRequestPlan(stCold, false, 'mount', false, load) === true && calls.length === 1
    && calls[0].st === stCold && calls[0].force === false && calls[0].silent === true && calls[0].why === undefined,
    '冷启动挂载：按决策真发一次普通静默请求（参数 st / false / true / undefined）')
  const before: number = calls.length
  check(own.runSnapshotRequestPlan(stHave, true, 'switch', true, load) === false && calls.length === before,
    '表在手切会话：决策说不用发，就一次也不调用 loadSnapshot')

  // C4. #1436 起旧的 ensureOwnWorkRoute（缺表补一次快照）整支删除，原先这里那三条断言一并去掉；
  //   「同一份读数在途只读一次 / 迟到回包按会话键丢弃」改在 tests/verify-1436-own-work-route.ts 里测。
}

// ---------------------------------------------------------------------------------------------
// D. 判据层：没有表 → idle；只有别人的行 → empty；有自己的行 → ok
// ---------------------------------------------------------------------------------------------
const partD = function (ui: any): void {
  console.log('#1355 D. 胶囊判据不拿别人的行当自己的')
  const capsuleOf = ui.capsule.sessionChainCapsuleOf
  const tableOf = ui.table.workRouteTableOf
  const stWith = function (fields: any): any {
    return {
      sessionId: 'sess-B',
      snapshot: Object.assign({ ok: true, maps: [], issues: [], thinTickets: [], generatedMs: Date.now() }, fields),
    }
  }

  const stNoTable = stWith({})
  check(tableOf(stNoTable).state === 'idle', '快照里没有这个字段时，在办表判据回 idle')
  check(capsuleOf(stNoTable, 'sess-B').state === 'idle', '没有表时胶囊也回 idle（不冒充「没有记录」，也不挑一行）')

  const stOther = stWith({
    workRouteTable: {
      ok: true,
      readout: {
        at: ISO, staleCount: 0,
        entries: [{ ticketKey: '999', title: '甲会话动过的票', sessionLabel: 'sess-A', action: 'report', actionAt: ISO, active: true, currentSession: false }],
      },
    },
  })
  check(tableOf(stOther).state === 'ok', '表本身读得出来（这一行确实是别人的）')
  const capOther: any = capsuleOf(stOther, 'sess-B')
  check(capOther.state === 'empty' && !capOther.entry, '只有别人的行时胶囊回 empty，绝不拿一行当自己的（实得 ' + capOther.state + '）')

  const stOwn = stWith({
    workRouteTable: {
      ok: true,
      readout: {
        at: ISO, staleCount: 0,
        entries: [{ ticketKey: '1920', title: '乙会话自己的票', sessionLabel: 'sess-B', action: 'report', actionAt: ISO, active: true, currentSession: true }],
      },
    },
  })
  const capOwn: any = capsuleOf(stOwn, 'sess-B')
  check(capOwn.state === 'ok' && !!capOwn.entry && capOwn.entry.ticketKey === '1920' && capOwn.list.length === 1,
    '有自己的行时才回 ok，且只列自己那一行（实得 ' + JSON.stringify({ state: capOwn.state, key: capOwn.entry && capOwn.entry.ticketKey, list: capOwn.list.length }) + '）')
}

// ---------------------------------------------------------------------------------------------
// E. 同工作区扇出与探测补丁：快照可以共享，但「这些行是谁的」不能跟着走
//    真机现场（#1355）：探测或手动刷新拿回一份带表的快照，扇出给同工作区另一个会话；
//    对方把这份表当成自己的读数，胶囊里列的就是别人的工作路线，而它自己一张票都没动过。
//    这里让真的 probe-auto 跑两遍：补丁路径（wf.probe 回 mode:'patch'）与手动刷新路径（refreshAll）。
// ---------------------------------------------------------------------------------------------
const partE = async function (store: any): Promise<void> {
  console.log('#1355 E. 同工作区扇出与探测补丁不把别人的表带给别人')
  const own = loadSpliced('src/client/kernel/work-route-own.js',
    ['snapshotWithoutWorkRoute'], { snapNeedsOwnWorkRoute: store.snapNeedsOwnWorkRoute })
  const tableA: any = {
    ok: true,
    readout: {
      at: ISO, staleCount: 0,
      entries: [{ ticketKey: '999', title: '甲会话动过的票', sessionLabel: 'sess-A', action: 'report', actionAt: ISO, active: true, currentSession: true }],
    },
  }
  const noop = function (): void {}
  const norm = function (x: any): string { return String(x || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }
  const baseSnap = function (version?: string): any {
    return { ok: true, maps: [], issues: [], thinTickets: [], version: version || 'vA', generatedMs: Date.now() }
  }
  const makeProbe = function (opts: any): any {
    const loadCalls: any[] = []
    // #1436：扇出/补丁之后每个会话改读一次本机存档（只读电话），不再为此发整份重建。
    const ownReads: any[] = []
    const emits: any[] = []
    const hostCalls: any[] = []
    const scope: Record<string, any> = {
      SYNC: null,
      SYNC_FALLBACK_PROBE_MS: 60000, SYNC_FOCUS_PROBE_MIN_MS: 60000,
      SYNC_SNAP_FRESH_MS: 60000, PROBE_AUTO_WAIT_MS: 50,
      host: {
        call: function (method: any, params: any): any {
          hostCalls.push({ method: method, params: params })
          return opts.hostCall(method, params)
        },
      },
      _attentionPlan: { intervalMs: 0 },
      shared: opts.shared, stores: opts.stores,
      wsKeyOf: norm, keyOf: norm,
      log: noop,
      dswsLogHash: function (s: any): string { return 'h' + String(s || '').length },
      dswsLogTrunc: function (s: any): string { return String(s || '').slice(0, 120) },
      touchProbeAt: noop,
      emit: function (st: any): void { emits.push(st) },
      diffSnapshots: function (): any { return { added: [], changed: [], removed: [], issueFlash: {} } },
      scheduleFlashClear: noop,
      loadSnapshot: function (st: any, force: any, silent: any, why: any): any {
        loadCalls.push({ st: st, force: force, silent: silent, why: why })
        if (typeof opts.beforeLoad === 'function') opts.beforeLoad(st)
        return Promise.resolve()
      },
      isEnabled: function (): boolean { return false },
      timer: { timeout: function (fn: any, ms: number): any { return setTimeout(fn, ms) } },
      document: undefined, window: undefined,
      hydrateFromCache: function (): boolean { return false },
      snapshotWithoutWorkRoute: own.snapshotWithoutWorkRoute,
      loadOwnWorkRoute: function (st: any): void { ownReads.push({ st: st }) },
      chainEventRefresh: function (): any { return Promise.resolve(null) },
      loadChain: function (): any { return Promise.resolve(null) },
      setupPendingOf: function (): any { return false },
      attentionVisible: function (): boolean { return true },
      attentionStoreOf: function (): any { return null },
      namingGuardianEvent: noop,
      applySnapshotSelection: noop,
      flash: noop,
      tr: function (k: any): string { return String(k) },
    }
    const mod = loadSpliced('src/refresh/rooms/client/refresh-timer.js', ['probeNow', 'refreshAll'], scope)
    return { mod: mod, loadCalls: loadCalls, ownReads: ownReads, emits: emits, hostCalls: hostCalls }
  }

  // E1. 探测补丁路径：宿主回包带着「请求它的那个会话」的表，同组三个 store 都收到剥了表的快照，
  //     并各读一次本机的存档（#1436：不再为这张名单发整份重建）。
  const shared1: any = { cwd: 'D:\\ws1355', sessionId: 'sess-A', snapshot: baseSnap() }
  const stA1: any = { cwd: 'D:\\ws1355', sessionId: 'sess-A', snapshot: baseSnap() }
  const stB1: any = { cwd: 'D:\\ws1355', sessionId: 'sess-B', snapshot: baseSnap() }
  const hostSnap: any = Object.assign(baseSnap('vFromHost'), { workRouteTable: tableA })
  const p1 = makeProbe({
    shared: shared1, stores: { stA1: stA1, stB1: stB1 },
    hostCall: function (): any { return Promise.resolve({ ok: true, changed: true, mode: 'patch', snapshot: hostSnap }) },
  })
  p1.mod.probeNow(false)
  await tick(); await tick()
  check(hostSnap.workRouteTable !== undefined, '宿主回包那份对象没被原地改掉（它可能还在宿主缓存里）')
  check(shared1.snapshot.version === 'vFromHost' && shared1.snapshot.workRouteTable === undefined,
    '主 store 装上了回包，但自己那份快照里也没有表（等自己的补拉回来再挂）')
  check(stA1.snapshot.workRouteTable === undefined && stB1.snapshot.workRouteTable === undefined,
    '同组另外两个会话收到的快照同样没有别人的表')
  check(stA1.snapshot !== stB1.snapshot && stA1.snapshot !== hostSnap, '每个 store 手上是各自的对象，不是同一份共享对象')
  check(p1.loadCalls.length === 0, '同组三个 store 都没有被触发整份快照重建（实得 ' + p1.loadCalls.length + ' 次）')
  check(p1.ownReads.length === 3, '同组三个 store 各读一次本机工作路线存档（实得 ' + p1.ownReads.length + ' 次）')
  const bPull: any = p1.ownReads.filter(function (c: any): boolean { return c.st === stB1 })[0]
  check(!!bPull && bPull.st.sessionId === 'sess-B', '给 B 读存档用的是 B 自己的 store（会话号 sess-B）')

  // E2. 手动刷新路径：主会话自己拉到一份带表的快照，扇出给同工作区另一个会话时表要剥掉，
  //     并让对方读一次自己的存档（#1436）。
  const shared2: any = { cwd: 'D:\\other-ws', sessionId: 'sess-Z', snapshot: baseSnap() }
  const stA2: any = { cwd: 'D:\\ws1355', sessionId: 'sess-A', snapshot: baseSnap(), refreshing: false }
  const stB2: any = { cwd: 'D:\\ws1355', sessionId: 'sess-B', snapshot: baseSnap() }
  const ownSnap2: any = Object.assign(baseSnap('vRefresh'), { workRouteTable: tableA })
  const p2 = makeProbe({
    shared: shared2, stores: { stA2: stA2, stB2: stB2 },
    hostCall: function (): any { return Promise.resolve({ ok: false }) },
    beforeLoad: function (st: any): void { if (st === stA2) stA2.snapshot = ownSnap2 },
  })
  p2.mod.refreshAll(stA2)
  await tick(); await tick(); await tick()
  check(!!stA2.snapshot && !!stA2.snapshot.workRouteTable, '手动刷新：主会话自己那份快照留着表（本来就是按它的会话号算的）')
  check(!!stB2.snapshot && stB2.snapshot.workRouteTable === undefined, '扇出给 B 的快照里没有 A 的表')
  const eLoads: any[] = p2.loadCalls
  check(eLoads.length === 1, '手动刷新只发主会话那一次快照加载（实得 ' + eLoads.length + ' 次）')
  check(!!eLoads[0] && eLoads[0].st === stA2 && eLoads[0].force === true && eLoads[0].silent === true,
    '这一次是主会话自己的强制静默刷新')
  check(p2.ownReads.length === 1 && !!p2.ownReads[0] && p2.ownReads[0].st === stB2,
    'B 收到剥了表的快照后读一次自己的存档（实得 ' + p2.ownReads.length + ' 次）')
}

async function main(): Promise<void> {
  const a: any = await partA()
  const ui: any = loadUiLeaves()
  await partB(a.store, ui)
  partC(a.store)
  partD(ui)
  await partE(a.store)
}

main().then(function (): void {
  console.log('')
  if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
  else console.log('OK：' + total + ' 条断言全部通过')
  if (failed) process.exitCode = 1
  // 万一还有计时器没清掉，给 stdout 一点落盘时间再退出（unref 不挡正常退出）。
  const t: any = setTimeout(function (): void { process.exit(failed ? 1 : 0) }, 200)
  if (t && typeof t.unref === 'function') t.unref()
}, function (err: any): void {
  console.error('门禁脚本自身出错：', err)
  process.exitCode = 1
})
