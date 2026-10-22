// scripts/lib/build-lock.mts —— 同工作区构建互斥的跨进程文件锁（#1365，实现 #1323 定版的方案甲）。
//
// 为什么需要它：两个会话在同一工作区同时跑构建，真构建阶段会删同一批目录、
// 再各写各的一份产物与缓存（见 #1323 定版），最后只剩一份，另一份的构建结果是错的。
// 进程内互斥（src/deck/shell/write-mutex.ts 的 withKeyLock）拦不住两个进程，
// 所以真构建开始前拿一把落在仓库里的跨进程锁，同一时刻只放一个构建进去。
//
// 锁的形状：node_modules/.cache/ 下的 dsh-build.lock（与 dsh-build.json 同目录，
// 跟着依赖目录走：删掉 node_modules 重装依赖，锁与缓存一起消失，不会留一把没人认的旧锁）。
// 拿锁用独占创建（open 的 wx 标记：文件已存在就报错，报错本身就是「有人持锁」的信号，
// 创建与判断是一次原子操作，两个进程同时抢只会有一个成功）。
// 锁内容是一段 JSON：持锁进程的 pid、主机名、启动时间、最近一次心跳、随机串。
// 心跳由持锁进程定时刷新，等锁的人靠「pid 还在不在」与「心跳新不新鲜」判断这把锁是不是已经没人管了。
//
// 三个时间数字只在 config/ 下的三份 YAML 里有一份（#1365 起），本文件运行时从
// 构建时生成的 src/shared/time-config/src/values.ts 里读，不在源码里写第二份数字。
// 读法沿用 scripts/lib/copy-config.mts 的 readTimeValues（读生成物的文本、按行取数），
// 不走 import：构建主流程里生成器跑在本文件被调用之后，静态 import 在刚检出的机器上会找不到文件。
// 刚检出（生成物还不存在）、或者生成物还是加锁之前的旧版本（文件在、但没有三档构建锁参数）时，
// 本文件先现场跑一次生成器再读，构建第一次就能跑起来。
//
// 定时器一定 unref：拿锁等待与持锁心跳都不该拖住进程退出；心跳之外，构建主流程
// 每个大阶段的边界会调一次 pulseBuildLock 同步刷新一次心跳（同步段里事件循环不转，
// 定时器指不上，只有边界上的同步写能证明进程还活着）。

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readTimeValues } from './copy-config.mts'

/** 锁文件的名字：与构建缓存 dsh-build.json 落在同一目录，跟着依赖目录走。 */
export const BUILD_LOCK_FILE = 'dsh-build.lock'

/** 锁文件里存的那段 JSON 的形状。 */
export interface BuildLockInfo {
  /** 持锁进程的 pid：等锁的人用它判断进程还在不在。 */
  pid: number
  /** 持锁进程所在的主机名：两台机器极少共用一个工作区，写下来是为了报错与日志里能指到地方。 */
  host: string
  /** 持锁进程拿锁时的时间（Date.now()）：算「这把锁被拿了多久」。 */
  startedAt: number
  /** 最近一次心跳的时间（Date.now()）：持锁进程每隔一段时间刷新一次，等锁的人看它新不新鲜。 */
  heartbeatAt: number
  /** 随机串：释放与刷新时核对「这把锁还是不是我的」，防止删掉或刷新了别人接管后的锁。 */
  token: string
}

/** 从中央时间参数里读出来的三档：等多久、多久心跳一次、多久没心跳算死亡。 */
export interface BuildLockTimes {
  /** 拿不到锁时最多等多久（超时报错退出，不自动抢）。 */
  waitMs: number
  /** 持锁期间每隔多久刷新一次心跳。 */
  heartbeatMs: number
  /** 超过这么久没见到心跳，就认为持锁进程已经死了，等锁的人可以改名接管。 */
  staleMs: number
}

/** 拿到的那把锁（句柄）：释放、刷新心跳都凭它，released 保证重复释放是安全的。 */
export interface BuildLock {
  /** 锁文件所在的目录（node_modules/.cache/）。 */
  cacheDir: string
  /** 锁文件的完整路径。 */
  lockPath: string
  /** 这次拿锁的随机串：与文件里存的对上，才证明锁还是我的。 */
  token: string
  /** 拿锁实际等了多久（毫秒）：直接拿到就是零，等过锁才大于零，日志里如实说。 */
  waitedMs: number
  /** 已经释放过就为真：重复调 releaseBuildLock 不会再碰文件。 */
  released: boolean
  /** 加载时读到的三档时间：日志里报「等了多久、最多等多久」用同一份，不各说各的。 */
  times: BuildLockTimes
}

