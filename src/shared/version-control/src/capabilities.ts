/**
 * src/shared/version-control/src/capabilities.ts —— git 版本能力判定（纯函数）
 *
 * 只用两条有官方依据的版本线（#813 定案 8）：2.11（status --porcelain=v2 引入）与
 * 2.31（worktree locked/prunable 标记与 rev-parse --path-format 引入）。
 * 查不到可靠出处的特性（branch --show-current、%(worktreepath)、worktree -z 的引入版本）
 * 一律不用 —— 分支用 # branch.head 读，当前工作树用分支名比对，不用路径比对。
 *
 * #1737 起这里还回答「这张能力账本里的某一条，在这版 git 上能不能用」：
 * capabilityAvailability 按账本登记的 minVersion 与 versionPolicy 给出三态
 * （full 完整可用 / degraded 可用但给替代做法 / hidden 藏起来），界面与命令面板据此
 * 决定「置灰并写替代路径」还是「干脆不显示」。账本只有一份，不加版本判断的副本。
 */
import type { CapabilityTier, GitVersion } from './ports.js'

export const VERSION_FLOOR: GitVersion = { major: 2, minor: 11, patch: 0 }
export const LOCK_PRUNABLE_FLOOR: GitVersion = { major: 2, minor: 31, patch: 0 }

export function parseVersion(text: string): GitVersion | null {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ''))
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: m[3] === undefined ? 0 : Number(m[3]) }
}

function atLeast(v: GitVersion, floor: GitVersion): boolean {
  if (v.major !== floor.major) return v.major > floor.major
  if (v.minor !== floor.minor) return v.minor > floor.minor
  return v.patch >= floor.patch
}

/** 低于 2.11 直说请升级；2.11–2.30 降级（锁标记未知）；2.31 及以上完整。 */
export function tierFor(v: GitVersion | null): CapabilityTier {
  if (!v) return 'unsupported'
  if (!atLeast(v, VERSION_FLOOR)) return 'unsupported'
  if (!atLeast(v, LOCK_PRUNABLE_FLOOR)) return 'degraded'
  return 'full'
}

/** 一条能力在当前 git 版本下的可用状态；判断只依赖账本字段与版本号，不读磁盘、不碰网络。 */
export type CapabilityAvailabilityState = 'full' | 'degraded' | 'hidden'

export interface CapabilityAvailability {
  /** full 完整可用；degraded 能用但要换一种做法；hidden 低于底线或低于最低版本且不降级，界面藏起来。 */
  state: CapabilityAvailabilityState
  /** 这条能力登记的 minimum git 版本（账本原值），提示文案直接用它。 */
  needed: string
  /** 低版本时的替代做法；完整可用时为 null。 */
  alternative: string | null
}

/**
 * 按账本的 minVersion / versionPolicy 判一条能力在某版 git 上的可用性。
 *
 * 版本传 null 或解析不出（例如 git --version 失败、版本串里没有数字）按「低于 2.11 硬底线」
 * 处理：一律 hidden —— 宁可让用户看到「请升级」，也不要显示一个点了就报错的按钮。
 * 正好达到 minVersion 是 full；低于 minVersion 时按 policy：degrade → degraded（带替代做法），
 * hide（或没有登记策略）→ hidden。没有版本限制的行 minVersion 就是 2.11 硬底线，2.11 起 full。
 *
 * 参数用结构类型而不是 import 账本里的 Capability：共享层禁止层内互引（.dependency-cruiser.ts
 * 的 same-layer-import-shared，存量基线只许减不许增），而这里只需要账本的三个版本字段。
 * 调用方直接传账本条目即可，类型上仍然兼容。
 */
export function capabilityAvailability(
  cap: {
    minVersion: string
    versionPolicy: 'degrade' | 'hide' | null
    versionAlternative: string | null
  },
  version: GitVersion | string | null,
): CapabilityAvailability {
  const needed = cap.minVersion
  const parsed = version === null || version === '' ? null : typeof version === 'string' ? parseVersion(version) : version
  if (!parsed || !atLeast(parsed, VERSION_FLOOR)) return { state: 'hidden', needed, alternative: cap.versionAlternative }
  const minimum = parseVersion(needed)
  if (!minimum || !atLeast(parsed, minimum)) {
    return { state: cap.versionPolicy === 'degrade' ? 'degraded' : 'hidden', needed, alternative: cap.versionAlternative }
  }
  return { state: 'full', needed, alternative: null }
}

export const CAPABILITIES_SOURCE = 'src/shared/version-control/src/capabilities.ts'
