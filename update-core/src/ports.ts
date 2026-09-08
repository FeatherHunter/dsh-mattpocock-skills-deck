/**
 * update-core/src/ports.ts — 更新模块的插口定义（537 接口决议的字面落实）
 *
 * 架构按六边形来：核心只管做决定，插口由核心定，跑腿的活全在外面。
 * 检验标准是核心不碰硬盘、网络、子进程也能被测透，所以本文件只放类型，
 * 不放任何运行时逻辑；转译出的 JS 是空壳，第二家直接吃 TS 源码。
 *
 * 三个对外方法：查状态（只读本地不联网）、查新版（联网一次）、
 * 装更新（拿凭证加请求编号提交；只读半程留诚实失败的桩，安装票再实现）。
 * 进度不单独给方法，调用方轮询查状态。
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
 * 适配器看到的环境（小零件：读版本、看环境、上报是桌面还是命令行）。
 * 拼安装命令和选执行器路由收归核心（精确版本、强制官方源是政策，不是跑腿）。
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
export const PORTS_SOURCE = 'update-core/src/ports.ts'
