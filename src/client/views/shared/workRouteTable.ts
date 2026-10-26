/**
 * views/shared/workRouteTable.ts — 面板里的「跨会话在办表」（#1082）。
 *
 * 它回答的是：这个工作区里，每个会话各自在处理哪些票。数据只有一份来源 —— 宿主读工作路线存档
 * （src/refresh/rooms/host/work-route-readout.ts，与工具回执 data.workRoute 同一个读出口）。界面这一侧
 * 不读盘、不读会话事件、不自己拼记录，只把宿主给的那一份画成表。#1440 起面板先用本机只读电话的即时读数
 * （几分钟前那条老链路是等面板快照重建、由宿主挂在快照上），没读到才退回去看快照里挂的那张；
 * 两处共用一个选路函数（见文件末尾的 ownRoutePickOf），不各写一遍。
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
 * #1285 之后这张表不再画在列表页正文最上面（那会把票列表往下推）：改由面板头部那一行右端的一颗
 * 小图标点开一个浮层显示 —— 入口组件见本文件末尾的 WorkRouteTrigger。表本身的口径与画法没动。
 *
 * #1287 之后两处版面改动（口径没动，动的都是「怎么显示」）：
 *   · 列宽按格子里的内容定，不再按「表头那几个字有多长」定 —— 「动作时间」和「是否在办」两列
 *     原先各留着一大片空白，挤得票标题和会话名都显示不全；现在那两列收窄，省下的宽度给标题与会话。
 *     表头也跟着改短（中文「时间 / 状态」，英文「When / State」），否则表头自己就撑满那一列。
 *   · 整行挂一条悬停提示：这一行里被省略号截掉的票标题、会话名、动作词与动作时刻，在提示里补全。
 *     提示挂在整行上（不是挂在标题那一格上），悬停这一行的任何位置都能看到。
 *
 * #1288 之后提示改成一行两段：提示落在指针上方（不遮住鼠标指着的那一格），
 * 左边是完整的票标题、右边是完整的会话名，中间一条竖线分开，两边各带一枚图标说明那是什么。
 *
 * 契约：模块真源（ESM 导出）；构建时剥掉行首 export，拼回 src/client/index.ts 的 leaf 标记处。
 * 下面 declare 的那几个名字由闭包更早的片段提供，这里只声明形状、不参与转译。
 */
declare const React: any;
declare const DswsCtx: any;
declare const Tip: any;
declare const tr: any;
declare const Ic: any;
declare const portalTop: any;
declare const DSW_VERSION: any;
declare function h(...args: any[]): any;
// #1436：只读电话那条链（同闭包更早的片段提供）—— 用户点「重试」时重读本机记录。
// #1436：首帧只读那条链（同闭包更早的片段提供）—— 取当前会话那一格。
declare function ownWorkRouteSlotOf(...args: any[]): any;
// #1511：首列票号写成「#目录/编号」的显示规则住在 kernel/ticket-label.ts，本文件只调用。
declare function ticketLabelOf(...args: any[]): any;
// B 方案：同一颗控件的两段子节点走那一份（目录前缀可省略、编号尾巴绝不缩小）。
declare function ticketLabelNodesOf(...args: any[]): any;
// B 方案：首列票号控件的上限宽度同样读那一份（180px），与列表行、详情页、胶囊是同一颗控件。
declare const TICKET_LABEL_MAX_WIDTH: string;
// #1545：行点击要调的三个函数（findMapByIdentity 按票号找容器、containerKindOf 认它是地图还是规格、
//   pushNav 跳到目标页）由打包时拼进同一闭包的更早片段提供，这里只声明名字与参数形状，不参与转译。
declare function findMapByIdentity(...args: any[]): any;
declare function containerKindOf(...args: any[]): any;
declare function pushNav(...args: any[]): any;

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

