// create-render.ts —— Markdown 后端「按原文形状」渲染正文与文件头（#1486，父票 #1480）。
//
// 原文（随包 to-spec / to-tickets / issue-tracker-local）把票放成：
//   .scratch/<feature-slug>/spec.md                  规格
//   .scratch/<feature-slug>/issues/NN-<slug>.md      实施票、普通票
//   .scratch/<effort>/map.md                         探索地图（容器，编号 00）
//   .scratch/<effort>/issues/NN-<slug>.md            地图子票（问句 + Type/Status/Blocked by 裸行）
// 本文件只把建票输入渲染成文件内容；选目录、取号、写盘在 create-layout.ts。
//
// 不能改的约定：
//   1. 可见正文只放原文模板内容。插件自己的状态与关系一律写进隐藏注释，一行一条，全部放在
//      第一个一级标题之前；顺序按 format/original-skills.yaml 的 hidden-comments 表。
//   2. 实施票的标题写成 `# NN: 标题`，字段行写成 `**What to build:**` / `**Blocked by:**` / `**Status:**`，
//      验收项原样保留 `- [ ]`；不要再写旧布局的 `## Comments` / `## Answer` 骨架。
//   3. 幂等键写成 DSH-IDEMPOTENCY-KEY 隐藏注释；建票时间写成 DSH-CREATED，供复用与排序。
import { stripLabelDecoration, loginOfAssignee } from './parse.js'
import { markerKindAtStart, markerKindInHeader, stripMarkerLines } from '../../../shared/issue-file/src/marker.js'
import { MD_FORMAT } from './format/generated.js'
// #1500 S5：类型词与 wayfinder 标签正则都只从 YAML 真源读（field-values.ts 唯一派生点）。
import { MAP_TICKET_TYPES, WAYFINDER_LABEL_RE } from './format/field-values.js'
// 「哪一行算围栏、哪一行算二级标题」统一从 markdown-scan.ts 取：模板判据（template-guard.ts）也要判同一件事，
// 两处各写一份正则会各说各话。
import { isFenceLine, isHeadingTwoLine } from './markdown-scan.js'
import type { CreateInput, LabelInput } from '../../contract/inputs.js'

/** 本文件负责的六种对象。规格与实施票/普通票先落（#1486）；探索地图与地图子票本票接上（#1487）。 */
export type OriginalKind = 'spec' | 'spec-ticket' | 'issue' | 'bug' | 'map' | 'map-ticket'

/** 建票输入的实际形状：契约只收小写子集，运行时还会带大小写写法、状态行与阻塞行。 */
export type CreateView = Omit<CreateInput, 'labels'> & {
  labels?: LabelInput[] | string
  Type?: unknown
  Labels?: unknown
  status?: unknown
  blockedBy?: unknown
  kind?: unknown
  typeLine?: unknown
}

/** 失败结果与 issues-create.ts 里的 CreateFailure 同形，调用方不必再翻译一次。 */
export interface LayoutFailure {
  ok: false
  error: { kind: string; message: string; raw: string }
}

/** 建票用的时间：本房既有做法就是取真实时钟（comments.ts 那条评论时间同款）。 */
export function nowIso(): string {
  return new Date().toISOString()
}

export function viewOf(input: CreateInput): CreateView {
  return input as CreateView
}

/** 调用方有没有明确说这次是实施票（deck 工具会在正文最前面写一行 ticket 标记）。 */
function markerKindOf(input: CreateInput): 'spec' | 'ticket' | '' {
  const body = input.body ? String(input.body) : ''
  const atStart = markerKindAtStart(body)
  if (atStart === 'spec' || atStart === 'ticket') return atStart
  const inHeader = markerKindInHeader(body)
  return inHeader === 'spec' || inHeader === 'ticket' ? inHeader : ''
}