/** acquireBuildLock 的入参。 */
export interface AcquireBuildLockOptions {
  /** 仓库根目录：读中央时间参数的生成物、跑生成器、拼锁目录都要从它起算。 */
  repoRoot: string
  /** 锁文件所在的目录（构建传 node_modules/.cache/ 的绝对路径）。 */
  cacheDir: string
  /** 人工闸 --break-stale-lock：传了 true，拿锁前不管旧锁死没死都改名接管；平时一律不传。 */
  breakStale?: boolean
  /**
   * 测试专用覆盖：只给门禁的子进程驱动用，用来把「等五分钟」缩成几秒。
   * 生产路径（scripts/build.mts）永远不传，值永远从 YAML 来。
   */
  testOnlyOverrideTimes?: Partial<BuildLockTimes>
}

/** 持锁进程的心跳定时器：句柄只记 token，定时器存在模块级的表里，不暴露出去。 */
const heartbeatTimers: Map<string, ReturnType<typeof setInterval>> = new Map()

/** 等锁轮询的步长（毫秒）：半秒看一次。持锁方一次构建是几十秒量级，轮询本身不耗什么，步长没必要做成可调参数。 */
const WAIT_POLL_MS = 500

/** 读到损坏的锁文件时，先等一小会儿再读一次：写锁是单次同步写，读到一半只可能是持锁进程死在写的中间，
 *  但也可能是读与写恰好撞上，复读一次能排除后者，避免把一把好锁误判成死亡。 */
const CORRUPT_REREAD_MS = 50

/**
 * 读中央时间参数里管构建锁的三档。缺键直接抛错（数字只在 YAML 里有一份，没有回落可顶），
 * 生成物根本不存在（刚检出）时先现场跑一次生成器再读，构建第一次就能跑起来。
 */
export function loadBuildLockTimes(repoRoot: string): BuildLockTimes {
  ensureTimeValues(repoRoot)
  const all: Record<string, number> = readTimeValues(repoRoot)
  const need: Array<[string, string]> = [
    ['BUILD_LOCK_WAIT_MS', 'timeouts.yaml 的 timeouts.buildLockWaitMs'],
    ['BUILD_LOCK_HEARTBEAT_MS', 'intervals.yaml 的 intervals.buildLockHeartbeatMs'],
    ['BUILD_LOCK_STALE_MS', 'ttl.yaml 的 ttl.buildLockStaleMs'],
  ]
  const out = {} as Record<string, number>
  for (const [gen, where] of need) {
    const v: number = all[gen]
    if (!Number.isInteger(v) || v <= 0) {
      throw new Error('[build] 构建锁：中央时间参数里没有 ' + gen + '（' + where + ' 没写？）——'
        + '先把键补上再跑构建，数字只在 YAML 里有一份，这里不写回落')
    }
    out[gen] = v
  }
  return { waitMs: out['BUILD_LOCK_WAIT_MS'], heartbeatMs: out['BUILD_LOCK_HEARTBEAT_MS'], staleMs: out['BUILD_LOCK_STALE_MS'] }
}

/** 三档参数在生成物里的常量名，与 scripts/generate-time-config.mts 的 KEYS 映射一一对应。 */
const BUILD_LOCK_TIME_KEYS: readonly string[] = ['BUILD_LOCK_WAIT_MS', 'BUILD_LOCK_HEARTBEAT_MS', 'BUILD_LOCK_STALE_MS']

/** 生成物里三档构建锁参数齐不齐：按生成物的固定格式逐行看，不 import（这是构建产物，源码里没有）。 */
function hasBuildLockTimes(abs: string): boolean {
  let text: string
  try {
    text = readFileSync(abs, 'utf8')
  } catch {
    return false
  }
  return BUILD_LOCK_TIME_KEYS.every((key) => new RegExp('^export const ' + key + ': number = -?\\d+', 'm').test(text))
}

/**
 * 生成物不存在、或者存在但缺三档构建锁参数时，现场跑一次生成器（幂等：已存在且三键齐全就不跑，
 * 避免每次拿锁都多一次进程）。
 *
 * 为什么「存在也要看键」：values.ts 是被 .gitignore 忽略的构建产物，升级过的工作区里一定还留着
 * 上一版生成的旧文件。只判断文件存不存在的话，旧文件会被当成最新的用，拿锁时就报「YAML 里没写
 * buildLockWaitMs」——而 YAML 里其实刚加过，真正要做的是把生成物重算一遍。合入构建锁后第一次
 * 构建就会撞上，本机实测直接让构建主流程崩掉，所以这里必须按内容判断，不能只看文件在不在。
 */
