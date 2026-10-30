/**
 * src/tracker/rooms/github/write/blocked-by-write.ts — 阻塞边「写下去」这一段：优先走 GraphQL mutation，明确不支持才回落 REST 依赖接口。
 *
 * 为什么要单独一份：graph.ts 的有效行已被零增长基线冻结（tests/file-granularity-baseline.json，
 * 只许减不许增），写边这一整段（换 id、两条写循环、轨迹计数、回落决策）搬出来之后，
 * graph.ts 只留「读真值 → 算差集 → 委托写 → 读回」这条主干。
 *
 * 两条路的分工：
 *  - 主路：GraphQL `addBlockedBy` / `removeBlockedBy`。先用一次批量查询把需要的票号换成 node id
 *    （全局 ID），再逐条边发一条 mutation；成功/已在位/本来就不在都在这里结掉。
 *  - 兜底：REST `POST|DELETE /repos/{o}/{r}/issues/{n}/dependencies/blocked_by`。
 *    只有主路明确回「这个字段/能力在这些仓库上不存在」（GHES 老版本、接口被关掉）才退过来；
 *    配额、鉴权、网络这类错误不靠换路解决，按本房的判档口径如实报错，同时记一行 `graphql.fallback`
 *    （scope=单票）与 `fallback.chain`，让日志里看得见「这一趟为什么走了老路」。
 *
 * 回落的幂等性：REST 那条路对「边已经在位」回 422、对「边本来就不在」回 404，两种都按目标已达成处理，
 * 所以主路写到一半才知道不支持、退到 REST 重放剩下的边，不会把已经写成的部分再写坏。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { OpContext } from '../../../contract/contexts.js'
import type { Issue } from '../../../contract/entities.js'
import type { OpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { guardEmit } from '../../../kernel/log-emit.js'
import { ghClient } from '../transport/client.js'
import { ghFailureMessage, ghVerdictOf } from '../support/errors.js'
import { pickFallbackReason } from '../fallback-reason.js'
import { ADD_BLOCKED_BY_MUTATION, REMOVE_BLOCKED_BY_MUTATION, issueNodeIdsQuery } from '../channels/graphql/queries.js'

/** gh 执行器的形状（client 房的 ghClient 回什么就是什么，这里只借它的类型）。 */
type GhClient = ReturnType<typeof ghClient>

/** 一条边这一趟走的路线：这几种取值写进 `edge.write` 的 route 一格（附录 1.4 节 #100）。 */
export type EdgeRoute = 'none' | 'flag' | 'rest' | 'graphql'

/**
 * 一趟边写入的轨迹：由外层包装（graph.ts 的 setParent / setBlockedBy）建好传进来，
 * 内层边走边填，出口统一发 `edge.write`。route 记「这一趟实际走了哪条路」，
 * added / removed / kept 是三条路的共用计数。
 */
export interface EdgeTrail {
  route: EdgeRoute
  added: number
  removed: number
  kept: number
  reason: string
}

/** 写边这一层的入参：差集已在外层算好，这里只管「把这几条写下去、把轨迹填对」。 */
export interface WriteBlockedByArgs {
  client: GhClient
  owner: string
  name: string
  /** 被写的那张票的票面编号：阻塞关系挂在它身上。 */
  key: string
  /** 要补的阻塞方票号。 */
  toAdd: string[]
  /** 要撤的阻塞方票号。 */
  toRemove: string[]
  /**
   * 原生依赖边的真值读到没有。REST 删边遇到 404 时要靠这一格分辨两件事：
   * 真值读得到 → 那条边本来就不在，跳过；真值读不到 → 这个仓库没有依赖边能力，判 unsupported。
   */
  nativeKnown: boolean
  ctx: OpContext
  trail: EdgeTrail
}

/**
 * 写边的结论：成功时交回实际走的是哪条路；失败时交回现成的失败结果
 * （形状与 REST 那条路一模一样，外层 graph.ts 直接 return）。
 */
export type WriteBlockedByResult = { ok: true; route: 'graphql' | 'rest' } | { ok: false; result: OpResult<Issue> }

