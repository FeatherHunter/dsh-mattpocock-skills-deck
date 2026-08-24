/**
 * backends/gitlab/normalize.js — GitLab 原始形状 → 契约形状。
 *
 * 定版依据：#135（labels/milestone 分流）+#127（单key/无number/subIssues/blocking）+#144§二三（blocking双路径/parentKey归一）
 * + #143 glab能力（labels恒EMPTY/milestone一等）。
 *
 * 不变量：
 *  - 单 key: `Issue.key = String(raw.iid)`，永不产出 `number`。
 *  - 无 `subIssues`/`blocking`：树边 = `parentKey`向上 + MapNode.tickets向下；`blocking`仅getDependencies投影。
 *  - GitLab原生支持 labels → `Issue.labels`恒存在，空→`[]`EMPTY（capability-by-fill）。
 *  - `Label={name,color,description?}` color无则''；milestone独立字段，有→对象，无→省略(MISSING)。
 *  - `parentKey`/`blockedBy`双路径：原生links/blocked_by优先→`Blocked by:`行回退。
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
  if (typeof rawLabel.description === 'string' && rawLabel.description.trim() !== '') out.description = rawLabel.description
  return out
}

function normalizeLabels(raw) {
  let nodes = null
  if (raw && raw.labels && Array.isArray(raw.labels)) nodes = raw.labels
  else if (raw && raw.labels && raw.labels.nodes && Array.isArray(raw.labels.nodes)) nodes = raw.labels.nodes
  else if (Array.isArray(raw)) nodes = raw
  else if (raw && Array.isArray(raw.labels_details)) nodes = raw.labels_details
  else return [] // GitLab恒EMPTY（free/CE均有labels）
  const out = []
  for (const n of nodes) {
    const l = normalizeLabel(n)
    if (l) out.push(l)
  }
  return out
}

function deriveKey(raw) {
  if (raw == null) return '0'
  if (typeof raw.key === 'string' && raw.key !== '') return raw.key
  if (raw.iid != null) return String(raw.iid)
  if (raw.id != null) return String(raw.id)
  if (raw.number != null) return String(raw.number)
  return '0'
}

function deriveType(raw) {
  const labels = normalizeLabels(raw)
  if (labels.some((l) => l.name === 'wayfinder:map')) return ISSUE_TYPE.MAP
  if (raw && (raw.isMap === true || raw.type === 'map')) return ISSUE_TYPE.MAP
  return ISSUE_TYPE.ISSUE
}

function deriveState(raw) {
  const s = raw && raw.state != null ? String(raw.state).toLowerCase() : 'opened'
  if (s === 'closed' || s === 'close') return STATE.CLOSED
  return STATE.OPEN
}

function normalizeMilestone(rawMile) {
  if (!rawMile || typeof rawMile !== 'object') return undefined
  const title = typeof rawMile.title === 'string' ? rawMile.title.trim() : ''
  if (!title) return undefined
  const out = { name: title }
  if (typeof rawMile.description === 'string' && rawMile.description.trim() !== '') out.description = rawMile.description
  const stateRaw = rawMile.state ? String(rawMile.state).toLowerCase() : ''
  if (stateRaw === 'closed' || stateRaw === 'close') out.state = 'closed'
  else if (stateRaw === 'active' || stateRaw === 'open' || stateRaw === 'opened') out.state = 'open'
  const due = rawMile.due_date || rawMile.due_on || rawMile.dueOn || null
  if (due != null) out.dueOn = String(due)
  else if ('due_date' in rawMile || 'due_on' in rawMile) out.dueOn = null
  return out
}

function normalizeActor(rawAuthor) {
  if (!rawAuthor || typeof rawAuthor !== 'object') return null
  const login = typeof rawAuthor.username === 'string' ? rawAuthor.username : (typeof rawAuthor.login === 'string' ? rawAuthor.login : '')
  if (!login) return null
  const out = { login }
  if (typeof rawAuthor.name === 'string' && rawAuthor.name) out.name = rawAuthor.name
  if (typeof rawAuthor.avatar_url === 'string' && rawAuthor.avatar_url) out.avatarUrl = rawAuthor.avatar_url
  if (typeof rawAuthor.kind === 'string') out.kind = rawAuthor.kind
  return out
}

function normalizeAssignees(raw) {
  // GitLab: raw.assignee (single) or raw.assignees (array) or raw.assignee_ids
  let arr = null
  if (Array.isArray(raw && raw.assignees)) arr = raw.assignees
  else if (raw && raw.assignee) arr = [raw.assignee]
  else if (Array.isArray(raw && raw.assignee_ids)) return [] // ids without objects → EMPTY
  else return [] // GitLab supports assignees → EMPTY when none
  const out = []
  for (const a of arr) {
    const actor = normalizeActor(a)
    if (actor) out.push(actor)
  }
  return out
}

function normalizeComments(raw) {
  const src = (raw && (raw.notes || raw.comments)) || []
  if (!Array.isArray(src)) return []
  const out = []
  for (const n of src) {
    if (!n || typeof n !== 'object') continue
    const body = typeof n.body === 'string' ? n.body : (typeof n.note === 'string' ? n.note : '')
    const author = normalizeActor(n.author) || { login: '' }
    out.push({
      id: n.id != null ? String(n.id) : undefined,
      author,
      authorAssociation: typeof n.authorAssociation === 'string' ? n.authorAssociation : '',
      body,
      createdAt: typeof n.created_at === 'string' ? n.created_at : (typeof n.createdAt === 'string' ? n.createdAt : ''),
      updatedAt: typeof n.updated_at === 'string' ? n.updated_at : (typeof n.updatedAt === 'string' ? n.updatedAt : ''),
    })
  }
  return out
}

// Blocked by 解析：原生 blocked_by 优先 → 回退 Blocked by: 行
function parseBlockedByFromDescription(body) {
  if (typeof body !== 'string' || !body) return null
  const m = body.match(/^Blocked by:\s*(.+)$/m)
  if (!m) return null
  const raw = m[1].trim()
  if (!raw) return []
  // 支持多行续写：若下一行非空且不以 # 开头，视为续行（简化：只行内）
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
  const out = []
  const seen = new Set()
  for (const p of parts) {
    // 三式：#iid / group/proj#iid / url#iid
    // 提取末尾 #<digits>
    const mm = p.match(/#(\d+)\s*$/)
    const key = mm ? mm[1] : p.replace(/^#/, '').trim()
    if (!key) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key: String(key), title: p, state: STATE.OPEN, type: ISSUE_TYPE.ISSUE })
  }
  return out
}

function deriveBlockedBy(raw) {
  // 原生优先：raw.blocked_by (array of issues) 或 raw.blockedBy
  let native = null
  if (Array.isArray(raw && raw.blocked_by)) native = raw.blocked_by
  else if (Array.isArray(raw && raw.blockedBy)) native = raw.blockedBy
  else if (Array.isArray(raw && raw.blockedByIssues)) native = raw.blockedByIssues
  if (Array.isArray(native) && native.length > 0) {
    const out = []
    const seen = new Set()
    for (const b of native) {
      const k = b && (b.iid != null ? String(b.iid) : (b.key != null ? String(b.key) : ''))
      if (!k || seen.has(k)) continue
      seen.add(k)
      out.push({ key: k, title: typeof b.title === 'string' ? b.title : k, state: b.state === 'closed' ? STATE.CLOSED : STATE.OPEN, type: ISSUE_TYPE.ISSUE })
    }
    return out
  }
  if (Array.isArray(native) && native.length === 0) {
    // 原生存在但空 → 若描述有回退行，应忽略回退行（避免双写漂移）但此处无法判断是否原生能力存在
    // 策略：若 raw 有显式 _nativeBlockedByProbe 标记或 blocked_by 字段存在，则以原生空为准，忽略回退
    // 检测：若 raw 拥有 blocked_by 字段（即使空），视为原生有值 → 忽略回退
    if (raw && ('blocked_by' in raw || 'blockedBy' in raw)) return []
  }
  // 回退
  const body = raw && (typeof raw.description === 'string' ? raw.description : (typeof raw.body === 'string' ? raw.body : ''))
  const parsed = parseBlockedByFromDescription(body)
  if (parsed !== null) return parsed
  return []
}

function deriveParentKey(raw) {
  // 原生 links 优先
  let links = null
  if (Array.isArray(raw && raw.links)) links = raw.links
  else if (Array.isArray(raw && raw.related_issues)) links = raw.related_issues
  else if (Array.isArray(raw && raw.linked_issues)) links = raw.linked_issues
  if (Array.isArray(links) && links.length > 0) {
    const rel = links.filter((l) => {
      const t = l.link_type || l.linkType || ''
      return String(t).toLowerCase() === 'relates_to'
    })
    const pool = rel.length > 0 ? rel : links // 若无 relates_to，回落全部
    if (pool.length > 0) {
      // 最早 created_at 优先
      let earliest = pool[0]
      for (const c of pool) {
        const ea = earliest.created_at || earliest.createdAt || ''
        const ca = c.created_at || c.createdAt || ''
        if (ca && ea && ca < ea) earliest = c
        else if (ca && !ea) earliest = c
      }
      const k = earliest.iid != null ? String(earliest.iid) : (earliest.key != null ? String(earliest.key) : '')
      if (k) return k
    }
  }
  // 回退：Parent: #iid
  const body = raw && (typeof raw.description === 'string' ? raw.description : (typeof raw.body === 'string' ? raw.body : ''))
  if (typeof body === 'string' && body) {
    const m = body.match(/^Parent:\s*(.+)$/m)
    if (m) {
      const rawRef = m[1].trim()
      const mm = rawRef.match(/#(\d+)\s*$/)
      if (mm) return mm[1]
      const cleaned = rawRef.replace(/^#/, '').trim()
      if (cleaned) return cleaned.split(',')[0].trim()
    }
  }
  if (raw && typeof raw.parentKey === 'string') return raw.parentKey
  if (raw && raw.parentKey === null) return null
  return null
}

/**
 * @param {Object} raw GitLab issue 原始对象（REST issue + 可选聚合 notes/links）
 * @returns {import('../../../../shared/tracker/shape.js').Issue}
 */
