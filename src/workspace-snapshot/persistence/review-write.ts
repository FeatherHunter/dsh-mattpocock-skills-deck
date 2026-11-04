// persistence/review-write.ts —— 评审组落到 review 表（#1865）。
//
// 契约里没有评审 id（src/tracker/contract/entities.ts 的 Review），所以「第几条」就是唯一的身份，
// 合并规则与评论共用 merge/paged.ts：complete 整组替换（空数组 = 确认没有评审），truncated
// 只换从头数的前几条、后面已知的留着，unknown 不动值。
//
// 为什么整组替换要写成 DELETE 再插：旧评审残留是这一组最容易出的事（同一张票第二次取回来的
// 评审可能比上一次少）。按位置 INSERT OR REPLACE 会留下上一次多出来的后几条，所以 complete
// 先清空再按顺序写。
import type { DatabaseSync } from 'node:sqlite'
import type { GroupWrite } from '../contract/types.js'
import type { SnapshotReview } from '../model/types.js'
import { decidePagedMerge } from '../merge/paged.js'
import { upsertActor } from './actor-write.js'

/** 评审组在 issue_group 里的组名。 */
export const REVIEW_GROUP = 'review'

/** 落一组评审。调用方已保证 issueId 存在。 */
export function applyIssueReviews(
  db: DatabaseSync,
  issueId: number,
  write: GroupWrite<SnapshotReview[]>,
): void {
  const decision = decidePagedMerge(write)
  if (decision.kind === 'keep') return

  if (decision.kind === 'replace') {
    db.prepare('DELETE FROM review WHERE issue_id = ?').run(issueId)
  }
  // truncated 不清表：这一页只覆盖从头数的那几条，后面那些上一趟取到的行原样留着。
  const insert = db.prepare(
    `INSERT OR REPLACE INTO review (issue_id, position, state, reviewer_id, submitted_at_ms)
     VALUES (?, ?, ?, ?, ?)`,
  )
  decision.items.forEach((item, index) => {
    const reviewerId = item && item.reviewer ? upsertActor(db, item.reviewer, false) : null
    insert.run(
      issueId,
      index,
      item && typeof item.state === 'string' ? item.state : '',
      reviewerId,
      item ? item.submittedAtMs ?? null : null,
    )
  })
}
