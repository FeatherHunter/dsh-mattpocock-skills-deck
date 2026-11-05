/**
 * src/tracker/deck-counts.ts —— 面板计数的形状与校验（#1887 改写；#1698 起步、#1796 收口的旧口径退场）
 *
 * #1887 起数字只有一个来源：快照库的 readCounts 一次查询（六个数字 + 完整度）。本文件不再决定
 * 「拿不到后端计数时用什么顶」，也不再造「待校准」这一档 —— 那套两种来源的口径正是本票要消灭的
 * 东西。这里只做两件事：
 *   1. 把库交上来的那份读数收成稳定形状（六个非负整数 + complete / known）；
 *   2. 把它挂到 deck 上。形状坏（缺数、负数、小数、认不出的完整度）就整份不挂，调用方按
 *      「这一趟没有计数」处理 —— 绝不补 0，也绝不挑几个数先用。
 *
 * 为什么还留这一层：库层与宿主层各自有类型，但宿主与客户端之间是序列化边界；一条坏读数不应该
 * 走到界面上变成假数字。校验只此一处，宿主挂 deck 与门禁读它都走这里。
 *
 * 反例：
 *  - 拿不到读数时返回 0/0/0 —— 界面会当成「真的没有票」；
 *  - 只认三个数、把可接/阻塞/已认领当可选 —— 那又回到「同一屏上几个数字来源不同」的老问题。
 */

/**
 * 六个数字的字段名（顺序固定）。校验就按这份清单逐项收：加一个数字只改这里与 DeckCounts，
 * 不在 normalizeDeckCounts 里再手写一遍六个名字。
 */
export const DECK_COUNT_FIELDS = Object.freeze(['total', 'open', 'closed', 'takeable', 'blocked', 'claimed'] as const)
/** 一读数的完整度：整仓完整枚举过就是 complete，否则是 known（诚实的下界）。校验按这份清单认值。 */
export const DECK_COUNT_COMPLETENESS = Object.freeze(['complete', 'known'] as const)
export type DeckCountsCompleteness = (typeof DECK_COUNT_COMPLETENESS)[number]

/** 挂进 deck.counts 的六个数字 + 完整度。 */
export interface DeckCounts {
  total: number
  open: number
  closed: number
  takeable: number
  blocked: number
  claimed: number
  completeness: DeckCountsCompleteness
}

/** 非负整数才算数：负数、小数、NaN、字符串一律当没有（不猜、不截断）。 */
function countOf(value: unknown): number | null {
  return (typeof value === 'number' && Number.isFinite(value) && value >= 0 && Math.floor(value) === value) ? value : null
}

/**
 * 把任意形状收成一份 deck 计数；任何一格不合格就整份回 null。
 *
 * 为什么整份拒绝而不是逐格丢弃：六个数字是同一份库的一次查询，缺一格说明这份读数本身不完整；
 * 拿剩下的五个挂上去，界面会显示一组来源不同的数（甚至总和都对不上）。
 */
export function normalizeDeckCounts(value: unknown): DeckCounts | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const counts: Record<string, number> = {}
  for (const field of DECK_COUNT_FIELDS) {
    const count = countOf(raw[field])
    if (count === null) return null
    counts[field] = count
  }
  const completeness = DECK_COUNT_COMPLETENESS.find(function (item: DeckCountsCompleteness): boolean { return item === raw.completeness })
  if (!completeness) return null
  return {
    total: counts.total,
    open: counts.open,
    closed: counts.closed,
    takeable: counts.takeable,
    blocked: counts.blocked,
    claimed: counts.claimed,
    completeness: completeness,
  }
}

/**
 * 把库读数挂到 deck 上；读数不合格时把 deck.counts 清掉（不保留上一次的旧数字冒充这一次）。
 *
 * 为什么不合格要清掉而不是留着上一次：留着旧数字正是「同一屏两种口径」；
 * 清掉之后界面会说「未知」或按「已知」口径显示，这是诚实的。
 */
export function applyDeckCounts(deck: Record<string, unknown> | null | undefined, value: unknown): DeckCounts | null {
  const counts = normalizeDeckCounts(value)
  if (!deck) return counts
  if (counts) deck.counts = counts
  else delete deck.counts
  return counts
}
