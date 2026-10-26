// 面板要的额度状态（#1446 验收第 4 条）：按后端的预算模型回答「有没有额度、读数知不知道、离不离网」。
// 为什么单独一个文件：模型在注册表、水位在账本，两样都不是这里的事；装配处只把两个出口交进来，
// 这里只做「模型 + 水位 → 面板读数」的一次换算。放在 refresh-runtime 里会把运行时的行数顶过 350 行硬上限。
//
// 三条不许改的约定：
// 1. 读数未知、离网、后端不认识，一律不给数字、不给档位（客户端照这个形状渲染「不需要额度」「还没同步上来」）。
// 2. two-buckets 要两桶都有读数才算知道；缺一桶按未知处理，绝不拿一桶冒充两桶。
// 3. 客户端不推算后端类型，只读 budgetKind —— 所以答案里的 kind 必须由注册表里的预算声明翻译成面板词
//    （two-buckets / requests / none），不许按 backendId 猜。翻译只在这一处做：面板生产者说注册表词、
//    面板消费者说面板词，两个词表在 #1447 之前没有接上，GitLab 的 requests-only 会被消费方当成不认识的口径整格丢掉。

// 「后台同步最近一次失败」的形状只有一处定义：quota-sync-status 的失败出口。这里用别名而不是再抄一份
// 字段 —— 两处各写一份时，改一处漏一处的形状校验最难发现，ADR 20261021 要求同一件事只留一处定义。
import type { QuotaSyncFailure } from './quota-sync-status.js'

/** 一个桶的水位：limit 是这条桶的额度上限（读数没给上限时退化成 remaining，不编造）。 */
export interface BudgetBucketLevel {
  readonly remaining: number
  readonly limit: number
}

/**
 * 后台同步最近一次失败的结论（#1006 期望⑤）：读数还没同步上来时，界面靠它说清是哪一种失败
 * （环境没准备好要人处理 / 刚才没连上等自己重试）。形状与 quota-sync-status 的 view 出口一致。
 */
export type BudgetSyncFailure = QuotaSyncFailure

/** 面板侧额度状态：与 src/host/tracker/snapshot.ts 的 RefreshBackendBudget 同一形状（那边是消费方）。 */
export interface BudgetPanelState {
  readonly id: string
  readonly budgetKind: string
  readonly readKnown: boolean
  readonly offNetwork: boolean
  readonly buckets?: { readonly rest?: BudgetBucketLevel; readonly graphql?: BudgetBucketLevel }
  readonly requests?: BudgetBucketLevel
  readonly reason?: string
  /** 后台同步最近一次失败；只在查得到失败且不是离网后端时才带（没有失败就不写这一格）。 */
  readonly sync?: BudgetSyncFailure
}

export interface BudgetStateDeps {
  /** 取注册表（拿 modules() 里的预算声明）；拿不到就当后端不认识，不改口。 */
  readonly getTrackerRegistry?: () => any
  /** 账本；只读 view，不在这里记账。 */
  readonly ledger: any
  /**
   * 后台同步结论的出口（#1006）：给后端编号，回它最近一次失败；没有失败或没接这个口子就回 null。
   * 不接 = 旧行为（面板状态不带 sync），老调用点一个都不用改。
   */
  readonly syncStatus?: (backendId: string) => BudgetSyncFailure | null
}

/** 从注册表里取某个后端的预算口径（拿不到回 null：不编一个口径出来）。 */
function backendModelOf(deps: BudgetStateDeps, backendId: string): any {
  try {
    const reg: any = (typeof deps.getTrackerRegistry === 'function') ? deps.getTrackerRegistry() : null
    if (!reg || typeof reg.modules !== 'function') return null
    const mods: any[] = reg.modules() || []
    for (const m of mods) {
      if (m && String(m.id) === backendId) return (m && m.budget) ? m.budget : null
    }
  } catch (eM: any) {}
  return null
}

/**
 * 把注册表里的预算口径翻成面板词：two-buckets 原样、requests-only 翻 requests、off-network 翻 none。
 * 不认识的口径归成 unknown，并作为合法一档原样交出去（#1455）：面板会明确显示「额度未知：这个后端没有
 * 可用的预算模型」。这话比沉默诚实——「说不出模型」和「没有额度这回事」必须分得开，也不许猜成三种之一。
 */
