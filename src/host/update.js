/**
 * src/host/update.js — 更新核心的 deck 宿主胶水（薄薄一层，538 落点决议）
 *
 * 只做一件事：把本机真实情况翻译成核心要的小零件（读版本、看环境、
 * 上报是桌面还是命令行），再把核心的决定原样交出去。
 * 跨层引用共享层是允许的；本文件与共享层文件之间不许再横向引用。
 *
 * 只读半程：只读盘，不写盘；不加锁文件、不备份、不拼安装命令、
 * 不新增宿主电话、不加定时器。验证用直接调用看返回，不走面板。
 * 日志点随装电话与轮询的安装票一起按日志总纲补，本票不新增日志事件。
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

/**
 * 建一个只读的更新读取器。调用方至少给运行版本与使用范围目录；
 * 其余（桌面还是命令行、时钟、编号、抓取实现）不给就用本机默认。
 * 同一个读取器记住第一次见到的使用范围指纹，目录换了就报安装位置变了。
 */
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

  async function readInstalled() {
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

  const core = createUpdateCore({
    readRunningVersion: () => runningVersion,
    readInstalled,
    fetchImpl,
    now,
    randomId,
    nodeVersion,
  })
  return core
}
