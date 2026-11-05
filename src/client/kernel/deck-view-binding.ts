/**
 * src/client/kernel/deck-view-binding.ts —— 视图模型的生产接线（#1894）
 *
 * 这一片只做三件事，把纯视图模型（deck-view-model.ts）接到真实会话存储上：
 *  1. 投影帧按「工作区 + 库版本」共享：同一版本切会话拿到同一个帧，counts / readout 不重算；
 *  2. 把会话存储里的筛选与阅读态交给视图模型，命令改完只通知相关切片，不整棵界面 emit；
 *  3. 把状态栏原来直接打的那条宿主电话（wf.cwd）收进这一层 —— 视图层不再直连宿主。
 *
 * 为什么不能直接 import：客户端闭包是构建时把各片拼进同一个函数作用域（scripts/build.mts），
 * 所以跨片名字一律写模块级 declare，运行时由拼接后的闭包提供。写成 declare 的另一个好处是
 * 门禁可以单独构造这一层、传一份假 scope，不启动浏览器。
 *
 * 反例：不要在这里写第二份计数或行筛选口径 —— counts 走 store-derived 那几个既有函数，
 * 行筛选在纯视图模型里；这一层只负责取输入、转结果、持久化 UI 偏好。
 */
declare const React: any;
declare const host: any;
declare const wsKeyOf: any;
declare const snapshotVersionBookOf: any;
declare const ticketRowsOf: any;
declare const issuePageRowsOf: any;
declare const isOccupied: any;
declare const effortOf: any;
declare const occCount: any;
declare const deckCountsOf: any;
declare const bugCount: any;
declare const triageCount: any;
declare const kpiCountsOf: any;
declare const listPrefs: any;
declare const saveListPrefs: any;

// 纯视图模型那一片由构建排在本片之前拼进同一个闭包（scripts/build.mts 的 kernel 清单），所以这里只声明形状、
// 不写运行时 import（构建侧 toSpliceableFragment 会拒收残留的 import）。门禁单独加载本文件时，先挂上
// globalThis.createDeckView / deckFiltersOf / deckReadingOf 再 import，与仓里其它 kernel 片的做法一致。
declare function createDeckView(options: any): any
declare function deckFiltersOf(value: any): any
declare function deckReadingOf(value: any): any
type DeckViewSliceName = 'projection' | 'filters' | 'rows' | 'counts' | 'readout' | 'reading'

/** 接线用到的闭包邻居；门禁传第二参时整份换掉（宿主电话与全部派生函数都可替换）。 */
export interface DeckViewScope {
  host?: any
  wsKeyOf?: any
  snapshotVersionBookOf?: any
  ticketRowsOf?: any
  issuePageRowsOf?: any
  isOccupied?: any
  effortOf?: any
  occCount?: any
  deckCountsOf?: any
  bugCount?: any
  triageCount?: any
  kpiCountsOf?: any
  listPrefs?: any
  saveListPrefs?: any
}

function deckScope(): DeckViewScope {
  return {
    host: (typeof host !== 'undefined' ? host : null),
    wsKeyOf: (typeof wsKeyOf === 'function' ? wsKeyOf : null),
    snapshotVersionBookOf: (typeof snapshotVersionBookOf === 'function' ? snapshotVersionBookOf : null),
    ticketRowsOf: (typeof ticketRowsOf === 'function' ? ticketRowsOf : null),
    issuePageRowsOf: (typeof issuePageRowsOf === 'function' ? issuePageRowsOf : null),
    isOccupied: (typeof isOccupied === 'function' ? isOccupied : null),
    effortOf: (typeof effortOf === 'function' ? effortOf : null),
    occCount: (typeof occCount === 'function' ? occCount : null),
    deckCountsOf: (typeof deckCountsOf === 'function' ? deckCountsOf : null),
    bugCount: (typeof bugCount === 'function' ? bugCount : null),
    triageCount: (typeof triageCount === 'function' ? triageCount : null),
    kpiCountsOf: (typeof kpiCountsOf === 'function' ? kpiCountsOf : null),
    listPrefs: (typeof listPrefs !== 'undefined' ? listPrefs : null),
    saveListPrefs: (typeof saveListPrefs === 'function' ? saveListPrefs : null),
  }
}

