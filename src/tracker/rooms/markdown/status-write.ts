// status-write.ts —— 本地 Markdown 票的状态写侧归一（#1790 缺陷 A）。
//
// 为什么单独一件：状态的读侧纯函数在 status.ts；写侧要读整份文件、改可见 Status 行与隐藏 DSH-LABELS，
// 又不能再塞进 issues-status.ts（那一件已经贴近文件行数上限）。本件只做「文本进、文本出」，
// 不读盘、不写盘、不排队；盘上的读—改—写由调用方（issues-status.ts / issues-patch.ts）负责。
//
// 三条约定（改之前先读）：
// 1) 可见 Status 行是状态的唯一真源；隐藏 DSH-LABELS 只保留非 triage 标签。写侧每次归一都按这条落盘：
//    旧文件第一次被写时顺手归一，落选值记一行 DSH-STATUS-HISTORY，不静默丢。
// 2) 读侧报出的真冲突（可见值与隐藏 triage 不同）不许由写侧自己挑一个吞掉：没有显式状态就整次拒绝，
//    调用方必须先显式给状态，或先改标签把两处归一。
// 3) 地图子票只认 claimed / resolved；容器（规格 / 地图）不走这里，它们的 DSH-STATUS 由 issues-status.ts 写。
import { parseMd } from './parse.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import { failAs } from './error-fail.js'
import { COMPLETED_STATUS_VALUES, WAYFINDER_STATUS_VALUES } from './format/field-values.js'
import { fieldStyleOf, hiddenCommentOf, removeField, ticketFormOf, upsertHiddenComment, writeFieldByStyle } from './original-fields.js'
import {
  appendStatusHistory,
  hiddenLabelsOf,
  isTriageStatus,
  LEGACY_STATUS_DEFAULT,
  normalizeStatus,
  resolveStatusRead,
  statusKindOf,
  TRIAGE_STATUS_ROLES,
  triageNamesOf,
} from './status.js'
import type { IssueFileKind, StatusConflict, StatusHistoryEntry, StatusSource } from './status.js'
import type { TicketRoute } from './issues-locate.js'

/** 从票文件文本里读到的状态结论：与读侧 Issue 上的四个字段同形，另带票型与全部标签名。 */
export interface StatusReadInfo {
  kind: IssueFileKind
  status?: string
  statusSource?: StatusSource
  statusVisible?: string
  statusConflict?: StatusConflict
  /** 解析出来的全部标签名（含可见 Labels 行与隐藏 DSH-LABELS，以及按状态合成的 triage）。 */
  labels: string[]
}

/** 写侧这次要落成什么：显式状态、完整标签名单（替换语义）、或明确去掉状态。 */
export interface StatusNormalizeChoice {
  /** 显式指定的状态；给了它就不许再猜。 */
  status?: string
  /** 新的完整标签名单；给了它，隐藏 DSH-LABELS 按它重写。 */
  labels?: string[]
  /** 判定票型与隐藏 triage 时要用的标签名单（改标签是整批替换，按替换后的名单判，默认用盘上的）。 */
  readLabels?: string[]
  /** 明确去掉状态（普通票重开时用）：可见 Status 行整行删掉。 */
  dropStatus?: boolean
}

/** 归一后的文本与最终状态（普通票可以没有状态）。 */
export interface StatusNormalizeResult {
  text: string
  status?: string
}

/** 本件交出去的失败形状：与 failAs 落的三段式一致。 */
export interface StatusWriteFailure {
  ok: false
  error: { kind: string; message: string; raw: string }
}

/** 从一份票文件文本读出状态结论；路线决定票型（地图子票 / 实施票 / 普通票 / 缺陷票）。
 *
 *  labelsOverride 给的是「这次写完以后标签会是什么」：改标签是整批替换，判定票型与隐藏 triage
 *  都得按新名单算，不能按盘上的旧名单算。反例（不传它就会踩）：地图目录里一张可见 Status 是
 *  ready-for-agent 的旧票，第一次 setLabels(['bug']) 后盘上多了 bug 标签；若第二次仍按旧文件判型，
 *  票型会在「地图子票」与「缺陷票」之间来回跳，同一批标签每贴一次都会改一次状态、永远判不成 noop。 */
