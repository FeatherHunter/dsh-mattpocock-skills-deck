// src/deck/tools/map-plan-resume.ts —— 地图骨架续跑时「把上次已建的子票认回来」与「补挂孤儿父边」
// （#1413；从 map-plan-create.ts 拆出）
//
// 为什么单独拆：带同一个 planId 再来一次时，有两段活都在回答「上次已经落盘的子票这次怎么办」——
//   ①b 批量锚预检：一次列表把锚命中的子票认回来，命中就跳过创建，不再花钱；
//   ②  孤儿修复：已建跳过的子票如果父边缺失（首次建后挂边前被掐断），在这里补挂，不再建新票。
// 两段合起来五十多行，留在 map-plan-create.ts 里会把那份文件顶过 tests/verify-file-granularity.ts
// 的 350 行有效行上限。拆出来一行行为都没动：发后端的次数、游标存的时机与内容、
// items 与 notes 的文案和先后顺序，与拆出来之前逐字一致。
//
// 不能改的约定（改任何一条，续跑就会重复建票或者悄悄丢边）：
//   1. 两段都是「尽力而为」：列表读不回来、锚预检抛错、单张票读不回来，都只跳过、不判整批失败，
//      留给建票幂等键去做最后的去重。
//   2. 判据只认写后读回的结构字段：票上的 parentKey 已经等于本地图票就不动它（不重复写同一条边）。
//   3. 额度检查的位置不能挪：①b 不自己查额度（列表本身由后端门面按预算放行或拒绝），
//      ② 在发每一条之前查一次，剩余额度不够就一条都不写，等下一次带同一个 planId 再来。
import { matchAnchor, isAnchorHit } from '../../refresh/contract/idempotency-keys.js'
import { applyParentEdge } from '../shell/edge-landing.js'
import type { DeckTrackerLike } from '../../refresh/rooms/host/tool-call-budget-enforcement.js'

/**
 * 游标里这一段用到的几格。形状与 map-plan-create.ts 的 PlanState 逐格一致，两边靠结构兼容对接；
 * 为什么不直接 import 那份类型：两个文件会互相引用成环，.dependency-cruiser.ts 的
 * circular-dependency 那条会判红（tsPreCompilationDeps 开着，import type 也算一条边）。
 */
export interface MapPlanCursorState {
  planId: string
  mapKey: string
  keys: Record<string, string>
  edges: unknown[]
  done: unknown[]
}

/** 计划游标存储器：这里只调 save 写中间态，load 与 remove 归主流程管。 */
export interface MapPlanCursorStore {
  save(planId: string, state: MapPlanCursorState): unknown
}

/** ①b 批量锚预检的入参。 */
export interface AdoptAnchoredArgs {
  tracker: DeckTrackerLike
  repo: { refId: string }
  opCtx: unknown
  planId: string
  /** AI 传来的原始子票清单。 */
  children: Array<Record<string, unknown>>
  /** 游标里的中间态：认回来的票号与已办记要写回这两格。 */
  state: MapPlanCursorState
  /** 回执的逐项结果，认回来的每一张追加一行（跳过的一行带 skipped:true）。 */
  items: Array<Record<string, unknown>>
  store: MapPlanCursorStore
}

/** ② 孤儿父边修复的入参。 */
export interface RepairOrphanArgs {
  tracker: DeckTrackerLike
  repo: { refId: string }
  opCtx: unknown
  planId: string
  /** 已经建成、这一趟跳过创建的那些子票的计划内短标识。 */
  skippedKeys: string[]
  state: MapPlanCursorState
  items: Array<Record<string, unknown>>
  notes: string[]
  store: MapPlanCursorStore
  /** 剩余额度是不是已经不够：不够就一条边都不补（调用方传的是预算壳那个口）。 */
  outOfBudget: () => boolean
}

/**
 * ①b 批量锚预检：一次列表把锚命中的子票认回来（命中就跳过创建）。
 * 拿不准就照常往下走 —— 锚预检测不出来只是多花几次创建，不让整趟计划失败。
 */
