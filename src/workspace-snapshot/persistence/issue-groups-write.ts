// persistence/issue-groups-write.ts —— labels / assignees 两组落到成员表上。
//
// 合并决策在 merge/collection.ts（complete 整组替换、truncated 只补旧组没有的），
// 这一层只负责把决策写成 SQL 并维护 position。标签定义与参与者档案是元信息，
// truncated 时用 COALESCE 不覆盖旧值；成员关系才由 complete/truncated 决定。
import type { DatabaseSync } from 'node:sqlite'
import type { GroupWrite } from '../contract/types.js'
import type { SnapshotActor, SnapshotLabel } from '../model/types.js'
import { decideCollectionMerge } from '../merge/collection.js'
import { upsertActor } from './actor-write.js'

/**
 * 标签组。complete 整组替换、complete 空清空；truncated 只补旧组没有的标签。
 * 标签定义（颜色/说明）两种完整度都允许更新：它是元信息，不是成员关系。
 */
export function applyIssueLabels(
  db: DatabaseSync,
  issueId: number,
  write: GroupWrite<SnapshotLabel[] | null>,
): void {
  const existing = db.prepare(
    `SELECT l.name AS name, l.color AS color, l.description AS description
       FROM issue_label il JOIN label l ON l.name = il.label_name
      WHERE il.issue_id = ? ORDER BY il.position`,
  ).all(issueId) as Array<{ name: string, color: string | null, description: string | null }>
  const decision = decideCollectionMerge<SnapshotLabel>(
    existing.map((item) => ({ name: item.name, color: item.color, description: item.description })),
    write,
    (item) => item.name,
  )
  if (decision.kind === 'keep') return
  if (decision.kind === 'replace') {
    db.prepare('DELETE FROM issue_label WHERE issue_id = ?').run(issueId)
    decision.items.forEach((item, index) => {
      assertLabel(item)
      upsertLabelComplete(db, item)
      db.prepare(
        'INSERT INTO issue_label (issue_id, label_name, position) VALUES (?, ?, ?)',
      ).run(issueId, item.name, index)
    })
    return
  }
  let nextPosition = nextPositionOf(db, 'issue_label', issueId)
  for (const item of decision.items) {
    assertLabel(item)
    upsertLabelAppend(db, item)
    const result = db.prepare(
      'INSERT OR IGNORE INTO issue_label (issue_id, label_name, position) VALUES (?, ?, ?)',
    ).run(issueId, item.name, nextPosition)
    if (Number(result.changes) > 0) nextPosition += 1
  }
}

function assertLabel(item: SnapshotLabel): void {
  if (!item || typeof item.name !== 'string' || item.name.length === 0) {
    throw new Error('labels 写入里的标签缺少 name')
  }
}

function upsertLabelComplete(db: DatabaseSync, item: SnapshotLabel): void {
  db.prepare(
    `INSERT INTO label (name, color, description) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET color = excluded.color, description = excluded.description`,
  ).run(item.name, item.color ?? null, item.description ?? null)
}

function upsertLabelAppend(db: DatabaseSync, item: SnapshotLabel): void {
  db.prepare(
    `INSERT INTO label (name, color, description) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       color = COALESCE(excluded.color, label.color),
       description = COALESCE(excluded.description, label.description)`,
  ).run(item.name, item.color ?? null, item.description ?? null)
}

/**
 * 指派组。complete 整组替换；truncated 只补缺。参与人按登录名唯一，actor 行先 upsert
 * 再拿 actor_id；truncated 时不给的 kind/name/avatar 不覆盖旧值。
 */
export function applyIssueAssignees(
  db: DatabaseSync,
  issueId: number,
  write: GroupWrite<SnapshotActor[] | null>,
): void {
  const existing = db.prepare(
    `SELECT a.login AS login, a.kind AS kind, a.name AS name, a.avatar_url AS avatar_url
       FROM issue_assignee ia JOIN actor a ON a.actor_id = ia.actor_id
      WHERE ia.issue_id = ? ORDER BY ia.position`,
  ).all(issueId) as Array<{ login: string, kind: string | null, name: string | null, avatar_url: string | null }>
  const decision = decideCollectionMerge<SnapshotActor>(
    existing.map((item) => ({
      login: item.login,
      kind: item.kind,
      name: item.name,
      avatarUrl: item.avatar_url,
    })),
    write,
    (item) => item.login,
  )
  if (decision.kind === 'keep') return
  if (decision.kind === 'replace') {
    db.prepare('DELETE FROM issue_assignee WHERE issue_id = ?').run(issueId)
    decision.items.forEach((item, index) => {
      const actorId = upsertActor(db, item, true)
      db.prepare(
        'INSERT INTO issue_assignee (issue_id, actor_id, position) VALUES (?, ?, ?)',
      ).run(issueId, actorId, index)
    })
    return
  }
  let nextPosition = nextPositionOf(db, 'issue_assignee', issueId)
  for (const item of decision.items) {
    const actorId = upsertActor(db, item, false)
    const result = db.prepare(
      'INSERT OR IGNORE INTO issue_assignee (issue_id, actor_id, position) VALUES (?, ?, ?)',
    ).run(issueId, actorId, nextPosition)
    if (Number(result.changes) > 0) nextPosition += 1
  }
}

/** 下一批追加位置。空组从 0 开始。 */
function nextPositionOf(
  db: DatabaseSync,
  table: 'issue_label' | 'issue_assignee',
  issueId: number,
): number {
  const row = db.prepare(
    `SELECT COALESCE(MAX(position), -1) AS max_position FROM ${table} WHERE issue_id = ?`,
  ).get(issueId) as { max_position?: number } | null
  return Number(row?.max_position ?? -1) + 1
}
