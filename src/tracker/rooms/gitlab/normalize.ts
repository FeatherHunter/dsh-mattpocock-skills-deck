/**
 * backends/gitlab/normalize.ts — GitLab 原始形状 → 契约形状。
 *
 * 定版依据：#135（labels/milestone 分流）+#127（单key/无number/subIssues/blocking）
 * + #144§二三（blocking双路径/parentKey归一）+ #143 glab能力（labels恒EMPTY/milestone一等）。
 *
 * 不变量：
 *  - 单 key: `Issue.key = String(raw.iid)`，永不产出 `number`。
 *  - 无 `subIssues`/`blocking`：树边 = `parentKey`向上 + MapNode.tickets向下；`blocking`仅getDependencies投影。
 *  - GitLab原生支持 labels → `Issue.labels`恒存在，空→`[]`EMPTY（capability-by-fill）。
 *  - `Label={name,color,description?}` color无则''；milestone独立字段，有→对象，无→省略(MISSING)。
 *  - `parentKey`/`blockedBy`双路径：原生links/blocked_by优先→`Blocked by:`行回退。
 */

import { STATE, ISSUE_TYPE } from '../../contract/vocabulary.js'
import type { Actor, IssueType, State } from '../../contract/identity.js'
import type { Comment, Issue, IssueRef, Label, Milestone } from '../../contract/entities.js'

// GitLab 回包是外部形状，先收成键值袋再逐格判是因为远端字段可缺可空，直接按定型读会把缺字段当成错。
type RawBag = Record<string, unknown>

function asBag(raw: unknown): RawBag | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as RawBag
}

function normalizeLabel(rawLabel: unknown): Label | null {
  if (typeof rawLabel === 'string') {
    const name = rawLabel.trim()
    if (!name) return null
    return { name, color: '' }
  }
  const bag = asBag(rawLabel)
  if (!bag) return null
  const name = typeof bag['name'] === 'string' ? (bag['name'] as string).trim() : ''
  if (!name) return null
  const color = typeof bag['color'] === 'string' ? (bag['color'] as string) : ''
  const out: Label = { name, color }
  if (typeof bag['description'] === 'string' && (bag['description'] as string).trim() !== '') {
    out.description = bag['description'] as string
  }
  return out
}

function normalizeLabels(raw: unknown): Label[] {
  let nodes: unknown = null
  const bag = asBag(raw)
  if (bag && Array.isArray(bag['labels'])) nodes = bag['labels']
  else if (bag && asBag(bag['labels']) && Array.isArray((asBag(bag['labels']) as RawBag)['nodes'])) {
    nodes = (asBag(bag['labels']) as RawBag)['nodes']
  } else if (Array.isArray(raw)) nodes = raw
  else if (bag && Array.isArray(bag['labels_details'])) nodes = bag['labels_details']
  else return [] // GitLab恒EMPTY（free/CE均有labels）
  const out: Label[] = []
  for (const n of nodes as unknown[]) {
    const l = normalizeLabel(n)
    if (l) out.push(l)
  }
  return out
}

function deriveKey(raw: unknown): string {
  if (raw == null) return '0'
  const bag = asBag(raw)
  if (!bag) return '0'
  if (typeof bag['key'] === 'string' && (bag['key'] as string) !== '') return bag['key'] as string
  if (bag['iid'] != null) return String(bag['iid'])
  if (bag['id'] != null) return String(bag['id'])
  if (bag['number'] != null) return String(bag['number'])
  return '0'
}

function deriveType(raw: unknown): IssueType {
  const labels = normalizeLabels(raw)
  if (labels.some((l) => l.name === 'wayfinder:map')) return ISSUE_TYPE.MAP as IssueType
  const bag = asBag(raw)
  if (bag && (bag['isMap'] === true || bag['type'] === 'map')) return ISSUE_TYPE.MAP as IssueType
  return ISSUE_TYPE.ISSUE as IssueType
}

