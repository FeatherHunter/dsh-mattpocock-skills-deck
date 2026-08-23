/**
 * backends/gitlab/normalize.js — GitLab 原始形状 → 契约形状。
 *
 * ⌈ 骨架占位 ⌉ #116 实现：把 glab 返回扁平化成契约形状，按 EMPTY/MISSING 规则填空。
 */

import { STATE, ISSUE_TYPE } from '../../../../shared/tracker/constants.js'

export function normalizeIssue(raw) {
  // OPEN-DECISION §6.2：双主键（key=String(iid) + number=iid）是草案，待 #127 定夺。
  return {
    key: String(raw.iid ?? raw.number ?? ''),
    number: raw.iid ?? raw.number ?? null,
    type: ISSUE_TYPE.ISSUE,
    title: raw.title || '',
    state: String(raw.state).toLowerCase() === 'closed' ? STATE.CLOSED : STATE.OPEN,
    body: raw.description || raw.body || '',
    url: raw.web_url || '',
    labels: Array.isArray(raw.labels) ? raw.labels.map((l) => (typeof l === 'string' ? { name: l, color: '' } : { name: l.name, color: l.color || '' })) : [],
    // INTENTIONALLY-EMPTY：#116 未接线，刻意 EMPTY
    assignees: [],
    comments: [],
    subIssues: [],
    blockedBy: [],
    blocking: [],
    createdAt: raw.created_at || '',
    updatedAt: raw.updated_at || '',
    closedAt: raw.closed_at || null,
    parentKey: null,
  }
}
export default normalizeIssue