/**
 * 格子里写的那一截动作时刻：今天只写时分（16:50），跨天只写月日（10-18）。
 *
 * 为什么缩写：那一列只有 36 像素宽，完整时刻（10-18 16:50）根本写不下 —— 写不下就只剩省略号，
 * 而一列一列的省略号等于没给出信息。缩写之后每格都写得下，那一列也就窄了。
 * 完整时刻没有丢：悬停那一行时提示里补出来（见 WorkRouteRow）。
 */
export const workRouteTableStamp = function (iso: any, nowMs: any): string {
  const full = workRouteTableClock(iso, nowMs)
  if (!full) return ''
  const at = full.indexOf(' ')
  return at < 0 ? full : full.slice(0, at)
}

/**
 * 这一格里的字是不是被省略号截掉了：内容宽（scrollWidth）比可见宽（clientWidth）大，就是被截了。
 *
 * 量不到的时候（元素还没挂上页面、或环境里根本没有布局）按「没被截」算 ——
 * 宁可晚一点才显示提示，也不先弹一句其实没必要的话。
 */
const workRouteIsCut = function (el: any): boolean {
  if (!el) return false
  const sw = el.scrollWidth
  const cw = el.clientWidth
  if (typeof sw !== 'number' || typeof cw !== 'number') return false
  return sw > cw + 1
}

