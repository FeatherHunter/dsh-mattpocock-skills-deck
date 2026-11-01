// src/refresh/rooms/host/chain-step-rows.ts —— 从 check-chain-evaluation.ts 搬出的「判定 → 步骤行 / 快照」三件套（#1483）。
//
// 为什么搬出来：同一份链快照除了正常求值要拼，缓存命中时若某一项的结果取决于「当前是哪个会话」
//   （目前标记了 md:scratchWritable；该谓词当前不做写探测，返回 pending），也要按当前会话重算那一行。
//   两处必须用同一套「判定 → 状态 → 计数」口径，否则缓存命中时拼出来的行会和正常求值时不一样。
//   搬出来只为了共用，逻辑逐字保留：状态怎么选、pending 行只留哪几格、计数怎么算，都与原来一致。
//
// 约定不能改：
//   1. 判定串只有三种输入（'pass' / 'fail' / null）与判定对象（status 三态）两种形态，两路都收。
//   2. pending（诚实未知）的行只保留检查项名称（fallback/title/i18nKey），不带 onFail 的修复文案与动作；
//      fail / current 才展示修复指引。反例：把 pending 也当失败行渲染，界面会在「还没测出来」时显示误导性的修复指引。
//   3. 拼接视图（fullSnapshot）的计数与单段快照同口径，但它不判「第几个失败」，所以没有 failedIndex。
//   4. 类型只写可剥离的 TypeScript：Node 剥离模式只删类型、不做语法转换。
import type { CheckItem } from '../../../shared/tracker/chain-types.js'

/** 一次求值按检查项 id 汇总的判定对象（resolveAll 给的就是这一份）。 */
export type PredicateResultView = { status: 'pass' | 'fail' | 'pending'; detail?: string; hint?: string; evidence?: string }
/** 步骤判定表：可以放判定对象，也可以放 toPredicateResults 折出来的状态串。 */
export type EvalMap = Record<string, PredicateResultView | 'pass' | 'fail' | null | undefined>
/** 判定对象那一份（富化步骤用的 detail/hint 只在这一路里）。 */
export type ResolvedMap = Record<string, PredicateResultView | undefined>

/** 展示数据（共享层 Show 的几格；本模块只读 fallback/title/i18nKey/desc/hint）。 */
export type ShowView = { i18nKey?: unknown; title?: unknown; desc?: unknown; fallback?: unknown; hint?: unknown; level?: unknown; params?: unknown }

/**
 * 求值后单步（与共享层 StepSnapshot 同形）。id 写成可缺是照实收：契约里它本来就可选
 *（「未提供时回退用 check 串」）。正文里按 id 查表的两处写着 `as string`——那是给编译器看的，
 * 运行期原样按键查，查不到就当没有。
 */
export type StepView = { id?: string; check?: unknown; status?: string; show?: ShowView | null; actions?: unknown[]; isApplicable?: boolean; blockedBy?: string | null; isCurrent?: boolean; isBlocking?: boolean }

/**
 * 富化（把谓词结果的 detail/hint 并进步骤 show）与拼接视图都按最小形状读快照：只要求「有一串步骤」，
 * 步骤按三格读——id（拿来查判定表）、status（算 done/current）、show（合 detail/hint），其余格子原样带回去。
 * 为什么不直接用整份 ChainSnapView：拼接出来的那一份没有 failedIndex（拼接层不判「第几个失败」），
 * 而富化对它碰不到的格子本来就不该提要求。
 */
export type SnapStepView = { id?: string; status?: string; show?: ShowView | null }
export type SnapStepsView = { steps: SnapStepView[] }

/** 拼接视图：两段链的步骤按清单排序后合成的一份视图，除步骤外还带计数与版本（消费侧只读）。 */
export type FullSnapView = SnapStepsView & { currentIndex: number | null; doneCount: number; applicableCount: number; totalCount: number; chainState: string; version: string }

/** 本模块自己拼的链快照：比共享层 ChainSnapshot 多出「算完再补挂」的那三格（补挂前是缺的）。 */
export type ChainSnapView = {
  steps: StepView[]
  currentIndex: number | null
  failedIndex: number
  doneCount: number
  applicableCount: number
  totalCount: number
  chainState: 'allDone' | 'hasCurrent' | 'pending'
  version: string
  isComplete?: boolean
  hasBlockingFailure?: boolean
  blockingCheck?: string | null
}

/**
 * 把一组检查项与判定表拼成链快照（#284 修订：逐项独立求值，不因前置未过而吞掉后面的判定）。
 *
 * 为什么逐项独立：evaluateChain 的串行被阻塞语义会把「已算出但前置未过」的判定（技能缺失红牌、
 *   gh 未装提示）吞成 pending；那是 #281 红牌契约与 #229「pending=诚实未知」的不诚实表达。
 * 改为：所有步骤保留自身判定（全貌诊断），链只表达「首个未通过步 = 当前引导步」（currentIndex）。
 *
 * 约定不能改：
 *  1. 判定为 pass → done；fail 且带修复动作 → current（有下一步可点）；fail 无动作 → fail；其余 → pending。
 *  2. pending 行只留 fallback/title/i18nKey 三格（见文件头约定 2）。
 *  3. 全部 done 才 isComplete；否则 failedIndex/blockingCheck 指第一个未 done 的步骤。
 * 反例：异常时不要抛给调用方——返回 null，让上层按「没有快照」降级。
 */