/** 判断这次按原文六种形状里的哪一种落盘：返回不会是空（#1500 S4 起旧分支已删，没有「不认识就走旧路」这一档）。 */
export function originalKindOf(input: CreateInput): OriginalKind {
  const v = viewOf(input)
  const explicit = String(v.kind || v.type || v.Type || '').trim().toLowerCase()
  const typeLine = String(v.typeLine || '').toLowerCase()
  const marker = markerKindOf(input)
  // 地图子票在原文里靠一行 `Type: research|prototype|grilling|task` 记类型，但它和普通票的契约自定
  // 字段 type（G4 契约里普通票也能传 type: 'task'）在字符串上分不开，只能认专用通道 typeLine
  // （deck 工具为地图子票单独传这个字段，其余位置传空串）。专用通道里写了未知的值，说明调用方
  // 既不是子票也不是已知类型，一律按普通票走新布局（#1500 S4：旧分支已删，不再回旧路）。
  if (typeLine) return MAP_TICKET_TYPES.indexOf(typeLine) >= 0 ? 'map-ticket' : 'issue'
  if (explicit === 'spec' || marker === 'spec') return 'spec'
  if (explicit === 'spec-ticket' || explicit === 'ticket' || marker === 'ticket') return 'spec-ticket'
  if (explicit === 'bug') return 'bug'
  // 原文的探索地图是顶层容器：正好占一个目录里的 map.md（与规格同款，key 为 00）。
  if (explicit === 'map') return 'map'
  // 契约里没有这四个值的位置：普通票的 type 可以随手写 'task'，与地图子票的类型词同名，
  // 没有专用通道时不能据此改渲染形状，一律按普通票走新布局（#1500 S4：旧分支已删，不再回旧路）。
  if (MAP_TICKET_TYPES.indexOf(explicit) >= 0) return 'issue'
  // 调用方明说了这是普通票（契约 kind/type = issue）时，顺带带的 wayfinder 标签只是一枚标签：
  // #1413 的夹具就有一条「普通票 + wayfinder:research」的输入，它要按普通票写、不能有 Type 行；
  // 地图子票由 deck 工具单独传 typeLine 认出来，不靠标签猜。
  if (explicit === 'issue' || explicit === 'plain-issue') return 'issue'
  // 调用点只给了一枚 wayfinder:<类型> 标签、没给 typeLine 时也认成地图子票：
  // 那枚标签是原文给子票定的类型标记，别的对象不会带它（类型词的取值只从 YAML 真源读）。
  if (labelsOf(v).some((label) => WAYFINDER_LABEL_RE.test(label))) return 'map-ticket'
  return 'issue'
}

/**
 * 原文模板里与建票有关的字段。模板文字只从 generated.ts 的 MD_FORMAT 取，
 * 代码里不再抄一份标题形状与字段行；模板改了这里自动跟着改。
 */
// 下面这些通用件同时被 map-render.ts 复用（同一渲染管线的内部件），导出只是给同目录的实现文件用。
export interface ObjectShape {
  /** 可见一级标题形状：只有票形（实施票、地图子票）有；规格与地图的原文模板没有标题行。 */
  'title-shape'?: string
  /** 规格与地图的标题落在哪条文件头隐藏注释里（原文模板没有标题行，标题是 tracker 的 issue 上的）。 */
  'title-comment'?: string
  sections?: readonly string[]
  fields?: readonly { label: string; 'line-shape': string }[]
  acceptance?: string
  status?: { 'visible-line'?: boolean; 'hidden-comment'?: string; default?: string }
  reuse?: string
  /** 地图子票的正文只有一个问题段，段名从模板取（原文是 Question）。 */
  'body-section'?: string
  /** 地图子票标题下要写的裸行：Type / Status / Blocked by；值位只出现在 line-shape 里。 */
  'top-lines'?: readonly { label: string; values?: readonly string[]; 'line-shape'?: string }[]
}

const OBJECT_KEY_OF_KIND: Record<OriginalKind, string> = {
  spec: 'spec',
  'spec-ticket': 'implementation-ticket',
  issue: 'plain-issue',
  bug: 'plain-issue',
  map: 'map',
  'map-ticket': 'wayfinder-child',
}

