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
// 住共享层（src/deck/shell/）：本树内部只有一处导入——等待竞速 capped-wait.ts（#1114 第二批；
// 它内部再扣一份进程存活租约 #1157——等锁这段算一场还没结算的活）。
// 日志不新增：锁等待是执行细节，成败已经体现在工具回执的逐项里。
//
// 时钟：等待口走注入的 sleep（测试拿假时钟就能把「等不到」那条路走通，不必真等 60 秒）；
// 缺省由 capped-wait 用 unref 过的真定时器，生产行为与「now 缺省 Date.now」同款，一字不变。

import { withCap } from './capped-wait.js'
// 默认等待上限住中央 YAML（config/timeouts.yaml 的 keyLockMs 键）：这里只留别名，
// 调时间改 YAML。值由 tests/verify-time-config.ts 看守一致。
import { KEY_LOCK_TIMEOUT_MS } from '../../shared/time-config/src/values.js'

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

/** 默认等待上限（毫秒）：持锁序列本身被预算壳钳住（整笔默认 5 分钟，见 register-options.ts），60 秒等不到就诚实回。
 * 真源是中央 YAML（config/timeouts.yaml 的 keyLockMs 键），这里是别名，数值仍冻在 60 秒（#1030 Q4）。 */
export const DEFAULT_KEY_LOCK_TIMEOUT_MS = KEY_LOCK_TIMEOUT_MS

// 键 → 队尾（前一个持有者的放行 promise；空时删键不留垃圾）。
const tails = new Map<string, Promise<unknown>>()
let waiters = 0

// 缺省等待口搬去了 ./capped-wait.js（#1114 第二批）：到点或被喊停都清定时器、定时器 unref；
// 整场竞速还扣一份进程存活租约（#1157）。本文件不再自己碰全局时钟。

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
  const sleep = (typeof o.sleep === 'function') ? o.sleep : undefined
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
  // 等锁这段是一笔还没结算的活：withCap 内部先扣一份存活租约（#1157）——等待口 unref 过，
  // 前一笔写序列挂住时唯一活着的东西就是这笔等待，没有租约进程会带着这场等待收摊，锁永远不放行。
  // #1114 第二批：等待定时器由 capped-wait 在「等到 / 超时 / 等待口抛错」三条路都清掉。
  const waited = await withCap(prev.then(function () { won = true }), ms, sleep)
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
