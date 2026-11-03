// runtime/ingest.ts —— 一批读结果在一个事务里落库。
//
// 写路径照规格第 5 节：
//   1. 事务外拿到调用方给的 startMergeVersion（它读数据时的版本）；
//   2. BEGIN IMMEDIATE 拿写锁，先做版本门：本批表达的组里任一 written_version 大于起点，
//      说明期间有别人先提交过，整批丢弃，库一个字节不改；
//   3. 按组合并（complete 覆盖/清空、truncated 只补缺、unknown 不动值），每组盖三态章；
//   4. merge_version + 1、last_write_ms 更新，COMMIT。失败整段 ROLLBACK。
//
// 为什么先版本门再合并：合并会改 written_version，先合并会让「自己写进去的版本」骗过门。
// 为什么每一组都盖章：三态存在 issue_group 而不是 issue 行上，没盖章的组下次会被当成
// 「从没取过」，界面就会把刚拿到的 truncated 当成不知道。
//
// 具体列的写法在 persistence/issue-row-write.ts 与 persistence/issue-groups-write.ts；
// 这里只负责事务、版本门、身份与盖章，方便一眼看清「一批要么全进、要么全不进」。
import type { DatabaseSync } from 'node:sqlite'
import type { GroupWrite, IssueWrite } from '../contract/types.js'
import { decideRowMerge } from '../merge/row.js'
import { normalizeStartMergeVersion, shouldDiscardBatch } from '../merge/version-gate.js'
import { applyIssueEdges } from '../persistence/issue-edge-write.js'
import { applyIssueAssignees, applyIssueLabels } from '../persistence/issue-groups-write.js'
import { ensureIssueId, findIssueId } from '../persistence/issue-identity-write.js'
import { fillIssueRow, replaceIssueRow } from '../persistence/issue-row-write.js'
import { readMergeVersion } from '../persistence/schema.js'

/** 五张组表的物理名字。组名是对外契约的一部分，不要在这里改成别的写法。 */
const GROUP_ROW = 'row'
const GROUP_LABELS = 'labels'
const GROUP_ASSIGNEES = 'assignees'
const GROUP_PARENTS = 'parents'
const GROUP_BLOCKED_BY = 'blockedBy'

/** 本批实际表达的组。没出现的组不参与版本门，也不盖章。 */
interface ExpressedGroup {
  write: IssueWrite
  group: 'row' | 'labels' | 'assignees' | 'parents' | 'blockedBy'
}

export interface IngestWritesResult {
  committed: boolean
  mergeVersion?: number
  reason?: 'stale' | 'write-failed'
  detail?: string
}

/**
 * 把一批写入落库。调用方负责判断句柄是否可写；这里只管事务。
 *
 * 空批（没有任何组表达）直接返回当前版本，不开事务：没有东西可写，bump 版本只会让
 * 别人的 startMergeVersion 提前过期。
 */