function deriveState(raw: unknown): State {
  const bag = asBag(raw)
  const s = bag && bag['state'] != null ? String(bag['state']).toLowerCase() : 'opened'
  if (s === 'closed' || s === 'close') return STATE.CLOSED as State
  return STATE.OPEN as State
}

function normalizeMilestone(rawMile: unknown): Milestone | undefined {
  const bag = asBag(rawMile)
  if (!bag) return undefined
  const title = typeof bag['title'] === 'string' ? (bag['title'] as string).trim() : ''
  if (!title) return undefined
  const out: Milestone = { name: title }
  if (typeof bag['description'] === 'string' && (bag['description'] as string).trim() !== '') {
    out.description = bag['description'] as string
  }
  const stateRaw = bag['state'] ? String(bag['state']).toLowerCase() : ''
  if (stateRaw === 'closed' || stateRaw === 'close') out.state = 'closed'
  else if (stateRaw === 'active' || stateRaw === 'open' || stateRaw === 'opened') out.state = 'open'
  const due = bag['due_date'] ?? bag['due_on'] ?? bag['dueOn'] ?? null
  if (due != null) out.dueOn = String(due)
  else if (bag && ('due_date' in bag || 'due_on' in bag)) out.dueOn = null
  return out
}

function normalizeActor(rawAuthor: unknown): Actor | null {
  const bag = asBag(rawAuthor)
  if (!bag) return null
  const login =
    typeof bag['username'] === 'string'
      ? (bag['username'] as string)
      : typeof bag['login'] === 'string'
        ? (bag['login'] as string)
        : ''
  if (!login) return null
  const out: Actor = { login }
  if (typeof bag['name'] === 'string' && (bag['name'] as string)) out.name = bag['name'] as string
  if (typeof bag['avatar_url'] === 'string' && (bag['avatar_url'] as string)) {
    out.avatarUrl = bag['avatar_url'] as string
  }
  if (typeof bag['kind'] === 'string') out.kind = bag['kind'] as string
  return out
}

function normalizeAssignees(raw: unknown): Actor[] {
  const bag = asBag(raw)
  // GitLab: raw.assignee (single) or raw.assignees (array) or raw.assignee_ids
  let arr: unknown = null
  if (bag && Array.isArray(bag['assignees'])) arr = bag['assignees']
  else if (bag && bag['assignee']) arr = [bag['assignee']]
  else if (bag && Array.isArray(bag['assignee_ids'])) return [] // ids without objects → EMPTY
  else return [] // GitLab supports assignees → EMPTY when none
  const out: Actor[] = []
  for (const a of arr as unknown[]) {
    const actor = normalizeActor(a)
    if (actor) out.push(actor)
  }
  return out
}

function normalizeComments(raw: unknown): Comment[] {
  const bag = asBag(raw)
  const src: unknown = (bag && (bag['notes'] || bag['comments'])) || []
  if (!Array.isArray(src)) return []
  const out: Comment[] = []
  for (const n of src as unknown[]) {
    const nb = asBag(n)
    if (!nb) continue
    const body =
      typeof nb['body'] === 'string'
        ? (nb['body'] as string)
        : typeof nb['note'] === 'string'
          ? (nb['note'] as string)
          : ''
    const author = normalizeActor(nb['author']) || { login: '' }
    out.push({
      id: nb['id'] != null ? String(nb['id']) : undefined,
      author,
      authorAssociation: typeof nb['authorAssociation'] === 'string' ? (nb['authorAssociation'] as string) : '',
      body,
      createdAt:
        typeof nb['created_at'] === 'string'
          ? (nb['created_at'] as string)
          : typeof nb['createdAt'] === 'string'
            ? (nb['createdAt'] as string)
            : '',
      updatedAt:
        typeof nb['updated_at'] === 'string'
          ? (nb['updated_at'] as string)
          : typeof nb['updatedAt'] === 'string'
            ? (nb['updatedAt'] as string)
            : '',
    })
  }
  return out
}

