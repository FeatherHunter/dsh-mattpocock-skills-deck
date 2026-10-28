/**
 * src/tracker/session/pipeline.ts —— 会话管线：读缓存 → 裁决 → 转发 → 记账（读预算只读缓存，不进后三步）。
 *
 * 为什么顺序是这个：裁决要看读数，所以先读缓存；记账要看房间回了什么，所以最后记。
 * 读预算例外的原因：它回来的就是读数本身，让它再过一遍裁决等于「量体温之前先问体温计热不热」。
 */
import { ERROR_KIND } from '../contract/vocabulary.js'
import type { Tracker } from '../contract/operations.js'
import type { AccountPort, AdmitPort, BackendBudgetModel, BudgetReading } from '../contract/budget-model.js'
import { newOpId } from '../../shared/op-id.js'

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
  /**
   * 记账口（只记账，不改变结果）。
   * #1627：这一格叫 accountPort 而不是 account——同一份装配里还要再传一个字符串 account
   * （记到账本哪一档），两个同名字段在运行时会让后一个顶掉前一个；端口是函数、档位是名字，
   * 名字分开写，装配方漏传哪一个都能一眼看出来。
   */
  accountPort: AccountPort
  /**
   * 这次会话属于哪个后端（账本的键的一半，记账口要它才分得清 github/rest 与 gitlab/requests）。
   * 由入口在装配时从选中的后端编号填入（#1446 加）。
   */
  backendId?: string
  /**
   * 谁发起的这次调用（#1627）：'refresh'（刷新房间自己用）或 'deck-tool'（工具调用那条路）。
   * 由装配方在造管线时填，管线只原样写进逐笔钩子；没填就是空串（老调用方不填，行为不变）。
   */
  caller?: string
  /**
   * 这一笔记到账本的哪一档（#1627）：'plugin'（插件自己刷）或 'ai-tool'（工具调用）。
   * 观察器要按它把同一份额度下的两拨消耗分开算；没填就是空串。
   */
  account?: string
  /**
   * 这趟会话的用途（#1627）：'' 是普通取数，'naming-index' 是命名索引那次翻页。
   * 为什么值得单独一格：命名索引在陌生工作区里会一页页翻，它和用户点的操作抢同一份额度，
   * 混在一起看不出「是谁把分钟内额度用掉的」。
   */
  purpose?: string
  /**
   * 逐笔操作的开始/结束钩子（#1627 配额诊断）。两个都可缺：缺了就什么都不做，行为与从前一字不差。
   * 回调里抛错绝不影响操作结果——观测是旁证，不是流程的一环（与 onEvent 同一纪律）。
   */
  opHooks?: {
    onStart?: (info: QuotaOpStart) => void
    onEnd?: (info: QuotaOpEnd) => void
  }
  /** 诊断钩子（管线自己的分支原因走这里；没有就静默，绝不因此改变结果）。 */
  onEvent?: (event: string, fields: Record<string, unknown>) => void
}

/**
 * 一次操作开始时报给观察器的话（#1627）。
 *
 * 为什么只有这几格：观察器要回答「谁在抢、这一趟干了什么」，这些是调用侧现成的事实。
 * 点数、请求数、桶、水位那些要等结果回来才有，而且怎么从 result 与 budget 里换算属于刷新层口径，
 * 由装配侧（quota-wiring）现算——管线不 import 刷新层，只把原样的 result 与 budget 交给 onEnd。
 */
export interface QuotaOpStart {
  /** 这一趟开始的毫秒时间戳；在 onEnd 里改写成收尾时刻（房间返回、记账之后，见 QuotaOpEnd 的说明）。 */
  at: number
  /** 操作名（Tracker 能力名，例如 listIssues）。 */
  op: string
  /** 这一趟的编号（同一趟里的多个操作共用一个，见 src/shared/op-id.ts）。 */
  opId: string
  /** 谁发起的这次调用：'refresh' 或 'deck-tool'（装配方给，没给是空串）。 */
  caller: string
  /** 记在账本哪一档：'plugin' 或 'ai-tool'（装配方给，没给是空串）。 */
  account: string
  /** 这次会话属于哪个后端（装配方给；未知时是空串）。 */
  backendId: string
  /** '' 或 'naming-index'（装配方给）。 */
  purpose: string
}

/**
 * 一次操作结束时报给观察器的话（#1627）：在开始那几格上补结局、耗时，以及**原样**的结果与预算口径。
 * 为什么把 result 与 budget 原样递出去：换算点数/请求数/桶是装配侧的事（它认得刷新层的口径），
 * 管线只管把操作真正发生的经过交出去；这样管线不用 import 刷新层，依赖方向不会倒。
 */
