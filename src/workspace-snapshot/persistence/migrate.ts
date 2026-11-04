// persistence/migrate.ts —— 库结构升级的显式迁移（#1886 起）。
//
// 为什么要有它：库是工作区数据的唯一真相，结构升级如果按「版本不符就整库重建」处理，
// 每次发版都会把本机数据清空一次——那正是「唯一真相」最不该承受的代价。所以从版本 2 起，
// 升级一律走这里的加列/建表语句；只有迁移本身失败、或者库结构比本代码更新，才回退到整库重建。
//
// 约定（改这里之前先读这三条）：
//   1. 每一版只往下走一步：MIGRATIONS[n] 把版本 n 的库改成版本 n+1 的形状。
//   2. 迁移只加不删：加列必须带默认值（SQLite 的 ADD COLUMN 不允许无默认的 NOT NULL）；
//      删列/改类型一律留给「整库重建」，不在这里做。
//   3. 整段在一个事务里：中途失败整段回滚，库仍停在旧版本，下一次开库会再试或走重建。
import type { DatabaseSync } from 'node:sqlite'

/** 每一版的结构增量。键是「从哪一版升」，值是升完之后的形状。 */
const MIGRATIONS: Record<number, readonly string[]> = {
  // 1 → 2（#1886）：版本号、行上的最后变化版本、墓碑、同步簿记三格与完整度标记。
  1: [
    'ALTER TABLE meta ADD COLUMN sync_watermark_ms INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE meta ADD COLUMN sync_generation INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE meta ADD COLUMN sync_pending_json TEXT',
    'ALTER TABLE meta ADD COLUMN full_enumeration_ms INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE issue ADD COLUMN last_change_version INTEGER NOT NULL DEFAULT 0',
    'CREATE INDEX issue_change_version ON issue(last_change_version)',
    `CREATE TABLE issue_tombstone (
      issue_id      INTEGER PRIMARY KEY REFERENCES issue(issue_id) ON DELETE CASCADE,
      version       INTEGER NOT NULL,
      deleted_at_ms INTEGER NOT NULL
    ) STRICT`,
    'CREATE INDEX tombstone_version ON issue_tombstone(version)',
  ],
}

/**
 * 把库从 fromVersion 一路迁到 toVersion。返回迁过的版本列表（从哪一版升到哪一版），
 * 已经是目标版本时回空数组。迁移失败会抛错，且库仍停在失败前的版本。
 */
export function migrateSchema(db: DatabaseSync, fromVersion: number, toVersion: number): number[] {
  if (!Number.isInteger(fromVersion) || !Number.isInteger(toVersion)) {
    throw new Error('migrateSchema 需要整数版本号')
  }
  if (fromVersion === toVersion) return []
  if (fromVersion > toVersion) throw new Error(`库结构版本 ${fromVersion} 比本代码更新，不能迁移`)
  const applied: number[] = []
  db.exec('BEGIN IMMEDIATE')
  try {
    for (let version = fromVersion; version < toVersion; version += 1) {
      const statements = MIGRATIONS[version]
      if (!statements) throw new Error(`缺少从版本 ${version} 起的迁移语句`)
      for (const statement of statements) db.exec(statement)
      applied.push(version)
    }
    db.exec(`PRAGMA user_version = ${toVersion}`)
    db.prepare('UPDATE meta SET schema_version = ? WHERE id = 1').run(toVersion)
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 事务可能已因错误自动回滚 */ }
    throw error
  }
  return applied
}
