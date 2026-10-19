/**
 * views/shared/workRouteTable.ts — 面板里的「跨会话在办表」（#1082）。
 *
 * 它回答的是：这个工作区里，每个会话各自在处理哪些票。数据只有一份来源 —— 宿主挂在面板快照上的
 * workRouteTable 字段（宿主那一侧在 src/host/refresh/workRouteReadoutForHost.ts 里读工作路线存档，
 * 与工具回执 data.workRoute 同一个读出口）。界面这一侧不读盘、不读会话事件、不自己拼记录，
 * 只把快照里那一个字段画成表。
 *
 * 四种状态，与旧的工作路线展示面同一条纪律 ——「还没有」与「读坏了」必须分开说：
 *   · idle       还没拿到快照，或宿主这次没挂这个字段：整块不画（不冒充「没有人」）。
 *   · empty      宿主说读到了，就是一条都没有：画一句空态文案。
 *   · unreadable 宿主读存档那一步真出错了：画一个小标记，原因放进悬停提示。
 *   · ok         逐条画：票号、标题、会话、动作、动作时间、是否在办。
 *
 * 两条口径不在这里现算：
 *   · 「在办（24 小时内动过）」与「陈旧」是宿主读出口按动作时间算好的 active 布尔值；
 *   · 「本会话」也是宿主按这次请求带来的会话 id 算好的 currentSession。
 * 界面只做时间格式化（把 ISO 时刻显示成本机时分的读法），不改判据。
 *
 * 同一张票被两个会话先后动过时，宿主会给出两条（按会话分页、页内按票去重），这里原样逐条画，
 * 不做合并 —— 合并会让人误以为只有一个会话在动这张票。
 *
 * 契约：模块真源（ESM 导出）；构建时剥掉行首 export，拼回 src/client/index.ts 的 leaf 标记处。
 * 下面 declare 的那几个名字由闭包更早的片段提供，这里只声明形状、不参与转译。
 */
declare const React: any;
declare const DswsCtx: any;
declare const Tip: any;
declare const tr: any;
declare function h(...args: any[]): any;

/** 快照里这个字段的名字；宿主读数模块用的是同一个名字。 */
export const WORK_ROUTE_TABLE_FIELD = 'workRouteTable'

/** 工作条目动作类别 → 词条键。键集合与写工具那五类一一对应，不认识的代号照原样显示。 */
export const WORK_ROUTE_ACTION_KEYS: Record<string, string> = {
  report: 'chainView.action.report',
  create: 'chainView.action.create',
  edit: 'chainView.action.edit',
  plan: 'chainView.action.plan',
  link: 'chainView.action.link',
}

/** 一个动作类别代号挑哪个词条；认不出就回空串（调用方照原样显示代号，不编词）。 */
export const workRouteActionKeyOf = function (action: any): string {
  const code = action === null || action === undefined ? '' : String(action)
  return Object.prototype.hasOwnProperty.call(WORK_ROUTE_ACTION_KEYS, code) ? WORK_ROUTE_ACTION_KEYS[code] : ''
}

const workRouteAtOf = function (v: any): number {
  if (typeof v !== 'string' || v === '') return 0
  const t = Date.parse(v)
  return isFinite(t) ? t : 0
}

/**
 * 把宿主给的 ISO 时刻显示成本机时间：同一天只写时分（16:50），跨天再带上月日（10-18 16:50）。
 * 解析不了就回空串，让调用方退回去显示原串；不在这里编一个时间。
 */
export const workRouteTableClock = function (iso: any, nowMs: any): string {
  const at = workRouteAtOf(iso)
  if (!at) return ''
  const d = new Date(at)
  const pad = function (n: any): string { return (n < 10 ? '0' : '') + n }
  const clock = pad(d.getHours()) + ':' + pad(d.getMinutes())
  const now = (typeof nowMs === 'number' && isFinite(nowMs)) ? new Date(nowMs) : new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? clock : (pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + clock)
}

