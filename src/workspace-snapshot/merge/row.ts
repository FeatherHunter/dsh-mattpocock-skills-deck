// merge/row.ts —— 票行组（row）的合并判断，纯函数，不碰数据库。
//
// 为什么单独抽出来：row 组的三种完整度对应三种完全不同的写动作，把它们埋在 SQL 里会让
// 「truncated 只补空缺」这条规则读不出来，也没法用门禁单独锁住。这里只回答「该做什么」，
// 具体 UPDATE 由 runtime/ingest.ts 执行。
//
// 反例：不要用「值为空就删行」来判断整组清空——那会把 truncated 的空值也当成「确认没有」。
// 只有 complete + null 才是「确认这张票不存在」。
import type { GroupWrite } from '../contract/types.js'
import type { IssueRowValue } from '../model/types.js'

/** 合并动作。fill 只带「非空且被表达」的字段，SQL 侧用 COALESCE 补 NULL。 */
export type RowMergeDecision =
  | { kind: 'keep' }
  | { kind: 'remove' }
  | { kind: 'replace', value: IssueRowValue }
  | { kind: 'fill', value: IssueRowValue }

/**
 * 判断 row 组这一批该做什么。
 *
 * - unknown：明确不知道，保留旧行，只由调用方盖章。
 * - complete + value 为 null / undefined：确认这张票不存在，写墓碑（#1885 评审修复；规格 I7：
 *   不物理删行，行留着，列表/计数投影排除它，变化集把它当删除交出去）。
 * - complete + 有值：整组替换，没给的列写 NULL（complete 的语义就是「这一组我全知道」）。
 * - truncated + 有值：只挑非空的字段去补当前为 NULL 的列；已经有的值不动。
 * - truncated + null：什么都没拿到，保留旧行。
 */
export function decideRowMerge(
  existing: IssueRowValue | null,
  write: GroupWrite<IssueRowValue | null>,
): RowMergeDecision {
  if (write.completeness === 'unknown') return { kind: 'keep' }
  const value = write.value ?? null
  if (write.completeness === 'complete') {
    if (value === null) return { kind: 'remove' }
    return { kind: 'replace', value }
  }
  // truncated
  if (value === null) return { kind: 'keep' }
  const present = pickPresentFields(value)
  if (Object.keys(present).length === 0) return { kind: 'keep' }
  return { kind: 'fill', value: present }
}

/**
 * 只留「确实给了值」的字段。0、false、空串都算有值：空标题与「没有标题」是两件事，
 * 用 truthy 判断会把 0 和 false 悄悄丢掉。existing 参数留给调用方在 SQL 里比较，
 * 纯判断不需要它——这样同一份规则在「新行」与「旧行」上表现一致。
 */
export function pickPresentFields(value: IssueRowValue): IssueRowValue {
  const out: IssueRowValue = {}
  for (const key of Object.keys(value) as Array<keyof IssueRowValue>) {
    const field = value[key]
    if (field === undefined || field === null) continue
    // 逐字段赋值：IssueRowValue 的键与值类型一一对应，这里用 any 收窄比逐个写 19 行清楚。
    ;(out as Record<string, unknown>)[key] = field
  }
  return out
}
