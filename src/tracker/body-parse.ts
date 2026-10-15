/**
 * src/tracker/body-parse.ts —— 正文解析与票分组的纯函数叶子（宿主与客户端共用同一份）
 *
 * 住处：#1148 修正了本文件开头此前一直写着的旧路径（原住 `src/shared/parser.js`）。
 * 今天的真源就是本文件：宿主侧还留着同名的内联副本，那两份副本不是真源，
 * 差分对照由 tests/verify-parse-leaf.js 钉住（叶子 === 构建产物 === 宿主内联）。
 *
 * 约束：本文件必须保持纯函数（不碰 ctx / 不碰 DOM / 无共享状态 / 不自己读文件），否则失去叶子价值。
 *
 * 类型（#1148）：入参一律收成未知值。调用方交进来的是后端回包、老快照与手写数据，
 * 字段可能缺席、可能是别的类型，所以这里不假设形状，读一格收口一格（运行时判断一个字没改，
 * 只是把 jsdoc 里的形状搬成了类型标注）；返回值是本文件说了算的确定形状，调用方按导出的接口读。
 */

// ——— normalizeBody：剥 BOM + 字面 \n 还原（T16 容错） ———

/**
 * 剥掉开头的 BOM；真实换行少于两处、而字面 `\n` 存在时，把字面 `\n` 还原成真换行。
 * 入参收成未知值：上游读文件可能交来空值，统一按空串处理，不抛异常。
 */
export function normalizeBody(raw: unknown): string {
  let s = String(raw || '').replace(/^\uFEFF/, '')
  const realNL = (s.match(/\n/g) || []).length
  const literalNL = (s.match(/\\n/g) || []).length
  if (realNL < 2 && literalNL > 0) {
    s = s.replace(/\\n/g, '\n')
  }
  return s
}

/** 地图正文「Decisions so far」里的一个决策：标题、链接与那句话本身。 */
export interface MapDecision {
  /** 决策标题（写成 `- [标题](链接) —— 一句话` 时取方括号里那一段）。 */
  title: string
  /** 决策的链接；那行没写链接就是空串。 */
  url: string
  /** 去掉前缀之后剩下的那句话。 */
  gist: string
}

/** 地图正文五个区块的解析结果。各区缺了就回空串或空数组，不回 null。 */
export interface ParsedMapBody {
  /** `## Destination`：目标那一句。 */
  destination: string
  /** `## Notes`：备注。 */
  notes: string
  /** `## Decisions so far`：已定的决策清单。 */
  decisions: MapDecision[]
  /** `## Not yet specified`：还没定的事（HTML 注释行不算）。 */
  fog: string[]
  /** `## Out of scope`：明确不做的（HTML 注释行不算）。 */
  outOfScope: string[]
}

// ——— parseMapBody：wayfinder map 五区块解析（## Destination / Notes / Decisions so far / Not yet specified / Out of scope） ———

/**
 * 五个规范标题：只有它们能切出区块。
 * 行中出现也一样（#1184）：粘在上一行末尾的标题不再静默丢掉整节。
 * 故意只认这五个：正文里讨论标题本身（比如写到「行中出现 ## Notes 几个字」）
 * 不是标题，不能切；任意 `##` 都切会把正文里的引用变成假区块。
 */
export const MAP_SECTION_TITLES = ['Destination', 'Notes', 'Decisions so far', 'Not yet specified', 'Out of scope']

/**
 * 把粘在行中的规范标题拆成独立行（#1184）。
 * 只拆一种形状：`## 规范标题` 出现在行中、且一直写到行尾（前面没有换行，
 * 比如「…没有动环检逻辑。## Not yet specified」）。后面还跟字的（比如
 * 「见 ## Notes 一节怎么定」）是正文在讨论标题本身，原样保留。
 * 围栏代码块里的一律不动：块里写什么都是示例。
 * 行首 `##` 的旧语义一个字没改（允许任何标题名，前导空格仍不认）。
 */
