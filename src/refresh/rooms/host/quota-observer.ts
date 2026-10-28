/**
 * src/refresh/rooms/host/quota-observer.ts —— 配额与限流诊断日志的观察器（#1627）。
 *
 * 为什么要有这个文件：分诊 #1615 时，2026-10-28 那两次约 20 分钟的失败窗口（10:42Z、12:17Z 附近）
 * 只能从日志看出「一天花了多少点」，看不出失败当下最要紧的五件事：这次是真配额见底还是二级限流、
 * 谁在抢（账号与调用方）、靠什么恢复的、损失了多少、重试放大了几倍。这里把它们收成一组事件：
 *   - 核心常驻（debug 关闭也写）：quota.window / quota.incident / quota.recover / quota.sync / quota.pressure；
 *   - 逐笔按需（debug 打开才写；坏、慢、贵三种情况提升到 info）：quota.op / tool.receipt；
 *   - 事故那一刻在飞调用的旁证：quota.detail。
 * 事件名与字段名逐字对应票面「核心常驻清单」，tests/verify-log-fields.ts 是同一把尺子。
 *
 * 为什么类型与常量搬去了 quota-observer-types.ts：本仓要求 src/ 下每个文件不超过 350 有效行，
 * 类型声明加常量本身就有两百来行；拆开之后这个文件只剩「怎么累加、什么时候写事件」。
 *
 * 约定不能改：
 *   - 每个事件每分钟有硬上限（见 CAPS）：超限不写、只把该分钟的 suppressed 加一，
 *     所以「少了一行」永远能从同分钟的 quota.window 上对回来；
 *   - 时钟、车道快照、服务端读数全部由装配方注入（deps.now / deps.lane / deps.readings），
 *     本文件不读全局时间、不发网络请求、不碰账本，tests/verify-log-1627.ts 因此能用历史日志回放它；
 *   - 观测代码出错绝不影响业务：所有落盘都包在 try/catch 里，与管线里 onEvent 的纪律一致。
 *
 * 读日志的人怎么用：先看 quota.window 找「哪一分钟点数和失败数不对」，再看 quota.incident 判类别、
 * 看 quota.recover 回答「等了多久、放大几倍」，需要还原现场时打开 debug 看 quota.op 与 quota.detail。
 */

import {
  CAPS, DETAIL_MAX, INCIDENT_DEDUPE_MS, MINUTE_MS, PRESSURE_HOUR_POINTS, PRESSURE_MINUTE_POINTS,
  RECOVER_QUIET_MS, TOP_MAX, newMinute, numOf, strOf,
} from './quota-observer-types.js'
import type {
  IncidentState, MinuteState, PendingSync, QuotaDecisionReport, QuotaLaneState, QuotaObserver,
  QuotaObserverDeps, QuotaObserverSnapshot, QuotaOpReport, QuotaOpStart, QuotaReadings, QuotaSpendReport,
  QuotaSyncReport, QuotaToolReceiptReport,
} from './quota-observer-types.js'

export type {
  QuotaLaneState, QuotaReadings, QuotaOpStart, QuotaOpReport, QuotaSpendReport, QuotaDecisionReport,
  QuotaSyncReport, QuotaToolReceiptReport, QuotaObserverLog, QuotaObserverDeps, QuotaObserverSnapshot, QuotaObserver,
} from './quota-observer-types.js'

/**
 * 造一个观察器。它只做「收信号 → 累加 → 到边界写事件」，不查询账本、不裁决、不改任何业务状态；
 * 所有依赖都从 deps 注入，所以同一个实例既能接在宿主里跑，也能在回放测试里按历史时刻推进。
 */
