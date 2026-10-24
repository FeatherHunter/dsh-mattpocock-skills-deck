/**
 * src/tracker/session/pipeline.ts —— 会话管线：读缓存 → 裁决 → 转发 → 记账（读预算只读缓存，不进后三步）。
 *
 * 为什么顺序是这个：裁决要看读数，所以先读缓存；记账要看房间回了什么，所以最后记。
 * 读预算例外的原因：它回来的就是读数本身，让它再过一遍裁决等于「量体温之前先问体温计热不热」。
 */
import { ERROR_KIND } from '../contract/vocabulary.js'
import type { Tracker } from '../contract/operations.js'
import type { AccountPort, AdmitPort, BackendBudgetModel, BudgetReading } from '../contract/budget-model.js'

/** 管线一次调用要齐的东西（装配时一次给齐，每次调用只给操作名与参数）。 */
export interface PipelineDeps {
  /** 房间包好桩的实例（转发的目的地；编号已由注册表核过，会话不再核第二遍）。 */
  tracker: Tracker
  /** 后端的花钱口径（裁决与记账都照它办事，管线自己不解释口径）。 */
  budget: BackendBudgetModel
  /** 写权限就绪没有（硬顶的输入，管线只透传，分流由裁决做）。 */
  canWrite: boolean
  /**
   * 读缓存里的那份读数（管线只读一次就递给裁决，免得前后读到两份）。
   * #1446：带后端编号——账本按「后端/桶」分格，不带就分不清该读 github 还是 gitlab 的桶。
   */
  getCachedReading: (backendId?: string) => BudgetReading | Promise<BudgetReading>
  /** 裁决口（放行还是推迟，它说了算）。 */
  admit: AdmitPort
  /** 记账口（只记账，不改变结果）。 */
  account: AccountPort
  /**
   * 这次会话属于哪个后端（账本的键的一半，记账口要它才分得清 github/rest 与 gitlab/requests）。
   * 由入口在装配时从选中的后端编号填入（#1446 加）。
   */
  backendId?: string
  /** 诊断钩子（管线自己的分支原因走这里；没有就静默，绝不因此改变结果）。 */
  onEvent?: (event: string, fields: Record<string, unknown>) => void
}

/** 失败结果的最小形状（与契约的 TrackerError 同形，管线自己造失败时不另起形状）。 */
interface PipelineFailure {
  ok: false
  error: { kind: string; message: string; raw: string }
}

/**
 * 造一个管线自己的失败（形状与契约的失败同形）。
 * 注意：第三格必须写成 `raw: raw` 的显式键，不能缩写成 `raw`——失败单源门禁按字面量
 * 扫描每个失败对象里有没有 `raw:` 这一格，缩写会被误判成没带原文，其实意思完全一样。
 */
function pipelineFail(kind: string, message: string, raw: string): PipelineFailure {
  return { ok: false, error: { kind: kind, message: message, raw: raw } }
}

/**
 * 走一遍管线（永远回值，不抛异常）。
 * 上游拿到的要么是房间原样回的东西，要么是管线自己造的失败——两种都长一个样，调用方不用分两路接。
 */
export async function runPipelineOp(deps: PipelineDeps, op: string, args: unknown[]): Promise<unknown> {
  const tell = (event: string, fields: Record<string, unknown>): void => {
    try { if (deps.onEvent) deps.onEvent(event, fields) } catch { /* 诊断记不上就记不上，结果照旧 */ }
  }
  const room = (deps.tracker as unknown as Record<string, unknown>)[op]
  if (typeof room !== 'function') {
    // 实例上没有这个成员：按说注册表已经补过桩，到这里说明装配时拿错了实例。
    // 报「不支持」而不是炸：调用方认得这个档位，会话不制造新形状的失败。
    return pipelineFail(ERROR_KIND.UNSUPPORTED, '会话实例上没有 ' + op + '（装配时拿错了实例）', '')
  }
  if (op === 'readBudget') {
    // 读预算直达房间：它回来的就是读数，不裁决、不记账（看额度这件事本身不花额度）。
    // 但有一档要翻译：后端模块没实现 readBudget 时，注册表补的桩回的是「不支持」失败信封；
    // 那说的其实是「这个后端没有这项能力」这件读数事实，要翻成契约里的第四种读数
    // （known:false + reason:'unsupported'），不能把失败信封原样交给调用方——
    // 否则契约里这一档永远没有生产者（票 #1456 第 1 条）。装配错（实例连桩都没有）在上面的
    // 成员检查里已经回失败，不走这里。
    let result: unknown
    try {
      result = await (room as (...a: unknown[]) => Promise<unknown>)(...args)
    } catch (err) {
      return pipelineFail(ERROR_KIND.NETWORK, '读预算失败（' + String((err as Error)?.message || err) + '）', '')
    }
    const failure = result as { ok?: boolean; error?: { kind?: string } } | null
    if (failure && failure.ok === false && failure.error && failure.error.kind === ERROR_KIND.UNSUPPORTED) {
      return { ok: true, data: { known: false, reason: 'unsupported' } }
    }
    return result
  }
  let reading: BudgetReading
  try {
    reading = await deps.getCachedReading(deps.backendId)
  } catch (err) {
    // 缓存读炸了等于「没量出来」：按未知那一支往下走（未知≠耗尽，见裁决口的约定），
    // 炸的这一下记一行诊断，不拦调用。
    tell('pipeline.reading-unavailable', { op, reason: String((err as Error)?.message || err) })
    reading = { known: false, reason: 'unavailable' }
  }
  let decision: unknown
  try {
    decision = await deps.admit({ op, budget: deps.budget, reading, canWrite: deps.canWrite })
  } catch (err) {
    // 裁决自己炸了：调用方分不清「被拦」与「闸坏了」，一律按失败回（环境档：裁决这件工具不可用）。
    return pipelineFail(ERROR_KIND.ENV, '预算裁决执行失败，本次调用未发出（' + String((err as Error)?.message || err) + '）', '')
  }
  const verdict = decision as { allowed?: unknown; kind?: string; message?: string; reason?: unknown }
  if (!verdict || verdict.allowed !== true) {
    // 推迟：房间一次都不碰，账上也不多一笔（没发生的事不记）。
    tell('pipeline.deferred', { op, reason: String(verdict?.reason || 'unknown') })
    return pipelineFail(
      typeof verdict?.kind === 'string' ? verdict.kind : ERROR_KIND.RATELIMIT,
      typeof verdict?.message === 'string' ? verdict.message : '预算不足，本次调用推迟',
      '',
    )
  }
  let result: unknown
  try {
    result = await (room as (...a: unknown[]) => Promise<unknown>)(...args)
  } catch (err) {
    // 房间抛了等于「工具不可用」：契约要求失败回值不抛，管线在这里把抛收成回值。
    return pipelineFail(ERROR_KIND.ENV, op + ' 执行失败（房间抛错，已收成失败回值）', String((err as Error)?.message || err))
  }
  try {
    // #1446：把后端编号一起递给记账口 —— 账本按「后端 + 桶」记，没有后端编号就分不清这笔该落哪一格。
    await deps.account({ op, budget: deps.budget, result, backendId: deps.backendId })
  } catch (err) {
    // 记账是旁证：记不上只记一行诊断，结果照旧（账可以稍后对，结果不能翻）。
    tell('pipeline.account-failed', { op, reason: String((err as Error)?.message || err) })
  }
  return result
}