/** 普通票按原文的 `reuse` 指到实施票模板；其余对象直接取自己那一份。 */
export function objectShapeOf(kind: OriginalKind): ObjectShape {
  const objects = MD_FORMAT.objects as unknown as Record<string, ObjectShape>
  const first = objects[OBJECT_KEY_OF_KIND[kind]]
  if (first && first.reuse && objects[first.reuse]) return objects[first.reuse]
  return first
}

/** 把标题形状里的占位符按顺序换成实际值：`# <NN>: <票标题>` → `# 01: 标题`。 */
export function shapeTitle(shape: string, values: string[]): string {
  let at = 0
  return String(shape || '').replace(/<[^>]*>/g, () => (at < values.length ? values[at++] : ''))
}

/** 字段行只抄模板里的「标签 + 冒号」前缀，值由这次建票的内容填。 */
export function fieldLine(shape: string, value: string): string {
  const text = String(shape || '')
  const at = text.indexOf('<')
  return (at >= 0 ? text.slice(0, at) : text) + value
}

/** 隐藏注释模板里的值位是 `<>`，不是注释自己的 `<!--`；值位可能写成 `<>[, <>]`，整段换成一个值。 */
function commentFromShape(shape: string, value: string): string {
  const text = String(shape || '')
  const re = /<(?!\!)[^<>]*>/g
  let first = -1
  let end = -1
  let m = re.exec(text)
  while (m) {
    if (first < 0) first = m.index
    end = m.index + m[0].length
    m = re.exec(text)
  }
  if (first < 0) return text
  // 列表模板写成 `<>[, <>]`：中间的 `[` 已在待换区间里，末尾的 `]` 也要一起换掉。
  if (text.charAt(end) === ']') end += 1
  return text.slice(0, first) + value + text.slice(end)
}


/** 标签归一：字符串与 {name} 两种写法都收，剥掉照抄文档时带上的引号，去重后保持原顺序。 */
export function labelsOf(input: CreateView): string[] {
  const raw: unknown = Array.isArray(input.labels) ? input.labels : input.Labels
  const out: string[] = []
  const seen: Record<string, true> = {}
  if (Array.isArray(raw)) {
    for (const one of raw) {
      const name = typeof one === 'string'
        ? stripLabelDecoration(one)
        : (one && typeof (one as { name?: unknown }).name === 'string' ? stripLabelDecoration((one as { name: string }).name) : '')
      if (name && !seen[name]) { seen[name] = true; out.push(name) }
    }
  } else if (typeof raw === 'string') {
    for (const part of raw.split(/[,，]+/)) {
      const name = stripLabelDecoration(part)
      if (name && !seen[name]) { seen[name] = true; out.push(name) }
    }
  }
  return out
}

/** 指派人与阻塞边的归一：都能是「名字/票号」，也都能是完整形状。 */
export function assigneesOf(input: CreateView): string[] {
  if (!Array.isArray(input.assignees)) return []
  return input.assignees.map((one: unknown) => loginOfAssignee(one)).filter(Boolean)
}

