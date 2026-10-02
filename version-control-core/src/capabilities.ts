/**
 * version-control-core/src/capabilities.ts —— git 版本能力判定（纯函数）
 *
 * 只用两条有官方依据的版本线（#813 定案 8）：2.11（status --porcelain=v2 引入）与
 * 2.31（worktree locked/prunable 标记与 rev-parse --path-format 引入）。
 * 查不到可靠出处的特性（branch --show-current、%(worktreepath)、worktree -z 的引入版本）
 * 一律不用 —— 分支用 # branch.head 读，当前工作树用分支名比对，不用路径比对。
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

export const CAPABILITIES_SOURCE = 'version-control-core/src/capabilities.ts'
