// src/refresh/rooms/host/chain-session-patch.ts —— 缓存命中时按「当前会话」重算依赖会话许可的检查行（#1483）。
//
// 为什么需要：链快照的退避缓存按「工作区 + 后端 + 语言」共享，同一工作区的多个会话读同一份。
//   但其中一项 md:scratchWritable 的结果取决于会话的沙箱许可（只读会话量出来是 pending，可写会话是 done）。
//   缓存命中时直接回上一份快照，就会让只读会话看到别的会话量出的「可写」。
//
// 做法：只重算链上标了 sessionScoped 的那几项（本机写探测，几毫秒），把结果覆盖到回包的副本上；
//   缓存里那一份一个字不动——别的会话还要照着它秒显。
//
// 约定不能改：
//   1. 只改副本：返回的是新对象，缓存里的 reply、steps、resolved 一处都不许原地写。
//   2. 非会话相关项一律沿用缓存里的判定，不重测（省掉网络与外部命令）。
//   3. 重算失败按 pending（诚实未知）落行，绝不沿用缓存里别的会话的结论，也绝不抛给调用方。
//   4. 行序不动：fullSnapshot 只在原行序上替换对应 id 的行，再重算计数。
// 反例：拿缓存回包直接原地改 resolved 再返回——下一毫秒另一个会话读同一份缓存，就会看到被改过的判定。
import type { CheckItem } from '../../../shared/tracker/chain-types.js'
import { assembleFullSnapshot, enrichSnap, stepEvalParallel } from './chain-step-rows.js'
import type { EvalMap, FullSnapView, PredicateResultView, ResolvedMap, SnapStepView, SnapStepsView } from './chain-step-rows.js'

/** 重算会话相关行时交进去的上下文：只有文件写探测用得到的几格（平台、目录、语言、沙箱许可、会话号）。 */
export type SessionPatchContext = {
  platform: unknown
  cwd: string
  lang: string
  backendId?: string | null
  sandboxPolicy?: unknown
  sessionId?: string
  /**
   * 某一项重算失败时的回告出口（可选）。失败本身不抛给调用方——按 pending 落行是设计，
   * 但诊断日志里要留一行，否则事后分不清「没触发重算」与「重算失败」。
   */
  onError?: (message: string) => void
  /**
   * 整趟补算的预算（毫秒，可选）。正常求值的每个谓词都有 PREDICATE_TIMEOUT_MS 那一档兜底；
   * 补算这一路原来直接 await，工作区在网络盘上、写探测挂住时，缓存命中这条本该纯内存返回的路会被无限拖住。
   * 这是整趟的总预算，不按检查项个数累加（项多时不能等成 N 倍）；超时的那几项按 pending 落行
   * （诚实的「没量出来」），不沿用缓存里别的会话的判定。
   * 两个都给才生效：只给 timeoutMs 而没有注入定时器时不设预算（宁可慢，也不假装超时）。
   */
  timeoutMs?: number
  /** 注入的定时器（宿主传 deps.timer.timeout）；测试可注入假钟，与正常求值的注入口一致。 */
  timeout?: (ms: number) => Promise<unknown>
}

type BackendChainView = { chain?: CheckItem[]; resolved?: ResolvedMap; snapshot?: SnapStepsView | null; errors?: unknown } | null | undefined
type CachedReplyView = { backendChain?: BackendChainView; fullSnapshot?: FullSnapView | null; [key: string]: unknown }

/**
 * 重算一条会话相关检查项。
 *
 * 为什么动态导入谓词执行器：本文件会被宿主入口在缓存命中时动态加载，静态再拉一条边没有好处；
 *   而且 predicatePrimitives 与 check-chain-evaluation 同属宿主层，库内约定优先在调用点取。
 * 单项失败（执行器缺失、谓词抛错、预算超时）一律按 pending 落行、绝不沿用缓存里别的会话的判定；
 *   这种失败**不**给回包打 sessionPatchFailed：那一行是诚实的「没量出来」，不是别人的结论，
 *   客户端把它记成本会话产出也不会传错（别的会话看到的是 pending，不是假的 done）。
 *   只有整趟补算做不下去（比如取不到平台、连副本都拼不出来）才需要外层打标记。
 * 反例：重算失败时返回缓存里那一份判定——那正是要修的病（把别的会话的结论当本会话的）。
 */
