// map-render.ts —— 把探索地图与地图子票渲染成原文形状（#1487，父票 #1480）。
//
// 单独拆出来的原因：#1486 的通用渲染（规格 / 实施票 / 普通票 / 文件头 / 正文清洗）已经让
// create-render.ts 接近单文件有效行上限；地图与地图子票的模板又自成一套（地图五段正文、
// 子票标题下 Type/Status/Blocked by 裸行），留在一起会让那份文件继续膨胀。拆开后边界是：
//   create-render.ts  通用件：建票视图与对象种类判定、隐藏注释文件头、标题/字段行形状、正文清洗；
//   本文件            只放地图容器与地图子票的渲染，复用上面那些通用件，不另抄一份；
// 两边仍共用 format/generated.ts 里的同一份模板真值（MD_FORMAT），模板改了这里自动跟着改。
//
// 不能改的约定：地图正文五段标题逐字按原文，缺段补齐；子票标题是 `# NN: <问句>`，
// 正文只有一段 Question。
import { MAP_TICKET_TYPES, objectShapeOf, shapeTitle, fieldLine, renderHeader, cleanBody, cleanTitle, labelsOf, assigneesOf, blockedKeysOf } from './create-render.js'
import type { CreateView } from './create-render.js'

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