function deckVersionOf(scope: DeckViewScope, st: any): number | null {
  try {
    const book = scope.snapshotVersionBookOf ? scope.snapshotVersionBookOf(st && st.cwd) : null
    return (book && typeof book.version === 'number') ? book.version : null
  } catch (e) { return null }
}

function deckWsKeyOf(scope: DeckViewScope, st: any): string {
  try {
    const cwd = (st && st.cwd) || ''
    return String((scope.wsKeyOf ? scope.wsKeyOf(cwd) : cwd) || '')
  } catch (e) { return '' }
}

function deckRowsOf(scope: DeckViewScope, projection: any): any[] {
  try {
    const issues = (projection && Array.isArray(projection.issues)) ? projection.issues : []
    return scope.ticketRowsOf ? scope.ticketRowsOf(issues) : issues
  } catch (e) { return [] }
}

function deckPageRowsOf(scope: DeckViewScope, st: any): any[] {
  try { return (scope.issuePageRowsOf && st) ? (scope.issuePageRowsOf(st, 'list') || []) : [] } catch (e) { return [] }
}

/** 全局读数：总数/开放/已关闭/可接/占用/BUG/诊断。全部走既有派生函数，这一层不另算一份。 */
function deckCountsFor(scope: DeckViewScope, projection: any): any {
  const stLike: any = { snapshot: projection || {} }
  const rows = deckRowsOf(scope, projection)
  let open = 0
  let closed = 0
  for (let i = 0; i < rows.length; i++) { if (rows[i] && rows[i].state === 'CLOSED') closed++; else open++ }
  const occupied = scope.occCount ? scope.occCount(stLike) : rows.filter(function (r: any): boolean { return !!(r && Array.isArray(r.assignees) && r.assignees.length) }).length
  const backend = scope.deckCountsOf ? scope.deckCountsOf(stLike, false) : null
  const bug = scope.bugCount ? scope.bugCount(stLike) : 0
  const triage = scope.triageCount ? scope.triageCount(stLike) : 0
  const takeable = backend ? Math.max(0, backend.open - occupied) : (open - occupied)
  const local = { open: open, occupied: occupied, closed: closed }
  const kpi = scope.kpiCountsOf ? scope.kpiCountsOf(stLike, false, local) : { takeable: takeable, closed: closed, unknown: false, pending: false, atMs: 0, source: 'local-enumeration' }
  return {
    total: backend ? backend.total : rows.length,
    open: backend ? backend.open : open,
    closed: backend ? backend.closed : closed,
    takeable: takeable,
    occupied: occupied,
    bug: bug,
    triage: triage,
    backend: backend,
    kpi: kpi,
    atMs: (backend && typeof backend.atMs === 'number') ? backend.atMs : 0,
  }
}

/** 按「工作区 + 库版本」共享的投影帧。切会话、切回同一版本时拿到的都是同一个对象。 */
const deckFrames: Map<string, any> = new Map()

function deckFrameOf(scope: DeckViewScope, st: any): any {
  const ws = deckWsKeyOf(scope, st)
  const version = deckVersionOf(scope, st)
  const projection = (st && st.snapshot) ? st.snapshot : null
  const key = ws + '|' + (version === null ? 'unknown' : String(version))
  const held = deckFrames.get(key)
  // 有版本号时只认版本；没有版本号（旧宿主/空库）只认同一份投影对象，不拿内容碰碰运气。
  const reusable = held && (version !== null ? true : held.projection === projection)
  if (reusable) return held
  const frame: any = {
    key: key,
    version: version,
    projection: projection,
    counts: deckCountsFor(scope, projection),
    readout: {
      version: version,
      generatedMs: (projection && projection.generatedMs) || 0,
      workRouteTable: (projection && projection.workRouteTable) || null,
    },
  }
  deckFrames.set(key, frame)
  // 同一工作区只留最近四帧：切回上一版本还能复用，旧版本不会被无限攒着。
  const prefix = ws + '|'
  const stale: string[] = []
  deckFrames.forEach(function (_f: any, k: string): void {
    if (k.indexOf(prefix) === 0 && k !== key) stale.push(k)
  })
  while (stale.length > 3) { const drop = stale.shift(); if (drop) deckFrames.delete(drop) }
  return frame
}