async function evalSessionScoped(item: CheckItem, ctx: SessionPatchContext): Promise<PredicateResultView> {
  try {
    if (!item || !item.check || typeof item.check !== 'object') return { status: 'pending', detail: '会话相关检查项没有可重算的谓词描述' }
    const check = item.check as { kind?: unknown; id?: unknown; backendId?: unknown }
    // #1513 起本地 Markdown 的会话相关项是后端谓词（md:scratchWritable 由 primitive 改成 backend 谓词）。
    // 为什么复用宿主取用口 mdPredicate、而不是在这一层直连房间：宿主不许深引房间内部；mdPredicate 内部
    //   经装配点 builtins.loadMarkdownHostExtras() 取判据本体，与链上求值、房间 preflight 是同一份实现。
    if (check.kind === 'backend') {
      const backendId = String(check.backendId || ctx.backendId || '')
      if (backendId !== 'markdown') return { status: 'pending', detail: '这个后端还没有会话相关谓词的重算入口' }
      const remote = await remotePredicates()
      if (!remote || typeof remote.mdPredicate !== 'function') return { status: 'pending', detail: '谓词执行器不可用，按未确认处理' }
      // 这一项自己不再套超时：整趟预算由 patchCachedReplyForSession 统一管（一枚定时器、总时长有上限），
      //   所以这里的 promise 允许挂住，外面那一层到点会把它按 pending 落行。
      const rb: any = await remote.mdPredicate(ctx.platform, ctx.cwd, ctx.lang, String(check.id || item.id || ''), ctx.sandboxPolicy)
      if (rb && typeof rb === 'object' && (rb.status === 'pass' || rb.status === 'fail' || rb.status === 'pending')) return rb
      return { status: 'pending', detail: '谓词没有返回可用的结论' }
    }
    const primMod: any = await import('../../../host/tracker/predicatePrimitives.js')
    if (typeof primMod.execPrimitive !== 'function') return { status: 'pending', detail: '谓词执行器不可用，按未确认处理' }
    // 这一项自己不再套超时：整趟预算由 patchCachedReplyForSession 统一管（一枚定时器、总时长有上限），
    //   所以这里的 promise 允许挂住，外面那一层到点会把它按 pending 落行。
    const r: any = await primMod.execPrimitive(item.check, ctx)
    if (r && typeof r === 'object' && (r.status === 'pass' || r.status === 'fail' || r.status === 'pending')) return r
    return { status: 'pending', detail: '谓词没有返回可用的结论' }
  } catch (e) {
    const msg = String((e && (e as { message?: unknown }).message) || e)
    try { if (typeof ctx.onError === 'function') ctx.onError(msg) } catch (eLog) {}
    return { status: 'pending', detail: msg.slice(0, 200) }
  }
}

/**
 * 补算超时时那一行显示的说明文案。
 *
 * 为什么按界面语言分中英：这一行会直接显示在检查页的步骤描述里，中文界面不该出现英文整句。
 *   宿主里已有先例（src/host/tracker/predicateFileProbes.ts 的写探测说明就是这样分语言的）；
 *   正常求值那一路的超时说明目前只有英文（predicateCore.ts:86/110），那是既有口径，不在这里冒充一致。
 * 为什么不写具体毫秒数：预算是实现细节（PREDICATE_TIMEOUT_MS 由 config 注入），不该出现在界面文案里。
 */
function timeoutDetail(ctx: SessionPatchContext): string {
  return ctx.lang === 'en'
    ? 're-check timed out, treated as unknown for now'
    : '按本会话重算超时，先按未确认处理'
}

// 宿主 Markdown 判据取用口的懒加载单例（#1513）：会话补算是缓存命中路径，只在真的遇到后端谓词时才加载。
let _remotePredP: Promise<any> | null = null
function remotePredicates(): Promise<any> {
  if (!_remotePredP) _remotePredP = import('../../../host/remotePredicates.js').then(function (m: any) { return m.createRemotePredicates() })
  return _remotePredP
}

/** 整趟预算到点的标记。谓词结果对象只有 status/detail 两格，不会撞上这个键。 */
type PatchTimeout = { __patchTimedOut: true }

/**
 * 跑完整趟补算，最多花 ctx.timeoutMs 毫秒（#1492）。
 *
 * 为什么需要：正常求值经 predicateCore 的 withTimeout 兜底；补算这条路没有那层壳，
 *   工作区在网络盘上写探测挂住时，缓存命中会一直等下去。
 * 为什么整趟一枚定时器、不按项比赛跑：宿主 timer 端口是 Promise 形态、外部撤不掉定时器
 *   （src/refresh/contract/host-timer-ports.ts 写明），按项开会在命中路径上留下一串活定时器；
 *   而且总时长该有上限，不能项数一多就等成 N 倍。
 * 为什么不能直接复用 predicateCore.withTimeout：那是注册表内部的闭包，绑死全局 setTimeout、没有注入口；
 *   这里必须走宿主注入的 timer，测试才能用假钟。
 * 超时后 partial 结果一律丢掉：按 pending 重铺全部会话相关行，比保留一半新一半旧的视图更诚实。
 */
