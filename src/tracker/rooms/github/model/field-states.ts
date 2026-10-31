/**
 * src/tracker/rooms/github/model/field-states.ts —— GitHub 回包 → 六组字段三态（#1688）
 *
 * 为什么单开一份：归一化要同时回答「票上写什么字段」与「这组字段是已知还是不知道」，
 * 后者有六组、每组各有三种来源形状（GraphQL 连接 / REST 数组 / 快照重入），
 * 与行字段的归一化放一份会超过仓库的单文件有效行上限；按「字段组事实」切开，
 * normalize.ts 只负责组装票。
 *
 * 口径（改之前先读这四条）：
 *  1. 三态类型在 src/tracker/contract/field-state.ts：known:true 带真值，known:false 只有原因；
 *     明确为空（null / 空数组 / 0）也是 known，绝不拿空值冒充未知。
 *  2. 原因只用三个词：not-expressed（来源没表达）、not-applicable（这类对象原生没有）、
 *     unreadable（来源给了但读不懂）。
 *  3. 「重入」优先：输入可能已经归一过（写路径会拿归一结果再拼一次），有 fieldStates 就直接沿用，
 *     免得把已知的空重算成不知道。
 *  4. 只判事实，不判完整度：截断与否由 ReadProvenance 的字段组完整度那一层表态；
 *     这里的 truncated 只反映回包自己带的 pageInfo（#1304 口径）。
 */

import { STATE, ISSUE_TYPE } from '../../../contract/vocabulary.js'
import { FIELD_STATE_REASONS } from '../../../contract/field-state.js'
import type { FieldState, FieldStateReason } from '../../../contract/field-state.js'
import type { IssueRef, Review, SubIssueCounts } from '../../../contract/entities.js'
import type { State } from '../../../contract/identity.js'

/** GitHub 原始对象的最小读形：GraphQL 与 REST 字段名各一套，缺谁都按「没表达」处理，所以全可选。 */
export type RawBag = Record<string, unknown>

/** 把未知输入收成键值袋：对象才有字段可读，其余一律按无字段处理。 */
export function asBag(raw: unknown): RawBag | null {
  return (raw && typeof raw === 'object' ? (raw as RawBag) : null)
}

/** 键是不是真的写在对象上（区分「来源给了 null」与「来源没提这个键」）。 */
export function hasField(bag: RawBag | null, field: string): boolean {
  return !!bag && Object.prototype.hasOwnProperty.call(bag, field)
}

/** 造一个「已知」的三态（明确为空也走这里：null / [] / 0 都是事实）。 */
export function knownOf<T>(value: T): FieldState<T> {
  return { known: true, value, reason: null }
}

/** 造一个「不知道」的三态，原因只取契约允许的三个词。 */
export function unknownOf<T>(reason: FieldStateReason): FieldState<T> {
  return { known: false, value: null, reason }
}

/**
 * 读结果重入：输入可能已经归一过（写路径会拿归一结果再拼一次），这时 fieldStates 就是最可信的
 * 三态事实，直接沿用，免得再把「已知的空」重算成「不知道」。
 */
function givenState<T>(bag: RawBag | null, group: string): FieldState<T> | null {
  const groups = asBag(bag && bag.fieldStates)
  if (!groups) return null
  const state = asBag(groups[group])
  if (!state || typeof state.known !== 'boolean') return null
  if (state.known === true) return knownOf(state.value as T)
  const reason = state.reason
  if (typeof reason !== 'string' || (FIELD_STATE_REASONS as readonly string[]).indexOf(reason) < 0) return null
  return unknownOf<T>(reason as FieldStateReason)
}

/**
 * 父子边三态：来源表达了父边才给 known；明确没有父票给 known(null)；
 * 来源没提父边给 not-expressed；给了但读不懂给 unreadable。
 * 为什么未知不直接落 null：null 是「确实没有父票」这条事实，未知必须与它分开，
 * 否则合并层会把「不知道」当成「没有父票」删掉上次已知的归属。
 */
