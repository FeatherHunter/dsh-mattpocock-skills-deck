// src/deck/shell/edge-landing.ts —— 边的落点判定与逐项证据（宿主侧门面）
//
// 本件在 #1039 拆层后剩四件事：
//   一、把纯规则侧（src/deck/rules/edge-landing.ts 与 dependency-graph.ts）的判定原样转出去；
//   二、逐条证据的拼装（edgeEvidence）：把判定结果拼成返回里那一行；
//   三、真正碰后端的三件事：写父子边并读回、写一组阻塞边并读回、写前读整图做整批成环预检；
//   四、子票清单的挑选（childrenOf）。
//
// 为什么判定与读写要分开：判定只看「契约返回的结构字段里有没有、正文里有没有那一行」，
// 与后端是谁、与怎么调都无关；读写则必须拿到一个活的契约对象。切开以后，
// 「同一条边在三个后端上分别落到哪里」这件事可以拿假返回直接测（tests/verify-deck-tools-matrix.js），
// 不必真的连后端。
//
// 一条铁律没变：只看证据，不看是哪个后端。这一层里不许出现「后端 id 等于 github 就怎样」这种判断；
// 每一档都由结构字段与正文推出来，推不出来就说「说不好」，绝不默认升成「原生层级」。
import {
  bodyRefersTo as bodyRefersToRules,
  classifyEdgeLanding as classifyEdgeLandingRules,
  edgeVerdict as edgeVerdictRules,
  landingOf as landingOfRules,
  relationsOf as relationsOfRules,
} from '../rules/edge-landing.js'
import type { EdgeEvidence } from '../rules/edge-landing.js'
import { hasCycleInAdj as hasCycleInAdjRules, refuseCyclicBlockBatch } from '../rules/dependency-graph.js'

export { EDGE_LANDING } from '../rules/edge-landing.js'
// 类型导出与值导出走的是两条不同的通道：这里把纯侧的三个类型原样转出去，
// 让工具层既能拿到值也能拿到标注用的类型。
export type { EdgeEvidence, EdgeVerdict, Relations } from '../rules/edge-landing.js'

/** 落点判定：判定本体在纯侧，这里只是转发（调用方按老路径 import 不用改）。 */
export const landingOf = landingOfRules
/** 从票的返回里读出关系所在的字段。 */
export const relationsOf = relationsOfRules
/** 正文里有没有指向某张票的引用。 */
export const bodyRefersTo = bodyRefersToRules
/** 写完之后读回一次，判这一条边落在哪一列。 */
export const classifyEdgeLanding = classifyEdgeLandingRules
/** 判一条边落上了没有：只有写后读回的结构字段能确认（landed / not-landed / unconfirmed）。 */
export const edgeVerdict = edgeVerdictRules
/** 依赖图里有没有环（邻接表是「票号 → 它的阻塞方集合」）。 */
export const hasCycleInAdj = hasCycleInAdjRules

/** 返回里那一行证据的最终形状：判定结果 + 键 + 角色 + 这一条成没成。 */
export interface EdgeItem {
  /** 这一次做的是哪种边：父子是 parent、阻塞是 block。 */
  op?: string
  /** 这条边指向谁（票号字符串）。 */
  target?: string
  /** 落点（见 EDGE_LANDING 的那几档文字）。 */
  landing?: string
  /** 取证的原话。 */
  evidence?: string
  /** 这一条成没成。 */
  ok?: boolean
  /** 这条明细记在哪张票上。 */
  key?: string
  /** 这一行的角色：edge 表示它是一条边（不是字段、不是评论）。 */
  role?: string
  /** 这一行的结论：ok / failed。 */
  status?: string
  /** 其余由调用方补的字段（例如「重复出现的次数」）原样带上。 */
  [extra: string]: unknown
}

/** 一条边的证据长什么样（逐条列在返回里，AI 与人都能对账）。 */
export function edgeEvidence(op: string, target: unknown, evidence: unknown, extra?: unknown): EdgeItem {
  const ev = (evidence && typeof evidence === 'object') ? evidence as EdgeEvidence : {}
  return Object.assign({
    op: op,
    target: String(target || ''),
    landing: landingOfRules(op, ev),
    evidence: (typeof ev.text === 'string' && ev.text) || (ev.kind === 'unsupported' ? '后端原话：做不到' : '这次没有拿到能判落点的证据'),
    ok: ev.ok !== false,
  }, (extra && typeof extra === 'object') ? extra as Record<string, unknown> : {})
}

