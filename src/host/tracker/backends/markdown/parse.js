import { STATE, ISSUE_TYPE } from '../../../../shared/tracker/constants.js'

function slugify(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]+/g, '-').replace(/\-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'untitled'
}

// 票里只写标签名（#312 定版）：颜色由读这份票的人按工作区里的配色文件与内置默认色算出来，
// 解析这一层不持有任何颜色。这里原来还抄着一份默认色表（全仓第三份），#618 已删掉：
// 颜色的真源只有两处——工作区里的 docs/agents/label-colors.json，和 index.js 里那份内置调色盘
// （按这两处算色的地方是 label-colors.js 的 applyLabelColors）。

/** 把标签名外面那层「写法」剥掉，只留下标签名本身。
 *
 *  为什么要有这一步：文档讲格式时习惯把标签名写成一段代码（外面一对反引号），例如
 *  「Labels: `wayfinder:map`」。照抄的人会把这对反引号一起写进票面，读出来的标签名就成了
 *  带反引号的 `wayfinder:map`。带着反引号的名字在配色文件与内置默认色表里都查不到，颜色回落到灰；
 *  wayfinder:map 这个身份也认不出来（票的类型、行内按钮颜色与动作都跟着判错），
 *  面板上还会如实显示一对多余的反引号（#634 实测：本地 Markdown 工作区的票面就是这么写的）。
 *
 *  规则：只剥「首尾是同一个字符、并且这个字符是反引号、单引号或双引号」的成对写法，
 *  一层一层往外剥（`"bug"` 这种两层包法也能剥干净）。不成对的一律不动——名字里自带
 *  单引号的写法（例如 don't）首尾字符不同，不会被切坏。 */
export function stripLabelDecoration(name) {
  let s = String(name === null || name === undefined ? '' : name).trim()
  for (;;) {
    if (s.length < 2) break
    const head = s[0]
    if (head !== s[s.length - 1]) break
    if (head !== '`' && head !== "'" && head !== '"') break
    s = s.slice(1, -1).trim()
  }
  return s
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
  // #634：每段先经 stripLabelDecoration 剥掉外层成对引号/反引号（照抄文档代码写法写进来的那层），
  //   剥完全空的段一样按「非法段丢弃」处理，与原来的空段口径一致。
  let labels = []
  const labelsMatch = /^\s*Labels?\s*[:\uFF1A][ \t]*([^\n]*)/im.exec(raw)
  if (labelsMatch) {
    const rawNames = labelsMatch[1] || ''
    // 逗号（含全角）分隔，仅名字
    const parts = rawNames.split(/[,\uFF0C]+/)
    for (const part of parts) {
      const name = stripLabelDecoration(part)
      if (!name) continue
      // 颜色留空：由 applyLabelColors 按配色文件与内置默认色填上（没填就是空串=界面按灰显示）
      labels.push({ name, color: '', description: '' })
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
  // effort 维度：effort 是核心字段（永远存在）；扁平布局 / 单 effort 后端填 ''（EMPTY）
  const effortId = String((meta && meta.effortId) || '')
  const createdAt = (meta && typeof meta.createdAt === 'string' ? meta.createdAt : '') || ''
  const updatedAt = (meta && typeof meta.updatedAt === 'string' ? meta.updatedAt : '') || ''
  const closedAt = state === STATE.CLOSED ? (updatedAt || createdAt || '') : null
  const issue = {
    key,
    effortId,
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