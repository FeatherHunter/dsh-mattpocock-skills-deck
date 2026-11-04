// projection/edges.ts —— 边的一次批量读：父子关系（容器树）与阻塞关系（状态胶囊）。
//
// 为什么单独一份而不是塞进 list.ts：边是「引用」不是行字段，形状与读法都不同——一次 IN 查询
// 把一页票的边全读回来，避免每票一条（N+1）。详情读的那四个方向也在这里，因为它们与列表
// 读的是同一张边表：三个方向必须从同一份数据得出，不能各存一份、各算一遍。
//
// 目标票可能是引用骨架（只有身份、没有标题/状态），所以标题给空串、状态缺省：
// 缺省表示「状态未知」，不是 open，消费方不得据此拦动作。
import type { DatabaseSync } from 'node:sqlite'
import type { ListIssueRef } from '../model/types.js'
import { normalizeState } from './members.js'

export interface IssueEdges {
  parents: string[]
  blockedBy: ListIssueRef[]
}

/**
 * 一张票的四个方向。前两个是「这张票自己表达的组」（边从这张票出发），
 * 后两个是同一张边表的反向查询（谁把这张票当父票、谁被这张票阻塞）。
 */
export interface IssueDetailEdges {
  parents: ListIssueRef[]
  blockedBy: ListIssueRef[]
  blocking: ListIssueRef[]
  children: ListIssueRef[]
}

/** 边表 kind 列取值。与 persistence/issue-edge-write.ts 的 EdgeKind 对齐。 */
const KIND_PARENT = 'parent'
const KIND_BLOCKS = 'blocks'

interface EdgeRow {
  key: string
  title: string | null
  state: string | null
  type: string | null
}

/** 读一页票的边。没有边的票不出现在 Map 里，调用方按空数组兜底。 */
export function readIssueEdges(
  db: DatabaseSync,
  issueIds: readonly number[],
): Map<number, IssueEdges> {
  const out = new Map<number, IssueEdges>()
  if (issueIds.length === 0) return out
  const placeholders = issueIds.map(() => '?').join(', ')
  const rows = db.prepare(
    `SELECT e.subject_id AS subject_id, e.kind AS kind,
            i.key AS key, i.title AS title, i.state AS state, i.type AS type
       FROM issue_edge e
       JOIN issue i ON i.issue_id = e.object_id
      WHERE e.subject_id IN (${placeholders}) AND e.kind IN (?, ?)
      ORDER BY e.subject_id, e.kind, e.object_id`,
  ).all(...issueIds, KIND_PARENT, KIND_BLOCKS) as Array<EdgeRow & { subject_id: number, kind: string }>
  for (const row of rows) {
    const subjectId = Number(row.subject_id)
    const entry = out.get(subjectId) ?? { parents: [], blockedBy: [] }
    if (row.kind === KIND_PARENT) entry.parents.push(String(row.key))
    else entry.blockedBy.push(toRef(row))
    out.set(subjectId, entry)
  }
  return out
}

/**
 * 读一张票的四个方向。
 *
 * 正向两个方向（父票、谁阻塞我）就是这张票自己写的边；反向两个方向（子票、我阻塞了谁）
 * 是同一条边的另一头。四个方向读同一张表，所以不会出现「列表说有父票、详情说没有」。
 * 排序按目标票的代理键（写入顺序），同一份库每次读出来顺序稳定。
 */
export function readIssueDetailEdges(db: DatabaseSync, issueId: number): IssueDetailEdges {
  const out: IssueDetailEdges = { parents: [], blockedBy: [], blocking: [], children: [] }
  const outgoing = db.prepare(
    `SELECT e.kind AS kind, i.key AS key, i.title AS title, i.state AS state, i.type AS type
       FROM issue_edge e
       JOIN issue i ON i.issue_id = e.object_id
      WHERE e.subject_id = ? AND e.kind IN (?, ?)
      ORDER BY e.object_id`,
  ).all(issueId, KIND_PARENT, KIND_BLOCKS) as Array<EdgeRow & { kind: string }>
  for (const row of outgoing) {
    if (row.kind === KIND_PARENT) out.parents.push(toRef(row))
    else out.blockedBy.push(toRef(row))
  }
  const incoming = db.prepare(
    `SELECT e.kind AS kind, i.key AS key, i.title AS title, i.state AS state, i.type AS type
       FROM issue_edge e
       JOIN issue i ON i.issue_id = e.subject_id
      WHERE e.object_id = ? AND e.kind IN (?, ?)
      ORDER BY e.subject_id`,
  ).all(issueId, KIND_PARENT, KIND_BLOCKS) as Array<EdgeRow & { kind: string }>
  for (const row of incoming) {
    if (row.kind === KIND_PARENT) out.children.push(toRef(row))
    else out.blocking.push(toRef(row))
  }
  return out
}

function toRef(row: EdgeRow): ListIssueRef {
  const ref: ListIssueRef = { key: String(row.key), title: row.title ?? '' }
  const state = normalizeState(row.state)
  if (state) ref.state = state
  if (row.type) ref.type = row.type
  return ref
}
