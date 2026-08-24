/**
 * examples/demo-mini/normalize.js — demo-mini 归一化（对齐 shared/tracker/shape.js 与 capability-by-fill）
 *
 * 定版依据：#147 7 行（ops 4 项 + matches + describe 托管 + 强验证）
 * - 核心字段（key/type/title/state/body/url/createdAt/updatedAt/closedAt/parentKey）永远存在
 * - 能力字段：labels/assignees/comments/blockedBy/reason 为演示能力（EMPTY=[]/''），
 *   author/milestone/customFields 为 MISSING（省略），与 harness 对齐
 * - 单 key、无 number/subIssues/blocking（blocking 仅 getDependencies 投影）
 */

import { STATE, ISSUE_TYPE } from '../../src/shared/tracker/constants.js'

function normalizeLabel(raw) {
  if (typeof raw === 'string') {
    const name = raw.trim()
    if (!name) return null
    return { name, color: '' }
  }
  if (!raw || typeof raw !== 'object') return null
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) return null
  const color = typeof raw.color === 'string' ? raw.color : ''
  const out = { name, color }
  if (typeof raw.description === 'string' && raw.description.trim() !== '') out.description = raw.description
  return out
}

function normalizeActor(raw) {
  if (typeof raw === 'string') {
    const login = raw.trim()
    if (!login) return null
    return { login, kind: 'user' }
  }
  if (!raw || typeof raw !== 'object') return null
  const login = typeof raw.login === 'string' ? raw.login.trim() : ''
  if (!login) return null
  const out = { login }
  if (typeof raw.kind === 'string') out.kind = raw.kind
  else if (typeof raw.__typename === 'string') {
    const t = raw.__typename.toLowerCase()
    out.kind = t === 'bot' ? 'bot' : t === 'organization' ? 'organization' : 'user'
  }
  if (typeof raw.name === 'string' && raw.name.trim() !== '') out.name = raw.name
  if (typeof raw.avatarUrl === 'string' && raw.avatarUrl !== '') out.avatarUrl = raw.avatarUrl
  else if (typeof raw.avatar_url === 'string' && raw.avatar_url !== '') out.avatarUrl = raw.avatar_url
  return out
}

export function normalizeIssue(raw) {
  const key = String(raw.key ?? raw.id ?? raw.number ?? '0')
  const type = raw.type === 'map' || raw.isMap === true ? ISSUE_TYPE.MAP : ISSUE_TYPE.ISSUE
  const stateRaw = raw.state != null ? String(raw.state).toLowerCase() : 'open'
  const state = stateRaw === 'closed' ? STATE.CLOSED : STATE.OPEN

  // labels：恒为数组，空→[]
  let labels = []
  if (Array.isArray(raw.labels)) {
    labels = raw.labels.map(normalizeLabel).filter(Boolean)
  } else if (raw.labels && Array.isArray(raw.labels.nodes)) {
    labels = raw.labels.nodes.map(normalizeLabel).filter(Boolean)
  }

  // assignees：恒为数组
  let assignees = []
  if (Array.isArray(raw.assignees)) {
    assignees = raw.assignees.map(normalizeActor).filter(Boolean)
  } else if (raw.assignee) {
    const a = normalizeActor(raw.assignee)
    if (a) assignees = [a]
  } else if (raw.assignees && Array.isArray(raw.assignees.nodes)) {
    assignees = raw.assignees.nodes.map(normalizeActor).filter(Boolean)
  }

  // comments：恒为数组
  let comments = []
  if (Array.isArray(raw.comments)) {
    for (const n of raw.comments) {
      if (!n || typeof n !== 'object') continue
      const body = typeof n.body === 'string' ? n.body : ''
      const author = normalizeActor(n.author || n.user) || { login: '' }
      const c = {
        author,
        authorAssociation: typeof n.authorAssociation === 'string' ? n.authorAssociation : '',
        body,
        createdAt: typeof n.createdAt === 'string' ? n.createdAt : (typeof n.created_at === 'string' ? n.created_at : ''),
        updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : (typeof n.updated_at === 'string' ? n.updated_at : ''),
      }
      if (typeof n.id === 'string' || typeof n.id === 'number') c.id = String(n.id)
      comments.push(c)
    }
  } else if (raw.comments && Array.isArray(raw.comments.nodes)) {
    for (const n of raw.comments.nodes) {
      const body = typeof n.body === 'string' ? n.body : ''
      const author = normalizeActor(n.author) || { login: '' }
      comments.push({
        author,
        authorAssociation: typeof n.authorAssociation === 'string' ? n.authorAssociation : '',
        body,
        createdAt: typeof n.createdAt === 'string' ? n.createdAt : '',
        updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : '',
        id: n.id != null ? String(n.id) : undefined,
      })
    }
  }

  // blockedBy：恒为数组，IssueRef 轻量引用
  let blockedBy = []
  if (Array.isArray(raw.blockedBy)) {
    for (const n of raw.blockedBy) {
      if (!n || typeof n !== 'object') {
        if (typeof n === 'string' && n) blockedBy.push({ key: n, title: '', state: STATE.OPEN })
        continue
      }
      const k = n.key != null ? String(n.key) : (n.number != null ? String(n.number) : '')
      if (!k) continue
      const title = typeof n.title === 'string' ? n.title : ''
      const s = String(n.state || 'open').toLowerCase() === 'closed' ? STATE.CLOSED : STATE.OPEN
      const ref = { key: k, title, state: s }
      if (n.type === 'map' || n.type === 'issue') ref.type = n.type
      blockedBy.push(ref)
    }
  } else if (raw.blocked_by && Array.isArray(raw.blocked_by)) {
    for (const n of raw.blocked_by) {
      const k = n.iid != null ? String(n.iid) : (n.key != null ? String(n.key) : '')
      if (!k) continue
      blockedBy.push({ key: k, title: typeof n.title === 'string' ? n.title : '', state: STATE.OPEN })
    }
  }

  const parentKey = raw.parentKey !== undefined ? (raw.parentKey === null ? null : String(raw.parentKey)) : (raw.parent && raw.parent.key ? String(raw.parent.key) : null)

  const issue = {
    key,
    type,
    title: typeof raw.title === 'string' ? raw.title : '',
    state,
    body: typeof raw.body === 'string' ? raw.body : (typeof raw.description === 'string' ? raw.description : ''),
    url: typeof raw.url === 'string' ? raw.url : (typeof raw.web_url === 'string' ? raw.web_url : (typeof raw.html_url === 'string' ? raw.html_url : '')),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : (typeof raw.created_at === 'string' ? raw.created_at : ''),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : (typeof raw.updated_at === 'string' ? raw.updated_at : ''),
    closedAt: raw.closedAt !== undefined ? raw.closedAt : (raw.closed_at !== undefined ? raw.closed_at : (state === STATE.CLOSED ? '' : null)),
    parentKey,
    labels,
    assignees,
    comments,
    blockedBy,
    reason: typeof raw.reason === 'string' ? raw.reason : (typeof raw.stateReason === 'string' ? raw.stateReason : ''),
  }

  // 能力字段白名单：author/milestone/customFields 为 MISSING（省略），不在此产生
  // 若 raw 显式提供 author/milestone 且为对象，则补上（演示 MISSING→可选存在），但默认省略以通过 harness 的 missingFields
  // 为保持 demo-mini 的“强验证”通过，emptyData 不提供这些字段即可

  return issue
}

export default normalizeIssue