export function splitGluedHeadings(body: unknown): string {
  const lines = String(body || '').split(/\r?\n/)
  const out: string[] = []
  let fence: string | null = null
  const fenceRe = /^\s*(`{3,}|~{3,})/
  const titles = MAP_SECTION_TITLES.map((t) => t.replace(/ /g, '\\s+')).join('|')
  // #1184：`##` 后面允许没有空格（`text##Notes` 也要拆），与写回守门同一口径。
  const gluedRe = new RegExp('^(.*\\S)\\s*##\\s*(' + titles + ')\\s*$')
  for (const line of lines) {
    const fm = line.match(fenceRe)
    if (fm) {
      const marker = fm[1][0]
      if (fence === null) fence = marker
      else if (marker === fence) fence = null
      out.push(line)
      continue
    }
    if (fence !== null) { out.push(line); continue }
    const m = line.match(gluedRe)
    if (m) { out.push(m[1]); out.push('## ' + m[2].replace(/\s+/g, ' ').trim()); continue }
    out.push(line)
  }
  return out.join('\n')
}

/** 一条决策行：经典 `- [标题](链接) — 一句话` 与加粗 `- **…**：…` 两种写法（#1184 收第二种）。 */
export function parseDecisionLine(l: string): MapDecision | null {
  if (l.indexOf('- [') === 0) {
    const t = l.match(/\[(.+?)\]\((.+?)\)/)
    const g = l.replace(/^-\s*\[.+?\]\(.+?\)\s*[-–—]?\s*/, '')
    return { title: t ? t[1] : l, url: t ? t[2] : '', gist: truncateGist(g) }
  }
  const b = l.match(/^-\s*\*\*(.+?)\*\*\s*[:：-]?\s*(.*)$/)
  if (b) {
    const inner = b[1]
    const t = inner.match(/\[(.+?)\]\((.+?)\)/)
    // 标题里 `[#1057](链接)` 这种写成链接文字本身，不丢票号。
    const title = t ? inner.replace('[' + t[1] + '](' + t[2] + ')', t[1]) : inner
    return { title: title, url: t ? t[2] : '', gist: truncateGist(b[2]) }
  }
  return null
}

/**
 * 决策那句话太长时截到 240 字（#1184 验收②）：不断词——退到 240 字内
 * 最后一个完整词后面，省略号紧跟在后面；240 字里连一个完整词都
 * 没有（单个超长 token）时硬切在 240 字处再加省略号。
 */
export function truncateGist(gist: string): string {
  const LIMIT = 240
  const s = String(gist || '')
  if (s.length <= LIMIT) return s
  const head = s.slice(0, LIMIT)
  const lastBlank = head.search(/\s+\S*$/)
  const kept = (lastBlank > 0 ? head.slice(0, lastBlank) : head).replace(/\s+$/, '')
  return (kept === '' ? head : kept) + '…'
}

/**
 * 把地图正文按二级标题切成区块，取出五个区块的内容。
 * 入参收成未知值：正文可能缺席（老票、新建的票），统一按空处理。
 */
export function parseMapBody(body: unknown): ParsedMapBody {
  const out: ParsedMapBody = { destination: '', notes: '', decisions: [], fog: [], outOfScope: [] }
  if (!body) return out
  // 区块名 → 该区块下的原行；## 标题行本身不入表。
  const sec: Record<string, string[]> = {}
  const lines = splitGluedHeadings(normalizeBody(body)).split(/\r?\n/)
  let cur: string | null = null
  for (let i = 0; i < lines.length; i++) {
    // #1184：`##` 与标题之间允许没有空格（`##Notes` 也是标题），与写回守门
    // （scripts/wire-subissues.mjs，三处都用 `##\s*`）保持同一口径。
    const m = lines[i].match(/^##\s*(.+?)\s*$/)
    if (m) { cur = m[1]; sec[cur] = sec[cur] || []; continue }
    if (cur) sec[cur].push(lines[i])
  }
  /** 去空白、丢空行；区块没出现过时按空数组处理。 */
  const clean = (arr: string[] | undefined): string[] => (arr || []).map((s) => s.trim()).filter(Boolean)
  out.destination = clean(sec['Destination']).join(' ')
  out.notes = clean(sec['Notes']).join(' ')
  out.decisions = clean(sec['Decisions so far']).map((l) => parseDecisionLine(l)).filter((d): d is MapDecision => d !== null)
  out.fog = clean(sec['Not yet specified']).filter((l) => l.indexOf('<!--') !== 0)
  out.outOfScope = clean(sec['Out of scope']).filter((l) => l.indexOf('<!--') !== 0)
  return out
}

// ——— parseProgress：进度块三级锚定（## 进度：N% / 行首变体 / 全文兜底），clamp 0-100 ———

/**
 * 从正文里读进度百分比。
 *
 * 三级锚定按顺序试，先命中先用：① 标题行 `## 进度：90%`；② 行首变体 `进度：90%`（不带标题符号）；
 * ③ 全文兜底（兼容老票随手格式，放最后是为了不劫持前两层）。
 *
 * @returns 0..100 的整数；正文里没有进度、或数字不是合法整数时回 null（不是 0）。
 */
export function parseProgress(body: unknown): number | null {
  if (!body) return null
  const s = String(body)
  const m = s.match(/^\s*#{1,6}\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/im)
    || s.match(/^\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/im)
    || s.match(/(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (isNaN(n)) return null
  return Math.max(0, Math.min(100, n))
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、票的分组与分层（宿主侧同步调用，输入是「票号 + 状态 + 认领 + 阻塞」这几格）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 分组与分层只读票上这几格。字段一律从后端回包或老快照来，所以除票号外都按未知收口：
 * 缺一格、或者某个格不是期望的类型，都由这里的运行时判断兜住（`t.state === 'CLOSED'` 这类比较）。
 */
export interface GroupingTicket {
  /** 票号。分层与分组都拿它当键（拼进对象键时会被 JS 转成字符串）。 */
  number: number
  /** 状态。只有大写 `'CLOSED'` 算已关闭，其余（含缺席、别的写法）都算未关闭 —— 与老口径一致。 */
  state?: string
  /** 认领人。有值（非空串、非 null）算已认领；缺席或空串算「没人认领」。 */
  claimedBy?: unknown
  /**
   * 直接阻塞我的票号。声明成**必填**，因为本文件两处读它的口径本来就不一样，而且两处都逐字保留了老写法：
   *   · `computeLevels` 查阻塞者表时写的是 `(t.blockedBy || [])`——缺了这一格就按「没有阻塞者」；
   *   · 层内统计与 `groupTickets` 写的是裸 `t.blockedBy.some(...)`——缺了这一格会当场抛。
   * 类型按更严的那一处收（必填）：真数据里要么这一格是数组，要么根本没有这张票。
   * 想把两处统一成「缺了就按空数组」，那是另一件事，别在类型迁移里顺手改（见本文件尾部说明）。
   */
  blockedBy: readonly (number | string)[]
}

/** 同深度的一层票与状态细分。 */
export interface TicketLevel {
  /** 深度：没有阻塞者的票是 0，其余是「直接阻塞者深度的最大值 + 1」。 */
  level: number
  /** 这一层的票号。 */
  numbers: number[]
  /** 这一层的全部票数。 */
  total: number
  /** 这一层里未关闭的张数。 */
  open: number
  /** 这一层里已关闭的张数。 */
  closed: number
  /** 这一层里可接的张数（未关闭、没被认领、阻塞都关掉了）。 */
  frontier: number
  /** 这一层里已被认领的张数。 */
  claimed: number
  /** 这一层里被仍然开着的票阻塞的张数。 */
  blocked: number
}

/** 分层结果：逐票的深度 + 按深度归拢的层（层按深度升序、无空洞）。 */
export interface LevelsResult {
  /** 票号 → 深度。键是字符串（对象键的固有形态），值是 0 起的整数。 */
  byNumber: Record<string, number>
  /** 每层一条，按深度升序；中间没有票的深度不会出现。 */
  levels: TicketLevel[]
}

// ——— computeLevels：blockedBy DAG 最长路径深度分层（level(root)=0；level(x)=1+max(level(直接阻塞者))） ———

/**
 * 按阻塞关系给每张票算深度。
 *
 * 图由 `blockedBy` 给出（「谁阻塞我」是唯一真源，反向的「我阻塞了谁」不在这里推）。
 * 指向票池之外的票号（破链）按叶子算：查不到就当没有阻塞者，深度 0 —— 与老口径一致。
 */
export function computeLevels(tickets: readonly GroupingTicket[]): LevelsResult {
  // 票号表：每张票都在里面，所以下面查不到只可能是「阻塞者不在本批票里」。
  const byNum: Record<string, GroupingTicket> = {}
  tickets.forEach((t) => { byNum[t.number] = t })
  const memo: Record<string, number> = {}
  const levelOf = (t: GroupingTicket): number => {
    if (memo[t.number] !== undefined) return memo[t.number]
    const blockers = (t.blockedBy || []).map((b) => byNum[b]).filter(Boolean)
    if (!blockers.length) { memo[t.number] = 0; return 0 }
    let maxL = -1
    blockers.forEach((b) => { const l = levelOf(b); if (l > maxL) maxL = l })
    memo[t.number] = maxL + 1
    return memo[t.number]
  }
  const byNumber: Record<string, number> = {}
  tickets.forEach((t) => { byNumber[t.number] = levelOf(t) })
  // 先按深度就位（下标即深度，中间没票的位置留空洞），最后再压掉空洞。
  const levels: (TicketLevel | undefined)[] = []
  tickets.forEach((t) => {
    const lv = byNumber[t.number]
    let layer = levels[lv]
    if (!layer) { layer = { level: lv, numbers: [], open: 0, closed: 0, total: 0, frontier: 0, claimed: 0, blocked: 0 }; levels[lv] = layer }
    layer.numbers.push(t.number)
    layer.total++
    if (t.state === 'CLOSED') layer.closed++
    else layer.open++
  })
  // 层内状态细分（frontier/claimed/blocked 归层）
  const openBlocker = (b: number | string): boolean => { const t = byNum[b]; return t !== undefined && t.state === 'OPEN' }
  levels.forEach((layer) => {
    // 稀疏数组的空洞不会被 forEach 访问，这一句只是让编译器知道 layer 一定在。
    if (!layer) return
    const openT = tickets.filter((t) => byNumber[t.number] === layer.level && t.state === 'OPEN')
    layer.frontier = openT.filter((t) => !t.claimedBy && !t.blockedBy.some(openBlocker)).length
    layer.claimed = openT.filter((t) => t.claimedBy).length
    layer.blocked = openT.filter((t) => !t.claimedBy && t.blockedBy.some(openBlocker)).length
  })
  // 剔除空洞（levels 数组可能因跳级出现 undefined）
  const compact = levels.filter((layer): layer is TicketLevel => Boolean(layer))
  return { byNumber: byNumber, levels: compact }
}

/** 分组结果：各状态计数 + DAG 分层（面板的漏斗与层级都用这一份）。 */
export interface TicketGroups {
  total: number
  open: number
  closed: number
  frontier: number
  claimed: number
  blocked: number
  /** 按深度归拢的层，见 computeLevels。 */
  levels: TicketLevel[]
  /** 票号 → 深度。 */
  levelOf: Record<string, number>
}

// ——— groupTickets：open/closed/frontier/claimed/blocked 分组 + 附 DAG 分层（v1.4 T1 #442） ———

/**
 * 把一批票分成 open/closed/frontier/claimed/blocked 五组，并附上 DAG 分层。
 *
 * 五组里只有 open/closed 是「按状态分组」，另外三组是**可以重叠**的视角：
 * frontier 是「未关闭、认领已知且空、阻塞都关掉了」（#1 明确写着的可接票），
 * claimed 是「有人认领」，blocked 是「还有开着的票挡着」。
 */
export function groupTickets(tickets: readonly GroupingTicket[]): TicketGroups {
  const byNum: Record<string, GroupingTicket> = {}
  tickets.forEach((t) => { byNum[t.number] = t })
  const openBlocker = (b: number | string): boolean => { const t = byNum[b]; return t !== undefined && t.state === 'OPEN' }
  const open = tickets.filter((t) => t.state === 'OPEN')
  const closed = tickets.filter((t) => t.state === 'CLOSED')
  const frontier = open.filter((t) => !t.claimedBy && !t.blockedBy.some(openBlocker))
  const claimed = open.filter((t) => t.claimedBy)
  const blocked = open.filter((t) => !t.claimedBy && t.blockedBy.some(openBlocker))
  // v1.4（T1 #442）：附 DAG 分层（client 渲染漏斗分层用）
  const lv = computeLevels(tickets)
  return {
    total: tickets.length, open: open.length, closed: closed.length,
    frontier: frontier.length, claimed: claimed.length, blocked: blocked.length,
    levels: lv.levels, levelOf: lv.byNumber,
  }
}
