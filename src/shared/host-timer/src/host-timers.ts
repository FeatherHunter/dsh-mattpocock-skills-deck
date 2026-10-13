/**
 * src/shared/host-timer/src/host-timers.ts —— 宿主计时器服务（ctx.get('timer')）到 OpContext.timers 的共用包装（#1115）。
 *
 * 为什么要有它：宿主计时器服务由 DSH 里的 @deepseek-ai/cordis-plugin-timer 提供，它的 timeout(回调, 毫秒)
 * 交回的是**一支可调用的函数** —— cordis 的 effect 撤销器。2026-10-14 实测的三种撤销方式：
 *   · 全局 clearTimeout(句柄)：不报错，静默无效，回调照常到点触发（函数不是数字句柄）；
 *   · 句柄.dispose()：抛 TypeError（它没有这个方法）；
 *   · 调用句柄本身 句柄()：撤销成功（fiber 上挂着的 effect 数从 1 变成 0，回调不再触发）。
 * 在 #1115 之前，宿主里有六处各自手写这段包装，写法还不一样；其中「直接全局 clearTimeout」与
 * 「先判 .dispose 再回退」两种在真句柄上都是空操作。撤销不掉的那一笔等待会一直活到自己到点，
 * 对「等不到就判还没答完」这条兜底来说，表现为每次未绑定工作区选后端就多留一个最长 30 秒的活计时器。
 * 这里把它收成一份：调用点只写 `timers: hostTimers(timer)`。
 *
 * 给谁用（宿主里要把 ctx.get('timer') 包成 OpContext.timers 的每一处，共六处调用点）：
 *   src/host/platformChannel.js 的 getTimers 与兜底二联的 ctx2、
 *   src/host/commentThreads.js 的 opCtx、
 *   src/host/workspaceCwd.js 的 opCtxFor、
 *   src/host/snapshotBuild.ts 的 tmpCtx 与 ctxSel、
 *   src/host/refresh/wiring.js 的 backendObj.timers。
 *
 * 约定（改这个文件的人别踩）：
 *   1. 撤销按句柄形状分三档：可调用 → 调它本身（cordis 撤销器）；有可调用的 dispose() → 调 dispose()
 *      （部分计时器服务与门禁夹具交回这种形状）；其余（数字句柄）→ 交全局 clearTimeout。
 *      顺序不能反：真句柄上 `.dispose` 是 undefined，先判 dispose 的那种写法在真句柄上就是空操作
 *      （那正是 #1115 要修掉的形态）。
 *   2. 三档都吞异常：撤销是收尾动作，撤不掉不该把调用方带崩，也不该把已经答完的那一趟变成失败。
 *   3. 重复撤销是安全的：插件自己到点时会先撤销再跑回调，所以撤销之后再调一次没有副作用，
 *      这里也就不记账「撤过没有」——记了反而会多一处会过期的状态。
 *   4. 这个文件不 import 任何模块，也不碰宿主专属能力：共享层里同层互引被门禁拦住
 *      （tests/same-layer-baseline.json 只许减不许增），而它要能在宿主（Node）与客户端闭包两边都跑得动。
 */

/** 宿主计时器服务的最小形状：这里只用到 timeout 一个方法（ctx.get('timer') 上的那一支）。 */
export interface HostTimerService {
  timeout(handler: () => void, ms?: number): unknown
}

/** OpContext.timers 的形状：Tracker 后端要的「申请一笔等待 / 撤销这笔等待」两个口子。 */
export interface HostTimers {
  setTimeout(handler: () => void, ms?: number): unknown
  clearTimeout(handle: unknown): void
}

/**
 * 撤销一支计时器句柄，形状分三档，见文件头约定第 1 条。
 * 它不知道、也不需要知道句柄是谁给的：撤销失败一律咽掉，不往上抛。
 */
export function cancelHostTimer(handle: unknown): void {
  try {
    if (typeof handle === 'function') { (handle as () => void)(); return }
    if (handle && typeof (handle as { dispose?: unknown }).dispose === 'function') { (handle as { dispose(): void }).dispose(); return }
    if (handle !== undefined && handle !== null) clearTimeout(handle as number)
  } catch (e) { /* 收尾动作：撤不掉也不能把调用方带崩 */ }
}

/** 把宿主计时器服务包成 OpContext.timers（六处调用点共用这一份）。 */
export function hostTimers(timerService: HostTimerService): HostTimers {
  return {
    setTimeout(handler: () => void, ms?: number): unknown { return timerService.timeout(handler, ms) },
    clearTimeout(handle: unknown): void { cancelHostTimer(handle) },
  }
}