export function parentStateOf(raw: unknown): FieldState<string | null> {
  const bag = asBag(raw)
  const given = givenState<string | null>(bag, 'parents')
  if (given) return given
  if (!bag) return unknownOf<string | null>('not-expressed')
  const direct = bag.parentKey
  if (typeof direct === 'string') return knownOf<string | null>(direct)
  if (direct === null && hasField(bag, 'parentKey')) return knownOf<string | null>(null)
  if (hasField(bag, 'parentKey') && direct !== undefined) return unknownOf<string | null>('unreadable')
  if (hasField(bag, 'parent')) {
    const parent = bag.parent
    if (parent === null) return knownOf<string | null>(null)
    const pb = asBag(parent)
    if (pb && pb.number != null) return knownOf<string | null>(String(pb.number))
    if (pb && typeof pb.key === 'string') return knownOf<string | null>(pb.key)
    return unknownOf<string | null>('unreadable')
  }
  return unknownOf<string | null>('not-expressed')
}

/**
 * 读一条边连接（#1304 起两路都认）：
 *  - GraphQL 连接：nodes 数组 + 可选 pageInfo.hasNextPage（缺 pageInfo 按「没有截断」收下，
 *    与 #1304 的行为一致；「恰好整页不算完整」由读结果完整度那一层判，不在这里造截断位）；
 *  - REST 数组：直接是节点数组，没有分页信息；
 *  - 历史写法 blocked_by 只在正向边这一条上兼容。
 * 返回三态而不是空连接：来源没提这条边时必须能说「未表达」。
 */
export interface EdgeRead {
  nodes: unknown[]
  truncated: boolean
}

export function edgeReadOf(raw: unknown, field: string): FieldState<EdgeRead> {
  const bag = asBag(raw)
  if (!bag) return unknownOf<EdgeRead>('not-expressed')
  const direct = bag[field]
  if (direct === null || direct === undefined) return unknownOf<EdgeRead>('not-expressed')
  if (Array.isArray(direct)) return knownOf<EdgeRead>({ nodes: direct, truncated: false })
  if (typeof direct === 'object') {
    const conn = direct as RawBag
    if (Array.isArray(conn.nodes)) {
      const pageInfo = asBag(conn.pageInfo)
      return knownOf<EdgeRead>({ nodes: conn.nodes, truncated: pageInfo ? pageInfo.hasNextPage === true : false })
    }
    return unknownOf<EdgeRead>('unreadable')
  }
  // REST 字段名的历史写法（blocked_by）只认正向边这一条。
  if (field === 'blockedBy' && Array.isArray(bag.blocked_by)) return knownOf<EdgeRead>({ nodes: bag.blocked_by as unknown[], truncated: false })
  return unknownOf<EdgeRead>('unreadable')
}

/** 边节点上的 labels 两种形状都认（GraphQL 连接 {nodes:[{name}]}、REST 数组 [{name}]），只取名字。 */
function labelNamesOfEdge(raw: unknown): string[] {
  const out: string[] = []
  const bag = raw && typeof raw === 'object' ? raw as RawBag : null
  const arr = Array.isArray(raw) ? raw : (bag && Array.isArray(bag.nodes) ? bag.nodes as unknown[] : null)
  if (!arr) return out
  for (const l of arr) {
    if (typeof l === 'string') { if (l) out.push(l); continue }
    const rec = l && typeof l === 'object' ? l as RawBag : null
    if (rec && typeof rec.name === 'string' && rec.name) out.push(rec.name)
  }
  return out
}

/** 把边连接的节点归一成一串轻量引用：键 + 标题 + 状态，种类有才补。 */
function refsOfEdgeNodes(nodes: unknown[]): IssueRef[] {
  const out: IssueRef[] = []
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    const rec = n as RawBag;
    const k = rec.number != null ? String(rec.number) : (typeof rec.key === 'string' ? rec.key : '')
    if (!k) continue
    const title = typeof rec.title === 'string' ? rec.title : ''
    const stateRaw = rec.state != null ? String(rec.state).toLowerCase() : 'open'
    const state: State = stateRaw === 'closed' ? STATE.CLOSED : STATE.OPEN
    // 为什么先装三格必备：阻塞引用只保证 key 与标题状态，种类有才补，与契约轻量引用一致。
    const ref: IssueRef = { key: k, title, state }
    // type 可选：来源明说就用来源的；只有边节点带 labels 时（#1304 的依赖查询会带）才按旧路口径推 ——
    // 带 wayfinder:map 标签的是探索地图，其余按普通票。这样新路推出来的 ref 与旧路逐票读的完全一致。
    if (rec.type === 'map' || rec.type === 'issue') ref.type = rec.type
    else if (rec.labels !== undefined && rec.labels !== null) {
      const names = labelNamesOfEdge(rec.labels)
      ref.type = names.indexOf('wayfinder:map') >= 0 ? ISSUE_TYPE.MAP : ISSUE_TYPE.ISSUE
    }
    out.push(ref)
  }
  return out
}

