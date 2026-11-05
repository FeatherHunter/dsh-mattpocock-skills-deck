/**
 * src/client/kernel/deck-view-model.ts —— 视图模型基座（#1894，规格 #1885 S6）
 *
 * 为什么要有这一层：列表页、顶部状态栏、会话链胶囊今天各自从会话存储（st）里挑字段、各自算一遍
 * 派生数字。同一份投影在三处被各读各的，换一个视图就要再写一遍；筛选项又和投影混在一个对象上，
 * 改一次筛选只能整棵界面重画。这一层把「投影 + 会话私有阅读态」收成一个视图模型：对外只有状态与命令，
 * 视图按切片订阅，某一片没变时连对象引用都不换。
 *
 * 五个切片（名字是公开契约，视图只认这几个）：
 *   projection —— 手上那份投影（库的版本号 + 快照本体），换版本才换对象；
 *   filters    —— 会话私有的筛选与排序（状态、标签、工作单元、排序档、标签展开态）；
 *   rows       —— 按筛选算出来的行（开放 / 已关闭 / 当前列表里真正画的那一段）；
 *   counts     —— 全局读数（总数/开放/已关闭/可接/占用/BUG/诊断），状态栏与列表顶上的数字同源；
 *   readout    —— 胶囊要的全局读数（库版本、生成时刻、在办表），不含票面正文；
 *   reading    —— 会话私有的阅读态（当前打开的票/地图、草稿、按需翻出来的历史行）。
 *
 * 三条不能改的约定：
 *  1. 同一版本直接复用：adopt 收到与手上相同的版本号时，一个切片都不重算、一个订阅都不通知。
 *     投影帧由调用方按「工作区 + 版本」共享，切会话拿到的是同一个帧，不是重新投影一遍。
 *  2. 只通知相关切片：改筛选只让 filters 与 rows 变；换投影只让 projection/counts/readout/rows 变；
 *     改阅读态只让 reading 变（翻页行变了才带上 rows）。counts 与 readout 不随筛选变化。
 *  3. 不碰宿主电话、不碰 React、不读时钟。这一层只装数据与迁移规则，所以可以单独构造、直接喂假数据测。
 *
 * 反例：不要在这里重新实现领域规则（行怎么分组、容器怎么认、阻塞怎么算都是内核别的片的职责，
 * 这里只按调用方给的端口挑行）；不要把视图节点或配色写进来（那是视图层的事）。
 */

/** 切片名。视图只许订阅这些名字；改名等于改契约，要连同调用方一起改。 */
export type DeckViewSliceName = 'projection' | 'filters' | 'rows' | 'counts' | 'readout' | 'reading'

/** 会话私有的筛选与排序。数组总是新拷贝，命令里不原地改调用方传进来的数组。 */
export interface DeckFiltersState {
  stateFilter: string
  lblFilters: string[]
  effFilters: string[]
  sortKey: string
  sortDir: string
  expLabels: boolean
}

/** 会话私有的阅读态。pageRows 是「已关闭票按需翻出来的历史行」，翻一页要重算 rows。 */
export interface DeckReadingState {
  activeIssue: any
  activeMap: any
  draft: string
  pageRows: any[]
}

/**
 * 一个投影帧：同一「工作区 + 库版本」下所有会话共享的那一份。
 * counts 与 readout 在这一帧里只算一次，切会话直接接着用。
 */
export interface DeckFrame {
  key: string
  version: number | null
  projection: any
  counts: any
  readout: any
}

/** 视图模型向调用方要的四条端口。都不给时用最小口径兜底，够单测独立构造。 */
export interface DeckViewPorts {
  rowsSource?(frame: DeckFrame, reading: DeckReadingState): any[]
  effortOf?(row: any): string
  occupiedOf?(row: any, frame: DeckFrame): boolean
  labelNamesOf?(row: any): string[]
}

export interface DeckViewOptions {
  frame: DeckFrame
  filters?: any
  reading?: any
  ports?: DeckViewPorts
}

export interface DeckCommandResult {
  changed: DeckViewSliceName[]
  filters: DeckFiltersState
  reading: DeckReadingState
}

export interface DeckView {
  slice(name: DeckViewSliceName): any
  versionOf(name: DeckViewSliceName): number
  subscribe(name: DeckViewSliceName, listener: (slice: any) => void): () => void
  command(name: string, payload?: any): DeckCommandResult
  adopt(input: { frame?: DeckFrame, filters?: any, reading?: any }, options?: { silent?: boolean }): { outcome: 'reused' | 'updated', changed: DeckViewSliceName[] }
  frame(): DeckFrame
  filters(): DeckFiltersState
  reading(): DeckReadingState
}

