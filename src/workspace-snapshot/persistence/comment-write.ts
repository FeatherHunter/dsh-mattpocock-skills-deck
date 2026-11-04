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
import type { GroupWrite } from '../contract/types.js'
import type { SnapshotComment } from '../model/types.js'
import { decidePagedMerge } from '../merge/paged.js'
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
