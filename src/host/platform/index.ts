/**
 * platform/index.ts — 平台抽象层（次缝）：通用层。
 * （2026-10-15 #1068 从 .js 转成 .ts：只加类型标注与注释，逻辑一行未动。）
 *
 * 按 #113 D4/D5 + #129（CLOSED 定稿接口）实现「通用层」，#113 D1–D7 与「已确认 5 条」为权威依据。
 *
 * 职责（本票 #130 只做通用层）：
 *   - `createPlatform(ctx)` 工厂 + `REGISTRY = { darwin, win32, linux }` **静态引入查表**
 *     （绝不用变量路径动态引入，否则 esbuild 无法静态分析、打包产物缺文件）。
 *   - 把选定的系统适配器包装成 #129 契约形状（`getHome` / `path` / `resolveExecutable` / `fs` / `env`）。
 *
 * 通用包装在此**单点拥有**（跨系统不重复、行为一致）：
 *   - `getHome()`：结果缓存于平台实现内部（替换现有 userHome 缓存变量；`getHomeFresh` 不暴露，
 *     缓存失效策略由平台自定——进程内主目录不变，默认终身缓存）。
 *   - `path`：同步方法**全部委托 `node:path`**（win32 用 `node:path.win32`，darwin/linux 用
 *     `node:path.posix`）；各系统不得重实现路径数学，否则手写拼接即第二真相、即缺陷温床。
 *     另含唯一异步成员 `joinHome(...segs)` = `path.join(await getHome(), ...segs)`——调用方永不字符串拼接分隔符。
 *   - `resolveExecutable(name)`：包装 DSH `subprocess.resolveExecutable`；DSH 找不到时抛错 →
 *     本层 try/catch **转空**（返回 `Promise<string|null>`）。**2026-08-29 起**：`gh` 的
 *     DSH_GH_PATH 兜底（读环境变量 + 文件存在性校验）由本层**单点拥有**，三个系统底座行为一致（linux 适配器的
 *     原兜底已于同日移除，不再重复实现）。
 *   - `fs`：**透传** `ctx.get('fs')`（DSH 沙箱文件服务：读穿透沙箱、写有栅栏）；**无新建目录方法**。
 *     注意 **路径形状（lstat / resolve）与目标形状（readText / writeText / stat / listDir）的区分**——
 *     实现者勿把裸路径串直接喂给目标形状的方法。
 *   - `env`：只读视图 `get(k)` / `has(k)`；宿主进程环境只读包装（只读不改、不外发；起进程一律经 DSH 子进程服务）。
 *
 * 系统专属行为（win32 盘符护栏、cmd→cmd.exe 别名、getHome 优先级细节、环境变量覆盖等）归 **3 个系统底座**
 * （作为 #113 子票另行规划）；本文件在这些适配器里只留最小结构 + 待办占位，**不在本文件预实现**。
 *
 * 以后谁改它：改「找可执行文件」三层解析（DSH 解析 → DSH_GH_PATH 兜底 → 空）、主目录缓存、
 * 路径委托或本机可见打开调起的人。调用链位置见 #1068：它是找 gh 可执行文件的必经层。
 * 类型只写本文件实际用到的形状：宿主上下文是动态缝，取回的服务一律按 any 收，调用点用 typeof 与
 * try/catch 守（与原来一致，类型不替代那些运行时判断）；其余一律精确标注。
 */

// 本域 tsconfig 有意不加载任何类型包（types 为空），node:path 的类型声明随 @types/node
// 一起被挡在门外；运行时一定是 Node，这个模块必然存在。所以只忽略导入这一行的类型错误
// （纯类型层面，不影响 esbuild 的运行时转译）——与 src/host/platform/darwin/index.ts 同一写法。
// @ts-expect-error
import nodePath from 'node:path'
import darwin from './darwin/index.js'
import win32 from './win32/index.js'
import linux from './linux/index.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { PROC_GRACE_MS } from '../../shared/time-config/values.js'

/** 宿主上下文（动态缝）：取哪个服务都可能缺席，取回值按 any 收，调用点用 typeof 与 try/catch 守。 */
interface HostCtx {
  get(name: string): any
  set?(name: string, value: unknown): unknown
}

