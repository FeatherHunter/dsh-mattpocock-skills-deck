// comment-format.ts —— 评论区与结构段在 Markdown 文件里的边界判断（#1859）。
//
// 为什么单独一件：评论是「用户写的正文」，正文里可以有 `## 标题`、`### 标题`、代码围栏、
// 单独一行 `---`。过去读侧把任意 `## ` 行都当段尾、把任意 `### ` 行都当新评论，
// 写侧又用同样宽松的边界决定往哪里插，于是标题行会截断评论区、H3 会凭空多出一条伪评论、
// 追加第二条评论时还会插进上一条评论的正文中间。
//
// 这一件只吃字符串、只吐结构，不碰磁盘、不读时钟：
//   · 结构段标题只认原文模板里的已知段名（规格七段、地图五段、Question、Answer）
//     加上插件自己追加的几段（Comments、进度、维护者原话、目的）；
//   · 代码围栏里的标题不算结构；
//   · 评论头分两档：真实评论头是 `### 名字 — ISO 时间`；手写旧评论没有时间，
//     整段没有真实评论头时才退回旧切法；
//   · 评论正文只去掉「后面还有下一块」时的块尾 `---`，正文中间与围栏里的 `---` 都保留。
//
// 读侧和写侧必须共用这里的判断：读侧拿它拆评论，写侧拿它找评论区末尾。
// 两边各写一套，就会出现「写进去的位置读不回来」——#1859 的假 ## Comments 与 H2 截断都是这么来的。
//
// 已知残留（只改判断、不改磁盘格式，消不掉这些歧义；换磁盘格式才能彻底解决）：
//   · 评论正文恰好写着某个已知段名（例如单独一行 `## Answer`），仍会被当成段尾；
//   · 评论正文恰好长得像真实评论头（`### 名字 — 2026-01-01T00:00:00.000Z`），仍会被当成新评论；
//   · 正文里的假 `## Comments` 后面紧跟一行 H3、而真评论区只有手写旧头（没有 ISO 时间）时，
//     选锚仍可能选到假锚；有真实评论头时不会选错；
//   · 真实评论头之后的旧手写头（没有 ISO 时间）会被当成正文：读侧无法区分它和一行的 H3 正文，
//     写侧现在已经把新评论插到旧手写头之后或之前（见 comments.ts），不再让新头把旧头盖到后面；
//   · CRLF 文件里的正文按 LF 读回（只去掉行尾 \r），不保留原换行符；
//   · 旧数据里已经被插坏的文件，尾部评论归属无法可靠还原。
import { scanFenceLines } from './markdown-scan.js'
import {
  MAP_SECTION_TITLES,
  SPEC_SECTION_TITLES,
  WAYFINDER_ANSWER_SECTION,
  WAYFINDER_QUESTION_SECTION,
} from './format/field-values.js'
import type { Comment } from '../../contract/entities.js'

/** 插件追加的评论区标题。写侧和读侧都从这里取，不要在别处再手写一份。 */
export const COMMENTS_SECTION_TITLE = 'Comments'
/** 插件追加的进度区标题（老写法带百分比，例如 `## 进度：30%`）。 */
export const PROGRESS_SECTION_TITLE = '进度'

/** 插件自己往票文件里追加的段标题。它们不在原文模板的 objects 里，但同样不能当成评论正文。 */
const PLUGIN_SECTION_TITLES = [COMMENTS_SECTION_TITLE, PROGRESS_SECTION_TITLE, '维护者原话', '目的']

/** 所有已知结构段标题（原文模板 + 插件追加）。小写后比对，保留原写法没有意义，只用于认标题。 */
const STRUCTURAL_TITLES: string[] = (() => {
  const out: string[] = []
  for (const title of SPEC_SECTION_TITLES
    .concat(MAP_SECTION_TITLES)
    .concat([WAYFINDER_QUESTION_SECTION, WAYFINDER_ANSWER_SECTION])
    .concat(PLUGIN_SECTION_TITLES)) {
    const text = String(title || '').trim()
    if (text && out.indexOf(text.toLowerCase()) < 0) out.push(text.toLowerCase())
  }
  return out
})()
const STRUCTURAL_SET = new Set(STRUCTURAL_TITLES)

