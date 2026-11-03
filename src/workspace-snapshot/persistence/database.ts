// persistence/database.ts —— SQLite 连接的开关、PRAGMA、损坏检查与文件级备份。
//
// 这一层只做「文件与连接」的事，不碰业务表结构（建表在 schema.ts）。为什么把 PRAGMA 集中
// 在这里：WAL 回退、只读连接、损坏文件的删除顺序都是容易写错的地方，集中一份才能被门禁
// 反复走同一条路径。
import { DatabaseSync } from 'node:sqlite'
import { existsSync, renameSync, rmSync } from 'node:fs'

/** 打开连接。文件不存在时 SQLite 会建一个空库；readOnly 下文件必须已存在。 */
export function openDatabase(dbPath: string, readOnly: boolean): DatabaseSync {
  return new DatabaseSync(dbPath, { readOnly })
}

/**
 * 写者 PRAGMA。WAL 优先，网络盘等不支持共享内存的环境回退 DELETE（规格第 7 节）；
 * synchronous=NORMAL 接受「掉最后一条事务」——快照数据可以重取。
 *
 * 返回实际生效的 journal_mode，调用方拿它记日志：回退不是错误，但必须留下痕迹。
 */
export function applyWriterPragmas(db: DatabaseSync): string {
  let journalMode = 'unknown'
  try {
    const row = db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode?: string } | null
    journalMode = String(row?.journal_mode ?? '')
  } catch {
    journalMode = ''
  }
  if (journalMode !== 'wal') {
    try {
      const row = db.prepare('PRAGMA journal_mode = DELETE').get() as { journal_mode?: string } | null
      journalMode = String(row?.journal_mode ?? 'delete')
    } catch {
      journalMode = 'delete'
    }
  }
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  return journalMode
}

/**
 * 只读连接 PRAGMA。query_only 是第二道闸：即使上层误调了写语句，SQLite 也会拒绝，
 * 不会因为「只读模式」只是一个约定而把别人的库改了。不设 journal_mode：只读连接改不了它。
 */
export function applyReaderPragmas(db: DatabaseSync): void {
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA query_only = ON')
}

/**
 * 完整性检查。quick_check 比 integrity_check 快，够发现「文件不是数据库」与页级损坏；
 * 发现异常就抛，由 open 走备份重建。空库返回 ok。
 */
export function quickCheckDatabase(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | null
  const value = row ? String(Object.values(row)[0] ?? '') : 'ok'
  if (value !== 'ok') throw new Error(`快照库完整性检查未通过：${value}`)
}

/** 关连接。已经关过不报错；关库失败也不该盖住调用方真正的错误，所以吞掉。 */
export function closeDatabase(db: DatabaseSync): void {
  try { db.close() } catch { /* 连接可能已经关闭 */ }
}

/** 库文件三件套：主文件、WAL、共享内存。重建与备份都必须按同一份清单处理。 */
export const DATABASE_FILE_SUFFIXES: readonly string[] = ['', '-wal', '-shm']

/** 删掉三件套（不存在的跳过）。整库重建与损坏清理共用。 */
export function removeDatabaseFiles(dbPath: string): void {
  for (const suffix of DATABASE_FILE_SUFFIXES) {
    rmSync(dbPath + suffix, { force: true })
  }
}

/**
 * 把三件套改名备份，返回备份后缀（时间戳）供诊断引用。先改名再删，比「先删再备份」
 * 多一层保险：改名失败会抛，调用方不会在没留下证据的情况下把坏库删掉。
 *
 * 时间戳用 ISO 但把冒号/点换成短横：Windows 文件名不允许冒号。
 */
export function backupDatabaseFiles(dbPath: string, nowMs: number): string {
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-')
  for (const suffix of DATABASE_FILE_SUFFIXES) {
    const from = dbPath + suffix
    if (!existsSync(from)) continue
    renameSync(from, `${dbPath}.corrupt-${stamp}${suffix}`)
  }
  return stamp
}
