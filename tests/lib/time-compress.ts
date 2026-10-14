'use strict'

// tests/lib/time-compress.js —— 门禁用的「时间压缩」助手：把「等超时」的空等换成虚拟时间。
//
// 为什么需要它：#895 与 #898 这两扇门禁跑完全部断言只用几百毫秒，进程却要再空等 60 秒才退出。
// 原因不在断言，而在产品代码里两处**没人清掉**的定时器：
//   · src/deck/shell/write-mutex.ts 的 DEFAULT_KEY_LOCK_TIMEOUT_MS（60000 毫秒，等锁上限）；
//   · src/deck/tools/map-plan-create.ts 的 STORE_TIMEOUT_MS（10000 毫秒，游标读写竞速）。
// 它们都是 Promise.race 里的「超时就先走」，竞速赢了以后那个定时器仍然挂在事件循环上，
// 于是 node 必须等它烧完才肯退出。这类等待全是空等，CPU 占用只有几十毫秒。
//
// 怎么办：不改产品代码，只换掉本进程里的时钟与定时器——
//   · Date.now()（以及 new Date()、performance.now()）返回「真实时间 + 虚拟偏移」；
//   · setTimeout/setInterval 的真实等待压到 maxDelayMs 以内，省下来的时间补进虚拟偏移，
//     让「等 8 秒超时」的判定照样看到 8 秒真的过去了。
// 于是有牙齿的判定（预算打满、单次钳制、等锁超时）全部照常生效，只是不再真的空等。
//
// 两条不能破的语义（破了以后门禁不是变慢，而是变成假的）：
//   ① 到期顺序按**虚拟到期时间**排，不按调度顺序。同一个 tick 里先排一个 150 毫秒的钳制定时器、
//      再排一个 90 毫秒的假后端等待，必须还是 90 毫秒那个先跑（真跑起来时先排的先到点是错的，
//      判定会反成「这一次调用超时了」）。所以这里不直接把每次调度丢给真实定时器，而是自己排一条
//      虚拟队列，按 (到期时间, 排号) 逐个放行。
//   ② 虚拟时钟在**定时器真正到期那一刻**才推进到它的到期时间，不在调度时推进。调度时就推进看着
//      更直接，但被 clearTimeout 取消掉的定时器会凭空推进时钟——产品代码给每一次远端调用都排了
//      一个「剩余额度」那么长的钳制定时器，正常返回时就地清掉；调度即推进会在这第一次调用时就把
//      整笔预算烧光，门禁从全绿变红灯，而那并不是产品的问题。没等过的时间不该走钟。
//
// 泵自己的存活也有一条不能破的规矩（#1146）：真实事件循环上只有泵这一个句柄，所以「门禁会不会
// 提前收摊、后面的断言还跑不跑」只看泵有没有被引用。规矩是「队列里还有被引用的等待，泵就必须是
// 活的」，每一次队列变化都要重新对一遍——见 syncPumpLiveness()。
//
// 边界（拿它提速别的门禁之前先看这三条）：
//   · 压缩只作用于定时器，真实的读盘/联网不跟着变快。如果一扇门禁的判定依赖「慢 I/O 与定时器谁先到」，
//     压缩会改变先后——那种门禁不要用。
//   · 只接管全局那一份时钟与定时器：安装之前就把 setTimeout/Date.now 存进局部变量的模块不受影响。
//     所以安装要放在加载被测代码之前（本仓门禁都是动态 import，装在文件开头就够）。
//   · 卸载还原的是全局函数。卸载前发出去的句柄在卸载之后已经清不掉了（全局 clearTimeout 又变回原生），
//     它们会以 0 延时尽快跑完——所以卸载后紧接着跑下一扇门禁是安全的，但别指望还能取消上一扇的等待。
//
// 为什么放在 tests/lib 而不是 src：它是门禁自己的工具，产品代码一行都不用知道它存在
//（产品代码本来就通过注入 now、或者读全局 Date.now 来看钟，这里只是把全局那一份换掉）。
// 为什么是 TypeScript：tests/** 是 node 直接拉起来跑的检查脚本，既不进构建也不进 tsc，跑的就是本文件；
// 调用点仍然写作 `./lib/time-compress.js`，由 scripts/ts-hook.mjs 把这类说明符改指到同目录同名的 .ts。
//
// 用法：
//   const { installTimeCompression, uninstallTimeCompression } = require('./lib/time-compress.js')
//   installTimeCompression()      // 放在加载产品代码之前
//   ...跑断言...
//   uninstallTimeCompression()    // 同一个进程里后面还要跑别的门禁，就必须还原
// 本文件不打印任何东西；要核对这次压缩干了多少活，读 installTimeCompression() 返回的那份统计。