export interface QuotaOpEnd extends QuotaOpStart {
  /**
   * 收尾时刻（毫秒时间戳）：房间返回、记账之后的时刻，不是开始时刻——观察器拿它跟窗口起点比对，
   * 问的是「这一笔什么时候结束的」；onStart 里那一格才是发出前的时刻。
   */
  at: number
  /** 房间回的东西算不算成功：只有明确的失败信封算失败，定位口的裸值按成功算。 */
  ok: boolean
  /** 从 onStart 到 onEnd 的毫秒数（含等待裁决与排队的时间）。 */
  latencyMs: number
  /** 房间回包原样（成功信封、失败信封，或定位口的裸值）。 */
  result: unknown
  /** 这次会话的花钱口径原样（换算方用它决定这笔落在哪几个桶）。 */
  budget: unknown
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
 * 本笔调用的编号：最后一个实参若像 OpContext（带 caller 或 cwd 的对象）就抄它的 opId，
 * 否则现场造一个。为什么不改 args：opId 是宿主侧追加的诊断信息，不是房间认得的参数，
 * 往 args 里塞东西会改变房间拿到的实参——那是另一种行为变化。
 * 为什么限定「带 caller 或 cwd」：列表行、计划单这类对象也可能出现在实参末尾，
 * 不能一律当上下文读；OpContext 的形状约定见 src/tracker/contract/contexts.ts。
 */
function opIdOf(args: unknown[]): string {
  const last = args.length > 0 ? args[args.length - 1] : null
  if (last && typeof last === 'object') {
    const rec = last as Record<string, unknown>
    const looksLikeOpContext = typeof rec.caller === 'string' || typeof rec.cwd === 'string'
    if (looksLikeOpContext) {
      const id = rec.opId
      if (typeof id === 'string' && id.trim()) return id
    }
  }
  return newOpId()
}

/**
 * 房间回的东西算不算「成」：只有明确的失败信封（ok 严格等于 false）算失败。
 * 为什么不按「错误对象存在」判：locate 这类口回的是裸值，没有 ok 格，按成功算才对。
 */
function resultOk(result: unknown): boolean {
  const rec = result as { ok?: unknown } | null
  return !(rec && typeof rec === 'object' && rec.ok === false)
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
  // #1627：裁决已经放行，这一笔真的要发出去了——先报一次「开始了」。被推迟的那笔不报：
  // 没发出去的操作没有资格出现在逐笔行里，否则窗口里「放行数」和「真的发出去的数」对不上。
  // 这根时刻也用作耗时起点：从裁决之后算起，不含排队等裁决的时间，量的是房间那一趟本身。
  const startedAt = Date.now()
  const start: QuotaOpStart = {
    at: startedAt,
    op: op,
    opId: opIdOf(args),
    caller: String(deps.caller == null ? '' : deps.caller),
    account: String(deps.account == null ? '' : deps.account),
    backendId: String(deps.backendId == null ? '' : deps.backendId),
    purpose: String(deps.purpose == null ? '' : deps.purpose),
  }
  // 报结束：房间回了、账也记了（或记不上）才报一次 —— 契约要求「记账之后」，
  // 因为观察器要拿这一笔去对账，先报后记会让逐笔行里出现账上还没有的消耗。
  const notifyEnd = (result: unknown): void => {
    try {
      const hooks = deps.opHooks
      if (hooks && typeof hooks.onEnd === 'function') {
        // at 用收尾时刻（房间返回、记账之后）：观察器拿它跟窗口起点比对，比的是「这一笔什么时候结束的」。
        const endedAt = Date.now()
        hooks.onEnd({
          at: endedAt,
          op: start.op,
          opId: start.opId,
          caller: start.caller,
          account: start.account,
          backendId: start.backendId,
          purpose: start.purpose,
          ok: resultOk(result),
          latencyMs: endedAt - startedAt,
          result: result,
          budget: deps.budget,
        })
      }
    } catch { /* 观测是旁证：报不上就报不上，结果照旧 */ }
  }
  try {
    const hooks = deps.opHooks
    if (hooks && typeof hooks.onStart === 'function') hooks.onStart(start)
  } catch { /* 同上 */ }
  let result: unknown
  let threw = false
  let thrown: unknown = null
  try {
    result = await (room as (...a: unknown[]) => Promise<unknown>)(...args)
  } catch (err) {
    threw = true
    thrown = err
  }
  if (threw) {
    // 房间抛了等于「工具不可用」：契约要求失败回值不抛，管线在这里把抛收成回值。
    // 失败信封同样是「这一笔结束了」的事实，所以 return 之前也要报一次 onEnd（ok=false）。
    result = pipelineFail(ERROR_KIND.ENV, op + ' 执行失败（房间抛错，已收成失败回值）', String((thrown as Error)?.message || thrown))
    notifyEnd(result)
    return result
  }
  try {
    // #1446：把后端编号一起递给记账口 —— 账本按「后端 + 桶」记，没有后端编号就分不清这笔该落哪一格。
    await deps.accountPort({ op, budget: deps.budget, result, backendId: deps.backendId })
  } catch (err) {
    // 记账是旁证：记不上只记一行诊断，结果照旧（账可以稍后对，结果不能翻）。
    tell('pipeline.account-failed', { op, reason: String((err as Error)?.message || err) })
  }
  notifyEnd(result)
  return result
}
