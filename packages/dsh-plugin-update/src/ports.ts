/**
 * packages/dsh-plugin-update/src/ports.ts —— 更新模块的插口定义（规格 #591 的字面落实）。
 *
 * 由 update-core/src/ports.ts 原样拎入：六边形架构不变，核心只管做决定，插口由核心定，
 * 跑腿的活全在外面。检验标准仍是核心不碰硬盘、网络、子进程也能被测透，所以本文件只放类型，
 * 不放任何运行时逻辑；转译出的 JS 是空壳，第二家直接吃 TS 源码。
 *
 * 相对原样的增量（规格 #591 要求的新增注入点位，不动冻结的入参回参形状）：
 * 插件标识、目标包名、官方源、安装时限经 UpdatePorts 的可选字段注入，默认值等于现状。
 * 三个对外方法、快照六字段、任务公开形状、检查凭证形状、配方五键形状全部冻结不变。
 */

export type EnvironmentKind = 'desktop' | 'cli'

/** 装不了的原因（装前不满足条件只给原因不给装，见通用方案复用清单）。 */
export type BlockedReason =
  | 'unknown-profile'
  | 'source-install'
  | 'invalid-installation'
  | 'installation-changed'
  | 'pending-restart'
  | 'registry-conflict'
  | 'incompatible-node'
  | 'recovery-required'

/** 核心定错误码，适配器只负责把外面世界的脏错误翻译进来。 */
export type UpdateErrorCode =
  | 'check-failed'
  | 'invalid-release'
  | 'check-expired'
  | 'installation-changed'
  | 'update-busy'
  | 'install-failed'
  | 'unsupported'
  | 'pending-restart'
  | 'source-install'
  | 'unknown-profile'
  | 'invalid-installation'
  | 'incompatible-node'
  | 'registry-conflict'
  | 'recovery-required'

/** 快照：恰好六个字段，永远不带钥匙（检查编号与环境指纹另交）。 */
export interface UpdateSnapshot {
  /** 运行版本：宿主自带清单里的版本号。 */
  runningVersion: string
  /** 磁盘已装版本：已安装包里的清单版本号（读不到为 null）。 */
  installedVersion: string | null
  /** 远端最新版本：最近一次查新版带回的版本（没查过为 null）。 */
  latestVersion: string | null
  /** 能不能装：环境允许、无阻拦原因、有没过期的检查且指纹一致、远端确实更新。 */
  canInstall: boolean
  /** 装不了的原因（能装为 null）。 */
  blockedReason: BlockedReason | null
  /** 当前任务：只读半程恒为 null，安装票再接真实任务。 */
  job: UpdateJob | null
}

/** 任务的公开形状（长任务状态随时可问，见通用方案第 5 步）。 */
export interface UpdateJob {
  id: string
  state: 'installing' | 'verifying' | 'restart-required' | 'completed' | 'failed' | 'interrupted'
  targetVersion: string | null
  message: string | null
  /** 提交时的请求编号：同一个编号重复提交直接返回旧结果，不重装。 */
  requestId: string | null
}

/**
 * 检查凭证：查新版把快照和凭证分开交。
 * 凭证是“用户当时点头的那一次检查”的绑定（编号加当时看到的环境指纹），
 * 装更新时调用方把凭证递回来，快照里永远不带钥匙。
 */
export interface CheckReceipt {
  checkId: string
  checkedAt: number
  expiresAt: number
}

/** 查新版一次返回：快照与凭证分家。 */
export interface CheckResult {
  snapshot: UpdateSnapshot
  receipt: CheckReceipt | null
}

/** 远端发行信息：只接受名字对得上、版本合法、包地址与完整性校验全合规的返回。 */
export interface ReleaseInfo {
  version: string
  nodeRange: string
  integrity: string
  tarball: string
}

/**
 * 安装执行路由：桌面宿主走桌面服务，普通 DSH 宿主自己起进程。
 * 路由由核心按政策选（见 installRecipe），适配器只负责把它跑起来。
 */
export type InstallRoute = 'desktop-service' | 'cli-process'

/**
 * 安装执行配方：核心给适配器的完整政策产物（冻结五键：改键改模板即破冰，值按时间可调）。
 * 一律「程序 + 参数数组」——pluginArgs 原样交给命令行工具，
 * 使用范围名不做引号包裹也不按空格拆分（引号只出现在给用户看的手工命令里）。
 */
export interface InstallRecipe {
  route: InstallRoute
  /** 安装目标使用范围名，原样保留（含空格与非 ASCII 字符）。 */
  profileName: string
  /** 精确版本（不带 ^ ~ 等前缀）。 */
  version: string
  /** 追加在 `plugin --profile <使用范围名>` 之后的参数数组。 */
  pluginArgs: string[]
  /** 执行时限（毫秒）：超时终止整棵进程树并按安装失败处理。 */
  timeoutMs: number
}