export function statusReadOfText(txt: string, route: TicketRoute, labelsOverride?: readonly string[]): StatusReadInfo {
  const issue = parseMd(String(txt || ''), { key: '00', parentKey: null, isMap: false, route })
  const labels: string[] = []
  for (const one of issue.labels || []) labels.push(one.name)
  if (labelsOverride !== undefined) {
    // 可见状态行的原始值：读侧在「用的就是可见值」时不回填 statusVisible，要按来源补回来。
    const visibleRaw: string | undefined =
      issue.statusVisible !== undefined ? issue.statusVisible : issue.statusSource === 'visible' ? issue.status : undefined
    const kind = statusKindOf({ route }, labelsOverride)
    // 隐藏侧用盘上真正写在 DSH-LABELS 里的 triage（不拿读侧合成的那一枚）：合成值只是可见状态的影子，
    // 把它当成第二个来源会让「重复贴同一批标签」每次都多出一行历史。
    const read = resolveStatusRead(kind, visibleRaw, hiddenTriageOf(txt))
    const info: StatusReadInfo = { kind, labels: labelsOverride.slice() }
    if (read.status !== undefined) info.status = read.status
    if (read.statusSource !== undefined) info.statusSource = read.statusSource
    if (read.statusVisible !== undefined) info.statusVisible = read.statusVisible
    if (read.statusConflict !== undefined) info.statusConflict = read.statusConflict
    return info
  }
  const info: StatusReadInfo = { kind: statusKindOf({ route }, issue.labels), labels }
  if (issue.status !== undefined) info.status = issue.status
  if (issue.statusSource !== undefined) info.statusSource = issue.statusSource
  if (issue.statusVisible !== undefined) info.statusVisible = issue.statusVisible
  if (issue.statusConflict !== undefined) info.statusConflict = issue.statusConflict
  return info
}

/** 这种票型认哪些状态值：地图子票只认 YAML 里的 claimed / resolved，其余认五种 triage 加完成值。 */
function isLegalFor(kind: IssueFileKind, value: string): boolean {
  if (kind === 'map-ticket') return WAYFINDER_STATUS_VALUES.indexOf(value) >= 0
  return isTriageStatus(value) || COMPLETED_STATUS_VALUES.indexOf(value) >= 0
}

/** 说清这个票型允许哪些状态值；非法值拒绝时原样讲给调用方看，不让人去猜。 */
function kindRuleText(kind: IssueFileKind): string {
  if (kind === 'map-ticket') return '地图子票只认 ' + WAYFINDER_STATUS_VALUES.join(' / ')
  return (
    '只能是五个 triage 角色（' +
    TRIAGE_STATUS_ROLES.join(' / ') +
    '）或完成值（' +
    COMPLETED_STATUS_VALUES.join(' / ') +
    '）'
  )
}

/** 这次归一该不该记一行历史、记什么。
 *  只有「真有一个值落选」才记：同值重复写不记账；时间由调用方补，保证同一份文件里格式统一。 */
function historyFor(
  read: StatusReadInfo,
  adopted: string | undefined,
  explicit: string | undefined,
): StatusHistoryEntry | null {
  const conflict = read.statusConflict
  if (explicit !== undefined && conflict) {
    const visible: string = conflict.visible
    const hidden: string = conflict.hidden.length ? conflict.hidden[0] : ''
    if (explicit === visible) return { source: 'hidden', discarded: hidden, adopted: explicit, at: '' }
    return { source: 'visible', discarded: visible, adopted: explicit, at: '' }
  }
  if (explicit !== undefined) {
    // 普通的状态流转（比如关闭时把 ready-for-agent 改成 resolved）不是归一：可见 Status 行仍是唯一真源，
    // 旧值本来就被这一行覆盖了，记账只会让每次关闭都多一行噪音。只有「旧文件里还藏着第二个来源」才记：
    // 隐藏 triage 被退场，或可见行带着一个没被采用的原值。
    // 可见行里的旧默认值（地图子票老文件的 Status: ready-for-agent 就是一例）不算第二个来源：
    // 它是旧词表写法，不是调用方另做的决定；给它记历史只会让每次关闭都多一行噪音。
    const dualSource: boolean =
      read.statusSource === 'hidden' ||
      (read.statusVisible !== undefined && read.statusVisible !== LEGACY_STATUS_DEFAULT)
    if (dualSource && read.status !== undefined && read.status !== explicit) {
      return { source: read.statusSource || 'visible', discarded: read.status, adopted: explicit, at: '' }
    }
    return null
  }
  if (adopted === undefined) return null
  if (read.statusVisible !== undefined && read.statusVisible !== adopted) {
    return { source: 'visible', discarded: read.statusVisible, adopted, at: '' }
  }
  // 隐藏 triage 被并进可见 Status 行：两者同值，历史记「隐藏来源这一枚退场」。
  if (read.statusSource === 'hidden') return { source: 'hidden', discarded: adopted, adopted, at: '' }
  return null
}

