// packages/dsh-log/src/store.ts —— 宿主日志库（由 src/host/logStore.js 移植，行为零变化）。
//
// 以后谁改它：改宿主落盘位置、按天分文件、防抖刷盘或开关持久化的人。导出/清空/开关三个电话体在 ./phones.js。
// 接线：由调用方建库并注册电话名；文件服务、计时器、取缓存目录函数、平台全部显式传入；
// 电话组经本文件静态引入（包内引用，不受 src/host 那条禁止静态引入的老规矩约束）。
// 它只做五件事：内存队列、级别判断、按天文件名、单写者刷盘、失败计数。宿主是唯一的落盘者。
// 防抖窗口 1000 毫秒（设计 2.2 字面：窗口内多次调用合并为一次读改写）。
//
// 与旧实现的两处有意差别（都是 #558 冻结清单要求的参数化，默认配置下字节级一致）：
// 1. 日志子目录名与开关文件名走配置默认派生（插件标识为 wf 时与旧字面一字不差）。
// 2. 内存队列默认 1000 条封顶，满时按级别丢弃、只计数不抛错（旧实现无上限）。
// 其余逻辑逐行对应旧实现，含失败语义的唯一例外：记录电话最外层 catch 回成功加接收 0 条。

import {
  LOG_DEBOUNCE_MS,
  LEGACY_LOG_DIR_NAME,
  LEGACY_SWITCH_FILE_NAME,
  resolveHostLogConfig,
  resolveLogFileName,
  formatDailyFileName,
  type HostLogConfigInput,
  type ResolvedHostLogConfig
} from './config.js'
import { createLogPhones } from './phones.js'

export { LOG_DEBOUNCE_MS, formatDailyFileName }
// 旧字面兼容导出（插件标识为 wf 时的目录名与开关文件名，现状门禁仍断言这两个字面）。
export const LOG_DIR_NAME = LEGACY_LOG_DIR_NAME
export const LOG_SWITCH_FILE = LEGACY_SWITCH_FILE_NAME
// 旧名兼容：旧模块叫 formatLogFileName，新包内叫 formatDailyFileName，行为相同。
export const formatLogFileName = formatDailyFileName

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

// 计时器回退只用运行环境自带的全局函数，不引入任何 Node 或浏览器专属类型（与 update-core 同口径）。
declare function setTimeout(fn: () => void, ms: number): unknown
declare function clearTimeout(handle: unknown): void

// 文件服务最小形状（与宿主文件服务同形：resolve 给目标对象，读写按目标读写）。
export interface LogFileService {
  resolve?: (pathStr: string) => Promise<unknown>
  readText?: (target: unknown) => Promise<string>
  writeText?: (target: unknown, text: string) => Promise<unknown>
  mkdir?: (dir: string) => Promise<unknown>
  unlink?: (target: unknown) => Promise<unknown>
  listDir?: (dirTarget: unknown) => Promise<unknown>
}

// 计时器最小形状（与宿主计时器同形）。
export interface LogTimer {
  timeout: (fn: (...args: unknown[]) => void, ms: number) => unknown
}

export interface LogPlatformPath {
  join: (...parts: string[]) => string
}

export interface LogPlatformFs {
  resolve?: (pathStr: string) => Promise<unknown>
  readText?: (target: unknown) => Promise<string>
  writeText?: (target: unknown, text: string) => Promise<unknown>
  mkdir?: (dir: string) => Promise<unknown>
  unlink?: (target: unknown) => Promise<unknown>
  listDir?: (dirTarget: unknown) => Promise<unknown>
}

export interface LogPlatform {
  os?: string
  path?: LogPlatformPath
  fs?: LogPlatformFs
}

export interface LogStoreDeps {
  fs?: LogFileService | null
  timer?: LogTimer | null
  getCacheDir?: () => Promise<string | null | ''> | string | null | ''
  getPlatform?: () => Promise<LogPlatform | null> | LogPlatform | null
  DEFAULT_CWD?: string
}

export interface LogEntry {
  level: string
  event: string
  fields: Record<string, unknown>
}

