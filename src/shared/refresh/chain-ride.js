// src/shared/refresh/chain-ride.js —— 同钥匙搭车的小账本（票 #964）
// 以后谁改它：改检查链并发合并规则的人。
// 只做一件事：记住每一把钥匙上正在跑的那一轮是谁，
// 新来的那一次该搭车还是该另起一轮，由这里说了算。
// 钥匙就是调用方拼好的那一串（工作区键加后端加语言加修订号），
// 这里不拆它，只认它是不是同一串。
// 三条不搭的规矩：
//   写过东西之后不搭——有人写过东西（调用 markWrite 记的那一刻）
//   落在旧车开跑之后，新来的就另起一轮；
//   旧车失败了不拿旧失败当结果——旧车跑完就从表里撤掉，
//   下一次来自然另起一轮（并发等在旧车上的那几位拿到同一份结果，
//   只记合并数，不多记一次退避）；
//   旧车跑了超过三十秒不搭——等太久说明旧车可能卡住了，
//   新来的另起一轮，不无限等下去。
// 被合并掉的那几次只记合并数，不算失败，也不碰退避。
// 这里不记日志、不碰退避、不起定时器：日志只有调用方搭上车时记原来那一行，
// 事件名不新增，附录第 1 章的条数不动。
export const CHAIN_RIDE_MAX_AGE_MS = 30000
export function createChainRide(opts) {
  const clock = (opts && typeof opts.nowMs === 'function') ? opts.nowMs : ((opts && typeof opts.now === 'function') ? opts.now : Date.now)
  const nowMs = () => { try { return Number(clock()) || Date.now() } catch (e) { return Date.now() } }
  const runningByKey = new Map()
  let lastWriteAtMs = 0
  let mergedN = 0
  function take(key) {
    const ride = runningByKey.get(String(key))
    if (!ride) return null
    if (nowMs() - ride.startedAtMs > CHAIN_RIDE_MAX_AGE_MS) return null
    if (lastWriteAtMs > ride.startedAtMs) return null
    return ride.promise
  }
  function noteRide() { mergedN += 1 }
  function park(key, promise) {
    const entry = { promise, startedAtMs: nowMs() }
    runningByKey.set(String(key), entry)
    return entry
  }
  function leave(key, entry) { try { if (runningByKey.get(String(key)) === entry) runningByKey.delete(String(key)) } catch (e) {} }
  function markWrite() { lastWriteAtMs = nowMs() }
  function stats() { return { merged: mergedN, inflight: runningByKey.size } }
  return { take, noteRide, park, leave, markWrite, stats, nowMs }
}

// 进程内共用的一本账（#966 收口）：探测链用它登记在飞，出站写路用它记写，写后不搭在生产里才成立。
// 注钟就建新账（测试用假钟推进三十秒，不与生产单例串味）；不注钟才用单例。
let sharedRide = null
export function getChainRide(opts) {
  const o = opts || {}
  const clock = (typeof o.nowMs === 'function') ? o.nowMs : ((typeof o.now === 'function') ? o.now : null)
  if (clock) return createChainRide({ now: clock })
  if (!sharedRide) sharedRide = createChainRide()
  return sharedRide
}