const DECK_SLICES: DeckViewSliceName[] = ['projection', 'filters', 'rows', 'counts', 'readout', 'reading']
const DECK_STATE_FILTERS: string[] = ['all', 'open', 'closed', 'blocked', 'frontier']
const DECK_DEFAULT_FILTERS: DeckFiltersState = { stateFilter: 'all', lblFilters: [], effFilters: [], sortKey: 'number', sortDir: 'asc', expLabels: false }
const DECK_DEFAULT_READING: DeckReadingState = { activeIssue: null, activeMap: null, draft: '', pageRows: [] }

function deckStringList(value: any): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (let i = 0; i < value.length; i++) {
    const v = value[i]
    if (v === null || v === undefined) continue
    const s = String(v)
    if (s) out.push(s)
  }
  return out
}

function deckSameList(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** 把外面塞进来的筛选读成一份干净状态：认不出的状态档回 all，其余字段给稳定默认值。 */
export function deckFiltersOf(value: any): DeckFiltersState {
  const v: any = value || {}
  const state = (typeof v.stateFilter === 'string' && DECK_STATE_FILTERS.indexOf(v.stateFilter) >= 0) ? v.stateFilter : DECK_DEFAULT_FILTERS.stateFilter
  return {
    stateFilter: state,
    lblFilters: deckStringList(v.lblFilters),
    effFilters: deckStringList(v.effFilters),
    sortKey: (typeof v.sortKey === 'string' && v.sortKey) ? v.sortKey : DECK_DEFAULT_FILTERS.sortKey,
    sortDir: v.sortDir === 'asc' ? 'asc' : 'desc',
    expLabels: v.expLabels === true,
  }
}

/** 把外面塞进来的阅读态读成一份干净状态。pageRows 只认数组，坏形状当没有。 */
export function deckReadingOf(value: any): DeckReadingState {
  const v: any = value || {}
  return {
    activeIssue: (v.activeIssue === undefined) ? null : v.activeIssue,
    activeMap: (v.activeMap === undefined) ? null : v.activeMap,
    draft: (typeof v.draft === 'string') ? v.draft : '',
    pageRows: Array.isArray(v.pageRows) ? v.pageRows : [],
  }
}

/** 翻页行这一格比身份：两次都空（新数组也是空）算同一份，避免每次渲染都重算 rows。 */
function deckSamePageRows(a: any[], b: any[]): boolean {
  if (a === b) return true
  return Array.isArray(a) && Array.isArray(b) && a.length === 0 && b.length === 0
}

/** 行是不是已关闭：只认大写 CLOSED，其余（含缺字段）按开放算，与列表页老口径一致。 */
function deckRowClosed(row: any): boolean {
  return !!(row && row.state === 'CLOSED')
}

/** 标签筛选的 OR 语义：没有选中标签时全放行；一张标签都没有的票只命中「needs-triage」。 */
function deckLabelMatch(row: any, filters: DeckFiltersState, ports: DeckViewPorts): boolean {
  const wanted = filters.lblFilters
  if (!wanted.length) return true
  const names: string[] = (typeof ports.labelNamesOf === 'function')
    ? ports.labelNamesOf(row)
    : (Array.isArray(row && row.labels) ? row.labels.map(function (l: any): string { return (typeof l === 'string') ? l : String((l && l.name) || '') }) : [])
  const clean: string[] = []
  for (let i = 0; i < names.length; i++) if (names[i]) clean.push(names[i])
  if (!clean.length) return wanted.indexOf('needs-triage') >= 0
  for (let i = 0; i < wanted.length; i++) if (clean.indexOf(wanted[i]) >= 0) return true
  return false
}

/** 按筛选算三组行。状态档的口径与列表页一致：all/open 都画开放行，blocked/frontier 再按占用分。 */
function deckRowsOf(frame: DeckFrame, filters: DeckFiltersState, reading: DeckReadingState, ports: DeckViewPorts): any {
  const source: any[] = (typeof ports.rowsSource === 'function')
    ? (ports.rowsSource(frame, reading) || [])
    : (Array.isArray(frame.projection && frame.projection.issues) ? frame.projection.issues : [])
  const effortOf = (typeof ports.effortOf === 'function') ? ports.effortOf : function (row: any): string { return String((row && row.effortId) || '') }
  const occupiedOf = (typeof ports.occupiedOf === 'function') ? ports.occupiedOf : function (row: any): boolean { return !!(row && Array.isArray(row.assignees) && row.assignees.length) }
  const open: any[] = []
  const closed: any[] = []
  for (let i = 0; i < source.length; i++) {
    const row = source[i]
    if (!row) continue
    const eff = String(effortOf(row) || '')
    if (filters.effFilters.length && filters.effFilters.indexOf(eff) < 0) continue
    if (!deckLabelMatch(row, filters, ports)) continue
    if (deckRowClosed(row)) { closed.push(row); continue }
    // 拉取请求不是工单：列表页老口径就不收它（判断只在调用方给的 rowsSource 里做，这里不另判一次）。
    if (filters.stateFilter === 'blocked' && !occupiedOf(row, frame)) continue
    if (filters.stateFilter === 'frontier' && occupiedOf(row, frame)) continue
    open.push(row)
  }
  const visible = filters.stateFilter === 'closed' ? closed : open
  return { source: source, open: open, closed: closed, visible: visible, openCount: open.length, closedCount: closed.length }
}

/** 视图模型本体。构造不读时钟、不打电话，所有输入都由调用方给。 */
export function createDeckView(options: DeckViewOptions): DeckView {
  const ports: DeckViewPorts = options.ports || {}
  const listeners: Record<string, Array<(slice: any) => void>> = {}
  const versions: Record<string, number> = {}
  // 渲染期同步（deckViewOf 在 render 里采纳新帧）不通知订阅者：那会变成渲染期 setState。
  // 命令与显式 adopt 照常通知；渲染期拿到的切片本来就在这一趟 render 里被读到了。
  let muted = false
  let frame: DeckFrame = options.frame
  let filters: DeckFiltersState = deckFiltersOf(options.filters)
  let reading: DeckReadingState = deckReadingOf(options.reading)
  let slices: Record<string, any> = {}
  DECK_SLICES.forEach(function (name: string): void { listeners[name] = []; versions[name] = 0 })

  const notify = function (name: DeckViewSliceName): void {
    if (muted) return
    const list = listeners[name]
    if (!list.length) return
    const copy = list.slice()
    for (let i = 0; i < copy.length; i++) { try { copy[i](slices[name]) } catch (e) {} }
  }
  const bump = function (name: DeckViewSliceName, next: any, changed: DeckViewSliceName[]): void {
    slices[name] = next
    versions[name] += 1
    changed.push(name)
    notify(name)
  }
  const rebuildRows = function (changed: DeckViewSliceName[]): void {
    bump('rows', deckRowsOf(frame, filters, reading, ports), changed)
  }
  const rebuildFrameSlices = function (changed: DeckViewSliceName[]): void {
    bump('projection', { version: frame.version, snapshot: frame.projection, key: frame.key }, changed)
    bump('counts', frame.counts, changed)
    bump('readout', frame.readout, changed)
    rebuildRows(changed)
  }
  // 初始切片：构造那一刻不通知任何订阅者（还没有人订阅），但版本号从 0 开始记。
  rebuildFrameSlices([])
  bump('filters', filters, [])
  bump('reading', reading, [])
  // bump 只负责计数与通知；构造时把 changed 传空数组就不会误报「这一趟变了哪些切片」。
  return {
    slice: function (name: DeckViewSliceName): any { return slices[name] },
    versionOf: function (name: DeckViewSliceName): number { return versions[name] || 0 },
    subscribe: function (name: DeckViewSliceName, listener: (slice: any) => void): () => void {
      if (!listeners[name] || typeof listener !== 'function') return function (): void {}
      listeners[name].push(listener)
      return function (): void {
        const at = listeners[name].indexOf(listener)
        if (at >= 0) listeners[name].splice(at, 1)
      }
    },
    command: function (name: string, payload: any): DeckCommandResult {
      const changed: DeckViewSliceName[] = []
      const next: any = Object.assign({}, filters)
      let filtersChanged = false
      if (name === 'setStateFilter') {
        const state = (typeof payload === 'string' && DECK_STATE_FILTERS.indexOf(payload) >= 0) ? payload : 'all'
        if (next.stateFilter !== state) { next.stateFilter = state; filtersChanged = true }
      } else if (name === 'setLabelFilters') {
        const list = deckStringList(payload)
        if (!deckSameList(next.lblFilters, list)) { next.lblFilters = list; filtersChanged = true }
      } else if (name === 'toggleLabel') {
        const nm = (payload === null || payload === undefined) ? '' : String(payload)
        if (nm) {
          const at = next.lblFilters.indexOf(nm)
          if (at >= 0) next.lblFilters = next.lblFilters.filter(function (x: string): boolean { return x !== nm })
          else next.lblFilters = next.lblFilters.concat([nm])
          filtersChanged = true
        }
      } else if (name === 'setEffortFilter') {
        const list = deckStringList(payload)
        if (!deckSameList(next.effFilters, list)) { next.effFilters = list; filtersChanged = true }
      } else if (name === 'setSort') {
        const key = (payload && typeof payload.sortKey === 'string' && payload.sortKey) ? payload.sortKey : next.sortKey
        const dir = (payload && (payload.sortDir === 'asc' || payload.sortDir === 'desc')) ? payload.sortDir : next.sortDir
        if (key !== next.sortKey || dir !== next.sortDir) { next.sortKey = key; next.sortDir = dir; filtersChanged = true }
      } else if (name === 'setExpandedLabels') {
        const open = payload === true
        if (next.expLabels !== open) { next.expLabels = open; filtersChanged = true }
      } else if (name === 'resetFilters') {
        if (next.stateFilter !== DECK_DEFAULT_FILTERS.stateFilter || next.lblFilters.length || next.effFilters.length) {
          next.stateFilter = DECK_DEFAULT_FILTERS.stateFilter; next.lblFilters = []; next.effFilters = []; filtersChanged = true
        }
      }
      if (filtersChanged) { filters = next; bump('filters', filters, changed); rebuildRows(changed) }
      const nextReading: any = Object.assign({}, reading)
      let readingChanged = false
      let rowsChanged = false
      if (name === 'openIssue') { if (reading.activeIssue !== payload) { nextReading.activeIssue = payload; readingChanged = true } }
      else if (name === 'openMap') { if (reading.activeMap !== payload) { nextReading.activeMap = payload; readingChanged = true } }
      else if (name === 'closeDetail') { if (reading.activeIssue !== null || reading.activeMap !== null) { nextReading.activeIssue = null; nextReading.activeMap = null; readingChanged = true } }
      else if (name === 'setDraft') { const text = (typeof payload === 'string') ? payload : ''; if (reading.draft !== text) { nextReading.draft = text; readingChanged = true } }
      else if (name === 'setPageRows') { const rows = Array.isArray(payload) ? payload : []; if (reading.pageRows !== rows) { nextReading.pageRows = rows; readingChanged = true; rowsChanged = true } }
      if (readingChanged) { reading = nextReading; bump('reading', reading, changed) }
      if (rowsChanged) rebuildRows(changed)
      return { changed: changed, filters: filters, reading: reading }
    },
    adopt: function (input: any, options?: { silent?: boolean }): { outcome: 'reused' | 'updated', changed: DeckViewSliceName[] } {
      muted = !!(options && options.silent)
      const changed: DeckViewSliceName[] = []
      const inFrame: DeckFrame | undefined = input && input.frame
      // 同一版本就是同一份数据：调用方就算递来另一个帧对象，也接着用手上这一帧（不重算、不通知）。
      const sameVersion = !!(inFrame && frame.version !== null && inFrame.version === frame.version)
      if (inFrame && inFrame !== frame && !sameVersion) { frame = inFrame; rebuildFrameSlices(changed) }
      if (input && input.filters !== undefined) {
        const next = deckFiltersOf(input.filters)
        const same = next.stateFilter === filters.stateFilter && next.sortKey === filters.sortKey && next.sortDir === filters.sortDir
          && next.expLabels === filters.expLabels && deckSameList(next.lblFilters, filters.lblFilters) && deckSameList(next.effFilters, filters.effFilters)
        if (!same) { filters = next; bump('filters', filters, changed); rebuildRows(changed) }
      }
      if (input && input.reading !== undefined) {
        const next = deckReadingOf(input.reading)
        const prevPageRows = reading.pageRows
        const same = next.activeIssue === reading.activeIssue && next.activeMap === reading.activeMap && next.draft === reading.draft && deckSamePageRows(next.pageRows, prevPageRows)
        if (!same) { reading = next; bump('reading', reading, changed); if (!deckSamePageRows(next.pageRows, prevPageRows)) rebuildRows(changed) }
      }
      muted = false
      // 同一版本、同一份筛选与阅读态：一个切片都没动，结论是复用。
      return { outcome: changed.length ? 'updated' : 'reused', changed: changed }
    },
    frame: function (): DeckFrame { return frame },
    filters: function (): DeckFiltersState { return filters },
    reading: function (): DeckReadingState { return reading },
  }
}