interface QueuedRow {
  ts: number
  level: string
  event: string
  fields: Record<string, unknown>
}

// 短指纹：目录只记散列不记原文，失败行自身也只带散列（与旧实现同算法，散列值不变）。
function hashText(text: unknown): string {
  let h = 5381
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return ('0000000' + h.toString(16)).slice(-8)
}

export function createLogStore(deps: LogStoreDeps, configInput?: HostLogConfigInput) {
  const input: LogStoreDeps = deps || {}
  const fs = input.fs
  const timer = input.timer
  const getCacheDir = input.getCacheDir
  const getPlatform = input.getPlatform
  const defaultCwd = input.DEFAULT_CWD || ''
  // 配置：调用方只传插件标识即跑，其余全走 #558 默认派生；默认配置下与旧实现同形。
  // 清单注入参数（eventList）经 resolveHostLogConfig 验形（对象当场验、字符串存、默认 null 透过）。
  const config: ResolvedHostLogConfig = resolveHostLogConfig(
    configInput === undefined ? { pluginId: 'wf' } : configInput
  )
  // 内存队列：调用处只进队列就返回，另起链路写盘。队列里是待写行对象。
  let queue: QueuedRow[] = []
  // 累计丢弃数：写盘失败与通道丢弃都只计数不抛错。
  let dropped = 0
  // 开关：全局整机一个开关，默认关闭；错误与告警始终落盘，其余只在开关打开时落盘。
  let switchEnabled = false
  let switchSampleRate = 1
  let switchLoaded = false
  // 单写者状态：宿主一次只写一份，队列正忙时新写入合并等待。
  let flushTimer: unknown = null
  let flushing = false
  let flushQueued = false
  // 落盘失败行：失败先记待发，同轮合并；在途已有一行未落定不再追加，避免失败自我繁殖。
  let pendingPersistFail: { op: string; reason: string; dir: string } | null = null
  let persistFailOutstanding = false
  function notePersistFail(op: string, reason: string, dir: string): void {
    if (!pendingPersistFail) pendingPersistFail = { op: op, reason: reason, dir: String(dir || '') }
    try {
      scheduleFlush(false)
    } catch (e) {
      void e
    }
  }
  // 启动头信息：每次启动写入进程标识、启动时间与实际目录，事后能区分哪几行来自哪个进程。
  let headerInfo: { pid: number; startedAt: string; dir: string } | null = null
  function currentPid(): number {
    try {
      const g = globalThis as { process?: { pid?: unknown } }
      return (g.process && typeof g.process.pid === 'number' ? g.process.pid : 0) || 0
    } catch (e) {
      void e
      return 0
    }
  }
  function currentStartedAt(): string {
    try {
      return headerInfo && headerInfo.startedAt ? headerInfo.startedAt : new Date().toISOString()
    } catch (e) {
      void e
      return ''
    }
  }
  function later(fn: () => void, ms: number): unknown {
    try {
      if (timer !== undefined && timer !== null && typeof timer.timeout === 'function') {
        return (timer as LogTimer).timeout(fn, ms)
      }
    } catch (e) {
      void e
    }
    return setTimeout(fn, ms)
  }
  function joinPath(a: string, b: string): string {
    return String(a).replace(/\/+$/, '') + '/' + String(b).replace(/^\/+/, '')
  }
  async function joinLogPath(dir: string, name: string): Promise<string> {
    try {
      const platform = typeof getPlatform === 'function' ? await getPlatform() : null
      if (platform && platform.path && typeof platform.path.join === 'function') {
        return platform.path.join(dir, name)
      }
    } catch (e) {
      void e
    }
    return joinPath(dir, name)
  }
  async function resolveTarget(pathStr: string): Promise<unknown> {
    try {
      const platform = typeof getPlatform === 'function' ? await getPlatform() : null
      if (platform && platform.fs && typeof platform.fs.resolve === 'function') {
        return await platform.fs.resolve(pathStr)
      }
    } catch (e) {
      void e
    }
    try {
      if (fs !== undefined && fs !== null && typeof fs.resolve === 'function') {
        return await fs.resolve(pathStr)
      }
    } catch (e2) {
      void e2
    }
    return pathStr
  }
  async function readTarget(target: unknown): Promise<string> {
    if (fs !== undefined && fs !== null && typeof fs.readText === 'function') {
      return await fs.readText(target)
    }
    const platform = typeof getPlatform === 'function' ? await getPlatform() : null
    if (platform && platform.fs && typeof platform.fs.readText === 'function') {
      return await platform.fs.readText(target)
    }
    throw new Error('文件服务不可读')
  }
  async function writeTarget(target: unknown, text: string): Promise<unknown> {
    if (fs !== undefined && fs !== null && typeof fs.writeText === 'function') {
      return await fs.writeText(target, text)
    }
    const platform = typeof getPlatform === 'function' ? await getPlatform() : null
    if (platform && platform.fs && typeof platform.fs.writeText === 'function') {
      return await platform.fs.writeText(target, text)
    }
    throw new Error('文件服务不可写')
  }
  async function ensureLogDir(logDir: string): Promise<void> {
    // 真正的建目录由写文件内部自动完成，这里建不上也不报错。
    try {
      const platform = typeof getPlatform === 'function' ? await getPlatform() : null
      if (platform && platform.fs && typeof platform.fs.mkdir === 'function') {
        try {
          await platform.fs.mkdir(logDir)
        } catch (e) {
          void e
        }
        return
      }
    } catch (e) {
      void e
    }
    try {
      if (fs !== undefined && fs !== null && typeof fs.mkdir === 'function') await fs.mkdir(logDir)
    } catch (e2) {
      void e2
    }
  }
  // 读当前级别是否允许产生日志；关闭时调用处直接返回。错误与告警始终允许。
  function isEnabled(level: string): boolean {
    if (level === 'error' || level === 'warn') return true
    return switchEnabled === true
  }
  // 队列满时按级别丢弃（#558 队列口径）：错误与告警优先，挤掉最旧的普通行；
  // 普通行满时直接丢掉新来的；都只计数不抛错。
  function dropForRoom(level: string): void {
    if (level === 'error' || level === 'warn') {
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].level !== 'error' && queue[i].level !== 'warn') {
          queue.splice(i, 1)
          dropped += 1
          return
        }
      }
    }
    dropped += 1
  }
  // 记一行日志：只进内存队列就返回，不等写盘完成。级别只有 error、warn、info、debug。
  function log(level: string, event: string, fields: Record<string, unknown>): void {
    if (!isEnabled(level)) return
    if (queue.length >= config.maxQueue) {
      dropForRoom(level)
      if (queue.length >= config.maxQueue) return
    }
    queue.push({
      ts: Date.now(),
      level: level,
      event: String(event || ''),
      fields: fields && typeof fields === 'object' ? fields : {}
    })
    if (level === 'error' || level === 'warn') scheduleFlush(true)
    else scheduleFlush(false)
  }
  // 安排一次刷盘：普通走 1000 毫秒防抖合并；错误与告警走直通（取消本次防抖等待，本轮事件循环末就写）。
  function scheduleFlush(immediate: boolean): void {
    if (immediate) {
      if (flushTimer !== null) {
        try {
          clearTimeout(flushTimer)
        } catch (e) {
          void e
        }
        flushTimer = null
      }
      later(flushNow, 0)
      return
    }
    if (flushTimer !== null) return
    flushTimer = later(flushNow, LOG_DEBOUNCE_MS)
  }
  // 仅宿主有效：取消本次防抖等待，本轮事件循环末写当天文件。
  function flush(): { ok: boolean } {
    if (flushTimer !== null) {
      try {
        clearTimeout(flushTimer)
      } catch (e) {
        void e
      }
      flushTimer = null
    }
    later(flushNow, 0)
    return { ok: true }
  }
  // 单写者刷盘：一次只写一份，写失败只计数不抛错；写盘中新到的行合并到下一轮。
  async function flushNow(): Promise<void> {
    flushTimer = null
    if (flushing) {
      flushQueued = true
      return
    }
    flushing = true
    try {
      while (queue.length > 0) {
        const batch = queue.splice(0, queue.length)
        try {
          if (await writeBatch(batch)) persistFailOutstanding = false
        } catch (e) {
          void e
          dropped += batch.length
        }
      }
    } finally {
      flushing = false
      if (pendingPersistFail) {
        const f = pendingPersistFail
        pendingPersistFail = null
        if (!persistFailOutstanding) {
          persistFailOutstanding = true
          try {
            log('warn', 'log.persist.fail', { op: f.op, reason: f.reason, dirHash: hashText(f.dir) })
          } catch (e) {
            void e
          }
        }
      }
      if (flushQueued) {
        flushQueued = false
        if (queue.length > 0) scheduleFlush(false)
      }
    }
  }
  // 一次读改写：文件服务无追加原语，任何追加都是全文读改写，按天分文件把单次覆写体积封顶在一天之内。
  async function writeBatch(batch: QueuedRow[]): Promise<boolean> {
    if (!batch || batch.length === 0) return true
    const lines: string[] = []
    for (let i = 0; i < batch.length; i++) {
      try {
        lines.push(
          JSON.stringify({ ts: batch[i].ts, level: batch[i].level, event: batch[i].event, fields: batch[i].fields })
        )
      } catch (e) {
        void e
        dropped += 1
      }
    }
    if (lines.length === 0) return true
    const text = lines.join('\n') + '\n'
    let failDir = ''
    try {
      const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null
      if (!dir) {
        dropped += lines.length
        notePersistFail('writeBatch', 'no-dir', '')
        return false
      }
      const logDir = await joinLogPath(dir, config.logDirName)
      failDir = logDir
      await ensureLogDir(logDir)
      const fileName = resolveLogFileName(config, new Date(), currentPid(), currentStartedAt())
      const target = await resolveTarget(await joinLogPath(logDir, fileName))
      let existing = ''
      try {
        existing = await readTarget(target)
      } catch (eRead) {
        void eRead
        existing = ''
      }
      await writeTarget(target, String(existing || '') + text)
      return true
    } catch (eWrite) {
      void eWrite
      dropped += lines.length
      notePersistFail('writeBatch', 'write-fail', failDir)
      return false
    }
  }
  // 读累计丢弃数（写盘失败与通道丢弃都只计数不抛错）。
  function getDroppedCount(): number {
    return dropped
  }
  function getSwitchState(): { enabled: boolean; sampleRate: number } {
    return { enabled: switchEnabled, sampleRate: switchSampleRate }
  }
  // 开关从盘上读回：缓存目录下开关文件，全文覆写，失败不抛错。重启后保持，对账以宿主为准。
  async function loadSwitch(): Promise<{ enabled: boolean; sampleRate: number }> {
    if (switchLoaded) return getSwitchState()
    switchLoaded = true
    try {
      const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null
      if (!dir) return getSwitchState()
      const target = await resolveTarget(await joinLogPath(dir, config.switchFileName))
      const txt = await readTarget(target)
      if (!txt) return getSwitchState()
      const parsed = JSON.parse(txt) as { enabled?: unknown; sampleRate?: unknown }
      if (parsed && typeof parsed.enabled === 'boolean') switchEnabled = parsed.enabled
      if (parsed && typeof parsed.sampleRate === 'number') switchSampleRate = parsed.sampleRate
    } catch (e) {
      void e
      notePersistFail('readBack', 'read-fail', '')
    }
    return getSwitchState()
  }
  async function persistSwitch(): Promise<void> {
    let failDir = ''
    try {
      const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null
      if (!dir) {
        notePersistFail('persistSwitch', 'no-dir', '')
        return
      }
      failDir = String(dir || '')
      const target = await resolveTarget(await joinLogPath(dir, config.switchFileName))
      await writeTarget(target, JSON.stringify({ enabled: switchEnabled, sampleRate: switchSampleRate }))
    } catch (e) {
      void e
      notePersistFail('persistSwitch', 'write-fail', failDir)
    }
  }
  async function setSwitch(enabled: boolean, sampleRate: number): Promise<{ enabled: boolean; sampleRate: number }> {
    switchEnabled = enabled === true
    if (typeof sampleRate === 'number' && isFinite(sampleRate)) switchSampleRate = sampleRate
    await persistSwitch()
    return getSwitchState()
  }
  // 启动头：每次启动在日志头写入进程标识、启动时间与实际目录；目录漂移时写实际目录头、不迁移旧日志。
  async function writeStartupHeader(): Promise<{ pid: number; startedAt: string; dir: string } | null> {
    try {
      const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null
      const pid = currentPid()
      headerInfo = { pid: pid, startedAt: new Date().toISOString(), dir: (dir as string) || defaultCwd || '' }
      log('info', 'host.start', { pid: headerInfo.pid, startedAt: headerInfo.startedAt, dir: headerInfo.dir })
    } catch (e) {
      void e
    }
    return headerInfo
  }
  function getHeaderInfo(): { pid: number; startedAt: string; dir: string } | null {
    return headerInfo
  }
  // 记录电话的宿主实现：入参 entries 加客户端累计丢弃数；回参接收条数加宿主侧累计丢弃数。
  // 失败降级为丢弃并计数，不背压等待。唯一例外：最外层 catch 回成功加接收 0 条（旧形状原样保留）。
  async function handleLogBatch(args: {
    entries?: unknown
    droppedCount?: unknown
  }): Promise<{ ok: boolean; accepted: number; dropped: number }> {
    try {
      const entries = args && Array.isArray(args.entries) ? (args.entries as LogEntry[]) : []
      for (let i = 0; i < entries.length; i++) {
        const item = entries[i] || ({} as LogEntry)
        try {
          log(item.level, item.event, item.fields)
        } catch (e) {
          void e
          dropped += 1
        }
      }
      return { ok: true, accepted: entries.length, dropped: getDroppedCount() }
    } catch (e) {
      void e
      return { ok: true, accepted: 0, dropped: getDroppedCount() }
    }
  }
  // 电话组：导出/清空/开关三组电话体在 ./phones.js，此处只留调用（包内静态引入）。
  // 依赖全显式传入；新文件不引用本文件，单向引用。
  const phones = createLogPhones({
    fs: fs,
    getCacheDir: getCacheDir,
    getPlatform: getPlatform,
    DEFAULT_CWD: defaultCwd,
    config: config,
    joinPath: joinPath,
    joinLogPath: joinLogPath,
    resolveTarget: resolveTarget,
    readTarget: readTarget,
    writeTarget: writeTarget,
    log: log,
    getSwitchState: getSwitchState,
    getHeaderInfo: getHeaderInfo,
    loadSwitch: loadSwitch,
    setSwitch: setSwitch
  })
  // 导出电话（实现见 phones.js；电话字面与回参与拆前同形）。
  async function handleLogExport(args: { date?: unknown; [key: string]: unknown }) {
    return phones.handleLogExport(args)
  }
  // 清空电话（实现见 phones.js；电话字面与回参与拆前同形）。
  async function handleLogClear(args: { date?: unknown }) {
    return phones.handleLogClear(args)
  }
  // 开关读电话（实现见 phones.js；电话字面与回参与拆前同形）。
  async function handleLogGetSwitch() {
    return phones.handleLogGetSwitch()
  }
  // 开关写电话（实现见 phones.js；电话字面与回参与拆前同形）。
  async function handleLogSetSwitch(args: { enabled?: unknown; sampleRate?: unknown }) {
    return phones.handleLogSetSwitch(args)
  }
  return {
    config: config,
    isEnabled: isEnabled,
    log: log,
    flush: flush,
    flushNow: flushNow,
    getDroppedCount: getDroppedCount,
    loadSwitch: loadSwitch,
    setSwitch: setSwitch,
    getSwitchState: getSwitchState,
    writeStartupHeader: writeStartupHeader,
    getHeaderInfo: getHeaderInfo,
    handleLogBatch: handleLogBatch,
    handleLogExport: handleLogExport,
    handleLogClear: handleLogClear,
    handleLogGetSwitch: handleLogGetSwitch,
    handleLogSetSwitch: handleLogSetSwitch
  }
}

export type LogStore = ReturnType<typeof createLogStore>