/** 去掉行尾的 \r。CRLF 文件的每一行都以 \r 收尾，正则里的 `$` 匹配不到 \r 后面的东西，
 *  所以所有认标题、认评论头的正则都要先走这一步。 */
function bareLine(line: string): string {
  const text = String(line || '')
  return text.endsWith('\r') ? text.slice(0, -1) : text
}

/** 把若干行拼回文本时去掉每行末尾的 \r：读回来的正文按 LF 表示，不带只属于文件换行的字符。 */
function joinLines(lines: string[]): string {
  return lines.map((line) => bareLine(line)).join('\n')
}

/** 二级段标题的写法：最多三个前导空格，## 后可以有零个或多个空白。
 *  允许零个空白是为了认手写旧票里的 `##Comments`（它与 `## Comments` 是同一段）；
 *  `#### 四级` 在这里会被读成正文 `# 四级`，不会命中已知段名；`# 一级` 不匹配。 */
const SECTION_HEADING_RE = /^[ \t]{0,3}##[ \t]*(.*?)[ \t]*$/

function headingTitleOf(line: string): string {
  const m = SECTION_HEADING_RE.exec(bareLine(line))
  return m ? m[1].trim() : ''
}

/** 段标题的归一写法：进度区允许带百分比后缀，其余原样返回。
 *  进度区的老写法是 `## 进度：30%`，如果按字面比标题，它就认不出来，评论会被追加到进度区后面。 */
function normalizedTitle(title: string): string {
  const text = String(title || '').trim()
  if (!text) return ''
  return /^进度(?:[ \t]*[:：].*)?$/.test(text) ? PROGRESS_SECTION_TITLE : text
}

/** 这一行是不是已知结构段的标题；是就返回归一后的标题，不是返回空串。 */
function structuralTitleOf(line: string): string {
  const title = normalizedTitle(headingTitleOf(line))
  return title && STRUCTURAL_SET.has(title.toLowerCase()) ? title : ''
}

/** 从 from 开始，下一个**已知结构段**标题的行号；找不到回 lines.length。
 *  只认已知段名，不认任意二级标题：评论正文里的 `## 结论` 是内容，不是段尾。
 *  skipTitle 给定时跳过同名标题：正文里恰好写着一行 `## Answer`，不能被当成 Answer 段的结束。 */
export function nextStructuralHeadingIndex(lines: string[], from: number, skipTitle?: string): number {
  const start = Math.max(0, from)
  const skip = normalizedTitle(skipTitle || '').toLowerCase()
  const fences = scanFenceLines(lines.join('\n'))
  for (let i = start; i < lines.length; i++) {
    if (fences[i] && fences[i].fenced) continue
    const title = structuralTitleOf(lines[i]).toLowerCase()
    if (title && title !== skip) return i
  }
  return lines.length
}

/** 某一段在整份文件里的范围：start 是标题行，end 是下一个已知结构段或文末。
 *  同名标题出现在正文里时，它不算段尾；预览、改正文、关票都走这一份范围。
 *  评论区特殊：手写旧票的正文里可能先有一个假 `## Comments`，选锚时要跳到后面真正带评论的那一个。 */
export function sectionRangeOf(text: string, title: string): { start: number; end: number } | null {
  const raw = String(text || '')
  const want = normalizedTitle(title).toLowerCase()
  if (!want) return null
  const lines = raw.split('\n')
  const fences = scanFenceLines(raw)
  const candidates: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (fences[i] && fences[i].fenced) continue
    if (structuralTitleOf(lines[i]).toLowerCase() === want) candidates.push(i)
  }
  if (!candidates.length) return null
  let start = candidates[0]
  if (want === COMMENTS_SECTION_TITLE.toLowerCase()) {
    // 判断「哪个候选才是真评论区」：从候选标题到下一个结构标题之间有没有评论头。
    // 真实评论头（`### 名字 — ISO 时间`）比手写旧头可信，先找它 —— 假锚后面紧跟的正文里
    // 可能恰好有一行 H3 会被当成手写旧头判据命中，真实头能把这种假锚排除掉。
    // 整份文件都没有真实头（纯手写旧票）时，退回「第一个带任意评论头的候选」，保住旧票。
    const ranges = candidates.map((at) => ({ at, end: nextStructuralHeadingIndex(lines, at + 1) }))
    const strong = ranges.find((one) => hasStrongCommentHeader(lines, fences, one.at + 1, one.end))
    const real = strong || ranges.find((one) => hasCommentHeader(lines, fences, one.at + 1, one.end))
    if (real) start = real.at
  }
  return { start, end: nextStructuralHeadingIndex(lines, start + 1, title) }
}