/** 路径数学的外形：同步方法全委托 node:path，另含唯一异步成员 joinHome。 */
interface PathImpl {
  join(...parts: string[]): string
  sep: string
  dirname(p: string): string
  basename(p: string): string
  resolve(...parts: string[]): string
  normalize(p: string): string
  isAbsolute(p: string): boolean
  relative(from: string, to: string): string
}

/** 单个系统适配器的产出形状（三底座各自实现，通用层只按这形取用，多一条都不读）。 */
interface AdapterSpec {
  pathImpl: PathImpl
  getHome: () => Promise<string | null>
  resolveExecutable: (name: string) => string | null | Promise<string | null>
  shellOpen?: ShellOpenRecipe | null
}

/** 本机可见打开的配方（归各系统底座出，通用层只按这形调起，不分支系统名）。 */
interface ShellOpenRecipe {
  opener: string
  normalize: (target: string) => string
  allowOpen?: (target: string) => boolean
  folderArgs?: (target: string) => string[]
  fileArgs?: (target: string) => string[] | null
}

/** 环境变量来源：注入的对象或宿主进程环境；get 存在时优先走它，否则按普通对象取值。 */
type EnvSource = Record<string, string | undefined> & { get?: (key: string) => string | undefined }

/** 适配器可选项：测试夹具用它注入主目录与环境实现；生产走宿主上下文与宿主进程环境。 */
interface PlatformOpts {
  homedir?: () => string
  env?: EnvSource
}

/** 单个系统适配器函数（三底座的默认导出都是这形）。 */
type AdapterFn = (ctx: HostCtx, opts?: PlatformOpts) => AdapterSpec

/** 平台对外形状（#129 契约；detectChain.ts 按导入路径取用 Platform 类型，改字段先改那一处）。 */
export interface Platform {
  os: string
  getHome: () => Promise<string | null>
  path: PlatformPath
  resolveExecutable: (name: string) => Promise<string | null>
  fs: unknown
  env: PlatformEnv
  openFolder: (dir: string, cwd?: string) => Promise<OpenResult>
  openFile: (file: string, cwd?: string) => Promise<OpenResult>
}

/** 路径工具（node:path 的适配面；joinHome 是平台层补的那一件）。 */
export interface PlatformPath extends PathImpl {
  joinHome(...segs: string[]): Promise<string>
}

/** 环境只读视图：只读不改、不外发。 */
export interface PlatformEnv {
  get(k: string): string | undefined
  has(k: string): boolean
}

/** 本机可见打开一次调起的结论：成没成、用的哪个打开器、为什么没成。 */
export interface OpenResult {
  ok: boolean
  opener?: string
  error?: string
}

// 运行时的 process 声明：本文件只读 env 与 platform 两个成员；本域 types 为空是既有口径，
// Node 运行时保证它存在，所以按存在声明（同 win32/index.ts 的写法），不产生运行时代码。
declare const process: { env: Record<string, string | undefined>; platform: string }

export const OS_KINDS = Object.freeze({ DARWIN: 'darwin', WIN32: 'win32', LINUX: 'linux' })

/** 平台实现注册表（静态引入，运行时按系统名查表）。 */
const REGISTRY: Record<string, AdapterFn> = Object.freeze({ darwin, win32, linux })

/**
 * 平台抽象接口（#129 契约形状；本层对每个系统适配器做通用包装后返回）。
 * @typedef {Object} Platform
 * @property {string} os  当前平台 kind（`OS_KINDS`），如 `'win32'` / `'darwin'` / `'linux'`。
 * @property {() => Promise<string|null>} getHome  跨系统单点；结果缓存在实现内部（无强制刷新口）。
 * @property {Object} path  同步对象（委托 node:path）+ 唯一异步成员 `joinHome(...segs)`。
 * @property {(name: string) => Promise<string|null>} resolveExecutable  包装 DSH 子进程服务（抛错→空）。
 * @property {Object} fs  DSH 沙箱文件服务透传（lstat/readText/writeText/resolve/listDir/stat；无新建目录方法）。
 * @property {{get(k: string): string|undefined, has(k: string): boolean}} env  只读视图。
 * @property {(dir: string, cwd?: string) => Promise<{ok: boolean, opener?: string, error?: string}>} openFolder  本机可见打开目录（#497 调起单点，配方归底座）。
 * @property {(file: string, cwd?: string) => Promise<{ok: boolean, opener?: string, error?: string}>} openFile  本机可见打开文件（#497 调起单点，配方归底座）。
 */

