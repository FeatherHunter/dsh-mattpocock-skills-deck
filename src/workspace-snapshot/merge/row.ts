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
 * 把「某份数据的更新时间」归一成非负毫秒整数或 null。
 *
 * null 只有一个意思：**这一趟不知道它的更新时间**。未知与已知是两件事，所以这里绝不能用 0 顶替：
 * 0 会被读成「1970 年更新过」，于是一份不知道该什么时候更新的数据会把库里更新的值挡住，
 * 或者反过来被当成「比谁都旧」而漏掉一次真正的更新。null / undefined / NaN / 负数 / 字符串都回 null。
 */
export function normalizeRowTimeMs(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  return Math.trunc(raw)
}

/** 这条时间规则用在哪一路：读结果的 row 组（严格更新才覆盖）与写回执（持平按到达序写）。 */
export type RowTimeKind = 'read' | 'receipt'

/**
 * row 组这一批该不该覆盖库里的行（#1931）。
 *
 * 规则（逐条都有反例，改之前先看反例）：
 *  - 来者严格新于库里已存 → 覆盖。这是唯一的「正常更新」。
 *  - 持平（两个时刻毫秒相同）→ 读结果不覆盖。反例：分页与整份重取先后回来，两份数据是同一时刻的
 *    快照，谁后到谁赢会让「刚看到新标题」被一份同时刻的旧回包顶回去。写回执持平要写：
 *    回执是「我刚把它改成了这样」的结论，同一秒内两次写回执只能按到达顺序落。
 *  - 来者不知道、库里知道 → 不覆盖（不知道 ≠ 更新）。
 *  - 来者知道、库里不知道 → 覆盖（已知可以填未知）。
 *  - 两边都不知道 → 覆盖：没有可比的时间，这条规则不参与判断，退回改动前「照写」的行为。
 *
 * 删除表达（row 组 complete + null）不走这条规则：它不写行，只写墓碑，归版本门与回执窗口管。
 */
export function shouldApplyRowTime(
  incomingMs: unknown,
  existingMs: unknown,
  kind: RowTimeKind,
): boolean {
  const incoming = normalizeRowTimeMs(incomingMs)
  const existing = normalizeRowTimeMs(existingMs)
  if (incoming === null) return existing === null
  if (existing === null) return true
  return kind === 'receipt' ? incoming >= existing : incoming > existing
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
