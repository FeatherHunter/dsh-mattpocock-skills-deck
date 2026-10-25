// original-fields.ts —— 原文布局（手写技能模板）里的字段行与文件头隐藏注释，怎么写、写到哪。
//
// 为什么单独一个模块（#1489）：同一个 Markdown 后端要同时伺候两种文件。
//  1. 原文布局：技能自己建的文件，可见正文严格照原文模板 —— 实施票的状态是加粗的 `**Status:**` 行，
//     地图子票是裸的 `Type:` / `Status:` / `Blocked by:` 行，容器（规格、探索地图）正文里没有状态行。
//     插件需要而原文没有的信息（认领人、标签、幂等键、创建时间、父子与阻塞边、容器标题）一律放在
//     文件头（第一个可见标题之前）的 HTML 注释里，一行一条。规格与地图没有一级标题，
//     它们的第一个可见标题就是正文的第一个段标题（「## Problem Statement」/「## Destination」）。
//  2. 旧布局：本票之前建的文件，可见行是裸的 `Status:` / `Assignees:` 行。旧文件的行为一个字都不能变
//     （既有门禁钉着），所以这里只提供原文布局用的原语，旧行为仍走 issues-status.ts 里的 replaceOrInsertField。
//
// 这个模块只碰文本，不读盘、不判身份：身份（是不是 00 号容器、在哪张地图下）由调用方按目录与编号决定。
//
// 三个容易踩的点，写在这里免得下次改坏：
//  · 隐藏注释的「行在、值为空」与「没有这一行」不是一回事：空名单要读成明确的空，缺行才回落到目录结构推断。
//  · 字段行只认第一个二级标题之前：评论正文里出现的 `**Status:**` 是内容，不是字段。
//  · 只改该改的那一行/那一段；没改出差异就不该产生写盘（调用方按文本是否变化判断）。

/** 文件属于原文哪种形状。'legacy' 表示认不出原文布局，调用方要保持旧行为。 */
export type TicketForm = 'impl-ticket' | 'map-ticket' | 'legacy'

/** 文件头隐藏注释的名称（原文没有这些信息，插件自己加的）。 */
export type HiddenName =
  | 'DSH-FORMAT'
  | 'DSH-TITLE'
  | 'DSH-STATUS'
  | 'DSH-PARENT'
  | 'DSH-ASSIGNEES'
  | 'DSH-LABELS'
  | 'DSH-BLOCKED-BY'
  | 'DSH-IDEMPOTENCY-KEY'
  | 'DSH-CREATED'

import { IMPL_TICKET_FIELD_LABELS, WAYFINDER_TOP_LINE_LABELS, MAP_TICKET_TYPES, regexAlt } from './format/field-values.js'

const HIDDEN_LINE_RE = /^[ \t]*<!--[ \t]*(DSH-[A-Z0-9-]+)[ \t]*:[ \t]*(.*?)[ \t]*-->[ \t]*$/i
const H1_RE = /^#[ \t]+\S/
const H2_RE = /^##[ \t]+\S/
// 字段行认哪几个名只从 YAML 真源读（field-values.ts）：上游改模板加字段，这里自动跟上，不再手抄第二份。
const BOLD_FIELD_RE = new RegExp('^[ \\t]*\\*\\*(' + regexAlt(IMPL_TICKET_FIELD_LABELS) + ')[ \\t]*[:：][ \\t]*\\*\\*', 'm')
const BARE_FIELD_RE = new RegExp('^[ \\t]*(' + regexAlt(WAYFINDER_TOP_LINE_LABELS) + ')[ \\t]*[:：]')

/** 段标题行：完全匹配 `## <title>`，前后不许有别的内容（认段只用这一种写法）。 */
function sectionHeadingIndex(lines: string[], title: string): number {
  const re = new RegExp('^##[ \\t]+' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*$')
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i
  return -1
}
/** 任意二级及以下段标题：段落到哪里结束就看它。 */
function anySectionIndex(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) if (H2_RE.test(lines[i])) return i
  return lines.length
}

/** 文件头范围：第一个可见标题之前。隐藏注释只写在这里（与 parse.ts 的 hiddenHeaderValue 同一口径）。
 *  先认一级标题（旧 deck 文件与票形都有），没有一级标题再认第一个二级标题 —— 规格与地图的原文模板
 *  没有标题行，正文第一个段标题就是「## Problem Statement」/「## Destination」；不这样兜底的话，
 *  无一级标题的文件会被当成「整份都是文件头」，正文里的同名注释就会被误读成文件头信息。 */
function headerEnd(text: string): number {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) if (H1_RE.test(lines[i])) return i
  for (let i = 0; i < lines.length; i++) if (H2_RE.test(lines[i])) return i
  return lines.length
}

