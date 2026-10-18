/**
 * src/host/updateFromPackage.ts —— 宿主更新接线（地图 #873 薄接线：只留上游 README 基本用法）。
 *
 * 来源与零变化：本文件由同目录 updateFromPackage.js 逐行转写而来，只加类型标注与注释，
 * 没有改任何运行时语义。原来的 .js 文件保留不动，引用方继续写 `./updateFromPackage.js`，
 * 由 scripts/ts-hook.mjs 在加载时改指到同名 .ts。
 *
 * 本文件只做三件事：按包名引用已安装的更新包建更新能力，
 * 把电话处理器按键交给调用方（电话名从包自己拼的 phoneNames 读，不另拼字符串）。
 * 自己的更新实现已删（旧三件套、旧派生目录、旧共享核心、update-core 源码树，见 #875）；
 * 旧实现回退分支已删，包缺失时直接抛错，不静默降级。
 *
 * 唯一的例外是装完身份证验明正身（__syncInstalledManifest）：上游 0.9.0 的已装版本
 * 只读身份证，而文件级安装不换身份证；删掉它会重现 2026-10-01 面板版本不更新的故障。
 * 它平时无操作，只写身份证的 version 一个字段，永不抛错。包侧一旦补上同等逻辑，这里连它一起删。
 *
 * 用词：电话指宿主对外提供的方法；身份证指已装目录的 package.json；横幅指客户端产物里的版本标记。
 *
 * 为什么这样标注：
 * 1. 相对导入说明符保留 `.js` 后缀，不改成 `.ts`，改了会绕过钩子的同名解析约定，所以不能动。
 * 2. `node:` 开头的三行导入按 src/host/choiceStore.ts:16-24 同款写法加类型忽略注释：
 *    本域 tsconfig 有意不加载任何类型包，运行时一定是 Node，所以只忽略类型层面的找不到模块错误，
 *    不影响 esbuild 的运行时转译。`dsh-plugin-update` 自带类型声明，不需要忽略注释。
 * 3. 更新包的配置与处理器形状由更新包自己决定，本文件不拥有它们，所以全部按 `any` 收，
 *    类型不替代运行时的判空与判形逻辑。
 * 4. 没有新增任何 import 边：只给已有引用加类型，不引入新模块依赖。
 */

import {
  createHostUpdate,
  resolveUpdateConfig,
  __resetSharedUpdateReaderForTests as resetPackageReader,
} from 'dsh-plugin-update'
// @ts-expect-error
import { readFile, writeFile } from 'node:fs/promises'
// @ts-expect-error
import { dirname, join } from 'node:path'
// @ts-expect-error
import { fileURLToPath } from 'node:url'

// 本插件在更新包里的三个注册参数：插件标识（必填）、电话名前缀与版本通道。
// 按规格，前缀取包里的默认值即等于旧值 wf，所以这里从头两个电话名的字面一眼可校对，
// 不另写第二份「期望值」常量去和包里的默认值各说各话。
export const UPDATE_PLUGIN_ID: string = 'dsh-mattpocock-skills-deck'
export const UPDATE_PHONE_PREFIX: string = 'wf'
// 版本通道取预发布档（2026-10-10 维护者拍板）：跑着测试版、候选版的人也能正常查更新，
// 不会被报「使用范围或插件位置认不出」。代价是跑稳定版的人也可能收到预发布推送——
// 这是拍板时已知并接受的，见 CHANGELOG 里 v1.8.0-rc.2 一节。
export const UPDATE_RELEASE_CHANNEL: string = 'prerelease'
// 更新包自报的默认目标包名（要检查更新的那个包是谁）与官方源与默认前缀，
// 供门禁核对「默认值与旧字面一致」。取值只从已安装包的配置面算出来，不在本文件另写字面。
const __pkgDefaults: any = resolveUpdateConfig({ pluginId: UPDATE_PLUGIN_ID, releaseChannel: UPDATE_RELEASE_CHANNEL as any })
export const DEFAULT_TARGET_PACKAGE: any = __pkgDefaults.targetPackageName
export const DEFAULT_REGISTRY: any = __pkgDefaults.registryUrl
export const DEFAULT_PREFIX: any = __pkgDefaults.prefix

