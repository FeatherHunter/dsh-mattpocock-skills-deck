// persistence/issue-edge-write.ts —— 父子边与阻塞边的三态写入。
//
// 为什么边单独一组：容器树靠 parents（子票 → 父票），状态胶囊靠 blockedBy（这张票 → 阻塞它的票）。
// 两者都是「一组目标票」，合并语义与标签、指派完全一样（complete 整组替换、truncated 只补、
// unknown 不动），所以直接复用 merge/collection.ts 的判据，不另立一套。
//
// 写进来的是目标票的 key，不是数据库 id：上层只有 key。目标票还没在库里时先建一行引用骨架，
// 让外键立得住；骨架没有 row 组，不会出现在列表里。自指边没有意义（会让树递归），直接跳过。
import type { DatabaseSync } from 'node:sqlite'
import type { GroupWrite } from '../contract/types.js'
import { decideCollectionMerge } from '../merge/collection.js'
import { ensureIssueId } from './issue-identity-write.js'

/** 边表 kind 列的两个取值；改这里就同时要改 schema 的 CHECK 约束。 */
export type EdgeKind = 'parent' | 'blocks'

/** 落一组边。调用方已保证 subjectId 存在（同一事务里刚 ensure 过）。 */
export function applyIssueEdges(
  db: DatabaseSync,
  subjectId: number,
  effortId: string,
  kind: EdgeKind,
  write: GroupWrite<readonly string[] | null>,
  nowMs: number,
): void {
  const existing = readEdgeKeys(db, subjectId, kind)
  const decision = decideCollectionMerge(existing, write, (key) => key)
  if (decision.kind === 'keep') return
  if (decision.kind === 'replace') {
    db.prepare('DELETE FROM issue_edge WHERE subject_id = ? AND kind = ?').run(subjectId, kind)
  }
  const insert = db.prepare(
    'INSERT OR IGNORE INTO issue_edge (subject_id, object_id, kind) VALUES (?, ?, ?)',
  )
  for (const key of decision.items) {
    if (typeof key !== 'string' || key.length === 0) continue
    const objectId = ensureIssueId(db, effortId, key, nowMs)
    if (objectId === subjectId) continue
    insert.run(subjectId, objectId, kind)
  }
}

/** 按 object_id 升序读回旧边：顺序稳定，合并判据与门禁才能逐字断言。 */
function readEdgeKeys(db: DatabaseSync, subjectId: number, kind: EdgeKind): string[] {
  const rows = db.prepare(
    `SELECT i.key AS key
       FROM issue_edge e
       JOIN issue i ON i.issue_id = e.object_id
      WHERE e.subject_id = ? AND e.kind = ?
      ORDER BY e.object_id`,
  ).all(subjectId, kind) as Array<{ key: string }>
  return rows.map((row) => String(row.key))
}