/** 后端自己说做不到时，落点那一格照它的原话写，不翻译、不改写。 */
export function unsupportedEvidence(message: unknown): EdgeEvidence {
  const text = (typeof message === 'string') ? message : ''
  return { kind: 'unsupported', ok: false, text: '后端原话：' + (text || '这个后端做不到这条操作') }
}

/**
 * 从一份清单里挑出真属于这张地图的子票。
 *
 * 这一步为什么不能省：契约的 `list(repo, {parentKey})` 在三个后端上并不是「按父票筛」的同一种东西
 * —— 有的后端回的就是全部票（由宿主侧再筛），有的后端要另去取它自己的结构（GitHub 的 sub_issues）。
 * 所以这里按「行上有没有父子信息」判：带了 parentKey 就照它筛，没带就原样用，并把这件事如实说出来。
 * 宁可让调用方知道这份清单不精确，也不要静默地把它当成精确的。
 */
export function childrenOf(rows: unknown, mapKey: unknown): { children: Record<string, unknown>[]; filtered: boolean; note: string } {
  const list = Array.isArray(rows) ? rows : []
  const anyInfo = list.some((r) => {
    const row = (r && typeof r === 'object') ? r as { parentKey?: unknown } : {}
    return row.parentKey !== undefined && row.parentKey !== null && row.parentKey !== ''
  })
  if (!anyInfo) {
    return { children: list, filtered: false, note: '这个后端的清单接口没带父子信息（它回的是一批票、不是按父票筛过的），下面的子票清单是按原文列的：要精确的子票清单，请逐张用 deck_issue_get 看 parentKey。' }
  }
  return {
    children: list.filter((r) => {
      const row = (r && typeof r === 'object') ? r as { parentKey?: unknown } : {}
      return String(row.parentKey) === String(mapKey)
    }),
    filtered: true,
    note: '',
  }
}

/** 契约的一行返回：成不成、数据、失败原话。 */
interface ContractReply {
  ok?: boolean
  data?: unknown
  error?: { message?: unknown } | null
}

/**
 * 这一层用到的契约能力：只列真正会调的那几个方法，别的能力（列表、评论、改标签）不在这里。
 * 为什么自己写一份而不是从契约层 import：契约对 deck 层公开的是运行时常量，没有可导出的类型；
 * 而写成形参形状以后，验收脚本可以拿假的契约对象直接喂进来测这一层。
 */
export interface EdgeContract {
  setParent(repo: unknown, from: string, to: string, opts: unknown, opCtx: unknown): Promise<ContractReply | null | undefined>
  setBlockedBy(repo: unknown, from: string, targets: string[], opts: unknown, opCtx: unknown): Promise<ContractReply | null | undefined>
  get?(repo: unknown, key: string, opts: unknown, opCtx: unknown): Promise<ContractReply | null | undefined>
  getDependencies?(repo: unknown, key: string, opts: unknown, opCtx: unknown): Promise<ContractReply | null | undefined>
  list?(repo: unknown, opts: unknown, opCtx: unknown): Promise<ContractReply | null | undefined>
}

/** 从失败返回里取一句能给人看的原话（超长的截到 200 字，免得把返回撑爆）。 */
function failureText(reply: ContractReply | null | undefined): string {
  const r = (reply && typeof reply === 'object') ? reply : {}
  const err = (r.error && typeof r.error === 'object') ? r.error : {}
  const msg = (typeof err.message === 'string') ? err.message : ''
  return String(msg || '后端没给出原因').slice(0, 200)
}

/**
 * 写一条父子边并读回核对。回 { item, applied }：item 是拼好明细的那一行，
 * applied 表示读回来的 parentKey 确实等于目标。
 * 同一张票的父子写必须串行（同时写同一张票会丢一次改动），不同票的可以同时调。
 */