/** 一条能画出来的工作条目；形状不对的格子整格丢掉，宁可少显示也不显示错的。 */
export interface WorkRouteTableRow {
  ticketKey: string
  title: string
  sessionLabel: string
  action: string
  actionAt: string
  active: boolean
  currentSession: boolean
  progress?: number
}

export interface WorkRouteTableView {
  state: 'idle' | 'empty' | 'unreadable' | 'ok'
  reason: string
  at: string
  staleCount: number
  rows: WorkRouteTableRow[]
}

const idleView = function (): WorkRouteTableView {
  return { state: 'idle', reason: '', at: '', staleCount: 0, rows: [] }
}

const unreadableView = function (reason: string): WorkRouteTableView {
  return { state: 'unreadable', reason: reason, at: '', staleCount: 0, rows: [] }
}

/**
 * 取数路径：只读 st.snapshot 里那一个字段，把形状逐格收好。宿主没挂字段时回 idle；
 * 宿主说读坏了（ok:false）时把宿主给的原因代号透出来；宿主说读到了但条目为空就是 empty。
 */
export const workRouteTableOf = function (st: any): WorkRouteTableView {
  if (!st || !st.snapshot || typeof st.snapshot !== 'object') return idleView()
  const raw = st.snapshot[WORK_ROUTE_TABLE_FIELD]
  if (raw === undefined || raw === null) return idleView()
  if (typeof raw !== 'object') return unreadableView('host.work-route.shape')
  if (raw.ok !== true) return unreadableView(String(raw.reason || 'host.work-route.read-failed'))
  const readout = raw.readout
  if (!readout || typeof readout !== 'object' || !Array.isArray(readout.entries)) return unreadableView('host.work-route.shape')
  const rows: WorkRouteTableRow[] = []
  const list = readout.entries as any[]
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if (!e || typeof e !== 'object') continue
    const ticketKey = typeof e.ticketKey === 'string' ? e.ticketKey.trim() : ''
    if (ticketKey === '') continue
    const row: WorkRouteTableRow = {
      ticketKey: ticketKey,
      title: typeof e.title === 'string' ? e.title : '',
      sessionLabel: typeof e.sessionLabel === 'string' ? e.sessionLabel : '',
      action: typeof e.action === 'string' ? e.action : '',
      actionAt: typeof e.actionAt === 'string' ? e.actionAt : '',
      active: e.active === true,
      currentSession: e.currentSession === true,
    }
    if (typeof e.progress === 'number' && isFinite(e.progress)) row.progress = e.progress
    rows.push(row)
  }
  const staleCount = typeof readout.staleCount === 'number' ? readout.staleCount : rows.filter(function (r) { return !r.active }).length
  return {
    state: rows.length > 0 ? 'ok' : 'empty',
    reason: '',
    at: typeof readout.at === 'string' ? readout.at : '',
    staleCount: staleCount,
    rows: rows,
  }
}

const CELLS = 'minmax(52px, 0.7fr) minmax(0, 2.2fr) minmax(70px, 1fr) minmax(56px, 0.9fr) minmax(70px, 1fr) minmax(44px, 0.6fr)'

const workRouteCellStyle = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as any

