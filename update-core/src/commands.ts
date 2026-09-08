/**
 * update-core/src/commands.ts — 安装命令的纯拼接（政策收归核心）
 *
 * 按钮强制官方源加精确版本，手工沿用本机源配置；源码安装等不安全情形不给手工命令。
 * 自包含：不引用同层其它文件（同层互引门禁要求零相对引用），版本号小工具按需内联。
 * 类型引用只用 import type，转译后无运行时导入。
 */

import type { BlockedReason } from './ports.js'

const PACKAGE_NAME = 'dsh-mattpocock-skills-deck'
const NPM_REGISTRY = 'https://registry.npmjs.org/'

function validVersion(v: unknown): v is string {
  return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)
}

function parseTriple(v: string): [number, number, number] | null {
  const parts = String(v).split('.')
  if (parts.length > 3) return null
  const nums: number[] = []
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null
    const n = Number(p)
    if (!Number.isSafeInteger(n)) return null
    nums.push(n)
  }
  while (nums.length < 3) nums.push(0)
  return [nums[0], nums[1], nums[2]]
}

function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseTriple(a)
  const pb = parseTriple(b)
  if (!pa || !pb) throw new Error('invalid-release')
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1
    if (pa[i] > pb[i]) return 1
  }
  return 0
}

/** 按钮命令：强制官方源加精确版本（政策收归核心，适配器只跑腿）。 */
export function buttonCommand(profileName: string | null, version: string): string | null {
  if (typeof profileName !== 'string' || !profileName.trim() || !validVersion(version)) return null
  const name = profileName.trim()
  if (name.length > 255 || name.startsWith('-') || ['.', '..', 'node_modules'].includes(name)) return null
  const arg = /^[A-Za-z0-9_.-]+$/.test(name) ? name : JSON.stringify(name)
  return `dsh plugin --profile ${arg} add ${PACKAGE_NAME}@${version} --registry=${NPM_REGISTRY}`
}

/** 手工兜底命令：沿用本机源配置，源码安装等不安全情形不给。 */
export function manualCommand(input: { profileName: string | null; latestVersion: string | null; installedVersion: string | null; runningVersion: string; jobTargetVersion: string | null; blockedReason: BlockedReason | null; sourceInstall: boolean }): string | null {
  if (input.sourceInstall || input.blockedReason === 'source-install' || input.blockedReason === 'unknown-profile') return null
  const name = typeof input.profileName === 'string' ? input.profileName.trim() : ''
  if (!name || name.length > 255 || name.startsWith('-') || ['.', '..', 'node_modules'].includes(name)) return null
  const arg = /^[A-Za-z0-9_.-]+$/.test(name) ? name : JSON.stringify(name)
  const picks = [input.latestVersion, input.jobTargetVersion, input.installedVersion].filter(validVersion)
  let version = picks.length > 0 ? picks[0] : 'latest'
  try {
    const ranked = picks.filter((v) => compareVersions(v, input.runningVersion) >= 0)
    if (ranked.length > 0) {
      version = ranked[0]
      for (const v of ranked) if (compareVersions(v, version) === 1) version = v
    }
  } catch {}
  return `dsh plugin --profile ${arg} add ${PACKAGE_NAME}@${version}`
}