// Blocked by 解析：原生 blocked_by 优先 → 回退 Blocked by: 行
function parseBlockedByFromDescription(body: unknown): IssueRef[] | null {
  if (typeof body !== 'string' || !body) return null
  const m = body.match(/^Blocked by:\s*(.+)$/m)
  if (!m) return null
  const line = (m[1] as string).trim()
  if (!line) return []
  // 支持多行续写：若下一行非空且不以 # 开头，视为续行（简化：只行内）
  const parts = line
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const out: IssueRef[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    // 三式：#iid / group/proj#iid / url#iid
    // 提取末尾 #<digits>
    const mm = p.match(/#(\d+)\s*$/)
    const key = mm ? (mm[1] as string) : p.replace(/^#/, '').trim()
    if (!key) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key: String(key), title: p, state: STATE.OPEN as State, type: ISSUE_TYPE.ISSUE as IssueType })
  }
  return out
}

function deriveBlockedBy(raw: unknown): IssueRef[] {
  const bag = asBag(raw)
  // 原生优先：raw.blocked_by (array of issues) 或 raw.blockedBy
  let native: unknown = null
  if (bag && Array.isArray(bag['blocked_by'])) native = bag['blocked_by']
  else if (bag && Array.isArray(bag['blockedBy'])) native = bag['blockedBy']
  else if (bag && Array.isArray(bag['blockedByIssues'])) native = bag['blockedByIssues']
  if (Array.isArray(native) && (native as unknown[]).length > 0) {
    const out: IssueRef[] = []
    const seen = new Set<string>()
    for (const b of native as unknown[]) {
      const bb = asBag(b)
      const k =
        bb && bb['iid'] != null
          ? String(bb['iid'])
          : bb && bb['key'] != null
            ? String(bb['key'])
            : ''
      if (!k || seen.has(k)) continue
      seen.add(k)
      out.push({
        key: k,
        title: bb && typeof bb['title'] === 'string' ? (bb['title'] as string) : k,
        state: bb && bb['state'] === 'closed' ? (STATE.CLOSED as State) : (STATE.OPEN as State),
        type: ISSUE_TYPE.ISSUE as IssueType,
      })
    }
    return out
  }
  if (Array.isArray(native) && (native as unknown[]).length === 0) {
    // 原生存在但空 → 若描述有回退行，应忽略回退行（避免双写漂移）但此处无法判断是否原生能力存在
    // 策略：若 raw 有显式 _nativeBlockedByProbe 标记或 blocked_by 字段存在，则以原生空为准，忽略回退
    // 检测：若 raw 拥有 blocked_by 字段（即使空），视为原生有值 → 忽略回退
    if (bag && ('blocked_by' in bag || 'blockedBy' in bag)) return []
  }
  // 回退
  const body =
    bag && typeof bag['description'] === 'string'
      ? (bag['description'] as string)
      : bag && typeof bag['body'] === 'string'
        ? (bag['body'] as string)
        : ''
  const parsed = parseBlockedByFromDescription(body)
  if (parsed !== null) return parsed
  return []
}