/** 评论区的范围；没有评论区回 null。 */
export function commentsSectionRange(text: string): { start: number; end: number } | null {
  return sectionRangeOf(text, COMMENTS_SECTION_TITLE)
}

/** 某段的内容（不含标题），去首尾空白；没有这一段回空串。 */
export function sectionTextOf(text: string, title: string): string {
  const raw = String(text || '')
  const range = sectionRangeOf(raw, title)
  if (!range) return ''
  return joinLines(raw.split('\n').slice(range.start + 1, range.end)).trim()
}

/** 某段整段（含标题），去首尾空白；没有这一段回空串。整份改正文时用它把盘上旧段原样搬回。 */
export function sectionBlockOf(text: string, title: string): string {
  const raw = String(text || '')
  const range = sectionRangeOf(raw, title)
  if (!range) return ''
  return joinLines(raw.split('\n').slice(range.start, range.end)).trim()
}

/** 真实评论头的形状：`### <名字> — <ISO 时间>`（分隔符也接受连字符与短破折号）。
 *  只认这一种，正文里不带时间的 `### 三级标题` 因此不会被当成新评论。 */
const COMMENT_HEADER_RE = /^###[ \t]+(.+?)[ \t]+[\u2014\u2013-][ \t]+(\d{4}-\d{2}-\d{2}(?:T[^\s]*)?)[ \t]*$/

export interface CommentHeader {
  login: string
  createdAt: string
}

function strongHeaderOf(line: string): CommentHeader | null {
  const m = COMMENT_HEADER_RE.exec(bareLine(line))
  if (!m) return null
  return {
    login: m[1].trim() || 'local',
    // 只有带 T 的完整时间才算 createdAt；只写日期的旧头保持旧行为，回落文件创建时间。
    createdAt: m[2].indexOf('T') >= 0 ? m[2] : '',
  }
}

