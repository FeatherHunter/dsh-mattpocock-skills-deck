/**
 * src/host/update.js — 更新核心的 deck 宿主胶水（薄薄一层，538 落点决议）
 *
 * 把本机真实情况翻译成核心要的小零件，再把核心的决定原样交出去。
 * 跨层引用共享层允许；安装的状态目录、锁、备份、执行跑腿在 updateStore（同层边记基线）。
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createUpdateCore,
  PACKAGE_NAME,
  validVersion,
} from '../shared/update/service.js'
import { manualCommand } from '../shared/update/commands.js'
import { createUpdateDiskPorts, createUpdateExecutor } from './updateStore.js'

const LOCK_FILES = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package-lock.json']

function inside(directory, filename) {
  const suffix = relative(directory, filename)
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}

async function readOptional(filename) {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return ''
    throw error
  }
}

async function packageAt(directory) {
  const contents = await readFile(join(directory, 'package.json'), 'utf8')
  return { directory: await realpath(directory), manifest: JSON.parse(contents), contents }
}

/** 从起点文件向上找到名字对得上的包（装的是源码还是装好的包都认）。 */
async function containingPackage(filename, name) {
  let directory = dirname(await realpath(filename))
  while (true) {
    try {
      const found = await packageAt(directory)
      if (found.manifest && found.manifest.name === name) return found
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error
    }
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

/** 使用范围名是否合法（纯谓词，导出供验证与面板复用）。 */
export function profileNameValid(name) {  return typeof name === 'string' && name.length > 0 && Buffer.byteLength(name) <= 255
    && !name.startsWith('-') && !['.', '..', 'node_modules'].includes(name)
    && !/[\\/\x00-\x1f\x7f<>:"|?*]/u.test(name)
}

/** 依赖写法是否像从源装的（纯谓词，导出供验证与面板复用）。 */
export function registrySpec(spec) {
  return typeof spec === 'string' && spec.trim().length > 0
    && (validVersion(spec.trim()) || /^[~^>=< ]*[0-9x*][0-9x*./\-_ |~^>=<]*$/u.test(spec.trim())
      || /^[A-Za-z][A-Za-z0-9._-]*$/u.test(spec.trim()))
}

/** 包是否完好：名字对得上、版本合法、三个入口文件都在包内且真实存在。 */
async function validPackage(pkg) {
  if (!pkg || pkg.manifest?.name !== PACKAGE_NAME || !validVersion(pkg.manifest.version)) return false
  const entries = [
    pkg.manifest.main,
    pkg.manifest.exports?.['./client'],
    pkg.manifest.dsh?.bundle?.patch,
  ]
  for (const entry of entries) {
    if (typeof entry !== 'string' || !entry || isAbsolute(entry) || entry.includes('\0')) return false
    const filename = resolve(pkg.directory, entry)
    if (!inside(pkg.directory, filename)) return false
    let target = filename
    try {
      target = await realpath(filename)
    } catch {
      return false
    }
    if (!inside(pkg.directory, target)) return false
    try {
      if (!(await stat(target)).isFile()) return false
    } catch {
      return false
    }
  }
  return true
}

function defaultHomeDir(env, osHome) {
  let selected = env && env.DSH_HOME && env.DSH_HOME.trim() ? env.DSH_HOME : join(osHome, '.dsh')
  if (selected === '~') selected = osHome
  else if (/^~[\\/]/u.test(selected)) selected = join(osHome, selected.slice(2))
  return resolve(selected)
}

/** 建更新读取器：至少给运行版本与使用范围目录，其余不给用本机默认。 */
export function createDeckUpdateReader(options = {}) {
  const runningVersion = options.runningVersion
  if (typeof runningVersion !== 'string' || !runningVersion) {
    throw new Error('[update] 建读取器必须给运行版本 runningVersion（读宿主自带清单）')
  }
  const profileDirInput = options.profileDir
  if (typeof profileDirInput !== 'string' || !isAbsolute(profileDirInput)) {
    throw new Error('[update] 建读取器必须给绝对路径的使用范围目录 profileDir')
  }
  const env = options.env ?? process.env
  const osHome = options.osHome ?? homedir()
  const homeDirDefault = defaultHomeDir(env, osHome)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const now = options.now ?? Date.now
  const randomId = options.randomId ?? randomUUID
  const nodeVersion = options.nodeVersion ?? (typeof process !== 'undefined' ? process.versions.node : '')
  const environmentKind = options.environmentKind ?? 'cli'
  const loadedPackage = containingPackage(fileURLToPath(import.meta.url), PACKAGE_NAME).catch(() => null)
  let boundIdentity
  async function readInstalledReal() {
    const result = {
      profileName: null,
      environmentKind,
      homeDir: null,
      profileDir: null,
      installedVersion: null,
      packageValid: false,
      sourceInstall: false,
      blockedReason: null,
      installationKey: null,
      eligible: false,
    }
    const profileName = options.profileName ?? basename(profileDirInput)
    result.profileName = profileName
    if (!profileNameValid(profileName)) {
      result.blockedReason = 'unknown-profile'
      return result
    }
    let homeDir
    let profileDir
    try {
      homeDir = await realpath(options.homeDir ?? homeDirDefault)
      profileDir = await realpath(profileDirInput)
    } catch {
      result.blockedReason = 'unknown-profile'
      return result
    }
    result.homeDir = homeDir
    result.profileDir = profileDir
    let profile
    let installed
    try {
      profile = await packageAt(profileDir)
      installed = await packageAt(join(profileDir, 'node_modules', PACKAGE_NAME))
    } catch {
      result.blockedReason = 'invalid-installation'
      return result
    }
    result.sourceInstall = !registrySpec(profile.manifest.dependencies?.[PACKAGE_NAME])
      || !inside(join(profileDir, 'node_modules'), installed.directory)
    result.installedVersion = typeof installed.manifest.version === 'string' ? installed.manifest.version : null
    result.packageValid = await validPackage(installed)
    const loaded = await loadedPackage
    const identity = `${homeDir}\0${profileDir}\0${profileName}`
    const sameLoadedPackage = loaded?.directory === installed.directory
      && loaded?.manifest.version === installed.manifest.version
    if (boundIdentity === undefined && sameLoadedPackage && result.packageValid) boundIdentity = identity
    const stateFiles = await Promise.all(LOCK_FILES.map((name) => readOptional(join(profileDir, name))))
    try {
      result.installationKey = createHash('sha256').update(JSON.stringify([
        identity, profile.contents, installed.directory, installed.contents, ...stateFiles,
      ])).digest('hex')
    } catch {
      result.installationKey = null
    }
    if (boundIdentity !== undefined && boundIdentity !== identity) result.blockedReason = 'installation-changed'
    else if (!sameLoadedPackage && boundIdentity === undefined) result.blockedReason = 'installation-changed'
    else if (!result.packageValid) result.blockedReason = 'invalid-installation'
    else if (result.sourceInstall) result.blockedReason = 'source-install'
    else if (result.installedVersion !== runningVersion) result.blockedReason = 'pending-restart'
    result.eligible = !result.blockedReason
    result.blockedReason = result.blockedReason ?? null
    return result
  }
  const readInstalled = options.readInstalled ?? readInstalledReal
  const core = createUpdateCore({
    readRunningVersion: () => runningVersion,
    readInstalled,
    fetchImpl,
    now,
    randomId,
    nodeVersion,
    readJob: options.readJob,
    writeJob: options.writeJob,
    tryAcquireLock: options.tryAcquireLock,
    releaseLock: options.releaseLock,
    backupJob: options.backupJob,
    runInstall: options.runInstall,
  })
  return Object.assign(core, { readEnv: readInstalled })
}

// ---------- 更新电话（#541 两只读 + #542 装更新；单例让查状态看到查新版的结果） ----------
let sharedReader = null
let sharedReaderKey = ''

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
  const key = `${runningVersion}\0${profileDirInput}\0${overrides.profileName ?? ''}\0${homeDirInput}\0${overrides.runInstall ? 'exec' : ''}`
  if (sharedReader && sharedReaderKey === key) return sharedReader
  const disk = overrides.readJob && overrides.writeJob ? null : createUpdateDiskPorts(homeDirInput, profileDirInput), defaultRun = createUpdateExecutor({ profileName: overrides.profileName ?? null })
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
    environmentKind: overrides.environmentKind ?? 'cli',
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
  const readerOverrides = deps.readerOverrides ?? {}
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
}
