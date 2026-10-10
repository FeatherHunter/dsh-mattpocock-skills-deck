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

/** 递进来的正文是不是「一整份票文件」：自带一级标题、幂等锚、字段行或骨架标题就是整份，建票与改正文共用同一条判据（#1002）。
 *
 *  为什么四条都算整份：读回给的是整份票文件文本，写路径必须用同一条判据认出它，否则读回原样写回会写坏。
 *  只认一级标题或锚不够：改正文的实测里出现过无一级标题但带字段行的整份（C5），建票的实测里出现过
 *  只带骨架的正文（C2），它们按片段走都会翻倍或丢东西。片段里正常不会出现这四种写法，误伤的可能很小。
 *
 *  房规注：这条判据住在这里（Markdown 房内），建票与改正文同房引用。共享层 plan.js 里有一份逐字相同的
 *  写法给工具层与门禁读（房规不许后端引用共享层的 deck-tools 目录，共享层也不许互引，所以两份各自手写，
 *  改一处必须改另一处，两处注释都写明了对方）。 */
export function isWholeIssueBody(body) {
  const t = typeof body === 'string' ? body : ''
  if (/^\s*#\s+\S/m.test(t)) return true
  if (/^\s*<!--[ \t]*DSH-IDEMPOTENCY-KEY:/m.test(t)) return true
  if (/^\s*(Status|Type|Blocked\s+by|Labels)\s*[:\uFF1A]/im.test(t)) return true
  if (/^\s*##\s*(Comments|Answer)\s*$/im.test(t)) return true
  return false
}

/** 从票文件正文里读出文件顶写着的父票编号（#971）。
 *
 *  为什么要有这一步：建票时父票编号写在文件顶的注释里（例如 <!-- parentKey: 01 -->），
 *  但读回与列举一直用调用方递进来的固定值（永远是 00），注释写了却从不读。
 *  扁平布局里地图本身是 01 号，固定值 00 永远对不上，按地图筛选恒为 0，快照数不出子票。
 *  这里把注释读回来：有注释就以注释为准，没有注释的老文件才回落到调用方给的值。
 *
 *  返回 {found, value}：found 表示文件里有没有这一行注释；
 *  value 是归一后的父票编号（数字补成两位），空值与 null 字样都归成 null（根票，没有父票）。
 *  只认 parentKey 这一行，不认幂等锚那一行（锚是 DSH-IDEMPOTENCY-KEY，不是父子关系）。 */
export function parentKeyFromFile(text) {
  const raw = String(text || '')
  // 只看文件头（标题之前的那几行）：父注释是文件元数据，写在最前（锚之后、标题之前）。
  // 正文里也可能出现同样的写法（例如文档里举例怎么写注释），那一行不算数。
  // 没有标题的坏文件退化成只看前 10 行，照样够到文件头。
  const h1 = /^#+\s+/m.exec(raw)
  const head = h1 ? raw.slice(0, h1.index) : String(raw).split('\n').slice(0, 10).join('\n')
  const m = /^[ \t]*<!--[ \t]*parentKey[ \t]*:[ \t]*(.*?)-->/im.exec(head)
  if (!m) return { found: false, value: null }
  const v = String(m[1] || '').trim()
  if (!v) return { found: true, value: null }
  if (/^null$/i.test(v) || /^none$/i.test(v) || v === '-') return { found: true, value: null }
  if (/^\d+$/.test(v)) return { found: true, value: v.padStart(2, '0') }
  return { found: true, value: v }
}

export function parseMd(text, meta) {
  const raw = String(text || '')
  // 2026-10-10 修（#991 实测带回来的读路径缺陷）：冒号后面原来写的是 \s*，而 \s 含换行 —— 字段值为空的
  //   那一行（「Status:」单独一行）会让 \s* 跨过换行，再由 ([^\n]+) 把**下一行**当成这个字段的值抓走。
  //   实测证据：同一份票文件上，带某个标签时读出「阻塞」有一条、去掉该标签立刻变空，而盘上那行本来就是空的。
  //   改成 [ \t]*：只吃同一行里的空格与制表符，值不许跨行。空值这一档由「匹配不上」处理（回到默认），
  //   与「空行就是空值」的语义一致。Type / Blocked by 两条同一个毛病，一并改。
  const statusRaw = (/^\s*Status\s*[:\uFF1A][ \t]*([^\n]+)/im.exec(raw)?.[1]?.trim() || '')
  const statusNorm = statusRaw.toLowerCase().replace(/\s+/g, '-')
  const closedSet = new Set(['resolved', 'completed', 'closed', 'done'])
  const state = closedSet.has(statusNorm) ? STATE.CLOSED : STATE.OPEN
  const title = (() => {
    const m = /^#+\s+(.+)$/m.exec(raw)
    if (m) return m[1].trim()
    const first = raw.split('\n').find((l) => l.trim().length > 0) || ''
    return first.replace(/^#+\s*/, '').trim()
  })()
  const typeRaw = (/^\s*Type\s*[:\uFF1A][ \t]*([^\n]+)/im.exec(raw)?.[1]?.trim().toLowerCase() || '')
  let customFields
  if (typeRaw) {
    customFields = [{ name: 'Type', value: typeRaw, type: 'single', options: ['research', 'prototype', 'grilling', 'task'] }]
  }
  const blockedRaw = (/^\s*Blocked\s+by\s*[:\uFF1A][ \t]*(.+)$/im.exec(raw)?.[1]?.trim() || '')
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
  // #971：父子关系以文件顶注释为准，有注释就用注释，没有注释的老文件才回落。
  // 地图文件本身没有父票（恒为空）；计划里用票文件冒充的地图（正文写着 Type: map、却没有父注释）同样视作没有父票。
  // 其余票没有注释时沿用调用方递进来的固定值（今天是 00，即老单根工作区的地图），保持老数据行为不变。
  const fileParent = parentKeyFromFile(raw)
  let parentKey = null
  if (meta && meta.isMap) {
    parentKey = null
  } else if (fileParent.found) {
    parentKey = fileParent.value
  } else if (typeRaw === 'map') {
    parentKey = null
  } else {
    parentKey = meta && meta.parentKey !== undefined ? meta.parentKey : null
  }
  if (typeof parentKey === 'string') {
    const t = parentKey.trim()
    if (!t) parentKey = null
    else if (/^\d+$/.test(t)) parentKey = t.padStart(2, '0')
    else parentKey = t
  }
  if (parentKey === '') parentKey = null
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