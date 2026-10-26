/**
 * src/host/logFromPackage.ts —— 宿主日志接线（来源：src/host/logFromPackage.js，#564 当前插件迁移到日志包；#1432 起日志开关只认本机设置文件一处真源）。
 *
 * 为什么要有它（一句话）：宿主侧的日志库现在由 npm 包 dsh-log 统一实现，本文件只负责把宿主手里的文件、时钟、目录三件套递进去，把建好的日志库拿回来，拿不到包时调用方直接抛错，不回退旧实现（#1143）。
 *
 * 四条不能改的约定（改之前先看文件头原来那段注释与 #564 票）：
 * 1. 插件标识与电话名前缀都是 wf，默认派生出的目录名、电话名与旧字面一致，改了旧日志就对不上。
 * 2. 建库配置必填 prefix（缺了当场抛错，不再给默认），与 pluginId 同值 wf。
 * 3. 旧实现已随 #1143 删除，本文件不引用它们，包不可用时调用方直接抛错并禁用日志。
 * 4. 取哪一份：直接引用已安装的 npm 包 dsh-log 的宿主入口，宿主用哪一版由 package/package.json 里写死的 dsh-log 版本说了算，客户端那半由构建时按同一个包打包出来，两半版本一致由构建脚本里的断言盯着。
 *
 * 另外一条（#960 收尾补上）：建库配置必须递常驻事件清单（eventList）。日志包只把不在它内置 43 条里的事件当「按需」，
 * 不递清单时，附录标成常驻的那些信息级事件在调试开关关着时就悄悄不落盘。清单唯一真源是 src/shared/log-event-list.ts，
 * 客户端那半由 scripts/derive-log-from-package.mts 在构建期注入同一份清单，两边不要各写一份。
 *
 * #1432（2026-10-23）：调试日志开关只有一处真源 —— 用户主目录下 .dsh/mattskillsdeck/settings.yaml 的 debug.enabled。
 * 缓存目录里的 log-switch.json 是旧版另存的一份复印件，这条通路上不再有任何东西读它或写它。宿主开机时把「开关来源」
 * 递给日志包，包就完全不读不写自己那份开关文件；同时这里顺手删掉遗留的 log-switch.json（删不掉只记一条告警，不挡开机）。
 */

// 本域 tsconfig 有意不加载 Node 类型包（types 为空），运行时一定是 Node，这个内建模块必然存在。
// @ts-expect-error
import { unlink as nodeUnlink } from 'node:fs/promises'

import { LOG_EVENT_LIST } from '../shared/log-event-list.js'

// ---------------------------------------------------------------------------
// 类型（本次转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：递进去的五件套（文件、时钟、取缓存目录、取平台、默认工作区）全部由调用方注入，缺了哪件运行时就少哪件，所以按最小形状收；dsh-log 包的宿主入口自带类型声明，直接用它，不另包一层。
// ---------------------------------------------------------------------------

/** 文件服务口（宿主注入）：日志库读写日志文件走它；本文件只用到删文件那一格（开机清理遗留开关文件）。 */
interface LogFsPort {
  unlink?: unknown
  [key: string]: unknown
}

/** 开关来源（#1432）：宿主递给日志包的开关读写两格；给了它，包就完全不读不写自己的 log-switch.json。 */
interface LogSwitchSource {
  get: () => Promise<boolean | null> | boolean | null
  set?: (enabled: boolean) => Promise<boolean | null> | boolean | null
  [key: string]: unknown
}

/** 建日志库时递进去的五件套，另加两格：开关来源（不传就沿用日志包自己的开关文件）与清理遗留文件用的文件口。 */
interface LogFromPackageDeps {
  fs?: unknown
  timer?: unknown
  getCacheDir?: unknown
  getPlatform?: unknown
  DEFAULT_CWD?: unknown
  switchSource?: LogSwitchSource
  fsPort?: LogFsPort
  [key: string]: unknown
}

// 旧版开关文件的文件名（#1432：这个文件名只用于「开机顺手删掉」，不再是任何东西的真源）。
const LEGACY_SWITCH_FILE_NAME = 'log-switch.json'

// 目录摘要：与日志包和旧实现同一套 djb2 短散列（8 位十六进制），只用来在日志里指认目录，不记原文路径。
function hashText(text?: unknown): string {
  try {
    const t = String(text || '')
    let h = 5381
    for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
    return ('0000000' + h.toString(16)).slice(-8)
  } catch (e) { return '00000000' }
}

