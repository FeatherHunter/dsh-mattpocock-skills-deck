/**
 * src/client/mapDetailV2/ticketCardFacts.ts —— 一条子票行 → 一张 ISSUE 卡片要画的东西。
 *
 * 为什么要有这一份：卡片组件（views/cards/PixelIssueCard.ts）只认 props，不认识票的数据形状。
 * 从「宿主给的行」到「卡片要的 props」之间有几处判断——四种状态、九种动作收成八种样张、
 * 类型小签取哪张标签、阻塞关系指向哪张卡、卡片元素 id 怎么起名。这些判断只能有一处：
 * 页面与门禁都调这里，页面不再自己判一遍。判错了改一处，全页跟着变。
 *
 * 这一份是纯函数：不读 React、不碰 DOM、不连后端。动作从 actionOf 进（真页传 rowActionKind，
 * 那是生产侧唯一判定），词条从 textOf 进（真页传 tr）。于是门禁可以传桩，断言「哪个状态用哪个
 * 词条键」「哪种动作画成哪种样张」，而不是断言某段中文。
 *
 * 复杂度：建索引一趟 O(票数 × 每张票的阻塞者数)；之后每张票 O(1)~O(标签数) 查表。
 */
import type {
  CardActionKey,
  CardTicketRef,
  MapTicketRow,
  SourceActionKind,
  TicketCardFacts,
  TicketCardStatus,
  TicketFactsContext,
  TicketFactsEnv,
} from './mapDetailTypes'

/**
 * 生产侧九种行级动作 → 卡片八种样张键。
 *
 * 为什么要一张表：生产侧按「下一步该做什么」分类（kernel/row-actions.ts 的 rowActionKind），
 * 卡片样张按「画哪一组按钮」分类（views/cards/PixelCardTheme.ts 的 CARD_ACTION_STYLE），
 * 两边不是一一对应——接手/讨论/原型在卡片上叫 claim/grill/proto，只是叫法不同。
 *
 * implement（实施）没有样张：它只出现在规格（实施地图）的子票上，而 V2 这一版只做探索地图。
 * 真遇到就按「执行」画——卡片组件对未知动作本来就有 execute 兜底，这里写明映射是为了
 * 接入规格地图那天一眼看到「这一档还没画」，而不是让它在兜底里悄悄混过去。
 */
export const CARD_ACTION_BY_SOURCE: Record<SourceActionKind, CardActionKey> = {
  diagnose: 'diagnose',
  takeover: 'claim',
  supplement: 'supplement',
  fix: 'fix',
  discuss: 'grill',
  research: 'research',
  prototype: 'proto',
  execute: 'execute',
  implement: 'execute',
}

/**
 * 四种状态 → 卡片页脚右侧的词条键。
 *
 * 只放键不放中文：词条真源在 config/copy/cards.yaml（zh 与 en 各一段），中文写死在代码里
 * 就是第二份词表。门禁拿这个表断言「哪个状态用哪个词条」，改词不影响门禁。
 */
export const CARD_STATUS_COPY_KEY: Record<TicketCardStatus, string> = {
  ready: 'card.pickReady',
  doing: 'card.doing',
  blocked: 'card.blockedCount',
  closed: 'card.closedState',
}

/** 地图子票上可能出现的 wayfinder 类型名，按老页 wayfinderTypeOf 的同一组收。 */
const WAYFINDER_TYPES = ['map', 'research', 'prototype', 'grilling', 'task']

/** 宿主给的状态是 'OPEN' / 'CLOSED'；比较时统一按大写，不赌哪一个后端的大小写习惯。 */
const CLOSED_STATE = 'CLOSED'

/** 把可能为 null / undefined 的字段读成字符串（'' 表示没有，不表示「空字符串有含义」）。 */
function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