/** 改标签前的状态护栏：多枚 triage 无法落成一条可见 Status 行，直接拒绝并说清怎么改。 */
export function triageRefusalOf(triage: string[], names: string[]): StatusWriteFailure | null {
  if (triage.length <= 1) return null
  return failAs(
    ERROR_KIND.PARSE,
    '这次给了多枚 triage 状态标签（' + triage.join('、') + '）：可见 Status 行只能写一个状态，请只留一枚。',
    JSON.stringify(names),
  )
}

/** 改标签这一趟的状态落盘：把标签里唯一的一枚 triage 变成显式状态，其余交给归一。
 *  正文里另写了 Status 行（整份替换正文时）与标签 triage 冲突时整次拒绝，不替调用方挑一个。
 *  返回归一后的整份文本；失败时返回失败对象，调用方原样上抛（盘上一个字都不动）。 */
export function labelsChoiceText(
  txt: string,
  route: TicketRoute,
  names: string[],
  bodyStatus: string | null,
  statusOpt?: string,
): string | StatusWriteFailure {
  const triage: string[] = triageNamesOf(names)
  const refused: StatusWriteFailure | null = triageRefusalOf(triage, names)
  if (refused) return refused
  if (triage.length === 1 && bodyStatus && bodyStatus !== triage[0]) {
    return failAs(
      ERROR_KIND.PARSE,
      '正文里的 Status 行写的是「' + bodyStatus + '」，标签里的 triage 是「' + triage[0] + '」：两处不一致，请只留一处。',
      JSON.stringify({ bodyStatus, triage }),
    )
  }
  // 同一次调用里显式点的状态只能有一个说法：标签里的 triage、正文里的 Status 行、调用方给的状态选项
  // 三者不一致时整次拒绝（盘上一个字不动）。后端是这条判据的唯一实现处，deck 那一侧只负责把话带回来。
  if (statusOpt && triage.length === 1 && statusOpt !== triage[0]) {
    return failAs(
      ERROR_KIND.PARSE,
      '这次要落的状态是「' + statusOpt + '」，但标签里的 triage 是「' + triage[0] + '」：两处不一致，请只留一处。',
      JSON.stringify({ status: statusOpt, triage }),
    )
  }
  if (statusOpt && bodyStatus && bodyStatus !== statusOpt) {
    return failAs(
      ERROR_KIND.PARSE,
      '这次要落的状态是「' + statusOpt + '」，但正文里的 Status 行写的是「' + bodyStatus + '」：两处不一致，请只留一处。',
      JSON.stringify({ status: statusOpt, bodyStatus }),
    )
  }
  const chosen: string | undefined = triage.length === 1 ? triage[0] : (statusOpt || undefined)
  // 改标签是整批替换：状态归一必须按「这次写完以后」的标签名单判票型，否则地图目录与缺陷票
  // 会因盘上旧标签来回换词表，重复贴同一批标签永远不是 noop（见 statusReadOfText 的注释）。
  const normed: { ok: true; data: StatusNormalizeResult } | StatusWriteFailure = normalizeIssueStatusText(txt, route, {
    status: chosen,
    labels: names,
    readLabels: names,
  })
  return normed.ok ? normed.data.text : normed
}

/** 原文隐藏 DSH-LABELS 里还留着的 triage 标签（归一后要被移除并记历史的那部分）。
 *  只给地图子票用：issue 文件的隐藏 triage 由读侧报成冲突或旧默认，走的是另一条历史口径。 */