/**
 * 用 GraphQL 把一组票号换成 node id（全局 ID）的结果。
 *
 * ids 为 null 表示这条路这次走不了；attempted 记「有没有真的起过 gh 进程」——
 * 本地就能判死在门口的情形（怪票号）不发降级线，否则会把「本地就没试」误记成「GraphQL 坏了」。
 */
interface IdsOutcome {
  ids: Map<string, string> | null
  cause: unknown
  attempted: boolean
}

/**
 * 一次查询取齐一组票的 node id。
 *
 * 为什么批量：写一条阻塞边要两张票的 id；逐票各查一次就是 N 次进程、N 点额度。
 * 只接纯数字票号：非数字塞进 GraphQL 的 Int 位置会让整条查询报错，交给 REST 那条路去报 not-found，
 * 与改动前的口径一致。
 */
async function graphqlIssueIds(client: GhClient, owner: string, name: string, keys: string[], ctx: OpContext): Promise<IdsOutcome> {
  if (!keys.length) return { ids: new Map<string, string>(), cause: null, attempted: false }
  for (const k of keys) {
    if (!/^\d+$/.test(k)) return { ids: null, cause: null, attempted: false }
  }
  try {
    const r = await client.execGh(
      ['api', 'graphql', '--method', 'POST', '-f', 'query=' + issueNodeIdsQuery(keys), '-f', 'owner=' + owner, '-f', 'name=' + name],
      { cwd: ctx && ctx.cwd, via: 'edge.gql.ids' },
    )
    if (!r.ok) return { ids: null, cause: r.error, attempted: true }
    let j: unknown
    try { j = JSON.parse(r.data.stdout || '') } catch (eJson) { return { ids: null, cause: { message: 'graphql: invalid json ' + String(eJson).slice(0, 200) }, attempted: true } }
    const root = j as { errors?: unknown; data?: { repository?: Record<string, unknown> } } | null
    if (root && root.errors) return { ids: null, cause: { message: JSON.stringify(root.errors).slice(0, 800) }, attempted: true }
    const repoData = root && root.data && root.data.repository ? root.data.repository : null
    if (!repoData) return { ids: null, cause: { message: 'graphql: missing repository' }, attempted: true }
    const out = new Map<string, string>()
    for (let i = 0; i < keys.length; i++) {
      const cell = repoData['i' + i]
      const id = cell && typeof cell === 'object' ? (cell as { id?: unknown }).id : null
      if (typeof id !== 'string' || !id) return { ids: null, cause: { message: 'graphql: missing node id' }, attempted: true }
      out.set(keys[i], id)
    }
    return { ids: out, cause: null, attempted: true }
  } catch (e) {
    return { ids: null, cause: e, attempted: true }
  }
}

/** mutation 这一条的结果分类：只有 unsupported 会让整趟回落 REST，其余各自有明确处置。 */
type MutationStatus = 'ok' | 'already' | 'absent' | 'cycle' | 'unsupported' | 'failed'

interface MutationOutcome {
  status: MutationStatus
  /** 失败时的原始错误值（交给判档与失败结果的原文）；成功、已在位、本来就不在几档为 null。 */
  error: unknown
  /** 上游原话（截断）；判档没认出来时给人指路，不参与路由决策。 */
  message: string
}

/**
 * 发一条 addBlockedBy / removeBlockedBy mutation。
 *
 * 为什么参数用 `-f`：issueId / blockingIssueId 都是 GraphQL 的 ID 标量，`-f` 原样传字符串即可；
 * `-F` 会按字面量转类型，node id（形如 I_kwDO…）会被转坏。
 * 为什么要加 `--method POST`：gh 的调用分档按参数认写操作（src/tracker/kernel/outbound-tiers.ts），
 * 不带显式方法时 GraphQL 会被当成读、走 12 秒读档；写边要的是写档（30 秒）与「不自动重试」那套口径。
 */
