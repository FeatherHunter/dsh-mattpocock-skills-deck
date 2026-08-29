import { STATE, ISSUE_TYPE } from '../../../../shared/tracker/constants.js'

function slugify(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]+/g, '-').replace(/\-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'untitled'
}

// 调色盘：与 docs/agents/triage-labels.md 同位，票里只写名、色在总表（#312 定版）
// 这里是本地后端自己的默认调色盘真源，与 src/host/tracker/backends/markdown/index.js 保持一致
const PALETTE = {
  'bug': 'd73a4a',
  'needs-triage': 'fbca04',
  'needs-info': '5319e7',
  'ready-for-agent': '0e8a16',
  'ready-for-human': 'b60205',
  'wontfix': 'ffffff',
  'wayfinder:map': '8b5cf6',
  'wayfinder:research': '0ea5e9',
  'wayfinder:prototype': 'f59e0b',
  'wayfinder:grilling': '9d7cd8',
  'wayfinder:task': '10b981',
}

export function parseMd(text, meta) {
  const raw = String(text || '')
  const statusRaw = (/^\s*Status\s*[:\uFF1A]\s*([^\n]+)/im.exec(raw)?.[1]?.trim() || '')
  const statusNorm = statusRaw.toLowerCase().replace(/\s+/g, '-')
  const closedSet = new Set(['resolved', 'completed', 'closed', 'done'])
  const state = closedSet.has(statusNorm) ? STATE.CLOSED : STATE.OPEN
  const title = (() => {
    const m = /^#+\s+(.+)$/m.exec(raw)
    if (m) return m[1].trim()
    const first = raw.split('\n').find((l) => l.trim().length > 0) || ''
    return first.replace(/^#+\s*/, '').trim()
  })()
  const typeRaw = (/^\s*Type\s*[:\uFF1A]\s*([^\n]+)/im.exec(raw)?.[1]?.trim().toLowerCase() || '')
  let customFields
  if (typeRaw) {
    customFields = [{ name: 'Type', value: typeRaw, type: 'single', options: ['research', 'prototype', 'grilling', 'task'] }]
  }
  const blockedRaw = (/^\s*Blocked\s+by\s*[:\uFF1A]\s*(.+)$/im.exec(raw)?.[1]?.trim() || '')
  let blockedBy = []
  if (blockedRaw) {
    const parts = blockedRaw.split(/[,,\s]+/).map((s) => s.trim()).filter(Boolean)
    // above split uses comma, fullwidth comma, whitespace
    const realParts = blockedRaw.split(/[,\uFF0C\s]+/).map((s) => s.trim()).filter(Boolean)
    const useParts = realParts.length ? realParts : parts
    for (const p of useParts) {
      const m = /#?(\d+)/.exec(p)
      if (m) {
        const k = String(m[1]).padStart(2, '0')
        blockedBy.push({ key: k, title: '', state: STATE.OPEN })
      }
    }
  }
  // Labels: 调色盘模型（#312 定版）——票只写名，色在总表，缺行按空、非法段丢弃、没冒号视为缺行；兼容历史单数 Label:
  let labels = []
  const labelsMatch = /^\s*Labels?\s*[:\uFF1A][ \t]*([^\n]*)/im.exec(raw)
  if (labelsMatch) {
    const rawNames = labelsMatch[1] || ''
    // 逗号（含全角）分隔，仅名字
    const parts = rawNames.split(/[,\uFF0C]+/).map((s) => s.trim()).filter(Boolean)
    for (const name of parts) {
      if (!name) continue
      const color = PALETTE[name] || 'cccccc'
      labels.push({ name, color, description: '' })
    }
  } else {
    // 缺行按空（不抛、空数组）
    labels = []
  }
  let comments = []
  const cmAnchor = /^\s*##\s*Comments\s*$/im
  const cmExec = cmAnchor.exec(raw)
  if (cmExec) {
    const start = cmExec.index + cmExec[0].length
    const after = raw.slice(start)
    const nextH2 = /^\s*##\s+/m.exec(after)
    const segment = nextH2 ? after.slice(0, nextH2.index) : after
    const blocks = segment.split(/^###\s+/m).map((s) => s.trim()).filter(Boolean)
    for (const b of blocks) {
      if (!b) continue
      const lines = b.split('\n')
      const header = lines[0]?.trim() || ''
      let login = 'local'
      let createdAt = ''
      const dashIdx = header.indexOf('\u2014')
      const dashIdx2 = header.indexOf('-')
      let sep = -1
      if (dashIdx >= 0) sep = dashIdx
      else if (dashIdx2 >= 0) sep = dashIdx2
      if (sep >= 0) {
        login = header.slice(0, sep).trim() || 'local'
        const datePart = header.slice(sep + 1).trim()
        const iso = /\d{4}-\d{2}-\d{2}T/.exec(datePart) ? datePart.match(/\d{4}-\d{2}-\d{2}T[^ \n]+/)?.[0] : ''
        if (iso) createdAt = iso
      } else if (header) {
        login = header.split(/\s+/)[0] || 'local'
      }
      const bodyPart = lines.slice(1).join('\n').trim()
      const body = bodyPart.split(/^---\s*$/m)[0]?.trim() || bodyPart
      if (!body && !header) continue
      comments.push({
        author: { login },
        authorAssociation: '',
        body: body || '',
        createdAt: createdAt || (meta && meta.createdAt) || '',
        updatedAt: createdAt || (meta && meta.updatedAt) || '',
      })
    }
  }
  const key = String((meta && meta.key) || '00')
  const type = meta && meta.isMap ? ISSUE_TYPE.MAP : ISSUE_TYPE.ISSUE
  const parentKey = meta && meta.parentKey !== undefined ? meta.parentKey : null
  const createdAt = (meta && typeof meta.createdAt === 'string' ? meta.createdAt : '') || ''
  const updatedAt = (meta && typeof meta.updatedAt === 'string' ? meta.updatedAt : '') || ''
  const closedAt = state === STATE.CLOSED ? (updatedAt || createdAt || '') : null
  const issue = {
    key,
    type,
    title,
    state,
    body: raw,
    url: '',
    createdAt,
    updatedAt,
    closedAt,
    parentKey,
    blockedBy,
    comments,
    labels,
  }
  if (customFields) issue.customFields = customFields
  if (statusRaw) {
    const s = statusNorm
    if (s === 'claimed') {
      issue.assignees = [{ login: '@me', kind: 'user' }]
    } else {
      issue.assignees = []
    }
  }
  if (state === STATE.CLOSED) issue.reason = 'completed'
  else issue.reason = ''
  return issue
}

export default parseMd
export { slugify }