/**
 * platform/index.js — 平台抽象层（次缝）：通用层。
 *
 * 按 #113 D4/D5 + #129（CLOSED 定稿接口）实现「通用层」，#113 D1–D7 与「已确认 5 条」为权威依据。
 *
 * 职责（本票 #130 只做通用层）：
 *   - `createPlatform(ctx)` 工厂 + `REGISTRY = { darwin, win32, linux }` **静态 import 查表**
 *     （绝不用变量路径动态 import，否则 esbuild 无法静态分析、打包产物缺文件）。
 *   - 把选定的 OS 适配器包装成 #129 契约形状（`getHome` / `path` / `resolveExecutable` / `fs` / `env`）。
 *
 * 通用包装在此**单点拥有**（跨 OS 不重复、行为一致）：
 *   - `getHome()`：结果缓存于平台实现内部（替换现有 userHome 缓存变量；`getHomeFresh` 不暴露，
 *     缓存失效策略由平台自定——进程内主目录不变，默认终身缓存）。
 *   - `path`：同步方法**全部委托 `node:path`**（win32 用 `node:path.win32`，darwin/linux 用
 *     `node:path.posix`）；各 OS 不得重实现路径数学，否则 self-made join 即第二真相、即 bug 农场。
 *     另含唯一异步成员 `joinHome(...segs)` = `path.join(await getHome(), ...segs)`——deck 永不字符串拼接 `'\\'`。
 *   - `resolveExecutable(name)`：包装 DSH `subprocess.resolveExecutable`；DSH 找不到时 throw →
 *     本层 try/catch **转 null**（返回 `Promise<string|null>`）。**2026-08-29 起**：`gh` 的
 *     DSH_GH_PATH 兜底（env 读取 + fs.lstat 校验）由本层**单点拥有**，三个 OS 底座一致（linux 适配器的
 *     原兜底已于同日移除，不再重复实现）。
 *   - `fs`：**透传** `ctx.get('fs')`（DSH dsh-fs-sandbox：读穿透沙箱、写有栅栏）；**无 `mkdir`**。
 *     注意 **path-shaped（lstat / resolve）vs target-shaped（readText / writeText / stat / listDir）**——
 *     实现者勿把裸路径串直接喂给 target-shaped 方法。
 *   - `env`：只读视图 `get(k)` / `has(k)`；`process.env` 只读包装（只读不改、不外发；spawn 一律经 DSH subprocess）。
 *
 * OS 专属行为（win32 盘符护栏、cmd→cmd.exe 别名、getHome 优先级细节、环境变量覆盖等）归 **3 个 OS 底座 map**
 * （作为 #113 子票另行规划）；本票在这些适配器里只留最小结构 + TODO 占位，**不在本票预实现**。
 */

import nodePath from 'node:path'
import darwin from './darwin/index.js'
import win32 from './win32/index.js'
import linux from './linux/index.js'

export const OS_KINDS = Object.freeze({ DARWIN: 'darwin', WIN32: 'win32', LINUX: 'linux' })

/** 平台实现注册表（静态 import，运行时按 platform 查表）。 */
const REGISTRY = Object.freeze({ darwin, win32, linux })

/**
 * 平台抽象接口（#129 契约形状；本层对每个 OS 适配器做通用包装后返回）。
 * @typedef {Object} Platform
 * @property {string} os  当前平台 kind（`OS_KINDS`），如 `'win32'` / `'darwin'` / `'linux'`。
 * @property {() => Promise<string|null>} getHome  跨 OS 单点；结果缓存在实现内部（无强制刷新口）。
 * @property {Object} path  同步对象（委托 node:path）+ 唯一异步成员 `joinHome(...segs)`。
 * @property {(name: string) => Promise<string|null>} resolveExecutable  包装 DSH subprocess（throw→null）。
 * @property {Object} fs  DSH 沙箱 fs 透传（lstat/readText/writeText/resolve/listDir/stat；无 mkdir）。
 * @property {{get(k: string): string|undefined, has(k: string): boolean}} env  只读视图。
 */

