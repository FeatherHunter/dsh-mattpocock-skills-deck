// projection/edges.ts —— 边的一次批量读：父子关系（容器树）与阻塞关系（状态胶囊）。
//
// 为什么单独一份而不是塞进 list.ts：列表投影已经贴着 350 行上限，而且边是「引用」不是行字段，
// 形状与读法都不同——一次 IN 查询把一页票的边全读回来，避免每票一条（N+1）。
//
// 目标票可能是引用骨架（只有身份、没有标题/状态），所以标题给空串、状态缺省：
// 缺省表示「状态未知」，不是 open，消费方不得据此拦动作。
import type { DatabaseSync } from 'node:sqlite'
import type { ListIssueRef } from '../model/types.js'

export interface IssueEdges {
  parents: string[]
  blockedBy: ListIssueRef[]
}

/** 边表 kind 列取值。与 persistence/issue-edge-write.ts 的 EdgeKind 对齐。 */
const KIND_PARENT = 'parent'
const KIND_BLOCKS = 'blocks'

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
  ).all(...issueIds, KIND_PARENT, KIND_BLOCKS) as Array<{
    subject_id: number
    kind: string
    key: string
    title: string | null
    state: string | null
    type: string | null
  }>
  for (const row of rows) {
    const subjectId = Number(row.subject_id)
    const entry = out.get(subjectId) ?? { parents: [], blockedBy: [] }
    if (row.kind === KIND_PARENT) entry.parents.push(String(row.key))
    else entry.blockedBy.push(toRef(row))
    out.set(subjectId, entry)
  }
  return out
}

function toRef(row: {
  key: string
  title: string | null
  state: string | null
  type: string | null
}): ListIssueRef {
  const ref: ListIssueRef = { key: String(row.key), title: row.title ?? '' }
  const state = normalizeState(row.state)
  if (state) ref.state = state
  if (row.type) ref.type = row.type
  return ref
}

/** 只认两态；其它写法（大写、未知值）一律当「不知道」，不冒充 open。 */
function normalizeState(raw: string | null): 'open' | 'closed' | null {
  const value = String(raw ?? '').toLowerCase()
  if (value === 'open' || value === 'closed') return value
  return null
}
