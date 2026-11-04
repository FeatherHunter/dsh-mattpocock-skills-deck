// persistence/fetch-cursor.ts —— 按页取的组「取到第几条了」的读写（#1865）。
//
// 语义只有一句：游标是从头上数、已经取回来的条目条数。今天只有评论用它（fetch_cursor 表按
// (issue_id, group_name) 一行），以后再有分页的组直接复用这张表，不必另开一列。
//
// 为什么存成十进制文本：schema 的 cursor 列是 TEXT，表结构与提案一字不差；这一层负责把文本
// 与数字互转，读不懂的写法一律当 0（宁可重取一页，也不能把游标读成一个巨大的数）。
//
// 推进规则不在这里：什么时候能前进、什么时候可以回退由 comment-write.ts 按完整度决定，
// 因为那件事与「这一页覆盖了哪些行」是同一个判断，分开放会让两处各说一套。
import type { DatabaseSync } from 'node:sqlite'

/** 读游标；没有这一行或写法读不懂都回 null（= 从没取过）。 */
export function readFetchCursor(db: DatabaseSync, issueId: number, groupName: string): number | null {
  const row = db.prepare(
    'SELECT cursor FROM fetch_cursor WHERE issue_id = ? AND group_name = ?',
  ).get(issueId, groupName) as { cursor?: string } | undefined
  if (!row || typeof row.cursor !== 'string') return null
  const value = Number(row.cursor.trim())
  if (!Number.isFinite(value) || value < 0) return null
  return Math.floor(value)
}

/** 写游标（覆盖）。调用方保证 count 是非负整数。 */
export function writeFetchCursor(
  db: DatabaseSync,
  issueId: number,
  groupName: string,
  count: number,
  nowMs: number,
): void {
  db.prepare(
    `INSERT INTO fetch_cursor (issue_id, group_name, cursor, updated_ms) VALUES (?, ?, ?, ?)
     ON CONFLICT(issue_id, group_name) DO UPDATE SET
       cursor = excluded.cursor, updated_ms = excluded.updated_ms`,
  ).run(issueId, groupName, String(Math.max(0, Math.floor(count))), nowMs)
}