export function stepEvalParallel(items: CheckItem[], resolved: EvalMap): ChainSnapView | null {
  try {
    const rMap = resolved || {}
    const steps = (items || []).map(function (it: CheckItem) {
      const rd = rMap[it.id as string]
      // 仅已明确完成的无探测结果允许兼容推进；异常和超时的 pending 仍阻塞。
      const unverified = it.id === 'md:scratchWritable' && typeof rd === 'object' && rd !== null && rd.status === 'pending' && rd.evidence === 'writability-unverified'
      const isPass = rd === 'pass' || (typeof rd === 'object' && rd !== null && rd.status === 'pass') || unverified
      const isFail = rd === 'fail' || (typeof rd === 'object' && rd !== null && rd.status === 'fail')
      const status = isPass ? 'done' : (isFail ? (((it.onFail && Array.isArray(it.onFail.actions) && it.onFail.actions.length)) ? 'current' : 'fail') : 'pending')
      const _pendingShow = (function () { const bb: ShowView = (it.onFail && it.onFail.show) || {}; const oo: ShowView = {}; if (bb.fallback != null) oo.fallback = bb.fallback; if (bb.title != null) oo.title = bb.title; if (bb.i18nKey != null) oo.i18nKey = bb.i18nKey; return oo })()
      const show = unverified ? Object.assign({}, _pendingShow, { level: 'warn', desc: rd.detail }) : (isPass ? ((it.onPass && it.onPass.show) || null) : (isFail ? ((it.onFail && it.onFail.show) || null) : _pendingShow))
      const actions = isFail && it.onFail && Array.isArray(it.onFail.actions) ? it.onFail.actions : []
      return { id: it.id, check: it.check, status: status, show: show, actions: actions, isApplicable: true, blockedBy: null, isCurrent: false, isBlocking: status !== 'done' }
    })
    const firstNotDone = steps.findIndex(function (s: StepView) { return s.status !== 'done' })
    const allDone = firstNotDone < 0
    const snapshot: ChainSnapView = {
      steps: steps,
      currentIndex: allDone ? null : firstNotDone,
      failedIndex: firstNotDone,
      doneCount: steps.filter(function (s: StepView) { return s.status === 'done' }).length,
      applicableCount: steps.length,
      totalCount: steps.length,
      chainState: allDone ? 'allDone' : (steps[firstNotDone].status === 'pending' ? 'pending' : 'hasCurrent'),
      version: '1',
    }
    if (allDone) { snapshot.isComplete = true } else { snapshot.isComplete = false; snapshot.hasBlockingFailure = steps[firstNotDone].status !== 'pending'; snapshot.blockingCheck = steps[firstNotDone].id }
    return snapshot
  } catch (e) { return null }
}

/**
 * 富化链快照：把谓词结果的 detail/hint 合并进步骤 show（红牌分拣文案经链到达 UI，#284）。
 *
 * 约定不能改：只补空位（base.desc / base.hint 已有值时不覆盖）；返回的是新快照，不改传进来的那一份——
 *   缓存命中时可能正拿着共享缓存里的对象，原地改会把别的会话看到的那一份也改掉。
 * 反例：没有判定对象或没有 detail/hint 时原样返回（不要克隆一份空壳）。
 */
export function enrichSnap(snap: SnapStepsView | null, resolvedMap: ResolvedMap | null): SnapStepsView | null {
  try {
    if (!snap || !Array.isArray(snap.steps) || !resolvedMap) return snap
    const rMap = resolvedMap || {}
    const steps = snap.steps.map(function (s: SnapStepView) {
      const rd = rMap[s.id as string] || null
      if (!rd || (!rd.detail && !rd.hint)) return s
      const base: ShowView = s.show || {}
      return Object.assign({}, s, { show: Object.assign({}, base, rd.detail ? { desc: base.desc || rd.detail } : {}, rd.hint ? { hint: base.hint || rd.hint } : {}) })
    })
    return Object.assign({}, snap, { steps: steps })
  } catch (e) { return snap }
}

/**
 * 用一串已经排好序的步骤拼出拼接视图的计数（#668：行序由引导清单决定，计数口径与单段快照一致）。
 *
 * 为什么不判 failedIndex：拼接视图是两段链的「拼接」，消费侧只读计数与当前引导步，
 *   判「第几个失败」是单段链自己的事（见 stepEvalParallel）。
 * 反例：不要在这里重排步骤——顺序只有 guide-steps.ts 那一份真源。
 */
export function assembleFullSnapshot(steps: SnapStepView[]): FullSnapView {
  const list = steps || []
  const firstNotDone = list.findIndex(function (s: SnapStepView) { return s.status !== 'done' })
  const allDone = firstNotDone < 0
  return {
    steps: list,
    currentIndex: allDone ? null : firstNotDone,
    doneCount: list.filter(function (s: SnapStepView) { return s.status === 'done' }).length,
    applicableCount: list.length,
    totalCount: list.length,
    chainState: allDone ? 'allDone' : (list[firstNotDone].status === 'pending' ? 'pending' : 'hasCurrent'),
    version: '1',
  }
}
