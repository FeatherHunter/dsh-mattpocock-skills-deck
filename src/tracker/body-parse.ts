/**
 * src/tracker/body-parse.ts —— 正文解析的纯函数叶子（宿主与客户端共用同一份）
 * 票的分组与分层（computeLevels / groupTickets）住在 src/tracker/kernel/grouping.ts（#1768 搬出）；
 * 本文件只把名字转出去，调用方 import 路径不变。
 *
 * 住处：#1148 修正了本文件开头此前一直写着的旧路径（原住 `src/shared/parser.js`）。
 * 今天的真源就是本文件：宿主侧还留着同名的内联副本，那两份副本不是真源，
 * 差分对照由 tests/verify-parse-leaf.js 钉住（叶子 === 构建产物 === 宿主内联）。
 *
 * 约束：本文件必须保持纯函数（不碰 ctx / 不碰 DOM / 无共享状态 / 不自己读文件），否则失去叶子价值。
 *
 * #1090：进度区的读与写（parseProgressDetail / parseProgress / replaceProgressSection 等）搬到了
 * src/shared/issue-file/src/progress.ts —— tracker / deck / host 三层共用那一份，本文件只把名字原样转出去，
 * 调用方的 import 路径不变。
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

// ——— parseSpecBody：规格（实施地图）七区块解析 ———

/**
 * 规格正文的七个区块：中英各一套标题，两两一组指的是同一段内容。
 * 只有这些标题能切出区块（与地图五区块同一口径：正文里讨论标题本身不算标题）。
 */
export const SPEC_SECTION_TITLES = [
  '问题陈述', 'Problem Statement',
  '解决方案', 'Solution',
  '用户故事', 'User Stories',
  '实现决策', 'Implementation Decisions',
  '测试决策', 'Testing Decisions',
  '不在范围内', 'Out of Scope',
  '补充说明', 'Further Notes',
]

/** 规格正文七个区块的解析结果。各区缺了就回空串或空数组，不回 null。 */
export interface ParsedSpecSections {
  /** `## 问题陈述` / `## Problem Statement`：要解决的是什么问题。 */
  problem: string
  /** `## 解决方案` / `## Solution`：打算怎么做。 */
  solution: string
  /** `## 用户故事` / `## User Stories`：使用者视角的场景。 */
  userStories: string[]
  /** `## 实现决策` / `## Implementation Decisions`：实现上定下来的事。 */
  implDecisions: string[]
  /** `## 测试决策` / `## Testing Decisions`：怎么算做对了。 */
  testDecisions: string[]
  /** `## 不在范围内` / `## Out of Scope`：明确不做的。 */
  outOfScope: string[]
  /** `## 补充说明` / `## Further Notes`：其余要交代的事。 */
  furtherNotes: string[]
}

/** 七段的键：顺序与 SPEC_SECTION_TITLES 的每一对一一对应。 */
const SPEC_SECTION_KEYS: (keyof ParsedSpecSections)[] = ['problem', 'solution', 'userStories', 'implDecisions', 'testDecisions', 'outOfScope', 'furtherNotes']

/**
 * 把规格正文按二级标题切成区块，取出七个区块的内容。
 * 入参收成未知值：正文可能缺席（老票、新建的票），统一按空处理。
 *
 * 与地图五区块的两点不同，说清楚免得后来人以为写错了：
 * 1. HTML 注释行一律不算内容（七段都不收）——正文首行那串隐藏标记就是注释，
 *    漏进来会污染界面上显示的段落。
 * 2. 只认行首的 `## 标题`；地图那份还处理「标题粘在上一行末尾」的写法，规格这份不处理
 *    （规格正文由写侧模板生成，标题自己占一行；真要支持粘行再说）。
 */
