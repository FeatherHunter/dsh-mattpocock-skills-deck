// src/host/logStore.js —— 宿主日志库（#490 host 底座，落实设计 #335 第 1、2、4 章的 host 部分；#500 拆出电话组）。
// 以后谁改它：改宿主落盘位置、按天分文件、防抖刷盘或开关持久化的人。导出/清空/开关三个电话体在 ./logPhones.js。
// 接线：由 src/host/index.js 动态 import 加载；文件服务、计时器、取缓存目录函数全部显式传入；电话组经本文件动态 import 加载（单向引用）。
// 它只做五件事：内存队列、级别判断、按天文件名、单写者刷盘、失败计数。宿主是唯一的落盘者。两文件各不超 300 行（#500 留余量）。
// 防抖窗口 1000 毫秒（设计 2.2 字面：窗口内多次调用合并为一次读改写）。
export const LOG_DEBOUNCE_MS = 1000
// 缓存目录下的独立日志子目录名（设计 2.1：.dsh-mattskillsdeck-cache/logs/）。
export const LOG_DIR_NAME = 'logs'
// 开关持久化文件名（设计 1.3：与命名守护 naming-guardian.json 同例，全文覆写，失败不抛错）。
export const LOG_SWITCH_FILE = 'log-switch.json'
// 按天文件名：每个自然天一个文件，命名 YYYY-MM-DD.log（如 2026-09-06.log）。只分桶，不自动清理。
// 短指纹（与客户端散列同算法）：目录只记散列不记原文，失败行自身也只带散列。
function hashText(text) {
  let h = 5381
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}
export function formatLogFileName(date) {
  const d = date instanceof Date ? date : new Date(date)
  const pad = function (n) { return String(n).padStart(2, '0') }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.log'
}
export function createLogStore(deps) {
  const input = deps || {}
  const fs = input.fs
  const timer = input.timer
  const getCacheDir = input.getCacheDir
  const getPlatform = input.getPlatform
  const defaultCwd = input.DEFAULT_CWD || ''
  // 内存队列：调用处只进队列就返回，另起链路写盘。队列里是待写行对象。
  let queue = []
  // 累计丢弃数：写盘失败与通道丢弃都只计数不抛错。
  let dropped = 0
  // 开关：全局整机一个开关，默认关闭；错误与告警始终落盘，其余只在开关打开时落盘。
  let switchEnabled = false
  let switchSampleRate = 1
  let switchLoaded = false
  // 单写者状态：宿主一次只写一份，队列正忙时新写入合并等待。
  let flushTimer = null
  let flushing = false
  let flushQueued = false
  // 落盘失败行（#499 自监控 47）：失败先记待发，同轮合并；在途已有一行未落定不再追加，避免失败自我繁殖。
  let pendingPersistFail = null
  let persistFailOutstanding = false
  function notePersistFail(op, reason, dir) {
    if (!pendingPersistFail) pendingPersistFail = { op: op, reason: reason, dir: String(dir || '') }
    try { scheduleFlush(false) } catch (e) {}
  }
  // 启动头信息：每次启动写入进程标识、启动时间与实际目录，事后能区分哪几行来自哪个进程。
  let headerInfo = null
  function later(fn, ms) {
    try {
      if (timer !== undefined && timer !== null && typeof timer.timeout === 'function') return timer.timeout(fn, ms)
    } catch (e) {}
    return setTimeout(fn, ms)
  }
  function joinPath(a, b) {
    return String(a).replace(/\/+$/, '') + '/' + String(b).replace(/^\/+/, '')
  }
  async function joinLogPath(dir, name) {
    try {
      const platform = typeof getPlatform === 'function' ? await getPlatform() : null
      if (platform && platform.path && typeof platform.path.join === 'function') return platform.path.join(dir, name)
    } catch (e) {}
    return joinPath(dir, name)
  }
  async function resolveTarget(pathStr) {
    try {
      const platform = typeof getPlatform === 'function' ? await getPlatform() : null
      if (platform && platform.fs && typeof platform.fs.resolve === 'function') return await platform.fs.resolve(pathStr)
    } catch (e) {}
    try {
      if (fs !== undefined && fs !== null && typeof fs.resolve === 'function') return await fs.resolve(pathStr)
    } catch (e2) {}
    return pathStr
  }
  async function readTarget(target) {
    if (fs !== undefined && fs !== null && typeof fs.readText === 'function') return await fs.readText(target)
    const platform = typeof getPlatform === 'function' ? await getPlatform() : null
    if (platform && platform.fs && typeof platform.fs.readText === 'function') return await platform.fs.readText(target)
    throw new Error('文件服务不可读')
  }
  async function writeTarget(target, text) {
    if (fs !== undefined && fs !== null && typeof fs.writeText === 'function') return await fs.writeText(target, text)
    const platform = typeof getPlatform === 'function' ? await getPlatform() : null
    if (platform && platform.fs && typeof platform.fs.writeText === 'function') return await platform.fs.writeText(target, text)
    throw new Error('文件服务不可写')
  }
  async function ensureLogDir(logDir) {
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
  function isEnabled(level) {
    if (level === 'error' || level === 'warn') return true
    return switchEnabled === true
  }
  // 记一行日志：只进内存队列就返回，不等写盘完成。级别只有 error、warn、info、debug。
  function log(level, event, fields) {
    if (!isEnabled(level)) return
    queue.push({ ts: Date.now(), level: level, event: String(event || ''), fields: fields && typeof fields === 'object' ? fields : {} })
    if (level === 'error' || level === 'warn') scheduleFlush(true)
    else scheduleFlush(false)
  }
  // 安排一次刷盘：普通走 1000 毫秒防抖合并；错误与告警走直通（取消本次防抖等待，本轮事件循环末就写）。
  function scheduleFlush(immediate) {
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
  async function writeBatch(batch) {
    if (!batch || batch.length === 0) return true
    const lines = []
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
  // 开关从盘上读回：缓存目录下 log-switch.json，全文覆写，失败不抛错。重启后保持，对账以宿主为准。
  async function loadSwitch() {
    if (switchLoaded) return getSwitchState()
    switchLoaded = true
    try {
      const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null
      if (!dir) return getSwitchState()
      const target = await resolveTarget(await joinLogPath(dir, LOG_SWITCH_FILE))
      const txt = await readTarget(target)
      if (!txt) return getSwitchState()
      const parsed = JSON.parse(txt)
      if (parsed && typeof parsed.enabled === 'boolean') switchEnabled = parsed.enabled
      if (parsed && typeof parsed.sampleRate === 'number') switchSampleRate = parsed.sampleRate
    } catch (e) { notePersistFail('readBack', 'read-fail', '') }
    return getSwitchState()
  }
  async function persistSwitch() {
    let failDir = ''
    try {
      const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null
      if (!dir) { notePersistFail('persistSwitch', 'no-dir', ''); return }
      failDir = String(dir || '')
      const target = await resolveTarget(await joinLogPath(dir, LOG_SWITCH_FILE))
      await writeTarget(target, JSON.stringify({ enabled: switchEnabled, sampleRate: switchSampleRate }))
    } catch (e) { notePersistFail('persistSwitch', 'write-fail', failDir) }
  }
  async function setSwitch(enabled, sampleRate) {
    switchEnabled = enabled === true
    if (typeof sampleRate === 'number' && isFinite(sampleRate)) switchSampleRate = sampleRate
    await persistSwitch()
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
  async function handleLogBatch(args) {
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
  let _phonesP = null
  function _phones() {
    if (!_phonesP) _phonesP = import('./logPhones.js').then(function (m) {
      return m.createLogPhones({ fs: fs, getCacheDir: getCacheDir, getPlatform: getPlatform, DEFAULT_CWD: defaultCwd, LOG_DIR_NAME: LOG_DIR_NAME, formatLogFileName: formatLogFileName, joinPath: joinPath, joinLogPath: joinLogPath, resolveTarget: resolveTarget, readTarget: readTarget, writeTarget: writeTarget, log: log, getSwitchState: getSwitchState, getHeaderInfo: getHeaderInfo, loadSwitch: loadSwitch, setSwitch: setSwitch })
    })
    return _phonesP
  }
  // 导出电话（实现见 logPhones.js；电话字面与回参与拆前同形）。
  async function handleLogExport(args) { const p = await _phones(); return p.handleLogExport(args) }
  // 清空电话（实现见 logPhones.js；电话字面与回参与拆前同形）。
  async function handleLogClear(args) { const p = await _phones(); return p.handleLogClear(args) }
  // 开关读电话（实现见 logPhones.js；电话字面与回参与拆前同形）。
  async function handleLogGetSwitch() { const p = await _phones(); return p.handleLogGetSwitch() }
  // 开关写电话（实现见 logPhones.js；电话字面与回参与拆前同形）。
  async function handleLogSetSwitch(args) { const p = await _phones(); return p.handleLogSetSwitch(args) }
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
