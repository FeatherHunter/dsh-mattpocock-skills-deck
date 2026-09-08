/**
 * update-core/src/service.ts — 更新模块的业务流程（只读半程）
 *
 * 只记得规矩，不动手装：查状态读本地、查新版联网问一次、装前复核用的
 * 凭证与指纹在这里生成与比对。真正的跑腿（读盘、联网、拼命令、执行）
 * 全在适配器，本文件零导入，依赖全当参数传。
 *
 * 范围：查状态与查新版；装更新留诚实失败的桩（unsupported），安装票再实现。
 * 重启确认与残留自愈（通用方案第 6 步与复用清单）随安装票一起落地。
 */

import type {
  BlockedReason,
  CheckResult,
  EnvironmentView,
  FetchImpl,
  MinimalResponse,
  ReleaseInfo,
  UpdateCore,
  UpdateErrorCode,
  UpdatePorts,
  UpdateSnapshot,
} from './ports.js'

export const PACKAGE_NAME = 'dsh-mattpocock-skills-deck'
export const NPM_REGISTRY = 'https://registry.npmjs.org/'
export const CHECK_TIMEOUT_MS = 10_000
export const CONFIRMATION_TTL_MS = 10 * 60_000
/** 2 秒内重复点击复用上次结果，不重新联网。 */
export const RECHECK_WINDOW_MS = 2_000
export const MAX_METADATA_BYTES = 256 * 1024
export const INTEGRITY_PATTERN = '^sha512-[A-Za-z0-9+/]{86}==$'

export function updateError(code: UpdateErrorCode): Error & { code: UpdateErrorCode } {
  return Object.assign(new Error(code), { code })
}

// ---------- 版本号小工具（只认纯数字三段，预发布一律拒绝） ----------

export function validVersion(v: unknown): v is string {
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

/** -1 更小，0 相等，1 更大（入参须先过 validVersion 或 parseTriple）。 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseTriple(a)
  const pb = parseTriple(b)
  if (!pa || !pb) throw updateError('invalid-release')
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1
    if (pa[i] > pb[i]) return 1
  }
  return 0
}

function compareOne(node: [number, number, number], op: string, target: [number, number, number]): boolean {
  const order = compareTriple(node, target)
  if (op === '=' || op === '') return order === 0
  if (op === '>') return order === 1
  if (op === '>=') return order >= 0
  if (op === '<') return order === -1
  if (op === '<=') return order <= 0
  return true
}

function compareTriple(a: [number, number, number], b: [number, number, number]): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return -1
    if (a[i] > b[i]) return 1
  }
  return 0
}

function upperBound(t: [number, number, number], kind: '^' | '~', kept: number): [number, number, number] {
  if (kind === '^') {
    if (kept >= 1) return [t[0] + 1, 0, 0]
    return [0, t[1] + 1, 0]
  }
  if (kept >= 2) return [t[0], t[1] + 1, 0]
  return [t[0] + 1, 0, 0]
}

/**
 * 运行环境是否满足远端要求的 Node 范围。
 * 只看懂星号、精确版与 ^ ~ > >= < <= 比较式；看不懂的写法一律放行不误拦。
 */
export function satisfiesNodeRange(nodeVersion: string, range: string | undefined): boolean {
  if (range === undefined || range === null) return true
  const text = String(range).trim()
  if (text === '' || text === '*') return true
  const node = parseTriple(String(nodeVersion).replace(/^v/, ''))
  if (!node) return true
  if (text.includes('||')) return true
  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return true
  for (const part of parts) {
    const m = part.match(/^(\^|~|>=|<=|>|<|=)?(.+)$/)
    if (!m) return true
    const op = m[1] || ''
    const target = parseTriple(m[2])
    if (!target) return true
    if (op === '^' || op === '~') {
      const kept = m[2].split('.').length
      if (compareTriple(node, target) < 0) return false
      if (compareTriple(node, upperBound(target, op, kept)) >= 0) return false
      continue
    }
    if (!compareOne(node, op, target)) return false
  }
  return true
}

// ---------- 问远端（联网只发生在这里，调用方点一次才问一次） ----------

function byteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length
  } catch {
    return text.length
  }
}

function timeoutSignal(ms: number): unknown {
  try {
    const ctor = (globalThis as { AbortSignal?: { timeout?: (ms: number) => unknown } }).AbortSignal
    if (ctor && typeof ctor.timeout === 'function') return ctor.timeout(ms)
  } catch {
    // 忽略：没有超时能力就直接请求，调用方仍可经外层超时收敛为检查失败。
  }
  return undefined
}

/**
 * 问官方源的最新版接口，只接受名字对得上、版本号合法正式版、
 * 包地址与完整性校验全合规的返回，否则按版本信息无效处理。
 */
