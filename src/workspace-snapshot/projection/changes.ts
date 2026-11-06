// projection/changes.ts —— 变化集投影：从某个版本到现在，哪些行变了、哪些行被判不存在（#1890）
//
// 为什么单开一件：列表投影回答「现在有哪些票」，变化集回答「两个版本之间动了谁」。两件事共用
// 同一份行形状（projection/list.ts 的 LIST_ROW_COLUMNS 与 projectListRows），但筛选条件与
// 「超过上限回整份」的判据只属于变化集，混进列表会让两条读路径互相牵制。
//
// 五条约定：
//   1. 只回变化的行与被判不存在的行，不回整份；超过行数上限或客户端落后太久时 full 为真，
//      changes / missing 一律空数组 —— 绝不交回前 maxRows 行那种截断的变化集。
//   2. 墓碑行不进变化的行：同一张票同时被写过又被判不存在时，变化集只说它不在（missing），
//      不说它变了；两类各说各的，客户端才不会既画一行又删一行。
//   3. 排序显式给定（effort_id、key 升序）：投影是纯函数，同样的库两次读必须逐字相同（规格 I5）。
//   4. 时间只用于「落后太久就整份」这一档降级，不参与行筛选、不参与新旧判断（规格 I3）。
//      客户端没交 sinceMs 时这一档不参与判断，行数上限照旧。
//   5. 本层不读配置：maxRows / maxAgeMs 由调用方（宿主电话）从中央时间参数传进来。
import type { DatabaseSync } from 'node:sqlite'
import type {
  ChangeRowPlacement,
  ChangeSetChangedRow,
  ChangeSetProjection,
  ChangeSetQuery,
  ChangeSetTombstone,
  ListIssue,
} from '../model/types.js'
import { readMergeVersion } from '../persistence/schema.js'
import { withReadTransaction } from '../persistence/read-transaction.js'
import { readFirstParents, type FirstParentInfo } from './edges.js'
import { LIST_ROW_COLUMNS, projectListRows, type ListRow } from './list.js'
import { reportReadStep, type ReadStepHook } from './read-step.js'

interface TombstoneRow {
  effort_id: string
  key: string
  deleted_at_ms: number
}

/**
 * 读一次变化集。query.sinceVersion 是客户端手上的库版本；行数上限与时间上限取调用方给的数。
 *
 * 顺序有讲究：先判版本回退与无基线（这两档连查都不查），再判时间，最后才查变化行并判行数上限。
 * 这样「客户端版本比库里大」这种现场不会先被时间或行数误判成另一个原因。
 */
export function readChangeSetProjection(
  db: DatabaseSync,
  query: ChangeSetQuery,
  nowMs: number,
  onReadStep?: ReadStepHook | null,
): ChangeSetProjection {
  // 版本读数、变化行与墓碑必须在同一个读事务里：中间提交的一笔写会让「版本 8 的变化集」
  // 里混进第 9 版才写下的墓碑（理由见 persistence/read-transaction.ts）。
  return withReadTransaction(db, () => readChangeSetRows(db, query, nowMs, onReadStep))
}

