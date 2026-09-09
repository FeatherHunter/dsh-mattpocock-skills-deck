// packages/dsh-log/src/phones.ts —— 宿主日志电话组（由 src/host/logPhones.js 移植，行为零变化）。
//
// 以后谁改它：改导出/清空/开关三个电话实现的人。
// 接线：由 ./store.ts 静态引入；全部依赖经 createLogPhones 显式传入；本文件不引用其他新文件。
// 日志点沿旧实现原样保留（宿主调用失败记 host.call.fail，字段只用白名单内的电话名、类别、错误散列），
// 不新增事件，所以 research/489-appendix.md 第 1 章对照表不用改。

import {
  formatDailyFileName,
  resolveLogFileName,
  matchExportFileName,
  logFileNamePattern,
  type ResolvedHostLogConfig
} from './config.js'
import type { LogFileService, LogPlatform } from './store.js'

export interface LogPhonesContext {
  fs?: LogFileService | null
  getCacheDir?: () => Promise<string | null | ''> | string | null | ''
  getPlatform?: () => Promise<LogPlatform | null> | LogPlatform | null
  DEFAULT_CWD?: string
  config: ResolvedHostLogConfig
  joinPath: (a: string, b: string) => string
  joinLogPath: (dir: string, name: string) => Promise<string>
  resolveTarget: (pathStr: string) => Promise<unknown>
  readTarget: (target: unknown) => Promise<string>
  writeTarget: (target: unknown, text: string) => Promise<unknown>
  log: (level: string, event: string, fields: Record<string, unknown>) => void
  getSwitchState: () => { enabled: boolean; sampleRate: number }
  getHeaderInfo: () => { pid: number; startedAt: string; dir: string } | null
  loadSwitch: () => Promise<{ enabled: boolean; sampleRate: number }>
  setSwitch: (enabled: boolean, sampleRate: number) => Promise<{ enabled: boolean; sampleRate: number }>
  getPid?: () => number
  getStartedAt?: () => string
}

function hash8(s: unknown): string {
  try {
    const t = String(s || '')
    let h = 5381
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0
    return ('0000000' + h.toString(16)).slice(-8)
  } catch (e) {
    void e
    return '00000000'
  }
}

// 目标对象拆盒：优先可显示路径，无则回退值，回包只发字符串。
function targetToPath(t: unknown, fb: string): string {
  if (typeof t === 'string') return t
  if (t && typeof t === 'object') {
    const c = (t as Record<string, unknown>).displayPath || (t as Record<string, unknown>).path
    if (typeof c === 'string' && c) return c
  }
  return typeof fb === 'string' && fb ? fb : ''
}

async function listFileNames(
  ctx: LogPhonesContext,
  logDir: string
): Promise<string[]> {
  const { fs, getPlatform, resolveTarget } = ctx
  try {
    const platform = typeof getPlatform === 'function' ? await getPlatform() : null
    const listFn =
      platform && platform.fs && typeof platform.fs.listDir === 'function'
        ? platform.fs.listDir.bind(platform.fs)
        : fs && typeof fs.listDir === 'function'
          ? fs.listDir.bind(fs)
          : null
    if (!listFn) return []
    const dirTarget = await resolveTarget(logDir)
    const entries = (await listFn(dirTarget)) as Array<string | { name?: unknown }>
    if (!Array.isArray(entries)) return []
    return entries.map((x) => (typeof x === 'string' ? x : (x && typeof x.name === 'string' ? x.name : '')))
  } catch (e) {
    void e
    return []
  }
}

