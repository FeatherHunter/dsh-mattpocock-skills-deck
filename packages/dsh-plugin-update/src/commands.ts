/**
 * packages/dsh-plugin-update/src/commands.ts — 安装命令的纯拼接（政策收归核心）。
 *
 * 由 update-core/src/commands.ts 原样拎入，两条产物形状冻结（改键改模板即破冰）：
 *   1. 执行配方（installRecipe）——真正安装时用：按宿主种类选路由，程序与参数数组分开，
 *      使用范围名原样进数组；一律带精确版本、官方源与 --save-exact。
 *   2. 手工兜底文案（manualCommand）——给人复制到终端执行：沿用命令串形状，
 *      使用范围名含特殊字符时加引号（只影响展示，不影响配方）。
 * 自包含：不引用同层其它文件，版本号小工具按需内联。
 * 类型引用只用 import type，转译后无运行时导入。
 *
 * 相对原样的增量（规格 #591 第 4、5 条）：目标包名、官方源、安装时限经可选字段注入，
 * 默认值等于现状常量。不传即走现状，老调用零变化。
 */

import type { BlockedReason, EnvironmentKind, InstallRecipe } from './ports.js'

const PACKAGE_NAME = 'dsh-mattpocock-skills-deck'
const NPM_REGISTRY = 'https://registry.npmjs.org/'
/** 安装时限：15 分钟（起进程到退出，超时终止整棵进程树并按失败处理）。 */
export const INSTALL_TIMEOUT_MS = 15 * 60_000

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

/** 使用范围名是否可用作安装目标（纯谓词，配方与手工命令共用）。 */
function usableProfileName(raw: unknown): string | null {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name || name.length > 255 || name.startsWith('-')) return null
  if (['.', '..', 'node_modules'].includes(name)) return null
  return name
}

/**
 * 安装执行配方：宿主决定路由，使用范围决定目标。
 *
 * - 桌面宿主（environmentKind 为 desktop）→ desktop-service：由桌面端公开的
 *   desktopPnpm 服务用参数数组拉起打包好的 CLI，插件不碰 .cmd 垫片、不经 shell。
 * - 普通 DSH 宿主（cli）→ cli-process：用「当前运行时的可执行文件 + CLI 的 JS 入口
 *   + 参数数组」自己起进程；三系统同一套形态，差异只在可执行文件与入口由适配器提供。
 *
 * 三种取值一律带官方源与 --save-exact；官方源不可达时由适配器诚实失败，不换源。
 * 宿主种类不是已知两种取值时不给配方（诚实失败转手工命令），不猜。
 */
export function installRecipe(input: {
  profileName: string | null
  version: string
  environmentKind: EnvironmentKind
  targetPackageName?: string
  registryUrl?: string
  timeoutMs?: number
}): InstallRecipe | null {
  const name = usableProfileName(input?.profileName)
  const version = input?.version
  if (!name || !validVersion(version)) return null
  const kind = input?.environmentKind
  if (kind !== 'desktop' && kind !== 'cli') return null
  const targetName = input?.targetPackageName ?? PACKAGE_NAME
  const registry = input?.registryUrl ?? NPM_REGISTRY
  const timeoutMs = input?.timeoutMs ?? INSTALL_TIMEOUT_MS
  if (!targetName || !registry) return null
  return {
    route: kind === 'desktop' ? 'desktop-service' : 'cli-process',
    profileName: name,
    version,
    // 参数数组原样交给命令行工具：使用范围名不做引号包裹、不按空格拆分。
    pluginArgs: ['add', '--save-exact', `${targetName}@${version}`, `--registry=${registry}`],
    timeoutMs,
  }
}

/**
 * 手工兜底命令：给人复制到终端执行，形状沿用 `dsh plugin --profile <名> add <包>@<版本>`。
 * 与配方同一套政策（精确版本、官方源、--save-exact），只是使用范围名含特殊字符时加引号，
 * 因为这一串要经用户自己的 shell 解释。网络受限时用户可自行去掉 --registry=。
 * 源码安装等不安全情形不给命令。
 */
export function manualCommand(input: { profileName: string | null; latestVersion: string | null; installedVersion: string | null; runningVersion: string; jobTargetVersion: string | null; blockedReason: BlockedReason | null; sourceInstall: boolean; targetPackageName?: string; registryUrl?: string }): string | null {
  if (input.sourceInstall || input.blockedReason === 'source-install' || input.blockedReason === 'unknown-profile') return null
  const name = usableProfileName(input.profileName)
  if (!name) return null
  const targetName = input.targetPackageName ?? PACKAGE_NAME
  const registry = input.registryUrl ?? NPM_REGISTRY
  if (!targetName || !registry) return null
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
  return `dsh plugin --profile ${arg} add --save-exact ${targetName}@${version} --registry=${registry}`
}