export function normalizeIssue(raw) {
  const key = deriveKey(raw)
  const type = deriveType(raw)
  const state = deriveState(raw)
  const labels = normalizeLabels(raw)
  const assignees = normalizeAssignees(raw)
  const comments = normalizeComments(raw)
  const blockedBy = deriveBlockedBy(raw)
  const parentKey = deriveParentKey(raw)

  const title = raw && typeof raw.title === 'string' ? raw.title : ''
  const body = raw && typeof raw.description === 'string' ? raw.description : (raw && typeof raw.body === 'string' ? raw.body : '')
  const url = raw && typeof raw.web_url === 'string' ? raw.web_url : (typeof raw.url === 'string' ? raw.url : '')
  const createdAt = raw && typeof raw.created_at === 'string' ? raw.created_at : (raw && typeof raw.createdAt === 'string' ? raw.createdAt : '')
  const updatedAt = raw && typeof raw.updated_at === 'string' ? raw.updated_at : (raw && typeof raw.updatedAt === 'string' ? raw.updatedAt : '')
  const closedAtRaw = raw && (raw.closed_at != null ? raw.closed_at : raw.closedAt)
  const closedAt = typeof closedAtRaw === 'string' ? closedAtRaw : (closedAtRaw === null ? null : null)

  const issue = {
    key,
    type,
    title,
    state,
    body,
    url,
    createdAt,
    updatedAt,
    closedAt,
    parentKey,
    labels,
    assignees,
    comments,
    blockedBy,
    reason: raw && typeof raw.reason === 'string' ? raw.reason : '',
  }

  // milestone 独立能力字段：有→对象，无→省略(MISSING)
  const mileRaw = raw && raw.milestone
  if (mileRaw && typeof mileRaw === 'object' && mileRaw !== null) {
    const m = normalizeMilestone(mileRaw)
    if (m) issue.milestone = m
  }

  // author 能力字段：有→对象，无→省略(MISSING)（ harness 期望 MISSING）
  if (raw && raw.author && typeof raw.author === 'object') {
    const a = normalizeActor(raw.author)
    if (a) issue.author = a
  }

  // customFields 恒 MISSING（GitLab 无此概念）
  return issue
}

export default normalizeIssue
