/**
 * src/shared/command-cleanup/src/command-cleanup.ts —— 插件运行实例被宿主销毁时，一条子进程命令怎么收尾（#1392）。
 *
 * 为什么需要这一份：市场更新是「先移除、再安装」。移除那一步会先把这个插件的运行实例（fiber）销毁，
 * 可这一趟已经起好的 gh 子进程还活着；它落定时要建等待上限计时器，而计时器是挂在已销毁实例上的
 * effect —— 建不出来，同步抛 INACTIVE_EFFECT。以前这一下没人接，变成未处理 Promise 拒绝，宿主按
 * 「大声失败」直接退出，一次更新就能带走整个桌面端。
 *
 * 收尾必须同时满足三件事，缺一件宿主仍会退出或者名额泄漏：
 *   1. 失败要变成调用方看得见的结果，不能以拒绝的形式跑出去；
 *   2. 这一趟占的名额（gh 准入名额）与子进程恰好还一次；
 *   3. 不再等的那条子进程，它的 done 即便以拒绝落定也要有人接住。
 *
 * 怎么用：调用方在起好子进程、拿到名额之后调用 startWaitTimeout 建计时器；它返回 null 表示实例
 * 已经销毁（此时名额与子进程都已经收尾完毕），调用方把「实例已销毁」作为失败结果返回即可。
 */

/** 一台子进程的最小形状：本文件只关心收尾要用到的两样东西。 */
export interface CommandHandle {
  done: Promise<unknown>
  terminate(): void
}

/** 宿主计时器交回的那一个 Promise（timeout(毫秒) 那一档）：和子进程的 done 一起 race。 */
export interface WaitTimer {
  then<T>(cb: () => T): Promise<T>
}
export interface WaitTimerService {
  timeout(ms: number): WaitTimer
}

/** 是不是「实例已销毁」这个框架错误。只看错误码：message 文案会随框架版本变，不能拿它当判据。 */
export function isInactiveEffect(e: unknown): boolean {
  return !!(e && (e as { code?: unknown }).code === 'INACTIVE_EFFECT')
}

/** 实例已销毁时要回给上层的失败正文：runGh 的失败信封与 execProc 的失败对象共用这一句。
 *  只写这一处（ADR 一值一处）：两处各写一遍的话，改文案时容易只改一处、两条出口说的话对不上。 */
export const DISPOSED_MESSAGE = '插件运行实例已销毁，这条命令没有执行完'

/** 把「归还一次名额」包成幂等：几条退出路径都会调它，真正归还只发生一次。
 *  不这样写的话，后来新增的退出路径只要漏调一次就泄漏名额；多调一次虽然底层自己也幂等，
 *  但「这条路径到底还了没有」就没人能一眼看出来了。 */
export function onceRelease(release: (() => void) | null | undefined): () => void {
  let done = false
  return function (): void {
    if (done) return
    done = true
    try { if (typeof release === 'function') release() } catch (e) {}
  }
}

/** 不再等这条命令了：先归还名额，再终止子进程，并把它的 done 的拒绝接住。
 *  最后一句是必须的 —— 子进程被终止之后 done 可能以拒绝落定，不接住就是又一条未处理拒绝，
 *  宿主照样 exit(1)。这里只关心「它不会再有人处理」，不关心结局是什么。 */
export function abandonCommand(handle: CommandHandle | null | undefined, release: () => void): void {
  release()
  if (!handle) return
  try { handle.terminate() } catch (e) {}
  try { void handle.done.catch(function () {}) } catch (e) {}
}

/** 建等待上限计时器；实例已被销毁时先收尾（名额 + 子进程），再返回 null。
 *  其它错误先同样收尾，再原样抛出 —— 不把它伪装成「实例已销毁」。 */
export function startWaitTimeout(timer: WaitTimerService, ms: number, cleanup: () => void): WaitTimer | null {
  try {
    return timer.timeout(ms)
  } catch (e) {
    cleanup()
    if (!isInactiveEffect(e)) throw e
    return null
  }
}