// 单例缓存：处理器表与生成它时的那组依赖键，键一致才复用，不一致就重建。
let phones: any = null
let phonesKey: string = ''

// 三段式版本号比较的最小实现（只认 x.y.z 全数字形，其余一律视为不可比）。
// 放在这里而不引包里的比较函数：包里那份没对外导出，为三行逻辑多一层依赖不值。
const RELEASE_TRIPLE: RegExp = /^(\d+)\.(\d+)\.(\d+)$/
/** 解析三段式版本号：全数字形才认，其余一律回空，调用方按不可比处理。 */
export function __parseReleaseTriple(version: any): number[] | null {
  const m: RegExpMatchArray | null = typeof version === 'string' ? RELEASE_TRIPLE.exec(version.trim()) : null
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}
// 门禁与单测共用：current 是否真比 target 旧（任一不可比都算不旧，永不降级）。
/** 比较两个版本号：任一不可比都算不旧，永不降级，调用方据此决定要不要写身份证。 */
export function __manifestOlderThan(current: any, target: any): boolean {
  const a: number[] | null = __parseReleaseTriple(current)
  const b: number[] | null = __parseReleaseTriple(target)
  if (!a || !b) return false
  for (let i: number = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i]
  }
  return false
}
// 门禁与单测共用：从客户端产物文本里读出构建时注入的版本号（读不到为 null）。
/** 从客户端产物文本里读构建时注入的版本号：读不到就回空，调用方按横幅对不上处理。 */
export function __bannerVersionOf(clientText: any): string | null {
  const m: RegExpMatchArray | null = /DSW_VERSION\s*=\s*'v?(\d+\.\d+\.\d+)'/.exec(typeof clientText === 'string' ? clientText : '')
  return m ? m[1] : null
}

/**
 * 装完验明正身（2026-10-01 面板装完版本显示修复，无单直修）。
 *
 * 为什么需要它：文件级安装只换代码文件、不换身份证（已装目录的 package.json），
 * 而已装版本与待重启判据都读那张身份证。装完不补，面板永远报旧版本、重启提示也永远不冒，
 * 用户会反复点安装。根因在宿主安装器不在本仓库，这里只做无害的真相恢复。
 *
 * 触发条件（缺一不可，任一不满足都原样返回，绝不掩盖一次真正的失败）：
 * 1) 本次安装回包里带合法的目标版本；
 * 2) 本文件跑在已安装的包里（路径含 node_modules；源码仓与门禁里永远走不进来）；
 * 3) 身份证上的名字就是本插件，且写明的版本真比目标旧（永不降级、不重写相等）；
 * 4) 已装代码横幅里的版本恰好等于目标版本（文件确实是新版，安装不是半截子）。
 * 只写身份证的 version 一个字段；配置文件的依赖声明是宿主的东西，一个字不动。
 * 绝不复位共享读取器：运行版本必须冻结在启动时，身份证新、运行旧，待重启才会正常冒出来。
 *
 * @returns 'synced' | 'skip:<原因>'，永不抛错（修不好就原样放过，不挡安装回包）。
 */
export async function __syncInstalledManifest({ moduleDir, targetVersion, io, log }: any): Promise<string> {
  try {
    if (!__parseReleaseTriple(targetVersion)) return 'skip:no-target'
    if (typeof moduleDir !== 'string' || moduleDir.toLowerCase().indexOf('node_modules') < 0) return 'skip:not-installed-copy'
    const root: string = dirname(moduleDir)
    const manifestPath: string = join(root, 'package.json')
    const manifest: any = JSON.parse(await io.readFile(manifestPath, 'utf8'))
    if (!manifest || manifest.name !== UPDATE_PLUGIN_ID) return 'skip:name-mismatch'
    const current: any = manifest.version
    if (current === targetVersion) return 'skip:already'
    if (!__manifestOlderThan(current, targetVersion)) return 'skip:not-older'
    let banner: string | null = null
    try {
      banner = __bannerVersionOf(await io.readFile(join(root, 'lib', 'client.js'), 'utf8'))
    } catch {
      banner = null
    }
    if (banner !== targetVersion) return 'skip:banner-mismatch'
    manifest.version = targetVersion
    await io.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    try {
      if (log && typeof log.fire === 'function') log.fire('info', 'update.install.manifestSync', { pluginId: UPDATE_PLUGIN_ID, fromVersion: current, toVersion: targetVersion })
    } catch {
      // 日志写不进去不影响修复本身
    }
    return 'synced'
  } catch {
    return 'skip:error'
  }
}