/** 测缓存：getHome 结果缓存（进程内主目录不变 → 默认终身缓存）。 */
function memoize<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: T | undefined
  return async () => {
    if (cached === undefined) cached = await fn()
    return cached
  }
}

/** 通用包装：path（委托 node:path / win32 变体）+ 异步 joinHome。 */
function buildPath(pathImpl: PathImpl, getHome: () => Promise<string | null>): PlatformPath {
  return Object.freeze({
    join: pathImpl.join.bind(pathImpl),
    sep: pathImpl.sep,
    dirname: pathImpl.dirname.bind(pathImpl),
    basename: pathImpl.basename.bind(pathImpl),
    resolve: pathImpl.resolve.bind(pathImpl),
    normalize: pathImpl.normalize.bind(pathImpl),
    isAbsolute: pathImpl.isAbsolute.bind(pathImpl),
    relative: pathImpl.relative.bind(pathImpl),
    async joinHome(...segs: string[]) {
      // 为空的断言只过类型检查：原来就是原样透传，空时由 node:path 自行抛错，行为与原来一字不差。
      return pathImpl.join((await getHome()) as string, ...segs)
    },
  })
}

/** 通用包装：env 只读视图（宿主进程环境只读包装，只读不改、不外发）。 */
function buildEnv(envSource: EnvSource): PlatformEnv {
  return Object.freeze({
    get(k: string) {
      return envSource[k]
    },
    has(k: string) {
      return k in envSource
    },
  })
}

/**
 * 组装：用给定系统适配器做通用包装，返回 #129 契约形状的 `Platform`。
 * 导出以便单机直测三系统分支（`createPlatform` 依赖 `process.platform`，只能跑到当前系统）。
 * opts 支持可测性注入（#113/#131）：{ homedir?: () => string, env?: object } 透传给适配器；
 * env 同时作为平台 env 视图源（默认宿主进程环境）。
 * @param {Object} ctx
 * @param {string} osName   `OS_KINDS` 值。
 * @param {(ctx: Object, opts?: object) => {os: string, pathImpl: Object, getHome: () => Promise<string|null>, resolveExecutable: (name: string) => Promise<string|null>}} adapter
 * @param {object} [opts]
 * @returns {Promise<Platform>}
 */
