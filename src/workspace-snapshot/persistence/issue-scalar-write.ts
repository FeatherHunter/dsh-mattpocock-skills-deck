// persistence/issue-scalar-write.ts —— 子票计数组与合并信息组落到 issue 表的那几列上。
//
// 两组都是「一行几个固定列」的单值组，合并语义由 merge/scalar.ts 决定，这里只把决策翻成 SQL：
//   clear   → 列写 NULL（合并信息：确认还没合并；子票计数：按「确认没有子票」写 0）；
//   replace → 整组换掉；
//   fill    → 只补当前为 NULL 的列，已有的不覆盖。
//
// 为什么子票计数的 clear 写 0 而不是 NULL：一行 issue_group 说 complete 就是「我完整查过」，
// 完整查过却没有计数只可能是「一张子票都没有」。写 NULL 会让读的人分不清「确认没有」与
// 「不知道」，正好违反本票要守的那条判据。
import type { DatabaseSync } from 'node:sqlite'
import type { GroupWrite } from '../contract/types.js'
import type { SubIssueCountsValue } from '../model/types.js'
import { decideScalarMerge } from '../merge/scalar.js'

/** 落子票计数组。调用方已保证 issueId 存在。 */
export function applyIssueSubIssues(
  db: DatabaseSync,
  issueId: number,
  write: GroupWrite<SubIssueCountsValue | null>,
): void {
  const decision = decideScalarMerge(write)
  if (decision.kind === 'keep') return
  if (decision.kind === 'clear') {
    db.prepare('UPDATE issue SET sub_total = 0, sub_completed = 0, sub_percent = 0 WHERE issue_id = ?')
      .run(issueId)
    return
  }
  const total = countOf(decision.value.total)
  const completed = countOf(decision.value.completed)
  const percent = percentOf(decision.value.percent, total, completed)
  if (decision.kind === 'replace') {
    db.prepare('UPDATE issue SET sub_total = ?, sub_completed = ?, sub_percent = ? WHERE issue_id = ?')
      .run(total, completed, percent, issueId)
    return
  }
  db.prepare(
    `UPDATE issue SET
       sub_total = COALESCE(sub_total, ?),
       sub_completed = COALESCE(sub_completed, ?),
       sub_percent = COALESCE(sub_percent, ?)
     WHERE issue_id = ?`,
  ).run(total, completed, percent, issueId)
}

/** 落合并信息组。值就是合并时间的毫秒数；clear = 确认还没合并。 */
export function applyIssueMergeInfo(
  db: DatabaseSync,
  issueId: number,
  write: GroupWrite<number | null>,
): void {
  const decision = decideScalarMerge(write)
  if (decision.kind === 'keep') return
  if (decision.kind === 'clear') {
    db.prepare('UPDATE issue SET merged_at_ms = NULL WHERE issue_id = ?').run(issueId)
    return
  }
  if (decision.kind === 'replace') {
    db.prepare('UPDATE issue SET merged_at_ms = ? WHERE issue_id = ?').run(decision.value, issueId)
    return
  }
  db.prepare('UPDATE issue SET merged_at_ms = COALESCE(merged_at_ms, ?) WHERE issue_id = ?')
    .run(decision.value, issueId)
}

/** 计数只收非负整数；拿不到或形状不对按 0（complete 的语义是「确认没有」）。 */
function countOf(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * 百分比只收 0..100 的整数；后端没给就按已完成的计数推（四舍五入），
 * 连总数都没有时写 0——这时候「0%」与「一张子票都没有」是同一件事。
 */
function percentOf(value: number | null | undefined, total: number, completed: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.floor(value)))
  }
  if (total > 0) return Math.max(0, Math.min(100, Math.round((completed * 100) / total)))
  return 0
}
