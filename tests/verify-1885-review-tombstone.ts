/**
 * tests/verify-1885-review-tombstone.ts —— 删除只走墓碑，行不物理删（规格 #1885 §6 / 不变量 I7）
 *
 * 守什么（评审修复 A）：
 *  A 确认一张票不存在（row = complete + null）时，库里的行还在、列表投影里没有它、变化集把它当
 *    「删除」（missing）交出来——这正是以前缺的那一段：当时直接 DELETE 行，markMissing 在生产上
 *    又没人调，missing 恒为空。
 *  B 关库重开之后结论不变（墓碑与数据同一个库、同一个版本）。
 *  C 票重新出现时墓碑被清掉：列表里又有它、变化集不再说它不存在。
 *  D 另一条墓碑入口 markMissing 仍然可用（它不是这次修的主路径，但同一张表的写法要一致）。
 *
 * 为什么用真 SQLite：墓碑、版本号、关库重开这三件事都在库这一层；内存替身会把「行还在不在」
 * 这件事盖住。判断「行还在」用真文件查询（只读打开同一个 sqlite 文件数一行），不读私有结构。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1885-review-tombstone.ts
 */
// 门禁归属: src/workspace-snapshot/runtime/ingest.ts
// 门禁归属: src/workspace-snapshot/runtime/tombstone-write.ts
// 门禁归属: src/workspace-snapshot/projection/changes.ts
// 门禁归属: src/workspace-snapshot/projection/list.ts

import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { printGateResult } from './lib/gate-result.ts'
import type { Issue, RepositoryRef } from '../src/tracker/contract/entities.ts'
import { openWorkspaceSnapshot } from '../src/workspace-snapshot/contract/index.ts'
import type { WorkspaceSnapshotHandle } from '../src/workspace-snapshot/contract/types.ts'
import { issueWritesOf } from '../src/refresh/rooms/host/snapshot-library-adapter.ts'

const GATE = 'verify-1885-review-tombstone'
const REPO: RepositoryRef = {
  backend: 'github',
  refId: 'acme/tombstone',
  name: 'acme/tombstone',
  url: 'https://github.com/acme/tombstone',
}
let total = 0
let failed = 0
function check(cond: unknown, message: string, detail?: unknown): void {
  total += 1
  if (cond) { console.log('PASS ' + message); return }
  failed += 1
  console.log('FAIL ' + message + (detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'))
}

function issue(key: string, title: string): Issue {
  return {
    key: key,
    effortId: '',
    type: 'issue',
    title: title,
    state: 'open',
    body: '',
    url: 'https://github.com/acme/tombstone/issues/' + key,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    closedAt: null,
    parentKey: null,
    labels: [],
    assignees: [],
    blockedBy: [],
    isPullRequest: false,
  }
}

function keysIn(list: any): string[] {
  return (list && Array.isArray(list.issues) ? list.issues : []).map((row: any) => String(row.key))
}

function missingKeys(reply: any): string[] {
  return (reply && Array.isArray(reply.missing) ? reply.missing : []).map((row: any) => String(row.key))
}

function changedKeys(reply: any): string[] {
  return (reply && Array.isArray(reply.changes) ? reply.changes : []).map((row: any) => String(row.key))
}

/** 只读打开同一个库文件数一张票的行（验证「行还在」，不读私有投影）。 */
function rowCountOf(dbPath: string, key: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM issue WHERE effort_id = ? AND key = ?').get('', key) as { n: number }
    return Number(row.n)
  } finally {
    db.close()
  }
}

function tombstoneVersionOf(dbPath: string, key: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const row = db.prepare(
      `SELECT t.version AS version FROM issue_tombstone t JOIN issue i ON i.issue_id = t.issue_id
        WHERE i.effort_id = ? AND i.key = ?`,
    ).get('', key) as { version?: number } | undefined
    return row && row.version !== undefined ? Number(row.version) : -1
  } finally {
    db.close()
  }
}

function deleteWrite(key: string): any {
  return { effortId: '', key: key, groups: { row: { completeness: 'complete', value: null, source: 'gate', operation: 'list' } } }
}

const root = mkdtempSync(path.join(os.tmpdir(), 'verify-1885-tombstone-'))
const dbPath = path.join(root, 'snapshot.sqlite')
let clock = Date.parse('2026-11-05T00:00:00Z')
const now = (): number => clock

function open(): WorkspaceSnapshotHandle {
  const result = openWorkspaceSnapshot({
    workspaceRoot: root,
    backend: 'github',
    repoIdentity: REPO.refId,
    dbPath: dbPath,
    now: now,
    leaseOwner: 'gate-1885-tombstone-' + Math.random().toString(36).slice(2, 10),
  })
  return result.handle
}