// 从缓存目录拼出旧开关文件的完整路径：去掉末尾斜杠再拼；缓存目录为空时回空串（没有目录就没有可删的文件）。
function legacySwitchPathOf(cacheDir?: unknown): string {
  const dir = String(cacheDir || '').replace(/[\\/]+$/, '')
  return dir ? dir + '/' + LEGACY_SWITCH_FILE_NAME : ''
}

// 开机清理旧版开关文件（#1432）：文件在就删掉，不在就静默。
// 删失败只记一条 warn（事件与字段沿用写盘失败的既有口径：log.persist.fail 的 op、reason、dirHash），绝不抛、不挡开机。
async function removeLegacySwitchFile(store: any, input: LogFromPackageDeps, cacheDir: unknown): Promise<void> {
  const target = legacySwitchPathOf(cacheDir)
  if (!target) return
  const fsPort: any = input.fsPort || null
  const unlinkFn: any = (fsPort && typeof fsPort.unlink === 'function') ? fsPort.unlink : nodeUnlink
  try {
    await unlinkFn(target)
  } catch (e) {
    const code = String(((e as any) && (e as any).code) || '')
    const msg = String(((e as any) && (e as any).message) || e || '')
    if (code === 'ENOENT' || code === 'FS_NOT_FOUND' || /not found/i.test(msg)) return
    try {
      if (store && typeof store.log === 'function') {
        store.log('warn', 'log.persist.fail', { op: 'remove-switch-file', reason: 'unlink-fail', dirHash: hashText(cacheDir) })
      }
    } catch (eLog) {}
  }
}

/**
 * 建一份宿主日志库并拿回日志库（插件标识与电话名前缀都是 wf）。
 *
 * 为什么：日志库是宿主唯一的写日志出口，调用点只从这里拿，旧实现已随 #1143 删除。
 * 什么约定不能改：第二个参数里 pluginId 与 prefix 固定是 'wf'（少了 prefix 当场抛错是上游包的行为，本文件不兜底）；
 *   pluginVersion 是 #1305 加的第四件「环境自述」，只在读得到服务那一份的版本号时才递（读不到就不写这一格，绝不编）。
 * #1432 那一格：deps.switchSource 有 get 才递给日志包；递了之后包不再读写缓存目录里的开关文件，
 *   而开机清理遗留文件也只在这种情况下做 —— 老调用方没接线时包还在用那份文件，删了反而丢状态。
 */
export async function createLogFromPackage(deps: LogFromPackageDeps): Promise<unknown> {
  const input: LogFromPackageDeps = deps || {}
  const mod = await import('dsh-log/host')
  // 版本号只有一个出口（rpcChannel 的清单读取）：由装配处 index.ts 读好递进来（#1305）。
  //   本文件不自己去 import rpcChannel —— 宿主层的同层互引被 .dependency-cruiser.ts 的 same-layer-import-host 禁着。
  const pluginVersion = (typeof input.pluginVersion === 'string') ? input.pluginVersion : ''
  // #1432：开关来源接上了才把它递给日志包（包认得这一格之后，loadSwitch 调 get、setSwitch 调 set，完全不碰自己的开关文件）。
  const storeDeps: any = {
    fs: input.fs as never,
    timer: input.timer as never,
    getCacheDir: input.getCacheDir as never,
    getPlatform: input.getPlatform as never,
    DEFAULT_CWD: input.DEFAULT_CWD as never,
  }
  if (input.switchSource && typeof input.switchSource.get === 'function') storeDeps.switchSource = input.switchSource
  const holder: any = mod.createHostLog(
    storeDeps,
    pluginVersion
      ? { pluginId: 'wf', prefix: 'wf', pluginVersion: pluginVersion, eventList: LOG_EVENT_LIST }
      : { pluginId: 'wf', prefix: 'wf', eventList: LOG_EVENT_LIST }
  )
  const store: any = holder && holder.store
  // #1432：开关来源接上了才清理旧版开关文件（没接线时日志包还在用那份文件，删了会丢状态）。
  if (storeDeps.switchSource) {
    let cacheDir: unknown = ''
    try { cacheDir = (typeof input.getCacheDir === 'function') ? await (input.getCacheDir as any)() : '' } catch (e) { cacheDir = '' }
    await removeLegacySwitchFile(store, input, cacheDir)
  }
  return store
}