async function patchWithBudget(scoped: CheckItem[], ctx: SessionPatchContext): Promise<{ fresh: ResolvedMap; timedOut: boolean }> {
  const fresh: ResolvedMap = {}
  // 逐项串行：会话相关行目前只有一项（md:scratchWritable 的写探测），串行读起来最直白；将来变多也仍受同一笔总预算约束。
  // evalSessionScoped 自己吞掉所有异常、绝不 reject，所以这里不接 catch 也不会留下未处理拒绝。
  const runAll: Promise<ResolvedMap> = (async function (): Promise<ResolvedMap> {
    for (const item of scoped) {
      if (!item.id) continue
      fresh[String(item.id)] = await evalSessionScoped(item, ctx)
    }
    return fresh
  })()
  const ms = Number(ctx.timeoutMs || 0)
  if (!(ms > 0) || typeof ctx.timeout !== 'function') return { fresh: await runAll, timedOut: false }
  const budgetP: Promise<PatchTimeout> = Promise.resolve().then(function () { return ctx.timeout!(ms) }).then(function () { return { __patchTimedOut: true } as PatchTimeout })
  const raced: any = await Promise.race([runAll, budgetP])
  if (raced && raced.__patchTimedOut === true) {
    try { if (typeof ctx.onError === 'function') ctx.onError(timeoutDetail(ctx)) } catch (eLog) {}
    return { fresh: fresh, timedOut: true }
  }
  return { fresh: raced as ResolvedMap, timedOut: false }
}

/**
 * 把重算得到的判定换进缓存回包的副本里，返回新回包。
 *
 * 副本的深浅（说清楚，免得调用方误以为可以随便改）：顶层、backendChain、backendChain.snapshot、
 *   fullSnapshot 都是本函数新拼的对象；但 fullSnapshot.steps 里**非会话相关**的那几行还是缓存里的原对象，
 *   所以整份副本里没有任何一行允许原地改——要改只能再复制一层。反例：拿这份回包的 steps 原地改某个字段，
 *   下一个会话读缓存就会看到被改过的值（缓存本体没换，但行对象是同一批）。
 *
 * @param cached 缓存里的完整回包
 * @param backend 缓存里的后端段（提供 resolved 与 chain）
 * @param chain 后端链的检查项列表（决定行序）
 * @param scopedIds 这次重算了哪些 id（决定 fullSnapshot 里换哪几行）
 * @param fresh 这次重算得到的判定
 * @returns 可直接回给客户端的新回包
 */
async function applyFreshResolved(cached: CachedReplyView, backend: BackendChainView, chain: CheckItem[], scopedIds: Record<string, true>, fresh: ResolvedMap): Promise<CachedReplyView> {
  // 缓存里的判定原样沿用，只把这次重算的那几项换掉。
  const mergedResolved: ResolvedMap = Object.assign({}, (backend && backend.resolved) || {})
  for (const id of Object.keys(fresh)) {
    const r = fresh[id]
    if (r) mergedResolved[id] = r
  }
  // 状态串由谓词核心折叠（与正常求值同一处口径）；本模块只交代「哪些 id 的判定变了」。
  //   为什么不自己写一份 status 映射：两份三态折叠一旦口径不同，就会出现「resolved 说 pass、
  //   快照行说 pending」这种自相矛盾的视图（审阅指出过这个重复）。
  const predCore: any = await import('../../../host/tracker/predicateCore.js')
  const cachedEval: EvalMap = (typeof predCore.toPredicateResults === 'function')
    ? predCore.toPredicateResults(mergedResolved as any)
    : {}
  const freshEval: EvalMap = (typeof predCore.toPredicateResults === 'function')
    ? predCore.toPredicateResults(fresh as any)
    : {}
  const mergedEval: EvalMap = Object.assign({}, cachedEval, freshEval)
  const backendSnap = enrichSnap(stepEvalParallel(chain, mergedEval), mergedResolved)
  const nextBackend = Object.assign({}, backend, { resolved: mergedResolved, snapshot: backendSnap })
  const nextReply: CachedReplyView = Object.assign({}, cached, { backendChain: nextBackend })

  // 拼接视图：只在原行序上替换对应 id 的行，再重算计数；别的行（含通用段）一字不动。
  const full = cached.fullSnapshot
  if (full && Array.isArray(full.steps) && backendSnap && Array.isArray(backendSnap.steps)) {
    const rows: Record<string, SnapStepView> = {}
    backendSnap.steps.forEach(function (row: SnapStepView) { if (row && row.id) rows[String(row.id)] = row })
    const nextSteps = full.steps.map(function (s: SnapStepView) {
      if (s && s.id && scopedIds[String(s.id)] && rows[String(s.id)]) return rows[String(s.id)]
      return s
    })
    nextReply.fullSnapshot = Object.assign({}, full, assembleFullSnapshot(nextSteps))
  }
  return nextReply
}

