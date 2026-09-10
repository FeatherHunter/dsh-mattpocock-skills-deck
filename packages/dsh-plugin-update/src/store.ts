/**
 * packages/dsh-plugin-update/src/store.ts —— 更新任务的落盘与执行跑腿。
 *
 * 由 src/host/updateStore.js 改写拎入：只跑腿不决策。相对旧实现的增量（规格 #591）：
 * 1. 状态目录按插件标识派生（第 3 条）：join(家目录, 'updates', 插件标识, 使用范围短指纹），
 *    三文件名保持 state.json、install.lock、before.json 不变。
 * 2. 默认旧路径冻结（第 14 条）：插件标识取旧值 dsh-mattpocock-skills-deck 时路径与旧原文
 *    一字不差——下面的旧字面是永久冻结特例，注释永不删除（动默认即破冰）。
 * 3. 读走双读、写只写新（第 7 条）：先读新路径，没有再回退读旧路径；写只写新路径，
 *    旧路径只读不写永久留作只读影子。旧文件不动，清理另票再议。
 * 4. 三处注入默认现状（第 4 条）：目标包名、官方源、安装时限经零件注入，默认值等于现状。
 * 5. 安装执行日志带必填插件标识（第 8、13 条）：update.install.exec 加完标识后 5 键为基线。
 *
 * 安装执行按核心给的配方跑两条路由之一（桌面宿主走桌面服务，普通 DSH 自己起进程），
 * 本文件不按操作系统分支，也不拼 shell。决策顺序全在更新核心。测试一律用假零件，
 * 不真写盘真跑命令（经可选的文件读写函数注入，默认走真文件系统）。
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { installRecipe } from './commands.js'
import { BACKUP_FILE, LEGACY_PLUGIN_ID, LOCK_FILE, STATE_FILE } from './config.js'
import type { EnvironmentKind, UpdateJob } from './ports.js'

// 永久冻结的旧字面（规格 #591 第 14 条）：默认旧路径原文加三固定名永久冻结，永不删除。
// 旧原文：join(家目录, 'updates', 'dsh-mattpocock-skills-deck', 短指纹(使用范围目录))。
const LEGACY_SEGMENT = 'updates'
const LEGACY_DIR_PLUGIN = LEGACY_PLUGIN_ID

const JOB_STATES = ['installing', 'verifying', 'restart-required', 'completed', 'failed', 'interrupted']
const SNAPSHOT_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']

function fail(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}
function shortHash(text: string): string {
  try {
    return createHash('sha256').update(String(text)).digest('hex').slice(0, 24)
  } catch {
    return '00000000'
  }
}

export interface UpdatePaths {
  directory: string
  state: string
  lock: string
  backup: string
}

/**
 * 状态目录：家目录下按插件标识派生，短指纹只做同一性判断，不记原文。
 * 插件标识取旧值时与旧原文一字不差（旧默认路径冻结，验收项）。
 */
export function pathsForUpdate(homeDir: string, pluginId: string, profileDir: string): UpdatePaths | null {
  if (typeof homeDir !== 'string' || !homeDir || typeof profileDir !== 'string' || !profileDir) return null
  if (typeof pluginId !== 'string' || !pluginId) return null
  const directory = join(homeDir, LEGACY_SEGMENT, pluginId, shortHash(profileDir))
  return { directory, state: join(directory, STATE_FILE), lock: join(directory, LOCK_FILE), backup: join(directory, BACKUP_FILE) }
}

/** 旧只读影子目录（规格 #591 第 7 条）：只读不写，永久留作回退读取用。 */
export function legacyPathsForUpdate(homeDir: string, profileDir: string): UpdatePaths | null {
  // 旧字面永不删除：join(家目录, 'updates', 'dsh-mattpocock-skills-deck', 短指纹)。
  if (typeof homeDir !== 'string' || !homeDir || typeof profileDir !== 'string' || !profileDir) return null
  const directory = join(homeDir, LEGACY_SEGMENT, LEGACY_DIR_PLUGIN, shortHash(profileDir))
  return { directory, state: join(directory, STATE_FILE), lock: join(directory, LOCK_FILE), backup: join(directory, BACKUP_FILE) }
}

async function readJsonGuarded(filename: string, missing: null): Promise<Record<string, unknown> | null> {
  try {
    if ((await stat(filename)).size > 10 * 1024 * 1024) throw fail('install-failed')
    return JSON.parse(await readFile(filename, 'utf8')) as Record<string, unknown>
  } catch (error) {
    if (error && (error as { code?: string }).code === 'ENOENT') return missing
    throw error && (error as { code?: string }).code ? error : fail('install-failed')
  }
}

