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

/**
 * 票号徽标的最大宽度（像素）：`#目录/编号` 这一颗控件在任何一处都不许超过它。只在这里定义一次，
 * 下面两处都由它推出来 ——
 *   · `TICKET_LABEL_MAX_WIDTH`：五处显示点（列表行、在办表首列、状态栏胶囊、票详情头部、地图详情头部）
 *     直接拿它当 `maxWidth`；
 *   · 在办表首列最宽的那一档：分档封顶就是这条线（#1565 把原来各写各的 192px / 136px 收成一处，
 *     格子不会再比徽标宽、白留一片空白）。
 * 取 136 的原因（#1553）：11px 字下最长的那批目录（`#wayfinder-capability-test/00`）内容约 150px，
 * 上限再宽就碰不到线，长目录看着和没改一样；收到 136px 后目录前缀才会真的变省略号，编号尾巴仍完整显示。
 */
export const TICKET_LABEL_MAX_WIDTH_PX = 136
/** 上面那个数的 CSS 写法（`style.maxWidth` 用）。改宽度只改 `TICKET_LABEL_MAX_WIDTH_PX`，不要另写一个字面量。 */
export const TICKET_LABEL_MAX_WIDTH = TICKET_LABEL_MAX_WIDTH_PX + 'px'

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
 * 为什么收在这里：五处显示点（列表行、详情页头、地图详情头、在办表首列、状态栏胶囊）都要同一套
 * 「目录末尾变省略号」的写法，散在各处迟早长岔；这里只拼两段 span，外层的上限宽度与悬停仍由调用方
 * 按原样写（Tip 的 content 与无障碍名都用上面的完整写法，不另起一串）。
 */
export const ticketLabelNodesOf = function (h: any, key: unknown, effortId: unknown): any[] {
  const p = ticketLabelPartsOf(key, effortId)
  if (p.full === '') return []
  return [
    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 auto' } }, p.prefix),
    h('span', { style: { flex: 'none' } }, p.number),
  ]
}

/**
 * 状态栏胶囊主行里那一串编号的外层节点：目录前缀挂着让位号 12、编号尾巴不挂号。
 *
 * 窄下去时阶梯机只收挂号的那一段，所以目录从末尾逐字收、编号完整保留；拉宽后恢复完整写法。
 * 空编号时回一个空外层，免得调用方再分叉；单段写法（没有编号尾巴）时前缀就是整串，整段挂号，与原来保持一致。
 *
 * 为什么单段与两段要共用同一个挂号 span、把号码只写一遍：让位表按号码数段落的门禁是照文本数的
 * （tests/verify-capsule-narrow.ts 要求 1..12 每个号恰好出现一次），同一份号码写两遍就会被判成
 * 「12 号出现 2 次」。改成一处号码 + 一处样式分叉后，行为与两段结构都不变，门禁也数得准。
 */
export const ticketLabelCapsuleFoldOf = function (h: any, key: unknown, effortId: unknown): any {
  const p = ticketLabelPartsOf(key, effortId)
  if (p.full === '') return h('span', { style: { display: 'inline-flex', alignItems: 'center', minWidth: 0, overflow: 'hidden', maxWidth: TICKET_LABEL_MAX_WIDTH } }, [])
  return h('span', { style: { display: 'inline-flex', alignItems: 'center', minWidth: 0, overflow: 'hidden', maxWidth: TICKET_LABEL_MAX_WIDTH } }, [
    // 挂号那一段就是真正出省略号的文字，所以省略号样式写在这一处；单段写法没有编号尾巴，自己就是整串，
    // 按上限宽度收；两段写法里它只是可压缩的目录前缀，让出位置给编号。
    h('span', { 'data-fold-priority': 12, style: Object.assign({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, p.number === '' ? { maxWidth: TICKET_LABEL_MAX_WIDTH } : { minWidth: 0, flex: '1 1 auto' }) }, p.prefix),
    p.number === '' ? null : h('span', { style: { flex: 'none', whiteSpace: 'nowrap' } }, p.number),
  ])
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
 * 现在按本表所有行里最长的编号估宽分档：短编号收窄，长编号才放宽，目录名尽量不缩写。
 * 估宽直接调上面那份真写法（同一份形状，想 drift 都 drift 不了）：11px 字号下 ASCII 按 7px、
 * 中文等非 ASCII 按 11px，另加 12px 估宽余量（宁可估宽一点，也别让真字被截）；分档 snap 到 56 / 96 / 136 三档。
 * 最宽那一档**就是徽标上限**（`TICKET_LABEL_MAX_WIDTH_PX`，同一个数推出来，见上）：
 * 超过上限的目录仍走省略号，完整编号在悬停提示里补（见 workRouteTable.ts 的 tipContent）。
 * 反例（#1565 之前）：分档封顶另写着 192px，徽标只到 136px —— 走到最宽一档时格子白留 56px，
 * 那 56px 本该分给标题列。现在两处同源，格子不会再比徽标宽。
 * （#1548 注释里“最长 17 个字符”写错了：仓里 .scratch 目录名最长 32 个字符，定宽 128px 本来也放不下。） */
/** 首列候选宽度（像素），从小到大；最后一档必须等于徽标上限，否则格子与徽标又会一宽一窄（#1565）。 */
export const WORK_ROUTE_FIRST_COL_TIERS_PX: readonly number[] = [56, 96, TICKET_LABEL_MAX_WIDTH_PX]
/** 这一行编号按真写法拼出来之后占多宽（像素，估算）。凡例：('#101','') → 40；('00','demo') → 68。 */
export function workRouteLabelWidthOf(key: unknown, effortId: unknown): number {
  const label = ticketLabelOf(key, effortId)
  let w = 12
  for (let i = 0; i < label.length; i++) w += label.charCodeAt(i) <= 127 ? 7 : 11
  return w
}
/** 本表首列取哪一档：所有行里最宽的那个编号决定，全表共用（表头与数据行仍是同一份模板，对齐不变）。
 * 取「能装下最长编号的最窄一档」；超过最后一档就落在徽标上限，再长的目录交给省略号（编号尾巴仍完整）。 */
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
  for (const tier of WORK_ROUTE_FIRST_COL_TIERS_PX) {
    if (widest <= tier) return tier + 'px'
  }
  // 超过最后一档（编号估宽比徽标上限还长）就落在徽标上限：长目录走的正是这一条，超出部分由徽标自己的省略号收尾。
  return TICKET_LABEL_MAX_WIDTH
}
/** 六列模板：首列按行内容自适应（上），动作三列沿用 #1287 的定宽；
 * 标题与会话两列**每列都给了上限**（#1553 维护者定的口径）：内容长就把这一列撑宽，撑到上限为止，
 * 到顶后不再变宽，多出来的字走省略号，整行悬停提示里给全文。上限是这么算的（11px 字号）：
 *   · 标题保底 150px / 上限 320px —— 10 个汉字一定完整，最多放到约 29 个汉字；
 *   · 会话保底 104px / 上限 200px —— 约 9 个字保底，最多放到约 18 个汉字。
 * 为什么必须封顶：面板拉宽时四个固定列不会跟着长，只有这两列吃富余；不封顶的话标题会一路撑满，
 * 六列比例失衡（#1553 之前 1.7fr 就是这个毛病）。封顶后多出来的空间留在行尾，不再挤占别的列。 */
export function workRouteCellsFor(rows: unknown): string {
  return workRouteFirstColWidthOf(rows) + ' minmax(150px, 320px) minmax(104px, 200px) 48px 36px 36px'
}
