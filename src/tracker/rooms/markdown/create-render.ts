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

/** 判断这次该不该走原文布局。map / map-ticket 明确留给旧路径（#1487）。 */
export function originalKindOf(input: CreateInput): OriginalKind | null {
  const v = viewOf(input)
  const explicit = String(v.kind || v.type || v.Type || '').trim().toLowerCase()
  const typeLine = String(v.typeLine || '').toLowerCase()
  const marker = markerKindOf(input)
  // 地图工单在契约上仍是 issue，但原文用一行 `Type: research|prototype|grilling|task` 记类型。
  // 见到这四个值（不管来自 typeLine 还是调用方放在 type 里的老写法）就落成地图子票；
  // 别的 Type 值没有原文依据，继续交回旧路径（不猜）。
  if (typeLine) return MAP_TICKET_TYPES.indexOf(typeLine) >= 0 ? 'map-ticket' : null
  if (explicit === 'spec' || marker === 'spec') return 'spec'
  if (explicit === 'spec-ticket' || explicit === 'ticket' || marker === 'ticket') return 'spec-ticket'
  if (explicit === 'bug') return 'bug'
  // 原文的探索地图是顶层容器：正好占一个目录里的 map.md（与规格同款，key 为 00）。
  if (explicit === 'map') return 'map'
  if (MAP_TICKET_TYPES.indexOf(explicit) >= 0) return 'map-ticket'
  // 调用点只给了一枚 wayfinder:<类型> 标签、没给 typeLine 时也认成地图子票：
  // 那枚标签是原文给子票定的类型标记，别的对象不会带它。
  if (labelsOf(v).some((label) => /^wayfinder:(research|prototype|grilling|task)$/.test(label))) return 'map-ticket'
  return 'issue'
}

/**
 * 原文模板里与建票有关的字段。模板文字只从 generated.ts 的 MD_FORMAT 取，
 * 代码里不再抄一份标题形状与字段行；模板改了这里自动跟着改。
 */