function deriveParentKey(raw: unknown): string | null {
  const bag = asBag(raw)
  // 原生 links 优先
  let links: unknown = null
  if (bag && Array.isArray(bag['links'])) links = bag['links']
  else if (bag && Array.isArray(bag['related_issues'])) links = bag['related_issues']
  else if (bag && Array.isArray(bag['linked_issues'])) links = bag['linked_issues']
  if (Array.isArray(links) && (links as unknown[]).length > 0) {
    const all = links as RawBag[]
    const rel = all.filter((l) => {
      const lb = asBag(l)
      const t = lb ? lb['link_type'] || lb['linkType'] || '' : ''
      return String(t).toLowerCase() === 'relates_to'
    })
    const pool = rel.length > 0 ? rel : all // 若无 relates_to，回落全部
    if (pool.length > 0) {
      // 最早 created_at 优先
      let earliest = pool[0] as RawBag
      for (const c of pool) {
        const cb = asBag(c) as RawBag
        const eb = asBag(earliest) as RawBag
        const ea = (eb['created_at'] || eb['createdAt'] || '') as string
        const ca = (cb['created_at'] || cb['createdAt'] || '') as string
        if (ca && ea && ca < ea) earliest = c as RawBag
        else if (ca && !ea) earliest = c as RawBag
      }
      const ek = asBag(earliest) as RawBag
      const k =
        ek['iid'] != null ? String(ek['iid']) : ek['key'] != null ? String(ek['key']) : ''
      if (k) return k
    }
  }
  // 回退：Parent: #iid
  const body =
    bag && typeof bag['description'] === 'string'
      ? (bag['description'] as string)
      : bag && typeof bag['body'] === 'string'
        ? (bag['body'] as string)
        : ''
  if (typeof body === 'string' && body) {
    const m = body.match(/^Parent:\s*(.+)$/m)
    if (m) {
      const rawRef = (m[1] as string).trim()
      const mm = rawRef.match(/#(\d+)\s*$/)
      if (mm) return mm[1] as string
      const cleaned = rawRef.replace(/^#/, '').trim()
      if (cleaned) return cleaned.split(',')[0]!.trim()
    }
  }
  if (bag && typeof bag['parentKey'] === 'string') return bag['parentKey'] as string
  if (bag && bag['parentKey'] === null) return null
  return null
}

/**
 * GitLab 原始票面归一成契约 Issue：单 key 取 iid、状态压成两态、缺的能力字段按 EMPTY/MISSING 分流。
 *
 * @param raw GitLab issue 原始对象（REST issue + 可选聚合 notes/links）
 */
export function normalizeIssue(raw: unknown): Issue {
  const key = deriveKey(raw)
  const type = deriveType(raw)
  const state = deriveState(raw)
  const labels = normalizeLabels(raw)
  const assignees = normalizeAssignees(raw)
  const comments = normalizeComments(raw)
  const blockedBy = deriveBlockedBy(raw)
  const parentKey = deriveParentKey(raw)
  const bag = asBag(raw)

  const title = bag && typeof bag['title'] === 'string' ? (bag['title'] as string) : ''
  const body =
    bag && typeof bag['description'] === 'string'
      ? (bag['description'] as string)
      : bag && typeof bag['body'] === 'string'
        ? (bag['body'] as string)
        : ''
  const url =
    bag && typeof bag['web_url'] === 'string'
      ? (bag['web_url'] as string)
      : bag && typeof bag['url'] === 'string'
        ? (bag['url'] as string)
        : ''
  const createdAt =
    bag && typeof bag['created_at'] === 'string'
      ? (bag['created_at'] as string)
      : bag && typeof bag['createdAt'] === 'string'
        ? (bag['createdAt'] as string)
        : ''
  const updatedAt =
    bag && typeof bag['updated_at'] === 'string'
      ? (bag['updated_at'] as string)
      : bag && typeof bag['updatedAt'] === 'string'
        ? (bag['updatedAt'] as string)
        : ''
  const closedAtRaw = bag ? (bag['closed_at'] != null ? bag['closed_at'] : bag['closedAt']) : undefined
  const closedAt = typeof closedAtRaw === 'string' ? closedAtRaw : null

  const issue: Issue = {
    key,
    // effortId：GitLab 一个仓库只有一个隐含 effort，核心字段填 ''（EMPTY，不是 MISSING）
    effortId: '',
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
    reason: bag && typeof bag['reason'] === 'string' ? (bag['reason'] as string) : '',
  }

  // milestone 独立能力字段：有→对象，无→省略(MISSING)
  const mileRaw = bag ? bag['milestone'] : undefined
  if (mileRaw && typeof mileRaw === 'object' && mileRaw !== null) {
    const m = normalizeMilestone(mileRaw)
    if (m) issue.milestone = m
  }

  // author 能力字段：有→对象，无→省略(MISSING)（ harness 期望 MISSING）
  if (bag && bag['author'] && typeof bag['author'] === 'object') {
    const a = normalizeActor(bag['author'])
    if (a) issue.author = a
  }

  // customFields 恒 MISSING（GitLab 无此概念）
  return issue
}

export default normalizeIssue
