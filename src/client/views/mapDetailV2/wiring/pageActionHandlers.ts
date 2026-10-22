/**
 * views/mapDetailV2/wiring/pageActionHandlers.ts —— 卡片四个按钮点下去以后干什么（页面这侧的接线）。
 *
 * 为什么单独一份：模型只知道「这张票该画哪种动作」，不知道动作要注入哪段提示词、复制哪个链接、
 * 是开浏览器还是开本机文件。这些全都要问宿主（inject / copyText / host.call），所以收在这一份里；
 * 模型与画法层都不碰宿主，换宿主时只改这一处。
 *
 * 为什么回调要先把票还原成「原始行」：主按钮注入的提示词由 rowActionText 按原始行算（它要看标签，
 * 例如带 ready-for-agent 的实施票注入的是 /implement，地图与规格则走容器三态）。卡片交回来的是
 * 「刻画」（facts），所以这里要按「编号 + 行自己的 key」把行找回来——行就是模型画这批卡时用的
 * 同一批行，不会再变。只按编号找会在同编号的脏数据上静默落到先出现的那一张（见 rowIndexOf）。
 *
 * 叶子约定：构建把它拼进客户端闭包（scripts/build.mts 的 LEAF_MODULES），只能 import type，
 * 宿主与内核函数靠同一作用域里的名字（见下面 declare）。
 */
import type { MapTicketRow, TicketCardFacts, TicketCardHandlers } from '../model/contracts/mapDetailTypes'

declare function inject(...args: any[]): any
declare function rowActionText(...args: any[]): any
declare function openInNewSession(...args: any[]): any
declare function copyText(...args: any[]): any
declare function issueUrlFor(...args: any[]): any
declare function effortOf(...args: any[]): any

/** 原始行的两份索引：一份按行自己的 key，一份按编号。 */
interface RowIndex {
  byRowKey: Record<string, MapTicketRow>
  byNumber: Record<string, MapTicketRow>
  /** 编号出现不止一次的记号：这种编号不能拿来认行（认错了会静默开错票）。 */
  duplicateNumbers: Record<string, boolean>
}

/** 行自己的 key；没有就是空串（不拿编号冒充——那是另一份索引的事）。 */
function rowKeyOfRow(row: MapTicketRow): string {
  const raw = (row as any).key
  return raw === undefined || raw === null || String(raw) === '' ? '' : String(raw)
}

/**
 * 建索引。模型层给同编号的脏数据用行 key 后缀区分了两张卡的 DOM id（model/tickets/ticketCardFacts.ts
 * 的 rowCardIdOf），这里必须用同一对「编号 + 行 key」才认回同一行；只按编号会把两张同号票的四个按钮
 * 全打在第一张上，还不报错。同号且行 key 也取不到时认不出，宁可不做（sourceRowOf 返回 null）。
 */
function rowIndexOf(rows: MapTicketRow[]): RowIndex {
  const index: RowIndex = { byRowKey: {}, byNumber: {}, duplicateNumbers: {} }
  for (const row of rows || []) {
    if (!row) continue
    const rowKey = rowKeyOfRow(row)
    if (rowKey && index.byRowKey[rowKey] === undefined) index.byRowKey[rowKey] = row
    const no = (row as any).number
    if (no === undefined || no === null || no === '') continue
    const numberKey = String(no)
    if (index.byNumber[numberKey] === undefined) index.byNumber[numberKey] = row
    else index.duplicateNumbers[numberKey] = true
  }
  return index
}

/** 一张卡的刻画 → 它来自的那一行；找不到或认不准时返回 null（页面按「这一下不做」处理，不猜）。 */
function sourceRowOf(facts: TicketCardFacts, index: RowIndex): MapTicketRow | null {
  if (!facts) return null
  const rowKey = facts.rowKey != null ? String(facts.rowKey) : ''
  if (rowKey) {
    const byKey = index.byRowKey[rowKey]
    if (byKey) return byKey
  }
  if (facts.number != null) {
    const numberKey = String(facts.number)
    if (index.duplicateNumbers[numberKey]) return null
    return index.byNumber[numberKey] || null
  }
  return null
}

/** 这条票在本机的链接或网页地址；取不到时返回空串。 */
function urlOf(st: any, facts: TicketCardFacts, row: MapTicketRow | null): string {
  try {
    return String(issueUrlFor(st, facts.number, row ? effortOf(row) : undefined) || '')
  } catch (e) {
    return ''
  }
}

/**
 * 造一张地图上所有卡片的四个回调。
 *
 * rows 由模型交回来（mapDetailPageModelOf 支持「拿到这批行再给回调」的写法），所以这里不必再取一次数，
 * 也不会出现「回调认的行」与「画出来的卡」不是同一批的情况。
 */
export function pageActionHandlersOf(st: any, rows: MapTicketRow[]): TicketCardHandlers {
  const index = rowIndexOf(rows || [])

  return {
    /** 主按钮：把这张票的推进提示词注入输入框（注入内容与列表行的同一颗按钮同源：rowActionText）。 */
    onMain: function (facts: TicketCardFacts): void {
      const row = sourceRowOf(facts, index)
      if (!row) return
      try { inject(st, rowActionText(st, row)) } catch (e) {}
    },
    /** 新会话：在新会话里推进这张票（与列表行、老地图的行内按钮同一个入口）。 */
    onNew: function (facts: TicketCardFacts): void {
      const row = sourceRowOf(facts, index)
      if (!row) return
      try { openInNewSession(st, row) } catch (e) {}
    },
    /** 复制：复制这张票的链接（复制成功/失败的提示由 copyText 自己弹，卡片上不另做对勾）。 */
    onCopy: function (facts: TicketCardFacts): void {
      const row = sourceRowOf(facts, index)
      const url = urlOf(st, facts, row)
      if (!url) return
      try { copyText(st, url, tr('toast.copiedLink', { n: facts.number == null ? '' : facts.number })) } catch (e) {}
    },
    /** 打开：网页地址开新窗，本机路径交宿主打开（与老页同一判据：是不是 http(s)）。 */
    onOpen: function (facts: TicketCardFacts): void {
      const row = sourceRowOf(facts, index)
      const url = urlOf(st, facts, row)
      if (!url) return
      if (/^https?:\/\//i.test(url)) {
        try { window.open(url, '_blank', 'noreferrer') } catch (e) {}
        return
      }
      try {
        // host 只在真机闭包里存在；单文件求值或宿主未注入时，裸写 host 会抛 ReferenceError 被这里
        // catch 吞掉，用户看到的是「点了打开没反应」。同类调用都先判 typeof（views/MapDetailTop.ts:91、
        // kernel/api-io.ts:251），这里跟它们保持一致。
        if (typeof host !== 'undefined' && host && typeof host.call === 'function') {
          host.call('wf.openPath', { path: url })
        }
      } catch (e) {}
    },
  }
}
