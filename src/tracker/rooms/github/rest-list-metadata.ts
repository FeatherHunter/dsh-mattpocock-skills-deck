/**
 * GitHub REST 列表行里的父票、依赖摘要与子票摘要（#1682 真机探针）。
 *
 * 为什么单独一份：同一行在这三个字段上有三种状态——接口表达了且这一行有值；接口表达了而这一行
 * 没有值（顶层票）；整个接口没有表达该字段（旧服务端、GHES 或更早的 API 版本）。把三种状态都
 * 收成 null / 0，上层就会把「不知道」当成「没有父票」「依赖为零」「子票为零」，这正是 #1681
 * 「未知 ≠ 空」要避免的事。本文件只做纯解析，不发请求、不改 list/get 的现有行为；阶段 4 才会
 * 把它接到降级路径，阶段 0 先用真机夹具把形状与退路固定下来。
 */

/** GitHub 原始行里可能出现的任意对象；解析只读需要的键。 */
type RawBag = Record<string, unknown>

/** 一组字段未知的原因。 */
export type FieldGroupReason =
  /** 整页（也就是这个接口版本）没有出现该字段组。 */
  | 'not-expressed'
  /** 拉取请求行：列表接口不为它表达这组工单关系字段。 */
  | 'not-applicable'
  /** 字段出现了，但形状/数值读不懂；不许硬猜成空或零。 */
  | 'unreadable'

/** 字段组三态：知道值、知道没有值（value 为 null）、不知道。 */
export type RestFieldGroup<T> =
  | { known: true; value: T; reason: null }
  | { known: false; value: null; reason: FieldGroupReason }

/** 依赖摘要的四个计数，与 REST 的 issue_dependencies_summary 同名转驼峰。 */
export interface IssueDependenciesSummary {
  blockedBy: number
  blocking: number
  totalBlockedBy: number
  totalBlocking: number
}

/** 子票摘要的三个计数。 */
export interface SubIssuesSummary {
  completed: number
  percentCompleted: number
  total: number
}

/** 一行的解析结果；rowKind 先分清工单与拉取请求，关系字段对后者不适用。 */
export interface RestListRowMetadata {
  rowKind: 'issue' | 'pull-request'
  parentKey: RestFieldGroup<string | null>
  dependencies: RestFieldGroup<IssueDependenciesSummary>
  subIssues: RestFieldGroup<SubIssuesSummary>
}

/** 整页扫描出来的字段出现情况，以及工单/拉取请求行数。 */
export interface RestListFieldPresence {
  parent: boolean
  dependencies: boolean
  subIssues: boolean
  issueRows: number
  pullRequestRows: number
}

/** 调用方手上已有的上次已知值；undefined 表示没有，null 在父票里表示「已知是顶层票」。 */
export interface PreviousListMetadata {
  parentKey?: string | null
  dependencies?: IssueDependenciesSummary | null
  subIssues?: SubIssuesSummary | null
}

/** 解析结果的来源：这一行给的、上次已知留下的、还是确实拿不到。 */
export type MetadataSource = 'list-row' | 'previous-known' | 'unavailable'

function asBag (raw: unknown): RawBag | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as RawBag : null
}

function hasOwn (bag: RawBag, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(bag, key)
}

function known<T> (value: T): RestFieldGroup<T> {
  return { known: true, value, reason: null }
}

function unknown<T> (reason: FieldGroupReason): RestFieldGroup<T> {
  return { known: false, value: null, reason }
}

/** 非负整数才算计数；小数、负数、字符串都不接受，避免把坏形状悄悄读成零。 */
function readCount (bag: RawBag, key: string): number | null {
  const v = bag[key]
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null
}

/** 百分比只收 0..100 的整数。 */
function readPercent (bag: RawBag, key: string): number | null {
  const v = readCount(bag, key)
  return v !== null && v <= 100 ? v : null
}

/**
 * 从 parent_issue_url 里取出父票编号。
 *
 * 为什么不用 URL 解析器：这个模块要在只带 ES2020 类型库的域配置里通过 tsc，而仓库里的
 * GitHub 服务端可能是 GHES（路径前缀 /api/v3），只认 `/issues/<数字>` 结尾最稳。
 * 明确拒绝 /pulls/ 这类同形地址，让「父票链接换了形状」变成读不懂，而不是猜成一张票。
 */
export function parseParentIssueNumber (value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!/^https?:\/\//i.test(text)) return null
  const m = /\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/?$/.exec(text)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isSafeInteger(n) || n <= 0) return null
  return String(n)
}

function isPullRequestRow (bag: RawBag): boolean {
  const v = bag.pull_request
  return hasOwn(bag, 'pull_request') && v !== null && typeof v === 'object'
}

/**
 * 扫一页，回答三组字段有没有在任意一行出现过。
 *
 * 为什么按「任意一行出现」判：顶层票本身没有 parent_issue_url，单看它会把「接口表达了、这张是
 * 顶层票」误判成「接口没表达」。一页里只要有一张子票带着父票键，就能证明这个接口版本会表达它，
 * 其余没有该键的工单行才可以读成「已知没有父票」。整页都没有时只能保守地标未知。
 */
export function detectRestListFieldPresence (rows: unknown[]): RestListFieldPresence {
  const out: RestListFieldPresence = {
    parent: false,
    dependencies: false,
    subIssues: false,
    issueRows: 0,
    pullRequestRows: 0,
  }
  for (const raw of rows) {
    const bag = asBag(raw)
    if (!bag) continue
    if (isPullRequestRow(bag)) out.pullRequestRows += 1
    else out.issueRows += 1
    if (hasOwn(bag, 'parent_issue_url')) out.parent = true
    if (hasOwn(bag, 'issue_dependencies_summary')) out.dependencies = true
    if (hasOwn(bag, 'sub_issues_summary')) out.subIssues = true
  }
  return out
}

