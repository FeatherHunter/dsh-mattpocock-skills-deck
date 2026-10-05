// views/versionControl/vcCache.js —— 进出缓存：按工作区暂存首屏一份（#864）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。只存首屏与历史首批：差异补丁按需另读，各自的三态与代际号不受影响。
// 上限 10 个工作区，超出丢最早写入的；淘汰认首次写入顺序，不是 LRU（与既有双缓存同一条注释口径）。
// 日志点（新增内存缓存必记）：命中、未命中、淘汰各一行按需 vc.cache.screen，只在调试开关打开时记；
//   工作区只记短散列，不记原文；调用很频繁，进页签一次记一行也在按需的可接受范围。
export const VC_SCREEN_CACHE_MAX = 10
const vcScreenCache = new Map()
const vcCacheLog = function (outcome, cwd, ageMs) { try { if (typeof isEnabled === 'function' && isEnabled('debug')) log('debug', 'vc.cache.screen', { cwdHash: String(dswsLogHash(String(cwd || ''))).slice(0, 8), outcome: outcome, ageMs: ageMs }) } catch (e) { /* 日志坏了不影响读数 */ } }
/** 进页签时的种子：命中就回一份可直接画的读数，未命中回 null（调用方回落到 vcNewReads）。 */
export const vcCacheSeedOf = function (cwd) {
  const key = String(cwd || '')
  if (!key) return null
  const hit = vcScreenCache.get(key)
  if (!hit || !hit.screen) { vcCacheLog('miss', key, -1); return null }
  vcCacheLog('hit', key, Date.now() - hit.savedAt)
  const seed = vcNewReads()
  seed.screen = { state: 'ok', data: hit.screen, error: null }
  seed.log = { state: 'ok', commits: hit.logCommits.slice(), hasMore: hit.logHasMore === true, fetched: hit.logCommits.length, error: null }
  return seed
}
/** 首屏回包落地后暂存：只认 state=ok 的 screen；历史只认读到过一批的（读数里 fetched>0），否则沿用旧的那批。 */
export const vcCacheSave = function (cwd, reads) {
  const key = String(cwd || '')
  if (!key) return
  const data = reads && reads.screen && reads.screen.data ? reads.screen.data : null
  if (!data || reads.screen.state !== 'ok') return
  if (!vcScreenCache.has(key) && vcScreenCache.size >= VC_SCREEN_CACHE_MAX) {
    const oldest = vcScreenCache.keys().next().value
    vcScreenCache.delete(oldest)
    vcCacheLog('evict', oldest, -1)
  }
  const prev = vcScreenCache.get(key)
  const log = reads.log || {}
  const fresh = log.state === 'ok' && (Number(log.fetched) || 0) > 0 && Array.isArray(log.commits)
  vcScreenCache.set(key, {
    screen: data,
    logCommits: fresh ? log.commits.slice(0, VC_LOG_BATCH) : (prev ? prev.logCommits : []),
    logHasMore: fresh ? log.hasMore === true : (prev ? prev.logHasMore === true : false),
    savedAt: Date.now(),
  })
}
