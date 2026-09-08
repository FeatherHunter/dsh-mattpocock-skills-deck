/**
 * src/host/updateStore.js — 更新任务的落盘与执行跑腿（安装票 #542、执行端口票 #548）
 *
 * 只跑腿不决策：状态目录按使用范围隔离（三件套：任务记录、防重锁、装前备份）；
 * 安装执行按核心给的配方跑两条路由之一（桌面宿主走桌面服务，普通 DSH 自己起进程），
 * 本文件不按操作系统分支，也不拼 shell。决策顺序全在更新核心，
 * 本文件被更新胶水动态装配（同层边记基线），测试一律用假零件，不真写盘真跑命令。
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { installRecipe } from '../shared/update/commands.js'

const JOB_STATES = ['installing', 'verifying', 'restart-required', 'completed', 'failed', 'interrupted']
const SNAPSHOT_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']

function fail(code) { return Object.assign(new Error(code), { code }) }
function shortHash(text) {
  try {
    return createHash('sha256').update(String(text)).digest('hex').slice(0, 24)
  } catch {
    return '00000000'
  }
}

/** 状态目录：家目录下按使用范围隔离，短指纹只做同一性判断，不记原文。 */
export function pathsForUpdate(homeDir, profileDir) {
  if (typeof homeDir !== 'string' || !homeDir || typeof profileDir !== 'string' || !profileDir) return null
  const directory = join(homeDir, 'updates', 'dsh-mattpocock-skills-deck', shortHash(profileDir))
  return { directory, state: join(directory, 'state.json'), lock: join(directory, 'install.lock'), backup: join(directory, 'before.json') }
}

async function readJsonGuarded(filename, missing) {
  try {
    if ((await stat(filename)).size > 10 * 1024 * 1024) throw fail('install-failed')
    return JSON.parse(await readFile(filename, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') return missing
    throw error && error.code ? error : fail('install-failed')
  }
}

async function writeJsonAtomic(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await rename(temporary, filename)
  } catch {
    throw fail('install-failed')
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

/** 建任务存取与锁：胶水按当前使用范围建一份，转交核心当零件。 */
export function createUpdateDiskPorts(homeDir, profileDir) {
  const paths = pathsForUpdate(homeDir, profileDir)
  async function readJob() {
    if (!paths) return null
    const job = await readJsonGuarded(paths.state, null)
    if (!job) {
      const lock = await readJsonGuarded(paths.lock, null)
      if (lock) return { id: 'locked', state: 'interrupted', message: 'recovery-required', targetVersion: null, requestId: null }
      return null
    }
    if (!JOB_STATES.includes(job.state) || typeof job.id !== 'string') {
      return { id: 'corrupt', state: 'interrupted', message: 'recovery-required', targetVersion: null, requestId: null }
    }
    return { requestId: null, message: null, ...job }
  }
  async function writeJob(job) {
    if (!paths) throw fail('install-failed')
    if (job === null) {
      await unlink(paths.state).catch((error) => { if (!error || error.code !== 'ENOENT') throw fail('install-failed') })
      return
    }
    await mkdir(paths.directory, { recursive: true, mode: 0o700 })
    await writeJsonAtomic(paths.state, job)
  }
  async function tryAcquireLock(lockId) {
    if (!paths) return false
    try {
      await mkdir(paths.directory, { recursive: true, mode: 0o700 })
      const handle = await open(paths.lock, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ id: lockId, pid: process.pid, startedAt: Date.now() }))
      } finally {
        await handle.close()
      }
      return true
    } catch (error) {
      if (!error || error.code !== 'EEXIST') return false
      try {
        const current = await readJsonGuarded(paths.lock, null)
        const job = await readJsonGuarded(paths.state, null)
        if (!current || (job && job.id === current.id)) return false
        await unlink(paths.lock).catch(() => {})
        const handle = await open(paths.lock, 'wx', 0o600)
        try {
          await handle.writeFile(JSON.stringify({ id: lockId, pid: process.pid, startedAt: Date.now() }))
        } finally {
          await handle.close()
        }
        return true
      } catch {
        return false
      }
    }
  }
  async function releaseLock(lockId) {
    if (!paths) return
    try {
      const current = await readJsonGuarded(paths.lock, null)
      if (current && current.id === lockId) await unlink(paths.lock).catch(() => {})
    } catch {}
  }
  async function backupJob(job) {
    if (!paths) throw fail('install-failed')
    const files = {}
    for (const name of SNAPSHOT_FILES) {
      try {
        const filename = join(profileDir, name)
        if ((await stat(filename)).size > 3 * 1024 * 1024) throw fail('install-failed')
        files[name] = await readFile(filename, 'utf8')
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw fail('install-failed')
      }
    }
    await mkdir(paths.directory, { recursive: true, mode: 0o700 })
    await writeJsonAtomic(paths.backup, { jobId: job.id, previousVersion: job.previousVersion ?? null, files })
  }
  return { paths, readJob, writeJob, tryAcquireLock, releaseLock, backupJob }
}