function readParentKey (bag: RawBag): RestFieldGroup<string | null> {
  if (!hasOwn(bag, 'parent_issue_url')) return known(null)
  const value = bag.parent_issue_url
  if (value === null) return known(null)
  const number = parseParentIssueNumber(value)
  return number === null ? unknown('unreadable') : known(number)
}

function readDependencies (bag: RawBag): RestFieldGroup<IssueDependenciesSummary> {
  if (!hasOwn(bag, 'issue_dependencies_summary')) return unknown('unreadable')
  const raw = asBag(bag.issue_dependencies_summary)
  if (!raw) return unknown('unreadable')
  const blockedBy = readCount(raw, 'blocked_by')
  const blocking = readCount(raw, 'blocking')
  const totalBlockedBy = readCount(raw, 'total_blocked_by')
  const totalBlocking = readCount(raw, 'total_blocking')
  if (blockedBy === null || blocking === null || totalBlockedBy === null || totalBlocking === null) {
    return unknown('unreadable')
  }
  return known({ blockedBy, blocking, totalBlockedBy, totalBlocking })
}

function readSubIssues (bag: RawBag): RestFieldGroup<SubIssuesSummary> {
  if (!hasOwn(bag, 'sub_issues_summary')) return unknown('unreadable')
  const raw = asBag(bag.sub_issues_summary)
  if (!raw) return unknown('unreadable')
  const completed = readCount(raw, 'completed')
  const percentCompleted = readPercent(raw, 'percent_completed')
  const total = readCount(raw, 'total')
  if (completed === null || percentCompleted === null || total === null) return unknown('unreadable')
  return known({ completed, percentCompleted, total })
}

/**
 * 读一行。presence 必须来自同一批行的 detectRestListFieldPresence；调用方不能凭单行猜字段有没有表达。
 * 拉取请求行三组都标 not-applicable：真机 13/13 个拉取请求行都没有这三个键，不能据此说依赖为零。
 */
export function parseRestListRowMetadata (row: unknown, presence: RestListFieldPresence): RestListRowMetadata {
  const bag = asBag(row)
  if (!bag) {
    return {
      rowKind: 'issue',
      parentKey: unknown('unreadable'),
      dependencies: unknown('unreadable'),
      subIssues: unknown('unreadable'),
    }
  }
  if (isPullRequestRow(bag)) {
    return {
      rowKind: 'pull-request',
      parentKey: unknown('not-applicable'),
      dependencies: unknown('not-applicable'),
      subIssues: unknown('not-applicable'),
    }
  }
  return {
    rowKind: 'issue',
    parentKey: presence.parent ? readParentKey(bag) : unknown('not-expressed'),
    dependencies: presence.dependencies ? readDependencies(bag) : unknown('not-expressed'),
    subIssues: presence.subIssues ? readSubIssues(bag) : unknown('not-expressed'),
  }
}

/** 父票的退路：这一行给了就用这一行；没给但上次已知里有（包括 null）就用上次；都没有才说拿不到。 */
export function chooseParentKey (
  metadata: RestListRowMetadata,
  previous?: PreviousListMetadata,
): { parentKey: string | null; source: MetadataSource } {
  if (metadata.parentKey.known) return { parentKey: metadata.parentKey.value, source: 'list-row' }
  if (previous && (typeof previous.parentKey === 'string' || previous.parentKey === null)) {
    return { parentKey: previous.parentKey, source: 'previous-known' }
  }
  return { parentKey: null, source: 'unavailable' }
}

/** 依赖摘要的退路：字段没表达时保留上次已知，不能改成四格零。 */
export function chooseDependenciesSummary (
  metadata: RestListRowMetadata,
  previous?: PreviousListMetadata,
): { dependencies: IssueDependenciesSummary | null; source: MetadataSource } {
  if (metadata.dependencies.known) return { dependencies: metadata.dependencies.value, source: 'list-row' }
  if (previous && previous.dependencies && typeof previous.dependencies === 'object') {
    return { dependencies: previous.dependencies, source: 'previous-known' }
  }
  return { dependencies: null, source: 'unavailable' }
}

/** 子票摘要的退路：字段没表达时保留上次已知计数。 */
export function chooseSubIssuesSummary (
  metadata: RestListRowMetadata,
  previous?: PreviousListMetadata,
): { subIssues: SubIssuesSummary | null; source: MetadataSource } {
  if (metadata.subIssues.known) return { subIssues: metadata.subIssues.value, source: 'list-row' }
  if (previous && previous.subIssues && typeof previous.subIssues === 'object') {
    return { subIssues: previous.subIssues, source: 'previous-known' }
  }
  return { subIssues: null, source: 'unavailable' }
}

/**
 * 是否要为这张票逐票拉依赖明细。
 *
 * 为什么看四格而不是只看 blocked_by：真机 #1677 的 blocked_by 是 0，但 total_blocked_by 是 3；
 * 只看直接计数会漏掉「间接被阻塞」。未知时返回 null，让调用方保留上次已知，不能答成 false。
 */
export function needsDependencyDetail (group: RestFieldGroup<IssueDependenciesSummary>): boolean | null {
  if (!group.known || !group.value) return null
  const v = group.value
  return v.blockedBy > 0 || v.blocking > 0 || v.totalBlockedBy > 0 || v.totalBlocking > 0
}
