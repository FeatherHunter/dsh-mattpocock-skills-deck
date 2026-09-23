/**
 * refresh-core/src/backoff.ts —— 「下一次什么时候再查」的纯函数（#709 检查链与命名守护改事件驱动）
 *
 * 这个文件只回答四件事，里面没有一行读盘、联网、看时钟、起定时器的代码：
 *   ① 检查链还有没做好的步骤时，下一次要等多久（8 秒 → 30 秒 → 2 分钟 → 5 分钟，有进展立刻回快档）；
 *   ② 检查链全绿之后，这份结果还能用多久（30 分钟）；
 *   ③ 环境预检（登录态、仓库可达）的结果还能用多久（成功 10 分钟）；
 *   ④ 环境预检失败之后还允许立刻重试几次（一次；再失败就等下一个真事件，不连环重试）。
 *
 * 为什么退避要写成函数而不是让调用方自己排定时器：改造之后整条检查链上**一个自续定时器都不许有**
 * （不变量 I2「后台零定时器」）。真正决定「下次什么时候查」的是这几条规则，而触发来自四种事件
 * （切进工作区、点「重新检查」、做完可能改变它的动作、写入成功之后）。所以这里给的是「这一刻该等多久」
 * 的答案，不是「现在就挂一个循环」的许可：宿主与客户端拿这个答案只做两件事——要么当场放行、
 * 要么写进待办等下一个事件。
 *
 * 数字一个都不在这里写：全部来自 refresh-core/src/budget.ts（那是唯一真源），由调用方取好装进
 * BackoffLimits 传进来。理由与 policy.ts 一样：产物文件之间同层互引会被
 * tests/verify-no-same-layer-import.js 判红，所以本文件不 import 任何产物的常量。
 */
import type { BackoffLimits, ChainBackoffState, ChainFreshness } from './ports.js'

/** 这份文件定义在哪个文件里。产物里留着它，用来证明「产物确实来自这份源码」。 */
export const BACKOFF_SOURCE = 'refresh-core/src/backoff.ts'

/** 退避序列最少要有几档：只有一档就没有「退」这件事，门禁按它核对调用方传进来的序列。 */
export const MIN_BACKOFF_STEPS = 2

/**
 * 刚起步、什么都还没发生过的退避态：第一档、没有任何进展记录、也没算过全绿缓存。
 * 调用方在内存里持一份即可；盘上不落它（这份状态丢了最多多查一次，不值得为它写盘）。
 */
export function initialChainBackoff(): ChainBackoffState {
  return { step: 0, evaluatedAtMs: 0, allGreen: false }
}

/** 把外面传进来的一档编号夹到序列范围内。序列为空或只有一档时一律返回 0（等于不退避）。 */
function clampStep(step: number, limits: BackoffLimits): number {
  const seq = limits.backoffMs
  if (!seq || seq.length === 0) return 0
  const n = Math.floor(step)
  if (!isFinite(n) || n <= 0) return 0
  return Math.min(n, seq.length - 1)
}

/**
 * 这一档要等多久（毫秒）。档号超出序列长度时停在最后一档 —— 也就是最慢的那一档，不回绕、不归零。
 */
export function backoffDelayMs(step: number, limits: BackoffLimits): number {
  const seq = limits.backoffMs
  if (!seq || seq.length === 0) return 0
  return seq[clampStep(step, limits)]
}

/**
 * 走一步退避：这一轮有进展（链上又有一步变成 done）就立刻回到快档（第一档），
 * 没有进展就往后退一档，退到最慢那一档就停在那里。
 *
 * 「有进展」由调用方判定并传进来，本文件不猜：链快照上多出一步 done 才算进展，
 * 重跑一次拿到一样的结果不算。
 */
export function advanceChainStep(step: number, progressed: boolean, limits: BackoffLimits): number {
  if (progressed) return 0
  return clampStep(step + 1, limits)
}

/**
 * 记下发呆时间：这一轮求值结束时把结果记进退避态，返回新的退避态。
 *
 * 提醒：这里只更新内存里的这一份态，故意不落任何「多久以后自己再来一次」的定时器 ——
 * 下一次求值只可能由四种事件里的某一个带起来（见文件头）。
 */
export function noteChainEvaluation(state: ChainBackoffState, evaluatedAtMs: number, allGreen: boolean, progressed: boolean, limits: BackoffLimits): ChainBackoffState {
  return {
    step: advanceChainStep(state ? state.step : 0, progressed, limits),
    evaluatedAtMs: evaluatedAtMs,
    allGreen: !!allGreen,
  }
}

