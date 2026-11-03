// persistence/issue-identity-write.ts —— 票身份（effort_id + key）与数据库代理键的解析。
//
// 为什么单独一份：行写入与边写入都要「没有这行就先建一行」，而且边可能指向一张还没在列表里
// 出现过的票。两处各写一份迟早会分叉，所以抽成同一处。
import type { DatabaseSync } from 'node:sqlite'

/** 按身份找代理键；没有返回 null。不建行，给「确认不存在」的删除路径用。 */
export function findIssueId(db: DatabaseSync, effortId: string, key: string): number | null {
  const row = db.prepare(
    'SELECT issue_id FROM issue WHERE effort_id = ? AND key = ?',
  ).get(effortId, key) as { issue_id?: number } | null
  return row ? Number(row.issue_id) : null
}

/**
 * 拿到票的代理键；没有就建一行骨架（只填身份与首末次见到的时间）。
 *
 * 骨架行没有 row 组，所以列表投影不会把它当成一张票；它只是让边上的外键立得住，
 * 等真正的列表查询把这张票读回来时再补上标题与状态。
 */
export function ensureIssueId(
  db: DatabaseSync,
  effortId: string,
  key: string,
  nowMs: number,
): number {
  const existing = findIssueId(db, effortId, key)
  if (existing !== null) {
    db.prepare('UPDATE issue SET last_seen_ms = ? WHERE issue_id = ?').run(nowMs, existing)
    return existing
  }
  const result = db.prepare(
    'INSERT INTO issue (effort_id, key, first_seen_ms, last_seen_ms) VALUES (?, ?, ?, ?)',
  ).run(effortId, key, nowMs, nowMs)
  return Number(result.lastInsertRowid)
}