export function ingestWrites(
  db: DatabaseSync,
  writes: readonly IssueWrite[],
  rawStartMergeVersion: number,
  nowMs: number,
): IngestWritesResult {
  const startMergeVersion = normalizeStartMergeVersion(rawStartMergeVersion)
  const expressed = collectExpressedGroups(writes)
  if (expressed.length === 0) {
    return { committed: true, mergeVersion: readMergeVersion(db) }
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    const writtenVersions = expressed
      .map((item) => readGroupWrittenVersion(db, item))
      .filter((value): value is number => value !== null)
    if (shouldDiscardBatch(startMergeVersion, writtenVersions)) {
      db.exec('ROLLBACK')
      return { committed: false, reason: 'stale' }
    }

    const nextVersion = readMergeVersion(db) + 1
    for (const write of writes) applyIssueWrite(db, write, nowMs, nextVersion)
    db.prepare('UPDATE meta SET merge_version = ?, last_write_ms = ? WHERE id = 1')
      .run(nextVersion, nowMs)
    db.exec('COMMIT')
    return { committed: true, mergeVersion: nextVersion }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 事务可能已因约束错误自动回滚 */ }
    return {
      committed: false,
      reason: 'write-failed',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

/** 收集本批实际表达的组：只有 groups 里出现且不为 undefined 的才算。 */
function collectExpressedGroups(writes: readonly IssueWrite[]): ExpressedGroup[] {
  const out: ExpressedGroup[] = []
  for (const write of writes) {
    if (write.groups.row !== undefined) out.push({ write, group: 'row' })
    if (write.groups.labels !== undefined) out.push({ write, group: 'labels' })
    if (write.groups.assignees !== undefined) out.push({ write, group: 'assignees' })
    if (write.groups.parents !== undefined) out.push({ write, group: 'parents' })
    if (write.groups.blockedBy !== undefined) out.push({ write, group: 'blockedBy' })
  }
  return out
}

/** 读某张票某一组上次写入时的版本；票或组不存在返回 null（从来没写过，版本门不管）。 */
function readGroupWrittenVersion(db: DatabaseSync, item: ExpressedGroup): number | null {
  const row = db.prepare(
    `SELECT g.written_version AS written_version
       FROM issue i
       JOIN issue_group g ON g.issue_id = i.issue_id
      WHERE i.effort_id = ? AND i.key = ? AND g.group_name = ?`,
  ).get(item.write.effortId, item.write.key, item.group) as { written_version?: number } | null
  return row ? Number(row.written_version) : null
}

/** 落一张票表达的所有组。row 组 complete+null 是「确认不存在」，删掉后不再处理同批的其它组。 */
function applyIssueWrite(
  db: DatabaseSync,
  write: IssueWrite,
  nowMs: number,
  version: number,
): void {
  if (typeof write.effortId !== 'string') throw new Error('写入缺少 effortId')
  if (typeof write.key !== 'string' || write.key.length === 0) throw new Error('写入缺少 key')

  const { row, labels, assignees, parents, blockedBy } = write.groups
  if (row !== undefined) {
    const decision = decideRowMerge(null, row)
    if (decision.kind === 'remove') {
      const existingId = findIssueId(db, write.effortId, write.key)
      if (existingId !== null) db.prepare('DELETE FROM issue WHERE issue_id = ?').run(existingId)
      return
    }
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    if (decision.kind === 'replace') {
      replaceIssueRow(db, issueId, decision.value, nowMs)
    } else if (decision.kind === 'fill') {
      fillIssueRow(db, issueId, decision.value, nowMs)
    }
    stampGroup(db, issueId, GROUP_ROW, row, nowMs, version)
  }

  if (labels !== undefined) {
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    applyIssueLabels(db, issueId, labels)
    stampGroup(db, issueId, GROUP_LABELS, labels, nowMs, version)
  }

  if (assignees !== undefined) {
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    applyIssueAssignees(db, issueId, assignees)
    stampGroup(db, issueId, GROUP_ASSIGNEES, assignees, nowMs, version)
  }

  // 两组边：先保证 subject 自己有代理键，再把目标票解析成 id。骨架行也算「见过」。
  if (parents !== undefined) {
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    applyIssueEdges(db, issueId, write.effortId, 'parent', parents, nowMs)
    stampGroup(db, issueId, GROUP_PARENTS, parents, nowMs, version)
  }

  if (blockedBy !== undefined) {
    const issueId = ensureIssueId(db, write.effortId, write.key, nowMs)
    applyIssueEdges(db, issueId, write.effortId, 'blocks', blockedBy, nowMs)
    stampGroup(db, issueId, GROUP_BLOCKED_BY, blockedBy, nowMs, version)
  }
}

/**
 * 盖三态章。written_version 写本批的新版本：下一批只要起点比它小就会被版本门挡住。
 * last_queried_ms 用注入时钟，测试可以精确断言。
 */
function stampGroup(
  db: DatabaseSync,
  issueId: number,
  groupName: string,
  write: GroupWrite<unknown>,
  nowMs: number,
  version: number,
): void {
  db.prepare(
    `INSERT INTO issue_group (
       issue_id, group_name, completeness, reason, source, operation,
       last_queried_ms, written_version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(issue_id, group_name) DO UPDATE SET
       completeness = excluded.completeness,
       reason = excluded.reason,
       source = excluded.source,
       operation = excluded.operation,
       last_queried_ms = excluded.last_queried_ms,
       written_version = excluded.written_version`,
  ).run(
    issueId,
    groupName,
    write.completeness,
    write.reason ?? null,
    write.source ?? null,
    write.operation ?? null,
    nowMs,
    version,
  )
}

/** 给上层与门禁用：一张票一组都没表达时算空批。 */
export function batchHasExpressedGroups(writes: readonly IssueWrite[]): boolean {
  return collectExpressedGroups(writes).length > 0
}