export async function applyParentEdge(
  t: EdgeContract, repo: unknown, opCtx: unknown, from: string, to: unknown,
): Promise<{ item: EdgeItem; applied: boolean }> {
  const want = String(to)
  const written = await t.setParent(repo, from, want, {}, opCtx)
  if (!written || written.ok !== true) {
    const ev = unsupportedEvidence(failureText(written))
    return { item: Object.assign({ key: from, role: 'edge', status: 'failed' }, edgeEvidence('parent', want, ev)), applied: false }
  }
  const back = (t && typeof t.get === 'function') ? await t.get(repo, from, {}, opCtx) : null
  const afterIssue = (back && back.ok === true) ? back.data : null
  const backError = (back && back.ok !== true) ? failureText(back) : ''
  const issueRow = (afterIssue && typeof afterIssue === 'object') ? afterIssue as { parentKey?: unknown } : {}
  let ev: EdgeEvidence = classifyEdgeLandingRules('parent', want, { issue: afterIssue, dependencies: null })
  const landedKey = (issueRow.parentKey !== undefined && issueRow.parentKey !== null) ? String(issueRow.parentKey) : ''
  // #790 的教训：判「落上了」只看写后读回的结构字段（纯侧的 edgeVerdict），
  // 不许再拿「正文里出现过票号」或写动作自己的返回当证据 —— 那两条会把没挂上的边报成挂上。
  const landedOk = edgeVerdictRules('parent', want, afterIssue === null ? null : { issue: afterIssue, dependencies: null }) === 'landed'
  if (!landedOk) {
    ev = backError
      ? { kind: 'unknown', ok: false, text: '写后读回失败：读票没成功（后端原话：' + backError + '）；写操作已回成功，边可能已建成但没确认。票的 parentKey 读到的是 ' + (landedKey || '空') + '，要的是 ' + want }
      : { kind: 'missing', ok: false, text: '写后读回：票的 parentKey 读到的是 ' + (landedKey || '空') + '，要的是 ' + want + '。' + String(ev.text || '') }
  }
  return { item: Object.assign({ key: from, role: 'edge', status: landedOk ? 'ok' : 'failed' }, edgeEvidence('parent', want, ev)), applied: landedOk }
}

/**
 * 写一组阻塞边（整批替换一次）并读回核对。occurrences 是本次要出明细的目标清单
 * （调用方已按票合并，同一张票只调一次）。回 { items, applied, landed, after, failed, readOk }：
 * items 是逐条明细，applied 是真正落上的目标，landed 是读回来的全集，
 * after 是读回的原文（调用方给重复项补明细用），failed 非空表示写这一步就没成，
 * readOk 说「写后读回这一步自己成没成」——读失败时 landed 是空的，但那是「没读到」，
 * 不是「读回来了、里面没有」，调用方给重复项补明细时必须照 readOk 分开说（#790）。
 */
export async function applyBlockEdges(
  t: EdgeContract, repo: unknown, opCtx: unknown, from: string, targets: unknown, occurrences: unknown,
): Promise<{
  items: EdgeItem[]
  applied: string[]
  landed: string[]
  after: { issue: unknown; dependencies: unknown }
  failed: EdgeEvidence | null
  readOk: boolean
}> {
  const want = (Array.isArray(targets) ? targets : []).map(String)
  const list = (Array.isArray(occurrences) ? occurrences : []).map(String)
  const written = await t.setBlockedBy(repo, from, want, {}, opCtx)
  if (!written || written.ok !== true) {
    const ev = unsupportedEvidence(failureText(written))
    return {
      items: list.map((to) => Object.assign({ key: from, role: 'edge', status: 'failed' }, edgeEvidence('block', to, ev))),
      applied: [], landed: [], after: { issue: null, dependencies: null }, failed: ev, readOk: false,
    }
  }
  const back = (t && typeof t.get === 'function') ? await t.get(repo, from, {}, opCtx) : null
  const dep = (t && typeof t.getDependencies === 'function') ? await t.getDependencies(repo, from, {}, opCtx) : null
  const after = { issue: (back && back.ok === true) ? back.data : null, dependencies: (dep && dep.ok === true) ? dep.data : null }
  // 读回这一步自己成没成，与「读回来了、里面没有这条边」是两件事（#790）：
  // 读失败时只能说「没读回来，判不了」，绝不许说成「这条依赖没出现在票上」。
  // 为什么套 !!：`back && ...` 在 back 为 null 时求值成 null，这一格要的是布尔（类型检查会红）。
  const depReadable = !!(t && typeof t.getDependencies === 'function')
  const readOk = !!((back && back.ok === true) && (!depReadable || (dep && dep.ok === true)))
  const landed = readOk ? relationsOfRules(after.issue || {}, after.dependencies).blockedBy : []
  const readError = readOk ? '' : failureText((back && back.ok !== true) ? back : dep)
  const items = list.map((to) => {
    if (!readOk) {
      const ev = unsupportedEvidence('写后没读回来，判不了这条依赖落上了没有（' + (readError || '读回没成功') + '）；写操作已回成功，这条边可能已建成但没确认')
      return Object.assign({ key: from, role: 'edge', status: 'failed' }, edgeEvidence('block', to, ev))
    }
    const hit = edgeVerdictRules('block', to, after) === 'landed'
    const ev: EdgeEvidence = hit ? classifyEdgeLandingRules('block', to, after) : { kind: 'missing', ok: false, text: '写后读回：这条依赖不在票上（要 ' + to + '，读回来 ' + (landed.join('、') || '空') + '）' }
    return Object.assign({ key: from, role: 'edge', status: hit ? 'ok' : 'failed' }, edgeEvidence('block', to, ev))
  })
  return { items: items, applied: list.filter((to) => landed.indexOf(to) >= 0), landed: landed, after: after, failed: null, readOk: readOk }
}