const workRouteHeadRow = function (h: any, tr: any) {
  const cells = ['ticket', 'title', 'session', 'action', 'time', 'state']
  return h('div', { 'data-work-route-head': 1, style: { display: 'grid', gridTemplateColumns: CELLS, gap: 8, padding: '0 0 4px', fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', borderBottom: '1px solid var(--dsw-alias-border-l1,#2a2d35)' } }, cells.map(function (c) {
    return h('span', { key: c }, tr('workRouteTable.col.' + c))
  }))
}

/** 面板里这张表：标题行 + 表头 + 逐条行；空态与读不到也画在这一块里。 */
export const WorkRouteTable = ({ st }: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const view = workRouteTableOf(st)
  if (view.state === 'idle') return null
  const nowMs = Date.now()
  const titleChildren: any[] = [h('span', { key: 't', style: { fontWeight: 700 } }, tr('workRouteTable.title'))]
  if (view.at) {
    const clock = workRouteTableClock(view.at, nowMs)
    titleChildren.push(h('span', { key: 'at', style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', fontVariantNumeric: 'tabular-nums' } }, tr('workRouteTable.updatedAt', { time: clock || view.at })))
  }
  titleChildren.push(h('span', { key: 'gap', style: { flex: 1 } }))
  if (view.state === 'ok' && view.staleCount > 0) {
    titleChildren.push(h('span', { key: 'stale', 'data-work-route-stale-count': view.staleCount, style: { fontSize: 10, color: '#f59e0b' } }, tr('workRouteTable.staleSummary', { n: view.staleCount })))
  }
  const titleRow = h('div', { key: 'title', style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 } }, titleChildren)
  const boxStyle = { border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, padding: '6px 8px', marginBottom: 8, background: 'rgba(255,255,255,.015)', fontSize: 11 } as any
  if (view.state === 'unreadable') {
    return h('section', { 'data-work-route-table': 'unreadable', style: boxStyle }, [
      titleRow,
      h(Tip, { content: tr('workRouteTable.unreadableTip', { reason: view.reason }) }, h('span', { 'data-work-route-unreadable': 1, style: { color: '#f59e0b' } }, tr('workRouteTable.unreadable'))),
    ])
  }
  if (view.state === 'empty') {
    return h('section', { 'data-work-route-table': 'empty', style: boxStyle }, [
      titleRow,
      h('div', { 'data-work-route-empty': 1, style: { color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, tr('workRouteTable.empty')),
    ])
  }
  const rows = view.rows.map(function (r: WorkRouteTableRow) {
    const actionWord = workRouteActionKeyOf(r.action)
    const atText = workRouteTableClock(r.actionAt, nowMs) || r.actionAt
    return h('div', { key: r.ticketKey + ':' + r.sessionLabel + ':' + r.actionAt, 'data-work-route-row': 1, 'data-work-route-active': r.active ? 1 : 0, style: { display: 'grid', gridTemplateColumns: CELLS, gap: 8, alignItems: 'center', padding: '3px 0', borderTop: '1px solid rgba(255,255,255,.045)' } }, [
      h('span', { style: Object.assign({ fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-primary,#e6e6eb)' }, workRouteCellStyle) }, '#' + r.ticketKey),
      h('span', { style: Object.assign({ color: r.title ? 'inherit' : 'var(--dsw-alias-label-caption,#8b8b95)' }, workRouteCellStyle) }, r.title ? h(Tip, { content: r.title }, h('span', null, r.title)) : tr('workRouteTable.titleMissing')),
      h('span', { style: Object.assign({ display: 'inline-flex', alignItems: 'center', gap: 4 }, workRouteCellStyle) }, [
        h('span', { key: 's', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.sessionLabel),
        r.currentSession ? h('span', { key: 'me', style: { flex: 'none', fontSize: 9, border: '1px solid rgba(88,166,255,.5)', color: '#58a6ff', borderRadius: 4, padding: '0 3px', lineHeight: 1.5 } }, tr('workRouteTable.thisSession')) : null,
      ]),
      h('span', { style: workRouteCellStyle }, actionWord ? tr(actionWord) : r.action),
      h('span', { style: Object.assign({ fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-caption,#8b8b95)' }, workRouteCellStyle) }, atText),
      h('span', { 'data-work-route-state': r.active ? 'active' : 'stale', style: { color: r.active ? '#4ade80' : 'var(--dsw-alias-label-caption,#8b8b95)' } }, r.active ? tr('workRouteTable.active') : tr('workRouteTable.stale')),
    ])
  })
  return h('section', { 'data-work-route-table': 'ok', style: boxStyle }, [
    titleRow,
    h('div', { style: { overflowX: 'auto' } }, [workRouteHeadRow(h, tr), h('div', { key: 'rows' }, rows)]),
  ])
}
