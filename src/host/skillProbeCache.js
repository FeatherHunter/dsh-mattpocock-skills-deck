/**
 * host/skillProbeCache.js — 技能探测按需缓存（#968 · T4）。
 *
 * 规则（#962 定版）：查到的（判已安装）短时缓存 10 秒；查不到（缺失/名片无效）与
 * 没查出来（服务不可用/pending）不存 —— 刚装好技能后重查立即可见，不会被旧的“没有”骗。
 * 并发同键（名 + 语言 + 工作区）复用同一份在飞探测，防惊群。
 * 失效广播按工作区分桶清（invalidateWorkspace）：只删那一个工作区的条目；
 * 广播没带工作区时不动（靠 10 秒 TTL 自愈），绝不清整个检测缓存。
 *
 * 纯内存：不读盘、不联网、不起定时器（过期按读取时比对时间戳懒淘汰）。
 */
export const SKILL_PROBE_CACHE_MS = 10000

export function createSkillProbeCache(opts) {
  const o = opts || {}
  const now = typeof o.now === 'function' ? o.now : Date.now
  const ttlMs = (typeof o.ttlMs === 'number' && o.ttlMs > 0) ? o.ttlMs : SKILL_PROBE_CACHE_MS
  const entries = new Map()
  const inflight = new Map()
  let hits = 0
  let coalesced = 0

  function keyOf(name, lang, cwd) {
    return String(name || '') + '|' + String(lang || '') + '|' + String(cwd || '')
  }

  function isOkResult(res) { return !!(res && (res.ok === true || res.level === 'ok')) }

  function get(name, lang, cwd) {
    const k = keyOf(name, lang, cwd)
    const e = entries.get(k)
    if (!e) return null
    if (now() - e.at >= ttlMs) { entries.delete(k); return null }
    hits += 1
    return e.value
  }

  async function run(name, lang, cwd, probe) {
    const k = keyOf(name, lang, cwd)
    const ongoing = inflight.get(k)
    if (ongoing) { coalesced += 1; return ongoing }
    const p = Promise.resolve().then(probe).then(function (res) {
      inflight.delete(k)
      if (isOkResult(res)) entries.set(k, { value: res, at: now() })
      return res
    }, function (e) { inflight.delete(k); throw e })
    inflight.set(k, p)
    return p
  }

  function invalidateWorkspace(cwd) {
    const target = String(cwd == null ? '' : cwd)
    if (!target) return 0
    const suffix = '|' + target
    let n = 0
    entries.forEach(function (_v, k) { if (String(k).endsWith(suffix)) { entries.delete(k); n += 1 } })
    return n
  }

  function stats() { return { size: entries.size, inflight: inflight.size, hits: hits, coalesced: coalesced } }

  return { get: get, run: run, invalidateWorkspace: invalidateWorkspace, stats: stats, ttlMs: ttlMs }
}

export default createSkillProbeCache