export function blockedKeysOf(input: CreateView): string[] {
  const raw = input.blockedBy
  if (Array.isArray(raw)) {
    return raw
      .map((one: unknown) => String(one == null ? '' : one).trim().replace(/^#/, ''))
      .filter((one: string) => one !== '')
      .map((one: string) => (/^\d+$/.test(one) ? one.padStart(2, '0') : one))
  }
  if (typeof raw === 'string') {
    return raw.split(/[,，\s]+/).map((one: string) => one.trim().replace(/^#/, '')).filter(Boolean)
  }
  return []
}

/**
 * 可见 `**Blocked by:**` 行与隐藏 `DSH-BLOCKED-BY` 必须是同一批票号（#1507）。
 *
 * 可见行只写编号或标题，不写 `#`：本地模板要求「列编号或标题」，井号是远端跟踪器的引用写法，
 * 写进本地票会让人以为这一行要按远端规则解析。隐藏字段只收能当机器边用的纯数字；
 * 标题（人能读、但没法当键）只留在可见行，不塞进隐藏字段，免得读侧把一句话当成票号。
 *
 * 取值顺序与老行为一致：调用方给了 blockedBy 就以它为准（数组形态已补足两位编号）；
 * 否则用正文里抄来的那一行，逐段去掉 `#` 后落盘——两行说的是同一件事，读的人不用对照两份。
 */
function blockedPair(input: CreateView, fromBody: string): { visible: string; hidden: string[] } {
  const keys = blockedKeysOf(input)
  if (keys.length) return { visible: keys.join(', '), hidden: keys }
  const text = String(fromBody || '').trim()
  // 没给阻塞边也没有正文那行时，可见行写原文的这句话；隐藏字段整行不写（「没有」就是没有）。
  if (!text) return { visible: 'None (can start immediately)', hidden: [] }
  const parts = text.split(/[,，]/).map((one) => one.trim().replace(/^#/, '').trim()).filter(Boolean)
  // 正文那行只剩一个 `#` 或只有逗号时，逐段取完是空的：按「没写」处理，不让可见行留一个空值。
  if (!parts.length) return { visible: 'None (can start immediately)', hidden: [] }
  return { visible: parts.join(', '), hidden: parts.filter((one) => /^\d+$/.test(one)) }
}

/**
 * 状态值的唯一来源（#1507）。顺序：正文里写的 > 调用方给的 > 模板默认值。
 *
 * 为什么要兜到默认值：读侧（parse.ts）把「没有状态」读成 open，也就是未开始；一张刚建出来的票
 * 不该一出生就是「未开始」。调用方给空白串（''、纯空格、换行）与没给是同一件事——空白的
 * `**Status:**` 行读回来仍然等于没有状态。默认值的事实来源是 format/original-skills.yaml 的
 * status.default（实施票与普通票是可见行里的 ready-for-agent，规格与地图是隐藏注释里的同一个值），
 * 这里不另写一份字面量，YAML 改了这里跟着变。
 */
export function statusFor(shape: ObjectShape, input: CreateView, fromBody: string): string {
  const bodyStatus = String(fromBody || '').trim()
  if (bodyStatus) return bodyStatus
  const given = String(input.status == null ? '' : input.status).trim()
  if (given) return given
  return String((shape.status && shape.status.default) || '').trim()
}

/**
 * 隐藏注释区块。顺序与 scope 以 format/original-skills.yaml 的 hidden-comments 表为准：
 *   所有文件 → DSH-FORMAT、DSH-IDEMPOTENCY-KEY、DSH-CREATED；
 *   规格/地图 → DSH-TITLE（标题）、DSH-STATUS；
 *   实施票/子票/普通票 → DSH-PARENT、DSH-BLOCKED-BY；
 *   所有文件 → DSH-ASSIGNEES、DSH-LABELS（有值才写）。
 */
export function renderHeader(kind: OriginalKind, opts: {
  status: string
  parentKey: string
  assignees: string[]
  labels: string[]
  blocked: string[]
  idempotencyKey: string
  createdAt: string
  /** 规格与地图的标题：写进 DSH-TITLE 隐藏注释，不写可见一级标题。票形不传。 */
  title?: string
}): string {
  const entries = (MD_FORMAT['hidden-comments'].entries as unknown as Array<{ name: string; line: string; scope: readonly string[] }>)
  const objectKey = OBJECT_KEY_OF_KIND[kind]
  const values: Record<string, string> = {
    'DSH-TITLE': opts.title || '',
    'DSH-STATUS': opts.status,
    'DSH-PARENT': opts.parentKey,
    'DSH-ASSIGNEES': opts.assignees.join(', '),
    'DSH-LABELS': opts.labels.join(', '),
    'DSH-BLOCKED-BY': opts.blocked.join(', '),
    'DSH-IDEMPOTENCY-KEY': opts.idempotencyKey,
    'DSH-CREATED': opts.createdAt,
  }
  const lines: string[] = []
  for (const entry of entries) {
    const inScope = entry.scope.indexOf('all-files') >= 0 || entry.scope.indexOf(objectKey) >= 0
    if (!inScope) continue
    const value = String(values[entry.name] || '').replace(/\r?\n/g, ' ').replace(/-->/g, '-- >').trim()
    // 静态行（例如 DSH-FORMAT 的 `md-v1`）没有值位，模板本身就是完整一行。
    if (!/<(?!\!)[^<>]*>/.test(entry.line)) { lines.push(entry.line); continue }
    if (!value) continue
    lines.push(commentFromShape(entry.line, value))
  }
  return lines.join('\n') + (lines.length ? '\n' : '')
}
function fieldValue(body: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('^[ \\t]*\\*\\*' + escaped + ':\\*\\*[ \\t]*(.*)$', 'im')
  const m = re.exec(body)
  return m ? String(m[1] || '').trim() : ''
}

/** 从正文里取状态行；没有 `**Status:**` 时认老的 `Status:` 行。 */
function statusValue(body: string, label: string): string {
  const bold = fieldValue(body, label)
  if (bold) return bold
  const m = new RegExp('^[ \\t]*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*[:：][ \\t]*([^\\n]+)', 'im').exec(body)
  return m ? String(m[1] || '').trim() : ''
}

/** 去掉正文里所有插件注释与旧骨架，只留用户写下的内容。 */
export function cleanBody(rawBody: string): string {
  let body = String(rawBody || '')
  // 整份票文件原样写回时，旧的标题与骨架都不是这次要抄的内容。
  body = body.replace(/^[ \t]*<!--[ \t]*DSH-[A-Z-]+[ \t]*:.*?-->[ \t]*\r?\n?/gim, '')
  body = body.replace(/^[ \t]*<!--[ \t]*(?:created|parentKey)[ \t]*:.*?-->[ \t]*\r?\n?/gim, '')
  body = body.replace(/^##\s*Comments\s*$[\s\S]*?(?=^##\s|$(?![\s\S]))/gim, '')
  body = body.replace(/^##\s*Answer\s*$[\s\S]*?(?=^##\s|$(?![\s\S]))/gim, '')
  body = stripMarkerLines(body)
  return body.replace(/^\s+|\s+$/g, '')
}

/** 找第一个不在代码块里的二级标题；正文里的示例写法不能被当成真的区块开头。 */
function firstHeadingOutsideFence(body: string): number {
  let offset = 0
  let inFence = false
  for (const line of String(body || '').split('\n')) {
    if (isFenceLine(line)) inFence = !inFence
    else if (!inFence && isHeadingTwoLine(line)) return offset
    offset += line.length + 1
  }
  return -1
}

/** 把实施票正文拆成原文模板要的三行字段 + 验收项 + 其余正文。 */
function ticketParts(body: string, hasExplicitWhat: boolean, labels: string[]): { what: string; blocked: string; status: string; acceptance: string; rest: string } {
  const what = fieldValue(body, labels[0] || '')
  const blocked = fieldValue(body, labels[1] || '')
  const status = statusValue(body, labels[2] || '')
  const lines = body.split('\n')
  const acceptance: string[] = []
  const rest: string[] = []
  const labelAlt = labels.map((one) => one.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const boldRe = new RegExp('^[ \\t]*\\*\\*(?:' + labelAlt + '):\\*\\*', 'i')
  const plainRe = new RegExp('^[ \\t]*(?:' + labelAlt + ')[ \\t]*[:：]', 'i')
  for (const line of lines) {
    if (/^[ \t]*[-*][ \t]+\[[ xX]\][ \t]?/.test(line)) { acceptance.push(line.trim()); continue }
    if (boldRe.test(line)) continue
    if (plainRe.test(line)) continue
    rest.push(line)
  }
  return {
    what: what || (hasExplicitWhat ? '' : rest.join('\n').trim()),
    blocked,
    status: status || '',
    acceptance: acceptance.join('\n'),
    rest: (what || hasExplicitWhat) ? rest.join('\n').trim() : '',
  }
}

/** 规格正文从原文第一个段标题开始：调用方只给一段话时，先套上「## Problem Statement」，
 *  这样正文第一行就是模板的第一个段标题（原文没有一级标题，见文件头与 ADR 20261025）。 */
function ensureSpecSections(body: string, titles: readonly string[]): string {
  const out = String(body || '')
  if (!titles.length) return out
  if (/^##[ \t]+\S/m.test(out)) return out
  return '## ' + titles[0] + '\n' + (out ? '\n' + out : '')
}
/** 标题去掉调用方可能已经带上的 `NN: ` 前缀，避免落成 `# 01: 01: 标题`。 */
export function cleanTitle(title: string): string {
  return String(title || '').trim().replace(/^\d{1,3}:\s*/, '')
}

/** 把一份规格渲染成原文形状：文件头隐藏注释 + 正文（正文里的插件注释已剥掉）。
 *
 *  原文模板（to-spec/SKILL.md 第 23 行起）从「## Problem Statement」直接开始，没有一级标题；
 *  标题值写进文件头的 DSH-TITLE 注释。读取时先认一级标题（旧文件）、再认 DSH-TITLE、最后按目录名降级，
 *  所以这里少写一行可见标题不会让旧读者或新读者读错。 */
export function renderSpec(input: CreateView, opts: {
  createdAt: string
  idempotencyKey: string
  labels: string[]
  assignees: string[]
}): string {
  const shape = objectShapeOf('spec')
  const title = cleanTitle(String(input.title || ''))
  const body = ensureSpecSections(cleanBody(input.body ? String(input.body) : ''), shape.sections || [])
  const header = renderHeader('spec', {
    status: statusFor(shape, input, ''),
    parentKey: '',
    assignees: opts.assignees,
    labels: opts.labels,
    blocked: [],
    idempotencyKey: opts.idempotencyKey,
    createdAt: opts.createdAt,
    title: title,
  })
  return header + '\n' + body.replace(/\s+$/, '') + '\n'
}

/** 把一份实施票/普通票渲染成原文形状：`# NN: 标题`、三行字段、验收项。 */
export function renderTicket(kind: OriginalKind, input: CreateView, opts: {
  number: string
  createdAt: string
  idempotencyKey: string
  labels: string[]
  assignees: string[]
  parentKey: string
}): string {
  const shape = objectShapeOf(kind)
  const fields = shape.fields || []
  const fieldLabels = fields.map((field) => field.label)
  const title = cleanTitle(String(input.title || ''))
  const rawBody = cleanBody(input.body ? String(input.body) : '')
  // 原文模板里 `**What to build:**` 是字段行，但很多调用方只给一段话，后面再跟 `## 进度` 这类区块。
  // 没有字段行时把第一个二级标题之前的那段话当作 What to build，后面的区块原样留在票尾；
  // 否则整段（含 `## 进度` 标题）会被塞进字段行同一行，读回来就找不到进度区了。
  const explicitWhat = !!fieldValue(rawBody, fieldLabels[0] || '')
  const splitAt = explicitWhat ? -1 : firstHeadingOutsideFence(rawBody)
  const body = splitAt >= 0
    ? fieldLine(fields[0]['line-shape'], rawBody.slice(0, splitAt).trim()) + '\n\n' + rawBody.slice(splitAt)
    : rawBody
  const parts = ticketParts(body, explicitWhat || splitAt >= 0, fieldLabels)
  // #1507：可见阻塞行与隐藏字段从同一份取值派生，两行不会再一个带 #、一个不带。
  const blocked = blockedPair(input, parts.blocked)
  const header = renderHeader(kind, {
    status: '',
    parentKey: opts.parentKey,
    assignees: opts.assignees,
    labels: opts.labels,
    // 隐藏字段只写能当机器边用的编号，与可见行是同一批值。
    blocked: blocked.hidden,
    idempotencyKey: opts.idempotencyKey,
    createdAt: opts.createdAt,
  })
  const values = [parts.what, blocked.visible, statusFor(shape, input, parts.status)]
  const lines: string[] = []
  lines.push(shapeTitle(shape['title-shape'] || '', [opts.number, title]))
  fields.forEach((field, at) => {
    lines.push('')
    lines.push(fieldLine(field['line-shape'], values[at] || ''))
  })
  if (parts.acceptance) {
    lines.push('')
    lines.push(parts.acceptance)
  }
  if (parts.rest) {
    lines.push('')
    lines.push(parts.rest)
  }
  return header + lines.join('\n') + '\n'
}