function ensureTimeValues(repoRoot: string): void {
  const abs: string = join(repoRoot, 'src', 'shared', 'time-config', 'src', 'values.ts')
  if (existsSync(abs) && hasBuildLockTimes(abs)) return
  const r = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'generate-time-config.mts')], { encoding: 'utf8' })
  if (r.status !== 0 || !existsSync(abs)) {
    throw new Error('[build] 构建锁：中央时间参数的生成物不存在，现场生成也没成功——'
      + '请先跑一次 node scripts/generate-time-config.mts（' + String((r.stderr || r.stdout || '')).split(/\r?\n/)[0] + '）')
  }
  if (!hasBuildLockTimes(abs)) {
    throw new Error('[build] 构建锁：时间参数生成物里没有三档构建锁参数——先确认 config/ 下的 timeouts.yaml、'
      + 'intervals.yaml、ttl.yaml 写了 timeouts.buildLockWaitMs、intervals.buildLockHeartbeatMs、'
      + 'ttl.buildLockStaleMs，再跑一次 node scripts/generate-time-config.mts')
  }
}

/** pid 对应的进程还在不在。kill(pid, 0) 不发信号，只问存不存在：
 *  成功就是活着；ESRCH（没这个进程）就是死了；EPERM（没权限问）按活着算——宁可多等，不可抢活人的锁。 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'ESRCH') return false
    return true
  }
}

/** 这把锁是不是已经没人管了：持锁进程不在了，或者心跳停了超过有效期。心跳时间在未来（时钟拨过）按新鲜算。 */
export function isLockStale(info: BuildLockInfo, now: number, staleMs: number): boolean {
  if (!isPidAlive(info.pid)) return true
  return now - info.heartbeatAt > staleMs
}

/** 把锁文件读成对象。文件不在返回空（持锁的人刚释放， race 的一瞬）；内容损坏先复读一次，
 *  还坏就如实返回损坏，调用方按「没人能证明它是活的」处理（当陈旧接管）。 */
function readLockInfo(lockPath: string): { info: BuildLockInfo | null; corrupt: boolean } {
  let text: string
  try {
    text = readFileSync(lockPath, 'utf8')
  } catch {
    return { info: null, corrupt: false }
  }
  try {
    const parsed = JSON.parse(text) as Partial<BuildLockInfo>
    if (!Number.isInteger(parsed.pid) || typeof parsed.heartbeatAt !== 'number' || typeof parsed.token !== 'string') {
      throw new Error('字段不全')
    }
    return { info: parsed as BuildLockInfo, corrupt: false }
  } catch {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, CORRUPT_REREAD_MS)
    try {
      const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Partial<BuildLockInfo>
      if (!Number.isInteger(parsed.pid) || typeof parsed.heartbeatAt !== 'number' || typeof parsed.token !== 'string') {
        throw new Error('字段不全')
      }
      return { info: parsed as BuildLockInfo, corrupt: false }
    } catch {
      return { info: null, corrupt: true }
    }
  }
}

/** 写锁文件（同步）：拿锁成功与每次心跳都走这里。调用方保证只在「锁是我的」时调。 */
function writeLockFile(lockPath: string, info: BuildLockInfo): void {
  writeFileSync(lockPath, JSON.stringify(info), 'utf8')
}

/** 起心跳定时器：每隔 heartbeatMs 把 heartbeatAt 刷成现在。unref 保证它不拖住进程退出
 *  （构建正常结束走释放，崩溃走陈旧接管，心跳定时器本身永远不该成为进程不退的原因）。 */
function startHeartbeat(lock: BuildLock, lockPath: string): void {
  stopHeartbeat(lock)
  const timer: ReturnType<typeof setInterval> = setInterval(() => {
    try {
      pulseBuildLock(lock)
    } catch {
      // 刷新失败（文件被删、锁被接管）不抛：下一次轮到谁由锁文件说了算，这里不替调用方做决定。
    }
  }, lock.times.heartbeatMs)
  if (typeof (timer as unknown as { unref?: unknown }).unref === 'function') {
    ;(timer as unknown as { unref: () => void }).unref()
  }
  heartbeatTimers.set(lock.token, timer)
}

