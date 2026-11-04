// merge/collection.ts —— 标签、指派这类「一组条目」的合并判断，纯函数。
//
// 与 row 组共用三态语义，但条目有身份（标签按 name、指派按 login）：complete 可以整组替换，
// truncated 只能把旧组里没有的条目补进去，unknown 一个都不动。位置（position）只影响展示顺序，
// 不参与身份判断——重复的条目按第一次出现算，后面的丢掉。
import type { GroupWrite } from '../contract/types.js'

/** 合并动作。replace 是整组换掉（空数组 = 清空）；append 是只补旧组里没有的条目。 */
export type CollectionMergeDecision<T> =
  | { kind: 'keep' }
  | { kind: 'replace', items: T[] }
  | { kind: 'append', items: T[] }

/**
 * 判断一组条目这一批该做什么。keyOf 抽出来而不是要求条目带 id：标签用 name、指派用 login，
 * 未来评论用 row_id，合并规则不必知道具体形状。
 */
export function decideCollectionMerge<T>(
  existing: readonly T[],
  write: GroupWrite<readonly T[] | null>,
  keyOf: (item: T) => string,
): CollectionMergeDecision<T> {
  if (write.completeness === 'unknown') return { kind: 'keep' }
  const value = dedupeByKey(write.value ?? [], keyOf)
  if (write.completeness === 'complete') {
    // complete + null/空数组 = 确认没有；旧组整组清掉。
    return { kind: 'replace', items: value }
  }
  // truncated：空值什么都没拿到，旧组原样保留；有值只补旧组没有的。
  if (value.length === 0) return { kind: 'keep' }
  const existingKeys = new Set(existing.map(keyOf))
  const missing = value.filter((item) => !existingKeys.has(keyOf(item)))
  if (missing.length === 0) return { kind: 'keep' }
  return { kind: 'append', items: missing }
}

/** 按身份去重，保留第一次出现的条目（位置以第一次为准）。 */
export function dedupeByKey<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = keyOf(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