export function createLogPhones(ctx: LogPhonesContext) {
  const config = ctx.config
  const filePattern = logFileNamePattern(config)
  const pidOf = (): number => {
    try {
      if (typeof ctx.getPid === 'function') return ctx.getPid()
      const header = typeof ctx.getHeaderInfo === 'function' ? ctx.getHeaderInfo() : null
      if (header && typeof header.pid === 'number') return header.pid
      const g = globalThis as { process?: { pid?: unknown } }
      return (g.process && typeof g.process.pid === 'number' ? g.process.pid : 0) || 0
    } catch (e) {
      void e
      return 0
    }
  }
  const startedAtOf = (): string => {
    try {
      if (typeof ctx.getStartedAt === 'function') return ctx.getStartedAt()
      const header = typeof ctx.getHeaderInfo === 'function' ? ctx.getHeaderInfo() : null
      return (header && header.startedAt) || ''
    } catch (e) {
      void e
      return ''
    }
  }

  // 导出电话的宿主实现：内容为当天日志加系统信息摘要；先走回退（直接返回当天日志原文件加摘要文本文件）。
  async function handleLogExport(args: { date?: unknown; [key: string]: unknown }) {
    const headerInfo = typeof ctx.getHeaderInfo === 'function' ? ctx.getHeaderInfo() : null
    const now = new Date()
    const fallbackFileName = resolveLogFileName(config, now, pidOf(), startedAtOf())
    const want = args && args.date ? String(args.date) : formatDailyFileName(now).replace(/\.log$/, '')
    // 多余字段现状忽略（例如多传 format:'zip' 也不改变行为），保零变化。
    void (args && (args as Record<string, unknown>).format)
    try {
      const dir = typeof ctx.getCacheDir === 'function' ? await ctx.getCacheDir() : null
      if (!dir) {
        try {
          ctx.log('warn', 'host.call.fail', { method: config.prefix + '.logExport', kind: 'export', errorHash: hash8('no-dir') })
        } catch (eL) {
          void eL
        }
      }
      const baseDir = dir || (headerInfo && headerInfo.dir) || ctx.DEFAULT_CWD || ''
      const logDir = baseDir ? await ctx.joinLogPath(baseDir, config.logDirName) : ''
      let fileName = fallbackFileName
      if (config.fileNamePolicy === 'four-segment' && /^\d{4}-\d{2}-\d{2}$/.test(want) && logDir) {
        const candidates = await listFileNames(ctx, logDir)
        fileName = matchExportFileName(config, candidates, want, fallbackFileName)
      } else if (config.fileNamePolicy !== 'four-segment') {
        fileName = /^\d{4}-\d{2}-\d{2}$/.test(want) ? want + '.log' : fallbackFileName
      }
      let text = ''
      try {
        const target = await ctx.resolveTarget(await ctx.joinLogPath(logDir, fileName))
        text = await ctx.readTarget(target)
      } catch (e) {
        void e
        text = ''
      }
      let osName = ''
      try {
        const platform = typeof ctx.getPlatform === 'function' ? await ctx.getPlatform() : null
        const g = globalThis as { process?: { platform?: unknown } }
        osName = (platform && platform.os) || (typeof g.process !== 'undefined' ? String(g.process.platform) : '') || ''
      } catch (e2) {
        void e2
      }
      let cwdNow = ctx.DEFAULT_CWD || ''
      try {
        const g = globalThis as { process?: { cwd?: () => string } }
        cwdNow = g.process && g.process.cwd ? g.process.cwd() : ctx.DEFAULT_CWD || ''
      } catch (e3) {
        void e3
      }
      const summary = {
        pluginVersion: 'unknown',
        os: osName,
        cwd: cwdNow,
        logSwitch: ctx.getSwitchState(),
        header: headerInfo
      }
      let dirOut = logDir
      let pathOut = ''
      try {
        dirOut = targetToPath(await ctx.resolveTarget(logDir), logDir)
        pathOut = targetToPath(await ctx.resolveTarget(await ctx.joinLogPath(logDir, fileName)), ctx.joinPath(logDir, fileName))
      } catch (e4) {
        void e4
        try {
          pathOut = ctx.joinPath(logDir, fileName)
        } catch (e5) {
          void e5
          pathOut = ''
        }
      }
      if (!dirOut && !pathOut && baseDir) {
        try {
          dirOut = ctx.joinPath(baseDir, config.logDirName)
          pathOut = ctx.joinPath(dirOut, fileName)
        } catch (e6) {
          void e6
        }
      }
      // 上两处拆盒与回退链只产字符串，类型另由门禁断言。
      return {
        ok: true,
        fileName: fileName,
        bytes: String(text || '').length,
        fallback: true,
        text: String(text || ''),
        summary: summary,
        dir: dirOut,
        path: pathOut
      }
    } catch (e) {
      try {
        ctx.log('warn', 'host.call.fail', {
          method: config.prefix + '.logExport',
          kind: 'export',
          errorHash: hash8(String((e as Error && (e as Error).message) || e))
        })
      } catch (eL) {
        void eL
      }
      return { ok: false, fileName: fallbackFileName, bytes: 0, fallback: true }
    }
  }
  // 清空电话的宿主实现：手动清空，客户端先弹窗确认，成功与失败都给反馈。
  async function handleLogClear(args: { date?: unknown }) {
    const want = args && args.date ? String(args.date) : ''
    try {
      const dir = typeof ctx.getCacheDir === 'function' ? await ctx.getCacheDir() : null
      if (!dir) return { ok: true, removed: 0 }
      const logDir = await ctx.joinLogPath(dir, config.logDirName)
      if (want === 'all') {
        let removedAll = 0
        const names = await listFileNames(ctx, logDir)
        for (let i = 0; i < names.length; i++) {
          if (!filePattern.test(names[i])) continue
          if (await deleteOneFile(logDir, names[i])) removedAll += 1
        }
        return { ok: true, removed: removedAll }
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(want)) {
        try {
          ctx.log('warn', 'host.call.fail', { method: config.prefix + '.logClear', kind: 'clear', errorHash: hash8('bad-date') })
        } catch (eL) {
          void eL
        }
        return { ok: false, removed: 0 }
      }
      if (config.fileNamePolicy === 'four-segment') {
        const names = await listFileNames(ctx, logDir)
        const hits = names
          .filter((name) => filePattern.test(name) && name.indexOf(want + '.') === 0)
          .sort()
        let removed = 0
        for (const name of hits) {
          if (await deleteOneFile(logDir, name)) removed += 1
        }
        return { ok: true, removed: removed }
      }
      const done = await deleteOneFile(logDir, want + '.log')
      return { ok: true, removed: done ? 1 : 0 }
    } catch (e) {
      try {
        ctx.log('warn', 'host.call.fail', {
          method: config.prefix + '.logClear',
          kind: 'clear',
          errorHash: hash8(String((e as Error && (e as Error).message) || e))
        })
      } catch (eL) {
        void eL
      }
      return { ok: false, removed: 0 }
    }
  }
  async function deleteOneFile(logDir: string, name: string): Promise<boolean> {
    const { fs, getPlatform } = ctx
    try {
      const target = await ctx.resolveTarget(await ctx.joinLogPath(logDir, name))
      try {
        if (fs && typeof fs.unlink === 'function') {
          await fs.unlink(target)
          return true
        }
      } catch (e) {
        void e
      }
      try {
        const platform = typeof getPlatform === 'function' ? await getPlatform() : null
        if (platform && platform.fs && typeof platform.fs.unlink === 'function') {
          await platform.fs.unlink(target)
          return true
        }
      } catch (e2) {
        void e2
      }
      try {
        await ctx.writeTarget(target, '')
        return true
      } catch (e3) {
        void e3
        return false
      }
    } catch (e) {
      void e
      return false
    }
  }
  // 开关读电话：入参无；回参开关值与采样率。
  async function handleLogGetSwitch() {
    const state = await ctx.loadSwitch()
    return { ok: true, enabled: state.enabled, sampleRate: state.sampleRate }
  }
  // 开关写电话：入参开关值与采样率；回参实际生效值。
  async function handleLogSetSwitch(args: { enabled?: unknown; sampleRate?: unknown }) {
    const enabled = !!(args && args.enabled)
    const fallbackRate = typeof ctx.getSwitchState === 'function' ? ctx.getSwitchState().sampleRate : undefined
    const sampleRate = args && typeof args.sampleRate === 'number' ? args.sampleRate : fallbackRate
    const state = await ctx.setSwitch(enabled, sampleRate as number)
    return { ok: true, enabled: state.enabled }
  }
  return {
    handleLogExport: handleLogExport,
    handleLogClear: handleLogClear,
    handleLogGetSwitch: handleLogGetSwitch,
    handleLogSetSwitch: handleLogSetSwitch
  }
}

export type LogPhones = ReturnType<typeof createLogPhones>
