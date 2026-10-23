/**
 * src/refresh/contract/host-timer-ports.ts —— 宿主计时器服务（ctx.get('timer')）到 OpContext.timers 的共用包装（#1115）。
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
 * 依据（2026-10-14 从 DSH 自带的 @deepseek-ai/cordis-plugin-timer/src/index.ts 逐行核过）：
 *   · timeout(回调, 毫秒) 交回 ctx.effect() 的撤销器 —— 一支可调用的函数，没有 dispose 方法；
 *   · interval(回调, 毫秒)、setTimeout(回调, 毫秒) 与 timeout 同一支形状（后两个只是改名转发）；
 *   · throttle / debounce 交回的是 _schedule 造的包装函数 —— **既可调用、又挂着 .dispose**；
 *   · timeout(毫秒) 那一档（当 Promise 用）交回 Promise.finally(撤销器)，是 Promise，
 *     外部**撤不掉**：只有它所属的 fiber 被销毁时才会被拒（'Context has been disposed'）。
 *
 * 约定（改这个文件的人别踩）：
 *   1. 撤销按句柄形状分三档，判断顺序是：有可调用的 dispose() → 调 dispose()；否则可调用 → 调它本身
 *      （cordis 撤销器）；其余（数字句柄）→ 交全局 clearTimeout。
 *      为什么显式 dispose() 必须排在「可调用」前面：throttle/debounce 的包装函数可调用且带 dispose，
 *      对它「调用句柄」等于**再排一次**（throttle 在窗口外还会立刻执行），正好是撤销的反面。
 *      而真句柄（timeout/interval/setTimeout）没有 dispose 属性，照样落到第二档，行为不变 ——
 *      先判 dispose 在它身上不是本票要修的那种空操作（那种写法的毛病在于**回退**到全局 clearTimeout，
 *      而不在于先判 dispose）。
 *   2. 三档都吞异常：撤销是收尾动作，撤不掉不该把调用方带崩，也不该把已经答完的那一趟变成失败。
 *   3. 重复撤销是安全的：插件自己到点时会先撤销再跑回调，所以撤销之后再调一次没有副作用，
 *      这里也就不记账「撤过没有」——记了反而会多一处会过期的状态。
 *   4. 这个文件不 import 任何模块，也不碰宿主专属能力：共享层里同层互引被门禁拦住
 *      （tests/same-layer-baseline.json 只许减不许增），而它要能在宿主（Node）与客户端闭包两边都跑得动。
 */

/**
 * 宿主计时器服务的最小形状：这里只用到 timeout 一个方法（ctx.get('timer') 上的那一支）。
 *
 * 两档签名都要留着，因为宿主里两种用法都真实存在：
 *   · `timeout(回调, 毫秒)` —— 交回撤销器，hostTimers 把它包成 OpContext.timers.setTimeout；
 *   · `timeout(毫秒)`       —— 当 Promise 用，等它到点（见 src/host/platformChannel.ts 的进程超时）。
 * 说明符指向真源后 tsc 第一次看见了这两种用法；只留一档就会把另一档判成类型错，
 * 而运行时 DSH 的计时器服务两档都收，所以这里按重载写，不是放宽检查。
 */
export interface HostTimerService {
  timeout(handler: () => void, ms?: number): unknown
  timeout(ms: number): Promise<unknown>
}

/** OpContext.timers 的形状：Tracker 后端要的「申请一笔等待 / 撤销这笔等待」两个口子。 */
export interface HostTimers {
  setTimeout(handler: () => void, ms?: number): unknown
  clearTimeout(handle: unknown): void
}

/**
 * 撤销一支计时器句柄，形状分三档，见文件头约定第 1 条。
 * 它不知道、也不需要知道句柄是谁给的：撤销失败一律咽掉，不往上抛。
 * 对 Promise 形状（timeout(毫秒) 那一档）这里是空操作 —— 那形状从外部就撤不掉，见文件头依据那一段。
 */
export function cancelHostTimer(handle: unknown): void {
  try {
    if (handle && typeof (handle as { dispose?: unknown }).dispose === 'function') { (handle as { dispose(): void }).dispose(); return }
    if (typeof handle === 'function') { (handle as () => void)(); return }
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
