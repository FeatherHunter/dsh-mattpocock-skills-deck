// persistence/comment-write.ts —— 评论组落到 comment 表，并推进「取到第几条」的游标（#1865）。
//
// 合并决策在 merge/paged.ts（complete 整组替换、truncated 只覆盖从头数的前几条），这一层负责
// 把决策写成 SQL，并维护 position 与游标：
//   · 位置就是顺序：后端每次从第 0 条开始给，所以「第几条」既是展示顺序也是身份；
//   · 游标只在这两组真的写进去时才动（unknown 与空页都不动）；
//   · complete 是权威，游标跟着这一组的条数走，可以回退（上游删了评论）；
//     truncated 不删已知的后面几条，所以游标只许前进，不许因为只交了一页就倒退。
//
// 为什么作者要落库：评论正文与作者信息是「已取过就不重取」的内容，作者只在 actor 表里存一份，
// 多条评论按登录名共用一行；写的时候用补缺口径（overwrite=false），不拿 NULL 盖掉已知的昵称头像。
import type { DatabaseSync } from 'node:sqlite'
import type { CommentReceiptWrite, GroupWrite } from '../contract/types.js'
import type { SnapshotComment } from '../model/types.js'
import { decidePagedMerge, receiptCommentSlot } from '../merge/paged.js'
import { upsertActor } from './actor-write.js'
import { readFetchCursor, writeFetchCursor } from './fetch-cursor.js'

/** 评论组在 issue_group 与 fetch_cursor 里的组名。对外的组名是契约的一部分，别改写法。 */
export const COMMENTS_GROUP = 'comments'

/** 落一组评论。调用方已保证 issueId 存在。 */
export function applyIssueComments(
  db: DatabaseSync,
  issueId: number,
  write: GroupWrite<SnapshotComment[]>,
  nowMs: number,
): void {
  const decision = decidePagedMerge(write)
  if (decision.kind === 'keep') return

  if (decision.kind === 'replace') {
    db.prepare('DELETE FROM comment WHERE issue_id = ?').run(issueId)
  }
  // truncated 不清表：这一页只覆盖从头数的那几条，后面那些上一趟取到的行原样留着。
  const deleteAt = db.prepare('DELETE FROM comment WHERE issue_id = ? AND position = ?')
  const insert = db.prepare(
    `INSERT INTO comment (
       issue_id, backend_id, author_id, author_association, body,
       created_at_ms, updated_at_ms, edited_at_ms, position
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  decision.items.forEach((item, index) => {
    const authorId = item && item.author ? upsertActor(db, item.author, false) : null
    if (decision.kind === 'replace-prefix') deleteAt.run(issueId, index)
    insert.run(
      issueId,
      item && typeof item.backendId === 'string' && item.backendId ? item.backendId : null,
      authorId,
      item && typeof item.authorAssociation === 'string' ? item.authorAssociation : null,
      item && typeof item.body === 'string' ? item.body : '',
      item ? item.createdAtMs ?? null : null,
      item ? item.updatedAtMs ?? null : null,
      item ? item.editedAtMs ?? null : null,
      index,
    )
  })
  advanceCommentsCursor(db, issueId, decision.kind, decision.items.length, nowMs)
}

/** 游标怎么推进：complete 直接对齐这一组的条数；truncated 只前进，不倒退。 */
function advanceCommentsCursor(
  db: DatabaseSync,
  issueId: number,
  kind: 'replace' | 'replace-prefix',
  count: number,
  nowMs: number,
): void {
  if (kind === 'replace') {
    writeFetchCursor(db, issueId, COMMENTS_GROUP, count, nowMs)
    return
  }
  const current = readFetchCursor(db, issueId, COMMENTS_GROUP)
  if (current === null || count > current) writeFetchCursor(db, issueId, COMMENTS_GROUP, count, nowMs)
}

/** 这张票已经有多少条评论行（写回执找不到位置时退到它后面）。 */
function countCommentRows(db: DatabaseSync, issueId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM comment WHERE issue_id = ?').get(issueId) as { n?: number } | null
  const count = row ? Number(row.n) : 0
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

/** 那个位置是不是已经有评论了。 */
function positionTaken(db: DatabaseSync, issueId: number, position: number): boolean {
  const row = db.prepare('SELECT 1 AS hit FROM comment WHERE issue_id = ? AND position = ?').get(issueId, position)
  return !!row
}

/**
 * 落一条评论写回执（#1866）：只把「刚发的那一条」写进去，不当作一页。
 *
 * 三条规矩：
 *  1. 位置由 merge/paged.ts 的 receiptCommentSlot 定（知道总数就用总数，否则落到已知条数后面）；
 *     那个位置已经有别人取回来的评论时往后挪 —— 宁可位置不精确，也不删掉已知的那一条。
 *  2. 游标分两种情形：原来完整时跟着这一组现在的条数走（完整意味着我们全知道，条数变了游标就变）；
 *     只有一部分时一个字节都不动 —— 追加一条不等于「取到了第 N 条」，动了会让「加载更多」跳过中间几条。
 *  3. 作者照旧按登录名补缺口写进 actor 表，不拿 NULL 盖掉已知的昵称头像。
 *
 * 返回这条评论最终落在第几位（被占用时可能比调用方要的靠后）。
 */
export function applyCommentReceipt(
  db: DatabaseSync,
  issueId: number,
  receipt: CommentReceiptWrite,
  nowMs: number,
): number {
  const comment = receipt.comment
  let position = receiptCommentSlot(receipt.position, countCommentRows(db, issueId))
  while (positionTaken(db, issueId, position)) position += 1
  const authorId = comment && comment.author ? upsertActor(db, comment.author, false) : null
  db.prepare(
    `INSERT INTO comment (
       issue_id, backend_id, author_id, author_association, body,
       created_at_ms, updated_at_ms, edited_at_ms, position
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    issueId,
    comment && typeof comment.backendId === 'string' && comment.backendId ? comment.backendId : null,
    authorId,
    comment && typeof comment.authorAssociation === 'string' ? comment.authorAssociation : null,
    comment && typeof comment.body === 'string' ? comment.body : '',
    comment ? comment.createdAtMs ?? null : null,
    comment ? comment.updatedAtMs ?? null : null,
    comment ? comment.editedAtMs ?? null : null,
    position,
  )
  // 组本身完整时，「取到第几条」就等于这一组现在的条数；只有一部分时游标一个字节都不动。
  if (receipt.completeness === 'complete') {
    writeFetchCursor(db, issueId, COMMENTS_GROUP, countCommentRows(db, issueId), nowMs)
  }
  return position
}