/** 文件读写口的最小形状：本文件只用读与写两个动作，其余一律不碰。 */
export interface SyncIo {
  readFile(path: string, encoding: string): Promise<string>
  writeFile(path: string, data: string, encoding: string): Promise<unknown>
}

/**
 * 建五个电话的处理器（查状态 / 查新版 / 装更新 / 取更新日志 / 客户端日志行直追加）。
 * 入参与旧形状同名（deps.logCtx、deps.ctx、deps.readerOverrides），调用方与门禁都不用改；
 * 内部只是更新包的建能力入口，不传自定义安装执行，不挡包路由。
 * 装更新那条包一层验明正身（见 __syncInstalledManifest）：文件级安装不换身份证时，
 * 把身份证补成代码横幅里那个已装好的版本；平时无操作直通，安装回包原样返回。
 * 取更新日志那条原样直通，给面板日志章用（面板票 #876）。
 * 日志直追加那条（0.17 新增）原样直通：更新面板把攒下的客户端日志行一次发过来，
 * 包里验格式、验新鲜、记入更新事件表，调用方只传 rows 数组。
 */
export function createUpdatePhoneHandlers(deps: any = {}): any {
  const ctx: any = deps.ctx ?? null
  const key: string = `${ctx ? 'ctx' : 'noctx'}\0${deps.logCtx ? 'log' : 'nolog'}`
  if (phones && phonesKey === key) return phones
  const holder: any = createHostUpdate(
    {
      ctx,
      logCtx: deps.logCtx ?? null,
      readerOverrides: deps.readerOverrides ?? {},
    },
    {
      pluginId: UPDATE_PLUGIN_ID,
      prefix: UPDATE_PHONE_PREFIX,
      releaseChannel: UPDATE_RELEASE_CHANNEL as any,
    }
  )
  // 更新包给的是「电话名 → 处理器」的表；调用方要的是五个具名入口，
  // 这里按键取出来，键名取自包自己拼的电话名，不另拼字符串。
  const rawInstall: any = holder.handlers[holder.phoneNames.updateInstall]
  const hereDir: string = dirname(fileURLToPath(import.meta.url))
  const syncLog: any = deps.logCtx ?? null
  phones = {
    phoneNames: holder.phoneNames,
    handleUpdateStatus: holder.handlers[holder.phoneNames.updateStatus],
    handleUpdateCheck: holder.handlers[holder.phoneNames.updateCheck],
    handleUpdateInstall: async function (args: any): Promise<any> {
      const result: any = await rawInstall(args)
      const target: any = result && result.snapshot && result.snapshot.job && result.snapshot.job.targetVersion
      await __syncInstalledManifest({ moduleDir: hereDir, targetVersion: target, io: { readFile, writeFile }, log: syncLog })
      return result
    },
    handleUpdateChangelog: holder.handlers[holder.phoneNames.updateChangelog],
    handleLogAppend: holder.handlers[holder.phoneNames.logAppend],
  }
  phonesKey = key
  return phones
}

/** 测试与门禁复位单例（正常运行不调用）。
 *  要复位两处：本文件缓存的五个处理器，以及更新包内部缓存的那个读取器。
 *  只复位前者会留下一个隐患——换了假机器之后，包里的旧读取器还在，下一次调用仍复用它，
 *  于是「换一台机器重查」这种用例会拿到上一台的缓存结果（门禁实测踩到过：断网用例却回了成功）。 */
export function __resetSharedUpdateReaderForTests(): void {
  phones = null
  phonesKey = ''
  resetPackageReader()
}
