/**
 * views/mapDetailV2/wiring/pageActionHandlers.ts —— 卡片四个按钮点下去以后干什么（页面这侧的接线）。
 *
 * 为什么单独一份：模型只知道「这张票该画哪种动作」，不知道动作要注入哪段提示词、复制哪个链接、
 * 是开浏览器还是开本机文件。这些全都要问宿主（inject / copyText / host.call），所以收在这一份里；
 * 模型与画法层都不碰宿主，换宿主时只改这一处。
 *
 * 为什么回调要先把票还原成「原始行」：主按钮注入的提示词由 rowActionText 按原始行算（它要看标签，
 * 例如带 ready-for-agent 的实施票注入的是 /implement，地图与规格则走容器三态）。卡片交回来的是
 * 「刻画」（facts），所以这里用编号把行找回来——行就是模型画这批卡时用的同一批行，不会再变。
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

/** 编号或行 key → 原始行。同号只认先出现的那张，与模型里「编号索引」的口径一致。 */
function rowsByNumber(rows: MapTicketRow[]): Record<string, MapTicketRow> {
  const out: Record<string, MapTicketRow> = {}
  for (const row of rows || []) {
    if (!row) continue
    const no = row.number != null ? row.number : (row as any).key
    if (no === undefined || no === null || no === '') continue
    const key = String(no)
    if (out[key] === undefined) out[key] = row
  }
  return out
}

/** 一张卡的刻画 → 它来自的那一行；找不到时返回 null（页面按「这一下不做」处理，不猜）。 */
function sourceRowOf(facts: TicketCardFacts, byNo: Record<string, MapTicketRow>): MapTicketRow | null {
  if (!facts) return null
  const key = facts.number != null ? String(facts.number) : String(facts.rowKey || '')
  return (key && byNo[key]) || null
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
  const byNo = rowsByNumber(rows || [])

  return {
    /** 主按钮：把这张票的推进提示词注入输入框（注入内容与列表行的同一颗按钮同源：rowActionText）。 */
    onMain: function (facts: TicketCardFacts): void {
      const row = sourceRowOf(facts, byNo)
      if (!row) return
      try { inject(st, rowActionText(st, row)) } catch (e) {}
    },
    /** 新会话：在新会话里推进这张票（与列表行、老地图的行内按钮同一个入口）。 */
    onNew: function (facts: TicketCardFacts): void {
      const row = sourceRowOf(facts, byNo)
      if (!row) return
      try { openInNewSession(st, row) } catch (e) {}
    },
    /** 复制：复制这张票的链接（复制成功/失败的提示由 copyText 自己弹，卡片上不另做对勾）。 */
    onCopy: function (facts: TicketCardFacts): void {
      const row = sourceRowOf(facts, byNo)
      const url = urlOf(st, facts, row)
      if (!url) return
      try { copyText(st, url, tr('toast.copiedLink', { n: facts.number == null ? '' : facts.number })) } catch (e) {}
    },
    /** 打开：网页地址开新窗，本机路径交宿主打开（与老页同一判据：是不是 http(s)）。 */
    onOpen: function (facts: TicketCardFacts): void {
      const row = sourceRowOf(facts, byNo)
      const url = urlOf(st, facts, row)
      if (!url) return
      if (/^https?:\/\//i.test(url)) {
        try { window.open(url, '_blank', 'noreferrer') } catch (e) {}
        return
      }
      try {
        if (host && typeof host.call === 'function') host.call('wf.openPath', { path: url })
      } catch (e) {}
    },
  }
}
