// packages/dsh-log/src/client.ts —— 日志包的客户端入口（dsh-log/client，#558 Q4 双入口之一）。
//
// 日志系统的客户端引擎（#560）：把 src/client/kernel/log.js 改写为 TS 工厂函数。
// 调用方传入 host、timer、存储、开关广播四个依赖，拿回一个独立的日志器；
// 旧模块的闭包自由变量在本包内不再出现，全部经依赖参数进入。
// 全程用“日志系统”指日志功能本身，用“日志包”指装着日志系统的这个 npm 包。
//
// 两种消费方式落哪（实现侧说明，文档细节留 #562 文档票）：
// 1. 直接 import 形态落本入口的工厂函数：调用方写 import { createClientLog } from 'dsh-log/client'，
//    把四个依赖与插件配置传进来，当场得到日志器，打包工具正常解析 import。
// 2. 文本拼接形态落本入口的声明体文本：消费方构建时取客户端入口编译后的声明体、
//    去行首 export 后拼进插件主文件闭包，调用时把闭包里现成的四个名字原样传给工厂。
//    本仓当前插件本次不切拼接源（默认 wf 下行为零变化），拼接形态留给第二个插件验证。
//
// 三样直接复用，不另起字面：电话名拼法走 buildClientPhoneNames（与宿主入口同一套，
// 前缀加点加动作名，默认前缀 wf 下与现状一字不差）；批量口径走 CLIENT_BATCH 常量
// （每批 50 条、每 1000 毫秒、单包约 128KB、队列 100 条先到先截）；事件清单走对象形式
// （调用方把清单拼成对象传给 eventList，日志包不读盘，默认 null 主路径零变化）。
//
// 失败语义冻结（#558）：失败只计数不抛错；转发与开关读写失败都只加到累计丢弃数里，
// 返回成功为假的结构，不抛异常；开关失败保持旧值。
// 未新增日志事件：本文件只沿用旧模块的 4 个事件名（log.forward.summary、log.switch.watchdog、
// log.export.fail、host.call.fail），research/489-appendix.md 第 1 章对照表不用改。

import {
  assertPluginId,
  buildPhoneNames,
  CLIENT_BATCH_INTERVAL_MS,
  CLIENT_BATCH_MAX,
  CLIENT_PACKET_BYTES,
  CLIENT_QUEUE_MAX,
  parseEventListManifest,
  type PhoneAction,
  type PhoneNameMap
} from './config.js'

export { buildPhoneName, buildPhoneNames } from './config.js'
export type { PhoneAction, PhoneNameMap } from './config.js'

export const CLIENT_BATCH = {
  maxPerBatch: CLIENT_BATCH_MAX,
  intervalMs: CLIENT_BATCH_INTERVAL_MS,
  packetBytes: CLIENT_PACKET_BYTES,
  queueMax: CLIENT_QUEUE_MAX
} as const

// 客户端转发与开关读写要调的 5 个电话名（与宿主注册名同一套拼法，调用方传入同一前缀）。
export function buildClientPhoneNames(prefix: string): PhoneNameMap {
  return buildPhoneNames(prefix)
}

// 计时器回退只用运行环境自带的全局函数，不引入任何 Node 或浏览器专属类型（与宿主 store.ts 同口径）。
declare function setTimeout(fn: () => void, ms: number): unknown
declare function clearTimeout(handle: unknown): void

// ---- 四依赖的最小形状（调用方传入什么，本包就用什么，不自己抓全局） ----

// 宿主调用器：只用 call 一个方法（转发一批、开关读写都走它）。
export interface ClientHost {
  call: (name: string, args?: unknown) => Promise<unknown>
}

// 计时器：只用 timeout 一个方法（防抖合并与看门狗都走它，没有就回退全局函数）。
export interface ClientTimer {
  timeout: (fn: () => void, ms: number) => unknown
}

// 本地存储：只用读写两个方法（开关持久化走它，没有就每次用默认）。
export interface ClientStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

// 开关广播：开关落定后通知全组，一个无参函数（没有就不广播，不报错）。
export type ClientBroadcast = () => void

// 建日志器时调用方传入的四个依赖（全可选，缺了走退化路，不抛错）。
export interface ClientLogDeps {
  host?: ClientHost | null
  timer?: ClientTimer | null
  // 存储：传 storage 即够；旧闭包名 localStorage 也认（迁移期兼容，两者都传以 storage 为准）。
  storage?: ClientStorage | null
  localStorage?: ClientStorage | null
  broadcastLogSwitch?: ClientBroadcast | null
}

