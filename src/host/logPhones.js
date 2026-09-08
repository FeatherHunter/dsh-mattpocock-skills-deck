// src/host/logPhones.js —— 宿主日志电话组（#500 从 logStore.js 拆出，纯结构、行为零变化）。
// 以后谁改它：改导出/清空/开关三个电话实现的人。预估约120行，超 300 打回（与 logStore.js 同受 #500 行数门禁）。
// 接线：由 logStore.js 动态 import 加载（D7 禁止静态 import）；全部依赖经 createLogPhones 显式传入；本文件不引用其他新文件。
export function createLogPhones(ctx) {
  const input = ctx || {}
  const fs = input.fs
  const getCacheDir = input.getCacheDir
  const getPlatform = input.getPlatform
  const defaultCwd = input.DEFAULT_CWD || ''
  const LOG_DIR_NAME = input.LOG_DIR_NAME || 'logs'
  const formatLogFileName = input.formatLogFileName
  const joinPath = input.joinPath
  const joinLogPath = input.joinLogPath
  const resolveTarget = input.resolveTarget
  const readTarget = input.readTarget
  const writeTarget = input.writeTarget
  const log = input.log
  const getSwitchState = input.getSwitchState
  const getHeaderInfo = input.getHeaderInfo
  const loadSwitch = input.loadSwitch
  const setSwitch = input.setSwitch
  function hash8(s) { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (e) { return '00000000' } }
  function targetToPath(t, fb) { if (typeof t === 'string') return t; if (t && typeof t === 'object') { const c = t.displayPath || t.path || t.__target || t.target; if (typeof c === 'string' && c) return c } return (typeof fb === 'string' && fb) ? fb : '' } // 目标对象拆盒：优先可显示路径，无则回退值，回包只发字符串。
  // 导出电话的宿主实现：内容为当天日志加系统信息摘要；先走回退（直接返回当天日志原文件加摘要文本文件）。
  async function handleLogExport(args) {
    const headerInfo = typeof getHeaderInfo === 'function' ? getHeaderInfo() : null
    const want = args && args.date ? String(args.date) : formatLogFileName(new Date()).replace(/\.log$/, '')
    const fileName = /^\d{4}-\d{2}-\d{2}$/.test(want) ? want + '.log' : formatLogFileName(new Date())
    try {
      const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null
      if (!dir) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'export', errorHash: hash8('no-dir') }) } catch (eL) {} }
      const baseDir = dir || (headerInfo && headerInfo.dir) || defaultCwd || ''; const logDir = baseDir ? await joinLogPath(baseDir, LOG_DIR_NAME) : ''
      let text = ''
      try {
        const target = await resolveTarget(await joinLogPath(logDir, fileName))
        text = await readTarget(target)
      } catch (e) { text = '' }
      let osName = ''
      try {
        const platform = typeof getPlatform === 'function' ? await getPlatform() : null
        osName = (platform && platform.os) || (typeof process !== 'undefined' ? process.platform : '') || ''
      } catch (e2) {}
      let cwdNow = defaultCwd
      try { cwdNow = (typeof process !== 'undefined' && process.cwd) ? process.cwd() : defaultCwd } catch (e3) {}
      const summary = { pluginVersion: 'unknown', os: osName, cwd: cwdNow, logSwitch: getSwitchState(), header: headerInfo }
      let dirOut = logDir, pathOut = ''
      try {
        dirOut = targetToPath(await resolveTarget(logDir), logDir)
        pathOut = targetToPath(await resolveTarget(await joinLogPath(logDir, fileName)), joinPath(logDir, fileName))
      } catch (e4) {
        try { pathOut = joinPath(logDir, fileName) } catch (e5) { pathOut = '' }
      }
      if (!dirOut && !pathOut && baseDir) { try { dirOut = joinPath(baseDir, LOG_DIR_NAME); pathOut = joinPath(dirOut, fileName) } catch (e6) {} }
      return { ok: true, fileName: fileName, bytes: String(text || '').length, fallback: true, text: String(text || ''), summary: summary, dir: dirOut, path: pathOut } // 上两处拆盒与回退链只产字符串，类型另由门禁断言。
    } catch (e) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'export', errorHash: hash8(String((e && e.message) || e)) }) } catch (eL) {}; return { ok: false, fileName: fileName, bytes: 0, fallback: true } }
  }
  // 清空电话的宿主实现：手动清空，客户端先弹窗确认，成功与失败都给反馈。
  async function handleLogClear(args) {
    const want = args && args.date ? String(args.date) : ''
    try {
      const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null
      if (!dir) return { ok: true, removed: 0 }
      const logDir = await joinLogPath(dir, LOG_DIR_NAME)
      if (want === 'all') {
        let removedAll = 0
        try {
          const platform = typeof getPlatform === 'function' ? await getPlatform() : null
          const listFn = (platform && platform.fs && typeof platform.fs.listDir === 'function') ? platform.fs.listDir : (fs && typeof fs.listDir === 'function' ? fs.listDir.bind(fs) : null)
          if (listFn) {
            const dirTarget = await resolveTarget(logDir)
            const entries = await listFn(dirTarget)
            const names = Array.isArray(entries) ? entries.map(function (x) { return typeof x === 'string' ? x : (x && x.name) || '' }) : []
            for (let i = 0; i < names.length; i++) {
              if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(names[i])) continue
              if (await deleteOneFile(logDir, names[i])) removedAll += 1
            }
          }
        } catch (e) {}
        return { ok: true, removed: removedAll }
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(want)) { try { log('warn', 'host.call.fail', { method: 'wf.logClear', kind: 'clear', errorHash: hash8('bad-date') }) } catch (eL) {}; return { ok: false, removed: 0 } }
      const done = await deleteOneFile(logDir, want + '.log')
      return { ok: true, removed: done ? 1 : 0 }
    } catch (e) { try { log('warn', 'host.call.fail', { method: 'wf.logClear', kind: 'clear', errorHash: hash8(String((e && e.message) || e)) }) } catch (eL) {}; return { ok: false, removed: 0 } }
  }
  async function deleteOneFile(logDir, name) {
    try {
      const target = await resolveTarget(await joinLogPath(logDir, name))
      try {
        if (fs && typeof fs.unlink === 'function') { await fs.unlink(target); return true }
      } catch (e) {}
      try {
        const platform = typeof getPlatform === 'function' ? await getPlatform() : null
        if (platform && platform.fs && typeof platform.fs.unlink === 'function') { await platform.fs.unlink(target); return true }
      } catch (e2) {}
      try { await writeTarget(target, ''); return true } catch (e3) { return false }
    } catch (e) { return false }
  }
  // 开关读电话：入参无；回参开关值与采样率。
  async function handleLogGetSwitch() {
    const state = await loadSwitch()
    return { ok: true, enabled: state.enabled, sampleRate: state.sampleRate }
  }
  // 开关写电话：入参开关值与采样率；回参实际生效值。
  async function handleLogSetSwitch(args) {
    const enabled = !!(args && args.enabled)
    const fallbackRate = typeof getSwitchState === 'function' ? getSwitchState().sampleRate : undefined
    const sampleRate = args && typeof args.sampleRate === 'number' ? args.sampleRate : fallbackRate
    const state = await setSwitch(enabled, sampleRate)
    return { ok: true, enabled: state.enabled }
  }
  return {
    handleLogExport: handleLogExport,
    handleLogClear: handleLogClear,
    handleLogGetSwitch: handleLogGetSwitch,
    handleLogSetSwitch: handleLogSetSwitch
  }
}