function deckFiltersFromStore(st: any): any {
  const prefs: any = (typeof listPrefs !== 'undefined' ? listPrefs : null)
  const source: any = (st && st.stateFilter !== undefined) ? st : (prefs || {})
  return deckFiltersOf({
    stateFilter: source.stateFilter,
    lblFilters: source.lblFilters,
    effFilters: source.effFilters,
    sortKey: source.sortKey,
    sortDir: source.sortDir,
    expLabels: (st && st.expLabels) === true,
  })
}

function deckReadingFromStore(scope: DeckViewScope, st: any): any {
  return deckReadingOf({
    activeIssue: (st && st.activeIssue !== undefined) ? st.activeIssue : null,
    activeMap: (st && st.activeMap !== undefined) ? st.activeMap : null,
    draft: (st && typeof st.cmtDraft === 'string') ? st.cmtDraft : '',
    pageRows: deckPageRowsOf(scope, st),
  })
}

function deckPortsOf(scope: DeckViewScope, frame: any): any {
  const projection = frame.projection
  return {
    rowsSource: function (f: any, reading: any): any[] {
      const rows = deckRowsOf(scope, f.projection)
      const pages = Array.isArray(reading.pageRows) ? reading.pageRows : []
      return rows.concat(pages)
    },
    effortOf: function (row: any): string {
      try { return String((scope.effortOf ? scope.effortOf(row) : (row && row.effortId)) || '') } catch (e) { return '' }
    },
    occupiedOf: function (row: any): boolean {
      try { return scope.isOccupied ? !!scope.isOccupied({ snapshot: projection }, row) : false } catch (e) { return false }
    },
    labelNamesOf: function (row: any): string[] {
      const labs = (row && Array.isArray(row.labels)) ? row.labels : []
      return labs.map(function (l: any): string { return (typeof l === 'string') ? l : String((l && l.name) || '') })
    },
  }
}

// 每个会话存储一个视图模型：筛选与阅读态是会话私有的，不能和别的会话共用一份。
const deckViewsByStore: WeakMap<object, any> = new WeakMap()

/** 取这个会话的视图模型；同一版本重复调用不重算任何切片。 */
export function deckViewOf(st: any, scopeOverride?: DeckViewScope): any {
  const scope = scopeOverride || deckScope()
  let view = (st && typeof st === 'object') ? deckViewsByStore.get(st) : undefined
  if (!view) {
    const frame = deckFrameOf(scope, st)
    view = createDeckView({ frame: frame, filters: deckFiltersFromStore(st), reading: deckReadingFromStore(scope, st), ports: deckPortsOf(scope, frame) })
    if (st && typeof st === 'object') deckViewsByStore.set(st, view)
    return view
  }
  view.adopt({ frame: deckFrameOf(scope, st), filters: deckFiltersFromStore(st), reading: deckReadingFromStore(scope, st) }, { silent: true })
  return view
}

/** 按切片取一份只读状态（视图渲染时读它，不自己从 st 里挑字段）。 */
export function deckViewSliceOf(st: any, name: DeckViewSliceName, scopeOverride?: DeckViewScope): any {
  return deckViewOf(st, scopeOverride).slice(name)
}

/** 全局读数（状态栏与检查页读同一份）：没有视图模型时返回空对象，调用方自己退回旧函数。 */
export function deckViewCountsOf(st: any, scopeOverride?: DeckViewScope): any {
  try { return deckViewOf(st, scopeOverride).slice('counts') } catch (e) { return null }
}

/** 胶囊与其它全局读数读的投影：与视图模型 projection 切片是同一个对象。 */
export function deckProjectionOf(st: any, scopeOverride?: DeckViewScope): any {
  try { return deckViewOf(st, scopeOverride).slice('projection').snapshot } catch (e) { return (st && st.snapshot) ? st.snapshot : null }
}