export async function composePlatform(ctx: HostCtx, osName: string, adapter: AdapterFn, opts?: PlatformOpts): Promise<Platform> {
  const spec = adapter(ctx, opts)
  const getHome = memoize(() => spec.getHome())
  const path = buildPath(spec.pathImpl, getHome)
  const fs = ctx.get('fs') // DSH 沙箱文件服务（读穿透、写有栅栏）——透传，不叠白名单。
  const envSource: EnvSource = (opts && opts.env) || process.env
  // 2026-08-29 统一（research 实锤「三底座 DSH_GH_PATH 不一致」）：gh 的 DSH_GH_PATH 兜底【单点下沉到通用层】——
  //   PATH 解析失败（返回空 / 抛错）时，读取环境变量 DSH_GH_PATH + 文件存在性校验，存在才返回；三个系统底座行为由此一致。
  //   各系统适配器不重复实现（linux 原自带兜底 2026-08-29 移除，见 linux/index.ts）；host 找 gh 与 gh 客户端均经本包装获益。
  const resolveExecutable = async (name: string): Promise<string | null> => {
    let direct: string | null = null
    try {
      direct = await spec.resolveExecutable(name)
    } catch {
      direct = null
    }
    if (direct) return direct
    if (name === 'gh') {
      const fb = envSource && typeof envSource.get === 'function' ? envSource.get('DSH_GH_PATH') : (envSource ? envSource['DSH_GH_PATH'] : '')
      if (fb && fs && typeof fs.lstat === 'function') {
        try {
          const info = await fs.lstat(fb)
          if (info) return fb
        } catch { /* 兜底失败 → 空，交由调用方诚实报告 */ }
      }
    }
    return null
  }
  // 本机可见打开（#497，通用层单点拥有调起，配方归各系统底座）。
  // 调用方只说意图（开目录/开文件），不分支系统名：win32 经 cmd start 显式可视，darwin/open 与 linux/xdg-open 直调。
  // 调起一律即发即忘（不等退出，同步抛错才算失败）；数组直传，引号由调起层按需加，不手写。
  const spawnOpen = function (argv: string[], cwd?: string): OpenResult {
    let subprocess: any = null
    try { subprocess = ctx.get('subprocess') } catch { subprocess = null }
    if (!subprocess || typeof subprocess.spawn !== 'function') return { ok: false, error: '当前环境不支持调起' }
    try {
      const handle = subprocess.spawn({ argv: argv, cwd: cwd, stdio: { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 64 * 1024 } }, graceMs: PROC_GRACE_MS })
      if (handle && handle.done) handle.done.catch(function () {})
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String((e && (e as { message?: unknown }).message) || e) }
    }
  }
  const openTarget = async function (kind: string, raw: string, cwd?: string): Promise<OpenResult> {
    try {
      const recipe = spec.shellOpen || null
      if (!recipe || typeof recipe.normalize !== 'function') return { ok: false, error: '当前平台不支持打开' }
      const target = recipe.normalize(String(raw || ''))
      if (!target) return { ok: false, error: '路径为空' }
      if (typeof recipe.allowOpen === 'function' && !recipe.allowOpen(target)) return { ok: false, error: '路径含不可调起字符' }
      const exe = await resolveExecutable(recipe.opener)
      if (!exe) return { ok: false, error: '找不到打开器：' + recipe.opener }
      const home = cwd || target
      if (kind === 'file' && typeof recipe.fileArgs === 'function') {
        const fileArgv = recipe.fileArgs(target)
        // 文件配方回空（如 win32 名内有空格拼不出选中串）→ 改开上级目录，看得见位置，不选中。
        if (!fileArgv) return openTarget('folder', path.dirname(target), cwd)
        const started = spawnOpen([exe].concat(fileArgv), home)
        if (!started.ok) return started
        return { ok: true, opener: exe }
      }
      const folderArgv = typeof recipe.folderArgs === 'function' ? recipe.folderArgs(target) : [target]
      const started = spawnOpen([exe].concat(folderArgv), home)
      if (!started.ok) return started
      return { ok: true, opener: exe }
    } catch (e) {
      return { ok: false, error: String((e && (e as { message?: unknown }).message) || e) }
    }
  }
  const openFolder = function (dir: string, cwd?: string): Promise<OpenResult> { return openTarget('folder', dir, cwd) }
  const openFile = function (file: string, cwd?: string): Promise<OpenResult> { return openTarget('file', file, cwd) }
  return Object.freeze({
    os: osName,
    getHome,
    path,
    resolveExecutable,
    fs,
    env: buildEnv(envSource),
    openFolder,
    openFile,
  })
}

/**
 * 按 `process.platform` 选取对应系统实现并返回（平台层入口；宿主构建后端上下文时调用一次、全局复用）。
 * 第二参支持系统覆盖（#113 可测性）：createPlatform(ctx, 'win32') 使单机可判三端。
 * @param {Object} ctx
 * @param {string|object} [osNameOrOpts]  字符串则为系统覆盖；对象则视为 opts（兼容老调用）。
 * @param {object} [maybeOpts]
 * @returns {Promise<Platform>}
 */
export async function createPlatform(ctx: HostCtx, osNameOrOpts?: string | PlatformOpts, maybeOpts?: PlatformOpts): Promise<Platform> {
  let osName: string
  let opts: PlatformOpts | undefined
  if (typeof osNameOrOpts === 'string') {
    osName = osNameOrOpts
    opts = maybeOpts
  } else if (osNameOrOpts && typeof osNameOrOpts === 'object') {
    osName = (process && process.platform) || OS_KINDS.WIN32
    opts = osNameOrOpts
  } else {
    osName = (process && process.platform) || OS_KINDS.WIN32
    opts = undefined
  }
  const impl = REGISTRY[osName]
  if (!impl) throw new Error('platform unsupported: ' + osName)
  return composePlatform(ctx, osName, impl, opts)
}

export default createPlatform
