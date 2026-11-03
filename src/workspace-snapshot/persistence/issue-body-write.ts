// persistence/issue-body-write.ts —— 正文组落到 issue_body 表上。
//
// 正文单独一张表：列表查询永远不该读几十 KB 的正文。这一组只有三态语义，写法与行组同构：
//   complete + 有内容 → 整组换掉（upsert）；
//   complete + 空串或 null → 确认没有正文，删掉正文行（组状态由调用方盖章）；
//   truncated + 有内容 → 只在没有正文行时补进去，已有的不覆盖；
//   truncated + 空、unknown → 不动。
//
// 为什么空正文要删行而不是写空串：库里「有行但正文是空串」与「没有行」对读的人来说是一件事
// （都表示没有正文），删行让库小一点；真正的「确认没有」由 issue_group 的三态表达。
import type { DatabaseSync } from 'node:sqlite'
import type { GroupWrite } from '../contract/types.js'
import { decideScalarMerge } from '../merge/scalar.js'

/** 落正文组。调用方已保证 issueId 存在（同一事务里刚 ensure 过）。 */
export function applyIssueBody(
  db: DatabaseSync,
  issueId: number,
  write: GroupWrite<string | null>,
): void {
  const decision = decideScalarMerge(write)
  if (decision.kind === 'keep') return
  if (decision.kind === 'clear') {
    db.prepare('DELETE FROM issue_body WHERE issue_id = ?').run(issueId)
    return
  }
  const text = String(decision.value)
  if (text.length === 0) {
    // complete + 空串是「确认没有」；truncated + 空串什么都没拿到，两种都不该写正文。
    if (write.completeness === 'complete') {
      db.prepare('DELETE FROM issue_body WHERE issue_id = ?').run(issueId)
    }
    return
  }
  if (decision.kind === 'replace') {
    db.prepare(
      `INSERT INTO issue_body (issue_id, body) VALUES (?, ?)
       ON CONFLICT(issue_id) DO UPDATE SET body = excluded.body`,
    ).run(issueId, text)
    return
  }
  // truncated：只补空缺，不覆盖已经取到的正文。
  db.prepare('INSERT OR IGNORE INTO issue_body (issue_id, body) VALUES (?, ?)').run(issueId, text)
}
