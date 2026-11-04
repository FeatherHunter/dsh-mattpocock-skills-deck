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
