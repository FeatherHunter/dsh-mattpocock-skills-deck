/**
 * src/client/kernel/ticket-label.ts —— 面板上「票的编号」显示成一行字时的唯一写法（#1511）。
 *
 * ── 为什么要有这一份 ─────────────────────────────────────────────────────────
 * 本地 Markdown 后端的一个仓库可以有好几个工作目录（`.scratch/<目录>/issues/`），每个目录里的票
 * 各自从 01 开始编号，所以面板上只写 `#01` 是看不出这张票属于哪个目录的。维护者在 #1480 里定的
 * 显示口径是「徽标显示 #买咖啡积分/01」——编号本身就该带着目录；规格与地图的内部编号是 00，
 * 按同一条规则显示成 `#买咖啡积分/00`。单工作单元后端（GitHub / GitLab）没有目录这一层，
 * 显示保持原样（`#123`）。
 *
 * 显示层的四个地方（列表行、在办表首列、状态栏会话链、详情页头部）原来各写一遍 `'#' + 编号`，
 * 于是目录被丢掉了。这一份是它们共同的写法：要改显示规则，只改这里。
 *
 * ── 两条不能改的约定 ─────────────────────────────────────────────────────────
 * ① 这是**显示**用的，不参与寻址：后端读、写、按编号找文件仍然用不带目录的原始编号（#1511 已定）。
 * ② 编号本身已经带目录时不重复拼：同目录编号重复、或文件名里没有编号时，后端会把身份退化成
 *   `目录/01-文件名`、`目录/文件名` 这种形状（见 issues-locate.ts 的 ticketKey）。这时原样加一个
 *   `#` 就够，再拼一次目录会变成 `#目录/目录/…`。
 */

/** 显示编号时要用的两段：编号本身（后端给的那一串）与它所在的目录名。 */
export interface TicketLabelParts {
  /** 后端的票号；数字编号也认，统一转成串。 */
  readonly key?: unknown
  /** 工作单元（本地 Markdown 后端就是 `.scratch/` 下那个目录名）；单工作单元后端是空串。 */
  readonly effortId?: unknown
}

/**
 * 把「目录 + 编号」拼成面板要显示的那一行字：目录有值就写成 `#目录/编号`，没有目录就写成 `#编号`。
 *
 * 编号取不到（缺席、空串）时返回空串：宁可这一格里什么都不写，也不要写一个认不出是哪张票的号。
 * 编号里已经带了目录（退化身份，形如 `目录/01-文件名`）时只加 `#`，不重复拼目录。
 */
export function ticketLabelOf(key: unknown, effortId: unknown): string {
  const id = key === undefined || key === null ? '' : String(key).trim()
  if (id === '') return ''
  const effort = effortId === undefined || effortId === null ? '' : String(effortId).trim()
  if (effort === '' || id.indexOf('/') >= 0) return '#' + id
  return '#' + effort + '/' + id
}

/** B 方案共用的上限宽度：`#目录/编号` 这一颗控件在任何一处都不许超过它（#1553 的 192px 首列仍装得下）。 */
export const TICKET_LABEL_MAX_WIDTH = '180px'

/** 同一串编号拆成两段：目录前缀（含 `#` 与结尾的 `/`）与绝不缩小的编号尾巴。 */
export interface TicketLabelParts {
  /** `#目录/`；没有目录时就是 `#`（退化身份按第一个 `/` 切，同样是这个形状）。 */
  readonly prefix: string
  /** `/` 后面的编号本身；空编号时为空串。 */
  readonly number: string
  /** 完整写法（与 ticketLabelOf 同一串，悬停与无障碍名直接用它）。 */
  readonly full: string
}

/**
 * 把同一串编号拆成「可省略的目录前缀」与「绝不缩小的编号尾巴」：目录再长也只压前缀这一段，
 * 编号尾巴（`/13`、`01-文件名` 这类认票的那一截）永远完整显示。
 *
 * 拆法与上面那份真写法同一条口径：空编号返回空三件；没有 `/` 时前缀是 `#`；有 `/` 时按第一个 `/` 切
 * （`#目录/01-文件名` 切成 `#目录/` + `01-文件名`，退化身份同样是目录可压、编号保住）。
 */