export function createQuotaObserver(deps: QuotaObserverDeps = {}): QuotaObserver {
  const nowFn = (typeof deps.now === 'function') ? deps.now : () => Date.now()
  const log = deps.log || null
  const laneOf = (typeof deps.lane === 'function') ? deps.lane : null
  const readingsOf = (typeof deps.readings === 'function') ? deps.readings : null

  let minute: MinuteState = newMinute(0)
  let started = false
  const hour: { start: number; points: number; ai: number; plugin: number; user: number }[] = []
  const inflight = new Map<string, QuotaOpStart>()
  const opTrack = new Map<string, { fails: number; lastFailAt: number }>()
  const syncState = new Map<string, { remaining: number; resetSec: number; at: number }>()
  const pendingSyncs = new Map<string, PendingSync>()
  const inc: IncidentState = {
    active: false, start: 0, incidents: 0, suppressed: 0, failsInWindow: 0, opsFailed: 0,
    maxInflight: 0, detailWritten: 0, lastRateLimitAt: 0, lastWriteAt: 0, lastRateClass: '', resetPast: false,
  }

  function emit(level: string, event: string, fields: Record<string, unknown>): void {
    if (!log) return
    try { log.fire(level, event, fields) } catch { /* 观测出错绝不影响业务 */ }
  }

  function debugOn(): boolean {
    try { return !!log && !!log.isEnabled('debug') } catch { return false }
  }

  function laneNow(): QuotaLaneState | null {
    try { return laneOf ? laneOf() : null } catch { return null }
  }

  function readingsNow(): QuotaReadings {
    let r: QuotaReadings | null = null
    try { r = readingsOf ? readingsOf() : null } catch { r = null }
    return r || { gqlRemain: -1, resetSec: -1, syncAgeMs: -1, tier: '', allowance: -1 }
  }

  function sampleLane(m: MinuteState): void {
    const lane = laneNow()
    if (!lane) return
    m.inflightPeak = Math.max(m.inflightPeak, numOf(lane.inflight, 0))
    m.inflightMax = Math.max(m.inflightMax, numOf(lane.inflightMax, 0))
    m.queuedPeak = Math.max(m.queuedPeak, numOf(lane.queued, 0))
    m.oldestWaitMs = Math.max(m.oldestWaitMs, numOf(lane.oldestWaitMs, 0))
    if (inc.active) inc.maxInflight = Math.max(inc.maxInflight, numOf(lane.inflight, 0))
  }

  /** 把「当前时刻」推进到 t：跨分钟就把上一分钟收尾写 window，没有流量的空分钟直接跳过。 */
  function advance(t: number): void {
    const start = Math.floor(t / MINUTE_MS) * MINUTE_MS
    if (!started) { minute = newMinute(start); started = true; return }
    if (start <= minute.start) return
    finishMinute(minute)
    minute = newMinute(start)
  }

  function hourPointsFrom(start: number): number {
    let sum = 0
    for (const row of hour) if (row.start > start - 60 * MINUTE_MS) sum += row.points
    return sum
  }

  function hourTop(start: number): string {
    const sums: { name: string; points: number }[] = [{ name: 'ai-tool', points: 0 }, { name: 'plugin', points: 0 }, { name: 'user-action', points: 0 }]
    for (const row of hour) {
      if (row.start <= start - 60 * MINUTE_MS) continue
      sums[0].points += row.ai; sums[1].points += row.plugin; sums[2].points += row.user
    }
    let best = sums[0]
    for (const sum of sums) if (sum.points > best.points) best = sum
    return best.points > 0 ? best.name + ':' + best.points : ''
  }

  /** 超出本分钟上限、或 debug 关着不需要写的行：不落盘，只把 suppressed 加一（票面口径）。 */
  function writeCapped(m: MinuteState, kind: keyof typeof CAPS, level: 'info' | 'debug', event: string, fields: Record<string, unknown>): boolean {
    if (level === 'debug' && !debugOn()) return false
    if (m.caps[kind] >= CAPS[kind]) { m.suppressed += 1; return false }
    m.caps[kind] += 1
    emit(level, event, fields)
    return true
  }

  function finishMinute(m: MinuteState): void {
    if (!m.touched) return
    sampleLane(m)
    const r = readingsNow()
    emit('info', 'quota.window', {
      requests: m.requests, points: m.points, estPoints: m.points + m.restRequests, restRequests: m.restRequests,
      aiPoints: m.aiPoints, pluginPoints: m.pluginPoints, userPoints: m.userPoints,
      failCount: m.failCount, limitCount: m.limitCount,
      inflightPeak: m.inflightPeak, inflightMax: m.inflightMax, queuedPeak: m.queuedPeak, oldestWaitMs: m.oldestWaitMs,
      allowUser: m.allowUser, allowAi: m.allowAi, softOver: m.softOver, allowBg: m.allowBg, deferCount: m.deferCount,
      gqlRemain: numOf(r.gqlRemain, -1), resetSec: numOf(r.resetSec, -1), syncAgeMs: numOf(r.syncAgeMs, -1), tier: strOf(r.tier),
      namingPages: m.namingPages, namingPoints: m.namingPoints, suppressed: m.suppressed,
    })
    hour.push({ start: m.start, points: m.points, ai: m.aiPoints, plugin: m.pluginPoints, user: m.userPoints })
    while (hour.length && hour[0].start <= m.start - 60 * MINUTE_MS) hour.shift()
    const lastHour = hourPointsFrom(m.start)
    // 压力行：单分钟或滚动一小时越线才写。它写在 window 之后，所以 window 的 suppressed 不含这一行自身的压制。
    if (m.points >= PRESSURE_MINUTE_POINTS || lastHour >= PRESSURE_HOUR_POINTS) {
      writeCapped(m, 'pressure', 'info', 'quota.pressure', {
        pointsLastMin: m.points, pointsLastHour: lastHour, projectedHour: m.points * 60,
        capacity: numOf(readingsNow().allowance, -1), inflightPeak: m.inflightPeak, top: hourTop(m.start).slice(0, TOP_MAX),
      })
    }
  }

  /** 恢复行：从事故开始到现在多久、期间发生几次告警（含被压掉的）、失败多少次、最后是谁成功。 */
  function writeRecover(firstOkVia: string, t: number): void {
    emit('info', 'quota.recover', {
      durationMs: Math.max(0, t - inc.start), incidents: inc.incidents, suppressed: inc.suppressed,
      failsInWindow: inc.failsInWindow, opsFailed: inc.opsFailed, maxInflightDuring: inc.maxInflight,
      firstOkVia: firstOkVia, resetPast: inc.resetPast,
    })
    inc.active = false
    inc.start = 0
    inc.lastRateLimitAt = 0
    inc.resetPast = false
  }

  /** 一次事故最多旁证 40 个当下还在飞的调用；第 41 个起只记 suppressed，不再逐笔写。 */
  function writeDetail(t: number, m: MinuteState): void {
    for (const call of inflight.values()) {
      if (inc.detailWritten >= DETAIL_MAX) { m.suppressed += 1; continue }
      inc.detailWritten += 1
      emit('info', 'quota.detail', {
        via: strOf(call.caller), opId: strOf(call.opId), account: strOf(call.account), points: -1,
        waitedMs: Math.max(0, t - numOf(call.at, t)), latencyMs: -1, kind: strOf(call.op),
      })
    }
  }

  function writeIncident(r: QuotaOpReport, t: number, m: MinuteState, attempt: number, retryGapMs: number): void {
    inc.lastRateLimitAt = t
    if (!inc.active) {
      inc.active = true
      inc.start = t
      inc.incidents = 0
      inc.suppressed = 0
      inc.failsInWindow = 1
      inc.opsFailed = 1
      inc.maxInflight = 0
      inc.detailWritten = 0
      inc.lastWriteAt = 0
      inc.lastRateClass = ''
      inc.resetPast = false
    }
    const rateClass = strOf(r.rateClass)
    const dup = inc.lastWriteAt > 0 && inc.lastRateClass === rateClass && t - inc.lastWriteAt < INCIDENT_DEDUPE_MS
    if (dup || m.caps.incident >= CAPS.incident) {
      inc.suppressed += 1
      m.suppressed += 1
      return
    }
    const lane = laneNow()
    const rd = readingsNow()
    m.caps.incident += 1
    inc.incidents += 1
    inc.lastWriteAt = t
    inc.lastRateClass = rateClass
    writeDetail(t, m)
    emit('warn', 'quota.incident', {
      rateClass: rateClass, httpStatus: numOf(r.httpStatus, 0), via: strOf(r.caller), op: strOf(r.op), opId: strOf(r.opId),
      account: strOf(r.account), attempt: attempt, retryGapMs: retryGapMs,
      inflight: lane ? numOf(lane.inflight, -1) : -1, inflightMax: lane ? numOf(lane.inflightMax, -1) : -1,
      queued: lane ? numOf(lane.queued, -1) : -1, oldestWaitMs: lane ? numOf(lane.oldestWaitMs, -1) : -1,
      windowRequests: m.requests, windowPoints: m.points, windowFailures: m.failCount,
      gqlRemain: numOf(rd.gqlRemain, -1), resetSec: numOf(rd.resetSec, -1), syncAgeMs: numOf(rd.syncAgeMs, -1),
      tier: strOf(rd.tier), top: strOf(r.top).slice(0, TOP_MAX),
    })
  }

  /** 把缓存的同步读数合成 quota.sync：同一后端同一时刻的多个桶算一次读数，drift 只对点数（graphql）有意义。 */
  function flushPendingSyncs(): void {
    if (pendingSyncs.size === 0) return
    const list: PendingSync[] = Array.from(pendingSyncs.values())
    pendingSyncs.clear()
    for (const p of list) {
      const chosen = p.buckets.get('graphql') || Array.from(p.buckets.values())[0]
      if (!chosen) continue
      const serverRemaining = numOf(chosen.serverRemaining, -1)
      const spentPoints = numOf(chosen.spentPoints, 0)
      const resetSec = numOf(chosen.resetSec, -1)
      const prev = syncState.get(p.backendId) || null
      const resetSeen = !!prev && resetSec > prev.resetSec
      const driftPoints = (prev && prev.remaining >= 0 && serverRemaining >= 0) ? prev.remaining - serverRemaining - spentPoints : -1
      const ageMs = prev ? Math.max(0, p.at - prev.at) : -1
      syncState.set(p.backendId, { remaining: serverRemaining, resetSec: resetSec, at: p.at })
      if (inc.active && resetSeen) inc.resetPast = true
      emit('info', 'quota.sync', {
        trigger: p.trigger, serverLimit: numOf(chosen.serverLimit, -1), serverRemaining: serverRemaining, resetSec: resetSec,
        allowance: numOf(chosen.allowance, -1), spentSinceSync: spentPoints, driftPoints: driftPoints, resetSeen: resetSeen, ageMs: ageMs,
      })
    }
  }

  function noteSpend(report: QuotaSpendReport): void {
    if (!report) return
    const t = numOf(report.at, nowFn())
    const m = minuteFor(t)
    sampleLane(m)
    const requests = numOf(report.requests, 0)
    const points = numOf(report.points, 0)
    m.touched = true
    m.requests += requests
    m.points += points
    if (strOf(report.bucket) === 'rest') m.restRequests += requests
    const account = strOf(report.account)
    if (account === 'ai-tool') m.aiPoints += points
    else if (account === 'plugin') m.pluginPoints += points
    else if (account === 'user-action') m.userPoints += points
  }

  /** 取 t 所在的分钟并推进时钟；事件即使晚到也不把已经收尾的分钟重新写一遍。 */
  function minuteFor(t: number): MinuteState {
    flushPendingSyncs()
    advance(t)
    return minute
  }

  function noteOpStart(info: QuotaOpStart): void {
    if (!info || !strOf(info.opId)) return
    const t = numOf(info.at, nowFn())
    sampleLane(minuteFor(t))
    if (inflight.size >= 256) {
      const oldest = inflight.keys().next()
      if (!oldest.done) inflight.delete(oldest.value)
    }
    inflight.set(strOf(info.opId), {
      at: t, op: strOf(info.op), opId: strOf(info.opId), caller: strOf(info.caller),
      account: strOf(info.account), backendId: strOf(info.backendId), purpose: strOf(info.purpose),
    })
  }

  function noteOp(report: QuotaOpReport): void {
    if (!report) return
    const t = numOf(report.at, nowFn())
    const m = minuteFor(t)
    sampleLane(m)
    const ok = !!report.ok
    const rateClass = strOf(report.rateClass)
    const op = strOf(report.op)
    const points = numOf(report.points, 0)
    const requests = numOf(report.requests, 0)
    const latencyMs = numOf(report.latencyMs, 0)
    m.touched = true
    if (!ok) m.failCount += 1
    if (!ok && rateClass) m.limitCount += 1
    if (strOf(report.purpose) === 'naming-index') { m.namingPages += 1; m.namingPoints += points }
    // attempt / retryGapMs：同一操作自上次成功以来第几次失败、距上一次同操作失败多久；成功一次清零。
    let attempt = 0
    let retryGapMs = 0
    if (ok) opTrack.delete(op)
    else {
      const track = opTrack.get(op) || { fails: 0, lastFailAt: 0 }
      track.fails += 1
      attempt = track.fails
      retryGapMs = track.lastFailAt > 0 ? Math.max(0, t - track.lastFailAt) : 0
      track.lastFailAt = t
      opTrack.set(op, track)
      if (opTrack.size > 400) {
        const oldest = opTrack.keys().next()
        if (!oldest.done) opTrack.delete(oldest.value)
      }
    }
    if (inc.active) {
      if (!ok) inc.opsFailed += 1
      if (!ok && rateClass) inc.failsInWindow += 1
    }
    if (!ok && rateClass) writeIncident(report, t, m, attempt, retryGapMs)
    else if (ok && inc.active && inc.lastRateLimitAt > 0 && t - inc.lastRateLimitAt >= RECOVER_QUIET_MS) writeRecover(strOf(report.caller), t)
    const level: 'info' | 'debug' = (!ok || latencyMs >= 10_000 || points >= 3 || requests >= 3) ? 'info' : 'debug'
    writeCapped(m, 'op', level, 'quota.op', {
      op: op, opId: strOf(report.opId), caller: strOf(report.caller), account: strOf(report.account), bucket: strOf(report.bucket),
      ok: ok, requests: requests, points: points, pointSource: strOf(report.pointSource), latencyMs: latencyMs,
      remaining: (report.remaining === null || report.remaining === undefined) ? -1 : numOf(report.remaining, -1),
      tier: strOf(report.tier), backendId: strOf(report.backendId),
    })
    inflight.delete(strOf(report.opId))
  }

  function noteDecision(report: QuotaDecisionReport): void {
    if (!report) return
    const t = numOf(report.at, nowFn())
    const m = minuteFor(t)
    m.touched = true
    const verdict = strOf(report.verdict)
    const category = strOf(report.category)
    if (verdict === 'allow') {
      if (category === 'user-action') m.allowUser += 1
      else if (category === 'ai-tool') m.allowAi += 1
      else if (category === 'background') m.allowBg += 1
      if (strOf(report.reason).indexOf('-soft') >= 0) m.softOver += 1
    } else if (verdict === 'defer') m.deferCount += 1
  }

  function noteToolReceipt(report: QuotaToolReceiptReport): void {
    if (!report) return
    const t = numOf(report.at, nowFn())
    const m = minuteFor(t)
    sampleLane(m)
    m.touched = true
    const points = numOf(report.points, 0)
    const latencyMs = numOf(report.latencyMs, 0)
    const level: 'info' | 'debug' = (strOf(report.status) !== 'ok' || latencyMs >= 3_000 || points >= 3) ? 'info' : 'debug'
    writeCapped(m, 'receipt', level, 'tool.receipt', {
      tool: strOf(report.tool), opId: strOf(report.opId), status: strOf(report.status),
      estRequests: numOf(report.estRequests, 0), estPoints: numOf(report.estPoints, 0),
      requests: numOf(report.requests, 0), points: points, latencyMs: latencyMs,
      remaining: (report.remaining === null || report.remaining === undefined) ? -1 : numOf(report.remaining, -1),
      tier: strOf(report.tier), backendId: strOf(report.backendId), note: strOf(report.note),
    })
  }

  function noteSync(report: QuotaSyncReport): void {
    if (!report) return
    const t = numOf(report.at, nowFn())
    advance(t)
    const key = strOf(report.backendId) + '|' + t
    let pending = pendingSyncs.get(key)
    if (!pending) {
      pending = { at: t, trigger: strOf(report.trigger) || 'sync', backendId: strOf(report.backendId), buckets: new Map() }
      pendingSyncs.set(key, pending)
    }
    pending.buckets.set(strOf(report.bucket) || 'graphql', report)
  }

  function tick(at?: number): void {
    const t = (typeof at === 'number' && Number.isFinite(at)) ? at : nowFn()
    flushPendingSyncs()
    advance(t)
  }

  function snapshot(): QuotaObserverSnapshot {
    const m = minute
    return {
      minuteStart: m.start,
      window: {
        requests: m.requests, points: m.points, restRequests: m.restRequests, failCount: m.failCount,
        limitCount: m.limitCount, suppressed: m.suppressed,
      },
      incidentActive: inc.active,
      incidents: inc.incidents,
      pendingSyncs: pendingSyncs.size,
      hourPoints: hourPointsFrom(m.start),
    }
  }

  return { noteSpend, noteOpStart, noteOp, noteToolReceipt, noteDecision, noteSync, tick, snapshot }
}
