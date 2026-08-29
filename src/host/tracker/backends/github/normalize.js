/**
 * backends/github/normalize.js — GitHub 原始形状 → 契约标准形状。
 *
 * 定版依据：#126（Label 形状与 EMPTY/MISSING）+#127（单 key/无 number/无 subIssues/树边=parentKey+tickets）
 * +#124（setLabels/create labels 富输入）+#138 一页纸方案（形状归一不变量）
 *
 * 不变量（第一性推导）：
 *  - 单 key：`Issue.key: string = String(raw.number)`，永不产出 `number` 字段（harness 断言 no number）。
 *  - 无 `subIssues`/`blocking`：树边 = `parentKey` 向上 + `MapNode.tickets` 向下；`blocking` 仅 `getDependencies` 投影。
 *  - GitHub 原生支持 labels/assignees/comments/blockedBy/reason → 恒 EMPTY（[]/'' 非 MISSING），capability-by-fill。
 *  - `Label = { name: string; color: string; description?: string }`，color 无则 ''，description 仅非空携带。
 *  - `parentKey: string|null` 核心字段永远存在；子票只认原生 parent（忽略 task list）。
 */

import { STATE, ISSUE_TYPE } from '../../../../shared/tracker/constants.js'

function normalizeLabel(rawLabel) {
  if (typeof rawLabel === 'string') {
    const name = rawLabel.trim()
    if (!name) return null
    return { name, color: '' }
  }
  if (!rawLabel || typeof rawLabel !== 'object') return null
  const name = typeof rawLabel.name === 'string' ? rawLabel.name.trim() : ''
  if (!name) return null
  const color = typeof rawLabel.color === 'string' ? rawLabel.color : ''
  const out = { name, color }
  if (typeof rawLabel.description === 'string' && rawLabel.description.trim() !== '') {
    out.description = rawLabel.description
  }
  return out
}

function normalizeLabels(raw) {
  let nodes = null
  if (raw && raw.labels && Array.isArray(raw.labels.nodes)) nodes = raw.labels.nodes
  else if (Array.isArray(raw && raw.labels)) nodes = raw.labels
  else if (Array.isArray(raw)) nodes = raw
  else return [] // 无来源 → EMPTY（GitHub 恒可实现）
  const out = []
  for (const n of nodes) {
    const l = normalizeLabel(n)
    if (l) out.push(l)
  }
  return out
}

function kindFromTypename(t) {
  const s = String(t || '').toLowerCase()
  if (s === 'bot') return 'bot'
  if (s === 'organization') return 'organization'
  return 'user'
}

function normalizeActor(raw) {
  if (!raw || typeof raw !== 'object') return null
  const login = typeof raw.login === 'string' ? raw.login.trim() : ''
  if (!login) return null
  const out = { login }
  const kind = raw.__typename ? kindFromTypename(raw.__typename) : (raw.kind ? String(raw.kind) : undefined)
  if (kind) out.kind = kind
  if (typeof raw.name === 'string' && raw.name.trim() !== '') out.name = raw.name
  if (typeof raw.avatarUrl === 'string' && raw.avatarUrl !== '') out.avatarUrl = raw.avatarUrl
  else if (typeof raw.avatar_url === 'string' && raw.avatar_url !== '') out.avatarUrl = raw.avatar_url
  return out
}

function normalizeAssignees(raw) {
  let nodes = null
  if (raw && raw.assignees && Array.isArray(raw.assignees.nodes)) nodes = raw.assignees.nodes
  else if (Array.isArray(raw && raw.assignees)) nodes = raw.assignees
  else if (raw && Array.isArray(raw.nodes)) nodes = raw.nodes
  else return [] // GitHub 恒实现 → EMPTY
  const out = []
  for (const n of nodes) {
    const a = normalizeActor(n)
    if (a) out.push(a)
  }
  return out
}

function deriveKey(raw) {
  if (raw == null) return '0'
  if (typeof raw.key === 'string' && raw.key !== '') return raw.key
  if (raw.number != null) return String(raw.number)
  if (raw.id != null) return String(raw.id)
  return '0'
}

function deriveType(raw) {
  const labels = normalizeLabels(raw)
  if (labels.some((l) => l.name === 'wayfinder:map')) return ISSUE_TYPE.MAP
  if (raw && (raw.isMap === true || raw.type === 'map')) return ISSUE_TYPE.MAP
  return ISSUE_TYPE.ISSUE
}

function deriveParentKey(raw) {
  if (!raw) return null
  if (typeof raw.parentKey === 'string') return raw.parentKey
  if (raw.parentKey === null) return null
  if (raw.parent && raw.parent.number != null) return String(raw.parent.number)
  if (raw.parent && typeof raw.parent.key === 'string') return raw.parent.key
  return null
}

function normalizeMilestone(raw) {
  const src = raw && raw.milestone
  if (!src || typeof src !== 'object') return undefined
  const title = typeof src.title === 'string' ? src.title.trim() : ''
  if (!title) return undefined
  const out = { name: title }
  if (typeof src.description === 'string' && src.description.trim() !== '') out.description = src.description
  if (typeof src.state === 'string') {
    const s = src.state.toLowerCase()
    if (s === 'open' || s === 'closed') out.state = s
  }
  if (typeof src.dueOn === 'string' && src.dueOn !== '') out.dueOn = src.dueOn
  else if (typeof src.due_on === 'string' && src.due_on !== '') out.dueOn = src.due_on
  else out.dueOn = null
  return out
}

