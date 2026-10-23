/**
 * src/host/logPhones.ts —— 宿主日志电话组（来源：src/host/logPhones.js，#500 从 logStore.js 拆出，纯结构、行为零变化；本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：导出、清空、开关读写这四通电话是宿主唯一会动日志文件的入口，全部收在这里组装，调用点只按名取，不各写各的文件路径算法。
 *
 * 三条不能改的约定（改之前先看文件头原来那段注释与调用点 logStore.js）：
 * 1. 由 logStore.js 动态引用加载（禁止静态引用），全部依赖经组装函数显式传入，本文件不引用其它新文件。
 * 2. 导出电话走回退语义：直接返回当天日志原文件加摘要文本文件，不做压缩与分页。
 * 3. 目标对象拆盒只产字符串：优先取可显示路径，没有就回退，类型另由门禁断言，本文件不抛类型错。
 */

// 运行时的 process 声明（与 src/refresh/rooms/host/git-execution.ts:30 同形）：本文件只在「平台没报操作系统名与当前目录」时读它，且都按「可能不存在」写（见导出电话里的两处 typeof 守卫）。
declare const process: { platform?: string; cwd?: () => string } | undefined

// ---------------------------------------------------------------------------
// 类型（本次转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：进来的依赖（文件服务、取缓存目录、取平台、路径拼接、目标拆装、日志与开关六件套）全部由 logStore.js 注入，缺了哪件运行时就少哪件，所以按本文件实际用到的成员写成最小形状；从客户端进来的入参（日期、开关值）按未知收，收窄发生在正则与 typeof 判断里，类型不替代那些判断。
// ---------------------------------------------------------------------------

/** 组装函数收到的依赖：logStore.js 显式传入的全部能力（缺了哪件那条电话就走对应的失败分支）。 */
interface LogPhonesDeps {
  fs?: unknown
  getCacheDir?: unknown
  getPlatform?: unknown
  DEFAULT_CWD?: unknown
  LOG_DIR_NAME?: unknown
  formatLogFileName?: unknown
  joinPath?: unknown
  joinLogPath?: unknown
  resolveTarget?: unknown
  readTarget?: unknown
  writeTarget?: unknown
  log?: unknown
  getSwitchState?: unknown
  getHeaderInfo?: unknown
  loadSwitch?: unknown
  setSwitch?: unknown
  [key: string]: unknown
}

/** 组装产出的四通电话：导出、清空、开关读、开关写，调用点按名取。 */
export interface LogPhones {
  handleLogExport: (args: unknown) => Promise<unknown>
  handleLogClear: (args: unknown) => Promise<unknown>
  handleLogGetSwitch: () => Promise<unknown>
  handleLogSetSwitch: (args: unknown) => Promise<unknown>
}

/**
 * 组装宿主日志四通电话（全部依赖经参数显式传入）。
 *
 * 为什么：四通电话共享同一套目录算法与开关状态，收在一处组装能保证算出来的文件名同形。
 * 什么约定不能改：返回对象的四个字段名是 logStore.js 按名取的，改名那条电话就接不上。
 */