try {
  let handle = open()
  const first = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes: issueWritesOf([issue('1', '一号'), issue('2', '二号')], 'github') })
  check(first.committed === true, 'A0 两张票先写进库', first)
  const beforeDelete = handle.getMergeVersion()
  const deleted = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes: [deleteWrite('1')] })
  check(deleted.committed === true && deleted.mergeVersion === beforeDelete + 1,
    'A1 确认不存在的一笔提交成功，库版本往前走一格', { beforeDelete, deleted })

  check(rowCountOf(dbPath, '1') === 1, 'A2 行没有被物理删掉（库里仍然数得到这张票）')
  const listAfter = handle.readList({ state: 'all' })
  check(keysIn(listAfter).join(',') === '2', 'A3 列表投影里没有它了（墓碑把它排除在集合外）', keysIn(listAfter))
  const changesAfter = handle.readChangeSet({ sinceVersion: beforeDelete, maxRows: 100, maxAgeMs: 0 })
  check(changesAfter.full === false && missingKeys(changesAfter).join(',') === '1',
    'A4 变化集把它当「删除」交出来（missing 有它）', { missing: missingKeys(changesAfter), changes: changedKeys(changesAfter) })
  check(changedKeys(changesAfter).indexOf('1') < 0, 'A5 同一张票不同时出现在「变了」与「删了」两处')
  check(tombstoneVersionOf(dbPath, '1') === deleted.mergeVersion, 'A6 墓碑记的版本就是这一笔的版本', tombstoneVersionOf(dbPath, '1'))

  // B 关库重开：行、墓碑、列表都还是同一份
  handle.close()
  handle = open()
  check(rowCountOf(dbPath, '1') === 1, 'B1 关库重开之后行仍然在库里')
  check(keysIn(handle.readList({ state: 'all' })).join(',') === '2', 'B2 关库重开之后列表里仍然没有它')
  const changesAfterReopen = handle.readChangeSet({ sinceVersion: beforeDelete, maxRows: 100, maxAgeMs: 0 })
  check(missingKeys(changesAfterReopen).join(',') === '1', 'B3 关库重开之后变化集仍然把它当删除', missingKeys(changesAfterReopen))
  const reopenedVersion = handle.getMergeVersion()
  check(reopenedVersion === deleted.mergeVersion, 'B4 关库重开之后版本没有回退', { reopenedVersion, want: deleted.mergeVersion })

  // C 票重新出现：普通写入清墓碑
  // #1931：重新出现的这一笔要带一个更晚的 updatedAt —— 读结果的行组只在「严格更新」时才覆盖，
  // 同一时刻的重写会被跳过，墓碑也就清不掉（那是「没变」，不是「没回来」）。
  const reappearedIssue = Object.assign(issue('1', '一号（回来了）'), { updatedAt: '2026-11-02T00:00:00Z' })
  const reappeared = handle.ingest({ startMergeVersion: handle.getMergeVersion(), writes: issueWritesOf([reappearedIssue], 'github') })
  check(reappeared.committed === true, 'C0 重新出现的普通写入提交成功', reappeared)
  check(keysIn(handle.readList({ state: 'all' })).join(',') === '1,2', 'C1 列表里又有它了（按票号顺序）', keysIn(handle.readList({ state: 'all' })))
  check(tombstoneVersionOf(dbPath, '1') === -1, 'C2 墓碑被清掉了（不是永久判决）')
  const changesReappeared = handle.readChangeSet({ sinceVersion: reappeared.mergeVersion, maxRows: 100, maxAgeMs: 0 })
  check(missingKeys(changesReappeared).length === 0, 'C3 变化集不再说它不存在', missingKeys(changesReappeared))
  const changesFromBeforeReappear = handle.readChangeSet({ sinceVersion: reopenedVersion, maxRows: 100, maxAgeMs: 0 })
  check(changedKeys(changesFromBeforeReappear).indexOf('1') >= 0 && missingKeys(changesFromBeforeReappear).indexOf('1') < 0,
    'C4 重新出现的那一笔在变化集里算「变了」，不算「删了」', { changes: changedKeys(changesFromBeforeReappear), missing: missingKeys(changesFromBeforeReappear) })

  // D 另一条墓碑入口 markMissing 仍然可用
  const markVersion = handle.getMergeVersion()
  const marked = handle.markMissing([{ effortId: '', key: '2' }], markVersion)
  check(marked.committed === true && marked.marked === 1 && marked.mergeVersion === markVersion + 1,
    'D1 markMissing 仍然把「不在了」写进墓碑并推进版本', marked)
  check(keysIn(handle.readList({ state: 'all' })).join(',') === '1', 'D2 markMissing 之后列表里也没有二号了')
  const changesMarked = handle.readChangeSet({ sinceVersion: markVersion, maxRows: 100, maxAgeMs: 0 })
  check(missingKeys(changesMarked).join(',') === '2', 'D3 变化集同样把它当删除交出来', missingKeys(changesMarked))

  handle.close()
  console.log('')
  if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
  else console.log('OK：' + total + ' 条断言全部通过')
  printGateResult(GATE, total, failed)
  process.exit(failed ? 1 : 0)
} catch (e: any) {
  console.log('FAIL 门禁异常退出：' + ((e && e.stack) || e))
  printGateResult(GATE, total, failed + 1)
  process.exit(1)
} finally {
  try { rmSync(root, { recursive: true, force: true }) } catch { /* 已删 */ }
}
