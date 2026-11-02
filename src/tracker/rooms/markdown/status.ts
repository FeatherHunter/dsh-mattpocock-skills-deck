// status.ts —— 本地 Markdown 票的 triage 状态模型（#1790 缺陷 A 的读侧纯函数层）。
//
// 为什么单独一件：状态判定要同时看可见 Status 行、隐藏 DSH-LABELS 里的旧 triage 标签、
// 票型（实施票 / 缺陷票 / 普通票 / 地图子票）与目录路线。这些规则此前散在 parse.ts 里，
// 而 parse.ts 已经顶到文件行数上限，且读侧不应该为了判定状态去读盘。
// 本件只做纯计算：输入是已经解析出来的字符串与标签，不读文件、不写文件、不 import parse.ts。
//
// 约定（改之前先读这三条）：
// 1) issue 文件的可见 Status 行是状态的唯一真源；隐藏 DSH-LABELS 里的 triage 只用于兼容旧文件。
// 2) state 仍只有 open / closed 两态，由 status 派生；本件不引入第三态。
// 3) 读一张文件永远不抛错：两边冲突时按可见值回答，并把冲突作为附带信息带出来。
//
// P2/P3 的写侧会复用这里的 normalizeStatus、stateOfStatus、defaultStatusOf、票型判定与历史读写。

import type { State } from '../../contract/identity.js'
import type { StatusConflict } from '../../contract/entities.js'
import {
  COMPLETED_STATUS_VALUES,
  STATUS_LEGACY_DEFAULT,
  TRIAGE_STATUS_ROLES,
  WAYFINDER_STATUS_VALUES,
} from './format/field-values.js'

export { COMPLETED_STATUS_VALUES, TRIAGE_STATUS_ROLES }
export type { StatusConflict }

/** 本地 Markdown 后端认的四类票型；容器（规格 / 地图）不参与本模型。 */
export type IssueFileKind = 'spec-ticket' | 'plain-issue' | 'bug' | 'map-ticket'

/** 读到的状态来自哪里：可见 Status 行、隐藏 DSH-LABELS、还是按票型得出的默认值。 */
export type StatusSource = 'visible' | 'hidden' | 'default'

/** 旧渲染器给 issue 文件写的默认状态；读旧文件时它只算一条兜底线索，不是人的决定。 */
export const LEGACY_STATUS_DEFAULT: string = STATUS_LEGACY_DEFAULT

/** 读一张票得到的状态结论；字段按需出现，不出现的字段不会写成 undefined。 */
export interface StatusRead {
  /** 归一化后的状态；四类票型里只有普通票可能没有状态。 */
  status?: string
  /** 状态的来源；没有 status 时省略。 */
  statusSource?: StatusSource
  /** 可见 Status 行归一化后的原值；只在它没有被采用为 status 时出现。 */
  statusVisible?: string
  /** 可见值与隐藏 triage 真冲突时的记录；不冲突时省略。 */
  statusConflict?: StatusConflict
  /** 两态 state，永远出现（没有状态按 open）。 */
  state: State
}

/** 判票型时调用方已知道的线索；三者都可缺。 */
export interface StatusKindMeta {
  /** 目录路线：地图目录 / 规格目录 / 普通 issue 目录。 */
  route?: 'map' | 'spec' | 'plain' | ''
  /** 调用方已经明确给出的票型（建票时传的 fileKind），优先级最高。 */
  fileKind?: IssueFileKind
}

/** 标签的两种常见形状：只有名字，或者是带 name 的对象。 */
export type StatusLabelLike = string | { name?: unknown }

/** DSH-STATUS-HISTORY 的一行记录：谁落选、采用了什么、什么时候。 */
export interface StatusHistoryEntry {
  /** 这次归一 / 冲突解决的来源。 */
  source: StatusSource
  /** 落选的状态值；没有落选值写空串。 */
  discarded: string
  /** 采用的状态值。 */
  adopted: string
  /** ISO-8601 时间。 */
  at: string
}

const ISSUE_FILE_KINDS: string[] = ['spec-ticket', 'plain-issue', 'bug', 'map-ticket']