/** 运行入口要反查的 CLI 包名（入口必须来自正在运行的这份 CLI）。 */
const CLI_PACKAGE_NAME = '@deepseek-ai/dsh'
/**
 * 安装子进程的流出置：输出只留一段有界缓冲（不读、不落盘），只看退出事实。
 * 必须是「有界收集」形状——子进程能力的 'pipe' 会没人读、'ignore' 不是它的合法取值。
 */
const INSTALL_STDIO = { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 64 * 1024 } }
/** 终止宽限期：先请进程树自己退，宽限到了再强杀（由子进程能力执行）。 */
const TERMINATION_GRACE_MS = 3000

/** 执行零件可以是值，也可以是取值函数（桌面服务要等注入到位才能取）。 */
function part(value) { return typeof value === 'function' ? value() : value }

function withExit(error, exitCode) {
  if (typeof exitCode === 'number') error.exitCode = exitCode
  return error
}

/** 同一份目录：先按解析后的写法比，再问一次文件系统（能容下大小写与符号链接差异）。 */
async function sameDir(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false
  try {
    if (resolve(a) === resolve(b)) return true
  } catch {
    return false
  }
  try {
    const pair = await Promise.all([realpath(a), realpath(b)])
    return pair[0] === pair[1]
  } catch {
    return false
  }
}