/** 一次虚拟等待在队列里的记录：到期时间用虚拟毫秒，refed 就是「它还算不算存活来源」。 */
interface TimerEntry {
  id: number
  seq: number
  fn: (...args: any[]) => void
  args: any[]
  delay: number
  interval: number | null
  due: number
  refed: boolean
  handle?: VirtualHandle
}

/** 交给调用方的句柄：形状照 node 的 Timeout 给足（多出来的 [ENTRY] 只给 clearTimeout 认领用）。 */
interface VirtualHandle {
  ref(): VirtualHandle
  unref(): VirtualHandle
  hasRef(): boolean
  refresh(): VirtualHandle
  close(): void
}

/** 压缩助手记的账：和 publicHandle().stats 是同一个对象，边跑边可读。 */
interface CompressionStats {
  installs: number; installRepeats: number; uninstalls: number
  scheduled: number; fired: number; cleared: number; intervalTicks: number
  virtualAdvancedMs: number; callbackErrors: number; pendingAtUninstall: number
}

/** 安装那一刻捕获的原生实现与属性描述符，卸载时照着它还原。 */
interface OriginalClock {
  setTimeout: any; clearTimeout: any; setInterval: any; clearInterval: any
  dateNow: () => number
  globals: Record<string, PropertyDescriptor | null>
}

/** 全局唯一的压缩状态。 */
interface CompressionState {
  maxDelayMs: number
  installed: boolean
  flushing: boolean
  offsetMs: number
  seq: number
  entries: Map<number, TimerEntry>
  pumpTimer: any
  pumpDelay: number
  originals: OriginalClock | null
  stats: CompressionStats
}

/** 安装参数：maxDelayMs 是「真实最多等多久」，只影响真实等待，不影响虚拟时间。 */
interface InstallOptions { maxDelayMs?: number }

/** 装在调用方手上的那份句柄。 */
interface PublicHandle {
  maxDelayMs: number
  stats: CompressionStats
  isInstalled(): boolean
  uninstall(): boolean
}

/** 默认真实等待上限（毫秒）：虚拟要等多久都行，真实只等这么久。 */
const DEFAULT_MAX_DELAY_MS = 5

/** 挂在定时器句柄上的标记，clearTimeout/clearInterval 靠它认出「这一次排的是虚拟定时器」。 */
const ENTRY = Symbol.for('dsh.timeCompress.entry')

/** 全局唯一的压缩状态：同一进程重复安装不重复包装，卸载后仍留着待触发的虚拟定时器。 */
const state: CompressionState = {
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  installed: false,
  flushing: false,
  offsetMs: 0,
  seq: 0,
  entries: new Map(),
  pumpTimer: null,
  pumpDelay: -1,
  originals: null,
  stats: {
    installs: 0, installRepeats: 0, uninstalls: 0,
    scheduled: 0, fired: 0, cleared: 0, intervalTicks: 0,
    virtualAdvancedMs: 0, callbackErrors: 0, pendingAtUninstall: 0,
  },
}

/** 真实时间：用安装那一刻捕获的原生 Date.now，不受本文件接管影响。 */
function realNow(): number { return state.originals!.dateNow() }
/** 虚拟时间：真实时间加上「已经等掉的虚拟时长」。只增不减。 */
function virtualNow(): number { return realNow() + state.offsetMs }

