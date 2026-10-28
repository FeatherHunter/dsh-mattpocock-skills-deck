// src/refresh/rooms/host/chain-coalescing.ts —— 同钥匙搭车的小账本（票 #964）
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
// #1474 起每趟车记着自己是谁发起的（kind）：人手点「重新检查」是 force，挂载、自动复查、
//   动作后补算是 background。后台请求搭任何车；人手强制请求只搭别的强制车，撞上后台车时
//   由调用方等它收尾再自己算 —— 账本只报「这趟车是谁的」，不做等待。
// 这里不记日志、不碰退避、不起定时器：日志只有调用方搭上车时记原来那一行，
// 事件名不新增，附录第 1 章的条数不动。
// 搭车上限住中央 YAML（config/ttl.yaml 的 chainRideMaxAgeMs 键）：这里直接读它生成出来的值，
// 不留别名、不留回落，调时间改 YAML。
import { CHAIN_RIDE_MAX_AGE_MS } from '../../../shared/time-config/src/values.js'
export { CHAIN_RIDE_MAX_AGE_MS }
/** 注钟形状：生产不注（用 Date.now），测试注假钟（有 nowMs 用 nowMs，否则用 now）。 */
export interface ChainRideClock {
  nowMs?: () => number
  now?: () => number
}
export function createChainRide(opts?: ChainRideClock | null) {
  const clock = (opts && typeof opts.nowMs === 'function') ? opts.nowMs : ((opts && typeof opts.now === 'function') ? opts.now : Date.now)
  const nowMs = () => { try { return Number(clock()) || Date.now() } catch (e) { return Date.now() } }
  const runningByKey = new Map<string, { promise: unknown; startedAtMs: number; kind: string }>()
  let lastWriteAtMs = 0
  let mergedN = 0
  function take(key: unknown) {
    const ride = runningByKey.get(String(key))
    if (!ride) return null
    if (nowMs() - ride.startedAtMs > CHAIN_RIDE_MAX_AGE_MS) return null
    if (lastWriteAtMs > ride.startedAtMs) return null
    return ride
  }
  function noteRide() { mergedN += 1 }
  function park(key: unknown, promise: unknown, kind?: unknown) {
    const entry = { promise: promise, startedAtMs: nowMs(), kind: kind === 'force' ? 'force' : 'background' }
    runningByKey.set(String(key), entry)
    return entry
  }
  function leave(key: unknown, entry: unknown) { try { if (runningByKey.get(String(key)) === entry) runningByKey.delete(String(key)) } catch (e) {} }
  function markWrite() { lastWriteAtMs = nowMs() }
  function stats() { return { merged: mergedN, inflight: runningByKey.size } }
  return { take, noteRide, park, leave, markWrite, stats, nowMs }
}

// 进程内共用的一本账（#966 收口）：探测链用它登记在飞，出站写路用它记写，写后不搭在生产里才成立。
// 注钟就建新账（测试用假钟推进三十秒，不与生产单例串味）；不注钟才用单例。
let sharedRide: ReturnType<typeof createChainRide> | null = null
export function getChainRide(opts?: ChainRideClock | null) {
  const o = opts || {}
  const clock = (typeof o.nowMs === 'function') ? o.nowMs : ((typeof o.now === 'function') ? o.now : null)
  if (clock) return createChainRide({ now: clock })
  if (!sharedRide) sharedRide = createChainRide()
  return sharedRide
}
