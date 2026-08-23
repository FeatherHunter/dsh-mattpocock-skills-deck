/**
 * backends/github/normalize.js — GitHub 原始形状 → 契约标准形状。
 *
 * ⌈ 骨架占位 ⌉ #114 实现：把 gh/GraphQL 返回的 `labels.nodes`/`assignees.nodes`/
 * `blockedBy.nodes` 扁平化成契约形状，并按 EMPTY/MISSING 规则填空（见 contract.js）。
 */

import { STATE, ISSUE_TYPE } from '../../../../shared/tracker/constants.js'

/**
 * @param {Object} raw GitHub issue 原始对象
 * @returns {import('../../../../shared/tracker/shape.js').Issue}
 */
export function normalizeIssue(raw) {
  // OPEN-DECISION §6.2：双主键（key=String(number) + number）是草案，待 #127 定夺，勿当不变量。
  const labels = Array.isArray(raw && raw.labels && raw.labels.nodes)
    ? raw.labels.nodes.map((l) => ({ name: l.name, color: l.color || '' }))
    : (Array.isArray(raw && raw.labels) ? raw.labels.map((l) => ({ name: l.name, color: l.color || '' })) : [])
  // INTENTIONALLY-EMPTY：以下几项本后端能映射，但 #114 尚未接线，故刻意 EMPTY（[]/''/null），非 MISSING。
  // 待 #114 真映射到 assignees.nodes/comments/subIssues.nodes/blockedBy.nodes，勿当作已完成。
  return {
    key: String(raw.number),
    number: raw.number ?? null,
    type: raw.isMap ? ISSUE_TYPE.MAP : ISSUE_TYPE.ISSUE,
    title: raw.title || '',
    state: String(raw.state).toLowerCase() === 'closed' ? STATE.CLOSED : STATE.OPEN,
    body: raw.body || '',
    url: raw.url || '',
    labels,
    assignees: [],
    comments: [],
    subIssues: [],
    blockedBy: [],
    blocking: [],
    createdAt: raw.createdAt || '',
    updatedAt: raw.updatedAt || '',
    closedAt: raw.closedAt || null,
    parentKey: raw.parentKey || null,
  }
}

export default normalizeIssue