/**
 * 适配器看到的环境（小零件：读版本、看环境、上报是桌面还是命令行）。
 * 拼安装命令和选执行器路由收归核心（精确版本、强制官方源是政策，不是跑腿）。
 * environmentKind 由适配器探测：桌面宿主存在 desktopProfiles 服务即 desktop，
 * 其余为 cli；探测不出就按 cli 走，跑不通按诚实失败转手工命令。
 */
export interface EnvironmentView {
  profileName: string | null
  environmentKind: EnvironmentKind
  homeDir: string | null
  profileDir: string | null
  installedVersion: string | null
  packageValid: boolean
  sourceInstall: boolean
  blockedReason: BlockedReason | null
  installationKey: string | null
  eligible: boolean
}

/** 核心要的最小网络形状（结构化定义，不依赖任何运行时的网络类型）。 */
export interface MinimalHeaders {
  get(name: string): string | null
}

export interface MinimalResponse {
  ok: boolean
  headers: MinimalHeaders
  text(): Promise<string>
}

export type FetchImpl = (
  url: string,
  init?: { headers?: Record<string, string>; redirect?: string; signal?: unknown },
) => Promise<MinimalResponse>

/**
 * 插口：时钟和编号从外面灌进来（默认真的、测试用假的）。
 * 核心不直接读硬盘、不直接联网，联网经外面递进来的 fetchImpl 发生一次。
 * 安装用的存取与执行也全是外面给的小零件：任务记哪里、锁怎么加、
 * 备份怎么做、安装命令怎么跑，核心只指挥顺序，不碰硬盘与子进程。
 *
 * 新增注入点位（规格 #591 第 2、4、5 条，全部可选，默认值等于现状）：
 * 插件标识、目标包名、官方源、安装时限。不传即走现状，老调用补一个标识即可。
 */
export interface UpdatePorts {
  readRunningVersion(): string
  readInstalled(): EnvironmentView | Promise<EnvironmentView>
  fetchImpl: FetchImpl
  now(): number
  randomId(): string
  nodeVersion: string
  checkTimeoutMs?: number
  confirmationTtlMs?: number
  /** 插件标识：单例键与日志标识用（规格 #591 第 2、6、8 条）。 */
  pluginId?: string
  /** 目标包名：要检查更新的那个包是谁（规格 #591 第 4 条，默认等于现状）。 */
  targetPackageName?: string
  /** 官方源：默认等于现状地址（规格 #591 第 4 条）。 */
  registryUrl?: string
  /** 安装时限毫秒：默认 15 分钟（规格 #591 第 5 条）。 */
  installTimeoutMs?: number
  /** 读已落盘的任务（没有为 null；读坏由外面抛错，核心收敛为状态不可用）。 */
  readJob?: () => UpdateJob | null | Promise<UpdateJob | null>
  /** 写任务（传 null 为清空；写坏由外面抛错）。 */
  writeJob?: (job: UpdateJob | null) => void | Promise<void>
  /** 抢锁：抢到为 true，被别人占着为 false（同一个使用范围同时只装一个）。 */
  tryAcquireLock?: (lockId: string) => boolean | Promise<boolean>
  /** 放锁（只放自己抢到的那把）。 */
  releaseLock?: (lockId: string) => void | Promise<void>
  /** 装前备份使用范围的清单（小清单，不含凭据与整个家目录）。 */
  backupJob?: (job: UpdateJob) => void | Promise<void>
  /**
   * 真正跑安装（按钮强制官方源、精确版本与 --save-exact）。
   * 核心只把政策要的三件事交给适配器：版本、使用范围名、宿主种类；
   * 适配器必须调 installRecipe 拿配方再执行，不得自己按系统或宿主分支选路由。
   * 测试一律给假的，不真跑。
   */
  runInstall?: (args: { version: string; profileName: string | null; environmentKind: EnvironmentKind }) => void | Promise<void>
}

/** 对外三个方法（进度不单独给方法，调用方轮询查状态）。 */
export interface UpdateCore {
  /** 查状态：只读本地，不联网。 */
  status(): Promise<UpdateSnapshot>
  /** 查新版：联网问一次，成功带回快照加检查凭证（分开交）。 */
  check(): Promise<CheckResult>
  /**
   * 装更新：拿检查编号加请求编号提交。
   * 只读半程诚实失败（unsupported），安装票再实现。
   */
  install(args: { checkId: string; requestId: string }): Promise<UpdateSnapshot>
}

/**
 * 模块标识（运行时唯一内容）：类型在转译时已擦除，
 * 转译出的 JS 只剩这一行；第二家直接吃 TS 源码。
 */
export const PORTS_SOURCE = 'packages/dsh-plugin-update/src/ports.ts'
