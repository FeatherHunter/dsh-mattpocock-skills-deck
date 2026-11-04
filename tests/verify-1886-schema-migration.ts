// tests/verify-1886-schema-migration.ts —— 库结构升级走迁移而不是整库重建（#1886）
//
// 守什么：
//   ① 旧结构的库升级之后，票、组三态、合并版本都还在（不是重建出来的空库）；
//   ② 新结构真的可用：行上记「最后变化版本」、墓碑表达删除、票重新出现时墓碑被清掉；
//   ③ 库结构比本代码更新时才整库重建（不能拿旧代码去读新库）。
//
// 为什么用「造一个 v2 再把新东西拆掉」来得到 v1：手抄一份历史建表语句迟早会和真历史漂开；
// 反过来从当前结构里把本票新增的部分拆掉，得到的正是「上一版的形状」，而且不会过期。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1886-schema-migration.ts
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { printGateResult } from './lib/gate-result.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/runtime/open.js'
import { closeSnapshotLibraries } from '../src/refresh/rooms/host/snapshot-library.js'
import { initializeSchema, SNAPSHOT_SCHEMA_VERSION } from '../src/workspace-snapshot/persistence/schema.js'
import type { IssueWrite } from '../src/workspace-snapshot/contract/types.js'

const GATE = 'verify-1886-schema-migration'
let total = 0
let failed = 0
function check(ok: unknown, message: string, detail?: unknown): void {
  total += 1
  if (ok) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

const root = mkdtempSync(path.join(os.tmpdir(), 'verify-1886-'))
const dbPath = path.join(root, 'snapshot.sqlite')
const identity = { backend: 'github' as const, repoIdentity: 'acme/widgets', workspaceRoot: root }

function ticket(key: string, title: string): IssueWrite {
  return {
    effortId: '',
    key,
    groups: { row: { completeness: 'complete', value: { title, state: 'open', url: '', type: 'issue', createdAtMs: null, updatedAtMs: null, closedAtMs: null, stateReason: null, isPullRequest: false, commentCount: null, milestoneJson: null, customFieldsJson: null, status: null, statusVisible: null, statusSource: null, statusConflictJson: null } } },
  } as IssueWrite
}

function readRaw<T>(fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath)
  try { return fn(db) } finally { db.close() }
}