/** 正向依赖边三态：「被谁阻塞」。没表达就是没表达，不给空数组。 */
export function dependenciesStateOf(raw: unknown): FieldState<IssueRef[]> {
  const given = givenState<IssueRef[]>(asBag(raw), 'dependencies')
  if (given) return given
  const edge = edgeReadOf(raw, 'blockedBy')
  if (edge.known) return knownOf<IssueRef[]>(refsOfEdgeNodes(edge.value.nodes))
  return unknownOf<IssueRef[]>(edge.reason)
}

/**
 * 依赖投影归一（#1304）：一次读回正向与反向两条边，并交代这两条边各自有没有到上限。
 * 为什么单开这个出口：单票查询只要正向边（normalizeIssue 继续走同一条读法），
 * 反向边只在 getDependencies 这一条路上要，两条边一起读回来才不用整仓扫描。
 * 两条边都要带「到没到上限」：正向边同样会在 50 条被封顶，少掉的边看起来就像「没人阻塞它」。
 *
 * #1688 起两条边任一没表达就返回 null（而不是编一份空边）：调用方（read/deps-read.ts）本来
 * 就先确认两条连接都在回包里，返回 null 只可能来自「形状读不懂」，那时该退兜底而不是报「没有」。
 */
export function normalizeDependencyEdges(raw: unknown): {
  blockedBy: IssueRef[]
  blocking: IssueRef[]
  blockedByTruncated: boolean
  blockingTruncated: boolean
} | null {
  const blocked = edgeReadOf(raw, 'blockedBy')
  const blockBy = edgeReadOf(raw, 'blocking')
  if (!blocked.known || !blockBy.known) return null
  return {
    blockedBy: refsOfEdgeNodes(blocked.value.nodes),
    blocking: refsOfEdgeNodes(blockBy.value.nodes),
    blockedByTruncated: blocked.value.truncated,
    blockingTruncated: blockBy.value.truncated,
  }
}

/**
 * 子票计数三态：GraphQL 单票片段不取子票计数，走 REST 时行上有 sub_issues_summary。
 * 没表达就是未知（不是 0）；有这组但字段坏了给 unreadable。
 */
export function subIssuesStateOf(raw: unknown): FieldState<SubIssueCounts> {
  const bag = asBag(raw)
  const given = givenState<SubIssueCounts>(bag, 'subIssues')
  if (given) return given
  if (!bag) return unknownOf<SubIssueCounts>('not-expressed')
  const summary = asBag(bag.sub_issues_summary)
  if (!summary) {
    // 字段写了 null：后端这一路没有子票能力，按未表达收；写了别的东西读不懂。
    if (hasField(bag, 'sub_issues_summary') && bag.sub_issues_summary != null) return unknownOf<SubIssueCounts>('unreadable')
    return unknownOf<SubIssueCounts>('not-expressed')
  }
  const total = summary.total
  const completed = summary.completed
  const percentRaw = summary.percent_completed != null ? summary.percent_completed : summary.percentCompleted
  if (typeof total !== 'number' || typeof completed !== 'number' || typeof percentRaw !== 'number') return unknownOf<SubIssueCounts>('unreadable')
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(completed) || completed < 0) return unknownOf<SubIssueCounts>('unreadable')
  if (!isFinite(percentRaw) || percentRaw < 0 || percentRaw > 100) return unknownOf<SubIssueCounts>('unreadable')
  return knownOf<SubIssueCounts>({ total, completed, percentCompleted: Math.round(percentRaw) })
}

/**
 * 评论总数三态：总数只能来自来源明确给的总数（GraphQL totalCount、REST 的 comments 数字、
 * 重入时的 commentCount）。只有正文没有总数时保持未知——不再拿已加载正文条数顶替总数，
 * 那会让「只加载了前 50 条」看起来像「一共 50 条」。
 */