/** 测缓存：getHome 结果缓存（进程内主目录不变 → 默认终身缓存）。 */
function memoize(fn) {
  let cached
  return async () => {
    if (cached === undefined) cached = await fn()
    return cached
  }
}

/** 通用包装：path（委托 node:path / win32 变体）+ 异步 joinHome。 */
function buildPath(pathImpl, getHome) {
  return Object.freeze({
    join: pathImpl.join.bind(pathImpl),
    sep: pathImpl.sep,
    dirname: pathImpl.dirname.bind(pathImpl),
    basename: pathImpl.basename.bind(pathImpl),
    resolve: pathImpl.resolve.bind(pathImpl),
    normalize: pathImpl.normalize.bind(pathImpl),
    isAbsolute: pathImpl.isAbsolute.bind(pathImpl),
    relative: pathImpl.relative.bind(pathImpl),
    async joinHome(...segs) {
      return pathImpl.join(await getHome(), ...segs)
    },
  })
}

/** 通用包装：env 只读视图（process.env 只读包装，只读不改、不外发）。 */
function buildEnv(envSource) {
  return Object.freeze({
    get(k) {
      return envSource[k]
    },
    has(k) {
      return k in envSource
    },
  })
}

/**
 * 组装：用给定 OS 适配器做通用包装，返回 #129 契约形状的 `Platform`。
 * 导出以便单机直测三 OS 分支（`createPlatform` 依赖 `process.platform`，只能跑到当前 OS）。
 * opts 支持可测性注入（#113/#131）：{ homedir?: () => string, env?: object } 透传给适配器；
 * env 同时作为平台 env 视图源（默认 process.env）。
 * @param {Object} ctx
 * @param {string} osName   `OS_KINDS` 值。
 * @param {(ctx: Object, opts?: object) => {os: string, pathImpl: Object, getHome: () => Promise<string|null>, resolveExecutable: (name: string) => Promise<string|null>}} adapter
 * @param {object} [opts]
 * @returns {Promise<Platform>}
 */
export async function composePlatform(ctx, osName, adapter, opts) {
  const spec = adapter(ctx, opts)
  const getHome = memoize(() => spec.getHome())
  const path = buildPath(spec.pathImpl, getHome)
  const fs = ctx.get('fs') // DSH 沙箱 fs（读穿透、写有栅栏）——透传，不叠白名单。
  const envSource = (opts && opts.env) || process.env
  // 2026-08-29 统一（research 实锤「三底座 DSH_GH_PATH 不一致」）：gh 的 DSH_GH_PATH 兜底【单点下沉到通用层】——
  //   PATH 解析失败（返回 null / 抛错）时，读取 env.DSH_GH_PATH + fs.lstat 校验存在才返回；三个 OS 底座行为由此一致。
  //   各 OS 适配器不重复实现（linux 原自带兜底 2026-08-29 移除，见 linux/index.js）；host resolveGh / ghClient 均经本包装获益。
  const resolveExecutable = async (name) => {
    let direct = null
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
        } catch { /* 兜底失败 → null，交由调用方诚实报告 */ }
      }
    }
    return null
  }
  return Object.freeze({
    os: osName,
    getHome,
    path,
    resolveExecutable,
    fs,
    env: buildEnv(envSource),
  })
}

/**
 * 按 `process.platform` 选取对应 OS 实现并返回（平台层入口；宿主构建 BackendContext 时调用一次、全局复用）。
 * 第二参支持 OS 覆盖（#113 可测性）：createPlatform(ctx, 'win32') 使单机可判三端。
 * @param {Object} ctx
 * @param {string|object} [osNameOrOpts]  字符串则为 os 覆盖；对象则视为 opts（兼容老调用）。
 * @param {object} [maybeOpts]
 * @returns {Promise<Platform>}
 */
export async function createPlatform(ctx, osNameOrOpts, maybeOpts) {
  let osName
  let opts
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
