// src/host/updateFromPackage.js —— 宿主更新接线（地图 #873 薄接线：只留上游 README 基本用法）。
//
// 本文件只做三件事：按包名引用已安装的更新包建更新能力，
// 把电话处理器按键交给调用方（电话名从包自己拼的 phoneNames 读，不另拼字符串）。
// 自己的更新实现已删（旧三件套、旧派生目录、旧共享核心、update-core 源码树，见 #875）；
// 旧实现回退分支已删，包缺失时直接抛错，不静默降级。
//
// 唯一的例外是装完身份证验明正身（__syncInstalledManifest）：上游 0.9.0 的已装版本
// 只读身份证，而文件级安装不换身份证；删掉它会重现 2026-10-01 面板版本不更新的故障。
// 它平时无操作，只写身份证的 version 一个字段，永不抛错。包侧一旦补上同等逻辑，这里连它一起删。
//
// 用词：电话指宿主对外提供的方法；身份证指已装目录的 package.json；横幅指客户端产物里的版本标记。

import {
  createHostUpdate,
  resolveUpdateConfig,
  __resetSharedUpdateReaderForTests as resetPackageReader,
} from 'dsh-plugin-update'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 本插件在更新包里的两个注册参数：插件标识（必填）与电话名前缀。
// 按规格，前缀取包里的默认值即等于旧值 wf，所以这里从头两个电话名的字面一眼可校对，
// 不另写第二份「期望值」常量去和包里的默认值各说各话。
export const UPDATE_PLUGIN_ID = 'dsh-mattpocock-skills-deck'
export const UPDATE_PHONE_PREFIX = 'wf'
// 更新包自报的默认目标包名（要检查更新的那个包是谁）与官方源与默认前缀，
// 供门禁核对「默认值与旧字面一致」。取值只从已安装包的配置面算出来，不在本文件另写字面。
const __pkgDefaults = resolveUpdateConfig({ pluginId: UPDATE_PLUGIN_ID })
export const DEFAULT_TARGET_PACKAGE = __pkgDefaults.targetPackageName
export const DEFAULT_REGISTRY = __pkgDefaults.registryUrl
export const DEFAULT_PREFIX = __pkgDefaults.prefix

let phones = null
let phonesKey = ''

// 三段式版本号比较的最小实现（只认 x.y.z 全数字形，其余一律视为不可比）。
// 放这里而不引包里的比较函数：包里那份没对外导出，为三行逻辑多一层依赖不值。
const RELEASE_TRIPLE = /^(\d+)\.(\d+)\.(\d+)$/
export function __parseReleaseTriple(version) {
  const m = typeof version === 'string' ? RELEASE_TRIPLE.exec(version.trim()) : null
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}
// 门禁与单测共用：current 是否真比 target 旧（任一不可比都算不旧，永不降级）。
export function __manifestOlderThan(current, target) {
  const a = __parseReleaseTriple(current)
  const b = __parseReleaseTriple(target)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i]
  }
  return false
}
// 门禁与单测共用：从客户端产物文本里读出构建时注入的版本号（读不到为 null）。
export function __bannerVersionOf(clientText) {
  const m = /DSW_VERSION\s*=\s*'v?(\d+\.\d+\.\d+)'/.exec(typeof clientText === 'string' ? clientText : '')
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
export async function __syncInstalledManifest({ moduleDir, targetVersion, io, log }) {
  try {
    if (!__parseReleaseTriple(targetVersion)) return 'skip:no-target'
    if (typeof moduleDir !== 'string' || moduleDir.toLowerCase().indexOf('node_modules') < 0) return 'skip:not-installed-copy'
    const root = dirname(moduleDir)
    const manifestPath = join(root, 'package.json')
    const manifest = JSON.parse(await io.readFile(manifestPath, 'utf8'))
    if (!manifest || manifest.name !== UPDATE_PLUGIN_ID) return 'skip:name-mismatch'
    const current = manifest.version
    if (current === targetVersion) return 'skip:already'
    if (!__manifestOlderThan(current, targetVersion)) return 'skip:not-older'
    let banner = null
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

/**
 * 建四个电话的处理器（查状态 / 查新版 / 装更新 / 取更新日志）。
 * 入参与旧形状同名（deps.logCtx、deps.ctx、deps.readerOverrides），调用方与门禁都不用改；
 * 内部只是更新包的建能力入口，不传自定义安装执行，不挡包路由。
 * 装更新那条包一层验明正身（见 __syncInstalledManifest）：文件级安装不换身份证时，
 * 把身份证补成代码横幅里那个已装好的版本；平时无操作直通，安装回包原样返回。
 * 取更新日志那条原样直通，给面板日志章用（面板票 #876）。
 */
export function createUpdatePhoneHandlers(deps = {}) {
  const ctx = deps.ctx ?? null
  const key = `${ctx ? 'ctx' : 'noctx'}\0${deps.logCtx ? 'log' : 'nolog'}`
  if (phones && phonesKey === key) return phones
  const holder = createHostUpdate(
    {
      ctx,
      logCtx: deps.logCtx ?? null,
      readerOverrides: deps.readerOverrides ?? {},
    },
    {
      pluginId: UPDATE_PLUGIN_ID,
      prefix: UPDATE_PHONE_PREFIX,
    }
  )
  // 更新包给的是「电话名 → 处理器」的表；调用方要的是四个具名入口，
  // 这里按键取出来，键名取自包自己拼的电话名，不另拼字符串。
  const rawInstall = holder.handlers[holder.phoneNames.updateInstall]
  const hereDir = dirname(fileURLToPath(import.meta.url))
  const syncLog = deps.logCtx ?? null
  phones = {
    phoneNames: holder.phoneNames,
    handleUpdateStatus: holder.handlers[holder.phoneNames.updateStatus],
    handleUpdateCheck: holder.handlers[holder.phoneNames.updateCheck],
    handleUpdateInstall: async function (args) {
      const result = await rawInstall(args)
      const target = result && result.snapshot && result.snapshot.job && result.snapshot.job.targetVersion
      await __syncInstalledManifest({ moduleDir: hereDir, targetVersion: target, io: { readFile, writeFile }, log: syncLog })
      return result
    },
    handleUpdateChangelog: holder.handlers[holder.phoneNames.updateChangelog],
  }
  phonesKey = key
  return phones
}

/** 测试与门禁复位单例（正常运行不调用）。
 *  要复位两处：本文件缓存的四个处理器，以及更新包内部缓存的那个读取器。
 *  只复位前者会留下一个隐患——换了假机器之后，包里的旧读取器还在，下一次调用仍复用它，
 *  于是「换一台机器重查」这种用例会拿到上一台的缓存结果（门禁实测踩到过：断网用例却回了成功）。 */
export function __resetSharedUpdateReaderForTests() {
  phones = null
  phonesKey = ''
  resetPackageReader()
}