/**
 * 上一次全绿的结果还能不能直接用（不必重算）。
 *
 * 判据两条都成立才算还能用：① 上一次求值确实全绿；② 距离那一次还没超过全绿缓存寿命（30 分钟，
 * 数字来自 budget.ts 的 CHAIN_ALL_GREEN_TTL_MS）。没求过值（evaluatedAtMs ≤ 0）一律当「不能用」，
 * 免得第一次进面板就拿着一个不存在的结论说自己全绿。
 *
 * 时钟回拨（now 比上次求值还早）当「不能用」处理：宁可多查一次，也不拿一份来路不明的时间戳当真。
 */
export function chainCacheUsable(state: ChainBackoffState, nowMs: number, limits: BackoffLimits): boolean {
  if (!state || !state.allGreen) return false
  const at = Number(state.evaluatedAtMs)
  if (!isFinite(at) || at <= 0) return false
  const now = Number(nowMs)
  if (!isFinite(now) || now < at) return false
  return now - at < limits.allGreenTtlMs
}

/**
 * 这一刻该不该重算检查链。返回三样东西：结论 + 一句原因代号 + 非全绿时「按退避还要等多久」。
 *
 * 注意返回的是**判断结果**，不是「挂一个 8 秒定时器」的指令：调用方拿到 waitMs > 0 时，
 * 正确的做法是把这一步记成待办，等四种事件里的某一个到来再问一次；只有「事件本身就该触发一次」
 * 时才立刻求值（例如人点了「重新检查」，那一次无论退避档位如何都照做——人的动作永不降档）。
 */
export function chainRefreshVerdict(state: ChainBackoffState, nowMs: number, limits: BackoffLimits): ChainFreshness {
  if (chainCacheUsable(state, nowMs, limits)) {
    return { needed: false, reason: 'all-green-cached', waitMs: 0 }
  }
  if (!state || !state.allGreen) {
    // 还没全绿：按当前档位算还要等多久。第一档就是 8 秒——这就是「没有定时器」的那份节奏，
    // 它只在真有事件到来、且距上一次求值还不到这个间隔时才起作用。
    const delay = backoffDelayMs(state ? state.step : 0, limits)
    const at = state && isFinite(Number(state.evaluatedAtMs)) ? Number(state.evaluatedAtMs) : 0
    const elapsed = at > 0 && Number(nowMs) >= at ? Number(nowMs) - at : limits.backoffMs[0]
    if (elapsed >= delay) return { needed: true, reason: 'not-green-due', waitMs: 0 }
    return { needed: false, reason: 'not-green-too-soon', waitMs: delay - elapsed }
  }
  // 上一次是全绿的，但缓存已经过期：按最慢那一档等（全绿之后偶发变了，不必急着追）。
  return { needed: false, reason: 'all-green-expired', waitMs: backoffDelayMs(limits.backoffMs.length - 1, limits) }
}

/**
 * 环境预检（登录态、仓库可达）的这份结果还能不能复用。
 *
 * 成功：寿命 10 分钟（budget.ts 的 PREFLIGHT_TTL_MS 是同一个数字，本文件不另写）。
 * 失败：**不缓存**，一律返回 false —— 失败之后的那一次立刻重试由调用方按
 * preflightRetryAllowed 判，不靠这里缓存。
 */
export function preflightUsable(ok: boolean, checkedAtMs: number, nowMs: number, limits: BackoffLimits): boolean {
  if (!ok) return false
  const at = Number(checkedAtMs)
  if (!isFinite(at) || at <= 0) return false
  const now = Number(nowMs)
  if (!isFinite(now) || now < at) return false
  return now - at < limits.preflightTtlMs
}

/**
 * 环境预检失败之后，还允许「立刻再试一次」吗。
 *
 * 规则：一次求值里最多立刻重试 preflightRetryAfterFailure 次（budget.ts 里定为 1），
 * 再失败就等下一个事件。这样做的原因是防重试风暴：预检失败通常是网络或登录态的问题，
 * 连环重试只会把同一份失败重复烧一遍；而且这一次重试要计入会话的退避计数（谁退避、退多快，
 * 由闸那一侧的 policy.nextAttemptDelayMs 算，本文件不重复那套数字）。
 */
export function preflightRetryAllowed(failuresThisEvaluation: number, limits: BackoffLimits): boolean {
  const n = Math.floor(Number(failuresThisEvaluation))
  if (!isFinite(n) || n < 0) return false
  return n <= limits.preflightRetryAfterFailure
}
