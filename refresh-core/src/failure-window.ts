/**
 * refresh-core/src/failure-window.ts —— 「连续失败」那一轮的窗口状态机（#998，2026-10-10 真机故障）
 *
 * 这个文件只回答一句话：**连续失败到了门槛之后，什么时候该放一笔探针进来试一次？**
 * 它是一台纯状态机：不读时钟、不记日志、不出网、不 import 任何别的产物 —— 时刻与等待时长
 * 都由调用方（宿主侧 src/host/refresh/gate.js）算好传进来。
 *
 * 为什么非要有它（真机上量到的故障）：
 *   闸对「连续失败」的处置是「到门槛就一律推迟」，而推迟既不算失败、也不算成功 ——
 *   连续失败计数只有「真跑成功一次」才归零（gate.js 里唯一那处归零）。于是：
 *     计数到门槛 → 谁都进不来 → 既然谁都进不来，就永远不会有成功把计数归零 → 还是谁都进不来。
 *   2026-10-10 在真机上就是这个样子：gh 已经恢复到 1 秒一条、全成功，deck 开头的工具还在一律
 *   回「连续失败到了退避门槛」，一直到人重启进程才活过来（票 #998 里有当天的日志与时间线）。
 *
 * 三件事的规矩（每一件都在 tests/verify-998-half-open.js 里有断言钉着）：
 *   ① 窗口没过完：不放行。等待时长 = 连续失败第 n 次那一档（调用方从 budget 的退避序列取）+
 *      一整轮之后额外等的那一段。n 越大等越久，所以尝试的频率只会越来越低，不会连环重试。
 *   ② 窗口过完：放**一笔**。放行的那一刻就把窗口起点改成此刻 —— 这一笔要是失败，下一次从此刻
 *      重新算（不会因为「试了还在失败」而连环重试）；要是成功，调用方把计数归零，锁当场开。
 *   ③ 一笔在飞、还没回来：又过了窗口也不放第二笔（同上，时间戳在放行那一刻已经盖掉）。
 */

/** 一台状态机的那点状态。字段名与宿主侧闸的工作区状态同名，方便直接读写同一格。 */
export interface FailureWindowState {
  /** 连续失败了几次（成功一次由调用方归零）。 */
  failures: number
  /** 这一轮退避窗口的起点（毫秒时刻）；0 表示还没进过这一轮。 */
  windowStartedAt: number
}

/** 从「闸手里那格状态」取出这台状态机要用的两格。 */
export function failureWindowOf(state: { failuresSinceSuccess?: number; backoffWindowStartedAt?: number } | null | undefined): FailureWindowState {
  const s = state || {}
  const failures = (typeof s.failuresSinceSuccess === 'number' && isFinite(s.failuresSinceSuccess) && s.failuresSinceSuccess > 0) ? Math.floor(s.failuresSinceSuccess) : 0
  const started = (typeof s.backoffWindowStartedAt === 'number' && isFinite(s.backoffWindowStartedAt) && s.backoffWindowStartedAt > 0) ? s.backoffWindowStartedAt : 0
  return { failures: failures, windowStartedAt: started }
}

/**
 * 相对窗口起点已经过了多久才允许放一笔探针：退避序列里第 n 次失败那一档 + 额外那一段。
 * 两个数都由调用方算好传进来（本文件不 import budget，也不 import policy）。
 */
export function windowLengthMs(failures: number, backoffMs: number, extraMs: number): number {
  const n = (typeof failures === 'number' && isFinite(failures) && failures > 0) ? Math.floor(failures) : 0
  const base = (typeof backoffMs === 'number' && isFinite(backoffMs) && backoffMs > 0) ? backoffMs : 0
  const extra = (typeof extraMs === 'number' && isFinite(extraMs) && extraMs > 0) ? extraMs : 0
  if (n <= 0) return 0
  return base + extra
}

/**
 * 这一笔能不能当作「探测试探」放进来。
 * 过了窗口才是 true；没进过这一轮（窗口起点是 0）永远是 false —— 那种情况由裁决那侧按老规矩一律推迟。
 */
export function halfOpenTrialIsDue(state: FailureWindowState, now: number, backoffMs: number, extraMs: number): boolean {
  if (typeof now !== 'number' || !isFinite(now)) return false
  if (!(state.windowStartedAt > 0)) return false
  return (now - state.windowStartedAt) >= windowLengthMs(state.failures, backoffMs, extraMs)
}

/**
 * 一笔探针被放进来试了：窗口起点改成此刻（把这一笔占住，也为可能的失败重开窗口）。
 * 返回改完之后的窗口起点，调用方写回它自己那格状态。
 */
export function consumeHalfOpenTrial(now: number): number {
  return (typeof now === 'number' && isFinite(now) && now > 0) ? now : 0
}

/** 一笔真失败：计数加一，窗口从此刻重开。返回改完之后的两个数，调用方写回它自己那格状态。 */
export function recordFailure(state: FailureWindowState, now: number): FailureWindowState {
  const failures = (state.failures > 0 ? Math.floor(state.failures) : 0) + 1
  return { failures: failures, windowStartedAt: consumeHalfOpenTrial(now) }
}
