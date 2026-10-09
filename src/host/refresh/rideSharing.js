/**
 * refresh/rideSharing.js — 同钥匙搭车（#964 · T2b）。
 *
 * 钥匙 = 工作区键 + 后端 + 语言（调用方拼好传进来，本文件不认路，只认字符串相等）。
 * 规则（#962 定版）：
 *   ① 旧的没回新的不起，只等旧的 —— 同钥匙并发共用同一份在飞求值；
 *   ② 写后不搭 —— 在飞那轮开始之后写世代变了，新的自己跑一轮 fresh；
 *   ③ 失败不搭 —— 失败的那份不留给后人（完成即删，后来的自然跑 fresh；同轮搭上的共享这一次结论，不多记一次失败）；
 *   ④ 超 30 秒不搭 —— 在飞超过 30 秒还没回，新的不等它，自己跑（免得陪着卡死）；
 *   ⑤ 短窗连点合并 —— 在飞期间又来一次 force，跑完再补一轮（只补一轮，不起 N 轮）；非 force 的连点只等这一轮，不新起进程；
 *   ⑥ 不同钥匙各跑各的，后台的不抢人的（钥匙不同即两条独立记录）。
 *
 * 本文件只管“等不等、补不补”的记账，不管求值本身：求值函数由调用方传进来。
 * 用法见 tests/verify-964-riding.js。
 */

export const MAX_RIDE_AGE_MS = 30000

export function createRideSharing(opts) {
  const o = opts || {}
  const now = typeof o.now === 'function' ? o.now : Date.now
  const maxAgeMs = (typeof o.maxRideAgeMs === 'number' && o.maxRideAgeMs > 0) ? o.maxRideAgeMs : MAX_RIDE_AGE_MS
  const getGen = typeof o.getGeneration === 'function' ? o.getGeneration : function () { return 0 }
  const table = new Map()

  function get(key) { return table.get(String(key)) || null }

  /**
   * 问一句能不能搭。能搭返回在飞记录（调用方等它的 promise），不能搭返回 null（调用方自己跑）。
   * 问的同时登记：riders 加一；force 到来记 followUp（跑完补一轮）。
   */
  function tryRide(key, rideOpts) {
    const r = rideOpts || {}
    const ex = get(key)
    if (!ex) return null
    if (now() - ex.startAt >= maxAgeMs) return null
    if (getGen() !== ex.startGen) return null
    ex.riders += 1
    if (r.force === true) { ex.followUp = true; ex.followUpArgs = r.args }
    return ex
  }

  /** 登记一轮新的在飞求值（调用方保证同钥匙没有在飞才调）。 */
  function start(key, promise, startOpts) {
    const s = startOpts || {}
    const ex = {
      key: String(key),
      promise: promise,
      startAt: now(),
      startGen: (typeof s.generation === 'number') ? s.generation : getGen(),
      riders: 0,
      followUp: false,
      followUpArgs: null,
      second: null,
    }
    table.set(ex.key, ex)
    return ex
  }

  /** 一轮结束：成功失败都删（失败不留，后来的跑 fresh）。 */
  function finish(key) { table.delete(String(key)) }

  function stats() {
    let riders = 0
    let followUps = 0
    table.forEach(function (ex) { riders += ex.riders; if (ex.followUp) followUps += 1 })
    return { inflight: table.size, riders: riders, followUps: followUps }
  }

  return { tryRide: tryRide, start: start, finish: finish, get: get, stats: stats, maxAgeMs: maxAgeMs }
}

export default createRideSharing