/** 旧手写评论头（没有 ISO 时间）：沿用旧读法的宽容切法，保住旧数据。 */
function weakHeaderOf(line: string): CommentHeader | null {
  const text = bareLine(line)
  if (!/^###[ \t]+/.test(text)) return null
  const header = text.replace(/^###[ \t]+/, '').trim()
  if (!header) return null
  const emDash = header.indexOf('\u2014')
  const hyphen = header.indexOf('-')
  const sep = emDash >= 0 ? emDash : hyphen
  let login = 'local'
  let createdAt = ''
  if (sep >= 0) {
    login = header.slice(0, sep).trim() || 'local'
    const datePart = header.slice(sep + 1).trim()
    const iso = /\d{4}-\d{2}-\d{2}T/.test(datePart) ? datePart.match(/\d{4}-\d{2}-\d{2}T[^ \n]+/)?.[0] : ''
    if (iso) createdAt = iso
  } else {
    login = header.split(/\s+/)[0] || 'local'
  }
  return { login, createdAt }
}

/** 某段区间里有没有评论头（真实头或手写头，都要求围栏外）。用于给评论区选锚。 */
function hasCommentHeader(lines: string[], fences: { fenced: boolean }[], from: number, to: number): boolean {
  for (let i = Math.max(0, from); i < to && i < lines.length; i++) {
    if (fences[i] && fences[i].fenced) continue
    if (strongHeaderOf(lines[i]) || weakHeaderOf(lines[i])) return true
  }
  return false
}

/** 某段区间里有没有真实评论头（`### 名字 — ISO 时间`，围栏外）。选锚时它比手写旧头可信。 */
function hasStrongCommentHeader(lines: string[], fences: { fenced: boolean }[], from: number, to: number): boolean {
  for (let i = Math.max(0, from); i < to && i < lines.length; i++) {
    if (fences[i] && fences[i].fenced) continue
    if (strongHeaderOf(lines[i])) return true
  }
  return false
}

export interface CommentStart {
  /** 评论头在整份文件里的行号。 */
  at: number
  header: CommentHeader
  /** true 表示 `### 名字 — ISO 时间` 这种真实评论头；false 表示手写旧头。 */
  strong: boolean
}

/** 评论区里每条评论的起始行。真实头存在时，只把第一个真实头之前的旧手写头也算进来；
 *  第一个真实头之后的 `###` 一律当正文，否则正文里的 H3 会凭空多出一条评论。
 *  整段没有真实头时，退回旧手写头的切法，保住旧票。 */
export function commentStartsOf(text: string): CommentStart[] {
  const raw = String(text || '')
  const range = commentsSectionRange(raw)
  if (!range) return []
  const lines = raw.split('\n')
  const fences = scanFenceLines(raw)
  const strongAt: number[] = []
  const weakAt: number[] = []
  for (let i = range.start + 1; i < range.end; i++) {
    if (fences[i] && fences[i].fenced) continue
    if (strongHeaderOf(lines[i])) strongAt.push(i)
    else if (weakHeaderOf(lines[i])) weakAt.push(i)
  }
  const starts: CommentStart[] = []
  if (strongAt.length) {
    const firstStrong = strongAt[0]
    for (const at of weakAt) {
      if (at >= firstStrong) continue
      const header = weakHeaderOf(lines[at])
      if (header) starts.push({ at, header, strong: false })
    }
    for (const at of strongAt) {
      const header = strongHeaderOf(lines[at])
      if (header) starts.push({ at, header, strong: true })
    }
    starts.sort((a, b) => a.at - b.at)
  } else {
    for (const at of weakAt) {
      const header = weakHeaderOf(lines[at])
      if (header) starts.push({ at, header, strong: false })
    }
  }
  return starts
}

/** 一条评论的正文：从头的下一行到下一个评论头/段尾。
 *  hasBlockAfter 为 true 时去掉块尾最后一个围栏外的单独 `---`（旧文件用它分隔两条评论）；
 *  正文最后一块后面没有后继时保留它 —— 写作侧从不生成这条线，不能把用户写的横线当分隔符吃掉。
 *  正文中间与围栏里的 `---` 一律保留。 */
function commentBodyOf(
  lines: string[],
  fences: { fenced: boolean }[],
  from: number,
  to: number,
  hasBlockAfter: boolean,
): string {
  let start = from
  let end = to
  while (start < end && bareLine(lines[start]).trim() === '') start += 1
  while (end > start && bareLine(lines[end - 1]).trim() === '') end -= 1
  if (hasBlockAfter && end > start) {
    const last = bareLine(lines[end - 1])
    if (/^---[ \t]*$/.test(last) && (!fences[end - 1] || !fences[end - 1].fenced)) {
      end -= 1
      while (end > start && bareLine(lines[end - 1]).trim() === '') end -= 1
    }
  }
  return joinLines(lines.slice(start, end)).trim()
}

/** 读评论：结构段范围 + 真实评论头。没有真实评论头时退回旧手写头的切法，保住旧票。 */
export function parseComments(text: string, meta?: { createdAt?: string; updatedAt?: string }): Comment[] {
  const raw = String(text || '')
  const range = commentsSectionRange(raw)
  if (!range) return []
  const lines = raw.split('\n')
  const fences = scanFenceLines(raw)
  const starts = commentStartsOf(raw)
  const out: Comment[] = []
  for (let i = 0; i < starts.length; i++) {
    const one = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1].at : range.end
    const hasBlockAfter = i + 1 < starts.length || range.end < lines.length
    const createdAt = one.header.createdAt || (meta && meta.createdAt) || ''
    out.push({
      author: { login: one.header.login },
      authorAssociation: '',
      body: commentBodyOf(lines, fences, one.at + 1, end, hasBlockAfter),
      createdAt,
      updatedAt: one.header.createdAt || (meta && meta.updatedAt) || '',
    })
  }
  return out
}