// ---- 配置面（只收插件标识与前缀，批量口径与存储键沿现状不参数化） ----

// 建日志器时调用方传入的配置：插件标识建议显式传，不传回退 wf（当前插件主路径，零变化）。
export interface ClientLogConfigInput {
  pluginId?: string
  // 电话名前缀：不传时回退到插件标识（即前缀默认等于插件标识，当前插件两者都是 wf）。
  prefix?: string
  // 事件清单注入点位（与宿主同一口径：对象当场验形状，字符串只存不解析，默认 null 零变化；
  // 客户端运行时不拿清单做字段拦截，检查跑在通用门禁里）。
  eventList?: string | Record<string, unknown> | null
}

export interface ResolvedClientLogConfig {
  pluginId: string
  prefix: string
  eventList: string | Record<string, unknown> | null
}

// 把调用方传入的配置补齐为完整配置（缺省全走 #558 默认派生，非法才抛错）。
export function resolveClientLogConfig(input?: ClientLogConfigInput): ResolvedClientLogConfig {
  const raw = input === undefined || input === null ? {} : input
  const pluginId = raw.pluginId === undefined ? 'wf' : assertPluginId(raw.pluginId, '插件标识 pluginId')
  const prefix = raw.prefix === undefined ? pluginId : assertPluginId(raw.prefix, '电话名前缀 prefix')
  const eventList = raw.eventList === undefined ? null : raw.eventList
  if (eventList !== null && typeof eventList === 'object') {
    // 对象形式的清单当场验形状（与宿主入口同一函数）；数组同样被拦下；默认 null 原样透过。
    parseEventListManifest(eventList)
  }
  return { pluginId: pluginId, prefix: prefix, eventList: eventList }
}

// ---- 旧字面兼容（批量口径数字复用 CLIENT_BATCH 常量，不另写一遍） ----

// 本地开关存一份：键名与形状沿现状（是否开启加采样率加版本号），不动其他键。
export const LOG_DEBUG_KEY = 'dsws.debug'
// 通道批量口径（#558 队列口径）：每批最多 50 条、每 1000 毫秒发一次、
// 单包约 128KB 或队列 100 条先到先截，裁掉的记入丢弃数。
export const LOG_BATCH_MAX = CLIENT_BATCH_MAX
export const LOG_FLUSH_MS = CLIENT_BATCH_INTERVAL_MS
export const LOG_PACKET_BYTES = CLIENT_PACKET_BYTES
export const LOG_QUEUE_MAX = CLIENT_QUEUE_MAX
// 自监控看门狗阈值：开关写与启动对账超过这么多毫秒未回，就记一行告警，不改返回值。
export const LOG_WATCHDOG_MS = 5000
// 开关形状版本号：以后开关加字段就把这里加一，旧本地值读到缺字段时用默认补齐。
export const LOG_REV = 1
// 级别只有四个：error、warn、info、debug。
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const
export type ClientLogLevel = (typeof LOG_LEVELS)[number]

export interface ClientDebugSwitch {
  enabled: boolean
  sampleRate: number
  rev: number
}

export interface ClientQueuedRow {
  ts: number
  level: string
  event: string
  fields: Record<string, unknown>
  truncated?: boolean
}

export interface ClientSendResult {
  ok: boolean
  sent: number
}

export interface ClientSwitchResult {
  ok: boolean
  enabled: boolean
  sampleRate: number
}

export interface ClientSetSwitchResult {
  ok: boolean
  enabled: boolean
  sampleRate?: number
  error?: string
}

