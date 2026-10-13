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
// 为什么是 .js：tests/** 是 node 直接拉起来跑的检查脚本，不走构建，按仓库约定「自动检查本身不转 TypeScript」。
//
// 用法：
//   const { installTimeCompression, uninstallTimeCompression } = require('./lib/time-compress.js')
//   installTimeCompression()      // 放在加载产品代码之前
//   ...跑断言...
//   uninstallTimeCompression()    // 同一个进程里后面还要跑别的门禁，就必须还原
// 本文件不打印任何东西；要核对这次压缩干了多少活，读 installTimeCompression() 返回的那份统计。

/** 默认真实等待上限（毫秒）：虚拟要等多久都行，真实只等这么久。 */
const DEFAULT_MAX_DELAY_MS = 5

/** 挂在定时器句柄上的标记，clearTimeout/clearInterval 靠它认出「这一次排的是虚拟定时器」。 */
const ENTRY = Symbol.for('dsh.timeCompress.entry')

/** 全局唯一的压缩状态：同一进程重复安装不重复包装，卸载后仍留着待触发的虚拟定时器。 */
const state = {
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
function realNow() { return state.originals.dateNow() }
/** 虚拟时间：真实时间加上「已经等掉的虚拟时长」。只增不减。 */
function virtualNow() { return realNow() + state.offsetMs }

/** 延时规整：非数字、负数、NaN 一律当 0（与 node 对非法延时的宽容方向一致）。 */
function normalizeDelay(ms) {
  const n = (typeof ms === 'number' && isFinite(ms)) ? ms : 0
  return n > 0 ? n : 0
}

/** 当前最早到期的那个虚拟定时器：先比到期时间，同时到期的按排号（先排先跑，与 node 同）。 */
function earliestEntry() {
  let best = null
  state.entries.forEach(function (e) {
    if (best === null || e.due < best.due || (e.due === best.due && e.seq < best.seq)) best = e
  })
  return best
}

/** 还有没有「被引用着」的虚拟定时器：一个都没有时，泵不该拖着事件循环不让退出。 */
function anyReferenced() {
  let any = false
  state.entries.forEach(function (e) { if (e.refed) any = true })
  return any
}

/**
 * 排一个真实定时器来驱动虚拟队列（泵）。
 * 真实等待 = min(到最早到期者的虚拟间隔, maxDelayMs)；卸载后的收尾阶段压成 0，尽快放完。
 * 已经排着的泵只有在「新的等待更短」时才重排——变长不用管，泵醒来会自己重算。
 */
function armPump() {
  if (!state.originals) return
  const next = earliestEntry()
  if (!next) {
    if (state.pumpTimer !== null) {
      try { state.originals.clearTimeout(state.pumpTimer) } catch (e) {}
      state.pumpTimer = null
      state.pumpDelay = -1
    }
    return
  }
  const gap = Math.max(0, next.due - virtualNow())
  const delay = state.flushing ? 0 : Math.min(gap, state.maxDelayMs)
  if (state.pumpTimer !== null) {
    if (delay >= state.pumpDelay) return
    try { state.originals.clearTimeout(state.pumpTimer) } catch (e) {}
    state.pumpTimer = null
  }
  state.pumpTimer = state.originals.setTimeout(pump, delay)
  state.pumpDelay = delay
  if (!anyReferenced()) { try { state.pumpTimer.unref() } catch (e) {} }
}

/** 放行一个到期者：先把虚拟时钟推到它的到期时间，再按 node 的规矩跑回调（异常照样冒成未捕获异常）。 */
function pump() {
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
function schedule(fn, ms, args, interval) {
  if (typeof fn !== 'function') return state.originals.setTimeout(fn, ms)   // 字符串回调等怪用法交回原生
  const delay = normalizeDelay(ms)
  state.seq += 1
  const entry = { id: state.seq, seq: state.seq, fn: fn, args: args, delay: delay, interval: interval, due: virtualNow() + delay, refed: true }
  state.entries.set(entry.id, entry)
  state.stats.scheduled += 1
  entry.handle = makeHandle(entry)
  armPump()
  return entry.handle
}

/** 取消一个虚拟定时器；不是本助手排的（例如安装前留下的原生句柄）返回 false，交调用方转给原生 clear。 */
function cancelEntry(handle) {
  const entry = (handle && typeof handle === 'object') ? handle[ENTRY] : null
  if (!entry || !state.entries.has(entry.id)) return false
  state.entries.delete(entry.id)
  state.stats.cleared += 1
  armPump()
  return true
}

/** 句柄形状照 node 的 Timeout 给足：ref/unref/hasRef/refresh/close 都要能用。 */
function makeHandle(entry) {
  const handle = { [ENTRY]: entry }
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
  return handle
}

function patchedSetTimeout(fn, ms) {
  return schedule(fn, ms, Array.prototype.slice.call(arguments, 2), null)
}
function patchedSetInterval(fn, ms) {
  const every = normalizeDelay(ms)
  return schedule(fn, ms, Array.prototype.slice.call(arguments, 2), every > 0 ? every : 1)
}
function patchedClearTimeout(handle) {
  if (!cancelEntry(handle)) { try { state.originals.clearTimeout(handle) } catch (e) {} }
}

/**
 * 造一个「无参构造读虚拟时间」的 Date。有参构造、Date() 当函数调用（返回字符串）、
 * Date.parse/UTC、instanceof、Date.prototype 全部照原样，只有「不给参数取当下」这一件事改走虚拟时间。
 */
function makeVirtualDate(OrigDate) {
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
function installTimeCompression(opts) {
  const o = opts || {}
  if (state.installed) {
    state.stats.installRepeats += 1
    return publicHandle()
  }
  const g = globalThis
  const desc = function (name) { return Object.getOwnPropertyDescriptor(g, name) || null }
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
function uninstallTimeCompression() {
  if (!state.installed) return false
  const g = globalThis
  const orig = state.originals
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
function publicHandle() {
  return {
    maxDelayMs: state.maxDelayMs,
    stats: state.stats,
    isInstalled: function () { return state.installed },
    uninstall: uninstallTimeCompression,
  }
}

module.exports = { installTimeCompression, uninstallTimeCompression }
