// src/deck/shell/write-mutex.ts —— 同票写的单键互斥（并发隔离；#1040 转 TypeScript）
//
// 为什么有这个文件：读调用之间天然独立（每笔有自己的预算壳与记忆），但同票并发写里
// 有读改写序列（改标签先读回再整批替换、改进度先读旧正文再回写、补边先预检再写），
// 两笔同时进会丢一次改动。锁只 serial 化“同一仓库同一票号”的写序列，不同票、不同仓
// 照旧全并行；读从不拿锁。
//
// 防死锁只有一条纪律：任何时刻只许持有一把锁（本文件 API 一次只收一个键，不提供
// 多键原子操作，调用方也不许嵌套）。单锁加 FIFO 排队不可能死锁；排队只等，不抛。
// 等待上限到时不等了，诚实回超时（调用方按既有失败形状记一笔，不静默）。
//
// 住共享层（src/deck/shell/）、零导入（同层禁互引，自带最小工具）。
// 日志不新增：锁等待是执行细节，成败已经体现在工具回执的逐项里。
//
// 时钟：等待口走注入的 sleep（缺省真定时器）：测试拿假时钟就能把「等不到」那条路走通，
// 不必真等 60 秒；与「now 缺省 Date.now」同款，生产行为一字不变。

/** 外层递进来的仓库标识只用来拼锁键，形状不固定，逐格验，不猜。 */
type UnknownRecord = Record<string, unknown>;

/** 进出锁的选项：两个都可缺席。 */
export interface KeyLockOpts {
  /** 等待上限（毫秒）：缺席 60 秒；非数字或不大于零一律按缺席处理。 */
  timeoutMs?: number;
  /** 等待口：等多少毫秒；缺省真定时器。它抛错也按「等到超时」处理，见下面的纪律。 */
  sleep?: (ms: number) => Promise<unknown>;
}

/** 等不到锁时的回执：不抛、也不进 fn，调用方按既有失败形状收成失败项。 */
export interface KeyLockTimeout {
  ok: false;
  timedOut: true;
}

/** 从仓库标识拼出锁键的前半段：同一后端同一目录（effortId）才算同一个仓库。 */
function repoIdOf(repo: unknown): string {
  const r = (repo || {}) as UnknownRecord
  const id = (typeof r.refId === 'string' && r.refId) ? r.refId : ((typeof r.backend === 'string') ? r.backend : '')
  const ef = (typeof r.effortId === 'string') ? r.effortId : ''
  return id + (ef ? '#' + ef : '')
}

/** 默认等待上限（毫秒）：持锁序列本身被预算壳钳住（整笔默认 5 分钟，见 register-options.ts），60 秒等不到就诚实回。 */
export const DEFAULT_KEY_LOCK_TIMEOUT_MS = 60000

// 键 → 队尾（前一个持有者的放行 promise；空时删键不留垃圾）。
const tails = new Map<string, Promise<unknown>>()
let waiters = 0

// 缺省等待口：真定时器。两条纪律（#1114 的实测教训）：到点或被喊停都要清掉定时器；
// 定时器一律 unref——一个只负责「到点提醒」的定时器不该成为进程活下去的理由，
// 真还有活干时，干活的那条路自己会把进程留住。只有这里碰全局时钟，注入 sleep 之后就绕开了它。
function realSleep(ms: number): Promise<unknown> {
  return new Promise(function (resolve) {
    let timer: ReturnType<typeof setTimeout> | null = null
    let done = false
    const finish = function (): void {
      if (done) return
      done = true
      if (timer !== null) { try { clearTimeout(timer) } catch (e) {} timer = null }
      resolve(null)
    }
    try {
      timer = setTimeout(finish, ms)
      const t = timer as unknown as { unref?: () => void }
      if (t && typeof t.unref === 'function') { try { t.unref() } catch (e) {} }
    } catch (e) { finish() }
  })
}

/**
 * 绕同一票号的写序列包一层互斥。repo/key 只用来拼键，不读内容。
 * fn 持锁执行（同一键同时只跑一个 fn）；不同键全并行。
 * opts.timeoutMs 缺席 60 秒：等不到就回 { ok:false, timedOut:true }，不抛、不进 fn。
 * opts.sleep 是等待口（缺省真定时器）；它抛错也按「等到超时」处理——放行后继、不断链，
 * 与「等不到就诚实回超时」同一条纪律，排队只等不抛。
 * fn 的返回值原样交回；fn 抛错原样抛给调用方（调用方按既有形状收成失败项）；锁一定放行。
 * 持锁的 fn 必须自己有界（预算壳的钳制加取消信号）：锁不杀持有者，只拦等待者；
 * 后端必须响应取消信号（契约本就要求），否则持有者卡住时同键等待者只会逐个超时。
 */
export async function withKeyLock<T>(repo: unknown, key: unknown, fn: () => T | Promise<T>, opts?: KeyLockOpts): Promise<T | KeyLockTimeout> {
  const o = opts || {}
  const ms = (typeof o.timeoutMs === 'number' && o.timeoutMs > 0) ? Math.floor(o.timeoutMs) : DEFAULT_KEY_LOCK_TIMEOUT_MS
  const sleep = (typeof o.sleep === 'function') ? o.sleep : realSleep
  const lockKey = repoIdOf(repo) + '|' + String(key)
  // 先装一个空放行，真放行在下面 Promise 里覆盖它：这样「放行」这个动作永远是函数，
  // 任何一条分支（超时、抛错、正常收尾）都能安全调它，不会出现「还没装上就调用」。
  let release: () => void = function () { /* 真放行在下面装上 */ }
  const myTurn = new Promise<void>(function (resolve) { release = function () { try { resolve() } catch (e) {} } })
  const prev = tails.get(lockKey) || Promise.resolve()
  const myTail = prev.then(function () { return myTurn })
  tails.set(lockKey, myTail)
  waiters += 1
  let won = false
  await Promise.race([
    prev.then(function () { won = true }),
    Promise.resolve(sleep(ms)).then(function () {}, function () {}),
  ])
  waiters -= 1
  if (!won) {
    // 超时不等了：放行后继（不断链），诚实回超时。
    try { release() } catch (e) {}
    if (tails.get(lockKey) === myTail) tails.delete(lockKey)
    return { ok: false, timedOut: true }
  }
  try {
    return await fn()
  } finally {
    try { release() } catch (e) {}
    if (tails.get(lockKey) === myTail) tails.delete(lockKey)
  }
}

/** 锁表现状（探针与单测用）：只报键数与等待数，不报键名（路径不出内存）。 */
export function keyLockSnapshot(): { keys: number; waiters: number } {
  try { return { keys: tails.size, waiters: waiters } } catch (e) { return { keys: 0, waiters: 0 } }
}