function hiddenTriageOf(txt: string): string[] {
  const hidden = hiddenCommentOf(txt, 'DSH-LABELS')
  if (!hidden.found) return []
  return triageNamesOf(hidden.value.split(/[,，]/).map((one) => one.trim()).filter(Boolean))
}

/**
 * 把一份票文件的状态落成「可见 Status 行是唯一真源」的形状，返回归一后的整份文本。
 *
 * 顺序：先校验显式状态 → 冲突拦一次 → 算采用值 → 重写隐藏标签与可见 Labels 行 → 写/删可见 Status 行
 * → 最后补历史。任何一步判断失败都返回失败对象，盘上一个字都不动（调用方把对象原样往上传）。
 */
export function normalizeIssueStatusText(
  txt: string,
  route: TicketRoute,
  choice?: StatusNormalizeChoice,
): { ok: true; data: StatusNormalizeResult } | StatusWriteFailure {
  const pick: StatusNormalizeChoice = choice || {}
  const read: StatusReadInfo = statusReadOfText(txt, route, pick.readLabels)
  let explicit: string | undefined
  if (pick.status !== undefined) {
    const wanted: string | null = normalizeStatus(pick.status)
    if (wanted === null || !isLegalFor(read.kind, wanted)) {
      return failAs(
        ERROR_KIND.PARSE,
        '状态值「' + String(pick.status) + '」不能用：' + kindRuleText(read.kind) + '。',
        String(pick.status),
      )
    }
    explicit = wanted
  }
  if (read.statusConflict && explicit === undefined && !pick.dropStatus) {
    const conflict: StatusConflict = read.statusConflict
    const hidden: string = conflict.hidden.length ? conflict.hidden[0] : ''
    return failAs(
      ERROR_KIND.PARSE,
      '这张票的可见 Status 行写的是「' +
        conflict.visible +
        '」，隐藏 DSH-LABELS 里的 triage 标签写的是「' +
        hidden +
        '」：两处冲突，这次一个字都没写。请显式给一个状态，或先用 setLabels 把两处归一' +
        '（deck 的 issue-patch 回执会带 retry 参数，按它重试即可）。',
      JSON.stringify(conflict),
    )
  }
  // #1790 缺陷 A：地图子票只认 claimed / resolved，旧文件里若还藏着 triage 状态标签，它既不参与判定、
  // 也不该留在隐藏注释里：首次写入时随归一一起移除，并把落选值记进历史（契约 §三，验收 §七.6）。
  const mapHidden: string[] = read.kind === 'map-ticket' ? hiddenTriageOf(txt) : []
  const adopted: string | undefined = explicit !== undefined ? explicit : pick.dropStatus ? undefined : read.status
  const labels: string[] = pick.labels !== undefined ? pick.labels : read.labels
  const hidden: string[] = hiddenLabelsOf(labels)
  let out: string = upsertHiddenComment(txt, 'DSH-LABELS', hidden.length ? hidden.join(', ') : null)
  // 手写文件里人自己补过可见 Labels 行：两处一起改，否则读路径先认可见行，读回来还是旧名单。
  if (fieldStyleOf(out, 'Labels') !== '') out = writeFieldByStyle(out, 'Labels', hidden.join(', '))
  if (adopted !== undefined) {
    out = writeFieldByStyle(out, 'Status', adopted, ticketFormOf(out) === 'impl-ticket' ? 'bold' : 'bare')
  } else {
    out = removeField(out, 'Status')
  }
  const history: StatusHistoryEntry | null = historyFor(read, adopted, explicit)
  if (history) {
    history.at = new Date().toISOString()
    out = appendStatusHistory(out, history)
  }
  if (mapHidden.length) {
    const adoptedForHistory: string = adopted !== undefined ? adopted : ''
    const at: string = new Date().toISOString()
    for (const discarded of mapHidden) {
      if (discarded === adoptedForHistory) continue
      out = appendStatusHistory(out, { source: 'hidden', discarded, adopted: adoptedForHistory, at })
    }
  }
  const data: StatusNormalizeResult = { text: out }
  if (adopted !== undefined) data.status = adopted
  return { ok: true, data }
}