try {
  // ---- 造一个「上一版」的库：先按当前代码建库写一条，再把本票新增的东西拆掉 ----
  {
    const opened: any = await openWorkspaceSnapshot({ ...identity, dbPath, leaseOwner: 'gate-1886' })
    const h = opened.handle
    const first = h.ingest({ startMergeVersion: h.getMergeVersion(), writes: [ticket('1', '老票')] })
    check(first.committed === true, 'A1 先在当前结构上写一张票', first)
    h.close()
  }
  readRaw((db) => {
    db.exec('DROP TABLE issue_tombstone')
    db.exec('DROP INDEX issue_change_version')
    db.exec('ALTER TABLE issue DROP COLUMN last_change_version')
    db.exec('ALTER TABLE meta DROP COLUMN sync_watermark_ms')
    db.exec('ALTER TABLE meta DROP COLUMN sync_generation')
    db.exec('ALTER TABLE meta DROP COLUMN sync_pending_json')
    db.exec('ALTER TABLE meta DROP COLUMN full_enumeration_ms')
    db.exec('UPDATE meta SET schema_version = 1 WHERE id = 1')
    db.exec('PRAGMA user_version = 1')
  })
  check(readRaw((db) => Number((db.prepare('PRAGMA user_version').get() as any).user_version)) === 1, 'A2 造出的旧库自报版本 1')

  // ---- 升级：数据留着，结构补齐 ----
  const reopened: any = await openWorkspaceSnapshot({ ...identity, dbPath, leaseOwner: 'gate-1886' })
  const h = reopened.handle
  check(readRaw((db) => Number((db.prepare('PRAGMA user_version').get() as any).user_version)) === SNAPSHOT_SCHEMA_VERSION, 'B1 开库之后结构版本升到当前版本')
  const listAfter = h.readList({ state: 'all' })
  check(listAfter.issues.length === 1 && listAfter.issues[0].row.title === '老票', 'B2 升级没有清空数据：旧票原样在', listAfter.issues.map((i: any) => i.key))
  check(readRaw((db) => Number((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'issue_tombstone'").get() as any).n)) === 1, 'B3 墓碑表在升级后建好了')
  const versionAfterMigration = h.getMergeVersion()
  check(versionAfterMigration >= 1, 'B4 合并版本号没有被升级重置', versionAfterMigration)

  // ---- 新结构可用：写一把，行上记的变化版本等于新版本 ----
  const second = h.ingest({ startMergeVersion: h.getMergeVersion(), writes: [ticket('1', '老票（改过）')] })
  check(second.committed === true, 'C1 升级后的库照常接受写入', second)
  const changeVersion = readRaw((db) => Number((db.prepare('SELECT last_change_version AS v FROM issue WHERE key = ?').get('1') as any).v))
  check(changeVersion === h.getMergeVersion(), 'C2 行上的最后变化版本等于这次提交的版本', { changeVersion, version: h.getMergeVersion() })
  check(readRaw((db) => Number((db.prepare('SELECT COUNT(*) AS n FROM issue_group WHERE written_version > 0').get() as any).n)) > 0, 'C3 组上的写入版本也照常盖')

  // ---- 墓碑：确认不存在之后回放里没有它，行还在 ----
  const missing = h.markMissing([{ effortId: '', key: '1' }], h.getMergeVersion())
  check(missing.committed === true && missing.marked === 1, 'D1 墓碑写入成功', missing)
  check(h.readList({ state: 'all' }).issues.length === 0, 'D2 墓碑行不进出列表投影')
  check(readRaw((db) => Number((db.prepare('SELECT COUNT(*) AS n FROM issue WHERE key = ?').get('1') as any).n)) === 1, 'D3 行本身还在库里（不物理删）')
  check(h.markMissing([{ effortId: '', key: '1' }], h.getMergeVersion() - 5).reason === 'stale', 'D4 起读版本过期时墓碑整批丢弃')

  // ---- 复活：同号再写一次，墓碑被清掉、票回到列表 ----
  const revived = h.ingest({ startMergeVersion: h.getMergeVersion(), writes: [ticket('1', '老票（复活）')] })
  check(revived.committed === true, 'E1 同一张票再写一次', revived)
  check(h.readList({ state: 'all' }).issues.length === 1, 'E2 票重新回到列表投影')
  check(readRaw((db) => Number((db.prepare('SELECT COUNT(*) AS n FROM issue_tombstone').get() as any).n)) === 0, 'E3 墓碑被普通写入清掉了')

  // ---- 关库重开：墓碑与版本都还在 ----
  h.markMissing([{ effortId: '', key: '1' }], h.getMergeVersion())
  const before = h.getMergeVersion()
  h.close()
  const again: any = await openWorkspaceSnapshot({ ...identity, dbPath, leaseOwner: 'gate-1886' })
  check(again.handle.getMergeVersion() === before, 'F1 关库重开后版本还在', [before, again.handle.getMergeVersion()])
  check(again.handle.readList({ state: 'all' }).issues.length === 0, 'F2 关库重开后墓碑仍然生效')
  again.handle.close()

  // ---- 比本代码更新的库：只能整库重建，不能按旧结构读 ----
  readRaw((db) => db.exec('PRAGMA user_version = 99'))
  const newer: any = await openWorkspaceSnapshot({ ...identity, dbPath, leaseOwner: 'gate-1886' })
  check(newer.diagnostics.some((d: any) => String(d.code) === 'schema-reset'), 'G1 结构比本代码新时如实重建并落诊断', newer.diagnostics)
  check(newer.handle.readList({ state: 'all' }).issues.length === 0, 'G2 重建之后是空库（没有拿旧数据冒充）')
  newer.handle.close()
} finally {
  try { closeSnapshotLibraries() } catch { /* 句柄已经关了 */ }
  rmSync(root, { recursive: true, force: true })
}

console.log('')
console.log(failed === 0 ? '全部通过（' + total + ' 项）' : ('失败 ' + failed + ' / ' + total + ' 项'))
printGateResult(GATE, total, failed)
process.exit(failed === 0 ? 0 : 1)