export async function adoptAnchoredChildren(args: AdoptAnchoredArgs): Promise<void> {
  const tracker = args.tracker
  const repo = args.repo
  const opCtx = args.opCtx
  const planId = args.planId
  const children = args.children
  const state = args.state
  const items = args.items
  const store = args.store
  try {
    const untouched = children.filter((ch) => !state.keys[String(ch.key)])
    if (untouched.length) {
      const all = await tracker.list(repo, { state: 'all' }, opCtx)
      const rows = (all && all.ok === true && Array.isArray(all.data)) ? all.data : null
      const cands = rows ? rows.filter((r: Record<string, unknown>) => r && typeof r.body === 'string').map((r: Record<string, unknown>) => ({ key: String(r.key), body: r.body, state: r.state })) : []
      if (cands.length) {
        for (const ch of untouched) {
          let m = null
          try { m = matchAnchor(cands, repo.refId, 'deck-plan-' + planId + '-child-' + String(ch.key)) } catch (eM) { m = null }
          if (m && isAnchorHit(m)) {
            // 命中那一支的形状（带 key）与没命中那一支（带 status / reason）编译器合不成一个，按类型断言取 key，取到的值一字不动。
            state.keys[String(ch.key)] = String((m as { key?: string }).key)
            state.done.push('child:' + String(ch.key))
            items.push({ key: String((m as { key?: string }).key), role: 'child', planKey: String(ch.key), title: String(ch.title), status: 'ok', skipped: true })
          }
        }
        await store.save(planId, state)
      }
    }
  } catch (ePre) {}
}

/**
 * ② 孤儿父边修复：已建、这一趟跳过的子票，如果写后读回里 parentKey 不是本地图票，就补挂一次父边。
 * 为什么只修跳过的：待建的子票本次新建时自带 parentKey；跳过的已经落盘，但可能父票为空
 * （地图快照按父票列子票时看不到它们）。
 */
export async function repairOrphanParents(args: RepairOrphanArgs): Promise<void> {
  const tracker = args.tracker
  const repo = args.repo
  const opCtx = args.opCtx
  const planId = args.planId
  const skippedKeys = args.skippedKeys
  const state = args.state
  const items = args.items
  const notes = args.notes
  const store = args.store
  const outOfBudget = args.outOfBudget
  if (!skippedKeys.length || !state.mapKey || outOfBudget()) return
  const repairs = await Promise.all(skippedKeys.map(async (planKey) => {
    const ticketKey = String(state.keys[String(planKey)] || '')
    if (!ticketKey || outOfBudget()) return null
    let got = null
    try { got = await tracker.get(repo, ticketKey, {}, opCtx) } catch (eGet) { got = null }
    const lived = (got && (got as { ok?: unknown }).ok === true) ? ((got as { data?: unknown }).data as Record<string, unknown> | null) : null
    const liveParent = lived ? String((lived as Record<string, unknown>).parentKey ?? '') : ''
    if (!lived || liveParent === String(state.mapKey)) return null
    try {
      const r = await applyParentEdge(tracker, repo, opCtx, ticketKey, state.mapKey)
      return { planKey: planKey, ticketKey: ticketKey, item: (r as { item?: unknown }).item, applied: !!(r as { applied?: unknown }).applied }
    } catch (eRep) { return null }
  }))
  let repaired = 0
  for (const r of repairs) {
    if (!r) continue
    if (r.applied) {
      repaired += 1
      state.done.push('repaired-parent:' + String(r.planKey))
      items.push(Object.assign({ role: 'edge', planKey: String(r.planKey) }, (r.item as Record<string, unknown> || {})))
    } else if (r.item) {
      items.push(Object.assign({ role: 'edge', planKey: String(r.planKey) }, (r.item as Record<string, unknown>)))
    }
  }
  if (repaired) {
    notes.push('续跑时补挂了 ' + repaired + ' 张孤儿票的父边（首次建后挂边前被掐断留下的）：' + skippedKeys.slice(0, 8).join('、') + '。')
    await store.save(planId, state)
  }
}
