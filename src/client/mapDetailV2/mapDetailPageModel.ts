/**
 * src/client/mapDetailV2/mapDetailPageModel.ts —— 把一页要画的东西一次算好：档案、取数状态、看板、卡片 props。
 *
 * 为什么要有这一层：页面容器要做的判断其实有先后次序——先判「取到的数据有多全」（ticketFeedOf），
 * 再给每张票刻画（ticketCardFactsOf），再排序（orderTicketBoard），再数数（boardCountsOf），
 * 最后才把「地图自身内容」与这些结果合成档案（mapProfileOf）。这几步的次序与依赖不能交给页面自己记：
 * 页面一多写一遍，迟早出现「档案里的计数与卡片张数对不上」这种各算各的错。
 * 所以次序收在这一份组合函数里，页面只调一次。
 *
 * 这一份是纯函数：不发请求、不读 React、不碰 DOM。取数请求仍由页面自己的 effect 发，
 * 取回来的桶当参数传进来；四个按钮点下去做什么由页面通过 handlers 决定。
 *
 * 与老页的口径差异（有意）：老页把「取数成功那份的 stats」直接给计数行；V2 的档案计数按
 * 当前画出来的行数算（boardCountsOf），取数说明另由 feed 那一段话交代「只加载了前 N 张」
 * 「还有 N 张没取到」。这样计数与画面里卡片的张数永远一致，不会出现「计数说 37、页面只画 24」。
 */
import type {
  MapDetailPageInputs,
  MapDetailPageModel,
  TicketCardFacts,
} from './mapDetailTypes'
// 模块说明符按仓内约定写 .js：scripts/ts-hook.mts 会把它改指同目录同名 .ts，测试与构建两边同一份源。
import { ticketFeedOf } from './ticketFeed.js'
import { ticketFactsContextOf, ticketCardFactsOf } from './ticketCardFacts.js'
import { orderTicketBoard, boardCountsOf } from './ticketBoard.js'
import { mapProfileOf } from './mapProfile.js'
import { cardPropsListOf } from './cardPropsOf.js'

/**
 * 一张地图 → 一整页模型。
 *
 * 复杂度和取数无关的部分都是线性的：刻画 O(票数 × 每张的阻塞者数)，排序 O(票数 log 票数)，
 * 摊卡片 props O(票数)。同一个桶重复算同一页不会改变结果（纯函数，无缓存也不出错）。
 */
export function mapDetailPageModelOf(input: MapDetailPageInputs): MapDetailPageModel {
  const feed = ticketFeedOf(input.bucket, input.map)
  const env = {
    cardIdPrefix: input.cardIdPrefix,
    colorOf: input.colorOf || null,
    actionOf: input.actionOf,
    textOf: input.textOf,
  }
  const ctx = ticketFactsContextOf(feed.rows, env)
  const facts: TicketCardFacts[] = feed.rows.map(function (row) { return ticketCardFactsOf(row, ctx) })
  const board = orderTicketBoard(facts)
  const counts = boardCountsOf(facts)
  const profile = mapProfileOf(input.map, feed, counts)
  const colorOf = input.colorOf || null
  const handlers = input.handlers || null
  return {
    profile: profile,
    feed: feed,
    board: board,
    counts: counts,
    cards: {
      open: cardPropsListOf(board.open, handlers, colorOf),
      closed: cardPropsListOf(board.closed, handlers, colorOf),
    },
  }
}