/** 票号：数字优先，其次拿 key 解析；两头都解析不出时给 null（卡片 id 与排序都靠它）。 */
export function ticketNumberOf(row: MapTicketRow): number | null {
  if (!row) return null
  const direct = row.number
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct
  const parsed = typeof row.key === 'number' ? row.key : parseInt(text(row.key), 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 标签名列表：字符串标签与 {name,color} 对象都认，去重但保留原顺序。
 * 保留顺序是为了「同一张票上先出现的标签先显示」这条直觉不被排序打乱。
 */
export function ticketLabelNamesOf(row: MapTicketRow): string[] {
  const out: string[] = []
  const seen: Record<string, boolean> = {}
  const list = row && Array.isArray(row.labels) ? row.labels : []
  for (const item of list) {
    const name = typeof item === 'string' ? item : text(item && item.name)
    if (!name || seen[name]) continue
    seen[name] = true
    out.push(name)
  }
  return out
}

/** 认领人：先看 claimedBy，没有再取 assignees 的第一个登录名。两边都没有就是没人在办。 */
function claimedPersonOf(row: MapTicketRow): string {
  if (row && row.claimedBy) return text(row.claimedBy)
  const list = row && Array.isArray(row.assignees) ? row.assignees : []
  for (const person of list) {
    if (person && person.login) return text(person.login)
  }
  return ''
}

/** 阻塞者编号列表：数字与字符串都读成去掉两端空白的字符串。 */
function blockerNumbersOf(row: MapTicketRow): string[] {
  const out: string[] = []
  const list = row && Array.isArray(row.blockedBy) ? row.blockedBy : []
  for (const raw of list) {
    const key = text(raw).trim()
    if (key) out.push(key)
  }
  return out
}

/**
 * 一张票的卡片状态。判定次序与宿主 src/tracker/body-parse.ts 的 groupTickets 完全同口径：
 * 已关闭 → closed；仍开着且有人认领 → doing（在办优先，被挡也先算在办）；
 * 仍开着、没人认领、且至少有一个「页面上仍在开着」的阻塞者 → blocked；其余 → ready。
 *
 * 只把页面内的票算作阻塞者：阻塞者不在本图或已关闭时，这张票就是可以动的（与 frontier 同口径）。
 */
export function ticketCardStatusOf(row: MapTicketRow, openByNumber: Record<string, boolean>): TicketCardStatus {
  if (text(row && row.state).toUpperCase() === CLOSED_STATE) return 'closed'
  if (claimedPersonOf(row)) return 'doing'
  for (const blockerNo of blockerNumbersOf(row)) {
    if (openByNumber[blockerNo]) return 'blocked'
  }
  return 'ready'
}

/** 类型名：标签里按出现顺序找 wayfinder:xxx，找不到看行自带的 type，再兜「普通票」。 */
export function ticketTypeOf(row: MapTicketRow): string {
  for (const name of ticketLabelNamesOf(row)) {
    const bare = name.indexOf('wayfinder:') === 0 ? name.slice('wayfinder:'.length) : ''
    if (WAYFINDER_TYPES.indexOf(bare) >= 0) return bare
  }
  const own = text(row && row.type).trim()
  return own || 'issue'
}

/** 生产侧动作名 → 卡片样张键；认不出的动作按「执行」画（与卡片自身的兜底一致）。 */
export function cardActionOf(sourceAction: SourceActionKind | string): CardActionKey {
  const mapped = CARD_ACTION_BY_SOURCE[sourceAction as SourceActionKind]
  return mapped || 'execute'
}

/**
 * 更新日 MM-DD：只在前十位确实长得像日期时才截。
 * 认不出就给空串——页脚宁可空着，也不把一段乱码当日期画出去。
 */
export function updatedTextOf(row: MapTicketRow): string {
  const raw = text(row && row.updatedAt)
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(5, 10) : ''
}

/** 标签自带颜色优先（后端给了就信它），其次查调用方给的色表。 */
function tagColorOf(row: MapTicketRow, labelName: string, colorOf: Record<string, string> | null): string {
  const list = row && Array.isArray(row.labels) ? row.labels : []
  for (const item of list) {
    if (typeof item === 'string') continue
    if (item && text(item.name) === labelName && item.color) return text(item.color)
  }
  const fromTable = colorOf ? colorOf[labelName] : ''
  return fromTable ? text(fromTable) : ''
}

/** 类型小签：普通票没有；其余类型给一枚，文字与颜色分别取词条与标签真实色。 */
function typeTagsOf(row: MapTicketRow, ctx: TicketFactsContext): Array<{ text: string; color?: string }> {
  const type = ticketTypeOf(row)
  if (type === 'issue') return []
  const labelName = 'wayfinder:' + type
  const color = tagColorOf(row, labelName, ctx.colorOf || null)
  const tag: { text: string; color?: string } = { text: ctx.textOf('type.' + type) }
  if (color) tag.color = color
  return [tag]
}

/**
 * 建全图索引：谁还开着、每张票的标题与卡片 id、每张票挡住的第一张是谁。
 *
 * 为什么先建索引：卡片要显示「被 #1332 挡住」和「阻塞的就是这张 #1374」，
 * 每张卡都去扫全表就是 O(票数²)；索引建一次，之后每张卡 O(1) 查。
 * 第三趟只认「确实处于被挡状态」的目标：在办（已认领）的票虽然也列着阻塞者，
 * 但它不会画成被挡卡，挡路卡上的红条就不该指向它。
 */
export function ticketFactsContextOf(rows: MapTicketRow[], env: TicketFactsEnv): TicketFactsContext {
  const openByNumber: Record<string, boolean> = {}
  const titleByNumber: Record<string, string> = {}
  const cardIdByNumber: Record<string, string | null> = {}
  const firstBlockedByBlocker: Record<string, string> = {}

  for (const row of rows) {
    const number = ticketNumberOf(row)
    if (number === null) continue
    const key = String(number)
    openByNumber[key] = text(row.state).toUpperCase() !== CLOSED_STATE
    titleByNumber[key] = text(row.title)
    cardIdByNumber[key] = env.cardIdPrefix ? env.cardIdPrefix + '-' + key : null
  }

  for (const row of rows) {
    const number = ticketNumberOf(row)
    if (number === null) continue
    if (ticketCardStatusOf(row, openByNumber) !== 'blocked') continue
    const blockedKey = String(number)
    for (const blockerNo of blockerNumbersOf(row)) {
      if (!openByNumber[blockerNo]) continue
      const previous = firstBlockedByBlocker[blockerNo]
      if (previous === undefined) {
        firstBlockedByBlocker[blockerNo] = blockedKey
        continue
      }
      // 同一张挡路卡挡住好几张时，红条只指一张：取编号最小的那张，顺序稳定、可复现。
      if (parseInt(blockedKey, 10) < parseInt(previous, 10)) firstBlockedByBlocker[blockerNo] = blockedKey
    }
  }

  return {
    cardIdPrefix: env.cardIdPrefix,
    colorOf: env.colorOf || null,
    actionOf: env.actionOf,
    textOf: env.textOf,
    openByNumber,
    titleByNumber,
    cardIdByNumber,
    firstBlockedByBlocker,
  }
}

/** 主阻塞者：页面上还开着的那几张阻塞者里编号最小的一个；按编号取保证每次跑结果一样。 */
function primaryBlockerNumberOf(row: MapTicketRow, ctx: TicketFactsContext): string {
  let best = ''
  for (const blockerNo of blockerNumbersOf(row)) {
    if (!ctx.openByNumber[blockerNo]) continue
    if (!best || parseInt(blockerNo, 10) < parseInt(best, 10)) best = blockerNo
  }
  return best
}

/** 把编号变成卡片上的指向：编号、标题、对方卡片元素 id（用来点亮对方那张）。 */
function refOf(numberKey: string, ctx: TicketFactsContext): CardTicketRef {
  return {
    no: numberKey,
    title: ctx.titleByNumber[numberKey] || '',
    cardId: ctx.cardIdByNumber[numberKey] || null,
  }
}

/**
 * 一行 → 一张卡的刻画。调用方拿到它之后只差三件事：把 status==='closed' 传给卡片的 closed、
 * 把字段摊进 IssueCardProps、接上四个点击回调（执行 / 新会话 / 复制 / 打开）。
 *
 * 三条不变量（门禁逐条钉住）：
 *  ① 已关闭的票不给 blockedBy / blocks / claimedBy / pickCorner —— 结案卡不表现「谁挡着它」；
 *  ② 只有 status==='blocked' 的票才有 blockedBy —— 与「在办优先」一致，认领了就不再画暗层；
 *  ③ cardId 一定带前缀，同屏两张地图（双面板）里同号票不会撞同一个 DOM id。
 */
export function ticketCardFactsOf(row: MapTicketRow, ctx: TicketFactsContext): TicketCardFacts {
  const number = ticketNumberOf(row)
  const numberKey = number === null ? '' : String(number)
  const status = ticketCardStatusOf(row, ctx.openByNumber)
  const closed = status === 'closed'
  const action = cardActionOf(ctx.actionOf(row))

  let blockedBy: CardTicketRef | null = null
  if (status === 'blocked') {
    const blockerNo = primaryBlockerNumberOf(row, ctx)
    if (blockerNo) blockedBy = refOf(blockerNo, ctx)
  }

  let blocks: CardTicketRef | null = null
  if (!closed && numberKey) {
    const blockedNo = ctx.firstBlockedByBlocker[numberKey]
    if (blockedNo) blocks = refOf(blockedNo, ctx)
  }

  const pickCorner: 'ready' | 'doing' | null = closed ? null : status === 'ready' ? 'ready' : status === 'doing' ? 'doing' : null

  return {
    number,
    rowKey: numberKey || text(row.key),
    noText: numberKey ? '#' + numberKey : '',
    title: text(row.title),
    status,
    action,
    tags: typeTagsOf(row, ctx),
    bug: ticketLabelNamesOf(row).indexOf('bug') >= 0,
    claimedBy: closed ? '' : claimedPersonOf(row),
    updatedText: updatedTextOf(row),
    closedAt: text(row.closedAt),
    footText: ctx.textOf(CARD_STATUS_COPY_KEY[status]),
    pickCorner,
    cardId: numberKey ? ctx.cardIdByNumber[numberKey] || null : null,
    blockedBy,
    blocks,
  }
}
