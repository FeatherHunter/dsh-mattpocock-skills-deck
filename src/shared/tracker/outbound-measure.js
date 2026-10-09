/**
 * shared/gh-measure.js — 出站测量记分板（#967 · T1 · 只读数，不改行为）。
 *
 * 维护者视角要的三组数（#962：耗时分布、同时在飞分布、force 来源排行、复用数），
 * 由三个出站路在起完进程后各记一笔（ok / fail / cancelled / timeout 四种结局都记），
 * 由探测链记 force 来源，由预检复用位记 asked/reused。
 * 本文件只做内存计数与分布成桶，不读盘、不联网、不起定时器、不拦任何调用。
 *
 * 时延桶（毫秒）：<1s / 1–3s / 3–8s / 8–12s / 12–30s / ≥30s或超时。
 * 读桶写桶的终值（#966 回填）就看“大部分请求落在哪一档、峰值同时在飞是多少”。
 */

export const LATENCY_BUCKET_EDGES = [1000, 3000, 8000, 12000, 30000]

export function latencyBucketOf(latencyMs) {
  const n = Number(latencyMs)
  if (!isFinite(n) || n < 0) return 'unknown'
  for (let i = 0; i < LATENCY_BUCKET_EDGES.length; i++) {
    if (n < LATENCY_BUCKET_EDGES[i]) return i === 0 ? '<1s' : (String(LATENCY_BUCKET_EDGES[i - 1] / 1000) + '-' + String(LATENCY_BUCKET_EDGES[i] / 1000) + 's')
  }
  return '>=30s'
}

export function createMeasure() {
  const latency = { '<1s': 0, '1-3s': 0, '3-8s': 0, '8-12s': 0, '12-30s': 0, '>=30s': 0, unknown: 0 }
  const byTier = { read: 0, write: 0, probe: 0 }
  const byOutcome = { ok: 0, fail: 0, cancelled: 0, timeout: 0 }
  const byVia = new Map()
  const forceBySource = new Map()
  let timeouts = 0
  let preflightAsked = 0
  let preflightReused = 0
  let samples = 0

  function record(ev) {
    const e = ev || {}
    samples += 1
    const b = latencyBucketOf(e.latencyMs)
    latency[b] = (latency[b] || 0) + 1
    const tier = (e.tier === 'write' || e.tier === 'probe') ? e.tier : 'read'
    byTier[tier] += 1
    const oc = (e.outcome === 'ok' || e.outcome === 'cancelled' || e.outcome === 'timeout') ? e.outcome : 'fail'
    byOutcome[oc] += 1
    if (oc === 'timeout') timeouts += 1
    const via = String(e.via || 'unspecified')
    byVia.set(via, (byVia.get(via) || 0) + 1)
  }

  function noteForce(source) {
    const s = String(source || 'unknown')
    forceBySource.set(s, (forceBySource.get(s) || 0) + 1)
  }

  // #964：被合并的请求数（搭上在飞旧轮的后来者，一人记一次；退避与记账不重复记）。
  let ridingMerged = 0
  function noteRideMerged() { ridingMerged += 1 }

  function notePreflightReuse(asked, reused) {
    preflightAsked += Number(asked) || 0
    preflightReused += Number(reused) || 0
  }

  function rankOf(map) {
    return Array.from(map.entries()).map(function (kv) { return { name: kv[0], count: kv[1] } }).sort(function (a, b) { return b.count - a.count })
  }

  function snapshot(admissionSnap) {
    const adm = admissionSnap || null
    return {
      samples: samples,
      latency: Object.assign({}, latency),
      byTier: Object.assign({}, byTier),
      byOutcome: Object.assign({}, byOutcome),
      timeouts: timeouts,
      byVia: rankOf(byVia),
      forceRank: rankOf(forceBySource),
      preflight: { asked: preflightAsked, reused: preflightReused },
      riding: { merged: ridingMerged },
      inflight: adm ? { readPeak: adm.readPeak, writePeak: adm.writePeak, readWaited: adm.readWaited, writeWaited: adm.writeWaited, cancelled: adm.cancelled } : null,
    }
  }

  function reset() {
    for (const k in latency) latency[k] = 0
    byTier.read = 0; byTier.write = 0; byTier.probe = 0
    byOutcome.ok = 0; byOutcome.fail = 0; byOutcome.cancelled = 0; byOutcome.timeout = 0
    byVia.clear(); forceBySource.clear()
    timeouts = 0; preflightAsked = 0; preflightReused = 0; samples = 0; ridingMerged = 0
  }

  return { record: record, noteForce: noteForce, notePreflightReuse: notePreflightReuse, noteRideMerged: noteRideMerged, snapshot: snapshot, reset: reset }
}

let defaultMeasure = null

/** 进程内默认记分板：三个出站路与探测链共用它，数才对得上。 */
export function getGhMeasure() {
  if (!defaultMeasure) defaultMeasure = createMeasure()
  return defaultMeasure
}

export function resetGhMeasureForTest() { defaultMeasure = null }

export default getGhMeasure