/** 延时规整：非数字、负数、NaN 一律当 0（与 node 对非法延时的宽容方向一致）。 */
function normalizeDelay(ms: unknown): number {
  const n = (typeof ms === 'number' && isFinite(ms)) ? ms : 0
  return n > 0 ? n : 0
}

/** 当前最早到期的那个虚拟定时器：先比到期时间，同时到期的按排号（先排先跑，与 node 同）。 */
function earliestEntry(): TimerEntry | null {
  let best: TimerEntry | null = null
  state.entries.forEach(function (e) {
    if (best === null || e.due < best.due || (e.due === best.due && e.seq < best.seq)) best = e
  })
  return best
}

/** 还有没有「被引用着」的虚拟定时器：一个都没有时，泵不该拖着事件循环不让退出。 */
function anyReferenced(): boolean {
  let any = false
  state.entries.forEach(function (e) { if (e.refed) any = true })
  return any
}

/**
 * 把泵的「活着」状态同步成「队列里还有没有被引用的等待」。
 *
 * 为什么必须有这一步（#1146）：泵是唯一挂在真实事件循环上的东西，进程会不会提前收摊只看它这一格。
 * 原来只在「重新装泵走到底」那一条路上算一次引用状态，于是提前返回那一格会把状态留在上一次的样子：
 * 泵一旦正停在 unref 上，之后进来的被引用等待（产品代码里普通的 setTimeout）就拖不住事件循环，
 * 进程在断言跑完之前自然收摊，退出码还是 0——门禁静默少跑断言还判绿。
 *
 * 只往「引用回来」这一个方向同步，不是漏掉另一半，两个方向的代价差着一个量级：
 *   · 该引用却没引用（这一步要治的）：进程可能在泵下一次醒来之前就没了，残留多久就是多久，没有上界；
 *   · 该放开却没放开（另一半）：每次泵醒来都会重装定时器（pump() 先把 pumpTimer 置空），
 *     重装时末尾那句 anyReferenced() 判定立刻会把它 unref 掉，最多多活一个泵周期
 *     （maxDelayMs，默认 5 毫秒）——有上界，自己会修好。
 * 在被 unref 的那一刻就急着 unref 泵（两方向都同步）会让「门禁自己没有存活来源」这件事提前暴露：
 * 实测拆掉 tests/verify-deck-no-hang.js 里的原生把手后，断言从 21 条掉到 0 条。那一半要等产品侧
 * 有显式存活租约（#1157）与夹具自己拥有存活之后才开，见 docs/adr/20261014-process-liveness-lease.md。
 */
function syncPumpLiveness(): void {
  if (state.pumpTimer === null) return
  if (!anyReferenced()) return
  try { state.pumpTimer.ref() } catch (e) {}
}

/**
 * 排一个真实定时器来驱动虚拟队列（泵）。
 * 真实等待 = min(到最早到期者的虚拟间隔, maxDelayMs)；卸载后的收尾阶段压成 0，尽快放完。
 * 已经排着的泵只有在「新的等待更短」时才重排——变长不用管，泵醒来会自己重算。
 */
function armPump(): void {
  if (!state.originals) return
  // 队列的每一次变化都会走到这里（排入、撤销、ref、unref、refresh、到点放行、安装与卸载），
  // 所以引用状态的同步放在这个门口：下面任何一条提前返回的路都不可能把它漏掉（#1146）。
  syncPumpLiveness()
  const next = earliestEntry()
  if (!next) {
    if (state.pumpTimer !== null) {
      try { state.originals!.clearTimeout(state.pumpTimer) } catch (e) {}
      state.pumpTimer = null
      state.pumpDelay = -1
    }
    return
  }
  const gap = Math.max(0, next.due - virtualNow())
  const delay = state.flushing ? 0 : Math.min(gap, state.maxDelayMs)
  if (state.pumpTimer !== null) {
    if (delay >= state.pumpDelay) return
    try { state.originals!.clearTimeout(state.pumpTimer) } catch (e) {}
    state.pumpTimer = null
  }
  state.pumpTimer = state.originals!.setTimeout(pump, delay)
  state.pumpDelay = delay
  if (!anyReferenced()) { try { state.pumpTimer.unref() } catch (e) {} }
}

