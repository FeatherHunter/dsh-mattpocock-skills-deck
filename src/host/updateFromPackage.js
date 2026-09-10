// src/host/updateFromPackage.js —— 宿主更新接线（#586 当前插件迁移到更新包，行为零变化）。
//
// 以后谁改它：改「更新系统运行时走包还是走旧实现」的人。改之前先看 #586 票与地图 #579：旧文件留而不搬。
//
// 接线：由 src/host/index.js 动态 import 加载；本文件只做一件事，
// 调更新包建更新能力并拿回电话处理器（插件标识与电话名前缀都是旧值，
// 所以三个电话名、落盘目录、三个文件名与旧字面一字不差）。
// 旧实现（./update.js、./updateReader.js、./updateStore.js）原地只读留存，本文件不引用它们。
// 更新包派生副本在 ./updatePkg/（由 node scripts/derive-update-from-package.mjs 生成，人手不改），
// 本文件经相对路径引用它，构建原样复制后两边都有效，随包发布线上可用。
//
// 用词：电话指宿主对外提供的方法；落盘指宿主统一写本地文件的动作。
// 更新包指装着更新系统的那个 npm 包；更新系统指更新功能本身。

import { createHostUpdate, __resetSharedUpdateReaderForTests as resetPackageReader } from './updatePkg/host.js'

// 本插件在更新包里的两个注册参数：插件标识（必填）与电话名前缀。
// 按规格，前缀取包里的默认值即等于旧值 wf，所以这里从头两个电话名的字面一眼可校对，
// 不另写第二份「期望值」常量去和包里的默认值各说各话。
export const UPDATE_PLUGIN_ID = 'dsh-mattpocock-skills-deck'
export const UPDATE_PHONE_PREFIX = 'wf'
// 更新包自报的默认目标包名（要检查更新的那个包是谁）与官方源，
// 供门禁核对「默认值与旧字面一致」，避免把默认值写死在两处。
export { DEFAULT_TARGET_PACKAGE, DEFAULT_REGISTRY, DEFAULT_PREFIX } from './updatePkg/config.js'

let phones = null
let phonesKey = ''

/**
 * 建三个电话的处理器（查状态 / 查新版 / 装更新）。
 * 入参与旧实现同名同形（deps.logCtx、deps.ctx、deps.readerOverrides），
 * 这样调用方与门禁都不用改；内部换成更新包的建能力入口。
 */
export function createUpdatePhoneHandlers(deps = {}) {
  const ctx = deps.ctx ?? null
  const key = `${ctx ? 'ctx' : 'noctx'}\0${deps.desktopPnpm ? 'pnpm' : 'nopnpm'}\0${deps.logCtx ? 'log' : 'nolog'}`
  if (phones && phonesKey === key) return phones
  const holder = createHostUpdate(
    {
      ctx,
      logCtx: deps.logCtx ?? null,
      desktopPnpm: deps.desktopPnpm,
      readerOverrides: deps.readerOverrides ?? {},
    },
    {
      pluginId: UPDATE_PLUGIN_ID,
      prefix: UPDATE_PHONE_PREFIX,
    }
  )
  // 更新包给的是「电话名 → 处理器」的表；调用方要的是三个具名入口，
  // 这里按键取出来，键名取自包自己拼的电话名，不另拼字符串。
  phones = {
    phoneNames: holder.phoneNames,
    handleUpdateStatus: holder.handlers[holder.phoneNames.updateStatus],
    handleUpdateCheck: holder.handlers[holder.phoneNames.updateCheck],
    handleUpdateInstall: holder.handlers[holder.phoneNames.updateInstall],
  }
  phonesKey = key
  return phones
}

/** 测试与门禁复位单例（正常运行不调用）。
 *  要复位两处：本文件缓存的三个处理器，以及更新包内部缓存的那个读取器。
 *  只复位前者会留下一个隐患——换了假机器之后，包里的旧读取器还在，下一次调用仍复用它，
 *  于是「换一台机器重查」这种用例会拿到上一台的缓存结果（门禁实测踩到过：断网用例却回了成功）。 */
export function __resetSharedUpdateReaderForTests() {
  phones = null
  phonesKey = ''
  resetPackageReader()
}