/** 哪些检查项带会话相关标记（只扫后端段）。缓存回包里没有后端段时返回 null。 */
function scopedOf(reply: unknown): { cached: CachedReplyView; backend: BackendChainView; chain: CheckItem[]; scoped: CheckItem[] } | null {
  const cached = reply as CachedReplyView | null | undefined
  if (!cached || typeof cached !== 'object') return null
  // 扫描范围只有后端段：带 sessionScoped 标记的检查项目前都在后端段（md:scratchWritable）。
  //   以后通用段（cached.chain）若有项标了 sessionScoped，这里必须一起扩展——否则缓存命中时
  //   那一行会沿用别的会话的判定；正常求值那一路不受影响（ctx 本来就带着当前会话的沙箱许可）。
  const backend = cached.backendChain
  const chain = (backend && Array.isArray(backend.chain)) ? backend.chain : null
  if (!chain || !chain.length) return null
  const scoped = chain.filter(function (it: CheckItem) { return it && (it as any).sessionScoped === true })
  if (!scoped.length) return null
  return { cached: cached, backend: backend, chain: chain, scoped: scoped }
}

/** 把 check 列表里带会话相关标记的 id 收成一张表（决定 fullSnapshot 里换哪几行）。 */
function idsOf(scoped: CheckItem[]): Record<string, true> {
  const ids: Record<string, true> = {}
  scoped.forEach(function (it: CheckItem) { if (it.id) ids[String(it.id)] = true })
  return ids
}

/**
 * 按当前会话重算缓存回包里依赖会话许可的行，返回改好的副本。
 *
 * 副本的深浅见 applyFreshResolved 的说明：整份副本不许原地改（非会话行仍与缓存共用对象）。
 *
 * @param reply 退避缓存交回的上一份完整回包（可能只是快照、没有后端段）
 * @param ctx 当前会话的平台、工作区、语言与沙箱许可
 * @returns reply 是可直接回给客户端的副本（没有会话相关项时就是原对象），patchedCount 是这次重算的项数
 */
export async function patchCachedReplyForSession(reply: unknown, ctx: SessionPatchContext): Promise<{ reply: unknown; patchedCount: number }> {
  const found = scopedOf(reply)
  if (!found) return { reply: reply, patchedCount: 0 }
  // 重算；每一项单独兜底，一项失败不影响其它项，也绝不把异常抛给调用方。
  // 超时的话，整批会话相关行按 pending 重铺（partial 结果丢掉，见 patchWithBudget）。
  const budget = await patchWithBudget(found.scoped, ctx)
  let fresh: ResolvedMap = budget.fresh
  if (budget.timedOut) {
    fresh = {}
    const msg = timeoutDetail(ctx)
    for (const item of found.scoped) { if (item.id) fresh[String(item.id)] = { status: 'pending', detail: msg } }
  }
  const patchedCount = Object.keys(fresh).length
  if (!patchedCount) return { reply: reply, patchedCount: 0 }
  const nextReply = await applyFreshResolved(found.cached, found.backend, found.chain, idsOf(found.scoped), fresh)
  return { reply: nextReply, patchedCount: patchedCount }
}

/**
 * 整趟补算做不下去时的退路：不碰平台、不重算，只把会话相关行改成「未确认」，其余照旧。
 *
 * 为什么需要（#1492 复核）：补算外层失败时（取不到平台、模块加载失败、连沙箱许可都解析不下来），
 *   原来的做法是原样回缓存那一份——只读会话会短暂看到别的会话量出的「可写」。
 *   「无法确认」比「显示别人的结论」诚实；这一步只依赖缓存里已有的链与行，不需要平台能力。
 *   仍然由外层打 sessionPatchFailed（客户端据此不写共享缓存），理由不变：这份回包不是本会话量出来的。
 *
 * @param reply 缓存里的完整回包
 * @param ctx 只用到界面语言（决定文案），平台与许可一律不碰
 * @returns 会话相关行落成 pending 的副本；没有会话相关项时原样返回
 */
export async function markSessionScopedUnconfirmed(reply: unknown, ctx: SessionPatchContext): Promise<{ reply: unknown; patchedCount: number }> {
  const found = scopedOf(reply)
  if (!found) return { reply: reply, patchedCount: 0 }
  const detail = ctx.lang === 'en'
    ? 'this session could not re-check it, treated as unknown for now'
    : '没能按本会话重算，先按未确认处理'
  const fresh: ResolvedMap = {}
  for (const item of found.scoped) { if (item.id) fresh[String(item.id)] = { status: 'pending', detail: detail } }
  const patchedCount = Object.keys(fresh).length
  if (!patchedCount) return { reply: reply, patchedCount: 0 }
  const nextReply = await applyFreshResolved(found.cached, found.backend, found.chain, idsOf(found.scoped), fresh)
  return { reply: nextReply, patchedCount: patchedCount }
}