/** 放行一个到期者：先把虚拟时钟推到它的到期时间，再按 node 的规矩跑回调（异常照样冒成未捕获异常）。 */
function pump(): void {
  state.pumpTimer = null
  state.pumpDelay = -1
  const next = earliestEntry()
  if (!next) return
  const jump = next.due - virtualNow()
  if (jump > 0) { state.offsetMs += jump; state.stats.virtualAdvancedMs += jump }
  if (next.interval !== null) {
    // 周期定时器先续上下一拍再跑回调：回调里 clearInterval 才能真的把它停掉（与 node 同）。
    next.due = next.due + next.interval
    state.stats.intervalTicks += 1
  } else {
    state.entries.delete(next.id)
  }
  state.stats.fired += 1
  armPump()
  try {
    next.fn.apply(null, next.args)
  } catch (e) {
    // 定时器回调抛错在 node 里是未捕获异常（默认让进程倒下）。这里不在泵里就地抛，
    // 否则后面的虚拟定时器再也不会被放行、进程会带着一堆挂起的等待僵在那里；改到下一个 tick 抛，语义一致。
    state.stats.callbackErrors += 1
    process.nextTick(function () { throw e })
  }
}

/** 排一个虚拟定时器。interval 为 null 是一次性的，否则是周期毫秒数。 */
function schedule(fn: unknown, ms: unknown, args: any[], interval: number | null): any {
  if (typeof fn !== 'function') return state.originals!.setTimeout(fn, ms)   // 字符串回调等怪用法交回原生
  const delay = normalizeDelay(ms)
  state.seq += 1
  const entry: TimerEntry = { id: state.seq, seq: state.seq, fn: fn, args: args, delay: delay, interval: interval, due: virtualNow() + delay, refed: true }
  state.entries.set(entry.id, entry)
  state.stats.scheduled += 1
  entry.handle = makeHandle(entry)
  armPump()
  return entry.handle
}

/** 取消一个虚拟定时器；不是本助手排的（例如安装前留下的原生句柄）返回 false，交调用方转给原生 clear。 */
function cancelEntry(handle: any): boolean {
  const entry = (handle && typeof handle === 'object') ? handle[ENTRY] : null
  if (!entry || !state.entries.has(entry.id)) return false
  state.entries.delete(entry.id)
  state.stats.cleared += 1
  armPump()
  return true
}

/** 句柄形状照 node 的 Timeout 给足：ref/unref/hasRef/refresh/close 都要能用。 */
function makeHandle(entry: TimerEntry): VirtualHandle {
  const handle: any = { [ENTRY]: entry }
  Object.defineProperties(handle, {
    ref: { value: function () { entry.refed = true; armPump(); return handle } },
    unref: { value: function () { entry.refed = false; armPump(); return handle } },
    hasRef: { value: function () { return entry.refed } },
    refresh: {
      value: function () {
        // node 的 refresh 是「按原来的延时重新计时」。
        entry.due = virtualNow() + entry.delay
        armPump()
        return handle
      },
    },
    close: { value: function () { cancelEntry(handle) } },
    [Symbol.toPrimitive]: { value: function () { return entry.id } },
  })
  return handle as VirtualHandle
}

function patchedSetTimeout(fn: any, ms?: any): any {
  return schedule(fn, ms, Array.prototype.slice.call(arguments, 2), null)
}
function patchedSetInterval(fn: any, ms?: any): any {
  const every = normalizeDelay(ms)
  return schedule(fn, ms, Array.prototype.slice.call(arguments, 2), every > 0 ? every : 1)
}
function patchedClearTimeout(handle: any): void {
  if (!cancelEntry(handle)) { try { state.originals!.clearTimeout(handle) } catch (e) {} }
}

/**
 * 造一个「无参构造读虚拟时间」的 Date。有参构造、Date() 当函数调用（返回字符串）、
 * Date.parse/UTC、instanceof、Date.prototype 全部照原样，只有「不给参数取当下」这一件事改走虚拟时间。
 */
