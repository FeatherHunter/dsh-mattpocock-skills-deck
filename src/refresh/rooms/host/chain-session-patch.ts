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
}

type BackendChainView = { chain?: CheckItem[]; resolved?: ResolvedMap; snapshot?: SnapStepsView | null; errors?: unknown } | null | undefined
type CachedReplyView = { backendChain?: BackendChainView; fullSnapshot?: FullSnapView | null; [key: string]: unknown }

/** 判定对象的 status → stepEvalParallel 认的状态串（与 predicateCore.toPredicateResults 同口径）。 */
function statusOf(v: PredicateResultView | undefined): 'pass' | 'fail' | null {
  const status = v && v.status
  if (status === 'pass') return 'pass'
  if (status === 'fail') return 'fail'
  return null
}

/**
 * 重算一条会话相关检查项。
 *
 * 为什么动态导入谓词执行器：本文件会被宿主入口在缓存命中时动态加载，静态再拉一条边没有好处；
 *   而且 predicatePrimitives 与 check-chain-evaluation 同属宿主层，库内约定优先在调用点取。
 * 反例：重算失败时返回缓存里那一份判定——那正是要修的病（把别的会话的结论当本会话的）。
 */
async function evalSessionScoped(item: CheckItem, ctx: SessionPatchContext): Promise<PredicateResultView> {
  try {
    if (!item || !item.check || typeof item.check !== 'object') return { status: 'pending', detail: '会话相关检查项没有可重算的谓词描述' }
    const primMod: any = await import('../../../host/tracker/predicatePrimitives.js')
    if (typeof primMod.execPrimitive !== 'function') return { status: 'pending', detail: '谓词执行器不可用，按未确认处理' }
    const r: any = await primMod.execPrimitive(item.check, ctx)
    if (r && typeof r === 'object' && (r.status === 'pass' || r.status === 'fail' || r.status === 'pending')) return r
    return { status: 'pending', detail: '谓词没有返回可用的结论' }
  } catch (e) {
    const msg = String((e && (e as { message?: unknown }).message) || e)
    return { status: 'pending', detail: msg.slice(0, 200) }
  }
}

/**
 * 按当前会话重算缓存回包里依赖会话许可的行，返回改好的副本。
 *
 * @param reply 退避缓存交回的上一份完整回包（可能只是快照、没有后端段）
 * @param ctx 当前会话的平台、工作区、语言与沙箱许可
 * @returns reply 是可直接回给客户端的副本（没有会话相关项时就是原对象），patchedCount 是这次重算的项数
 */
export async function patchCachedReplyForSession(reply: unknown, ctx: SessionPatchContext): Promise<{ reply: unknown; patchedCount: number }> {
  const cached = reply as CachedReplyView | null | undefined
  if (!cached || typeof cached !== 'object') return { reply: reply, patchedCount: 0 }
  const backend = cached.backendChain
  const chain = (backend && Array.isArray(backend.chain)) ? backend.chain : null
  if (!chain || !chain.length) return { reply: reply, patchedCount: 0 }
  const scoped = chain.filter(function (it: CheckItem) { return it && (it as any).sessionScoped === true })
  if (!scoped.length) return { reply: reply, patchedCount: 0 }

  const scopedIds: Record<string, true> = {}
  scoped.forEach(function (it: CheckItem) { if (it.id) scopedIds[String(it.id)] = true })
  // 逐项重算；每一项单独兜底，一项失败不影响其它项，也绝不把异常抛给调用方。
  const fresh: ResolvedMap = {}
  for (const item of scoped) {
    if (!item.id) continue
    fresh[String(item.id)] = await evalSessionScoped(item, ctx)
  }
  const patchedCount = Object.keys(fresh).length
  if (!patchedCount) return { reply: reply, patchedCount: 0 }

  // 缓存里的判定原样沿用，只把这次重算的那几项换掉。
  const mergedResolved: ResolvedMap = Object.assign({}, (backend && backend.resolved) || {})
  const mergedEval: EvalMap = {}
  for (const item of chain) {
    const id = item.id ? String(item.id) : ''
    if (!id) continue
    mergedEval[id] = scopedIds[id] ? statusOf(fresh[id]) : statusOf(mergedResolved[id])
    if (scopedIds[id]) {
      const r = fresh[id]
      if (r) mergedResolved[id] = r
    }
  }
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
  return { reply: nextReply, patchedCount: patchedCount }
}