// 日志器：工厂一次调用得到一个独立实例（内存队列、累计丢弃数、开关状态各自独立，互不串）。
// 方法名与旧模块同名同参同语义，默认配置下行为零变化。
export interface ClientLog {
  config: ResolvedClientLogConfig
  phoneNames: PhoneNameMap
  // 下面四份状态是活引用（测试与调用处可直接读，改开关请走 setLogSwitch 与 reconcileLogSwitch）。
  logSwitch: ClientDebugSwitch
  logQueue: ClientQueuedRow[]
  logDroppedState: { count: number }
  logForwardState: { lastSummaryAt: number; lastSummaryDropped: number; lastReason: string }
  logFlushTimer: { id: unknown }
  isEnabled: (level: string) => boolean
  log: (level: string, event: string, fields?: Record<string, unknown>) => void
  scheduleLogFlush: (immediate: boolean) => void
  estimateBatchBytes: (entries: ClientQueuedRow[]) => number
  maybeForwardSummary: () => void
  hash8: (value: unknown) => string
  logExportFail: (op: string, reason: string, err: unknown) => void
  watchSwitchOp: (op: string, pending: unknown) => void
  sendLogBatch: () => Promise<ClientSendResult>
  flush: () => { ok: boolean }
  getDroppedCount: () => number
  readLocalDebugSwitch: () => ClientDebugSwitch
  persistLocalDebugSwitch: (state: ClientDebugSwitch) => boolean
  reconcileLogSwitch: () => Promise<ClientSwitchResult>
  setLogSwitch: (enabled: boolean, sampleRate?: number) => Promise<ClientSetSwitchResult>
}

