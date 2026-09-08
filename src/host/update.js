/**
 * src/host/update.js — 更新模块的宿主接线（三个电话 + 宿主种类探测 + 安装执行零件）
 *
 * 电话只做三件事：查状态（只读本地）、查新版（用户点了才联网一次）、装更新（拿凭证提交）。
 * 读取器把本机现状翻译成核心要的零件（updateReader，同层边记基线）；
 * 任务落盘与安装执行在 updateStore（同层边记基线）。跨层引用共享层允许。
 */

import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACKAGE_NAME, validVersion } from '../shared/update/service.js'
import { manualCommand } from '../shared/update/commands.js'
import { createUpdateDiskPorts, createUpdateExecutor } from './updateStore.js'
import {
  containingPackage,
  createDeckUpdateReader,
  defaultHomeDir,
} from './updateReader.js'

export { createDeckUpdateReader, profileNameValid, registrySpec } from './updateReader.js'

// ---------- 更新电话（#541 两只读 + #542 装更新；单例让查状态看到查新版的结果） ----------
let sharedReader = null
let sharedReaderKey = ''
/** 桌面宿主才有：launcher 注册的公开服务，嵌套注入拿到后缓存（普通 DSH 拿不到也不报错）。 */
let sharedDesktopPnpm = null

function ctxService(ctx, name) {
  try {
    return ctx && typeof ctx.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

/**
 * 宿主种类：桌面宿主的官方信号是 desktopProfiles 服务是否存在
 * （launcher 在 Loader entry 挂载前注册），不得用使用范围名判断宿主。
 */
export function detectEnvironmentKind(ctx) {
  const profiles = ctxService(ctx, 'desktopProfiles')
  return profiles === undefined || profiles === null ? 'cli' : 'desktop'
}

/** 桌面服务用嵌套注入拿：不把桌面服务放进顶层依赖声明，普通 DSH 才能照常加载。 */
function watchDesktopPnpm(ctx) {
  try {
    if (detectEnvironmentKind(ctx) !== 'desktop') return
    if (typeof ctx.inject !== 'function') return
    ctx.inject(['desktopPnpm'], (desktopCtx) => {
      try {
        if (desktopCtx && desktopCtx.desktopPnpm) sharedDesktopPnpm = desktopCtx.desktopPnpm
      } catch {}
    })
  } catch {}
}

/** 安装执行结果进日志（常驻事件 update.install.exec，由执行器在跨边界调用后发）。 */
function emitInstallLog(level, event, fields) {
  try {
    if (phoneLogCtx && typeof phoneLogCtx.fire === 'function') phoneLogCtx.fire(level, event, fields)
  } catch {}
}

function hash8(s) {
  try {
    const t = String(s || '')
    let h = 5381
    for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
    return (`0000000${h.toString(16)}`).slice(-8)
  } catch {
    return '00000000'
  }
}

/** 从已装位置反推使用范围目录：装好的包住在 <范围>/node_modules 下，开发目录走默认范围。 */
async function inferProfileDir(loaded, homeDirDefault) {
  try {
    const dir = loaded && loaded.directory ? String(loaded.directory) : ''
    const marker = `${sep}node_modules${sep}${PACKAGE_NAME}`
    const at = dir.lastIndexOf(marker)
    if (at > 0) {
      const candidate = dir.slice(0, at)
      try {
        return await realpath(candidate)
      } catch {
        return candidate
      }
    }
  } catch {}
  return join(homeDirDefault, 'profiles', 'web')
}
async function getSharedReader(overrides = {}) {
  const env = overrides.env ?? process.env
  const osHome = overrides.osHome ?? homedir()
  const homeDirDefault = defaultHomeDir(env, osHome)
  const loaded = await containingPackage(fileURLToPath(import.meta.url), PACKAGE_NAME).catch(() => null)
  const runningVersion = overrides.runningVersion
    ?? (loaded && validVersion(loaded.manifest.version) ? loaded.manifest.version : null)
  if (!runningVersion) throw Object.assign(new Error('unknown-profile'), { code: 'unknown-profile' })
  const profileDirInput = overrides.profileDir ?? await inferProfileDir(loaded, homeDirDefault)
  const homeDirInput = overrides.homeDir ?? homeDirDefault
  const environmentKind = overrides.environmentKind ?? detectEnvironmentKind(overrides.ctx)
  const key = `${runningVersion}\0${profileDirInput}\0${overrides.profileName ?? ''}\0${homeDirInput}\0${overrides.runInstall ? 'exec' : ''}\0${environmentKind}`
  if (sharedReader && sharedReaderKey === key) return sharedReader
  const disk = overrides.readJob && overrides.writeJob ? null : createUpdateDiskPorts(homeDirInput, profileDirInput)
  // 执行零件按需现取（桌面服务要等注入到位）：路由与参数形态由核心的 installRecipe 定，
  // 这里只提供「用哪个可执行文件、哪份 CLI 入口、哪条子进程口子」。
  const defaultRun = createUpdateExecutor({
    profileName: overrides.profileName ?? null,
    environmentKind,
    profileDir: profileDirInput,
    subprocess: () => overrides.subprocess ?? ctxService(overrides.ctx, 'subprocess'),
    desktopPnpm: () => overrides.desktopPnpm ?? sharedDesktopPnpm,
    desktopProfiles: () => overrides.desktopProfiles ?? ctxService(overrides.ctx, 'desktopProfiles'),
    runtimeExecutable: () => overrides.runtimeExecutable,
    runtimeExecArgs: () => overrides.runtimeExecArgs,
    cliEntry: () => overrides.cliEntry,
    log: emitInstallLog,
  })
  sharedReader = createDeckUpdateReader({
    runningVersion,
    profileDir: profileDirInput,
    profileName: overrides.profileName,
    homeDir: overrides.homeDir,
    env,
    osHome,
    fetchImpl: overrides.fetchImpl,
    now: overrides.now,
    randomId: overrides.randomId,
    nodeVersion: overrides.nodeVersion,
    environmentKind,
    readInstalled: overrides.readInstalled,
    readJob: overrides.readJob ?? disk?.readJob,
    writeJob: overrides.writeJob ?? disk?.writeJob,
    tryAcquireLock: overrides.tryAcquireLock ?? disk?.tryAcquireLock,
    releaseLock: overrides.releaseLock ?? disk?.releaseLock,
    backupJob: overrides.backupJob ?? disk?.backupJob,
    runInstall: overrides.runInstall ?? defaultRun,
  })
  sharedReaderKey = key
  return sharedReader
}
/** 核心错误码原样返回，外面世界的脏错误收敛为检查失败（537 决议：码表由核心定）。 */
function toUpdateErrorPayload(error) {
  const code = error && typeof error.code === 'string' ? error.code : ''
  const known = ['check-failed', 'invalid-release', 'check-expired', 'update-busy', 'install-failed', 'unknown-profile', 'source-install', 'invalid-installation', 'installation-changed', 'pending-restart', 'incompatible-node', 'registry-conflict', 'recovery-required']
  if (known.includes(code)) return { error: code, errorKind: code }
  return { error: 'check-failed', errorKind: 'internal' }
}
function manualOfEnv(env, snapshot) {
  try {
    return manualCommand({ profileName: env?.profileName ?? null, latestVersion: snapshot?.latestVersion ?? null, installedVersion: snapshot?.installedVersion ?? null, runningVersion: String(snapshot?.runningVersion ?? ''), jobTargetVersion: snapshot?.job?.targetVersion ?? null, blockedReason: snapshot?.blockedReason ?? null, sourceInstall: env?.sourceInstall === true })
  } catch {
    return null
  }
}
async function snapWithManual(reader, snapshot) {
  try {
    return { snapshot, manual: manualOfEnv(await reader.readEnv(), snapshot) }
  } catch {
    return { snapshot, manual: null }
  }
}
function loggedPhone(method, kind, fn) {
  return async function (args) {
    const t0 = Date.now()
    const emit = (level, event, fields) => {
      try {
        if (phoneLogCtx && typeof phoneLogCtx.fire === 'function') phoneLogCtx.fire(level, event, fields)
      } catch {}
    }
    try {
      const out = await fn(args)
      const snapshot = out && out.snapshot ? out.snapshot : out
      emit('info', 'host.call', { method, latencyMs: Date.now() - t0, ok: true, kind })
      return { ok: true, snapshot, manual: out && out.snapshot ? (out.manual ?? null) : null, receipt: out && out.receipt ? out.receipt : null }
    } catch (error) {
      const payload = toUpdateErrorPayload(error)
      emit('warn', 'host.call.fail', { method, kind, errorHash: hash8(String((error && error.message) || payload.error)) })
      return { ok: false, ...payload }
    }
  }
}
let phoneLogCtx = null
/** 三个电话：查状态只读本地，查新版用户点了才联网，装更新拿凭证加请求编号提交。 */export function createUpdatePhoneHandlers(deps = {}) {
  phoneLogCtx = deps.logCtx ?? phoneLogCtx
  // 宿主上下文：探测宿主种类（桌面 / 普通 DSH）并接上执行零件（子进程口子、桌面服务）。
  const ctx = deps.ctx ?? null
  if (deps.desktopPnpm) sharedDesktopPnpm = deps.desktopPnpm
  else watchDesktopPnpm(ctx)
  const readerOverrides = { ...(deps.readerOverrides ?? {}), ctx }
  async function readStatus(args) {
    const reader = await getSharedReader({ ...readerOverrides, profileDir: args && args.profileDir ? String(args.profileDir) : readerOverrides.profileDir })
    return snapWithManual(reader, await reader.status())
  }
  async function readCheck(args) {
    const reader = await getSharedReader({ ...readerOverrides, profileDir: args && args.profileDir ? String(args.profileDir) : readerOverrides.profileDir })
    const result = await reader.check()
    const withManual = await snapWithManual(reader, result.snapshot)
    return { snapshot: withManual.snapshot, manual: withManual.manual, receipt: result.receipt ?? null }
  }
  async function runInstall(args) {
    const checkId = args && typeof args.checkId === 'string' ? args.checkId : ''
    const requestId = args && typeof args.requestId === 'string' ? args.requestId : ''
    const reader = await getSharedReader({ ...readerOverrides, profileDir: args && args.profileDir ? String(args.profileDir) : readerOverrides.profileDir })
    return snapWithManual(reader, await reader.install({ checkId, requestId }))
  }
  return {
    handleUpdateStatus: loggedPhone('wf.updateStatus', 'update-status', readStatus),
    handleUpdateCheck: loggedPhone('wf.updateCheck', 'update-check', readCheck),
    handleUpdateInstall: loggedPhone('wf.updateInstall', 'update-install', runInstall),
  }
}

/** 测试与门禁复位单例（正常运行不调用）。 */
export function __resetSharedUpdateReaderForTests() {
  sharedReader = null
  sharedReaderKey = ''
  sharedDesktopPnpm = null
}