/** 文件头之后的第一行：第一个可见标题（一级优先，其次二级）的下一行；都没有就是第 0 行。
 *  新补的字段行落在文件头与正文之间，不落在正文里（无一级标题时也一样）。 */
function afterHeaderLine(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) if (H1_RE.test(lines[i])) return i + 1
  for (let i = 0; i < lines.length; i++) if (H2_RE.test(lines[i])) return i + 1
  return 0
}

/** 字段行范围：第一个二级标题之前。评论/回答段里的同款文字是内容，不能当字段改。 */
function fieldEnd(text: string): number {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) if (H2_RE.test(lines[i])) return i
  return lines.length
}

/** 字段名里的空白得允许任意多个空格（`Blocked by`），其余字符原样转义。 */
function namePattern(name: string): string {
  return String(name)
    .split(/\s+/)
    .map(function (one) {
      return one.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('[ \\t]+')
}

/** 判定文件形状：只看文件内容，不探目录。
 *  顺序有讲究：加粗字段行最硬（原文实施票模板），其次是地图子票的 `## Question`（wayfinder/SKILL.md:57-63），
 *  再退到裸 `Type:` 行（issue-tracker-local.md:26 的手写地图子票），都认不出就是旧布局，保持旧行为。 */
export function ticketFormOf(text: string): TicketForm {
  const raw = String(text || '')
  const head = raw.split('\n').slice(0, fieldEnd(raw)).join('\n')
  if (BOLD_FIELD_RE.test(head)) return 'impl-ticket'
  if (/^##[ \t]+Question[ \t]*$/im.test(raw)) return 'map-ticket'
  // 手写地图子票的特征是「# NN: 标题」+ 裸 Type 行（issue-tracker-local.md:26）。只看裸 Type 行会误伤旧布局：
  // 旧布局的票文件同样写 `Type: task`，但标题形状是 `# <标题>`、没有编号前缀，所以两个条件都要满足。
  // 类型词的取值只从 YAML 真源读（与创建侧同一份）。
  const bareType = new RegExp('^[ \\t]*' + namePattern('Type') + '[ \\t]*[:：][ \\t]*(' + regexAlt(MAP_TICKET_TYPES) + ')\\s*$', 'im').test(raw)
  if (bareType && /^#[ \\t]*\d{1,3}[ \\t]*:/.test(raw)) return 'map-ticket'
  if (hiddenCommentOf(raw, 'DSH-FORMAT').found) return 'impl-ticket'
  return 'legacy'
}

/** 读文件头隐藏注释，返回值同时给出「有没有这一行」。
 *  为什么不能只用值：空名单（`<!-- DSH-ASSIGNEES:  -->`）是明确的空，缺行才是不知道、要回落到目录结构推断。 */
export function hiddenCommentOf(text: string, name: string): { found: boolean; value: string } {
  const lines = String(text || '').split('\n')
  const end = headerEnd(String(text || ''))
  for (let i = 0; i < end; i++) {
    const m = HIDDEN_LINE_RE.exec(lines[i])
    if (m && m[1].toUpperCase() === String(name).toUpperCase()) return { found: true, value: String(m[2] || '').trim() }
  }
  return { found: false, value: '' }
}

/** 改文件头隐藏注释：已有就整行换；没有就补在最后一条隐藏注释后面。
 *  value 为 null 就删掉这一行（空名单的行可以留着，删行表示「恢复成原文没有的样子」，由调用方选）。
 *  新补的行一定落在第一个可见标题之前：原文的可见正文从标题开始，插件信息不能混进正文。 */
export function upsertHiddenComment(text: string, name: string, value: string | null): string {
  const raw = String(text || '')
  const lines = raw.split('\n')
  const end = headerEnd(raw)
  const want = String(name).toUpperCase()
  const line = value === null || value === undefined
    ? ''
    : value === ''
      ? '<!-- ' + want + ':  -->'
      : '<!-- ' + want + ': ' + String(value).trim() + ' -->'
  for (let i = 0; i < end; i++) {
    const m = HIDDEN_LINE_RE.exec(lines[i])
    if (!m || m[1].toUpperCase() !== want) continue
    // 已有这一行：删行就是去掉整行，不留下空行（空行会让「文件头有多少注释」数错）。
    if (line === '') lines.splice(i, 1)
    else lines[i] = line
    return lines.join('\n')
  }
  if (line === '') return raw
  // 补行位置：最后一条隐藏注释后面；文件里一条都没有就补在第一行（也就是第一个可见标题之前）。
  let at = 0
  for (let i = 0; i < end; i++) if (HIDDEN_LINE_RE.test(lines[i])) at = i + 1
  lines.splice(at, 0, line)
  return lines.join('\n')
}

/** 读加粗字段行（原文实施票模板 `**Status:** ...`）。只认第一个二级标题之前。 */
export function boldFieldOf(text: string, name: string): { found: boolean; value: string } {
  const raw = String(text || '')
  const lines = raw.split('\n')
  const end = fieldEnd(raw)
  const re = new RegExp('^[ \\t]*\\*\\*' + namePattern(name) + '[ \\t]*[:：][ \\t]*\\*\\*[ \\t]*(.*?)[ \\t]*$', 'i')
  for (let i = 0; i < end; i++) {
    const m = re.exec(lines[i])
    if (m) return { found: true, value: String(m[1] || '').trim() }
  }
  return { found: false, value: '' }
}

/** 原地换加粗字段行的值；缺这一行才补，补在加粗字段块的末尾（与原文模板的字段顺序一致，
 *  也避免插进标题与正文之间 —— 下一次改正文会把它当正文重写掉，见 issues-status.ts 的 #1174 注释）。 */
export function replaceBoldField(text: string, name: string, value: string): string {
  const raw = String(text || '')
  const lines = raw.split('\n')
  const end = fieldEnd(raw)
  const re = new RegExp('^[ \\t]*\\*\\*' + namePattern(name) + '[ \\t]*[:：][ \\t]*\\*\\*.*$', 'i')
  for (let i = 0; i < end; i++) {
    if (re.test(lines[i])) {
      lines[i] = '**' + name + ':** ' + String(value).trim()
      return lines.join('\n')
    }
  }
  let last = -1
  for (let i = 0; i < end; i++) if (BOLD_FIELD_RE.test(lines[i])) last = i
  let at = last >= 0 ? last + 1 : afterHeaderLine(lines)
  // 字段之间原文是一行空行：插在空行后面，不贴着上一行写。
  if (at < lines.length && lines[at].trim() === '') at += 1
  lines.splice(at, 0, '**' + name + ':** ' + String(value).trim())
  return lines.join('\n')
}

/** 读裸字段行（地图子票的 `Type:` / `Status:` / `Blocked by:`）。只认第一个二级标题之前。 */
export function bareFieldOf(text: string, name: string): { found: boolean; value: string } {
  const raw = String(text || '')
  const lines = raw.split('\n')
  const end = fieldEnd(raw)
  const re = new RegExp('^[ \\t]*' + namePattern(name) + '[ \\t]*[:：][ \\t]*(.*?)[ \\t]*$', 'i')
  for (let i = 0; i < end; i++) {
    const m = re.exec(lines[i])
    if (m) return { found: true, value: String(m[1] || '').trim() }
  }
  return { found: false, value: '' }
}

/** 原地换裸字段行的值；缺这一行才补，补在裸字段块末尾。 */
export function replaceBareField(text: string, name: string, value: string): string {
  const raw = String(text || '')
  const lines = raw.split('\n')
  const end = fieldEnd(raw)
  const re = new RegExp('^[ \\t]*' + namePattern(name) + '[ \\t]*[:：].*$', 'i')
  for (let i = 0; i < end; i++) {
    if (re.test(lines[i])) {
      lines[i] = name + ': ' + String(value).trim()
      return lines.join('\n')
    }
  }
  let last = -1
  for (let i = 0; i < end; i++) if (BARE_FIELD_RE.test(lines[i])) last = i
  let at = last >= 0 ? last + 1 : afterHeaderLine(lines)
  if (at < lines.length && lines[at].trim() === '') at += 1
  lines.splice(at, 0, name + ': ' + String(value).trim())
  return lines.join('\n')
}

/** 去掉裸字段行（地图子票解除认领、清空阻塞边时用）。
 *  删完把因此多出来的空行收掉一行，别在正文里留两个连续空行。 */
export function removeBareField(text: string, name: string): string {
  const raw = String(text || '')
  const lines = raw.split('\n')
  const end = fieldEnd(raw)
  const re = new RegExp('^[ \\t]*' + namePattern(name) + '[ \\t]*[:：].*$', 'i')
  for (let i = 0; i < end; i++) {
    if (!re.test(lines[i])) continue
    lines.splice(i, 1)
    if (i > 0 && i < lines.length && lines[i - 1].trim() === '' && lines[i].trim() === '') lines.splice(i, 1)
    return lines.join('\n')
  }
  return raw
}

/** 把一段内容追加到 `## <title>` 段的末尾；没有这个段就在文末新建。
 *  原文对评论的位置只有一句「append to the bottom of the file under a ## Comments heading」
 *  （issue-tracker-local.md:11），所以同一段里也是往后接，不插到最前面。
 *  新建段落在文件末尾时，如果 `## 进度` 已经是最后一段，就插在进度区前面：
 *  进度是插件追加的时间线，位置固定在末尾，读者往下翻先看到评论、最后才是进度。 */
export function appendSectionBlock(text: string, title: string, block: string): string {
  const raw = String(text || '')
  const body = String(block || '').trim()
  if (!body) return raw
  const lines = raw.split('\n')
  const start = sectionHeadingIndex(lines, title)
  const blockLines = body.split('\n')
  if (start >= 0) {
    const end = anySectionIndex(lines, start + 1)
    let at = end
    while (at > start + 1 && lines[at - 1].trim() === '') at -= 1
    lines.splice(at, 0, '', ...blockLines)
    return lines.join('\n')
  }
  // 没有这个段：新建。先看整份文件是不是以进度区收尾，是就插在它前面。
  const progressAt = sectionHeadingIndex(lines, '进度')
  if (progressAt > 0) {
    let at = progressAt
    while (at > 0 && lines[at - 1].trim() === '') at -= 1
    lines.splice(at, 0, '', '## ' + title, '', ...blockLines)
    return lines.join('\n')
  }
  let at = lines.length
  while (at > 0 && lines[at - 1].trim() === '') at -= 1
  lines.splice(at, 0, '', '## ' + title, '', ...blockLines)
  return lines.join('\n')
}

/** 本插件当前认得的 DSH-FORMAT 版本（#1499）。
 *
 *  为什么只有一个值：`src/tracker/rooms/markdown/format/original-skills.yaml` 的
 *  `upgrade.schema-version` 今天就是 `md-v1`，生成物 `format/generated.ts` 的同一格也是它。
 *  文件头里写着别的版本号（例如手写了一个 `md-v2`）时，读路径今天只能按 `md-v1` 的口径解析 ——
 *  不认得的那一行不能静默当成认得，必须在日志里留一条线（见 issues-read.ts 的 `bad-format` 两档）。
 *  支持新版本时先把这个表与取值表一起加，再把解析口径一起升级，不要只改一边。 */
export const SUPPORTED_DSH_FORMATS = Object.freeze(['md-v1'] as const)

/** 读文件头里的 DSH-FORMAT 版本（#1499）：有这一行就返回值（去掉首尾空白），没有就回空串。
 *
 *  只看有没有这一行，不判形状：`ticketFormOf` 已经用同一行的「有没有」认原文布局，
 *  这里只把值拿出来给调用方比对。不认得的值由调用方记 `bad-format`，这里不抛错。 */
export function dshFormatOf(text: unknown): string {
  const got = hiddenCommentOf(String(text || ''), 'DSH-FORMAT')
  if (!got.found) return ''
  return String(got.value || '').trim()
}

/** 这个文件的 DSH-FORMAT 版本认不认得（#1499）。
 *
 *  没有这一行的不算坏：旧布局的老文件本来就没有版本号，按旧口径读是既有行为（照旧，不记日志）。
 *  只有「写了版本号、但不在 SUPPORTED_DSH_FORMATS 里」才算坏，需要调用方留一条 `bad-format`。 */
export function isSupportedDshFormat(text: unknown): boolean {
  const v = dshFormatOf(text)
  if (!v) return true
  return (SUPPORTED_DSH_FORMATS as readonly string[]).includes(v)
}

/** 把 `## 进度` 区整段搬到文件末尾。
 *  为什么：共享进度机制（src/shared/issue-file/src/progress.ts）为 GitHub 后端设计，把进度区插在
 *  第一个字段行或 Comments/Answer 段之前；原文对本地文件只说「评论追加到文件底部」，插件自己追加的
 *  进度应该长在最后，读者按时间顺序翻下来正好看到最新进度。
 *  这里只搬位置、不改内容，也不改共享机制本身（GitHub 行为零变化）。
 *  已经在末尾或没有进度区就原样返回，调用方据此判断要不要写盘。 */
export function relocateProgressToEnd(text: string): string {
  const raw = String(text || '')
  const lines = raw.split('\n')
  const start = sectionHeadingIndex(lines, '进度')
  if (start < 0) return raw
  const end = anySectionIndex(lines, start + 1)
  if (end >= lines.length) return raw
  const section = lines.slice(start, end)
  while (section.length > 1 && section[section.length - 1].trim() === '') section.pop()
  // 其余正文保持原顺序，去掉末尾空行后再把进度段接在最后。
  const rest = lines.slice(0, start).concat(lines.slice(end))
  while (rest.length && rest[rest.length - 1].trim() === '') rest.pop()
  const out = rest.concat(['', ...section])
  if (raw.endsWith('\n')) out.push('')
  return out.join('\n')
}
