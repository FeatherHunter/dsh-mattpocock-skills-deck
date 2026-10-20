/**
 * src/host/logFromPackage.ts —— 宿主日志接线（来源：src/host/logFromPackage.js，#564 当前插件迁移到日志包，行为零变化；本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：宿主侧的日志库现在由 npm 包 dsh-log 统一实现，本文件只负责把宿主手里的文件、时钟、目录三件套递进去，把建好的日志库拿回来，调用方拿不到包时自己回退旧实现。
 *
 * 四条不能改的约定（改之前先看文件头原来那段注释与 #564 票）：
 * 1. 插件标识与电话名前缀都是 wf，默认派生出的目录名、开关文件名、电话名与旧字面一致，改了旧日志就对不上。
 * 2. 建库配置必填 prefix（缺了当场抛错，不再给默认），与 pluginId 同值 wf。
 * 3. 旧实现（./logStore.js、./logPhones.js）原地只读留存，本文件不引用它们，包不可用时由调用方回退旧实现。
 * 4. 取哪一份：直接引用已安装的 npm 包 dsh-log 的宿主入口，宿主用哪一版由 package/package.json 里写死的 dsh-log 版本说了算，客户端那半由构建时按同一个包打包出来，两半版本一致由构建脚本里的断言盯着。
 */

// ---------------------------------------------------------------------------
// 类型（本次转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：递进去的五件套（文件、时钟、取缓存目录、取平台、默认工作区）全部由调用方注入，缺了哪件运行时就少哪件，所以按最小形状收；dsh-log 包的宿主入口自带类型声明，直接用它，不另包一层。
// ---------------------------------------------------------------------------

/** 文件服务口（宿主注入）：日志库读写日志文件与开关文件都走它。 */
interface LogFsPort {
  [key: string]: unknown
}

/** 时钟口（宿主注入）：日志库的时间戳与节流都走它。 */
interface LogTimerPort {
  [key: string]: unknown
}

/** 建日志库时递进去的五件套：文件、时钟、取缓存目录、取平台、默认工作区。 */
interface LogFromPackageDeps {
  fs?: unknown
  timer?: unknown
  getCacheDir?: unknown
  getPlatform?: unknown
  DEFAULT_CWD?: unknown
  [key: string]: unknown
}

/**
 * 建一份宿主日志库并拿回日志库（插件标识与电话名前缀都是 wf）。
 *
 * 为什么：日志库是宿主唯一的写日志出口，调用点只从这里拿，旧实现只读留存，真搬迁或真删除旧文件另开票。
 * 什么约定不能改：第二个参数里 pluginId 与 prefix 固定是 'wf'（少了 prefix 当场抛错是上游包的行为，本文件不兜底）；
 *   pluginVersion 是 #1305 加的第四件「环境自述」，只在读得到服务那一份的版本号时才递（读不到就不写这一格，绝不编）。
 */
export async function createLogFromPackage(deps: LogFromPackageDeps): Promise<unknown> {
  const input: LogFromPackageDeps = deps || {}
  const mod = await import('dsh-log/host')
  // 版本号只有一个出口（rpcChannel 的清单读取）：由装配处 index.ts 读好递进来（#1305）。
  //   本文件不自己去 import rpcChannel —— 宿主层的同层互引被 .dependency-cruiser.ts 的 same-layer-import-host 禁着。
  const pluginVersion = (typeof input.pluginVersion === 'string') ? input.pluginVersion : ''
  const holder: { store: unknown } = mod.createHostLog(
    {
      fs: input.fs as never,
      timer: input.timer as never,
      getCacheDir: input.getCacheDir as never,
      getPlatform: input.getPlatform as never,
      DEFAULT_CWD: input.DEFAULT_CWD as never,
    },
    pluginVersion ? { pluginId: 'wf', prefix: 'wf', pluginVersion: pluginVersion } : { pluginId: 'wf', prefix: 'wf' }
  )
  return (holder as { store: unknown }).store
}
