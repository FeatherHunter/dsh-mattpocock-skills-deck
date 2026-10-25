// src/deck/shell/capped-wait.ts —— 让一件可能挂住的事最多等一段时间，而且不把进程留在事件循环里（#1114 第二批）
//
// 用法：const raced = await withCap(某件可能挂住的事(), 上限毫秒)
//       等到了看 raced.ok === true 取 raced.value；超时或对方自己失败都按「没等到」处理，退老路。
//       只想要「等一会儿」的地方用 sleepOnce(毫秒)：到点自己结算，不参与竞速。
//
// 为什么要有它（#1114 的现象）：这段「真结果与定时器赛跑」的写法原来在十处各抄了一份 ——
// 七个工具文件（context.ts、issue-get.ts、issue-list.ts、issue-report.ts、map-link.ts、
// map-snapshot.ts、map-plan-create.ts），外加 backend-transport.ts、session-workdir.ts、
// tracker-session.ts；装配层 host-assemble.ts 另有一份没有类型的同样实现。
// 每一份都是 Promise.race([真结果, new Promise(resolve => setTimeout(resolve, 上限))])。
// 结果先到的那一支赢了之后，等待定时器没人取消、句柄也没人清 —— 每笔 deck_* 调用都会在事件循环里
// 留下一枚最长 15 秒的定时器（沙箱策略等待），宿主在最后一次调用之后最长被多留 60 秒不能自然退出。
// 本文件把「等多久」收成唯一一份：无论哪一支先到，等待定时器都当场清掉；
// 注册重试那种「只是等一会儿」（register-options.ts、suggest-steps-register.ts）也走 sleepOnce。
//
// 三条约定，改之前先看清楚：
//   1. 只改「等多久」，不改判定：对方自己失败（reject）回 { ok:false }，与超时（timedOut:true）区分开，
//      调用方一律按「没等到」退老路，不把它当成后端诚实失败。
//   2. 结果先到、超时到点、对方失败，三条路都先撤掉等待定时器，再把结果交回。
//   3. 整场竞速包一层存活租约（#1157）：等待定时器 unref 之后，如果这一场里只剩它，进程会带着退出码 0
//      静默收摊，调用永远不结算。租约保证「有活在跑」时进程活到结算，结算之后立刻释放。
//
// 注入等待口（sleep）只给测试换虚拟时钟用：注入的那一份本文件取消不了，调用方自己保证测试环境里
// 没有真定时器残留（tests/verify-1146 用的就是这条路）。
import { withInFlightLease } from './in-flight-lease.js'

/** 注入等待口的类型：等 ms 毫秒后结算。真实时钟用本文件的 startWait；测试可换虚拟时钟。 */
export type CapSleep = (ms: number) => Promise<unknown>

/** 钳制等待的结果：等到了给值；超时或对方自己失败都算「没等到」，调用方一律退老路。 */
export type CapResult<T> = { ok: true; value: T } | { ok: false; timedOut?: true }

/** 一份还在路上的等待，以及把它从事件循环里撤下来的办法。 */
type PendingWait = { wait: Promise<void>; cancel: () => void }

/**
 * 起一份真实时钟的等待：定时器创建后立刻 unref（它只是提醒，不该替进程决定什么时候能退出），
 * 到点或被 cancel 时清掉句柄。setTimeout 同步抛错（宿主已经收走定时器能力）按「立刻到点」结算，
 * 不把异常甩给调用方 —— 等得到与等不到都只是「没等到」，调用方的老路仍然在。
 */
function startWait(ms: number): PendingWait {
  let timer: ReturnType<typeof setTimeout> | null = null
  let done = false
  let wake: (() => void) | null = null
  const wait = new Promise<void>(function (resolve) {
    wake = function (): void { resolve() }
    try {
      timer = setTimeout(function () { finish() }, ms)
      const handle = timer as unknown as { unref?: () => void }
      if (handle && typeof handle.unref === 'function') { try { handle.unref() } catch (e) { /* 宿主收走了 unref：等待照跑，只是不再保证不替进程续命 */ } }
    } catch (e) { finish() }
  })
  function finish(): void {
    if (done) return
    done = true
    if (timer !== null) { try { clearTimeout(timer) } catch (e) { /* 句柄已经没了也算撤下来 */ } timer = null }
    const w = wake
    wake = null
    if (w) { try { w() } catch (e) { /* 结算函数不会抛；抛了也不该盖住调用方要的结果 */ } }
  }
  return { wait: wait, cancel: finish }
}

/** 等一会儿：到点自己结算。定时器 unref，不替进程决定什么时候能退出；不参与竞速，所以不需要 cancel。 */
export function sleepOnce(ms: number): Promise<void> {
  return startWait(ms).wait
}

/** 按调用方给不给等待口，拿一份等待与撤下它的办法；注入的那一份撤不了，cancel 是空操作。 */
function waitFor(ms: number, sleep?: CapSleep): PendingWait {
  if (typeof sleep === 'function') {
    return { wait: Promise.resolve(sleep(ms)).then(function () {}), cancel: function (): void { /* 注入的等待口由测试自己收尾，这里撤不了 */ } }
  }
  return startWait(ms)
}

/**
 * 让一件可能挂住的事最多等 ms 毫秒。三条路都交回同一形状的结果，且都先撤掉等待定时器再交回：
 * 等到了 { ok:true, value }；到点没等到 { ok:false, timedOut:true }；对方自己失败 { ok:false }。
 *
 * 失败（reject）不往外抛：调用方（九份工具里的沙箱策略等待、计划游标读写、会话目录归一）把
 * 「没等到」当缺席处理，与它们原先 catch 成 null 的老口径一致；这一层不替它们改判定。
 */
export function withCap<T>(promise: Promise<T> | T, ms: number, sleep?: CapSleep): Promise<CapResult<T>> {
  const bounded = Promise.resolve(promise)
  const pending = waitFor(ms, sleep)
  return withInFlightLease(function (): Promise<CapResult<T>> {
    return Promise.race([
      bounded.then(function (value: T): CapResult<T> { pending.cancel(); return { ok: true, value: value } }, function (): CapResult<T> { pending.cancel(); return { ok: false } }),
      pending.wait.then(function (): CapResult<T> { pending.cancel(); return { ok: false, timedOut: true } }, function (): CapResult<T> { pending.cancel(); return { ok: false, timedOut: true } }),
    ])
  })
}
