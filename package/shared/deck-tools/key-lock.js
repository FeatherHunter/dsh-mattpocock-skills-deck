// src/shared/deck-tools/key-lock.js —— 同票写的单键互斥（并发隔离）
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
// 住共享层、零导入（同层禁互引，自带最小工具）。日志不新增：锁等待是执行细节，
// 成败已经体现在工具回执的逐项里。
function repoIdOf(repo) {
  const r = repo || {}
  const id = (typeof r.refId === 'string' && r.refId) ? r.refId : ((typeof r.backend === 'string') ? r.backend : '')
  const ef = (typeof r.effortId === 'string') ? r.effortId : ''
  return id + (ef ? '#' + ef : '')
}

/** 默认等待上限（毫秒）：持锁序列本身被预算壳钳住（整笔 120 秒），60 秒等不到就诚实回。 */
export const DEFAULT_KEY_LOCK_TIMEOUT_MS = 60000

// 键 → 队尾（前一个持有者的放行 promise；空时删键不留垃圾）。
const tails = new Map()
let waiters = 0

/**
 * 绕同一票号的写序列包一层互斥。repo/key 只用来拼键，不读内容。
 * fn 持锁执行（同一键同时只跑一个 fn）；不同键全并行。
 * opts.timeoutMs 缺席 60 秒：等不到就回 { ok:false, timedOut:true }，不抛、不进 fn。
 * fn 的返回值原样交回；fn 抛错原样抛给调用方（调用方按既有形状收成失败项）；锁一定放行。
 * 持锁的 fn 必须自己有界（预算壳的钳制加取消信号）：锁不杀持有者，只拦等待者；
 * 后端必须响应取消信号（契约本就要求），否则持有者卡住时同键等待者只会逐个超时。
 */
export async function withKeyLock(repo, key, fn, opts) {
  const o = opts || {}
  const ms = (typeof o.timeoutMs === 'number' && o.timeoutMs > 0) ? Math.floor(o.timeoutMs) : DEFAULT_KEY_LOCK_TIMEOUT_MS
  const lockKey = repoIdOf(repo) + '|' + String(key)
  let release = null
  const myTurn = new Promise(function (resolve) { release = function () { try { resolve() } catch (e) {} } })
  const prev = tails.get(lockKey) || Promise.resolve()
  const myTail = prev.then(function () { return myTurn })
  tails.set(lockKey, myTail)
  waiters += 1
  let won = false
  await Promise.race([
    prev.then(function () { won = true }),
    new Promise(function (resolve) { setTimeout(resolve, ms) }),
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
export function keyLockSnapshot() {
  try { return { keys: tails.size, waiters: waiters } } catch (e) { return { keys: 0, waiters: 0 } }
}