export function parseSpecBody(body: unknown): ParsedSpecSections {
  const out: ParsedSpecSections = {
    problem: '', solution: '', userStories: [], implDecisions: [],
    testDecisions: [], outOfScope: [], furtherNotes: [],
  }
  if (!body) return out
  // 区块名 → 该区块下的原行；## 标题行本身不入表。键统一小写（英文标题大小写不敏感）。
  const sec: Record<string, string[]> = {}
  const lines = normalizeBody(body).split(/\r?\n/)
  let cur: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s*(.+?)\s*$/)
    if (m) { cur = m[1].trim().toLowerCase(); sec[cur] = sec[cur] || []; continue }
    if (cur) sec[cur].push(lines[i])
  }
  // 中英两套标题指同一段内容；同一段两套标题都写了时，先遇到的算。
  const byKey: Record<string, string[]> = {}
  for (let k = 0; k < SPEC_SECTION_KEYS.length; k++) {
    for (const title of [SPEC_SECTION_TITLES[k * 2], SPEC_SECTION_TITLES[k * 2 + 1]]) {
      const t = title.toLowerCase()
      if (sec[t] && !byKey[SPEC_SECTION_KEYS[k]]) byKey[SPEC_SECTION_KEYS[k]] = sec[t]
    }
  }
  /** 去空白、丢空行、丢 HTML 注释行；区块没出现过时按空数组处理。 */
  const clean = (arr: string[] | undefined): string[] => (arr || []).map((s) => s.trim()).filter(Boolean).filter((l) => l.indexOf('<!--') !== 0)
  out.problem = clean(byKey['problem']).join(' ')
  out.solution = clean(byKey['solution']).join(' ')
  out.userStories = clean(byKey['userStories'])
  out.implDecisions = clean(byKey['implDecisions'])
  out.testDecisions = clean(byKey['testDecisions'])
  out.outOfScope = clean(byKey['outOfScope'])
  out.furtherNotes = clean(byKey['furtherNotes'])
  return out
}

// ——— 进度区的读与写：唯一真源搬到 `src/shared/issue-file/src/progress.ts`（#1090） ———
//
// 为什么搬走：进度原先是三份复制（本文件、面板派生 deck-derive、宿主内联 mapBody）各写一套正则，
// 写侧与读侧对不上。#1090 把它们统一到 shared 层的那一个文件；本文件只把名字原样转出去，
// 调用方（宿主、面板、deck 工具、门禁）的 import 路径不用改。
export {
  PROGRESS_BODY_LIMIT,
  parseProgressDetail,
  parseProgress,
  formatProgressEntry,
  replaceProgressSection,
  stripProgressSections,
} from '../shared/issue-file/src/progress.js'
export type { ProgressEntry, ProgressDetail } from '../shared/issue-file/src/progress.js'

// ——— 维护者原话区的读与写：唯一真源在 `src/shared/issue-file/src/original-words.ts`（#1092） ———
//
// 写侧一直只住 shared 那一份；#1092 把读一侧（parseOriginalWords）也放进同一个文件、共用同一套
// 按行扫描，保证「写进去的原话」与「读回来的原话」逐字相同。本文件只把名字转出去，调用方
// （deck 的读工具、门禁）的 import 路径统一走 tracker/body-parse，与进度区同一模式。
export { parseOriginalWords } from '../shared/issue-file/src/original-words.js'
export type { OriginalWordsDetailEntry, OriginalWordsEntry } from '../shared/issue-file/src/original-words.js'

// ─────────────────────────────────────────────────────────────────────────────
// 二、票的分组与分层：判定本体住在 src/tracker/kernel/grouping.ts（#1768 搬出）
// ─────────────────────────────────────────────────────────────────────────────
//
// 为什么搬走：这段判定随「跨容器阻塞者按引用态收口」变长，把本文件顶过 350 有效行上限（有效行口径见
// scripts/lib/effective-lines.mts）；分组与分层本来就是纯判定，不是正文解析，住共享内核更合适。
//
// 调用方的 import 路径不变：宿主装配（src/host/tracker/snapshotAssemble.ts）、deck 读工具与门禁一直按
// tracker/body-parse 取这两个函数，这里原样把名字转出去（与 #1090 进度区、#1092 原话区同一模式）。
export { computeLevels, groupTickets } from './kernel/grouping.js'
export type { BlockingRef, GroupingTicket, LevelsResult, TicketGroups, TicketLevel } from './kernel/grouping.js'
