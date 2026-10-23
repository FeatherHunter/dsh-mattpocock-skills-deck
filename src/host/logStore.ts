/**
 * src/host/logStore.ts —— 宿主日志库（来源：src/host/logStore.js，issue #1247 转写，本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：内存队列、级别判断、按天文件名、单写者刷盘与失败计数；导出、清空与开关三组电话体由 ./logPhones.js 承载，本文件只留动态加载器。
 *
 * 三条不能改的约定（改之前先看原 logStore.js 头注释与调用点 index.ts）：
 * 1. 行为零变化：逻辑逐行对应，只加类型标注与中文注释，不改任何运行时语义；相对导入保留 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts。
 * 2. 只写可剥离 TypeScript：不新增运行时语法（禁用 enum 与构造函数参数属性），类型一律 import type 或内联标注，转译后与原 .js 逐行同义。
 * 3. 不新增任何 import 边：只给已有引用加类型，不引入新模块依赖；Node 内建模块的类型缺席由文件内局部声明与 @ts-expect-error 承接，不装 @types/node。
 */

// 运行时的 process 兜底声明（与 src/host/git-process.ts:30 同形）：本 tsconfig 有意不加载任何类型包，Node 运行时保证 process 存在；只声明本文件实际用到的形状，不产生运行时代码。
declare const process: any;

// ---------------------------------------------------------------------------
// 类型（#1247 转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：进来的依赖全部由装配点显式传入，形状按本文件实际用到的成员写成最小；
// 从外面进来的东西（客户端参数、后端行数据、文件里读出的 JSON）一律按 any 或 unknown 收，
// 收窄发生在运行时的 typeof 与 Array.isArray 判断里 —— 类型不替代那些运行时判断。
// ---------------------------------------------------------------------------

/** 本文件组装函数的依赖：全部由调用方显式传入，缺席时按原逻辑默认处理。 */
type Deps = any;

/** 客户端调电话时送进来的参数：JSON 边界，形状由调用方保证，本文件只做运行时判空。 */
type WfArgs = any;