async function graphqlEdgeMutation(
  client: GhClient,
  mutation: string,
  payloadKey: 'addBlockedBy' | 'removeBlockedBy',
  issueId: string,
  blockingId: string,
  ctx: OpContext,
): Promise<MutationOutcome> {
  const via = payloadKey === 'addBlockedBy' ? 'edge.gql.add' : 'edge.gql.remove'
  try {
    const r = await client.execGh(
      ['api', 'graphql', '--method', 'POST', '-f', 'query=' + mutation, '-f', 'issueId=' + issueId, '-f', 'blockingIssueId=' + blockingId],
      { cwd: ctx && ctx.cwd, via },
    )
    let j: unknown = null
    if (r.ok) {
      try { j = JSON.parse(r.data.stdout || '') } catch (eJson) { j = null }
    }
    const root = j as ({ errors?: unknown; data?: Record<string, unknown> } & Record<string, unknown>) | null
    const graphErrors = root && root.errors ? root.errors : null
    // GraphQL 的错两路都可能来：非零退出码 + stderr，或退出码 0 + 回包里的 errors 数组。两路都并进这句判。
    const text = (r.ok ? '' : String(r.error.message || '')) + ' ' + (graphErrors ? JSON.stringify(graphErrors) : '')
    const lower = text.toLowerCase()
    // mutation 的 payload 挂在 data 下面（{ data: { addBlockedBy: {...} } }），回包里有它就说明写成了。
    const payloadCell = root && root.data ? root.data[payloadKey] : null
    if (r.ok && !graphErrors && payloadCell) return { status: 'ok', error: null, message: '' }
    // 只有「这个字段/能力在这个仓库上不存在」这一档才回落 REST（GHES 老版本、接口被关掉）。
    if (/unsupported|not supported|doesn'?t exist|does not exist|unknown (field|argument)|no such (field|type)|can'?t query field|cannot query field/i.test(lower)) {
      return { status: 'unsupported', error: r.ok ? null : r.error, message: text.slice(0, 300) }
    }
    if (/cycle|circular/i.test(lower)) return { status: 'cycle', error: r.ok ? null : r.error, message: text.slice(0, 300) }
    // 加边时上游说「已经在」、撤边时说「本来就不在」：目标状态已达成，与 REST 那边的 422 / 404 同口径，不算失败。
    if (/already (been )?(taken|blocked|exists)|duplicate/i.test(lower)) return { status: 'already', error: null, message: text.slice(0, 300) }
    if (/not (currently )?blocked|no such (blocking )?relationship|not blocked by|isn'?t blocked/i.test(lower)) return { status: 'absent', error: null, message: text.slice(0, 300) }
    return { status: 'failed', error: r.ok ? { message: text.slice(0, 800) } : r.error, message: text.slice(0, 300) }
  } catch (e) {
    const eb = e as { message?: unknown } | null
    return { status: 'failed', error: e, message: String((eb && eb.message) || e).slice(0, 300) }
  }
}

/** 把 mutation 的失败值判成八档之一：走本房的判档出口，与 REST 那条路的失败口径一致。 */
function failFromMutation(outcome: MutationOutcome, own: string, ctx: OpContext): OpResult<Issue> {
  const verdict = ghVerdictOf(outcome.error, ctx)
  return fail(verdict.kind, ghFailureMessage(verdict, own || outcome.message), outcome.error)
}

/** GraphQL 主路这一段的结论：走通了 / 明确不支持要退到 REST（带上已经写成的那些）/ 真失败。 */
type GqlPhase =
  | { ok: true }
  | { ok: false; fellBack: true; doneAdd: Set<string>; doneRemove: Set<string>; cause: unknown }
  | { ok: false; fellBack: false; failure: OpResult<Issue> }

/** 把差集里每一条边逐条走 GraphQL mutation；已经在位的按 kept 记，不重复提交。 */
async function writeAllViaGraphql(a: WriteBlockedByArgs, ids: Map<string, string>): Promise<GqlPhase> {
  const doneAdd = new Set<string>()
  const doneRemove = new Set<string>()
  const idOf = (n: string): string => String(ids.get(n) || '')
  const issueId = idOf(a.key)
  for (const b of a.toRemove) {
    const out = await graphqlEdgeMutation(a.client, REMOVE_BLOCKED_BY_MUTATION, 'removeBlockedBy', issueId, idOf(b), a.ctx)
    if (out.status === 'ok') { a.trail.removed += 1; doneRemove.add(b); continue }
    // 「本来就不在」与 REST 删边遇到 404 同义：目标已达成，不算失败、也不算撤掉了一条。
    if (out.status === 'absent') { doneRemove.add(b); continue }
    if (out.status === 'already') { doneRemove.add(b); continue }
    if (out.status === 'unsupported') return { ok: false, fellBack: true, doneAdd, doneRemove, cause: out.error || { message: out.message } }
    if (out.status === 'cycle') {
      return { ok: false, fellBack: false, failure: fail(ERROR_KIND.CONFLICT, 'conflict: cycle ' + out.message, out.error) }
    }
    return { ok: false, fellBack: false, failure: failFromMutation(out, 'setBlockedBy: 撤阻塞边时出错', a.ctx) }
  }
  for (const b of a.toAdd) {
    const out = await graphqlEdgeMutation(a.client, ADD_BLOCKED_BY_MUTATION, 'addBlockedBy', issueId, idOf(b), a.ctx)
    if (out.status === 'ok') { a.trail.added += 1; doneAdd.add(b); continue }
    // 上游说「这条边已经在」：目标状态已达成，算已经到位（与 REST 那边 422 的处置一字不差），
    // 不能把这一批剩下的边一起丢掉。
    if (out.status === 'already') { a.trail.kept += 1; doneAdd.add(b); continue }
    if (out.status === 'unsupported') return { ok: false, fellBack: true, doneAdd, doneRemove, cause: out.error || { message: out.message } }
    if (out.status === 'cycle') {
      return { ok: false, fellBack: false, failure: fail(ERROR_KIND.CONFLICT, 'conflict: cycle ' + out.message, out.error) }
    }
    return { ok: false, fellBack: false, failure: failFromMutation(out, 'setBlockedBy: 补阻塞边时出错', a.ctx) }
  }
  return { ok: true }
}

/**
 * 记一行「这一趟从 GraphQL 退到 REST」：`graphql.fallback`（#8，告警）说明哪张票、为什么，
 * `fallback.chain`（#42，常驻）说明从哪来、到哪去、这一趟花了多久。
 * 只复用现有事件名与字段，附录不动；scope 用「单票」——这里写的就是一张票上的关系边。
 */
function emitGraphqlFallback(ctx: OpContext, cause: unknown, startedAt: number): void {
  guardEmit(ctx, (c) => {
    const reason = pickFallbackReason(cause, ctx)
    c.logEvent('warn', 'graphql.fallback', { scope: '单票', reason })
    c.logEvent('info', 'fallback.chain', { in: 'graphql', out: 'rest', latencyMs: Date.now() - startedAt })
  })
}

/**
 * REST 兜底：逐条删、逐条补（原 graph.ts 那一段原样搬到这里，行为一字不改）。
 *
 * 为什么还原样留着两条循环：REST 依赖接口是今天所有 GitHub 仓库都能走的路，
 * 主路回落之后这里承担全部写入；它的失败语义（422 已在位、404 本来就不在、404 + 真值读不到 = 不支持）
 * 已经被 tests/verify-1054-edge-graph.ts 的 S1–S11 钉住，不动它就是最稳的兜底。
 */
async function writeRemainingViaRest(a: WriteBlockedByArgs, doneAdd: Set<string>, doneRemove: Set<string>): Promise<WriteBlockedByResult> {
  const client = a.client
  const toAdd = a.toAdd.filter((b) => !doneAdd.has(b))
  const toRemove = a.toRemove.filter((b) => !doneRemove.has(b))
  // 轨迹：GQL 那些已经写成的保留原计数，这里补的是剩下的那些。
  a.trail.route = 'rest'
  // 票号（number，如 758）与接口要的内部标识（id，如 5595650996）不是一回事：
  // 写边与删边都要先把票号换成内部标识，且传参用 -F（按类型传数字），-f 会传成字符串被 422 拒收。
  async function dbIdOf(numberKey: string): Promise<number | null> {
    try {
      const r = await client.execGh(['api', 'repos/' + a.owner + '/' + a.name + '/issues/' + numberKey, '--jq', '.id'], { cwd: a.ctx && a.ctx.cwd })
      if (!r.ok) return null
      const v = Number(String(r.data.stdout || '').trim())
      return Number.isFinite(v) && v > 0 ? Math.floor(v) : null
    } catch { return null }
  }
  const idByKey = new Map<string, number>()
  for (const kk of [...new Set([...toAdd, ...toRemove])]) {
    const id = await dbIdOf(kk)
    if (id) idByKey.set(kk, id)
  }

  for (const b of toRemove) {
    const bid = idByKey.get(b)
    if (!bid) return { ok: false, result: fail(ERROR_KIND.NOTFOUND, 'setBlockedBy: issue ' + b + ' not found', b) }
    const args = ['api', 'repos/' + a.owner + '/' + a.name + '/issues/' + a.key + '/dependencies/blocked_by/' + bid, '--method', 'DELETE']
    const r = await client.execGh(args, { cwd: a.ctx && a.ctx.cwd })
    if (r.ok) { a.trail.removed += 1; continue }
    const msg = String(r.error.message || '').toLowerCase()
    // 若 API 不存在（GHES）→ unsupported。判据是「原生真值没读到」加上一个 404：
    // 真值读得到说明端点活着，那时的 404 只能是「这条边本来就不在」，见下一条分支。
    if (/unsupported|not supported/i.test(msg) || (!a.nativeKnown && /not found|404/i.test(msg))) {
      return { ok: false, result: fail(ERROR_KIND.UNSUPPORTED, 'setBlockedBy unsupported', r) }
    }
    // 对账之后才发现这条边本来就不在（真值比上游晚一拍）：删除的目标已经达成，不算失败。
    if (/not found|404/.test(msg)) continue
    return { ok: false, result: { ok: false, error: r.error } }
  }
  for (const b of toAdd) {
    const bid = idByKey.get(b)
    if (!bid) return { ok: false, result: fail(ERROR_KIND.NOTFOUND, 'setBlockedBy: issue ' + b + ' not found', b) }
    const args = ['api', 'repos/' + a.owner + '/' + a.name + '/issues/' + a.key + '/dependencies/blocked_by', '--method', 'POST', '-F', 'issue_id=' + bid]
    const r = await client.execGh(args, { cwd: a.ctx && a.ctx.cwd })
    if (r.ok) { a.trail.added += 1; continue }
    const msg = String(r.error.message || '').toLowerCase()
    // 上游报错时原文交那份执行结果：判 unsupported 还是 conflict 的原话都在它里面。
    if (/unsupported|not found|404.*dependencies/i.test(msg)) {
      return { ok: false, result: fail(ERROR_KIND.UNSUPPORTED, 'setBlockedBy unsupported', r) }
    }
    if (/cycle|circular/i.test(msg)) return { ok: false, result: fail(ERROR_KIND.CONFLICT, 'conflict: cycle ' + msg.slice(0, 200), r) }
    // 上游说「这条边已经在」：目标状态已经达成，算已经到位，不算失败，更不能像从前那样把这一批剩下的边一起丢掉
    // （#1100 现象 2 的整批中止就是从这里来的：读回看不见原生关系 → 差集是全集 → 第一条已存在的边 422 → 整批丢写）。
    if (/already been taken|already exists|already exist|duplicate/i.test(msg)) { a.trail.kept += 1; continue }
    return { ok: false, result: { ok: false, error: r.error } }
  }
  return { ok: true, route: 'rest' }
}

/**
 * 写阻塞边的差集：先 GraphQL、明确不支持才回落 REST。
 *
 * 差集为空时一条外部命令都不发（与改动前一致：写之前那一趟原生真值读属于外层，不归这里管）。
 */
export async function writeBlockedByEdges(a: WriteBlockedByArgs): Promise<WriteBlockedByResult> {
  if (!a.toAdd.length && !a.toRemove.length) return { ok: true, route: 'rest' }
  const need = [...new Set([a.key, ...a.toAdd, ...a.toRemove])]
  const tGql = Date.now()
  const idsOut = await graphqlIssueIds(a.client, a.owner, a.name, need, a.ctx)
  if (idsOut.ids) {
    const gql = await writeAllViaGraphql(a, idsOut.ids)
    if (gql.ok) return { ok: true, route: 'graphql' }
    if (gql.fellBack) {
      emitGraphqlFallback(a.ctx, gql.cause, tGql)
      return writeRemainingViaRest(a, gql.doneAdd, gql.doneRemove)
    }
    return { ok: false, result: gql.failure }
  }
  if (idsOut.attempted) emitGraphqlFallback(a.ctx, idsOut.cause, tGql)
  return writeRemainingViaRest(a, new Set<string>(), new Set<string>())
}

export default { writeBlockedByEdges }
