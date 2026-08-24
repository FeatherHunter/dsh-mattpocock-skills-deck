import { STATE, ISSUE_TYPE } from '../../../../shared/tracker/constants.js'

function slugify(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]+/g, '-').replace(/\-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'untitled'
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
