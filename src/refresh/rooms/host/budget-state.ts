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

/** 一个桶的水位：limit 是这条桶的额度上限（读数没给上限时退化成 remaining，不编造）。 */
export interface BudgetBucketLevel {
  readonly remaining: number
  readonly limit: number
}

/** 面板侧额度状态：与 src/host/tracker/snapshot.ts 的 RefreshBackendBudget 同一形状（那边是消费方）。 */
export interface BudgetPanelState {
  readonly id: string
  readonly budgetKind: string
  readonly readKnown: boolean
  readonly offNetwork: boolean
  readonly buckets?: { readonly rest?: BudgetBucketLevel; readonly graphql?: BudgetBucketLevel }
  readonly requests?: BudgetBucketLevel
  readonly reason?: string
}

export interface BudgetStateDeps {
  /** 取注册表（拿 modules() 里的预算声明）；拿不到就当后端不认识，不改口。 */
  readonly getTrackerRegistry?: () => any
  /** 账本；只读 view，不在这里记账。 */
  readonly ledger: any
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
    if (kind === 'requests-only') {
      const lv = ledgerLevelOf(deps.ledger, id, 'requests')
      return lv
        ? { id: id, budgetKind: panelKindOf(kind), readKnown: true, offNetwork: false, requests: lv }
        : { id: id, budgetKind: panelKindOf(kind), readKnown: false, offNetwork: false, reason: 'not-measured' }
    }
    if (kind === 'two-buckets') {
      const rest = ledgerLevelOf(deps.ledger, id, 'rest')
      const graphql = ledgerLevelOf(deps.ledger, id, 'graphql')
      return (rest && graphql)
        ? { id: id, budgetKind: panelKindOf(kind), readKnown: true, offNetwork: false, buckets: { rest: rest, graphql: graphql } }
        : { id: id, budgetKind: panelKindOf(kind), readKnown: false, offNetwork: false, reason: 'not-measured' }
    }
    return { id: id, budgetKind: 'unknown', readKnown: false, offNetwork: false, reason: 'unsupported' }
  }
}