/**
 * 整批成环预检（#929）：写任何一条边之前，先读一次整图，把这一批要写的阻塞边按实际写出顺序
 * 逐条试放，会让依赖图成环的那一条挑出来（返回 refused：票号 → 原因）。
 *
 * 这一层负责「读图」，判定本体在纯侧（src/deck/rules/dependency-graph.ts 的 refuseCyclicBlockBatch）：
 * 为什么要整批一起算、以及「某一条边单独看不成环」为什么不代表安全，都写在那边。
 * 读不回整图时不猜：回 ok:false，调用方照旧往下写并在 notes 里如实说一句。
 */
export async function precheckBlockBatch(
  t: EdgeContract, repo: unknown, opCtx: unknown, keyOrder: readonly string[], mergedBlocked: ReadonlyMap<string, readonly string[]>,
): Promise<{ ok: boolean; refused: Map<string, string> }> {
  if (typeof t.list !== 'function') return { ok: false, refused: new Map() }
  let res: ContractReply | null | undefined = null
  try { res = await t.list(repo, {}, opCtx) } catch (e) { return { ok: false, refused: new Map() } }
  if (!res || res.ok !== true || !Array.isArray(res.data)) return { ok: false, refused: new Map() }
  // 盘上已有的图：每一行是「这张票被谁挡着」。行的形状不可信，逐格收口。
  const graph = new Map<string, string[]>()
  for (const raw of res.data) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as { key?: unknown; blockedBy?: unknown }
    if (row.key === undefined || row.key === null) continue
    const blockers = (Array.isArray(row.blockedBy) ? row.blockedBy : []).map((b) => {
      if (b && typeof b === 'object' && 'key' in b) return String((b as { key?: unknown }).key || '')
      return String(b || '')
    }).filter(Boolean)
    graph.set(String(row.key), blockers)
  }
  const verdict = refuseCyclicBlockBatch({ graph: graph, keyOrder: keyOrder, blockedBy: mergedBlocked })
  return { ok: true, refused: verdict.refused }
}

/** 一批里有的成、有的没成时，这条总结论是 partial；全成是 ok；全没成是 unsupported。 */
export function statusOfItems(items: unknown): string {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return 'ok'
  const failed = list.filter((i) => {
    const row = (i && typeof i === 'object') ? i as { status?: unknown } : {}
    return row.status !== 'ok'
  }).length
  if (failed === 0) return 'ok'
  return failed === list.length ? 'unsupported' : 'partial'
}

// 类型导出与值导出走的是两条不同的通道：上面已经把 EDGE_LANDING 这个值转出去了，
// 这里再补一次类型的转发，是为了让工具层写标注时两条都能拿到。
export type { EdgeEvidence as EdgeEvidenceShape } from '../rules/edge-landing.js'
