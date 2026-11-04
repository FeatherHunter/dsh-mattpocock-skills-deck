// merge/scalar.ts —— 单值组（子票计数、合并信息）的合并判断，纯函数。
//
// 为什么单列一份：这两种组在库里各占固定几列，值的形状不同（对象 / 数字），但三态语义与
// 行组、集合组完全一样。把「该做什么」抽成一份纯函数，SQL 那一侧只负责照着做，门禁也能
// 不经过数据库逐条断言。
//
// 反例：不要用「值为空就清空」——truncated 的空值表示「这次什么都没拿到」，不是「确认没有」。
// 只有 complete + null 才是「确认没有」，才允许把旧值写成 NULL。
import type { GroupWrite } from '../contract/types.js'

/**
 * 合并动作：
 *  - keep：不动值（unknown，或 truncated 什么都没拿到）；
 *  - clear：确认没有，把列写成 NULL；
 *  - replace：complete 且有值，整组换掉；
 *  - fill：truncated 且有值，只补当前为 NULL 的列。
 */
export type ScalarMergeDecision<T> =
  | { kind: 'keep' }
  | { kind: 'clear' }
  | { kind: 'replace', value: T }
  | { kind: 'fill', value: T }

/**
 * 判断一个单值组这一批该做什么。value 缺省（undefined）与 null 在 complete 下同义：
 * 「我完整查过，确认没有」。
 */
export function decideScalarMerge<T>(write: GroupWrite<T | null>): ScalarMergeDecision<T> {
  if (write.completeness === 'unknown') return { kind: 'keep' }
  const value = write.value ?? null
  if (write.completeness === 'complete') {
    if (value === null) return { kind: 'clear' }
    return { kind: 'replace', value }
  }
  // truncated：空值什么都没拿到，旧值原样保留；有值只补空缺。
  if (value === null) return { kind: 'keep' }
  return { kind: 'fill', value }
}