/** 停心跳定时器：释放锁与判到锁已易主时调。 */
function stopHeartbeat(lock: BuildLock): void {
  const timer: ReturnType<typeof setInterval> | undefined = heartbeatTimers.get(lock.token)
  if (timer !== undefined) {
    clearInterval(timer)
    heartbeatTimers.delete(lock.token)
  }
}

/**
 * 拿构建锁。缓存没命中、真要构建时才调；缓存命中直接退出的那条路不碰锁。
 *
 * 流程：独占创建锁文件，成功就是拿到；文件已存在就读它——
 *  pid 不在或心跳过期（或内容损坏、或人工闸开了）就改名接管，改名失败（别人先了一步）就回去重等；
 *  锁是活的就睡一小会儿再试，直到拿到或超过等待上限（超时报错退出，不自动抢活人的锁）。
 *  拿锁成功后起心跳定时器；调用方要在构建每个大阶段的边界调一次 pulseBuildLock（同步段里定时器不转）。
 */
export function acquireBuildLock(opts: AcquireBuildLockOptions): BuildLock {
  const baseTimes: BuildLockTimes = loadBuildLockTimes(opts.repoRoot)
  const times: BuildLockTimes = { ...baseTimes, ...(opts.testOnlyOverrideTimes || {}) }
  mkdirSync(opts.cacheDir, { recursive: true })
  const lockPath: string = join(opts.cacheDir, BUILD_LOCK_FILE)
  const me: BuildLockInfo = {
    pid: process.pid,
    host: hostname(),
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    token: randomBytes(8).toString('hex'),
  }
  // 人工闸 --break-stale-lock：拿锁前先看一眼，有旧锁就改名接管（改名失败说明锁已经没了，直接进正常流程）。
  if (opts.breakStale) {
    const prev: { info: BuildLockInfo | null; corrupt: boolean } = readLockInfo(lockPath)
    if (prev.info !== null || prev.corrupt) {
      console.log('[build] 构建锁：带了 --break-stale-lock，旧锁不管死活都接管（' + describeLock(prev) + '）')
      takeoverLock(lockPath)
    }
  }
  const start: number = Date.now()
  const deadline: number = start + times.waitMs
  let announced = false
  for (;;) {
    try {
      writeFileSync(lockPath, JSON.stringify(me), { flag: 'wx', encoding: 'utf8' })
      const waitedMs: number = Date.now() - start
      const lock: BuildLock = { cacheDir: opts.cacheDir, lockPath, token: me.token, waitedMs, released: false, times }
      startHeartbeat(lock, lockPath)
      if (waitedMs > 0) {
        console.log('[build] 构建锁：拿到锁了（排队约 ' + Math.round(waitedMs / 1000) + ' 秒），先复核一次缓存再决定要不要真构建')
      }
      return lock
    } catch (e: unknown) {
      if ((e as { code?: string }).code !== 'EEXIST') throw e
    }
    const seen: { info: BuildLockInfo | null; corrupt: boolean } = readLockInfo(lockPath)
    if (seen.info === null && !seen.corrupt) {
      // 文件在创建与读取之间没了（持锁的人刚释放）：不定为任何结论，直接重抢。
      continue
    }
    const stale: boolean = seen.corrupt || (seen.info !== null && isLockStale(seen.info, Date.now(), times.staleMs))
    if (stale) {
      // 接管先改名再建，不删了再建：删建之间有空隙，两个等锁的人会同时认为「没锁了」各建各的；
      // 改名是原子操作，只有一个人能改走，改输的人收到 ENOENT 回去重等（锁还在，只是换了个名）。
      console.log('[build] 构建锁：上一把锁已经没人管了（' + describeLock(seen) + '），改名接管')
      if (takeoverLock(lockPath)) continue
      continue
    }
    if (seen.info !== null && !announced) {
      announced = true
      console.log('[build] 构建锁：另一个构建正在跑（pid ' + seen.info.pid + '，主机 ' + seen.info.host + '），'
        + '这次在后面排队等它（最多等约 ' + Math.round(times.waitMs / 60000) + ' 分钟）')
    }
    if (Date.now() >= deadline) {
      const holder: string = seen.info !== null ? 'pid ' + seen.info.pid + '（主机 ' + seen.info.host + '）' : '未知进程'
      throw new Error('[build] 构建锁：等了约 ' + Math.round(times.waitMs / 60000) + ' 分钟还是没拿到锁'
        + '（持锁 ' + holder + '，锁文件 ' + lockPath + '）：这次不等了，直接报错退出；'
        + '持锁进程可能卡住或死了但心跳还在，先去看那台机器上的进程，再决定要不要带 --break-stale-lock 重跑')
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, WAIT_POLL_MS)
  }
}