async function writeJsonAtomic(filename: string, value: unknown): Promise<void> {
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

function normalizeJob(job: Record<string, unknown>): UpdateJob {
  return {
    id: typeof job.id === 'string' ? job.id : 'corrupt',
    state: JOB_STATES.includes(String(job.state)) ? (job.state as UpdateJob['state']) : 'interrupted',
    targetVersion: typeof job.targetVersion === 'string' ? job.targetVersion : null,
    message: typeof job.message === 'string' ? job.message : null,
    requestId: typeof job.requestId === 'string' ? job.requestId : null,
  }
}

export interface DiskPortsDeps {
  readFileImpl?: (filename: string, encoding: string) => Promise<string>
  statImpl?: (filename: string) => Promise<{ size: number }>
}

/**
 * 建任务存取与锁：调用方按当前插件标识建一份，转交核心当零件。
 * 读走双读（先新后旧），写只写新（旧影子只读不写）。
 */
export function createUpdateDiskPorts(homeDir: string, pluginId: string, profileDir: string, deps: DiskPortsDeps = {}): {
  paths: UpdatePaths | null
  legacyPaths: UpdatePaths | null
  readJob: () => Promise<UpdateJob | null>
  writeJob: (job: UpdateJob | null) => Promise<void>
  tryAcquireLock: (lockId: string) => Promise<boolean>
  releaseLock: (lockId: string) => Promise<void>
  backupJob: (job: UpdateJob) => Promise<void>
} {
  const paths = pathsForUpdate(homeDir, pluginId, profileDir)
  // 旧标识自己的新路径就是旧路径：此时旧影子与新路径同一目录，不做重复回退。
  const legacyPaths = pluginId === LEGACY_DIR_PLUGIN ? null : legacyPathsForUpdate(homeDir, profileDir)
  const readText = deps.readFileImpl ?? ((filename: string, encoding: string) => readFile(filename, encoding))
  const statFile = deps.statImpl ?? ((filename: string) => stat(filename))
  async function readAt(p: UpdatePaths | null): Promise<Record<string, unknown> | null> {
    if (!p) return null
    try {
      if ((await statFile(p.state)).size > 10 * 1024 * 1024) throw fail('install-failed')
      return JSON.parse(await readText(p.state, 'utf8')) as Record<string, unknown>
    } catch (error) {
      if (error && (error as { code?: string }).code === 'ENOENT') return null
      throw error && (error as { code?: string }).code ? error : fail('install-failed')
    }
  }
  async function readJob(): Promise<UpdateJob | null> {
    if (!paths) return null
    const job = await readAt(paths)
    if (job) {
      if (!JOB_STATES.includes(String(job.state)) || typeof job.id !== 'string') {
        return { id: 'corrupt', state: 'interrupted', message: 'recovery-required', targetVersion: null, requestId: null }
      }
      return { requestId: null, message: null, ...job } as UpdateJob
    }
    // 新路径没有再回退读旧路径（只读影子，不触发回写）。
    if (legacyPaths) {
      const legacyJob = await readAt(legacyPaths)
      if (legacyJob) {
        if (!JOB_STATES.includes(String(legacyJob.state)) || typeof legacyJob.id !== 'string') {
          return { id: 'corrupt', state: 'interrupted', message: 'recovery-required', targetVersion: null, requestId: null }
        }
        return { requestId: null, message: null, ...legacyJob } as UpdateJob
      }
    }
    const lock = await readJsonGuarded(paths.lock, null)
    if (lock) return { id: 'locked', state: 'interrupted', message: 'recovery-required', targetVersion: null, requestId: null }
    if (legacyPaths) {
      const legacyLock = await readJsonGuarded(legacyPaths.lock, null).catch(() => null)
      if (legacyLock) return { id: 'locked', state: 'interrupted', message: 'recovery-required', targetVersion: null, requestId: null }
    }
    return null
  }
  async function writeJob(job: UpdateJob | null): Promise<void> {
    // 写只写新路径：旧影子只读不写，永久保留。
    if (!paths) throw fail('install-failed')
    if (job === null) {
      await unlink(paths.state).catch((error: { code?: string }) => {
        if (!error || error.code !== 'ENOENT') throw fail('install-failed')
      })
      return
    }
    await mkdir(paths.directory, { recursive: true, mode: 0o700 })
    await writeJsonAtomic(paths.state, job)
  }
  async function tryAcquireLock(lockId: string): Promise<boolean> {
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
      if (!error || (error as { code?: string }).code !== 'EEXIST') return false
      try {
        const current = await readJsonGuarded(paths.lock, null)
        const job = await readJsonGuarded(paths.state, null)
        if (!current || (job && (job as { id?: unknown }).id === (current as { id?: unknown }).id)) return false
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
  async function releaseLock(lockId: string): Promise<void> {
    if (!paths) return
    try {
      const current = await readJsonGuarded(paths.lock, null)
      if (current && (current as { id?: unknown }).id === lockId) await unlink(paths.lock).catch(() => {})
    } catch {}
  }
  async function backupJob(job: UpdateJob): Promise<void> {
    if (!paths) throw fail('install-failed')
    const files: Record<string, string> = {}
    for (const name of SNAPSHOT_FILES) {
      try {
        const filename = join(profileDir, name)
        if ((await stat(filename)).size > 3 * 1024 * 1024) throw fail('install-failed')
        files[name] = await readFile(filename, 'utf8')
      } catch (error) {
        if (!error || (error as { code?: string }).code !== 'ENOENT') throw fail('install-failed')
      }
    }
    await mkdir(paths.directory, { recursive: true, mode: 0o700 })
    await writeJsonAtomic(paths.backup, {
      jobId: job.id,
      previousVersion: (job as unknown as Record<string, unknown>).previousVersion ?? null,
      files,
    })
  }
  return { paths, legacyPaths, readJob, writeJob, tryAcquireLock, releaseLock, backupJob }
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
function part<T>(value: T | (() => T)): T {
  return typeof value === 'function' ? (value as () => T)() : value
}

function withExit(error: Error & { exitCode?: number }, exitCode: number | null): Error & { exitCode?: number } {
  if (typeof exitCode === 'number') error.exitCode = exitCode
  return error
}

/** 同一份目录：先按解析后的写法比，再问一次文件系统（能容下大小写与符号链接差异）。 */
async function sameDir(a: string, b: string): Promise<boolean> {
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

async function readManifestAt(directory: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as Record<string, unknown>
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
export async function resolveCliEntry(
  argv1: string,
  deps: {
    readManifest?: (directory: string) => Promise<Record<string, unknown> | null>
    realpath?: (path: string) => Promise<string>
  } = {}
): Promise<string | null> {
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
    let manifest: Record<string, unknown> | null = null
    try {
      manifest = await Promise.resolve()
        .then(() => readAt(directory))
        .catch(() => null)
    } catch {
      manifest = null
    }
    if (manifest && manifest.name === CLI_PACKAGE_NAME) {
      const bin = manifest.bin as unknown
      const declared = typeof bin === 'string' ? bin : bin && (bin as Record<string, unknown>).dsh
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
async function awaitOutcome(
  handle: { done: Promise<{ exitCode?: number } | null>; terminate?: () => void },
  timeoutMs: number
): Promise<{ exitCode: number | null; timedOut: boolean }> {
  const settled = Promise.resolve(handle.done).then(
    (value) => ({ exitCode: value && typeof value.exitCode === 'number' ? value.exitCode : null, timedOut: false }),
    () => ({ exitCode: null, timedOut: true })
  )
  if (!(typeof timeoutMs === 'number' && timeoutMs > 0)) return await settled
  let timer: ReturnType<typeof setTimeout> | null = null
  const deadline = new Promise<{ exitCode: null; timedOut: boolean }>((settle) => {
    timer = setTimeout(() => {
      try {
        if (handle && typeof handle.terminate === 'function') handle.terminate()
      } catch {}
      settle({ exitCode: null, timedOut: true })
    }, timeoutMs)
  })
  try {
    return await Promise.race([settled, deadline])
  } finally {
    if (timer !== null) {
      try {
        clearTimeout(timer)
      } catch {}
    }
  }
}

export interface ExecutorParts {
  profileName?: string | null | (() => string | null)
  environmentKind?: EnvironmentKind | (() => EnvironmentKind)
  profileDir?: string | (() => string)
  subprocess?: unknown | (() => unknown)
  desktopPnpm?: unknown | (() => unknown)
  desktopProfiles?: unknown | (() => unknown)
  runtimeExecutable?: string | (() => string | undefined)
  runtimeExecArgs?: string[] | (() => string[] | undefined)
  cliEntry?: string | (() => string | undefined)
  targetPackageName?: string | (() => string)
  registryUrl?: string | (() => string)
  installTimeoutMs?: number | (() => number)
  pluginId?: string | (() => string)
  log?: (level: string, event: string, fields: Record<string, unknown>) => void
}

/**
 * 记一行安装执行的跨边界调用与结果（常驻事件，低频，只记路由与退出事实加插件标识）。
 * 日志里只记枚举与数字，不记命令、路径、使用范围名原文。
 */
function emitInstall(
  parts: ExecutorParts,
  recipe: { route: string } | null,
  ok: boolean,
  exitCode: number | null,
  durationMs: number
): void {
  const log = parts.log
  if (typeof log !== 'function') return
  try {
    const pluginId = part(parts.pluginId ?? null) as unknown
    log('info', 'update.install.exec', {
      route: recipe ? recipe.route : 'none',
      ok: ok === true,
      exitCode: typeof exitCode === 'number' ? exitCode : null,
      durationMs,
      pluginId: typeof pluginId === 'string' ? pluginId : null,
    })
  } catch {}
}

/** 桌面宿主：交给桌面端公开的 desktopPnpm 服务，由它用参数数组拉起打包好的 CLI。 */
async function runDesktopService(
  recipe: { pluginArgs: string[]; profileName: string },
  parts: ExecutorParts
): Promise<number | null> {
  const service = part(parts.desktopPnpm) as { runPlugin?: (args: string[], dir: string, extra: undefined) => { done: Promise<{ exitCode?: number }> } } | null
  if (!service || typeof service.runPlugin !== 'function') throw fail('install-failed')
  const profiles = part(parts.desktopProfiles) as { current?: { dir?: string } } | null
  const active = profiles && profiles.current ? profiles.current : null
  const profileDir = part(parts.profileDir) as string
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
async function runCliProcess(
  recipe: { pluginArgs: string[]; profileName: string; timeoutMs: number },
  parts: ExecutorParts
): Promise<number | null> {
  const executable = part(parts.runtimeExecutable) || (typeof process !== 'undefined' ? process.execPath : '')
  const execArgs =
    part(parts.runtimeExecArgs) ??
    (typeof process !== 'undefined' && Array.isArray(process.execArgv) ? (process.execArgv as string[]) : [])
  const entry = part(parts.cliEntry) ?? (await resolveCliEntry(typeof process !== 'undefined' && process.argv ? process.argv[1] : ''))
  if (!executable || !entry) throw fail('install-failed')
  const argv = [executable, ...execArgs, entry, 'plugin', '--profile', recipe.profileName, ...recipe.pluginArgs]
  const subprocess = part(parts.subprocess) as {
    spawn?: (opts: { argv: string[]; cwd?: string; stdio: unknown; graceMs: number }) => { done: Promise<{ exitCode?: number } | null> }
  } | null
  if (!subprocess || typeof subprocess.spawn !== 'function') throw fail('install-failed')
  const handle = subprocess.spawn({
    argv,
    cwd: (part(parts.profileDir) as string) || undefined,
    stdio: INSTALL_STDIO,
    graceMs: TERMINATION_GRACE_MS,
  })
  if (!handle || !handle.done || typeof handle.done.then !== 'function') throw fail('install-failed')
  const outcome = await awaitOutcome(handle as { done: Promise<{ exitCode?: number } | null> }, recipe.timeoutMs)
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
export function createUpdateExecutor(parts: ExecutorParts = {}): (args?: { version?: string; profileName?: string | null; environmentKind?: EnvironmentKind }) => Promise<void> {
  return async function runInstall(args: { version?: string; profileName?: string | null; environmentKind?: EnvironmentKind } = {}): Promise<void> {
    const recipe = installRecipe({
      profileName: args.profileName ?? (part(parts.profileName ?? null) as string | null),
      version: String(args.version ?? ''),
      environmentKind: args.environmentKind ?? (part(parts.environmentKind ?? 'cli') as EnvironmentKind),
      targetPackageName: parts.targetPackageName === undefined ? undefined : (part(parts.targetPackageName) as string),
      registryUrl: parts.registryUrl === undefined ? undefined : (part(parts.registryUrl) as string),
      timeoutMs: parts.installTimeoutMs === undefined ? undefined : (part(parts.installTimeoutMs) as number),
    })
    const startedAt = Date.now()
    let exitCode: number | null = null
    try {
      if (!recipe) throw fail('install-failed')
      exitCode =
        recipe.route === 'desktop-service' ? await runDesktopService(recipe, parts) : await runCliProcess(recipe, parts)
      emitInstall(parts, recipe, true, exitCode, Date.now() - startedAt)
    } catch (error) {
      emitInstall(parts, recipe, false, (error as { exitCode?: number })?.exitCode ?? exitCode, Date.now() - startedAt)
      throw Object.assign(fail('install-failed'), { debug: String((error as Error)?.stack || error) })
    }
  }
}

// 内部复用导出（供单测断言子进程形态：数组、无 shell、不用 PATH 名、不按系统分支）。
export const __executorInternals = { INSTALL_STDIO, TERMINATION_GRACE_MS, CLI_PACKAGE_NAME }
