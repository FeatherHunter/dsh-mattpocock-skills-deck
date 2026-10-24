// create-render.ts —— Markdown 后端「按原文形状」渲染正文与文件头（#1486，父票 #1480）。
//
// 原文（随包 to-spec / to-tickets / issue-tracker-local）把票放成：
//   .scratch/<feature-slug>/spec.md                  规格
//   .scratch/<feature-slug>/issues/NN-<slug>.md      实施票、普通票
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
import { anchorLineFor } from '../../../refresh/contract/idempotency-keys.js'
import type { CreateInput, LabelInput } from '../../contract/inputs.js'

/** 本文件负责的四种对象。map 与 map-ticket 仍由 issues-create.ts 的旧路径处理。 */
export type OriginalKind = 'spec' | 'spec-ticket' | 'issue' | 'bug'

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
  const typeLine = String(v.typeLine || '').trim()
  const marker = markerKindOf(input)
  // 地图工单在契约上仍是 issue，但正文带一行 `Type: research|prototype|grilling|task`；
  // 这行只属于旧原文布局，见到它就交回旧路径（#1486 只改规格、实施票、普通票；地图子票归 #1487）。
  if (typeLine) return null
  if (explicit === 'spec' || marker === 'spec') return 'spec'
  if (explicit === 'spec-ticket' || explicit === 'ticket' || marker === 'ticket') return 'spec-ticket'
  if (explicit === 'bug') return 'bug'
  if (explicit === 'map' || explicit === 'research' || explicit === 'prototype' || explicit === 'grilling' || explicit === 'task') return null
  return 'issue'
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

/** 一行隐藏注释；值里出现换行或注释收尾符时宁可不写，免得把文件头写坏。 */
function commentLine(name: string, value: string): string {
  const clean = String(value == null ? '' : value).replace(/\r?\n/g, ' ').replace(/-->/g, '-- >').trim()
  return clean ? '<!-- ' + name + ': ' + clean + ' -->' : ''
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
  const lines: string[] = []
  const format = commentLine('DSH-FORMAT', 'md-v1')
  if (format) lines.push(format)
  if (kind === 'spec') {
    const status = commentLine('DSH-STATUS', opts.status || 'ready-for-agent')
    if (status) lines.push(status)
  }
  if (kind !== 'spec' && opts.parentKey) {
    const parent = commentLine('DSH-PARENT', opts.parentKey)
    if (parent) lines.push(parent)
  }
  if (opts.assignees.length) {
    const assignees = commentLine('DSH-ASSIGNEES', opts.assignees.join(', '))
    if (assignees) lines.push(assignees)
  }
  if (opts.labels.length) {
    const labels = commentLine('DSH-LABELS', opts.labels.join(', '))
    if (labels) lines.push(labels)
  }
  if (kind !== 'spec' && opts.blocked.length) {
    const blocked = commentLine('DSH-BLOCKED-BY', opts.blocked.join(', '))
    if (blocked) lines.push(blocked)
  }
  if (opts.idempotencyKey) {
    const anchor = anchorLineFor(opts.idempotencyKey).trim()
    if (anchor) lines.push(anchor)
  }
  const created = commentLine('DSH-CREATED', opts.createdAt)
  if (created) lines.push(created)
  return lines.join('\n') + (lines.length ? '\n' : '')
}

/** 从正文里取一个可见字段行的值（`**What to build:** ...` 或 `What to build: ...`）。 */
function fieldValue(body: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('^[ \\t]*\\*\\*' + escaped + ':\\*\\*[ \\t]*(.*)$', 'im')
  const m = re.exec(body)
  return m ? String(m[1] || '').trim() : ''
}

/** 从正文里取状态行；没有 `**Status:**` 时认老的 `Status:` 行。 */
function statusValue(body: string): string {
  const bold = fieldValue(body, 'Status')
  if (bold) return bold
  const m = /^[ \t]*Status[ \t]*[:：][ \t]*([^\n]+)/im.exec(body)
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
function ticketParts(body: string, hasExplicitWhat: boolean): { what: string; blocked: string; status: string; acceptance: string; rest: string } {
  const what = fieldValue(body, 'What to build')
  const blocked = fieldValue(body, 'Blocked by')
  const status = statusValue(body)
  const lines = body.split('\n')
  const acceptance: string[] = []
  const rest: string[] = []
  for (const line of lines) {
    if (/^[ \t]*[-*][ \t]+\[[ xX]\][ \t]?/.test(line)) { acceptance.push(line.trim()); continue }
    if (/^[ \t]*\*\*(?:What to build|Blocked by|Status):\*\*/i.test(line)) continue
    if (/^[ \t]*(?:What to build|Blocked by|Status)[ \t]*[:：]/i.test(line)) continue
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
  const title = cleanTitle(String(input.title || ''))
  const body = cleanBody(input.body ? String(input.body) : '')
  const header = renderHeader('spec', {
    status: String(input.status || 'ready-for-agent'),
    parentKey: '',
    assignees: opts.assignees,
    labels: opts.labels,
    blocked: [],
    idempotencyKey: opts.idempotencyKey,
    createdAt: opts.createdAt,
  })
  return header + '# ' + title + '\n' + (body ? '\n' + body + '\n' : '\n')
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
  const title = cleanTitle(String(input.title || ''))
  const rawBody = cleanBody(input.body ? String(input.body) : '')
  // 原文模板里 `**What to build:**` 是字段行，但很多调用方只给一段话，后面再跟 `## 进度` 这类区块。
  // 没有字段行时把第一个二级标题之前的那段话当作 What to build，后面的区块原样留在票尾；
  // 否则整段（含 `## 进度` 标题）会被塞进字段行同一行，读回来就找不到进度区了。
  const explicitWhat = !!fieldValue(rawBody, 'What to build')
  const splitAt = explicitWhat ? -1 : firstHeadingOutsideFence(rawBody)
  const body = splitAt >= 0
    ? '**What to build:** ' + rawBody.slice(0, splitAt).trim() + '\n\n' + rawBody.slice(splitAt)
    : rawBody
  const parts = ticketParts(body, explicitWhat || splitAt >= 0)
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
  const lines: string[] = []
  lines.push('# ' + opts.number + ': ' + title)
  lines.push('')
  lines.push('**What to build:** ' + parts.what)
  lines.push('')
  lines.push('**Blocked by:** ' + blocked)
  lines.push('')
  lines.push('**Status:** ' + (parts.status || String(input.status || 'ready-for-agent')))
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

/** 某个目录是不是一个已经被占用的 feature 目录（有规格、地图或票）。空目录可以让出来。 */