/** 把旧锁改名（dsh-build.lock.stale-<随机>），改完就删掉，不留垃圾。返回改名成没成功：
 *  改名失败（ENOENT：锁已经没了，被人拿走或释放）返回假，调用方回去重等，不按接管成功处理。 */
function takeoverLock(lockPath: string): boolean {
  const stalePath: string = lockPath + '.stale-' + randomBytes(4).toString('hex')
  try {
    renameSync(lockPath, stalePath)
  } catch {
    return false
  }
  try {
    rmSync(stalePath, { force: true })
  } catch {
    // 改下来的旧锁删不掉就留着：stale- 后缀不会被任何人当成锁读，不影响拿锁，只多一个文件。
  }
  return true
}

/** 把读到的锁说成一句人话（日志与报错里用）。 */
function describeLock(seen: { info: BuildLockInfo | null; corrupt: boolean }): string {
  if (seen.info !== null) {
    const ageS: number = Math.max(0, Math.round((Date.now() - seen.info.heartbeatAt) / 1000))
    return 'pid ' + seen.info.pid + '（主机 ' + seen.info.host + '），心跳 ' + ageS + ' 秒前'
  }
  return '锁文件内容已损坏（读不出持锁进程）'
}

/**
 * 同步刷新一次心跳：构建主流程每个大阶段的边界调一次（同步段里事件循环不转，定时器指不上）。
 * 发现锁已经不是我的（文件没了、或 token 对不上——说明我被当成死锁接管了），就停掉心跳、
 * 把句柄标成已释放，返回假；调用方（构建）此时应当停下来，不再继续写产物。
 */
export function pulseBuildLock(lock: BuildLock): boolean {
  if (lock.released) return false
  const seen: { info: BuildLockInfo | null; corrupt: boolean } = readLockInfo(lock.lockPath)
  if (seen.info === null || seen.info.token !== lock.token) {
    stopHeartbeat(lock)
    lock.released = true
    console.warn('[build] 构建锁：锁已经不是我的了（文件没了或被别人接管），停掉心跳，不再继续写产物')
    return false
  }
  try {
    writeLockFile(lock.lockPath, { ...seen.info, heartbeatAt: Date.now() })
  } catch {
    return false
  }
  return true
}

/**
 * 释放锁：停心跳、删锁文件。幂等（重复调第二次直接返回），不抛错（exit 兜底里调它，抛错没有意义）。
 * 只删 token 对得上的文件：锁要是已经被别人接管，文件是别人的，不能删。
 */
export function releaseBuildLock(lock: BuildLock): void {
  stopHeartbeat(lock)
  if (lock.released) return
  lock.released = true
  try {
    const seen: { info: BuildLockInfo | null; corrupt: boolean } = readLockInfo(lock.lockPath)
    if (seen.info !== null && seen.info.token === lock.token) {
      rmSync(lock.lockPath, { force: true })
    }
  } catch {
    // 释放时删不掉（权限、文件系统）：进程退出了锁就没人续心跳，等锁的人按陈旧接管，不在这里报错。
  }
}

/**
 * 一句话说出锁目录的现状（调试与门禁里用）：没锁、有活锁、有死锁、文件损坏，四种各一句话。
 * 读不到中央时间参数时不抛（只看锁，不看时间）：陈旧判断用传入的 now 与调用方给的 staleMs。
 */
export function describeBuildLock(cacheDir: string, now?: number, staleMs?: number): string {
  const lockPath: string = join(cacheDir, BUILD_LOCK_FILE)
  if (!existsSync(lockPath)) return '没有构建锁（' + lockPath + ' 不存在）'
  const seen: { info: BuildLockInfo | null; corrupt: boolean } = readLockInfo(lockPath)
  if (seen.info === null) return '构建锁文件已损坏（' + lockPath + ' 读不出持锁进程）'
  const at: number = now === undefined ? Date.now() : now
  if (staleMs !== undefined && isLockStale(seen.info, at, staleMs)) {
    return '构建锁无人接管（' + describeLock(seen) + '，锁文件 ' + lockPath + '）'
  }
  return '构建锁被持有（' + describeLock(seen) + '，锁文件 ' + lockPath + '）'
}
