// src/deck/rules/object-kind.ts —— 建票的两层词表：六个位置值 → 契约类型 / 标签 / 正文标记 / 父票规则
//
// 为什么单独立一张表，而不是扩 minimal-spec.ts：那个文件回答「最少要保证什么」（补哪些标签、补哪段正文），
// 这张表回答「这个位置在三种后端各是什么」（契约类型、类型标签、正文标记、父票能挂在哪）。
// 两件事的读者与改动理由都不同：调最少规范是产品口径，调位置表是对象类型的分层，混在一处会让两个问题
// 互相牵制。建票工具从这里取一次答案，别在工具里再抄第二份对照表。
//
// 两层词表（#1403 定版）：
//   第一层是位置：map（探索地图，顶层容器）/ map-ticket（地图下的工单）/ spec（规格，顶层容器）/
//   spec-ticket（规格下的实施票）/ bug（普通缺陷票）/ issue（普通票，万能兜底）；
//   第二层只有地图工单有：label 一枚，四选一 research / prototype / grilling / task。
// 契约层只有三种类型（issue / map / spec），其余身份靠类型标签与正文文件头的对象标记表达。
//
// 纯在哪：只做字符串与数组的计算，不取会话、不起进程、不读写文件、不读钟；这张表被建票工具与纯规则单测共用。
// 本地 Markdown 房不引它：房侧只按「文件头标记 / Type 行 / wayfinder 标签」各自收口，不判断位置值。
/** 建票的六个位置值。顺序就是工具 schema 里列出来的顺序，也是本文件真值表的顺序。 */
export type PositionKind = 'map' | 'map-ticket' | 'spec' | 'spec-ticket' | 'bug' | 'issue'

/** 六个位置值，按「先容器、后票、最后兜底」排。 */
export const POSITION_KINDS: readonly PositionKind[] = Object.freeze([
  'map', 'map-ticket', 'spec', 'spec-ticket', 'bug', 'issue',
])

/** 地图工单的 label 只认这四枚；名字带 wayfinder: 前缀，与仓库的标签真名一致。 */
export const MAP_TICKET_LABELS: readonly string[] = Object.freeze([
  'wayfinder:research', 'wayfinder:prototype', 'wayfinder:grilling', 'wayfinder:task',
])

/** 六枚类型标签：身份由它们表达，调用方不许把它们再塞进 labels（kind=issue 的兜底除外）。 */
export const TYPE_LABELS: readonly string[] = Object.freeze([
  'wayfinder:map', 'wayfinder:research', 'wayfinder:prototype', 'wayfinder:grilling', 'wayfinder:task', 'bug',
])

/** 契约层的三种类型（与 src/tracker/contract/identity.ts 的 IssueType 同一套取值）。 */
export type ContractType = 'issue' | 'map' | 'spec'

/** 父票规则：none=顶层容器不收父票；map=父必须是探索地图；spec=父必须是规格；optional=可给可不给。 */
export type ParentRule = 'none' | 'map' | 'spec' | 'optional'

/** 一个位置值在三种后端各是什么。契约类型与标记值是写后端的输入，标签是补标签的输入。 */
export interface ObjectKindRule {
  readonly kind: PositionKind
  /** 调后端时传的契约类型：map / spec 各成一类，其余全部是 issue。 */
  readonly contractType: ContractType
  /** 固定要补的类型标签（地图是 wayfinder:map，缺陷是 bug；地图工单的那一枚由 label 现给）。 */
  readonly typeLabels: readonly string[]
  /** 固定要补的 triage 标签（规格与实施票是 ready-for-agent，缺陷是 needs-triage）。 */
  readonly triageLabels: readonly string[]
  /** 正文文件头要写的对象标记值；空串表示这一类不写标记。 */
  readonly marker: '' | 'spec' | 'ticket'
  /** 父票能挂在哪。 */
  readonly parent: ParentRule
  /** 建票时 label 是否必填（只有地图工单是 true）。 */
  readonly labelRequired: boolean
  /** 正文骨架是不是地图五节（只有 map 是 true；进度区所有位置值都补）。 */
  readonly mapBlocks: boolean
}

/**
 * 唯一的位置表：六个位置值在这里各占一行，别处不许再写第二份。
 * 每一行的「为什么」：map 与 spec 是顶层容器，所以 parent=none；地图工单的父是地图，实施票的父是规格；
 * bug 与 issue 是普通票，父可选（给了就必须是某种容器，运行时的读票核对在工具里做）。
 */