function includesValue(values: readonly string[], value: string): boolean {
  return values.indexOf(value) >= 0
}

/** 把一段人写的状态词归一：小写、去强调符号、空格与下划线换连字符、去首尾标点。
 *  归一后不认识的词仍原样返回给调用方；「合不合法」由 isTriageStatus / 词表判断，两步分开。 */
export function normalizeStatus(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text: string = raw.trim().toLowerCase()
  if (!text) return null
  const cleaned: string = text
    .replace(/[*`"'“”‘’]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '')
    .replace(/-+/g, '-')
  return cleaned || null
}

/** 是不是五个 triage 角色之一（可见 Status 行与隐藏标签的正式词表）。 */
export function isTriageStatus(value: unknown): boolean {
  const norm: string | null = normalizeStatus(value)
  return norm !== null && includesValue(TRIAGE_STATUS_ROLES, norm)
}

function isCompletedStatus(value: string): boolean {
  return includesValue(COMPLETED_STATUS_VALUES, value)
}

function isLegalStatus(value: string | null): boolean {
  if (value === null) return false
  return isTriageStatus(value) || isCompletedStatus(value)
}

/** 从状态派生两态 state：wontfix 与四个完成词算 closed，其余（含没有状态、claimed）算 open。 */
export function stateOfStatus(status: unknown): State {
  const norm: string | null = normalizeStatus(status)
  if (norm === null) return 'open'
  if (norm === 'wontfix' || isCompletedStatus(norm)) return 'closed'
  return 'open'
}

/** 票型默认状态：普通 issue 没有默认值（返回 undefined，调用方就不写状态）。 */
export function defaultStatusOf(kind: IssueFileKind): string | undefined {
  if (kind === 'spec-ticket') return 'ready-for-agent'
  if (kind === 'bug') return 'needs-triage'
  if (kind === 'map-ticket') return wayfinderClaimedOf()
  return undefined
}

// 地图子票的默认状态取 YAML 里的 claimed；YAML 改了词也按名字认，认不到沿用旧字。
function wayfinderClaimedOf(): string {
  for (const one of WAYFINDER_STATUS_VALUES) if (one.toLowerCase() === 'claimed') return one
  return 'claimed'
}

function labelName(label: StatusLabelLike | null | undefined): string | null {
  if (typeof label === 'string') return label.trim() || null
  if (label && typeof label === 'object' && typeof label.name === 'string') return label.name.trim() || null
  return null
}

function labelNames(labels: readonly StatusLabelLike[] | null | undefined): string[] {
  const out: string[] = []
  if (!labels) return out
  for (const label of labels) {
    const name: string | null = labelName(label)
    if (name) out.push(name)
  }
  return out
}

/** 隐藏 DSH-LABELS 里的合法 triage 角色（去重、按出现顺序）。
 *  这是旧的第二个真源，只用于兼容读；写侧会把它们并回可见 Status 行并从这里移除。 */
function triageLabelsOf(labels: readonly StatusLabelLike[] | null | undefined): string[] {
  const out: string[] = []
  for (const name of labelNames(labels)) {
    const norm: string | null = normalizeStatus(name)
    if (norm === null || !includesValue(TRIAGE_STATUS_ROLES, norm)) continue
    if (!out.includes(norm)) out.push(norm)
  }
  return out
}

/** 判票型：显式 fileKind > 地图路线 > bug 标签 > 其余目录路线 > 正文线索 > 普通票。
 *  目录路线是读侧主判据；正文线索只在没有路线时兜底（普通 issue 与实施票共用 issues/ 目录）。 */
export function statusKindOf(
  meta: StatusKindMeta | null | undefined,
  labels: readonly StatusLabelLike[] | null | undefined,
  raw?: string | null,
): IssueFileKind {
  const explicit = meta ? meta.fileKind : undefined
  if (explicit && includesValue(ISSUE_FILE_KINDS, explicit)) return explicit
  const route = meta ? meta.route : undefined
  // 地图目录是物理事实：地图子票的状态词只有 claimed / resolved，一枚 bug 标签不能把它变成
  // 用 triage 词的缺陷票（否则给子票贴个 bug，读回的状态会从 claimed 翻成 needs-triage）。
  if (route === 'map') return 'map-ticket'
  for (const name of labelNames(labels)) {
    if (name.toLowerCase() === 'bug') return 'bug'
  }
  if (route === 'spec') return 'spec-ticket'
  if (route === 'plain') return 'plain-issue'
  const text: string = typeof raw === 'string' ? raw : ''
  if (/^\s*(?:Type|类型)\s*[:：]/im.test(text) || /^#{1,6}\s*Question\b/im.test(text)) return 'map-ticket'
  if (/\*\*What to build:\*\*/i.test(text) || /^#{1,6}\s*What to build\b/im.test(text)) return 'spec-ticket'
  return 'plain-issue'
}

/** 读侧核心：按「可见行 > 隐藏 triage > 票型默认」回答状态，并附带冲突记录。
 *  四个分支的顺序与理由见 plan §1.5：可见值不是旧默认时优先；否则旧文件看隐藏值；
 *  否则可见的旧默认仍算数；最后才落到票型默认。地图子票只认 claimed / resolved。 */
export function resolveStatusRead(
  kind: IssueFileKind,
  visibleRaw: string | null | undefined,
  hiddenLabels: readonly StatusLabelLike[] | null | undefined,
): StatusRead {
  const visible: string | null = normalizeStatus(visibleRaw)
  if (kind === 'map-ticket') {
    if (visible !== null && includesValue(WAYFINDER_STATUS_VALUES, visible)) {
      return { status: visible, statusSource: 'visible', state: stateOfStatus(visible) }
    }
    const fallback: string = defaultStatusOf('map-ticket') as string
    const read: StatusRead = { status: fallback, statusSource: 'default', state: stateOfStatus(fallback) }
    if (visible !== null) read.statusVisible = visible
    return read
  }
  const visibleLegal: boolean = isLegalStatus(visible)
  const hidden: string[] = triageLabelsOf(hiddenLabels)
  let status: string | undefined
  let source: StatusSource | undefined
  if (visibleLegal && visible !== LEGACY_STATUS_DEFAULT) {
    status = visible as string
    source = 'visible'
  } else if (hidden.length === 1) {
    status = hidden[0]
    source = 'hidden'
  } else if (visibleLegal) {
    status = visible as string
    source = 'visible'
  } else {
    const fallback: string | undefined = defaultStatusOf(kind)
    if (fallback !== undefined) {
      status = fallback
      source = 'default'
    }
  }
  const read: StatusRead = { state: stateOfStatus(status === undefined ? null : status) }
  if (status !== undefined) {
    read.status = status
    read.statusSource = source
  }
  if (visible !== null && status !== visible) read.statusVisible = visible
  if (
    visibleLegal &&
    visible !== LEGACY_STATUS_DEFAULT &&
    hidden.length === 1 &&
    visible !== hidden[0]
  ) {
    read.statusConflict = {
      field: 'status',
      visible: visible as string,
      hidden: [hidden[0]],
      hiddenSource: 'DSH-LABELS',
      stateFromVisible: stateOfStatus(visible),
      stateFromHidden: stateOfStatus(hidden[0]),
      resolution: {
        default: 'visible',
        rule: 'visible-status-wins',
        action: 'write-visible-status-on-next-write',
        history: 'DSH-STATUS-HISTORY',
      },
    }
  }
  return read
}

/** 隐藏 DSH-LABELS 该保留哪些标签：去掉五个 triage 角色，保留 non-triage（bug、wayfinder:* 等）。
 *  容器上的标签不归这里管：规格 / 地图关闭后标签仍在，调用方不能拿本函数去清容器标签。 */
export function hiddenLabelsOf(labels: readonly StatusLabelLike[] | null | undefined): string[] {
  const out: string[] = []
  for (const name of labelNames(labels)) {
    if (isTriageStatus(name)) continue
    if (!out.includes(name)) out.push(name)
  }
  return out
}

/** 写隐藏 DSH-LABELS 时把有效状态合成的那一枚 triage 标签补上；状态不是 triage 就不补。
 *  结果里最多一枚 triage：已有的 triage 先被去掉，再按当前状态补，避免两处各存一份。 */
export function labelsWithSynthesizedTriage(
  labels: readonly StatusLabelLike[] | null | undefined,
  status: string | null | undefined,
): string[] {
  const out: string[] = hiddenLabelsOf(labels)
  const norm: string | null = normalizeStatus(status)
  if (norm !== null && includesValue(TRIAGE_STATUS_ROLES, norm) && !out.includes(norm)) out.push(norm)
  return out
}

/** 从 deck 传入的正文片段里取 Status 行：只认第一个一级标题之前的行（标题后的 Status 属于别的段）。
 *  返回值已归一；没有 Status 行或值为空返回 null。 */
export function statusInBody(body: string): string | null {
  if (typeof body !== 'string' || !body) return null
  const firstHeading: number = body.search(/^#\s+/m)
  const head: string = firstHeading >= 0 ? body.slice(0, firstHeading) : body
  const match = /^\s*(?:\*\*)?Status(?:\*\*)?\s*[:：][ \t]*(?:\*\*)?[ \t]*([^\n]*)/im.exec(head)
  return match ? normalizeStatus(match[1]) : null
}

function parseHistoryFields(inner: string): StatusHistoryEntry | null {
  const values: Record<string, string> = {}
  const pair = /(\w+)=(\S+)/g
  let match: RegExpExecArray | null = pair.exec(inner)
  while (match) {
    values[match[1]] = match[2]
    match = pair.exec(inner)
  }
  const source: string = values.source
  if (source !== 'visible' && source !== 'hidden' && source !== 'default') return null
  const empty = (value: string | undefined): string => (!value || value === '-' ? '' : value)
  return { source, discarded: empty(values.discarded), adopted: empty(values.adopted), at: empty(values.at) }
}

/** 读回全部 DSH-STATUS-HISTORY 行，按文件顺序；坏行跳过（追查信息坏了不该让读票失败）。 */
export function readStatusHistory(text: string): StatusHistoryEntry[] {
  const out: StatusHistoryEntry[] = []
  if (typeof text !== 'string' || !text) return out
  const line = /<!--\s*DSH-STATUS-HISTORY:([\s\S]*?)-->/g
  let match: RegExpExecArray | null = line.exec(text)
  while (match) {
    const entry: StatusHistoryEntry | null = parseHistoryFields(match[1])
    if (entry) out.push(entry)
    match = line.exec(text)
  }
  return out
}

function historyLineOf(entry: StatusHistoryEntry): string {
  const shown = (value: string): string => (value && value.trim() ? value.trim() : '-')
  return (
    '<!-- DSH-STATUS-HISTORY: source=' +
    entry.source +
    ' discarded=' +
    shown(entry.discarded) +
    ' adopted=' +
    shown(entry.adopted) +
    ' at=' +
    shown(entry.at) +
    ' -->'
  )
}

/** 追加一行 DSH-STATUS-HISTORY：插在最后一个隐藏注释之后、第一个可见标题之前。
 *  同一条（来源 + 落选值 + 采用值）只记一次，时间不同也不算新的一条；重复调用返回原文。 */
export function appendStatusHistory(text: string, entry: StatusHistoryEntry): string {
  const line: string = historyLineOf(entry)
  if (!text || !text.trim()) return line + '\n'
  for (const one of readStatusHistory(text)) {
    if (one.source === entry.source && one.discarded === entry.discarded && one.adopted === entry.adopted) {
      return text
    }
  }
  const lines: string[] = text.split('\n')
  let lastHidden: number = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*<!--\s*DSH-[A-Z-]+:[\s\S]*-->\s*$/.test(lines[i])) lastHidden = i
  }
  if (lastHidden >= 0) lines.splice(lastHidden + 1, 0, line)
  else lines.unshift(line, '')
  return lines.join('\n')
}