export function createLogPhones(ctx: LogPhonesDeps): LogPhones {
  const input: LogPhonesDeps = ctx || {}
  const fs: any = input.fs
  const getCacheDir: any = input.getCacheDir
  const getPlatform: any = input.getPlatform
  const defaultCwd: string = (input.DEFAULT_CWD as string) || ''
  const LOG_DIR_NAME: string = (input.LOG_DIR_NAME as string) || 'logs'
  const formatLogFileName: any = input.formatLogFileName
  const joinPath: any = input.joinPath
  const joinLogPath: any = input.joinLogPath
  const resolveTarget: any = input.resolveTarget
  const readTarget: any = input.readTarget
  const writeTarget: any = input.writeTarget
  const log: any = input.log
  const getSwitchState: any = input.getSwitchState
  const getHeaderInfo: any = input.getHeaderInfo
  const loadSwitch: any = input.loadSwitch
  const setSwitch: any = input.setSwitch
  function hash8(s: unknown): string { try { const t: string = String(s || ''); let h: number = 5381; for (let i: number = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch (_e: unknown) { return '00000000' } }
  function targetToPath(t: unknown, fb: unknown): string { if (typeof t === 'string') return t; if (t && typeof t === 'object') { const c: unknown = (t as Record<string, unknown>).displayPath || (t as Record<string, unknown>).path || (t as Record<string, unknown>).__target || (t as Record<string, unknown>).target; if (typeof c === 'string' && c) return c } return (typeof fb === 'string' && fb) ? fb : '' } // 目标对象拆盒：优先可显示路径，无则回退值，回包只发字符串。
  // 导出电话的宿主实现：内容为当天日志加系统信息摘要；先走回退（直接返回当天日志原文件加摘要文本文件）。
  async function handleLogExport(args: unknown): Promise<unknown> {
    const headerInfo: any = typeof getHeaderInfo === 'function' ? getHeaderInfo() : null
    const want: string = (args as { date?: unknown } | null | undefined) && (args as { date?: unknown }).date ? String((args as { date?: unknown }).date) : formatLogFileName(new Date()).replace(/\.log$/, '')
    const fileName: string = /^\d{4}-\d{2}-\d{2}$/.test(want) ? want + '.log' : formatLogFileName(new Date())
    try {
      const dir: any = typeof getCacheDir === 'function' ? await getCacheDir() : null
      if (!dir) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'export', errorHash: hash8('no-dir') }) } catch (_eL: unknown) {} }
      const baseDir: string = dir || (headerInfo && headerInfo.dir) || defaultCwd || ''; const logDir: string = baseDir ? await joinLogPath(baseDir, LOG_DIR_NAME) : ''
      let text: string = ''
      try {
        const target: unknown = await resolveTarget(await joinLogPath(logDir, fileName))
        text = await readTarget(target)
      } catch (_e: unknown) { text = '' }
      let osName: string = ''
      try {
        const platform: any = typeof getPlatform === 'function' ? await getPlatform() : null
        osName = (platform && platform.os) || (typeof process !== 'undefined' ? process.platform : '') || ''
      } catch (_e2: unknown) {}
      let cwdNow: string = defaultCwd
      try { cwdNow = (typeof process !== 'undefined' && process.cwd) ? process.cwd() : defaultCwd } catch (_e3: unknown) {}
      const summary: Record<string, unknown> = { pluginVersion: 'unknown', os: osName, cwd: cwdNow, logSwitch: getSwitchState(), header: headerInfo }
      let dirOut: string = logDir, pathOut: string = ''
      try {
        dirOut = targetToPath(await resolveTarget(logDir), logDir)
        pathOut = targetToPath(await resolveTarget(await joinLogPath(logDir, fileName)), joinPath(logDir, fileName))
      } catch (_e4: unknown) {
        try { pathOut = joinPath(logDir, fileName) } catch (_e5: unknown) { pathOut = '' }
      }
      if (!dirOut && !pathOut && baseDir) { try { dirOut = joinPath(baseDir, LOG_DIR_NAME); pathOut = joinPath(dirOut, fileName) } catch (_e6: unknown) {} }
      return { ok: true, fileName: fileName, bytes: String(text || '').length, fallback: true, text: String(text || ''), summary: summary, dir: dirOut, path: pathOut } // 上两处拆盒与回退链只产字符串，类型另由门禁断言。
    } catch (e: unknown) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'export', errorHash: hash8(String(((e as { message?: unknown }) && (e as { message?: unknown }).message) || e)) }) } catch (_eL: unknown) {}; return { ok: false, fileName: fileName, bytes: 0, fallback: true } }
  }
  // 清空电话的宿主实现：手动清空，客户端先弹窗确认，成功与失败都给反馈。
  async function handleLogClear(args: unknown): Promise<unknown> {
    const want: string = (args as { date?: unknown } | null | undefined) && (args as { date?: unknown }).date ? String((args as { date?: unknown }).date) : ''
    try {
      const dir: any = typeof getCacheDir === 'function' ? await getCacheDir() : null
      if (!dir) return { ok: true, removed: 0 }
      const logDir: string = await joinLogPath(dir, LOG_DIR_NAME)
      if (want === 'all') {
        let removedAll: number = 0
        try {
          const platform: any = typeof getPlatform === 'function' ? await getPlatform() : null
          const listFn: any = (platform && platform.fs && typeof platform.fs.listDir === 'function') ? platform.fs.listDir : (fs && typeof fs.listDir === 'function' ? fs.listDir.bind(fs) : null)
          if (listFn) {
            const dirTarget: unknown = await resolveTarget(logDir)
            const entries: unknown = await listFn(dirTarget)
            const names: string[] = Array.isArray(entries) ? (entries as unknown[]).map(function (x: unknown): string { return typeof x === 'string' ? x : ((x as { name?: unknown } | null) && (x as { name?: unknown }).name as string) || '' }) : []
            for (let i: number = 0; i < names.length; i++) {
              if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(names[i])) continue
              if (await deleteOneFile(logDir, names[i])) removedAll += 1
            }
          }
        } catch (_e: unknown) {}
        return { ok: true, removed: removedAll }
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(want)) { try { log('warn', 'host.call.fail', { method: 'wf.logClear', kind: 'clear', errorHash: hash8('bad-date') }) } catch (_eL: unknown) {}; return { ok: false, removed: 0 } }
      const done: unknown = await deleteOneFile(logDir, want + '.log')
      return { ok: true, removed: done ? 1 : 0 }
    } catch (e: unknown) { try { log('warn', 'host.call.fail', { method: 'wf.logClear', kind: 'clear', errorHash: hash8(String(((e as { message?: unknown }) && (e as { message?: unknown }).message) || e)) }) } catch (_eL: unknown) {}; return { ok: false, removed: 0 } }
  }
  async function deleteOneFile(logDir: string, name: string): Promise<boolean> {
    try {
      const target: unknown = await resolveTarget(await joinLogPath(logDir, name))
      try {
        if (fs && typeof fs.unlink === 'function') { await fs.unlink(target); return true }
      } catch (_e: unknown) {}
      try {
        const platform: any = typeof getPlatform === 'function' ? await getPlatform() : null
        if (platform && platform.fs && typeof platform.fs.unlink === 'function') { await platform.fs.unlink(target); return true }
      } catch (_e2: unknown) {}
      try { await writeTarget(target, ''); return true } catch (_e3: unknown) { return false }
    } catch (_e: unknown) { return false }
  }
  // 开关读电话：入参无；回参开关值与采样率。
  async function handleLogGetSwitch(): Promise<unknown> {
    const state: any = await loadSwitch()
    return { ok: true, enabled: state.enabled, sampleRate: state.sampleRate }
  }
  // 开关写电话：入参开关值与采样率；回参实际生效值。
  async function handleLogSetSwitch(args: unknown): Promise<unknown> {
    const enabled: boolean = !!((args as { enabled?: unknown } | null | undefined) && (args as { enabled?: unknown }).enabled)
    const fallbackRate: unknown = typeof getSwitchState === 'function' ? getSwitchState().sampleRate : undefined
    const sampleRate: unknown = (args as { sampleRate?: unknown } | null | undefined) && typeof (args as { sampleRate?: unknown }).sampleRate === 'number' ? (args as { sampleRate?: unknown }).sampleRate : fallbackRate
    const state: any = await setSwitch(enabled, sampleRate)
    return { ok: true, enabled: state.enabled }
  }
  return {
    handleLogExport: handleLogExport,
    handleLogClear: handleLogClear,
    handleLogGetSwitch: handleLogGetSwitch,
    handleLogSetSwitch: handleLogSetSwitch
  }
}