export const OBJECT_KIND_RULES: Readonly<Record<PositionKind, ObjectKindRule>> = Object.freeze({
  map: Object.freeze({
    kind: 'map', contractType: 'map', typeLabels: Object.freeze(['wayfinder:map']), triageLabels: Object.freeze([]),
    marker: '', parent: 'none', labelRequired: false, mapBlocks: true,
  }),
  'map-ticket': Object.freeze({
    kind: 'map-ticket', contractType: 'issue', typeLabels: Object.freeze([]), triageLabels: Object.freeze([]),
    marker: '', parent: 'map', labelRequired: true, mapBlocks: false,
  }),
  spec: Object.freeze({
    kind: 'spec', contractType: 'spec', typeLabels: Object.freeze([]), triageLabels: Object.freeze(['ready-for-agent']),
    marker: 'spec', parent: 'none', labelRequired: false, mapBlocks: false,
  }),
  'spec-ticket': Object.freeze({
    kind: 'spec-ticket', contractType: 'issue', typeLabels: Object.freeze([]), triageLabels: Object.freeze(['ready-for-agent']),
    marker: 'ticket', parent: 'spec', labelRequired: false, mapBlocks: false,
  }),
  bug: Object.freeze({
    kind: 'bug', contractType: 'issue', typeLabels: Object.freeze(['bug']), triageLabels: Object.freeze(['needs-triage']),
    marker: '', parent: 'optional', labelRequired: false, mapBlocks: false,
  }),
  issue: Object.freeze({
    kind: 'issue', contractType: 'issue', typeLabels: Object.freeze([]), triageLabels: Object.freeze([]),
    marker: '', parent: 'optional', labelRequired: false, mapBlocks: false,
  }),
})

/** 按位置值取那一行；认不出的名字回 null（调用方自己决定是拒绝还是当没有）。 */
export function ruleFor(kind: unknown): ObjectKindRule | null {
  const k = String(kind === undefined || kind === null ? '' : kind).trim()
  const rule = OBJECT_KIND_RULES[k as PositionKind]
  return rule || null
}

/** 这枚标签是不是类型标签（六枚之一）。大小写不敏感：GitHub 的标签名不分大小写。 */
export function isTypeLabel(name: unknown): boolean {
  const n = String(name === undefined || name === null ? '' : name).trim().toLowerCase()
  if (!n) return false
  for (let i = 0; i < TYPE_LABELS.length; i += 1) {
    if (TYPE_LABELS[i].toLowerCase() === n) return true
  }
  return false
}

/** 找 labels 里第一枚类型标签（原样返回，找不到回空串）。拒绝文案与本地房的 Type 行都靠它定位。 */
export function typeLabelIn(labels: unknown): string {
  const list = Array.isArray(labels) ? labels : []
  for (let i = 0; i < list.length; i += 1) {
    const one: unknown = list[i]
    const name = (typeof one === 'string') ? one : (one && (one as { name?: unknown }).name)
    if (isTypeLabel(name)) return String(name).trim()
  }
  return ''
}

/**
 * 这一类建票时要补的标签（按顺序）。
 * 地图工单补的就是 label 那一枚，不再另补第二枚类型标签；issue 一枚都不补 —— 兜底就是原样透传。
 * 旧值 task / ticket 从 #1403 起不再认：按位置表取不到就一枚也不补，由调用方拒绝（见 resolveCreateKind）。
 */
export function labelsToEnsure(kind: unknown, label?: unknown): string[] {
  const rule = ruleFor(kind)
  if (!rule) return []
  if (rule.kind === 'map-ticket') {
    const one = String(label === undefined || label === null ? '' : label).trim()
    return one ? [one] : []
  }
  return rule.typeLabels.concat(rule.triageLabels)
}

/** 建票工具收口后的答案：契约类型、标记值、label、父票要求都已算好，调用方只管调后端。 */
export interface CreateKindResolution {
  ok: boolean
  /** 只在 ok=true 时出现。 */
  kind?: PositionKind
  contractType?: ContractType
  marker?: '' | 'spec' | 'ticket'
  label?: string
  /** labels 收口后的名字数组（原顺序，未补必备标签）。 */
  labels?: string[]
  /** 父票要求；调用方按它核运行时读到的父票类型。 */
  parent?: ParentRule
  /** 拒绝原因（人话，含合法值与迁移路径）。 */
  problem?: string
}

/** 六个位置值的合法写法，拒绝文案里反复用，只写这一处。 */
const KIND_MENU = 'map / map-ticket / spec / spec-ticket / bug / issue'

/** label 的合法写法，拒绝文案里反复用。 */
const LABEL_MENU = MAP_TICKET_LABELS.join(' / ')

/**
 * 建票前的纯校验：把 kind / label / labels / parentKey 收成一份答案，收不成就给一句人话。
 *
 * 拒绝口径（#1403 定版，按这个顺序判，先命中的先说）：
 *   1. 缺 kind 直接拒，不再回落 task；旧值 task / ticket 拒，并写清该改成哪个新值；
 *   2. label 只有地图工单收，且必填四选一；别的 kind 带了 label 一律拒；
 *   3. 除 issue 外，labels 里出现任何类型标签都拒 —— 类型标签由 kind/label 决定，调用方别在标签里重复表达身份；
 *   4. map 与 spec 是顶层容器，不收 parentKey；地图工单与实施票必须给 parentKey；bug / issue 父可选。
 *
 * 父票「到底是不是对的容器」要读盘才知道，这一步在工具里做；这里只管该不该带、带没带。
 */