/** 把筛选命令写回会话存储（界面别的角落还按 st 字段读，镜像保持同步），并按旧口径持久化列表偏好。 */
function deckMirrorFilters(st: any, filters: any, command: string, scope: DeckViewScope): void {
  if (!st || !filters) return
  st.stateFilter = filters.stateFilter
  st.lblFilters = filters.lblFilters.slice()
  st.effFilters = filters.effFilters.slice()
  st.sortKey = filters.sortKey
  st.sortDir = filters.sortDir
  st.expLabels = filters.expLabels
  const prefs = scope.listPrefs
  if (prefs) {
    if (command === 'setStateFilter') { prefs.stateFilter = filters.stateFilter }
    if (command === 'setSort') { prefs.sortKey = filters.sortKey; prefs.sortDir = filters.sortDir }
  }
  try {
    if (command === 'setStateFilter' && scope.saveListPrefs) scope.saveListPrefs('stateFilter')
    if (command === 'setSort' && scope.saveListPrefs) scope.saveListPrefs(['sortKey', 'sortDir'])
  } catch (e) {}
}

/**
 * 视图层改筛选的唯一入口：改视图模型、镜像 st、持久化，但**不** emit。
 * 不 emit 是重点 —— 只有订阅了 filters/rows 的视图会重画，状态栏与胶囊不跟着闪。
 */
export function deckViewCommand(st: any, name: string, payload?: any, scopeOverride?: DeckViewScope): any {
  const scope = scopeOverride || deckScope()
  const view = deckViewOf(st, scope)
  const result = view.command(name, payload)
  if (result.changed.indexOf('filters') >= 0) deckMirrorFilters(st, result.filters, name, scope)
  try {
    if (name === 'openIssue') st.activeIssue = result.reading.activeIssue
    if (name === 'openMap') st.activeMap = result.reading.activeMap
    if (name === 'setDraft') st.cmtDraft = result.reading.draft
  } catch (e) {}
  return result
}

/** 订阅一个切片。切片版本没变时不会回调；返回取消订阅函数。 */
export function useDeckViewSlice(st: any, name: DeckViewSliceName): any {
  const view = deckViewOf(st)
  const setTick = React.useState(0)[1]
  React.useEffect(function (): any {
    return view.subscribe(name, function (): void { setTick(function (n: number): number { return n + 1 }) })
  }, [view, name])
  return view.slice(name)
}

/**
 * 一次订阅多个切片并返回视图模型本身（列表页同时要 filters/counts/rows 三片）。
 * 切片名数组按内容拼成依赖键，调用方每次传同一组名字时不会重复订阅。
 */
export function useDeckViewFor(st: any, names: DeckViewSliceName[]): any {
  const view = deckViewOf(st)
  const setTick = React.useState(0)[1]
  const key = names.join('|')
  React.useEffect(function (): any {
    const offs = names.map(function (n: DeckViewSliceName): any {
      return view.subscribe(n, function (): void { setTick(function (x: number): number { return x + 1 }) })
    })
    return function (): void { offs.forEach(function (off: any): void { try { off() } catch (e) {} }) }
  }, [view, key])
  return view
}

/**
 * 状态栏问「这个会话在哪个目录」的那条宿主电话，从视图文件搬到这里。
 * 视图层只拿到结果回调，不再自己摸 host.call；失败静默，与搬出前一致。
 */
export function deckResolveSessionCwd(st: any, sid: any, apply: (cwd: any, source: string) => void, scopeOverride?: DeckViewScope): boolean {
  const scope = scopeOverride || deckScope()
  const phone = scope.host
  if (!sid || !phone || typeof phone.call !== 'function' || typeof apply !== 'function') return false
  try {
    phone.call('wf.cwd', { sessionId: sid }).then(function (res: any): void {
      if (res && res.ok && res.cwd) apply(res.cwd, 'wf.cwd')
    }).catch(function (): void {})
    return true
  } catch (e) { return false }
}

/** 门禁与排查用：清掉共享帧表，让每个用例从干净状态开始。 */
export function deckViewForgetFrames(): void { deckFrames.clear() }