export function ticketLabelPartsOf(key: unknown, effortId: unknown): TicketLabelParts {
  const full = ticketLabelOf(key, effortId)
  if (full === '') return { prefix: '', number: '', full: '' }
  const slash = full.indexOf('/')
  if (slash < 0) return { prefix: '#', number: full.slice(1), full: full }
  return { prefix: full.slice(0, slash + 1), number: full.slice(slash + 1), full: full }
}

/**
 * 同一颗 `#目录/编号` 控件的两段子节点：目录前缀可省略、编号尾巴绝不缩小。
 *
 * 为什么收在这里：四处显示点（列表行、详情页头、在办表首列、状态栏胶囊）都要同一套「目录末尾变省略号」
 * 的写法，散在各处迟早长岔；这里只拼两段 span，外层的上限宽度与悬停仍由调用方按原样写（Tip 的 content
 * 与无障碍名都用上面的完整写法，不另起一串）。
 */
export const ticketLabelNodesOf = function (h: any, key: unknown, effortId: unknown): any[] {
  const p = ticketLabelPartsOf(key, effortId)
  if (p.full === '') return []
  return [
    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 auto' } }, p.prefix),
    h('span', { style: { flex: 'none' } }, p.number),
  ]
}

/** 在办表里一行要带的行形状（估宽只读这两段，其余不管）。 */
export interface WorkRouteWidthRow {
  /** 后端的票号（容器行是 00 这类）。 */
  readonly ticketKey?: unknown
  /** 工作单元（本地后端是 `.scratch/` 下的目录名）；单工作单元后端是空串。 */
  readonly effortId?: unknown
}

/* 在办表首列按本表实际行自适应（#1553，#1548 定宽 128px 的后继）：
 * #1548 修完首列是定死的 128px —— 全是「#1548」这类短编号时白白占掉 70 多像素，标题和会话反而被挤。
 * 现在按本表所有行里最长的编号估宽分档：短编号收窄，长编号才放宽，目录名永远不缩写。
 * 估宽直接调上面那份真写法（同一份形状，想 drift 都 drift 不了）：11px 字号下 ASCII 按 7px、
 * 中文等非 ASCII 按 11px，另加 12px 格子内边距；分档 snap 到 56 / 96 / 136 / 192 四档封顶 ——
 * 超过 192px 的超长目录仍走省略号，完整编号在悬停提示里补（见 workRouteTable.ts 的 tipContent）。
 * （#1548 注释里“最长 17 个字符”写错了：仓里 .scratch 目录名最长 32 个字符，定宽 128px 本来也放不下。） */
/** 这一行编号按真写法拼出来之后占多宽（像素，估算）。凡例：('#101','') → 40；('00','demo') → 68。 */
export function workRouteLabelWidthOf(key: unknown, effortId: unknown): number {
  const label = ticketLabelOf(key, effortId)
  let w = 12
  for (let i = 0; i < label.length; i++) w += label.charCodeAt(i) <= 127 ? 7 : 11
  return w
}
/** 本表首列取哪一档：所有行里最宽的那个编号决定，全表共用（表头与数据行仍是同一份模板，对齐不变）。 */
export function workRouteFirstColWidthOf(rows: unknown): string {
  let widest = 0
  try {
    const list = Array.isArray(rows) ? rows : []
    for (const r of list) {
      const row = (r || {}) as WorkRouteWidthRow
      const w = workRouteLabelWidthOf(row.ticketKey, row.effortId)
      if (w > widest) widest = w
    }
  } catch { /* 行形状不对就按最窄处理，不把表撑坏。 */ }
  if (widest <= 56) return '56px'
  if (widest <= 96) return '96px'
  if (widest <= 136) return '136px'
  return '192px'
}
/** 六列模板：首列按行内容自适应（上），动作三列沿用 #1287 的定宽；标题与会话两列吃富余，
 * 保底 150px / 104px（11px 字号下标题至少放下 13 个汉字 —— 10 个字一定完整，会话约 9 个字）。 */
export function workRouteCellsFor(rows: unknown): string {
  return workRouteFirstColWidthOf(rows) + ' minmax(150px, 1.7fr) minmax(104px, 1fr) 48px 36px 36px'
}
