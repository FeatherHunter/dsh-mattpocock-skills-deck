// merge/paged.ts —— 「从头开始按页取回来的一组条目」怎么并，纯函数（#1865）。
//
// 评论与评审都是这条形状：后端每次从第 0 条开始给，调用方要多少给多少。于是手里这一页永远是
// 整组的一个前缀，合并规则也只有两条：
//   · complete：这一趟拿到了整组，整组换掉（空数组 = 确认没有）；位置从 0 重排。
//   · truncated：只覆盖从头上数的那几条，库里已知的后面几条原样留着；一条都没拿到就什么都不动。
// 为什么不按「条目身份」合并：本地 Markdown 的评论没有 id（见 model/types.ts 的 SnapshotComment），
// 评审在契约里根本没有 id。唯一稳定的东西是顺序，所以就用顺序当身份，不再造一个假的键。
//
// 反例：把 truncated 当成完整来源去清空，会让「加载更多」取回来的后几页在一次详情刷新时被抹掉。
import type { GroupWrite } from '../contract/types.js'

/** 合并动作。replace 是整组换掉；replace-prefix 是只换前 N 条、保留后面的。 */
export type PagedMergeDecision<T> =
  | { kind: 'keep' }
  | { kind: 'replace', items: T[] }
  | { kind: 'replace-prefix', items: T[] }

/**
 * 写回执那一条新评论该落在第几位（#1866）。
 *
 * 规则只有两句：
 *  - 调用方知道票面总数时，就用那个数（新评论的下标就是「原来一共几条」）；前面的空隙留给
 *    还没取到的那些评论，下一次取一页只会覆盖更小的位置，不会把这一条冲掉。
 *  - 不知道总数时落到已取条数后面（`taken`）：位置可能不准，但至少不会盖掉已知的那几条。
 *
 * 反例：把它当成「前缀的第 taken 条」写进评论组，游标会跟着前进，下一次「加载更多」就会跳过
 * 中间那几条还没取到的评论；位置取 0 更糟，会把第一条已知评论覆盖掉。
 */
export function receiptCommentSlot(position: number | null | undefined, taken: number): number {
  const fallback = (typeof taken === 'number' && Number.isFinite(taken) && taken > 0) ? Math.floor(taken) : 0
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) return fallback
  return Math.max(Math.floor(position), fallback)
}

/**
 * 判断一组按页取回的条目这一批该做什么。
 *
 * unknown 只盖章不动值（三态的通用规则）；complete 连空数组一起换（那是「确认没有」）；
 * truncated 只在真的拿到条目时覆盖前缀，否则连位置都不动。
 */
export function decidePagedMerge<T>(write: GroupWrite<readonly T[]>): PagedMergeDecision<T> {
  if (write.completeness === 'unknown') return { kind: 'keep' }
  const items = Array.isArray(write.value) ? Array.from(write.value) : []
  if (write.completeness === 'complete') return { kind: 'replace', items }
  if (items.length === 0) return { kind: 'keep' }
  return { kind: 'replace-prefix', items }
}
