// runtime/storage-stats.ts —— 快照库的占用读数：库文件字节数与票行数（#1922）
//
// 2026-11-05 维护者拍板：有了本地快照库做存储，按需细节不设上限、也不按容量丢内容；
// 库里的数据除非源头删除，否则不会消失。所以这里只读、只报数，**不做任何清理决定**：
// 谁要在这里加「超过多少就删」，就是把这个决定又推翻了（门禁 verify-1922 会判红）。
//
// 为什么要有这个读数：不设上限不等于不看住。库只会变大，增长必须看得见——
// 环境检查页的能力诊断用它回答「库现在多大、里面几行」，出问题时不用去磁盘上猜。
//
// 两条口径：
//   1. 字节数只数数据真正落在的两份文件：主文件与 WAL。-shm 是进程间共享内存在盘上的映射，
//      不是数据，数进来会随进程开合跳动，看不出真实增长。
//   2. 行数是 issue 表的行数（一行 = 一张票，含已关闭与拉取请求）。墓碑只加表、不删行，
//      所以它只会随票的出现增长，不会因为票被删而掉——这与「库只增不删」是同一条口径。
import type { DatabaseSync } from 'node:sqlite'
import type { SnapshotStorageStats } from '../model/types.js'
import { existsSync, statSync } from './node-builtins.js'

/** 数据真正落在的库文件后缀：主文件与 WAL（-shm 不数，理由见文件头第 1 条）。 */
export const DATA_FILE_SUFFIXES: readonly string[] = ['', '-wal']

/** 主文件与 WAL 的字节数之和；文件不在或读不到的那一份按 0 算，不因此抛错。 */
export function databaseDataBytes(dbPath: string): number {
  let total = 0
  for (const suffix of DATA_FILE_SUFFIXES) {
    const file = dbPath + suffix
    if (!existsSync(file)) continue
    try { total += Number(statSync(file).size) || 0 } catch { /* 读不到就不算这一份 */ }
  }
  return total
}

/** 库里的票行数；读失败回 0（调用方把它当成「这一趟没读到」还是「真的没有」由调用方判）。 */
export function countIssueRows(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM issue').get() as { n?: number } | null
  const n = row ? Number(row.n) : 0
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

/** 句柄的 readStorageStats 实现：文件大小与票行数一次读齐，只读、不改库。 */
export function readStorageStats(db: DatabaseSync, dbPath: string): SnapshotStorageStats {
  return { bytes: databaseDataBytes(dbPath), rows: countIssueRows(db) }
}