function panelKindOf(kind: string): string {
  if (kind === 'two-buckets') return 'two-buckets'
  if (kind === 'requests-only') return 'requests'
  if (kind === 'off-network') return 'none'
  return 'unknown'
}

/** 账本里某一格的水位（没读数回 null，不用 0 冒充量过的 0）。 */
function ledgerLevelOf(ledger: any, backendId: string, bucket: string): BudgetBucketLevel | null {
  try {
    const v: any = ledger.view(backendId, bucket)
    if (!v || v.remaining == null) return null
    const remaining = Number(v.remaining)
    if (!isFinite(remaining)) return null
    const allowance = Number(v.allowance)
    return { remaining: remaining, limit: (isFinite(allowance) && allowance > 0) ? allowance : remaining }
  } catch (eV: any) { return null }
}

/**
 * 问后台同步记事本「这个后端最近一次失败是什么」：只认形状完整的结论（有限正数时刻 + 两种类别之一）。
 * 判别不了就回 null —— 面板宁可说中性的「还没同步上来」，也不编一个可能错的失败类别。
 */
function syncFailureOf(deps: BudgetStateDeps, backendId: string): BudgetSyncFailure | null {
  try {
    const f: any = (typeof deps.syncStatus === 'function') ? deps.syncStatus(backendId) : null
    if (!f || typeof f !== 'object') return null
    if (typeof f.lastFailAt !== 'number' || !isFinite(f.lastFailAt) || f.lastFailAt <= 0) return null
    if (f.lastFailKind !== 'hard' && f.lastFailKind !== 'soft') return null
    return { lastFailAt: f.lastFailAt, lastFailKind: f.lastFailKind }
  } catch (eS: any) { return null }
}

/**
 * 把失败结论挂到面板状态上（没有就原样返回）。离网后端不调这个：离网没有额度这回事，
 * 在它身上说「还没同步」会把「不需要额度」误导成「同步坏了」。
 */
function withSync(state: BudgetPanelState, sync: BudgetSyncFailure | null): BudgetPanelState {
  if (!sync) return state
  return { ...state, sync: sync }
}

/** 造一个「按后端编号取面板额度状态」的读数口；后端编号为空或模型不认识就回 null，调用方据此不写这一格。 */
export function createBudgetState(deps: BudgetStateDeps): (backendId: any) => BudgetPanelState | null {
  return function budgetState(backendId: any): BudgetPanelState | null {
    const id: string = (typeof backendId === 'string') ? backendId : String(backendId == null ? '' : backendId)
    if (!id) return null
    const model: any = backendModelOf(deps, id)
    if (!model) return null
    const kind: string = String(model.kind || 'unknown')
    if (kind === 'off-network') {
      return { id: id, budgetKind: panelKindOf(kind), readKnown: true, offNetwork: true }
    }
    // 后台同步最近一次失败：三种非离网口径都挂在状态上（读数未知时界面会用到；读数已知时界面不看它）。
    const sync: BudgetSyncFailure | null = syncFailureOf(deps, id)
    if (kind === 'requests-only') {
      const lv = ledgerLevelOf(deps.ledger, id, 'requests')
      return withSync(lv
        ? { id: id, budgetKind: panelKindOf(kind), readKnown: true, offNetwork: false, requests: lv }
        : { id: id, budgetKind: panelKindOf(kind), readKnown: false, offNetwork: false, reason: 'not-measured' }, sync)
    }
    if (kind === 'two-buckets') {
      const rest = ledgerLevelOf(deps.ledger, id, 'rest')
      const graphql = ledgerLevelOf(deps.ledger, id, 'graphql')
      return withSync((rest && graphql)
        ? { id: id, budgetKind: panelKindOf(kind), readKnown: true, offNetwork: false, buckets: { rest: rest, graphql: graphql } }
        : { id: id, budgetKind: panelKindOf(kind), readKnown: false, offNetwork: false, reason: 'not-measured' }, sync)
    }
    return withSync({ id: id, budgetKind: 'unknown', readKnown: false, offNetwork: false, reason: 'unsupported' }, sync)
  }
}