function normalizeComments(raw) {
  let nodes = null
  if (raw && raw.comments && Array.isArray(raw.comments.nodes)) nodes = raw.comments.nodes
  else if (Array.isArray(raw && raw.comments)) nodes = raw.comments
  else return [] // 恒实现 → EMPTY
  const out = []
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    const body = typeof n.body === 'string' ? n.body : ''
    const author = normalizeActor(n.author || n.user) || { login: '' }
    const association = typeof n.authorAssociation === 'string' ? n.authorAssociation : (typeof n.author_association === 'string' ? n.author_association : '')
    const c = {
      author,
      authorAssociation: association,
      body,
      createdAt: typeof n.createdAt === 'string' ? n.createdAt : (typeof n.created_at === 'string' ? n.created_at : ''),
      updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : (typeof n.updated_at === 'string' ? n.updated_at : ''),
    }
    if (typeof n.id === 'string' || typeof n.id === 'number') c.id = String(n.id)
    if (typeof n.editedAt === 'string' || n.editedAt === null) c.editedAt = n.editedAt
    else if (typeof n.lastEditedAt === 'string' || n.lastEditedAt === null) c.editedAt = n.lastEditedAt
    else if (typeof n.edited_at === 'string' || n.edited_at === null) c.editedAt = n.edited_at
    else if (typeof n.last_edited_at === 'string' || n.last_edited_at === null) c.editedAt = n.last_edited_at
    out.push(c)
  }
  return out
}

function normalizeBlockedBy(raw) {
  let nodes = null
  if (raw && raw.blockedBy && Array.isArray(raw.blockedBy.nodes)) nodes = raw.blockedBy.nodes
  else if (raw && raw.blocked_by && Array.isArray(raw.blocked_by)) nodes = raw.blocked_by
  else if (Array.isArray(raw && raw.blockedBy)) nodes = raw.blockedBy
  else return [] // 恒实现 → EMPTY
  const out = []
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    const k = n.number != null ? String(n.number) : (typeof n.key === 'string' ? n.key : '')
    if (!k) continue
    const title = typeof n.title === 'string' ? n.title : ''
    const stateRaw = n.state != null ? String(n.state).toLowerCase() : 'open'
    const state = stateRaw === 'closed' ? STATE.CLOSED : STATE.OPEN
    const ref = { key: k, title, state }
    // type 可选，若来源有 wayfinder:map label 可推断
    if (n.type === 'map' || n.type === 'issue') ref.type = n.type
    out.push(ref)
  }
  return out
}

/**
 * @param {Object} raw GitHub issue 原始对象（GraphQL issue 或 REST issue，或测试桩）
 * @returns {import('../../../../shared/tracker/shape.js').Issue}
 */
export function normalizeIssue(raw) {
  const key = deriveKey(raw)
  const type = deriveType(raw)
  const stateRaw = raw && raw.state != null ? String(raw.state).toLowerCase() : 'open'
  const state = stateRaw === 'closed' ? STATE.CLOSED : STATE.OPEN
  const labels = normalizeLabels(raw)
  const assignees = normalizeAssignees(raw)
  const comments = normalizeComments(raw)
  const blockedBy = normalizeBlockedBy(raw)
  const parentKey = deriveParentKey(raw)

  // 基础核心字段（永远存在）
  const issue = {
    key,
    type,
    title: raw && typeof raw.title === 'string' ? raw.title : '',
    state,
    body: raw && typeof raw.body === 'string' ? raw.body : '',
    url: raw && typeof raw.url === 'string' ? raw.url : (typeof raw.html_url === 'string' ? raw.html_url : ''),
    createdAt: raw && typeof raw.createdAt === 'string' ? raw.createdAt : (typeof raw.created_at === 'string' ? raw.created_at : ''),
    updatedAt: raw && typeof raw.updatedAt === 'string' ? raw.updatedAt : (typeof raw.updated_at === 'string' ? raw.updated_at : ''),
    closedAt: raw && (typeof raw.closedAt === 'string' || raw.closedAt === null) ? raw.closedAt : (raw && (typeof raw.closed_at === 'string' || raw.closed_at === null) ? raw.closed_at : null),
    parentKey,
    labels,
    assignees,
    comments,
    blockedBy,
    // reason：GitHub 支持 closedReason，open 也输出 ''(EMPTY)
    reason: raw && typeof raw.reason === 'string' ? raw.reason : (raw && typeof raw.stateReason === 'string' ? raw.stateReason : ''),
  }

  // 能力字段：author（有则给对象，无则 MISSING → 省略）
  const authorRaw = raw && (raw.author || raw.user)
  const author = normalizeActor(authorRaw)
  if (author) issue.author = author

  // milestone：有则给对象，无则 MISSING（省略）
  const milestone = normalizeMilestone(raw)
  if (milestone) issue.milestone = milestone

  // customFields：GitHub 无结构化字段 → 始终 MISSING（省略）
  // 不产出 customFields

  return issue
}

export default normalizeIssue