// 建客户端日志器：四依赖全由调用方传入，返回日志器。
// 文本拼接消费时，调用处把闭包里现成的 host、timer、localStorage、broadcastLogSwitch 四个名字原样传入即可。
export function createClientLog(deps: ClientLogDeps, configInput?: ClientLogConfigInput): ClientLog {
  const input: ClientLogDeps = deps || {}
  const host = input.host === undefined ? null : input.host
  const timer = input.timer === undefined ? null : input.timer
  const storage = input.storage !== undefined && input.storage !== null ? input.storage : (input.localStorage === undefined ? null : input.localStorage)
  const broadcast = typeof input.broadcastLogSwitch === 'function' ? input.broadcastLogSwitch : null
  // 配置：默认 wf（插件标识与前缀都是 wf），拼出的 5 个电话名与现状一字不差。
  const config = resolveClientLogConfig(configInput)
  const phoneNames = buildClientPhoneNames(config.prefix)

  // 读本地开关（启动秒显用）：同步读本地存储，读不到或读坏都用默认（默认关闭）。
  function readLocalDebugSwitch(): ClientDebugSwitch {
    const fallback: ClientDebugSwitch = { enabled: false, sampleRate: 1, rev: LOG_REV }
    try {
      if (!storage || typeof storage.getItem !== 'function') return fallback
      const raw = storage.getItem(LOG_DEBUG_KEY)
      if (!raw) return fallback
      const saved = JSON.parse(raw) as { enabled?: unknown; sampleRate?: unknown; rev?: unknown } | null
      if (!saved || typeof saved !== 'object') return fallback
      return {
        enabled: saved.enabled === true,
        sampleRate: typeof saved.sampleRate === 'number' && isFinite(saved.sampleRate) ? saved.sampleRate : 1,
        rev: typeof saved.rev === 'number' && isFinite(saved.rev) ? saved.rev : LOG_REV
      }
    } catch (e) {
      void e
      return fallback
    }
  }
  // 写本地开关：全文覆写，失败不抛错，返回是否写成功。
  function persistLocalDebugSwitch(state: ClientDebugSwitch): boolean {
    try {
      if (!storage || typeof storage.setItem !== 'function') return false
      storage.setItem(
        LOG_DEBUG_KEY,
        JSON.stringify({
          enabled: !!(state && state.enabled),
          sampleRate: state && typeof state.sampleRate === 'number' && isFinite(state.sampleRate) ? state.sampleRate : 1,
          rev: state && typeof state.rev === 'number' && isFinite(state.rev) ? state.rev : LOG_REV
        })
      )
      return true
    } catch (e) {
      void e
      return false
    }
  }
  // 开关内存值：建日志器时同步读本地，界面秒显不等待宿主；随后启动对账再向宿主看齐。
  const logSwitch: ClientDebugSwitch = readLocalDebugSwitch()
  // 内存批量队列：调用处只进队列就返回，不等转发完成；转发走宿主记录电话。
  const logQueue: ClientQueuedRow[] = []
  // 累计丢弃数：队列满丢弃、超包裁剪、转发失败都只计数不抛错。
  const logDroppedState = { count: 0 }
  // 转发汇总状态：只记上次汇总位置与最近一次丢弃原因，汇总行本身不逐条。
  const logForwardState = { lastSummaryAt: 0, lastSummaryDropped: 0, lastReason: '' }
  const logFlushTimer: { id: unknown } = { id: null }
  // 写开关代际：调用 hang 住时超时放行，迟到回包按代际丢弃，不碰状态、不记新行。
  const setLogSwitchGen = { n: 0 }

  // 读当前级别是否允许产生日志；关闭时调用处直接返回。错误与告警始终允许。
  function isEnabled(level: string): boolean {
    if (level === 'error' || level === 'warn') return true
    try {
      return logSwitch.enabled === true
    } catch (e) {
      void e
      return false
    }
  }
  // 记一行日志：体内仍先判断一次再写，做漏加外层判断的兜底；
  // 但兜底拦不住调用前已求值的拼接，所以高频调用处仍必须写外层判断，不许省略。
  function log(level: string, event: string, fields?: Record<string, unknown>): void {
    if (!isEnabled(level)) return
    if (logQueue.length >= LOG_QUEUE_MAX) {
      logDroppedState.count += 1
      logForwardState.lastReason = 'queue-full'
      return
    }
    logQueue.push({
      ts: Date.now(),
      level: level,
      event: String(event || ''),
      fields: fields && typeof fields === 'object' ? fields : {}
    })
    if (level === 'error' || level === 'warn') scheduleLogFlush(true)
    else scheduleLogFlush(false)
  }
  // 安排一次转发：普通走 1000 毫秒防抖合并；错误与告警走直通（取消本次等待立刻发，
  // 但调用处仍只进队列就返回，不等转发完成，崩溃窗口只剩毫秒级）。
  function scheduleLogFlush(immediate: boolean): void {
    const later = function (fn: () => void, ms: number): unknown {
      try {
        if (timer !== null && timer !== undefined && typeof timer.timeout === 'function') return timer.timeout(fn, ms)
      } catch (e) {
        void e
      }
      return setTimeout(fn, ms)
    }
    if (immediate) {
      if (logFlushTimer.id !== null) {
        try {
          clearTimeout(logFlushTimer.id)
        } catch (e) {
          void e
        }
        logFlushTimer.id = null
      }
      later(sendLogBatch, 0)
      return
    }
    if (logFlushTimer.id !== null) return
    logFlushTimer.id = later(function () {
      logFlushTimer.id = null
      sendLogBatch()
    }, LOG_FLUSH_MS)
  }
  // 估算一次转发的包体积（只在转发时做，渲染路径不做对象转文本）。
  function estimateBatchBytes(entries: ClientQueuedRow[]): number {
    try {
      const text = JSON.stringify(entries)
      const g = globalThis as { TextEncoder?: new () => { encode: (value: string) => { length: number } } }
      if (typeof g.TextEncoder !== 'undefined') return new g.TextEncoder().encode(text).length
      return String(text).length
    } catch (e) {
      void e
      return LOG_PACKET_BYTES + 1
    }
  }
  // 转发汇总行：批量发送落定后，有新增丢弃才记一行；无丢弃的窗口不打扰。
  // 汇总行本身走告警直通再触发下一次发送，下一次无新增丢弃即止，链条自然终止。
  function maybeForwardSummary(): void {
    const delta = logDroppedState.count - logForwardState.lastSummaryDropped
    if (delta <= 0) return
    logForwardState.lastSummaryDropped = logDroppedState.count
    const now = Date.now()
    const windowMs = now - logForwardState.lastSummaryAt
    logForwardState.lastSummaryAt = now
    try {
      log('warn', 'log.forward.summary', {
        droppedDelta: delta,
        totalDropped: logDroppedState.count,
        reason: logForwardState.lastReason || 'send-fail',
        windowMs: windowMs
      })
    } catch (e) {
      void e
    }
  }
  // 散列小函数（纯散列不记原文；旧模块自带，包内保留一份，不依赖消费方闭包）。
  function hash8(value: unknown): string {
    try {
      const t = String(value || '')
      let h = 5381
      for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
      return ('0000000' + h.toString(16)).slice(-8)
    } catch (e) {
      void e
      return '00000000'
    }
  }
  // 导出链路行：状态栏菜单与设置页两处复用；成功路径不调用，失败分支才记一行。
  // 旧模块在消费方闭包里有散列与截断可用时优先用它们；包内没有共享闭包，
  // 所以只认挂在全局上的同名函数（测试桩走这条），没有就回退包内散列，行为一致。
  function logExportFail(op: string, reason: string, err: unknown): void {
    try {
      const g = globalThis as { dswsLogHash?: unknown; dswsLogTrunc?: unknown }
      if (typeof g.dswsLogHash === 'function' && typeof g.dswsLogTrunc === 'function') {
        const trunc = g.dswsLogTrunc as (value: string, n: number, field: string) => string
        const hash = g.dswsLogHash as (value: string) => string
        const raw = err && typeof err === 'object' && 'message' in (err as Record<string, unknown>)
          ? String((err as { message?: unknown }).message)
          : String(err || reason)
        log('warn', 'log.export.fail', { op: op, reason: reason, errorHash: hash(trunc(raw, 120, 'error')) })
      } else {
        const raw = err && typeof err === 'object' && 'message' in (err as Record<string, unknown>)
          ? String((err as { message?: unknown }).message)
          : String(err || reason)
        log('warn', 'log.export.fail', { op: op, reason: reason, errorHash: hash8(raw) })
      }
    } catch (e) {
      void e
    }
  }
  // 开关看门狗：操作与 5 秒计时竞跑，计时先到记一行告警；原调用不取消、不重试、不改返回值。
  function watchSwitchOp(op: string, pending: unknown): void {
    let settled = false
    try {
      if (pending && typeof (pending as Promise<unknown>).then === 'function') {
        ;(pending as Promise<unknown>).then(
          function () {
            settled = true
          },
          function () {
            settled = true
          }
        )
      }
    } catch (e) {
      void e
    }
    const fire = function (): void {
      if (!settled) {
        settled = true
        try {
          log('warn', 'log.switch.watchdog', { op: op, timeoutMs: LOG_WATCHDOG_MS, stage: 'waiting-host' })
        } catch (e) {
          void e
        }
      }
    }
    try {
      if (timer !== null && timer !== undefined && typeof timer.timeout === 'function') {
        timer.timeout(fire, LOG_WATCHDOG_MS)
        return
      }
    } catch (e) {
      void e
    }
    try {
      setTimeout(fire, LOG_WATCHDOG_MS)
    } catch (e2) {
      void e2
    }
  }
  // 发一批：一次最多 50 条；单包超 128KB 或队列超 100 条时先到先截，
  // 裁掉的记入丢弃数并在包尾最后一条记截断标记；失败整批记丢弃，不等待不重试。
  function sendLogBatch(): Promise<ClientSendResult> {
    if (logQueue.length === 0) return Promise.resolve({ ok: true, sent: 0 })
    const entries = logQueue.splice(0, LOG_BATCH_MAX)
    let trimmed = 0
    while (entries.length > 1 && estimateBatchBytes(entries) > LOG_PACKET_BYTES) {
      entries.pop()
      trimmed += 1
    }
    // 队列里还压着超过 100 条说明消费跟不上：只留 100 条，其余丢弃并计数（不无界缓冲）。
    while (logQueue.length > LOG_QUEUE_MAX) {
      logQueue.shift()
      trimmed += 1
    }
    if (trimmed > 0) {
      logDroppedState.count += trimmed
      logForwardState.lastReason = 'packet-trim'
      try {
        entries[entries.length - 1].truncated = true
      } catch (e) {
        void e
      }
    }
    const args = { entries: entries, droppedCount: logDroppedState.count }
    // 防自激：这一批如果只剩上一行汇总自己，失败只计数不再记新汇总，否则汇总会自己养活自己停不下来。
    const onlySummary = entries.length === 1 && entries[0] && entries[0].event === 'log.forward.summary'
    if (!host || typeof host.call !== 'function') {
      logDroppedState.count += entries.length
      logForwardState.lastReason = 'send-fail'
      if (!onlySummary) maybeForwardSummary()
      return Promise.resolve({ ok: false, sent: 0 })
    }
    try {
      return host
        .call(phoneNames.logBatch, args)
        .then(function (res: unknown) {
          const ok = !!res && typeof res === 'object' && (res as { ok?: unknown }).ok === true
          if (!ok) {
            logDroppedState.count += entries.length
            logForwardState.lastReason = 'host-reject'
          }
          if (ok) maybeForwardSummary()
          else if (!onlySummary) maybeForwardSummary()
          return { ok: ok, sent: entries.length }
        })
        .catch(function () {
          logDroppedState.count += entries.length
          logForwardState.lastReason = 'send-fail'
          if (!onlySummary) maybeForwardSummary()
          return { ok: false, sent: 0 }
        })
    } catch (e) {
      void e
      logDroppedState.count += entries.length
      logForwardState.lastReason = 'send-fail'
      if (!onlySummary) maybeForwardSummary()
      return Promise.resolve({ ok: false, sent: 0 })
    }
  }
  // 立刻转发一次（取消本次防抖等待）；客户端侧的 flush 只管转发，不管落盘。
  function flush(): { ok: boolean } {
    if (logFlushTimer.id !== null) {
      try {
        clearTimeout(logFlushTimer.id)
      } catch (e) {
        void e
      }
      logFlushTimer.id = null
    }
    try {
      sendLogBatch()
    } catch (e) {
      void e
    }
    return { ok: true }
  }
  // 读累计丢弃数（队列满与转发失败都只计数不抛错，与宿主同名同参）。
  function getDroppedCount(): number {
    return logDroppedState.count
  }
  // 启动对账：向宿主读开关，以宿主为准；宿主不可用或读失败就保持本地值，
  // 不回退为开启，不抛错，不产生调试日志。成功后持久化到本地并向全组广播。
  function reconcileLogSwitch(): Promise<ClientSwitchResult> {
    if (!host || typeof host.call !== 'function') {
      return Promise.resolve({ ok: false, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate })
    }
    try {
      const pendingGet = host.call(phoneNames.logGetSwitch, {})
      watchSwitchOp('reconcile', pendingGet)
      return (pendingGet as Promise<unknown>).then(function (res: unknown) {
        const body = res && typeof res === 'object' ? (res as { ok?: unknown; enabled?: unknown; sampleRate?: unknown }) : null
        if (!body || body.ok !== true) return { ok: false, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate }
        logSwitch.enabled = body.enabled === true
        if (typeof body.sampleRate === 'number' && isFinite(body.sampleRate)) logSwitch.sampleRate = body.sampleRate
        persistLocalDebugSwitch(logSwitch)
        try {
          if (broadcast) broadcast()
        } catch (e) {
          void e
        }
        return { ok: true, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate }
      }).catch(function () {
        return { ok: false, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate }
      })
    } catch (e) {
      void e
      return Promise.resolve({ ok: false, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate })
    }
  }
  // 开关写失败分类行：写开关是低频用户动作，三条失败路各落一条告警行。
  // 复用现成常驻事件 host.call.fail（不新增事件名），字段只用白名单三键；
  // 告警级始终落盘、不依赖调试开关，下次导出日志即可看出是哪一类失败。
  const logSwitchSetFail = function (kind: string, hint: unknown): void {
    try {
      log('warn', 'host.call.fail', {
        method: phoneNames.logSetSwitch,
        kind: 'set-switch-' + kind,
        errorHash: hash8(String(hint === undefined || hint === null ? kind : hint).slice(0, 120))
      })
    } catch (e) {
      void e
    }
  }
  // 调用抛错再按文案分一小类：未知端点与连接不可用各单列，其余归通用抛错。
  // 只做归类、不记原文（原文只进散列），低频路径、关闭时零代价。
  const switchThrowKind = function (e: unknown): string {
    const msg = String((e && typeof e === 'object' && ('code' in (e as Record<string, unknown>) || 'message' in (e as Record<string, unknown>))
      ? ((e as { code?: unknown; message?: unknown }).code || (e as { message?: unknown }).message)
      : e) || '')
    if (/unknown endpoint/i.test(msg)) return 'throw-unknown-endpoint'
    if (/connection|host\.call 不可用|unavailable/i.test(msg)) return 'throw-connection'
    return 'throw'
  }
  // 设置页保存开关：先写宿主，宿主生效才更新本地与内存并广播；写失败保持本地旧值并返回失败，
  // 由调用处提示用户，不回退为开启。失败原因只给机器码（host-unavailable、host-rejected），
  // 面向用户的文案由界面批次经多语言系统转换，本包不写面向用户的中文字符串。
  function setLogSwitch(enabled: boolean, sampleRate?: number): Promise<ClientSetSwitchResult> {
    const next = {
      enabled: enabled === true,
      sampleRate: typeof sampleRate === 'number' && isFinite(sampleRate) ? sampleRate : logSwitch.sampleRate
    }
    if (!host || typeof host.call !== 'function') {
      logSwitchSetFail('host-unavailable', 'host-unavailable')
      return Promise.resolve({ ok: false, enabled: logSwitch.enabled, error: 'host-unavailable' })
    }
    try {
      const pendingSet = host.call(phoneNames.logSetSwitch, next) as Promise<unknown>
      watchSwitchOp('set', pendingSet)
      // 超时放行：调用 hang 住不再卡死界面，与看门狗同超时；
      // 无计时器时永不超时，原样等待（行为退化到修前）。
      const myGen = (setLogSwitchGen.n += 1)
      const timeoutAt = new Promise(function (resolve) {
        const fire = function (): void {
          resolve({ switchTimedOut: true })
        }
        try {
          if (timer !== null && timer !== undefined && typeof timer.timeout === 'function') {
            timer.timeout(fire, LOG_WATCHDOG_MS)
            return
          }
        } catch (e) {
          void e
        }
        try {
          setTimeout(fire, LOG_WATCHDOG_MS)
        } catch (e2) {
          void e2
        }
      })
      return Promise.race([pendingSet, timeoutAt]).then(function (res: unknown) {
        const body = res && typeof res === 'object' ? (res as Record<string, unknown>) : null
        if (body && body['switchTimedOut'] === true) {
          logSwitchSetFail('timeout', 'timeout-' + LOG_WATCHDOG_MS)
          return { ok: false, enabled: logSwitch.enabled, error: 'switch-timeout' }
        }
        if (myGen !== setLogSwitchGen.n) return { ok: false, enabled: logSwitch.enabled, error: 'stale' }
        if (!body || body['ok'] !== true) {
          logSwitchSetFail('host-rejected', 'host-rejected')
          return { ok: false, enabled: logSwitch.enabled, error: 'host-rejected' }
        }
        logSwitch.enabled = body['enabled'] === true
        logSwitch.sampleRate = next.sampleRate
        persistLocalDebugSwitch(logSwitch)
        try {
          if (broadcast) broadcast()
        } catch (e) {
          void e
        }
        return { ok: true, enabled: logSwitch.enabled, sampleRate: logSwitch.sampleRate }
      }).catch(function (e: unknown) {
        if (myGen !== setLogSwitchGen.n) return { ok: false, enabled: logSwitch.enabled, error: 'stale' }
        logSwitchSetFail(switchThrowKind(e), (e && typeof e === 'object' && 'message' in (e as Record<string, unknown>) ? (e as { message?: unknown }).message : undefined) || String(e))
        const message = e && typeof e === 'object' && 'message' in (e as Record<string, unknown>)
          ? String((e as { message?: unknown }).message)
          : String(e)
        return { ok: false, enabled: logSwitch.enabled, error: message }
      })
    } catch (e) {
      void e
      logSwitchSetFail(switchThrowKind(e), (e && typeof e === 'object' && 'message' in (e as Record<string, unknown>) ? (e as { message?: unknown }).message : undefined) || e)
      const message = e && typeof e === 'object' && 'message' in (e as Record<string, unknown>)
        ? String((e as { message?: unknown }).message)
        : String(e)
      return Promise.resolve({ ok: false, enabled: logSwitch.enabled, error: message })
    }
  }

  return {
    config: config,
    phoneNames: phoneNames,
    logSwitch: logSwitch,
    logQueue: logQueue,
    logDroppedState: logDroppedState,
    logForwardState: logForwardState,
    logFlushTimer: logFlushTimer,
    isEnabled: isEnabled,
    log: log,
    scheduleLogFlush: scheduleLogFlush,
    estimateBatchBytes: estimateBatchBytes,
    maybeForwardSummary: maybeForwardSummary,
    hash8: hash8,
    logExportFail: logExportFail,
    watchSwitchOp: watchSwitchOp,
    sendLogBatch: sendLogBatch,
    flush: flush,
    getDroppedCount: getDroppedCount,
    readLocalDebugSwitch: readLocalDebugSwitch,
    persistLocalDebugSwitch: persistLocalDebugSwitch,
    reconcileLogSwitch: reconcileLogSwitch,
    setLogSwitch: setLogSwitch
  }
}

export type ClientLogInstance = ReturnType<typeof createClientLog>