export async function fetchNpmRelease(
  fetchImpl: FetchImpl,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<ReleaseInfo> {
  let response: MinimalResponse | null = null
  try {
    response = await fetchImpl(`${NPM_REGISTRY}${encodeURIComponent(PACKAGE_NAME)}/latest`, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: timeoutSignal(timeoutMs),
    })
  } catch {
    throw updateError('check-failed')
  }
  try {
    if (!response.ok) throw updateError('check-failed')
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_METADATA_BYTES) throw updateError('invalid-release')
    const text = await response.text()
    if (byteLength(text) > MAX_METADATA_BYTES) throw updateError('invalid-release')
    const value = JSON.parse(text) as {
      name?: unknown
      version?: unknown
      engines?: { node?: unknown }
      dist?: { tarball?: unknown; integrity?: unknown }
    }
    if (value.name !== PACKAGE_NAME || !validVersion(value.version)) throw updateError('invalid-release')
    const version = value.version
    const nodeRange = value.engines?.node
    if (nodeRange !== undefined && typeof nodeRange !== 'string') throw updateError('invalid-release')
    const tarballText = value.dist?.tarball
    const integrity = value.dist?.integrity
    let tarball: URL
    try {
      tarball = new URL(String(tarballText))
    } catch {
      throw updateError('invalid-release')
    }
    const registryOrigin = new URL(NPM_REGISTRY).origin
    const shapeOk =
      tarball.origin === registryOrigin &&
      !tarball.username &&
      !tarball.password &&
      !tarball.search &&
      !tarball.hash &&
      tarball.pathname === `/${PACKAGE_NAME}/-/${PACKAGE_NAME}-${version}.tgz` &&
      typeof integrity === 'string' &&
      new RegExp(INTEGRITY_PATTERN).test(integrity)
    if (!shapeOk) throw updateError('invalid-release')
    return { version, nodeRange: typeof nodeRange === 'string' ? nodeRange : '*', integrity, tarball: tarball.href }
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'check-failed') throw error
    if ((error as { code?: unknown })?.code === 'invalid-release') throw error
    // 已连上但内容坏掉（读 body 失败、JSON 解析失败）算版本信息无效；
    // 连不上、超时、中断都算检查失败。
    if (response !== null && response.ok) throw updateError('invalid-release')
    throw updateError('check-failed')
  }
}

// ---------- 核心工厂（记得规矩，不动手装） ----------

interface CheckedState {
  release: ReleaseInfo
  checkId: string | null
  checkedAt: number
  expiresAt: number
  installationKey: string | null
  blockedReason: BlockedReason | null
}

export function createUpdateCore(ports: UpdatePorts): UpdateCore {
  const checkTimeoutMs = ports.checkTimeoutMs ?? CHECK_TIMEOUT_MS
  const confirmationTtlMs = ports.confirmationTtlMs ?? CONFIRMATION_TTL_MS
  let checked: CheckedState | null = null
  let checking: Promise<CheckResult> | null = null
  let lastCheckAt = -Infinity

  function buildSnapshot(env: EnvironmentView): UpdateSnapshot {
    const blockedReason: BlockedReason | null = env.blockedReason ?? checked?.blockedReason ?? null
    const fresh = checked !== null && checked.checkId !== null && ports.now() < checked.expiresAt
    const runningVersion = ports.readRunningVersion()
    const canInstall = Boolean(
      env.eligible &&
        !blockedReason &&
        fresh &&
        checked?.installationKey === env.installationKey &&
        validVersion(runningVersion) &&
        checked?.release &&
        compareVersions(checked.release.version, runningVersion) === 1,
    )
    return {
      runningVersion,
      installedVersion: env.installedVersion ?? null,
      latestVersion: checked?.release.version ?? null,
      canInstall,
      blockedReason,
      job: null,
    }
  }

  async function status(): Promise<UpdateSnapshot> {
    const env = await ports.readInstalled()
    return buildSnapshot(env)
  }

  async function check(): Promise<CheckResult> {
    if (checking) return checking
    // 2 秒内重复点击复用上次结果，不重新联网（失败不缓存为成功）。
    if (checked?.checkId && ports.now() - lastCheckAt < RECHECK_WINDOW_MS) {
      const env = await ports.readInstalled()
      const snapshot = buildSnapshot(env)
      return { snapshot, receipt: snapshot.canInstall ? toReceipt() : null }
    }
    lastCheckAt = ports.now()
    checking = (async () => {
      try {
        const env = await ports.readInstalled()
        const release = await fetchNpmRelease(ports.fetchImpl, checkTimeoutMs)
        checked = {
          release,
          checkId: ports.randomId(),
          checkedAt: ports.now(),
          expiresAt: ports.now() + confirmationTtlMs,
          installationKey: env.installationKey,
          blockedReason: satisfiesNodeRange(ports.nodeVersion, release.nodeRange) ? null : 'incompatible-node',
        }
        // 凭证只在能装时交：没新版或有阻拦时交了也没用，不交。
        const snapshot = buildSnapshot(env)
        return { snapshot, receipt: snapshot.canInstall ? toReceipt() : null }
      } catch (error) {
        if (checked) checked = { ...checked, checkId: null, expiresAt: 0 }
        throw error
      } finally {
        checking = null
      }
    })()
    return checking
  }

  function toReceipt(): CheckResult['receipt'] {
    if (!checked?.checkId) return null
    // 凭证只交编号与有效期：环境指纹留在核心内存里，快照与凭证都不带它。
    return { checkId: checked.checkId, checkedAt: checked.checkedAt, expiresAt: checked.expiresAt }
  }

  async function install(): Promise<UpdateSnapshot> {
    throw updateError('unsupported')
  }

  return { status, check, install }
}