// src/host/logStore.js —— 宿主日志库（#490 host 底座，落实设计 #335 第 1、2、4 章的 host 部分；#500 拆出电话组）。
// 以后谁改它：改宿主落盘位置、按天分文件或防抖刷盘的人。导出/清空/开关三个电话体在 ./logPhones.js。
// 接线：由 src/host/index.js 动态 import 加载；文件服务、计时器、取缓存目录函数全部显式传入；电话组经本文件动态 import 加载（单向引用）。
// 它只做五件事：内存队列、级别判断、按天文件名、单写者刷盘、失败计数。宿主是唯一的落盘者。两文件各不超 300 行（#500 留余量）。
// #1432：调试开关只认本机设置文件一处真源。本文件不再读写缓存目录里那份旧版开关文件，开关从装配处递进来的 switchSource 问。
// 防抖窗口（设计 2.2 字面：窗口内多次调用合并为一次读改写）。
// 这个窗口管的是「短窗内来的多行日志合成一次落盘」：写日志的那一侧每记一行都会喊一次刷盘，
// 真按每次调用各写一次会把磁盘和文件服务拖住，所以窗口内的多次调用只换一次读改写。
// 值住中央 YAML（config/intervals.yaml 的 logWriteDebounceMs 键）：这里直接引用中央常量，调时间改 YAML。
// 路径走域构建产物写法，值由 tests/verify-time-config.ts 看守一致。
import { LOG_WRITE_DEBOUNCE_MS as LOG_DEBOUNCE_MS } from '../shared/time-config/src/values.js'
export { LOG_DEBOUNCE_MS }
// 缓存目录下的独立日志子目录名（设计 2.1：.dsh-mattskillsdeck-cache/logs/）。
export const LOG_DIR_NAME = 'logs'
// 开关不再有本文件自己的存档文件（#1432：真源是本机设置文件的 debug.enabled）——缓存目录里那份旧版开关文件是复印件，已整条删除。
// 按天文件名：每个自然天一个文件，命名 YYYY-MM-DD.log（如 2026-09-06.log）。只分桶，不自动清理。
// 短指纹（与客户端散列同算法）：目录只记散列不记原文，失败行自身也只带散列。
function hashText(text?: any) {
  let h = 5381
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}
export function formatLogFileName(date?: any): any {
  const d = date instanceof Date ? date : new Date(date)
  const pad = function(n?: any) { return String(n).padStart(2, '0') }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.log'
}
export function createLogStore(deps?: any): any {
  const input = deps || {}
  const fs = input.fs
  const timer = input.timer
  const getCacheDir = input.getCacheDir
  const getPlatform = input.getPlatform
  const defaultCwd = input.DEFAULT_CWD || ''
  // #1432：开关读写的真源口（装配处把本机设置文件的读写两格包成 { get, set } 递进来）；没接线时为 null。
  const switchSource = input.switchSource || null
  // 内存队列：调用处只进队列就返回，另起链路写盘。队列里是待写行对象。
  let queue: any[] = []
  // 累计丢弃数：写盘失败与通道丢弃都只计数不抛错。
  let dropped = 0
  // 开关：全局整机一个开关，默认关闭；错误与告警始终落盘，其余只在开关打开时落盘。
  let switchEnabled = false
  let switchSampleRate = 1
  let switchLoaded = false
  // 单写者状态：宿主一次只写一份，队列正忙时新写入合并等待。
  let flushTimer: any = null
  let flushing = false
  let flushQueued = false
  // 落盘失败行（#499 自监控 47）：失败先记待发，同轮合并；在途已有一行未落定不再追加，避免失败自我繁殖。
  let pendingPersistFail: any = null
  let persistFailOutstanding = false
  function notePersistFail(op?: any, reason?: any, dir?: any) {
    if (!pendingPersistFail) pendingPersistFail = { op: op, reason: reason, dir: String(dir || '') }
    try { scheduleFlush(false) } catch (e) {}
  }
  // 启动头信息：每次启动写入进程标识、启动时间与实际目录，事后能区分哪几行来自哪个进程。
  let headerInfo: any = null
  function later(fn?: any, ms?: any) {
    try {
      if (timer !== undefined && timer !== null && typeof timer.timeout === 'function') return timer.timeout(fn, ms)
    } catch (e) {}
    return setTimeout(fn, ms)
  }
  function joinPath(a?: any, b?: any) {
    return String(a).replace(/\/+$/, '') + '/' + String(b).replace(/^\/+/, '')
  }
  async function joinLogPath(dir?: any, name?: any) {
    try {
      const platform = typeof getPlatform === 'function' ? await getPlatform() : null
      if (platform && platform.path && typeof platform.path.join === 'function') return platform.path.join(dir, name)
    } catch (e) {}
    return joinPath(dir, name)
  }
  async function resolveTarget(pathStr?: any) {
    try {
      const platform = typeof getPlatform === 'function' ? await getPlatform() : null
      if (platform && platform.fs && typeof platform.fs.resolve === 'function') return await platform.fs.resolve(pathStr)
    } catch (e) {}
    try {
      if (fs !== undefined && fs !== null && typeof fs.resolve === 'function') return await fs.resolve(pathStr)
    } catch (e2) {}
    return pathStr
  }
  async function readTarget(target?: any) {
    if (fs !== undefined && fs !== null && typeof fs.readText === 'function') return await fs.readText(target)
    const platform = typeof getPlatform === 'function' ? await getPlatform() : null
    if (platform && platform.fs && typeof platform.fs.readText === 'function') return await platform.fs.readText(target)
    throw new Error('文件服务不可读')
  }
  async function writeTarget(target?: any, text?: any) {
    if (fs !== undefined && fs !== null && typeof fs.writeText === 'function') return await fs.writeText(target, text)
    const platform = typeof getPlatform === 'function' ? await getPlatform() : null
    if (platform && platform.fs && typeof platform.fs.writeText === 'function') return await platform.fs.writeText(target, text)
    throw new Error('文件服务不可写')
  }
  async function ensureLogDir(logDir?: any) {
    // 真正的建目录由写文件内部自动完成，这里建不上也不报错。
    try {
      const platform = typeof getPlatform === 'function' ? await getPlatform() : null
      if (platform && platform.fs && typeof platform.fs.mkdir === 'function') {
        try { await platform.fs.mkdir(logDir) } catch (e) {}
        return
      }
    } catch (e) {}
    try {
      if (fs !== undefined && fs !== null && typeof fs.mkdir === 'function') await fs.mkdir(logDir)
    } catch (e2) {}
  }
  // 读当前级别是否允许产生日志；关闭时调用处直接返回。错误与告警始终允许。
  function isEnabled(level?: any) {
    if (level === 'error' || level === 'warn') return true
    return switchEnabled === true
  }
  // 记一行日志：只进内存队列就返回，不等写盘完成。级别只有 error、warn、info、debug。
  function log(level?: any, event?: any, fields?: any) {
    if (!isEnabled(level)) return
    queue.push({ ts: Date.now(), level: level, event: String(event || ''), fields: fields && typeof fields === 'object' ? fields : {} })
    if (level === 'error' || level === 'warn') scheduleFlush(true)
    else scheduleFlush(false)
  }
  // 安排一次刷盘：普通走 1000 毫秒防抖合并；错误与告警走直通（取消本次防抖等待，本轮事件循环末就写）。
  function scheduleFlush(immediate?: any) {
    if (immediate) {
      if (flushTimer !== null) { try { clearTimeout(flushTimer) } catch (e) {} flushTimer = null }
      later(flushNow, 0)
      return
    }
    if (flushTimer !== null) return
    flushTimer = later(flushNow, LOG_DEBOUNCE_MS)
  }
  // 仅宿主有效：取消本次防抖等待，本轮事件循环末写当天文件。
  function flush() {
    if (flushTimer !== null) { try { clearTimeout(flushTimer) } catch (e) {} flushTimer = null }
    later(flushNow, 0)
    return { ok: true }
  }
  // 单写者刷盘：一次只写一份，写失败只计数不抛错；写盘中新到的行合并到下一轮。
  async function flushNow() {
    flushTimer = null
    if (flushing) { flushQueued = true; return }
    flushing = true
    try {
      while (queue.length > 0) {
        const batch = queue.splice(0, queue.length)
        try {
          if (await writeBatch(batch)) persistFailOutstanding = false
        } catch (e) { dropped += batch.length }
      }
    } finally {
      flushing = false
      if (pendingPersistFail) {
        const f = pendingPersistFail; pendingPersistFail = null
        if (!persistFailOutstanding) {
          persistFailOutstanding = true
          try { log('warn', 'log.persist.fail', { op: f.op, reason: f.reason, dirHash: hashText(f.dir) }) } catch (e) {}
        }
      }
      if (flushQueued) { flushQueued = false; if (queue.length > 0) scheduleFlush(false) }
    }
  }
  // 一次读改写：文件服务无追加原语，任何追加都是全文读改写，按天分文件把单次覆写体积封顶在一天之内。
  async function writeBatch(batch?: any) {
    if (!batch || batch.length === 0) return true
    const lines: any[] = []
    for (let i = 0; i < batch.length; i++) {
      try {
        lines.push(JSON.stringify({ ts: batch[i].ts, level: batch[i].level, event: batch[i].event, fields: batch[i].fields }))
      } catch (e) { dropped += 1 }
    }
    if (lines.length === 0) return true
    const text = lines.join('\n') + '\n'
    let failDir = ''
    try {
      const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null
      if (!dir) { dropped += lines.length; notePersistFail('writeBatch', 'no-dir', ''); return false }
      const logDir = await joinLogPath(dir, LOG_DIR_NAME); failDir = logDir
      await ensureLogDir(logDir)
      const fileName = formatLogFileName(new Date())
      const target = await resolveTarget(await joinLogPath(logDir, fileName))
      let existing = ''
      try { existing = await readTarget(target) } catch (eRead) { existing = '' }
      await writeTarget(target, String(existing || '') + text)
      return true
    } catch (eWrite) { dropped += lines.length; notePersistFail('writeBatch', 'write-fail', failDir); return false }
  }
  // 读累计丢弃数（写盘失败与通道丢弃都只计数不抛错）。
  function getDroppedCount() {
    return dropped
  }
  function getSwitchState() {
    return { enabled: switchEnabled, sampleRate: switchSampleRate }
  }
  // 开关的真源在用户主目录的设置文件里（#1432），本文件不再自己存一份：装配处把读写两格作为 switchSource 递进来，
  // 开机这里问一次并把值搬进内存（问不到就按关闭处理，不抛错）。老调用方没接线时保持「没人告诉过，按关闭」。
  async function loadSwitch() {
    if (switchLoaded) return getSwitchState()
    switchLoaded = true
    try {
      if (switchSource && typeof switchSource.get === 'function') {
        const on = await switchSource.get()
        if (on === true || on === false) switchEnabled = on
      }
    } catch (e) {}
    return getSwitchState()
  }
  // 拨开关只改内存里这一份，再把新值交给真源去落盘（switchSource.set）；落盘成败不改变本次回包里的生效值，
  // 与旧实现「失败只计数不抛错」同一口径。没接线时只改内存，不写盘。
  async function setSwitch(enabled?: any, sampleRate?: any) {
    switchEnabled = enabled === true
    if (typeof sampleRate === 'number' && isFinite(sampleRate)) switchSampleRate = sampleRate
    try {
      if (switchSource && typeof switchSource.set === 'function') await switchSource.set(switchEnabled)
    } catch (e) {}
    return getSwitchState()
  }
  // 启动头：每次启动在日志头写入进程标识、启动时间与实际目录；目录漂移时写实际目录头、不迁移旧日志。
  async function writeStartupHeader() {
    try {
      const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null
      let pid = 0
      try { pid = (typeof process !== 'undefined' && process.pid) || 0 } catch (e) {}
      headerInfo = { pid: pid, startedAt: new Date().toISOString(), dir: dir || defaultCwd || '' }
      log('info', 'host.start', { pid: headerInfo.pid, startedAt: headerInfo.startedAt, dir: headerInfo.dir })
    } catch (e) {}
    return headerInfo
  }
  function getHeaderInfo() {
    return headerInfo
  }
  // 记录电话的宿主实现：入参 entries 加客户端累计丢弃数；回参接收条数加宿主侧累计丢弃数。失败降级为丢弃并计数，不背压等待。
  async function handleLogBatch(args?: any) {
    try {
      const entries = args && Array.isArray(args.entries) ? args.entries : []
      for (let i = 0; i < entries.length; i++) {
        const item = entries[i] || {}
        try { log(item.level, item.event, item.fields) } catch (e) { dropped += 1 }
      }
      return { ok: true, accepted: entries.length, dropped: getDroppedCount() }
    } catch (e) { return { ok: true, accepted: 0, dropped: getDroppedCount() } }
  }
  // 电话组（#500 拆出）：导出/清空/开关三组电话体已搬到 ./logPhones.js，此处只留动态加载器（D7 禁止静态 import）。
  // 依赖全显式传入（helpers 与开关/头存取器均为闭包引用，读到永远是当前值）；新文件不引用本文件，单向引用。
  let _phonesP: any = null
  function _phones() {
    if (!_phonesP) _phonesP = import('./logPhones.js').then(function(m?: any) {
      return m.createLogPhones({ fs: fs, getCacheDir: getCacheDir, getPlatform: getPlatform, DEFAULT_CWD: defaultCwd, LOG_DIR_NAME: LOG_DIR_NAME, formatLogFileName: formatLogFileName, joinPath: joinPath, joinLogPath: joinLogPath, resolveTarget: resolveTarget, readTarget: readTarget, writeTarget: writeTarget, log: log, getSwitchState: getSwitchState, getHeaderInfo: getHeaderInfo, loadSwitch: loadSwitch, setSwitch: setSwitch })
    })
    return _phonesP
  }
  // 导出电话（实现见 logPhones.js；电话字面与回参与拆前同形）。
  async function handleLogExport(args?: any) { const p = await _phones(); return p.handleLogExport(args) }
  // 清空电话（实现见 logPhones.js；电话字面与回参与拆前同形）。
  async function handleLogClear(args?: any) { const p = await _phones(); return p.handleLogClear(args) }
  // 开关读电话（实现见 logPhones.js；电话字面与回参与拆前同形）。
  async function handleLogGetSwitch() { const p = await _phones(); return p.handleLogGetSwitch() }
  // 开关写电话（实现见 logPhones.js；电话字面与回参与拆前同形）。
  async function handleLogSetSwitch(args?: any) { const p = await _phones(); return p.handleLogSetSwitch(args) }
  return {
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