async function readManifestAt(directory) {
  try {
    return JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 从正在运行的入口反查 CLI 的 JS 入口：逐级向上找名字为 @deepseek-ai/dsh 的包，
 * 且该文件必须正好是包声明的可执行入口（bin.dsh 或 bin 字符串）。对不上就返回 null，
 * 绝不用 PATH 上的 `dsh` 命令名——否则可能装到别的使用范围或用错版本。
 * 第二参只给测试注入假清单读取器与假路径解析用（默认都走真文件系统）。
 */
export async function resolveCliEntry(argv1, deps = {}) {
  const readAt = typeof deps.readManifest === 'function' ? deps.readManifest : readManifestAt
  const realpathImpl = typeof deps.realpath === 'function' ? deps.realpath : realpath
  if (typeof argv1 !== 'string' || !argv1 || argv1.includes('\0')) return null
  let entry = ''
  try {
    entry = await realpathImpl(argv1)
  } catch {
    return null
  }
  if (typeof entry !== 'string' || !entry) return null
  let directory = dirname(entry)
  while (true) {
    let manifest = null
    try {
      manifest = await Promise.resolve().then(() => readAt(directory)).catch(() => null)
    } catch {
      manifest = null
    }
    if (manifest && manifest.name === CLI_PACKAGE_NAME) {
      const declared = typeof manifest.bin === 'string' ? manifest.bin : (manifest.bin && manifest.bin.dsh)
      if (typeof declared !== 'string' || !declared || isAbsolute(declared) || declared.includes('\0')) return null
      try {
        return (await realpathImpl(resolve(directory, declared))) === entry ? entry : null
      } catch {
        return null
      }
    }
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

/** 等子进程退出事实：带时限，超时终止整棵进程树并按失败处理。 */
async function awaitOutcome(handle, timeoutMs) {
  const settled = Promise.resolve(handle.done).then(
    (value) => ({ exitCode: (value && typeof value.exitCode === 'number') ? value.exitCode : null, timedOut: false }),
    () => ({ exitCode: null, timedOut: true }),
  )
  if (!(typeof timeoutMs === 'number' && timeoutMs > 0)) return await settled
  let timer = null
  const deadline = new Promise((settle) => {
    timer = setTimeout(() => {
      try { if (handle && typeof handle.terminate === 'function') handle.terminate() } catch {}
      settle({ exitCode: null, timedOut: true })
    }, timeoutMs)
    if (timer && typeof timer.unref === 'function') timer.unref()
  })
  try {
    return await Promise.race([settled, deadline])
  } finally {
    if (timer !== null) { try { clearTimeout(timer) } catch {} }
  }
}

/** 记一行安装执行的跨边界调用与结果（常驻事件，低频，只记路由与退出事实）。 */
function emitInstall(parts, recipe, ok, exitCode, durationMs) {
  const log = parts.log
  if (typeof log !== 'function') return
  try {
    log('info', 'update.install.exec', {
      route: recipe ? recipe.route : 'none',
      ok: ok === true,
      exitCode: typeof exitCode === 'number' ? exitCode : null,
      durationMs: durationMs,
    })
  } catch {}
}

/** 桌面宿主：交给桌面端公开的 desktopPnpm 服务，由它用参数数组拉起打包好的 CLI。 */
async function runDesktopService(recipe, parts) {
  const service = part(parts.desktopPnpm)
  if (!service || typeof service.runPlugin !== 'function') throw fail('install-failed')
  const profiles = part(parts.desktopProfiles)
  const active = profiles && profiles.current ? profiles.current : null
  const profileDir = part(parts.profileDir)
  // 桌面服务固定装进「当前激活的使用范围」，所以激活范围必须就是本插件所在的那个；
  // 对不上宁可不装（装错范围比装不上更糟），交回核心按诚实失败转手工命令。
  if (!active || !active.dir || !profileDir || !(await sameDir(active.dir, profileDir))) throw fail('install-failed')
  const handle = service.runPlugin(recipe.pluginArgs, profileDir, undefined)
  if (!handle || !handle.done || typeof handle.done.then !== 'function') throw fail('install-failed')
  const outcome = await handle.done
  const code = outcome && typeof outcome.exitCode === 'number' ? outcome.exitCode : null
  if (code !== 0) throw withExit(fail('install-failed'), code)
  return code
}

/** 普通 DSH 宿主：当前运行时 + CLI 的 JS 入口 + 参数数组，经宿主注入的子进程能力起进程。 */
async function runCliProcess(recipe, parts) {
  const executable = part(parts.runtimeExecutable) || (typeof process !== 'undefined' ? process.execPath : '')
  const execArgs = part(parts.runtimeExecArgs)
    ?? (typeof process !== 'undefined' && Array.isArray(process.execArgv) ? process.execArgv : [])
  const entry = part(parts.cliEntry) ?? await resolveCliEntry(typeof process !== 'undefined' && process.argv ? process.argv[1] : '')
  if (!executable || !entry) throw fail('install-failed')
  const argv = [executable, ...execArgs, entry, 'plugin', '--profile', recipe.profileName, ...recipe.pluginArgs]
  const subprocess = part(parts.subprocess)
  if (!subprocess || typeof subprocess.spawn !== 'function') throw fail('install-failed')
  const handle = subprocess.spawn({
    argv,
    cwd: part(parts.profileDir) || undefined,
    stdio: INSTALL_STDIO,
    graceMs: TERMINATION_GRACE_MS,
  })
  if (!handle || !handle.done || typeof handle.done.then !== 'function') throw fail('install-failed')
  const outcome = await awaitOutcome(handle, recipe.timeoutMs)
  if (outcome.timedOut || outcome.exitCode !== 0) throw withExit(fail('install-failed'), outcome.exitCode)
  return outcome.exitCode
}

/**
 * 真执行器：按核心给的配方跑安装（测试一律注入假零件，不走这里）。
 *
 * 路由只有两条，都由核心的 installRecipe 决定，本文件不按操作系统分支：
 *   - desktop-service：桌面宿主公开的 desktopPnpm.runPlugin(参数数组, 使用范围目录)；
 *   - cli-process：subprocess.spawn({ argv: [运行时, …运行时参数, CLI 入口, 'plugin', '--profile', 名, …参数] })。
 * 起进程只经宿主注入的子进程能力，不经 shell、不用 PATH 上的 `dsh` 命令名。
 */
export function createUpdateExecutor(parts = {}) {
  return async function runInstall(args = {}) {
    const recipe = installRecipe({
      profileName: args.profileName ?? part(parts.profileName) ?? null,
      version: args.version,
      environmentKind: args.environmentKind ?? part(parts.environmentKind) ?? 'cli',
    })
    const startedAt = Date.now()
    let exitCode = null
    try {
      if (!recipe) throw fail('install-failed')
      exitCode = recipe.route === 'desktop-service'
        ? await runDesktopService(recipe, parts)
        : await runCliProcess(recipe, parts)
      emitInstall(parts, recipe, true, exitCode, Date.now() - startedAt)
    } catch (error) {
      emitInstall(parts, recipe, false, (error && error.exitCode) ?? exitCode, Date.now() - startedAt)
      throw Object.assign(fail('install-failed'), { debug: String((error && error.stack) || error) })
    }
  }
}