export function commentCountStateOf(raw: unknown): FieldState<number> {
  const bag = asBag(raw)
  const given = givenState<number>(bag, 'comments')
  if (given) return given
  if (!bag) return unknownOf<number>('not-expressed')
  const direct = bag.commentCount
  if (typeof direct === 'number' && isFinite(direct) && direct >= 0) return knownOf<number>(Math.floor(direct))
  const source = bag.comments
  if (source === null || source === undefined) return unknownOf<number>('not-expressed')
  if (typeof source === 'number') return isFinite(source) && source >= 0 ? knownOf<number>(Math.floor(source)) : unknownOf<number>('unreadable')
  if (Array.isArray(source)) return unknownOf<number>('not-expressed') // 只有正文数组，总数没表达
  if (typeof source === 'object') {
    const conn = source as RawBag
    if (typeof conn.totalCount === 'number' && isFinite(conn.totalCount) && conn.totalCount >= 0) return knownOf<number>(Math.floor(conn.totalCount))
    if (Array.isArray(conn.nodes)) return unknownOf<number>('not-expressed') // 只有正文节点，总数没表达
    return unknownOf<number>('unreadable')
  }
  return unknownOf<number>('unreadable')
}

/** 单条评审归一：结论必备，评审人与时间有才补；坏节点返回 null 跳过。 */
function normalizeReview(n: unknown): Review | null {
  if (!n || typeof n !== 'object') return null
  const rec = n as RawBag;
  if (typeof rec.state !== 'string' || rec.state === '') return null
  // 为什么先只装结论：评审人缺了就省略，与契约评审快照一致。
  const out: Review = { state: rec.state }
  let login = ''
  const cand = [rec.reviewer, rec.author, rec.user]
  for (const c of cand) {
    if (c && typeof c === 'object' && typeof (c as RawBag).login === 'string' && ((c as RawBag).login as string).trim() !== '') { login = (c as RawBag).login as string; break }
  }
  if (login) out.reviewer = { login }
  const when = typeof rec.submittedAt === 'string' ? rec.submittedAt : (typeof rec.submitted_at === 'string' ? rec.submitted_at : '')
  if (when) out.submittedAt = when
  return out
}

/** 评审三态：来源给了评审节点才算表达（空数组 = 明确没有评审）；没给就是未表达。 */
export function reviewStateOf(raw: unknown): FieldState<Review[]> {
  const bag = asBag(raw)
  const given = givenState<Review[]>(bag, 'review')
  if (given) return given
  if (!bag) return unknownOf<Review[]>('not-expressed')
  const source = bag.reviews
  if (source === null || source === undefined) return unknownOf<Review[]>('not-expressed')
  let nodes: unknown[] | null = null
  if (Array.isArray(source)) nodes = source
  else if (typeof source === 'object' && Array.isArray((source as RawBag).nodes)) nodes = (source as RawBag).nodes as unknown[]
  if (!nodes) return unknownOf<Review[]>('unreadable')
  const out: Review[] = []
  for (const n of nodes) {
    const r = normalizeReview(n)
    if (r) out.push(r)
  }
  return knownOf<Review[]>(out)
}

/**
 * 合并时间三态：明确的 null 是「还没合并」这条事实，必须与「不知道」分开。
 * GraphQL 拉取请求带 mergedAt；REST /pulls 行带 merged_at；REST /issues 行把合并时间
 * 放在 pull_request.merged_at 里。三种都没有 = 未表达。
 */
export function mergeInfoStateOf(raw: unknown): FieldState<string | null> {
  const bag = asBag(raw)
  const given = givenState<string | null>(bag, 'mergeInfo')
  if (given) return given
  if (!bag) return unknownOf<string | null>('not-expressed')
  const readField = (source: RawBag, field: string): FieldState<string | null> | null => {
    if (!hasField(source, field)) return null
    const value = source[field]
    if (typeof value === 'string') return knownOf<string | null>(value)
    if (value === null) return knownOf<string | null>(null)
    return unknownOf<string | null>('unreadable')
  }
  const direct = readField(bag, 'mergedAt') || readField(bag, 'merged_at')
  if (direct) return direct
  const pr = asBag(bag.pull_request)
  if (pr) {
    const nested = readField(pr, 'merged_at')
    if (nested) return nested
  }
  return unknownOf<string | null>('not-expressed')
}
