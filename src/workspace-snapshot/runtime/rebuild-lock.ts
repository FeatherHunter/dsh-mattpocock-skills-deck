// runtime/rebuild-lock.ts —— 整库重建的库外短时互斥（#1934，规格 #1930 §2.6）。
//
// 为什么锁必须在库文件外面：整库重建的每一步都在删库文件（主文件、-wal、-shm），
// 把锁记在库里等于把门钉在要被拆掉的墙上。锁目录放在库文件旁边（dbPath + '.rebuild-lock'），
// 库删掉了它还在，这就是「库外」的含义。
//
// 协议，以及每一条为什么这么定：
//   1. 获取 = 先在一个唯一命名的临时目录里写好 owner.json，再把临时目录 rename 成锁目录。
//      不用「mkdir 锁目录，再往里写 owner.json」：目录一出现、文件还没写的那一瞬间，
//      另一个进程会把它当成无主垃圾清掉，于是两个进程同时重建——正是本票要防的事。
//      rename 是原子的：锁目录要么不存在，要么一出现就带着完整的 owner.json。
//   2. owner.json 记持有者、fencing token 与过期时间。token 每次获取重新生成；
//      删库前、建库前、建库后、释放前都重读比对。过期锁被别人清掉、别人接手之后，
//      旧重建者恢复只会看到别人的 token，于是当场停下——这就是 fencing 的全部作用。
//   3. 清过期锁 = 把锁目录 rename 成唯一名字，再删那个名字。rename 只有一个进程能成功，
//      两个进程同时清同一把过期锁时只有一个真的清掉，另一个回到轮询。
//      绝不在原位置直接删：那会把别人刚接手的新锁一起删掉。
//   4. 持锁期间每 TTL/3 续一次过期时间，定时器 unref 掉，开着库不拖住进程退出。
//      续期用「临时文件 + rename」整体替换 owner.json，读的人不会看见写了一半的文件
//      ——半截文件会被按「无主」处理，那等于把活锁当成垃圾清掉。
//   5. 拿不到锁不是错误：等一个上界（中央时间参数），还拿不到就回 null，由调用方翻译成
//      RebuildBusyError。开库接口是同步的，所以等待只能用同步睡（Atomics.wait），不忙等。
//
// 什么约定不能改：
//   - 释放只删自己的锁：token 对不上时只记日志，一个字节都不删。
//   - 复核失败一律抛 RebuildLockLostError，绝不「顺手」继续删库：库可能是新重建者刚建好的。
//   - 三个时长全部来自中央时间参数（config/ttl.yaml、config/timeouts.yaml、
//     config/intervals.yaml 生成的常量），本文件一个时长数字都不留。
//
// 日志为什么复用 workspaceSnapshot.corrupt：事件台账里没有「重建锁」这一族，而本文件
// 记的正是「库不可用、这一趟怎么处置」的那条线（等锁、清过期锁、丢锁）。新增事件名要同时
// 改附录对照表与三扇日志门禁，属于共享清单，不在本票范围内；这里只使用该事件已登记的字段
// （stage / action / detail），持有者一律只记短散列。
import {
  SNAPSHOT_REBUILD_LOCK_RETRY_MS,
  SNAPSHOT_REBUILD_LOCK_TTL_MS,
  SNAPSHOT_REBUILD_LOCK_WAIT_MS,
} from '../../shared/time-config/src/values.js'
import type { SnapshotLogEvent } from '../contract/types.js'
import { dirname, existsSync, join, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from './node-builtins.js'
import { logSnapshot, shortHash } from './log.js'

/** 锁目录后缀：与库文件同目录，库被删掉时它还在。 */
export const REBUILD_LOCK_SUFFIX = '.rebuild-lock'

/** owner.json 的文件名（锁目录里唯一的一份文件）。 */
const OWNER_FILE = 'owner.json'

/**
 * Windows 上删/改名可能被「别人正好打开着这份文件」挡住（实测 EPERM）。
 * 这些句柄都是短命的（另一个窗口的快速自检、刚崩掉还没被系统回收的进程），
 * 拿锁期间重试一小会儿比让整个开库失败更划算。上界不另造时长：复用中央的重试间隔，
 * 重试次数是「一小会儿」的界限，不是可调的时间参数。
 */
const FILE_BUSY_RETRY_ATTEMPTS = 20

/** 等不到重建锁时给用户看的那句话；宿主拿它回落在线路径，不弹任何东西。 */
export const REBUILD_BUSY_MESSAGE = '另一个窗口正在重建快照库，稍后重试'

/** owner.json 的内容。owner 给人看；fencing 是判「锁还是不是我的」的唯一凭据。 */
export interface RebuildLockOwner {
  owner: string
  fencing: string
  expiresMs: number
  acquiredMs?: number
}

/** 拿到手里的锁。release 幂等；assertHeld 在删库/建库/释放之前重读比对。 */
export interface RebuildLockHandle {
  readonly lockDir: string
  readonly owner: string
  readonly fencingToken: string
  assertHeld(stage: string): void
  release(): void
}

export interface RebuildLockOptions {
  /** 可注入时钟（门禁造过期锁时用）。 */
  now?: () => number
  logEvent?: SnapshotLogEvent
  /** 缺省取中央时间参数；门禁要缩短等待时显式传。 */
  ttlMs?: number
  waitMs?: number
  retryMs?: number
}

/**
 * 拿不到锁：另一个进程正在重建，等满上界仍然没轮到本进程。
 * 这是一个可以识别的错误（code 固定为 rebuild-busy）：开库路径必须把它原样抛给宿主，
 * 不许像「文件系统不可写」那样吞成只读句柄——那会把「等一下就好」伪装成「这个环境永远不能写」。
 */
export class RebuildBusyError extends Error {
  readonly code = 'rebuild-busy'
  constructor() {
    super(REBUILD_BUSY_MESSAGE)
    this.name = 'RebuildBusyError'
  }
}

/** 认不认得「拿不到锁」这件事。开库 fallback 之前先问它，避免把忙碌吞成只读。 */
export function isRebuildBusyError(error: unknown): boolean {
  if (error instanceof RebuildBusyError) return true
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'rebuild-busy'
}

/**
 * 复核时发现锁已经不归本进程：过期被别人清掉、别人接手之后旧重建者又恢复了过来。
 * 这时候库可能已经是别人刚建好的新库，删它等于把别人的劳动成果抹掉，所以一个字都不删。
 */
export class RebuildLockLostError extends Error {
  readonly code = 'rebuild-lock-lost'
  constructor(stage: string) {
    super('快照库重建锁已经不归本进程所有（' + stage + '），这一次不删库')
    this.name = 'RebuildLockLostError'
  }
}

/** 锁目录的路径（库文件旁边）。 */
export function rebuildLockDirOf(dbPath: string): string {
  return dbPath + REBUILD_LOCK_SUFFIX
}

/** 随机串只用于区分持有者与临时目录名；判锁靠 owner.json 里的 fencing，不靠它。 */
function randomToken(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** 同步睡一小段。开库是同步接口，等锁只能用同步等待；Atomics.wait 不烧 CPU。 */
function sleepSync(ms: number): void {
  if (!(ms > 0)) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** 取错误码；取不到回空串。日志里只记码，不记错误原文（原文里带完整路径）。 */
function errorCodeOf(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return String((error as { code?: string }).code)
  }
  return ''
}

/** 读 owner.json。读不到、读不懂、字段不全一律回 null —— 调用方按「这把锁没有主人」处理。 */
function readOwner(lockDir: string): RebuildLockOwner | null {
  try {
    const parsed = JSON.parse(readFileSync(join(lockDir, OWNER_FILE), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    const owner = typeof parsed.owner === 'string' ? parsed.owner : ''
    const fencing = typeof parsed.fencing === 'string' ? parsed.fencing : ''
    const expiresMs = Number(parsed.expiresMs)
    if (!owner || !fencing || !Number.isFinite(expiresMs)) return null
    return { owner, fencing, expiresMs }
  } catch {
    return null
  }
}

/**
 * 整体替换 owner.json（续期与「确认仍归我」两处都要原子）：先写同目录的临时文件，
 * 再 rename 覆盖。直接在原文件上写会把「写了一半」的窗口暴露给读的人。
 */
function writeOwnerAtomically(lockDir: string, value: RebuildLockOwner): void {
  const target = join(lockDir, OWNER_FILE)
  const temp = target + '.tmp-' + randomToken()
  writeFileSync(temp, JSON.stringify(value))
  try {
    renameSync(temp, target)
  } catch (error) {
    try { rmSync(temp, { force: true }) } catch { /* 临时文件删不掉不影响锁的判断 */ }
    throw error
  }
}

/**
 * 试着原子地建出锁目录：临时目录里写好 owner.json，再 rename 成锁目录。
 * 返回 true = 拿到了；false = 别人已经拿着（正常竞争）。
 * 目标不在却改名失败是真错误（父目录被删、没有权限），交给调用方抛出去。
 */
function tryCreateLock(lockDir: string, value: RebuildLockOwner): boolean {
  const tempDir = lockDir + '.new-' + randomToken()
  try {
    mkdirSync(tempDir)
    writeFileSync(join(tempDir, OWNER_FILE), JSON.stringify(value))
  } catch (error) {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* 清不掉临时目录不影响结论 */ }
    throw error
  }
  try {
    renameSync(tempDir, lockDir)
    return true
  } catch (error) {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* 同上 */ }
    // 目标已存在 = 有人比我们先拿到；目标不存在却被拒（Windows 上也报 EPERM）说明父目录
    // 或权限出了问题，照实抛。ENOENT 多半是锁目录刚被别人清掉，回轮询再来一轮。
    if (existsSync(lockDir)) return false
    if (errorCodeOf(error) === 'ENOENT') return false
    throw error
  }
}

/**
 * 清掉一把过期/无主的锁：先改名到唯一名字，再删那个名字。
 * 改名失败只说明这一轮轮不到我清（别人先清了，或目录正被打开着），回轮询即可；
 * 绝不在原位置直接删——那可能删掉别人刚接手的新锁。
 */
function clearStaleLock(lockDir: string, logEvent: SnapshotLogEvent | undefined, reason: 'expired' | 'unowned'): void {
  const staleDir = lockDir + '.stale-' + randomToken()
  try {
    renameSync(lockDir, staleDir)
  } catch {
    return
  }
  try {
    rmSync(staleDir, { recursive: true, force: true })
  } catch {
    // 删不掉的残留目录用唯一名字命名，不影响任何判断；下次重建也不会撞名。
  }
  logSnapshot(logEvent, 'info', 'workspaceSnapshot.corrupt', {
    stage: 'rebuild-lock',
    action: 'stale-cleaned',
    detail: reason === 'expired' ? '清掉一把过期的重建锁' : '清掉一个没有主人信息的重建锁目录（多半是写到一半就崩了）',
  })
}

/** 拿锁：等到上界还拿不到回 null（由调用方翻译成 RebuildBusyError）。 */
export function acquireRebuildLock(dbPath: string, options: RebuildLockOptions = {}): RebuildLockHandle | null {
  const lockDir = rebuildLockDirOf(dbPath)
  const now = options.now ?? (() => Date.now())
  const ttlMs = options.ttlMs ?? SNAPSHOT_REBUILD_LOCK_TTL_MS
  const waitMs = options.waitMs ?? SNAPSHOT_REBUILD_LOCK_WAIT_MS
  const retryMs = options.retryMs ?? SNAPSHOT_REBUILD_LOCK_RETRY_MS
  const logEvent = options.logEvent
  // 锁目录的父目录就是库文件所在目录：开库路径已经建过它，单独用这个模块的人（门禁、诊断）
  // 不必再自己先建一遍。recursive 对已存在的目录是空操作。
  mkdirSync(dirname(lockDir), { recursive: true })
  const acquiredAtMs = now()
  const deadline = acquiredAtMs + waitMs
  const owner = 'snapshot-rebuild:' + process.pid + ':' + randomToken()
  const fencing = process.pid + '-' + acquiredAtMs + '-' + randomToken()
  let loggedWait = false

  while (true) {
    const created = tryCreateLock(lockDir, { owner, fencing, expiresMs: now() + ttlMs, acquiredMs: acquiredAtMs })
    if (created) return makeRebuildLockHandle(lockDir, owner, fencing, acquiredAtMs, ttlMs, now, logEvent)

    const current = readOwner(lockDir)
    if (current === null) {
      // 没有 owner.json 或字段读不全：自己这套代码不会留下这种目录（写文件与改名是原子的），
      // 所以它是上一轮清理 / 写到一半崩掉的垃圾，按过期处理。
      clearStaleLock(lockDir, logEvent, 'unowned')
    } else if (current.expiresMs <= now()) {
      clearStaleLock(lockDir, logEvent, 'expired')
    } else if (!loggedWait) {
      // 每个进程每趟只记一条「开始等」：重复记就是心跳噪音。
      loggedWait = true
      logSnapshot(logEvent, 'info', 'workspaceSnapshot.corrupt', {
        stage: 'rebuild-lock',
        action: 'wait',
        detail: '另一个进程正在重建快照库，等它结束（持有者 ' + shortHash(current.owner) + '）',
      })
    }

    if (now() >= deadline) {
      logSnapshot(logEvent, 'warn', 'workspaceSnapshot.corrupt', {
        stage: 'rebuild-lock',
        action: 'busy',
        detail: '等重建锁超时：另一个进程还在重建，这一次不重建',
      })
      return null
    }
    sleepSync(retryMs)
  }
}

/** 把一把已经拿到的锁包成句柄：续期心跳、复核、释放都挂在这上面。 */
function makeRebuildLockHandle(
  lockDir: string,
  owner: string,
  fencing: string,
  acquiredAtMs: number,
  ttlMs: number,
  now: () => number,
  logEvent: SnapshotLogEvent | undefined,
): RebuildLockHandle {
  let released = false

  const renew = (): void => {
    if (released) return
    try {
      writeOwnerAtomically(lockDir, { owner, fencing, expiresMs: now() + ttlMs, acquiredMs: acquiredAtMs })
    } catch (error) {
      // 续期失败不终止重建：锁可能被读的人短暂打开着（Windows 上 rename 会被挡住），
      // 下一拍再试；真的丢了会在下一次 assertHeld 里被抓到。
      logSnapshot(logEvent, 'warn', 'workspaceSnapshot.corrupt', {
        stage: 'rebuild-lock',
        action: 'renew-failed',
        detail: '续期写 owner.json 失败（' + (errorCodeOf(error) || 'unknown') + '），下一拍再试',
      })
    }
  }
  const timer = setInterval(renew, Math.max(1, Math.floor(ttlMs / 3)))
  ;(timer as unknown as { unref?: () => void }).unref?.()

  return {
    lockDir,
    owner,
    fencingToken: fencing,
    assertHeld(stage: string): void {
      const current = readOwner(lockDir)
      if (current !== null && current.fencing === fencing) return
      logSnapshot(logEvent, 'warn', 'workspaceSnapshot.corrupt', {
        stage: 'rebuild-lock',
        action: 'lost',
        detail: '重建锁在「' + stage + '」之前已不归本进程，不删库、不建库',
      })
      throw new RebuildLockLostError(stage)
    },
    release(): void {
      if (released) return
      released = true
      clearInterval(timer)
      const current = readOwner(lockDir)
      if (current === null || current.fencing !== fencing) {
        // 释放路径上发现锁已易主：只记一笔，绝不删别人的锁目录。
        logSnapshot(logEvent, 'warn', 'workspaceSnapshot.corrupt', {
          stage: 'rebuild-lock',
          action: 'release-skipped',
          detail: '释放时锁已不归本进程，不删别人的锁目录',
        })
        return
      }
      try {
        rmSync(lockDir, { recursive: true, force: true })
      } catch (error) {
        // 释放失败不抛：抛出去会盖住调用方真正的错误，而且锁最多 TTL 之后自然过期。
        logSnapshot(logEvent, 'warn', 'workspaceSnapshot.corrupt', {
          stage: 'rebuild-lock',
          action: 'release-failed',
          detail: '删重建锁目录失败（' + (errorCodeOf(error) || 'unknown') + '），TTL 到期后别人仍能接手',
        })
      }
    },
  }
}

/** 拿锁跑一段活，结束（成功或失败）立刻释放。门禁直接用它验「回调抛错也要释放」。 */
export function withRebuildLock<T>(
  dbPath: string,
  options: RebuildLockOptions | undefined,
  fn: (lock: RebuildLockHandle) => T,
): T {
  const lock = acquireRebuildLock(dbPath, options)
  if (!lock) throw new RebuildBusyError()
  try {
    return fn(lock)
  } finally {
    lock.release()
  }
}

/**
 * 重试一次「可能被别的进程短暂占着」的文件操作：删库文件三件套、把坏库改名备份。
 * 为什么重试：Windows 上别人打开着同一个文件时，删除与改名都会以 EPERM 失败；而那些
 * 打开着它的进程（另一个窗口的快速自检、等待中的进程）几毫秒内就会松手，拿锁期间
 * 重试一小会儿比让整个开库失败更划算。上界之外照实抛，让调用方回落在线路径。
 */
export function retryWhileFileBusy<T>(action: () => T): T {
  let attempt = 0
  while (true) {
    try {
      return action()
    } catch (error) {
      const code = errorCodeOf(error)
      const busy = code === 'EPERM' || code === 'EBUSY'
      if (!busy || attempt >= FILE_BUSY_RETRY_ATTEMPTS) throw error
      attempt += 1
      sleepSync(SNAPSHOT_REBUILD_LOCK_RETRY_MS)
    }
  }
}
