/**
 * update-core/src/service.ts — 更新模块的业务流程（安装闭环）
 *
 * 只记得规矩，不动手装：查状态读本地、查新版联网问一次、装前复核用的
 * 凭证与指纹在这里生成与比对，安装的排队、去重、复核、备份顺序也在此。
 * 真正的跑腿（读盘、联网、拼命令、执行）全在适配器，本文件零导入，依赖全当参数传。
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
  UpdateJob,
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

/** 请求编号是否合法（非空、去空格后 1 到 128 个字符）。 */
export function validRequestId(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 128
}

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
  let activeJobId: string | null = null
  let memJob: UpdateJob | null = null
  let memLock: string | null = null
  async function loadJob(): Promise<UpdateJob | null> {
    try {
      return ports.readJob ? ((await ports.readJob()) ?? null) : memJob
    } catch {
      throw updateError('install-failed')
    }
  }
  async function saveJob(job: UpdateJob | null): Promise<void> {
    try {
      if (ports.writeJob) await ports.writeJob(job)
      else memJob = job
    } catch {
      throw updateError('install-failed')
    }
  }
  async function acquire(lockId: string): Promise<boolean> {
    try {
      if (ports.tryAcquireLock) return await ports.tryAcquireLock(lockId)
    } catch {
      return false
    }
    if (memLock !== null) return false
    memLock = lockId
    return true
  }
  async function release(lockId: string): Promise<void> {
    try {
      if (ports.releaseLock) await ports.releaseLock(lockId)
      else if (memLock === lockId) memLock = null
    } catch {}
  }
  function healJob(job: UpdateJob | null, env: EnvironmentView): UpdateJob | null {
    if (!job) return null
    if (job.state === 'installing' || job.state === 'verifying') {
      return job.id === activeJobId ? job : { ...job, state: 'interrupted', message: 'recovery-required', requestId: job.requestId ?? null }
    }
    if (job.state === 'restart-required' || job.state === 'completed') {
      if (!job.targetVersion || env.installedVersion !== job.targetVersion) {
        return { ...job, state: 'interrupted', message: 'installation-changed', requestId: job.requestId ?? null }
      }
      const runningVersion = ports.readRunningVersion()
      return { ...job, state: runningVersion === job.targetVersion ? 'completed' : 'restart-required', requestId: job.requestId ?? null }
    }
    return job
  }

  function buildSnapshot(env: EnvironmentView, job: UpdateJob | null): UpdateSnapshot {
    let blockedReason: BlockedReason | null = env.blockedReason ?? checked?.blockedReason ?? null
    if (job?.state === 'interrupted' || job?.state === 'failed') {
      if (env.installedVersion !== ports.readRunningVersion()) blockedReason = 'recovery-required'
    } else if (job?.state === 'restart-required' || (env.installedVersion && env.installedVersion !== ports.readRunningVersion())) {
      blockedReason = 'pending-restart'
    }
    const busy = job?.state === 'installing' || job?.state === 'verifying'
    const fresh = checked !== null && checked.checkId !== null && ports.now() < checked.expiresAt
    const runningVersion = ports.readRunningVersion()
    const canInstall = Boolean(
      env.eligible &&
        !blockedReason &&
        !busy &&
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
      job,
    }
  }

  async function status(): Promise<UpdateSnapshot> {
    const env = await ports.readInstalled()
    const job = healJob(await loadJob(), env)
    return buildSnapshot(env, job)
  }

  async function check(): Promise<CheckResult> {
    if (checking) return checking
    // 2 秒内重复点击复用上次结果，不重新联网（失败不缓存为成功）。
    if (checked?.checkId && ports.now() - lastCheckAt < RECHECK_WINDOW_MS) {
      const env = await ports.readInstalled()
      const snapshot = buildSnapshot(env, healJob(await loadJob(), env))
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
        const snapshot = buildSnapshot(env, healJob(await loadJob(), env))
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

  async function runBackground(job: UpdateJob, envAtStart: EnvironmentView): Promise<void> {
    try {
      if (ports.runInstall) await ports.runInstall({ version: job.targetVersion as string, profileName: envAtStart.profileName, environmentKind: envAtStart.environmentKind })
      else throw updateError('unsupported')
      const doing: UpdateJob = { ...job, state: 'verifying', message: null }
      activeJobId = doing.id
      await saveJob(doing)
      const env = await ports.readInstalled()
      if (env.installedVersion !== job.targetVersion) throw updateError('install-failed')
      if (env.blockedReason && env.blockedReason !== 'pending-restart') throw updateError('install-failed')
      const done: UpdateJob = { ...doing, state: 'restart-required', message: null }
      await saveJob(done)
    } catch (error) {
      const code = (error as { code?: unknown })?.code
      const message =
        code === 'installation-changed' || code === 'registry-conflict' || code === 'install-failed' ? String(code) : 'install-failed'
      const failedJob: UpdateJob = { ...job, state: 'failed', message, requestId: job.requestId ?? null }
      try {
        await saveJob(failedJob)
      } catch {
        memJob = failedJob
      }
    } finally {
      await release(job.id)
      if (activeJobId === job.id) activeJobId = null
    }
  }

  async function install(args: { checkId: string; requestId: string }): Promise<UpdateSnapshot> {
    const checkId = typeof args?.checkId === 'string' ? args.checkId : ''
    const requestId = typeof args?.requestId === 'string' ? args.requestId : ''
    if (!checkId || !validRequestId(requestId)) throw updateError('check-expired')
    let env = await ports.readInstalled()
    let previous = healJob(await loadJob(), env)
    // 同一个请求编号重复提交直接返回旧结果，不重装。
    if (previous?.requestId === requestId) return buildSnapshot(env, previous)
    if (previous?.state === 'installing' || previous?.state === 'verifying' || previous?.state === 'restart-required') {
      throw updateError('update-busy')
    }
    if (!checked || !checked.checkId || checked.checkId !== checkId || ports.now() >= checked.expiresAt) {
      throw updateError('check-expired')
    }
    if (env.installationKey !== checked.installationKey) throw updateError('installation-changed')
    if (!buildSnapshot(env, previous).canInstall) {
      throw updateError(env.blockedReason ?? checked.blockedReason ?? 'update-busy')
    }
    const job: UpdateJob = {
      id: ports.randomId(),
      state: 'installing',
      targetVersion: checked.release.version,
      message: null,
      requestId,
    }
    if (!(await acquire(job.id))) throw updateError('update-busy')
    try {
      const current = await fetchNpmRelease(ports.fetchImpl, checkTimeoutMs)
      if (JSON.stringify(current) !== JSON.stringify(checked.release)) throw updateError('check-expired')
      env = await ports.readInstalled()
      if (env.installationKey !== checked.installationKey) throw updateError('installation-changed')
      if (!env.eligible || env.blockedReason) throw updateError(env.blockedReason ?? 'update-busy')
      if (ports.backupJob) await ports.backupJob(job)
      await saveJob(job)
      activeJobId = job.id
    } catch (error) {
      await release(job.id)
      throw error
    }
    // 落盘后后台跑，调用方不干等：每秒轮询查状态即可看到进度，关页面不取消。
    void runBackground(job, env).catch(() => {})
    return buildSnapshot(env, job)
  }

  return { status, check, install }
}
