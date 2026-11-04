// runtime/tombstone-write.ts —— 把「这张票不在了」写成墓碑（#1886）。
//
// 为什么需要它：库只增不删，一张票被后端删掉时，行还在库里。没有墓碑，回放会把已经消失的票
// 继续画出来，「v12 之后变了什么」也没法表达删除。墓碑只表达「这一版里它不在」——票重新出现时
// 由普通写入路径把墓碑清掉（ingest 里那一句 DELETE），墓碑不是永久判决。
//
// 约定：
//   1. 墓碑只给库里已经认识的票写：从没见过的票号写墓碑没有意义（调用方也不该这么做）。
//   2. 一次写入一个事务、版本 +1：与普通写入同一套版本号，变化集才能用一个版本区间把两类变化都取到。
//   3. 起读版本落后于当前版本时整批丢弃（stale），不把旧结论盖到新数据上。
import type { DatabaseSync } from 'node:sqlite'
import type { MarkMissingResult, MissingTicket } from '../contract/types.js'
import { readMergeVersion } from '../persistence/schema.js'

/**
 * 把一批「不在了」写进墓碑。起读版本比当前版本旧就整批丢弃，一个字节不改。
 */
export function markMissingTickets(
  db: DatabaseSync,
  entries: readonly MissingTicket[],
  startMergeVersion: number,
  nowMs: number,
): MarkMissingResult {
  const current = readMergeVersion(db)
  const wanted = Array.isArray(entries) ? entries.filter((e) => e && typeof e.effortId === 'string' && typeof e.key === 'string') : []
  if (!wanted.length) return { committed: true, mergeVersion: current, marked: 0 }
  if (Number(startMergeVersion) < current) return { committed: false, mergeVersion: current, marked: 0, reason: 'stale' }

  db.exec('BEGIN IMMEDIATE')
  try {
    const nextVersion = readMergeVersion(db) + 1
    const findIssue = db.prepare('SELECT issue_id FROM issue WHERE effort_id = ? AND key = ?')
    const insert = db.prepare('INSERT OR REPLACE INTO issue_tombstone (issue_id, version, deleted_at_ms) VALUES (?, ?, ?)')
    let marked = 0
    for (const entry of wanted) {
      const row = findIssue.get(entry.effortId, entry.key) as { issue_id?: number } | null
      if (!row || row.issue_id === undefined) continue
      insert.run(Number(row.issue_id), nextVersion, nowMs)
      marked += 1
    }
    if (marked === 0) {
      db.exec('ROLLBACK')
      return { committed: true, mergeVersion: current, marked: 0 }
    }
    db.prepare('UPDATE meta SET merge_version = ?, last_write_ms = ? WHERE id = 1').run(nextVersion, nowMs)
    db.exec('COMMIT')
    return { committed: true, mergeVersion: nextVersion, marked }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 事务可能已因错误自动回滚 */ }
    return {
      committed: false,
      mergeVersion: current,
      marked: 0,
      reason: 'write-failed',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}