interface ObjectShape {
  'title-shape': string
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

/** 原文 Type 行的四个值：地图子票的类型词（issue-tracker-local「Type: 行记 research / prototype / grilling / task」）。 */
const MAP_TICKET_TYPES = ['research', 'prototype', 'grilling', 'task']

const OBJECT_KEY_OF_KIND: Record<OriginalKind, string> = {
  spec: 'spec',
  'spec-ticket': 'implementation-ticket',
  issue: 'plain-issue',
  bug: 'plain-issue',
  map: 'map',
  'map-ticket': 'wayfinder-child',
}

/** 普通票按原文的 `reuse` 指到实施票模板；其余对象直接取自己那一份。 */
function objectShapeOf(kind: OriginalKind): ObjectShape {
  const objects = MD_FORMAT.objects as unknown as Record<string, ObjectShape>
  const first = objects[OBJECT_KEY_OF_KIND[kind]]
  if (first && first.reuse && objects[first.reuse]) return objects[first.reuse]
  return first
}

/** 把标题形状里的占位符按顺序换成实际值：`# <NN>: <票标题>` → `# 01: 标题`。 */
function shapeTitle(shape: string, values: string[]): string {
  let at = 0
  return String(shape || '').replace(/<[^>]*>/g, () => (at < values.length ? values[at++] : ''))
}

/** 字段行只抄模板里的「标签 + 冒号」前缀，值由这次建票的内容填。 */
function fieldLine(shape: string, value: string): string {
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

function blockedKeysOf(input: CreateView): string[] {
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
 * 隐藏注释区块。顺序与 scope 以 format/original-skills.yaml 的 hidden-comments 表为准：
 *   所有文件 → DSH-FORMAT、DSH-IDEMPOTENCY-KEY、DSH-CREATED；
 *   规格/地图 → DSH-STATUS；
 *   实施票/子票/普通票 → DSH-PARENT、DSH-BLOCKED-BY；
 *   所有文件 → DSH-ASSIGNEES、DSH-LABELS（有值才写）。
 */
function renderHeader(kind: OriginalKind, opts: {
  status: string
  parentKey: string
  assignees: string[]
  labels: string[]
  blocked: string[]
  idempotencyKey: string
  createdAt: string
}): string {
  const entries = (MD_FORMAT['hidden-comments'].entries as unknown as Array<{ name: string; line: string; scope: readonly string[] }>)
  const objectKey = OBJECT_KEY_OF_KIND[kind]
  const values: Record<string, string> = {
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
function cleanBody(rawBody: string): string {
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
    if (/^[ \t]*(```|~~~)/.test(line)) inFence = !inFence
    else if (!inFence && /^##\s/.test(line)) return offset
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

/** 标题去掉调用方可能已经带上的 `NN: ` 前缀，避免落成 `# 01: 01: 标题`。 */
function cleanTitle(title: string): string {
  return String(title || '').trim().replace(/^\d{1,3}:\s*/, '')
}

/** 把一份规格渲染成原文形状：一级标题 + 正文（正文里的插件注释已剥掉）。 */
export function renderSpec(input: CreateView, opts: {
  createdAt: string
  idempotencyKey: string
  labels: string[]
  assignees: string[]
}): string {
  const shape = objectShapeOf('spec')
  const title = cleanTitle(String(input.title || ''))
  const body = cleanBody(input.body ? String(input.body) : '')
  const header = renderHeader('spec', {
    status: String(input.status || (shape.status && shape.status.default) || ''),
    parentKey: '',
    assignees: opts.assignees,
    labels: opts.labels,
    blocked: [],
    idempotencyKey: opts.idempotencyKey,
    createdAt: opts.createdAt,
  })
  return header + shapeTitle(shape['title-shape'], [title]) + '\n' + (body ? '\n' + body + '\n' : '\n')
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
  const blocked = parts.blocked || (blockedKeysOf(input).length ? blockedKeysOf(input).map((k: string) => '#' + k).join(', ') : 'None (can start immediately)')
  const header = renderHeader(kind, {
    status: '',
    parentKey: opts.parentKey,
    assignees: opts.assignees,
    labels: opts.labels,
    blocked: blockedKeysOf(input),
    idempotencyKey: opts.idempotencyKey,
    createdAt: opts.createdAt,
  })
  const values = [parts.what, blocked, parts.status || String(input.status || (shape.status && shape.status.default) || '')]
  const lines: string[] = []
  lines.push(shapeTitle(shape['title-shape'], [opts.number, title]))
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

/** 正则转义：标题文字来自模板，可能含 `.` 等字符，直接拼进正则会误匹配。 */
function escapeForRegExp(text: string): string {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 判断正文里有没有某个二级标题（只认整行，代码块里的示例写法不算）。 */
function hasSectionHeading(body: string, title: string): boolean {
  return new RegExp('^##[ \\t]*' + escapeForRegExp(title) + '[ \\t]*$', 'm').test(body)
}

/**
 * 地图正文五段逐字按原文：缺哪段就按模板顺序补一行标题。
 * 建图时如果整段话都没有段标题，那它只能是 Destination 的内容：先套上第一段再补齐其余段，
 * 这样正文不会掉在五段之外，读回来 parseMapBody 也能按段取到。
 */
function ensureMapSections(body: string, titles: readonly string[]): string {
  let out = String(body || '')
  if (titles.length && !titles.some((title) => hasSectionHeading(out, title))) {
    out = '## ' + titles[0] + '\n' + (out ? '\n' + out : '')
  }
  for (const title of titles) {
    if (hasSectionHeading(out, title)) continue
    out = (out ? out.replace(/\s+$/, '') + '\n\n' : '') + '## ' + title + '\n'
  }
  return out
}

/**
 * 把一张探索地图渲染成原文形状：`# <地图标题>` + 五段正文。
 * 地图是容器（与规格同款，编号 00），状态只写进文件头隐藏注释，正文里不出现 Status 行。
 */
export function renderMap(input: CreateView, opts: {
  createdAt: string
  idempotencyKey: string
  labels: string[]
  assignees: string[]
}): string {
  const shape = objectShapeOf('map')
  const title = cleanTitle(String(input.title || ''))
  const body = ensureMapSections(cleanBody(input.body ? String(input.body) : ''), shape.sections || [])
  const header = renderHeader('map', {
    status: String(input.status || (shape.status && shape.status.default) || ''),
    parentKey: '',
    assignees: opts.assignees,
    labels: opts.labels,
    blocked: [],
    idempotencyKey: opts.idempotencyKey,
    createdAt: opts.createdAt,
  })
  return header + shapeTitle(shape['title-shape'], [title]) + '\n' + (body ? '\n' + body + '\n' : '\n')
}

/** 地图子票的类型词：调用方可能放在 typeLine、wayfinder 标签或老写法的 type 里，三处都收。 */
function wayfinderTypeOf(input: CreateView): string {
  const explicit = String(input.typeLine || '').trim().toLowerCase()
  if (MAP_TICKET_TYPES.indexOf(explicit) >= 0) return explicit
  for (const label of labelsOf(input)) {
    const m = /^wayfinder:(research|prototype|grilling|task)$/.exec(label)
    if (m) return m[1]
  }
  const raw = String(input.kind || input.type || input.Type || '').trim().toLowerCase()
  return MAP_TICKET_TYPES.indexOf(raw) >= 0 ? raw : ''
}

/**
 * 把一张地图子票渲染成原文形状：`# NN: <问句标题>`，标题下三行裸字段（不加粗），正文只有一段问题。
 * 子票可见的 Status 行就是状态本身；文件头不再写 DSH-STATUS（与原文一致）。
 */
export function renderWayfinderChild(input: CreateView, opts: {
  number: string
  createdAt: string
  idempotencyKey: string
  labels: string[]
  assignees: string[]
  parentKey: string
}): string {
  const shape = objectShapeOf('map-ticket')
  const topLines = shape['top-lines'] || []
  const title = cleanTitle(String(input.title || ''))
  const blocked = blockedKeysOf(input)
  const statusTemplate = topLines.find((line) => line.label === 'Status')
  // 调用方给了状态就照写；只给了指派人也算已认领（原文 Status: claimed 就是「有人在做」）。
  let status = String(input.status == null ? '' : input.status).trim()
  if (!status && opts.assignees.length && statusTemplate && statusTemplate.values) {
    status = String(statusTemplate.values[0] || '')
  }
  const values: Record<string, string> = {
    Type: wayfinderTypeOf(input),
    Status: status,
    'Blocked by': blocked.join(', '),
  }
  const lines: string[] = [shapeTitle(shape['title-shape'], [opts.number, title])]
  for (const topLine of topLines) {
    const value = String(values[topLine.label] || '')
    if (!value) continue
    lines.push('')
    // 值位只在 line-shape 里（Blocked by: <NN>, <NN>）；没有 line-shape 的写 `Type: 值`。
    lines.push(topLine['line-shape'] ? fieldLine(topLine['line-shape'], value) : topLine.label + ': ' + value)
  }
  const heading = '## ' + String(shape['body-section'] || 'Question')
  const rawBody = cleanBody(input.body ? String(input.body) : '')
  const hasQuestion = rawBody.split('\n').some((line) => line.trim() === heading)
  const body = hasQuestion ? rawBody : (rawBody ? heading + '\n\n' + rawBody : heading + '\n')
  const header = renderHeader('map-ticket', {
    status: '',
    parentKey: opts.parentKey,
    assignees: opts.assignees,
    labels: opts.labels,
    blocked,
    idempotencyKey: opts.idempotencyKey,
    createdAt: opts.createdAt,
  })
  lines.push('')
  lines.push(body)
  return header + lines.join('\n') + '\n'
}