/** 一条能画出来的工作条目；形状不对的格子整格丢掉，宁可少显示也不显示错的。 */
export interface WorkRouteTableRow {
  ticketKey: string
  /** #1511：这一条属于哪个工作目录（本地 Markdown 后端才有；单工作单元后端省略）。首列票号靠它带上目录。 */
  effortId?: string
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
 * #1436 · 把宿主回包里那一个字段（raw）解成能画的视图。快照里挂的那张表与只读电话 wf.workRoute 的读数
 *   是同一个形状，所以两处共用这一份解析 —— 别在胶囊里再写一遍，两处迟早长岔。
 */
export const workRouteTableViewOf = function (raw: any): WorkRouteTableView {
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
    // #1511：目录缺席、空串都按「单工作单元」处理（此时首列只写 #编号），与身份算法同一条口径。
    if (typeof e.effortId === 'string' && e.effortId !== '') row.effortId = e.effortId
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

/**
 * 取数路径：只读 st.snapshot 里那一个字段，交给 workRouteTableViewOf 解析。宿主没挂字段时回 idle；
 * 宿主说读坏了（ok:false）时把宿主给的原因代号透出来；宿主说读到了但条目为空就是 empty。
 */
export const workRouteTableOf = function (st: any): WorkRouteTableView {
  if (!st || !st.snapshot || typeof st.snapshot !== 'object') return idleView()
  return workRouteTableViewOf(st.snapshot[WORK_ROUTE_TABLE_FIELD])
}

/**
 * #1545 · 在办表行点击去哪：按票号加工作单元在快照容器表里找容器，找得到且认得出种类
 *   就进容器详情，否则回落普通票详情（与子票/阻塞票分流 enterSubDetail 同一条口径：
 *   有字可看，不静默没反应）。导航函数不在（打包单文件求值时外层没拼进来）或票号取不到
 *   时回空，调用方不挂点击，不跳错地方。
 */
export const workRouteNavOf = function (st: any, r: WorkRouteTableRow): any {
  if (!r || typeof r.ticketKey !== 'string' || r.ticketKey.trim() === '' || typeof pushNav !== 'function') return null
  const effort = typeof r.effortId === 'string' ? r.effortId : ''
  let kind = ''
  try {
    const maps = st && st.snapshot && st.snapshot.maps
    if (typeof findMapByIdentity === 'function' && typeof containerKindOf === 'function' && Array.isArray(maps)) {
      const c = findMapByIdentity(maps, r.ticketKey, effort)
      if (c) kind = containerKindOf(c) || ''
    }
  } catch (e) { /* 容器表损坏时按未知容器处理：回落票详情，不断渲染。 */ }
  return { kind: kind === 'map' || kind === 'spec' ? 'map' : 'issue', n: r.ticketKey, effortId: effort }
}

/**
 * 六列的列宽模板：票号、动作、动作时间、是否在办这四列按格子里的内容定固定宽度；
 * 标题与会话两列各有保底与上限（#1553）：内容长就撑宽、到上限止步，面板拉宽时也不会无限长。
 * 上限之外多出来的宽度留在行尾，不再从别的列里抢 —— 六列比例因此稳定。
 * 反例（#1287 以前的写法）：那四列各留着一大片空白（「动作时间」72 像素里只写着 27 像素的时分，
 * 「是否在办」48 像素里只写着 22 像素的「在办」），票标题和会话名被挤成省略号；
 * 现在这四列收窄（动作时间那列还改写缩写，见 workRouteTableStamp），省下的宽度全给了那两列。
 * 表头与数据行是两个 grid，必须用同一份模板（列宽要逐字对齐），所以把它导出来给两边共用。
 */
/* 首列按本表实际行自适应（#1553）：短编号 56px，长编号按内容分档放宽（目录不缩写），超长封顶 192px。
 * 分几档、怎么估宽，收在 ticket-label.ts 那一份里（估宽直接调真写法，形状想跑偏都跑偏不了）；
 * 这里只管用：WorkRouteTable 用算出来的那一份同时画表头与每一行（对齐不变），行内容未知时用默认。 */
declare function workRouteCellsFor(rows: any): string
/** 行内容未知时的默认模板（全短编号那一档）；表头与数据行都要显式传算好的那一份。 */
export const WORK_ROUTE_TABLE_CELLS = '56px minmax(150px, 320px) minmax(104px, 200px) 48px 36px 36px'

const workRouteCellStyle = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as any

const workRouteHeadRow = function (h: any, tr: any, cells?: any) {
  const names = ['ticket', 'title', 'session', 'action', 'time', 'state']
  return h('div', { 'data-work-route-head': 1, style: { display: 'grid', gridTemplateColumns: typeof cells === 'string' && cells !== '' ? cells : WORK_ROUTE_TABLE_CELLS, gap: 6, padding: '0 0 4px', fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', borderBottom: '1px solid var(--dsw-alias-border-l1,#2a2d35)' } }, names.map(function (c) {
    return h('span', { key: c, style: { whiteSpace: 'nowrap' } }, tr('workRouteTable.col.' + c))
  }))
}

/**
 * 提示里的那一组：图标 + 文字。
 *
 * 图标说明这一段是什么（一张卡片是票标题，一个气泡是会话名），文字给完整原文。
 */
const workRouteTipGroup = function (h: any, icon: string, text: string, key: string) {
  return h('span', { key: key, style: { display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 } }, [
    h('span', { style: { display: 'inline-flex', flex: 'none', color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, Ic({ n: icon, size: 12 })),
    h('span', { style: { minWidth: 0, wordBreak: 'break-word' } }, text),
  ])
}

/**
 * 在办表里的一行：六格，外加一条悬停提示。
 *
 * 提示挂在整行上（不是挂在标题那一格上）：悬停这一行的任何位置都能看到。
 * 提示一行两段（#1288）：左边是完整的票标题，右边是完整的会话名，中间一条竖线分开，两边各带一枚图标；
 * 提示落在指针上方（placement: 'above'），不遮住鼠标正指着的那一格。
 *
 * 表格里的格子窄，显示不下就用省略号；提示里给的是完整原文，不受列宽限制。
 * 动作词与完整动作时刻在格子里被截掉时，以暗色小字补在提示末尾，信息不丢。
 *
 * 提示内容是一个函数，悬停那一刻才求值（HoverTip 对函数型 content 就是这么处理的）：
 * 那一刻这一行已经在页面里，于是拿那一格的实际内容宽与可见宽比一比，
 * 才知道动作词有没有被省略号截掉（workRouteIsCut）。
 * 反例（#1287 以前的写法）：提示只挂在标题那一格、只写标题 —— 会话名被截掉时没人说得清是谁在办这张票。
 */
export const WorkRouteRow = ({ r, nowMs, st, onNavigate, cells }: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const actionRef = React.useRef(null)
  const numberRef = React.useRef(null)
  const actionWord = workRouteActionKeyOf(r.action)
  const actionText = actionWord ? tr(actionWord) : r.action
  const fullAt = workRouteTableClock(r.actionAt, nowMs) || r.actionAt
  const shortAt = workRouteTableStamp(r.actionAt, nowMs) || r.actionAt
  const fullLabel = ticketLabelOf(r.ticketKey, r.effortId)
  const tipContent = function () {
    const extras: string[] = []
    if (fullLabel && workRouteIsCut(numberRef.current)) extras.push(fullLabel)
    if (actionText && workRouteIsCut(actionRef.current)) extras.push(actionText)
    if (shortAt !== fullAt) extras.push(fullAt)
    return h('div', { 'data-work-route-tip': 1, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, maxWidth: 496 } }, [
      workRouteTipGroup(h, 'ticket-title', r.title || tr('workRouteTable.titleMissing'), 'title'),
      h('span', { key: 'sep', style: { width: 1, flex: 'none', alignSelf: 'stretch', minHeight: 14, background: 'rgba(255,255,255,.22)' } }),
      h('span', { key: 'right', style: { display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 } }, [
        workRouteTipGroup(h, 'session', r.sessionLabel, 'session'),
        extras.length ? h('span', { key: 'extra', style: { flex: 'none', color: 'var(--dsw-alias-label-caption,#8b8b95)', whiteSpace: 'nowrap' } }, extras.join(' · ')) : null,
      ]),
    ])
  }
  // #1545：行可点才挂点击——导航目标由 workRouteNavOf 定（容器进容器页、其余进票详情）；
  //   点后调 onNavigate（浮层靠它收起）。导航能力不在时保持今天的纯展示行。
  const nav = workRouteNavOf(st, r)
  const openRow = function () {
    if (!nav) return
    try { pushNav(st, nav.kind, nav.n, nav.effortId) } catch (e) { /* 跳转失败就停在当前页，不把人带错地方。 */ }
    if (typeof onNavigate === 'function') { try { onNavigate() } catch (e2) { /* 收浮层失败不影响已发生的跳转。 */ } }
  }
  const rowProps: any = {
    'data-work-route-row': 1,
    'data-work-route-active': r.active ? 1 : 0,
    style: { display: 'grid', gridTemplateColumns: typeof cells === 'string' && cells !== '' ? cells : WORK_ROUTE_TABLE_CELLS, gap: 6, alignItems: 'center', padding: '3px 0', borderTop: '1px solid rgba(255,255,255,.045)', cursor: nav ? 'pointer' : undefined },
  }
  if (nav) {
    rowProps.tabIndex = 0
    rowProps.role = 'button'
    rowProps['aria-label'] = ticketLabelOf(r.ticketKey, r.effortId) + ' ' + (r.title || '')
    rowProps['data-press'] = 'row'
    rowProps['data-log'] = 'workroute.row.' + r.ticketKey
    rowProps.onClick = openRow
    rowProps.onKeyDown = function (e: any) {
      if (!e || e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') { if (typeof e.preventDefault === 'function') e.preventDefault(); openRow() }
    }
  }
  const row = h('div', rowProps, [
    // B 方案：首列同样是上限宽度 + 目录前缀可省略、编号尾巴绝不缩小；完整写法仍走悬停补（见 tipContent）。
    h('span', { ref: numberRef, style: Object.assign({ fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-primary,#e6e6eb)', display: 'inline-flex', alignItems: 'center', maxWidth: TICKET_LABEL_MAX_WIDTH }, workRouteCellStyle) }, ticketLabelNodesOf(h, r.ticketKey, r.effortId)),
    h('span', { style: Object.assign({ color: r.title ? 'inherit' : 'var(--dsw-alias-label-caption,#8b8b95)' }, workRouteCellStyle) }, r.title || tr('workRouteTable.titleMissing')),
    h('span', { style: Object.assign({ display: 'inline-flex', alignItems: 'center', gap: 4 }, workRouteCellStyle) }, [
      h('span', { key: 's', style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.sessionLabel),
      r.currentSession ? h('span', { key: 'me', style: { flex: 'none', fontSize: 9, border: '1px solid rgba(88,166,255,.5)', color: '#58a6ff', borderRadius: 4, padding: '0 3px', lineHeight: 1.5 } }, tr('workRouteTable.thisSession')) : null,
    ]),
    h('span', { ref: actionRef, style: workRouteCellStyle }, actionText),
    h('span', { style: Object.assign({ fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-caption,#8b8b95)' }, workRouteCellStyle) }, shortAt),
    h('span', { 'data-work-route-state': r.active ? 'active' : 'stale', style: { color: r.active ? '#4ade80' : 'var(--dsw-alias-label-caption,#8b8b95)' } }, r.active ? tr('workRouteTable.active') : tr('workRouteTable.stale')),
  ])
  return h(Tip, { content: tipContent, placement: 'above', maxWidth: 520, offset: { x: 0, y: 12 } }, row)
}

/** 面板里这张表：标题行 + 表头 + 逐条行；空态与读不到也画在这一块里。点行后调 onNavigate（浮层靠它收起）。 */
export const WorkRouteTable = ({ st, onNavigate }: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  // #1440：与胶囊同一条选路 —— 本机只读读数优先，快照里挂的那张兜底（304 回包可能挂一张坏表）。
  const pick = (typeof ownRoutePickOf === 'function') ? ownRoutePickOf(st) : null
  const view = (pick && pick.view) || workRouteTableOf(st)
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
  // 首列按本表实际行自适应（#1553）：表头与每一行用算出来的同一份模板，对齐要求不变。
  const cells = workRouteCellsFor(view.rows)
  const rows = view.rows.map(function (r: WorkRouteTableRow) {
    return h(WorkRouteRow, { key: r.ticketKey + ':' + r.sessionLabel + ':' + r.actionAt, r: r, nowMs: nowMs, st: st, onNavigate: onNavigate, cells: cells })
  })
  return h('section', { 'data-work-route-table': 'ok', style: boxStyle }, [
    titleRow,
    h('div', { style: { overflowX: 'auto' } }, [workRouteHeadRow(h, tr, cells), h('div', { key: 'rows' }, rows)]),
  ])
}

/** 浮层的最小宽度：标题保底 150px、会话保底 104px，加上首列最宽那一档，至少要 680 才不挤出横向滚动。
 * 弹窗是咱们自己画的，窄了只会把标题和会话压成省略号 —— 宁可一开始就给够。面板更宽时浮层跟面板同宽（下）。 */
const WORK_ROUTE_POPOVER_MIN_WIDTH = 680

/**
 * 面板头部那一行右端的「在办表」入口（#1285）。
 *
 * 形态：不是按钮，就是一颗小图标（无边框、无底色），鼠标悬停给一句说明与插件版本号。
 * 点它弹一个浮层显示那张表；浮层用 portalTop 挂到 body 上 —— 挂 body 是必须的：留在面板里的话，
 * 祖先上的 transform 会让 position:fixed 降级、浮层被裁掉。浮层不占列表页的高度，不把列表往下推。
 * 点浮层以外的地方或按 Esc 收起。
 *
 * 坐标怎么算：按图标那一格的 getBoundingClientRect 拿视口坐标，浮层 position:fixed 贴到图标下缘、右缘对齐。
 * 宽度：至少 WORK_ROUTE_POPOVER_MIN_WIDTH；图标所在那一行更宽时就跟那一行同宽（面板拉宽，表跟着宽）。
 */
export const WorkRouteTrigger = ({ st }: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const [ui, setUi] = React.useState({ open: false, pos: null })
  const iconRef = React.useRef(null)
  const popRef = React.useRef(null)
  const close = function () { setUi({ open: false, pos: null }) }
  const toggle = function (e: any) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
    if (ui.open) { close(); return }
    const el = iconRef.current
    if (!el || typeof el.getBoundingClientRect !== 'function') { close(); return }
    const rect = el.getBoundingClientRect()
    const vw = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1024
    const vh = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 768
    const row = (el.parentElement && typeof el.parentElement.getBoundingClientRect === 'function') ? el.parentElement.getBoundingClientRect() : null
    const width = Math.max(WORK_ROUTE_POPOVER_MIN_WIDTH, row ? Math.round(row.width) : 0)
    const right = Math.max(12, Math.round(vw - rect.right))
    const top = Math.round(rect.bottom + 6)
    setUi({ open: true, pos: { right: right, top: top, width: Math.min(width, vw - 24), maxHeight: Math.max(160, vh - top - 12) } })
  }
  // 点别处 / 按 Esc 收起：监听挂在 document 上；点在图标或浮层内部不算「别处」。
  React.useEffect(function () {
    if (!ui.open) return undefined
    const onDown = function (e: any) {
      const t = e && e.target
      if (t && iconRef.current && typeof iconRef.current.contains === 'function' && iconRef.current.contains(t)) return
      if (t && popRef.current && typeof popRef.current.contains === 'function' && popRef.current.contains(t)) return
      close()
    }
    const onKey = function (e: any) { if (e && e.key === 'Escape') close() }
    if (typeof document !== 'undefined') {
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
    }
    return function () {
      if (typeof document !== 'undefined') {
        document.removeEventListener('mousedown', onDown)
        document.removeEventListener('keydown', onKey)
      }
    }
  }, [ui.open])
  const icon = h('span', {
    ref: iconRef,
    'data-work-route-trigger': 1,
    className: 'dsws-hov',
    'data-press': 'icon',
    'data-log': 'head.workroute',
    role: 'button',
    tabIndex: 0,
    'aria-label': tr('workRouteTable.iconLabel'),
    'aria-expanded': ui.open ? 'true' : 'false',
    onClick: toggle,
    onKeyDown: function (e: any) { if (e && (e.key === 'Enter' || e.key === ' ')) { if (typeof e.preventDefault === 'function') e.preventDefault(); toggle(e) } },
    style: { display: 'inline-flex', alignItems: 'center', cursor: 'pointer', flex: 'none' },
  }, [Ic({ n: 'workroute', size: 13 })])
  // 宿主这次没挂 workRouteTable 字段时（idle），浮层里不画空盒子，写一句「还没拿到」——
  // 与表本身同一条纪律：不拿「没数据」冒充「没人干活」。
  // #1440：浮层里也走与胶囊同一条选路；一次都没读到时分开说「正在读」与「还没有」：
  //   两者都不画表，但前者是等一下就好、后者要有人补链路，混成一句会让人以为没救了。
  const popPick = (typeof ownRoutePickOf === 'function') ? ownRoutePickOf(st) : null
  const view = (popPick && popPick.view) || workRouteTableOf(st)
  const reading = !!(popPick && popPick.fallback && popPick.fallback.state === 'loading')
  const body = view.state === 'idle'
    ? (reading
        ? h('div', { 'data-work-route-loading': 1, style: { color: 'var(--dsw-alias-label-caption,#8b8b95)', fontSize: 11, padding: '4px 2px' } }, tr('chainView.ownRouteLoading'))
        : h('div', { 'data-work-route-idle': 1, style: { color: 'var(--dsw-alias-label-caption,#8b8b95)', fontSize: 11, padding: '4px 2px' } }, tr('workRouteTable.idle')))
    : h(WorkRouteTable, { st: st, onNavigate: close })
  const pop = (ui.open && ui.pos) ? portalTop(h('div', {
    ref: popRef,
    'data-work-route-popover': 1,
    style: {
      position: 'fixed',
      right: ui.pos.right,
      top: ui.pos.top,
      width: ui.pos.width,
      maxWidth: 'calc(100vw - 24px)',
      maxHeight: ui.pos.maxHeight,
      overflowY: 'auto',
      zIndex: 2147483000,
      background: 'var(--dsw-alias-bg-layer-2,#16181d)',
      border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)',
      borderRadius: 10,
      padding: '6px 8px',
      boxShadow: '0 10px 30px rgba(0,0,0,.45)',
    },
  }, [body])) : null
  return h(Tip, { content: tr('workRouteTable.iconTip', { version: DSW_VERSION }), targetRef: iconRef }, h('span', { className: 'dsws-workroute', 'aria-label': tr('workRouteTable.iconLabel'), style: { display: 'inline-flex', alignItems: 'center', flex: 'none', overflow: 'visible' } }, [icon, pop]))
}


/** #1436 · 只读电话那一格还在读（loading）时返回胶囊要画的「读取中」；其余情形回 null（不画失败）。 */
export const capsuleOwnRouteFallbackOf = function (slot: any): any {
  const state = (slot && typeof slot === 'object') ? String(slot.state || '') : ''
  if (state === 'loading') return { state: 'loading', reason: '', entry: null, list: [] }
  return null
}

/**
 * #1436 · 界面先读哪一份：首帧那条只读电话的读数（本机 work-path 存档，几十毫秒）优先，读到就先用它；
 *   还没到、读坏了、或宿主版本太旧没有这条电话（off），才退回去看快照里挂的那张（老链路）。
 *   读的过程中如果上一格已经读到过表，就继续显示那一份（旧数据先顶着，不让界面回退成空白）。
 *   返回 { view, fallback }：view 是能照旧画的那份表；fallback 只在「一次都还没读到」时为读取中那一档。
 *   放在这里而不是胶囊文件里：胶囊贴着 350 行上限，而且这件事与这张表的读数形状本就是一件事。
 *
 * #1440：这条选路不只胶囊用 —— 面板头部那颗图标点开的浮层、胶囊展开列表也走它。快照里挂的那张表
 *   在 304 回包里可能读不出工作区根（一张坏表），只读电话不经过快照，面板不该被那份坏表挡住；
 *   「先读哪一份」这件事也只该有一处写法，两处各写一遍迟早长岔。
 */
export const ownRoutePickOf = function (st: any): any {
  const slot = (typeof ownWorkRouteSlotOf === 'function') ? ownWorkRouteSlotOf(st) : null
  const slotView = (slot && typeof workRouteTableViewOf === 'function') ? workRouteTableViewOf(slot.raw) : null
  const usable = (slotView && (slotView.state === 'ok' || slotView.state === 'empty')) ? slotView : null
  const snapView = (typeof workRouteTableOf === 'function') ? workRouteTableOf(st) : null
  return { view: usable || snapView, fallback: usable ? null : capsuleOwnRouteFallbackOf(slot) }
}

/** 旧名保留：胶囊文件按这个名字声明（源码树里跨文件只许 ambient declare），改名要连带改那一处。 */
export const capsuleOwnRoutePick = ownRoutePickOf

/** #1436 · 读取中那一档在胶囊里的样子：一枚转圈（告诉人「正在读」，而不是「没有记录」）。 */
export const capsuleOwnRouteFallbackNode = function (h: any, tr: any, view: any, Ic: any): any {
  return h('span', {
    className: 'dsws-capsule-chain-loading dsws-hov', role: 'status',
    'aria-label': tr('chainView.ownRouteLoading'),
    style: { display: 'inline-flex', alignItems: 'center', flex: 'none' },
  }, [h('span', { className: 'dsws-spin', style: { display: 'inline-flex' } }, Ic({ n: 'refresh', size: 11 }))])
}