function makeVirtualDate(OrigDate: DateConstructor): any {
  function VirtualDate() {
    const args = Array.prototype.slice.call(arguments)
    if (!new.target) return OrigDate()
    return Reflect.construct(OrigDate, args.length ? args : [virtualNow()])
  }
  Object.getOwnPropertyNames(OrigDate).forEach(function (k) {
    if (k === 'prototype' || k === 'length' || k === 'name' || k === 'now') return
    try { Object.defineProperty(VirtualDate, k, Object.getOwnPropertyDescriptor(OrigDate, k)) } catch (e) {}
  })
  VirtualDate.prototype = OrigDate.prototype
  Object.defineProperty(VirtualDate, 'now', { value: function () { return virtualNow() }, writable: true, configurable: true })
  return VirtualDate
}

/** 换掉一整套全局时钟；同一进程重复调用是幂等的（不重复包装）。 */
function installTimeCompression(opts?: InstallOptions): PublicHandle {
  const o: InstallOptions = opts || {}
  if (state.installed) {
    state.stats.installRepeats += 1
    return publicHandle()
  }
  const g = globalThis
  const desc = function (name: string) { return Object.getOwnPropertyDescriptor(g, name) || null }
  state.originals = {
    setTimeout: g.setTimeout,
    clearTimeout: g.clearTimeout,
    setInterval: g.setInterval,
    clearInterval: g.clearInterval,
    dateNow: Date.now,
    globals: {
      setTimeout: desc('setTimeout'), clearTimeout: desc('clearTimeout'),
      setInterval: desc('setInterval'), clearInterval: desc('clearInterval'), Date: desc('Date'),
    },
  }
  if (typeof o.maxDelayMs === 'number' && isFinite(o.maxDelayMs) && o.maxDelayMs >= 0) state.maxDelayMs = Math.floor(o.maxDelayMs)
  state.installed = true
  state.flushing = false
  state.stats.installs += 1
  g.setTimeout = patchedSetTimeout
  g.clearTimeout = patchedClearTimeout
  g.setInterval = patchedSetInterval
  g.clearInterval = patchedClearTimeout
  try { g.Date = makeVirtualDate(Date) } catch (e) {}
  // performance.now 在原型上，实例可扩展：用同名自有属性盖住，卸载时删掉就还原。
  try {
    const perf = g.performance
    if (perf && typeof perf.now === 'function') {
      Object.defineProperty(perf, 'now', { value: function () { return virtualNow() }, writable: true, configurable: true })
    }
  } catch (e) {}
  armPump()
  return publicHandle()
}

/**
 * 还原全局时钟。还挂着的虚拟定时器不丢：改成 0 延时的真实定时器尽快放完
 * （它们的回调都已经按压缩后的时间点该跑了），这样同一个进程里接下来的门禁既看不到虚拟时钟，
 * 也不会被上一扇门禁留下的等待拖住。
 */
function uninstallTimeCompression(): boolean {
  if (!state.installed) return false
  const g = globalThis
  const orig = state.originals as OriginalClock
  const put = function (name) {
    const d = orig.globals[name]
    if (d) { try { Object.defineProperty(g, name, d) } catch (e) {} } else { try { delete g[name] } catch (e) {} }
  }
  put('setTimeout'); put('clearTimeout'); put('setInterval'); put('clearInterval'); put('Date')
  try {
    const perf = g.performance
    if (perf && Object.prototype.hasOwnProperty.call(perf, 'now')) delete perf.now
  } catch (e) {}
  state.installed = false
  state.flushing = true
  state.stats.uninstalls += 1
  state.stats.pendingAtUninstall = state.entries.size
  armPump()
  return true
}

/** 装在手上的那份句柄：统计是活的对象，随时读得到这次压缩干了多少活。 */
function publicHandle(): PublicHandle {
  return {
    maxDelayMs: state.maxDelayMs,
    stats: state.stats,
    isInstalled: function () { return state.installed },
    uninstall: uninstallTimeCompression,
  }
}

module.exports = { installTimeCompression, uninstallTimeCompression }