export function resolveCreateKind(request: unknown): CreateKindResolution {
  const req = (request && typeof request === 'object') ? request as Record<string, unknown> : {}
  const rawKind = (req.kind === undefined || req.kind === null) ? '' : String(req.kind).trim()

  if (!rawKind) {
    return {
      ok: false,
      problem: '建票要说明这是哪一层：kind 必填，六个值 ' + KIND_MENU + '。'
        + '迁移：旧的 task 改成 map-ticket 并同时给 label（按意图四选一，例如 wayfinder:task），旧的 ticket 改成 spec-ticket。',
    }
  }
  if (rawKind === 'task') {
    return {
      ok: false,
      problem: '旧的 kind=task 不再接受：改 map-ticket 并同时给 label（按意图四选一：' + LABEL_MENU + '），'
        + '或者改 issue —— 它只是普通票、不在地图上时用 issue。',
    }
  }
  if (rawKind === 'ticket') {
    return { ok: false, problem: '旧的 kind=ticket 不再接受：改 spec-ticket（规格拆出来的实施票就是它）。' }
  }
  const rule = ruleFor(rawKind)
  if (!rule) {
    return { ok: false, problem: '没有这个位置值「' + rawKind.slice(0, 40) + '」：kind 只认 ' + KIND_MENU + '。' }
  }

  const label = (req.label === undefined || req.label === null) ? '' : String(req.label).trim()
  if (rule.kind !== 'map-ticket' && label) {
    return { ok: false, problem: '只有地图工单（kind=map-ticket）才收 label：' + rule.kind + ' 的身份已经由 kind 自己说清了，别把类型标签同时塞在 label 里。' }
  }
  if (rule.kind === 'map-ticket') {
    if (!label) {
      return { ok: false, problem: '地图工单要说明是哪一种：kind=map-ticket 时必须给 label，四选一：' + LABEL_MENU + '。' }
    }
    let known = false
    for (let i = 0; i < MAP_TICKET_LABELS.length; i += 1) {
      if (MAP_TICKET_LABELS[i] === label) known = true
    }
    if (!known) {
      return { ok: false, problem: '没有这个类型标签「' + label.slice(0, 40) + '」：地图工单的 label 只认 ' + LABEL_MENU + '。' }
    }
  }

  // labels 收口：只取名字，去掉空段；对象形状（{name}）也认（与 ensureLabels 同一套收法，不在这里另写一份）。
  const rawLabels: unknown = (req.labels === undefined || req.labels === null) ? [] : req.labels
  const labels: string[] = []
  if (Array.isArray(rawLabels)) {
    for (let i = 0; i < rawLabels.length; i += 1) {
      const one: unknown = rawLabels[i]
      const name = (typeof one === 'string') ? one : (one && (one as { name?: unknown }).name)
      const text = String(name === undefined || name === null ? '' : name).trim()
      if (text) labels.push(text)
    }
  } else if (typeof rawLabels === 'string' && rawLabels.trim()) {
    labels.push(rawLabels.trim())
  }
  if (rule.kind !== 'issue') {
    const offending = typeLabelIn(labels)
    if (offending) {
      return {
        ok: false,
        problem: 'labels 里别再放类型标签（其中有「' + offending.slice(0, 40) + '」）：类型标签由 kind/label 决定，'
          + '这里只放 triage 标签（例如 ready-for-agent、needs-triage）。',
      }
    }
  }

  const parentKey = (req.parentKey === undefined || req.parentKey === null) ? '' : String(req.parentKey).trim()
  if ((rule.kind === 'map' || rule.kind === 'spec') && parentKey) {
    return { ok: false, problem: rule.kind === 'map' ? '探索地图是顶层容器，不收 parentKey。' : '规格是顶层容器，不收 parentKey。' }
  }
  if (rule.kind === 'map-ticket' && !parentKey) {
    return { ok: false, problem: '地图工单要挂在探索地图下：kind=map-ticket 时要带 parentKey，填探索地图的票号（本地后端是 00）。' }
  }
  if (rule.kind === 'spec-ticket' && !parentKey) {
    return { ok: false, problem: '实施票要挂在规格票下：kind=spec-ticket 时要带 parentKey，填规格票号。' }
  }

  return {
    ok: true,
    kind: rule.kind,
    contractType: rule.contractType,
    marker: rule.marker,
    label: label,
    labels: labels,
    parent: rule.parent,
  }
}