/** 变化集投影在事务里的那一段；拆出来只为让事务边界一眼看得见，行为与拆分前逐字相同。 */
function readChangeSetRows(
  db: DatabaseSync,
  query: ChangeSetQuery,
  nowMs: number,
  onReadStep: ReadStepHook | null | undefined,
): ChangeSetProjection {
  const current = readMergeVersion(db)
  const since = query && typeof query.sinceVersion === 'number' ? query.sinceVersion : NaN
  const maxRows = positiveInteger(query && query.maxRows, 0)
  const maxAgeMs = nonNegativeInteger(query && query.maxAgeMs, 0)

  const base = { mergeVersion: current, generatedAtMs: nowMs, changes: [], missing: [] }

  // 没有可比对的起点：不猜一个 0 去当基线（拿 0 当基线会把整库都算成变化，那也是一种整份，
  // 但客户端并不知道自己该整份；这里如实说「没有基线」，让调用方走整份那一条路）。
  if (!Number.isInteger(since) || since < 0) {
    return { ...base, changes: [], full: true, reason: 'no-baseline' }
  }
  // 版本回退：客户端见过比库里更大的版本，说明文件被旧拷贝覆盖或库重建过（规格 §9）。
  // 这时候任何增量都是错的，只能整份重取并让客户端重置本地版本。
  if (since > current) {
    return { ...base, changes: [], full: true, reason: 'version-regressed' }
  }
  // 版本一样：没有变化，也不需要因为「旧」而整份 —— 没变就是没变，时间不参与新旧判断。
  if (since === current) {
    return { ...base, changes: [], full: false, reason: null }
  }
  // 时间上限：只认客户端交来的「看到这个版本的时刻」。没交（0）或时刻不合法时不参与判断；
  // 时刻在未来（时钟回拨）时按「刚看过」处理，不把一个负数当成落后。
  const sinceMs = nonNegativeInteger(query && query.sinceMs, 0)
  if (maxAgeMs > 0 && sinceMs > 0 && nowMs - sinceMs > maxAgeMs) {
    return { ...base, changes: [], full: true, reason: 'age-over-limit' }
  }

  // 多查一行用来判「有没有超上限」；超过就整份，不把这一行也交出去。
  // maxRows <= 0 表示调用方不设上限：SQLite 的 LIMIT -1 就是「不限」，别退回成 1 行。
  const probeLimit = maxRows > 0 ? maxRows + 1 : -1
  const changedRows = db.prepare(`
    SELECT ${LIST_ROW_COLUMNS}
      FROM issue i
      JOIN issue_group g ON g.issue_id = i.issue_id AND g.group_name = 'row'
      LEFT JOIN issue_tombstone t ON t.issue_id = i.issue_id
     WHERE i.last_change_version > ? AND t.issue_id IS NULL
     ORDER BY i.effort_id ASC, i.key ASC
     LIMIT ?`).all(since, probeLimit) as ListRow[]
  const tombstoneRows = db.prepare(`
    SELECT i.effort_id AS effort_id, i.key AS key, t.deleted_at_ms AS deleted_at_ms
      FROM issue_tombstone t
      JOIN issue i ON i.issue_id = t.issue_id
     WHERE t.version > ?
     ORDER BY i.effort_id ASC, i.key ASC
     LIMIT ?`).all(since, probeLimit) as TombstoneRow[]
  reportReadStep(onReadStep, 'changes-after-rows')

  if (maxRows > 0 && changedRows.length + tombstoneRows.length > maxRows) {
    return { ...base, changes: [], full: true, reason: 'rows-over-limit' }
  }

  const missing: ChangeSetTombstone[] = tombstoneRows.map((row) => ({
    effortId: row.effort_id,
    key: row.key,
    deletedAtMs: Number(row.deleted_at_ms),
  }))
  // #1885 评审修复：一行该落在哪由宿主算好（map / child / thin / issue），客户端只照单落位，
  // 不再按 parentKey 自己判容器归属。父票信息与列表投影读同一张边表、同一套「第一个父票」口径。
  const rows = projectListRows(db, changedRows)
  const parents = readFirstParents(db, changedRows.map((row) => Number(row.issue_id)))
  const changes: ChangeSetChangedRow[] = rows.map((row, index) => Object.assign({}, row, {
    placement: changePlacementOf(row, parents.get(Number(changedRows[index].issue_id)) || null),
  }))
  return {
    mergeVersion: current,
    generatedAtMs: nowMs,
    full: false,
    reason: null,
    changes,
    missing,
  }
}

/**
 * 这一行在界面上的落点（与 assembleSnapshot 的容器树同一口径）：
 *  - 自己就是地图/规格 → maps 里那一项；
 *  - 父票是地图/规格 → 挂到它下面；父容器已关闭且子票也关闭 → 只留瘦身行（首屏不画它）；
 *  - 其余（根票、破链票、父票不是容器）→ 未挂图票。
 */
function changePlacementOf(row: ListIssue, parent: FirstParentInfo | null): ChangeRowPlacement {
  const type = String(row.row.type === null || row.row.type === undefined ? '' : row.row.type)
  if (type === 'map' || type === 'spec') return { place: 'map' }
  if (parent && (parent.type === 'map' || parent.type === 'spec')) {
    const parentClosed = String(parent.state === null || parent.state === undefined ? '' : parent.state).toLowerCase() === 'closed'
    const rowClosed = String(row.row.state === null || row.row.state === undefined ? '' : row.row.state).toLowerCase() === 'closed'
    return parentClosed && rowClosed
      ? { place: 'thin', containerEffortId: parent.effortId, containerKey: parent.key }
      : { place: 'child', containerEffortId: parent.effortId, containerKey: parent.key }
  }
  return { place: 'issue' }
}

/** 正整数；不合法时回 fallback（调用方给 0 表示「这一档不设上限」）。 */
function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

/** 非负整数；不合法时回 fallback。 */
function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
}
