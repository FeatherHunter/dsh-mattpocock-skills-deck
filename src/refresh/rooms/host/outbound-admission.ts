/**
 * 同时在飞的 gh 进程上限（读桶大、写桶小）。这道门是**保险丝，不是油门**。
 *
 * 谁规定进程数不能多？没有人。平台层面没有这条规矩：
 *   · gh 每条调用都是一个独立进程，本身没有并发上限；
 *   · GitHub 的约束是配额（每小时 5000 次请求），由闸按预算管，不是这道门管的事；
 *   · 唯一真实的「并发本身」风险是 GitHub 的二级限流/滥用防护会惩罚突发，但那只对
 *     持续的高并发突发才够得着——本插件一天的峰值是 12（见下），够不着。
 * 真正会耗尽的只有**本机资源**：每个 gh 进程几十 MB 内存加一次进程创建开销。
 * #960 那次投诉（弱终端上几十路并发各等满 30 秒把系统拖死）就是这个。
 *
 * 2026-10-10 实测（当天 3120 条 gh.exec，按房内计时区间算并发的上界，含排队重叠，所以偏大）：
 *   同时在飞最多 12 条；291 条 ≥10 秒、172 条 ≥25 秒——挤占名额的是**慢调用**，不是调用量。
 * 原来的读 8 / 写 2 是拍脑袋的暂定值：实测需求 12 > 8，**这道门白天真的会绑到**；一绑就把
 * 调用塞进队列，而队列当时没有属于自己的上限，一路排到外层调用钳制（30 秒）才结束。
 * 一个资源护栏绝不该变成「普通工作会失败、会多等 30 秒」的原因——那是这次要改掉的设计错误。
 *
 * 现行取值：读 64、写 16（读取 #962 当初给的「上限参考 64」，写按读写需求差取四分之一）。
 * 判断标准只有一条：**远高于实测峰值，正常永不介入**；只在明显跑飞（例如某个 bug 扇出上百条）
 * 时熔断，好过让机器被进程吃光。真正让名额不会被长期占住的是房内自己那只表
 * （读 12 秒 / 写 30 秒 / 探活 15 秒，含排队段，见 backends/github/client.js）。
 * 终值仍以测量回填（#967 测量 / #966 收口）为准。
 *
 * #1007 起本道门还管**通路失败后的冷却**：一次 transport 级失败（超时、被杀、进程根本没起来）
 * 之后，同一条通路、同一只桶在冷却窗口里不再起新进程，拿名额直接抛出带 `admission-cooldown` 标记的错误，
 * 调用方据此立刻回「到 GitHub 的通路现在不通，先别重试」，而不是各自再赔满一次超时。
 * 任何一条命令跑完拿到退出码（退出码非零也算）就说明通路是通的，冷却立刻清零。
 * 冷却按「服务 + 读写档」各记一份：gh 与 glab 共用这一道准入闸（名额与上限是一套），
 * 但两者的通路是两条 —— GitLab 的故障不许把去 GitHub 的调用一起挡掉，反之亦然（#1007 复核）。
 *
 * #1570 起本道门还管**排队最多等多久**：调用方拿名额时传 `waitMs`（毫秒；缺省维持今天的不设上限），
 * 到点由闸抛出带 `admission-queue-timeout` 标记的「排队超时」错误（带出等了多久与预算），
 * 并负责把到点之后晚到的名额归还。排队计时器住这里、不再由每个调用方各写一只：四条出站路
 * （房间 client / 宿主 runGh 薄封装 / 平台通道 detectionExec / git-execution 的 execProc）
 * 只传预算、只把错误翻成人话（#1570）。
 */

import { TUNING } from '../../contract/tuning-parameters.js'
import { TRANSPORT_COOLDOWN_MS, OUTBOUND_QUEUE_TIMEOUT_CODE, outboundQueueTimeoutOf } from '../../../tracker/kernel/outbound-tiers.js'
import { LANE_LONG_WAIT_LOG_MS, LANE_WAIT_LOG_INTERVAL_MS } from '../../../shared/time-config/src/values.js'

// 取值住共用调参表（真源 src/refresh/contract/tuning-parameters.ts），这里只留缺表回落的缺省值（与今天一致）。
export const READ_BUCKET_MAX = TUNING.readBucketMax ?? 64
export const WRITE_BUCKET_MAX = TUNING.writeBucketMax ?? 16

// #1101：排队放行时「等了很久」的常驻轨迹门槛与节流间隔。
//   为什么要有：调试开关默认关着，2026-10-21 那种「64 个名额全满、队尾排到 338 位、等 15 秒」的风暴
//   在普通用户的日志里一行都不留 —— 事后只能看到一串耗时十几秒的 gh.exec，分不出慢在命令还是慢在门口。
//   为什么要节流：风暴期间每秒都有放行，逐条记一天就是几十万行的垃圾；同桶五分钟最多一行足够定性。
//   这两个值住 config/intervals.yaml（laneLongWaitLogMs / laneWaitLogIntervalMs），这里不许写第二份数字。

// 准入桶：读与写两只桶，配额与统计都按桶隔离，跨桶不抢名额。
type GhBucket = 'read' | 'write'
// 通路归属：冷却按「服务 + 读写档」分开记。今天只有 github 这一条会设冷却；gitlab 与 git
// 只是共用同一套名额（名副其实的「同一道闸、不同的路」），它们的调用不该被 GitHub 的冷却挡住。
type GhService = 'github' | 'gitlab' | 'git'
// 服务名归一：没给就当 github（现有绝大多数调用是 gh）；glab 与 git 由调用方显式传。
function normService(s: unknown): GhService {
  const v = String(s == null ? '' : s).trim().toLowerCase()
  return v === 'gitlab' ? 'gitlab' : (v === 'git' ? 'git' : 'github')
}
// 排队预算的计时器接口（#1570）：生产用全局 setTimeout / clearTimeout；门禁可注入假计时器，
// 在同一只闸上复现「到点」「到点后又放回名额」这类时间点精确的场景。注入只给测试用。
type GhTimerHandle = ReturnType<typeof setTimeout>
interface GhTimers {
  setTimeout(fn: () => void, ms: number): GhTimerHandle
  clearTimeout(handle: GhTimerHandle): void
}
const defaultTimers: GhTimers = {
  setTimeout: function (fn: () => void, ms: number): GhTimerHandle { return setTimeout(fn, ms) },
  clearTimeout: function (handle: GhTimerHandle): void { clearTimeout(handle) },
}
// 一条通路上的一次冷却：到什么时候、上次为什么失败、连续失败几次、失败的是哪条命令（短标签，仅日志）、
// 这一轮是否已经记过被挡回的那一行（节流用）。
interface GhCoolState {
  until: number
  reason: string
  failStreak: number
  cmd: string
  rejectLogged: boolean
}
// 排队等待者的形状：创建时放行与取消函数先空着，随后立即补上真正的函数。
// timer 是 #1570 的排队预算计时器句柄；没给预算时不建表，保持原有路径不多一个定时器。
interface GhWaiter {
  settled: boolean
  signal: AbortSignal | null
  resolve: (() => void) | null
  reject: ((e: unknown) => void) | null
  bucket: GhBucket
  service: GhService
  timer: GhTimerHandle | null
}
// 准入选项与拿名额参数的形状：调用方没给就用缺省桶与缺省配额。
interface GhAdmissionOpts {
  readMax?: number
  writeMax?: number
  cooldownMs?: number
  timers?: GhTimers
}
interface GhAcquireArgs {
  bucket?: string
  signal?: AbortSignal | null
  cmd?: string
  service?: string
  waitMs?: number
}
interface GhLaneOpts {
  bucket?: string
  signal?: AbortSignal | null | undefined
  service?: string
  waitMs?: number
}
// 取消错误的形状：标准 Error 上加两个标记，调用方靠它们认出取消而非失败。
type AdmissionCancelledError = Error & { code: string; admissionCancelled: boolean }
// 冷却错误的形状：标准 Error 上带 code 与「哪只桶、还剩多久、上次为什么失败、连续失败几次」。
// 调用方用 kernel 的 OUTBOUND_COOLDOWN_CODE / outboundCooldownOf 识别，不靠错误文本。
type AdmissionCooldownError = Error & { code: string; bucket: string; remainingMs: number; reason: string; failStreak: number }
// 排队超时错误的形状：标准 Error 上带 code 与「哪只桶、等了多久、当初预算多少」。
// 调用方用 kernel 的 OUTBOUND_QUEUE_TIMEOUT_CODE / outboundQueueTimeoutOf 识别，同样不靠错误文本。
type AdmissionQueueTimeoutError = Error & { code: string; admissionQueueTimeout: boolean; bucket: string; waitedMs: number; limitMs: number }
// 日志出口（#960 复核）：可选注入；没注入时本文件照旧不写任何日志，准入行为一字不变。
interface GhLogCtxLike {
  fire(level: string, event: string, fields: Record<string, unknown>): void
  isEnabled?(level: string): boolean
}
let laneLogCtx: GhLogCtxLike | null = null
/** 把宿主的日志上下文接到这道门上：调用方在拿名额前传一次即可，没传也不影响准入。 */
export function setGhLaneLogCtx(ctx: GhLogCtxLike | null | undefined): void { laneLogCtx = ctx || null }

/** 取消错误的标记：调用方据此返回“取消”而非“失败”。 */
export const ADMISSION_CANCELLED = 'admission-cancelled'

/**
 * 是不是排队期间的取消（取消按取消返回，不记失败）。
 * 类型说明：错误值可能是任意形状，断言只做类型读取，运行时仍是原键读取。
 */
export function isAdmissionCancelled(err: unknown): boolean {
  return !!(err && ((err as { code?: unknown }).code === ADMISSION_CANCELLED || (err as { admissionCancelled?: unknown }).admissionCancelled === true))
}

/**
 * 排队超时的标记：调用方据此回「排队太久、一次都没跑起来」，按可重试处理。
 * 值只有一处真源（kernel 的 OUTBOUND_QUEUE_TIMEOUT_CODE），这里只转出口，不写第二份字面量。
 */
export const ADMISSION_QUEUE_TIMEOUT = OUTBOUND_QUEUE_TIMEOUT_CODE

/**
 * 是不是「排队等过了调用方给的预算」。与取消分开判：取消是调用方主动放弃，排队超时是名额竞争输了。
 * 判定复用 kernel 的 outboundQueueTimeoutOf，保证闸与四条出站路认的是同一把尺子。
 */
export function isAdmissionQueueTimeout(err: unknown): boolean {
  return outboundQueueTimeoutOf(err) !== null
}

/** 排队预算归一：只认有限正数（毫秒，向下取整）；没给、非数字、非正数一律按「不设上限」（0）处理。 */
function normWaitMs(w: unknown): number {
  return (typeof w === 'number' && isFinite(w) && w > 0) ? Math.floor(w) : 0
}

function cancelledError(): AdmissionCancelledError {
  // 类型说明：标准 Error 上加两个取消标记，断言不改变运行时对象。
  const e = new Error('gh admission: cancelled while queued') as AdmissionCancelledError
  e.code = ADMISSION_CANCELLED
  e.admissionCancelled = true
  return e
}

/**
 * 冷却错误的标记与载荷：调用方认出「通路不通」之后要能立刻回人话，还说得出还剩多久、上次为什么失败。
 * 数字只用于日志与回话，不用于任何裁决。
 */
function cooldownError(info: { bucket: GhBucket; remainingMs: number; reason: string; failStreak: number }): AdmissionCooldownError {
  const e = new Error('gh admission: transport cooling down') as AdmissionCooldownError
  e.code = 'admission-cooldown'
  e.bucket = info.bucket
  e.remainingMs = Math.max(0, Math.floor(info.remainingMs))
  e.reason = info.reason
  e.failStreak = Math.max(0, Math.floor(info.failStreak))
  return e
}

/**
 * 排队超时错误的标记与载荷：#1570 的验收要「带出等了多久」，所以把 waitedMs 与 limitMs 一起放在错误上，
 * 各出口按自己的口径拼人话（房间说「排队 X 毫秒、到点还没拿到名额」，宿主说「一次都没跑起来」）。
 */
function queueTimeoutError(info: { bucket: GhBucket; waitedMs: number; limitMs: number }): AdmissionQueueTimeoutError {
  const e = new Error('gh admission: queued longer than allowed') as AdmissionQueueTimeoutError
  e.code = ADMISSION_QUEUE_TIMEOUT
  e.admissionQueueTimeout = true
  e.bucket = info.bucket
  e.waitedMs = Math.max(0, Math.floor(info.waitedMs))
  e.limitMs = Math.max(0, Math.floor(info.limitMs))
  return e
}

/**
 * 建一道准入。opts: { readMax, writeMax, cooldownMs, timers }。
 * 用法：const release = await lane.acquire({ bucket: 'read'|'write', signal, waitMs }); try { … } finally { release() }。
 * service 可选（github / gitlab / git，缺省 github）：冷却按「服务 + 读写档」分开记（#1007 复核），
 * 名额与上限仍是三条路共用的一套 —— 传对服务，GitHub 的故障才不会挡住 GitLab / git 的调用。
 * 排队期间 signal 中止 → acquire 抛取消错误（不占名额、不记失败，调用方按取消返回）。
 * 排队超过 waitMs（#1570）→ acquire 抛排队超时错误（带 waitedMs / limitMs，不占名额），
 * 到点后晚到的名额照常放回、由后面的排队者接住；waitMs 缺省不设上限。
 * 类型说明：host 域文件，只做类型标注，不动逻辑不动结构；选项与参数缺省都按读桶处理。
 */
export function createGhAdmission(opts: GhAdmissionOpts | null | undefined) {
  const o: GhAdmissionOpts = opts || {}
  // #1570：排队预算的计时器。缺省用全局 setTimeout/clearTimeout；注入只给门禁用，
  // 生产四条出站路一律走缺省，避免同一进程里出现两套时钟。
  const timers: GhTimers = o.timers || defaultTimers
  const maxOf: Record<GhBucket, number> = {
    read: (typeof o.readMax === 'number' && o.readMax > 0) ? Math.floor(o.readMax) : READ_BUCKET_MAX,
    write: (typeof o.writeMax === 'number' && o.writeMax > 0) ? Math.floor(o.writeMax) : WRITE_BUCKET_MAX,
  }
  const running: Record<GhBucket, number> = { read: 0, write: 0 }
  const queues: Record<GhBucket, GhWaiter[]> = { read: [], write: [] }
  // 通路冷却的窗口长度：能被测试用 cooldownMs 缩短，缺省用中央时间参数里的 30 秒。
  const cooldownMs: number = (typeof o.cooldownMs === 'number' && o.cooldownMs > 0) ? Math.floor(o.cooldownMs) : TRANSPORT_COOLDOWN_MS
  // 冷却按「服务 + 读写档」各记一份（#1007 复核）：GitHub 的通路故障不许把去 GitLab / git 的调用一起挡掉。
  // 键形状是 service:bucket（例如 github:read）；懒建，正常路径（一次冷却都没设过）只查一次表，不分配对象、不多读时钟。
  // failStreak 只在「跑完拿到退出码」时清零；窗口过期不自动清，好让日志看得出这是一串连续失败。
  // rejectLogged 是「这一轮冷却里已经记过一笔被挡回的轨迹」，用来给高频拒绝做节流：
  // 冷却期间面板会连续调很多次，逐次记 gh.transport 就是风暴日志，头一笔已经足够说明问题。
  const cooldown = new Map<string, GhCoolState>()
  // 冷却表键：服务名与桶名各取一枚枚举，拼出来只做查表用，不进日志。
  function coolKeyOf(service: GhService, bucket: GhBucket): string { return service + ':' + bucket }
  const stats = {
    read: { peak: 0, waited: 0, done: 0, timedOut: 0 },
    write: { peak: 0, waited: 0, done: 0, timedOut: 0 },
    cancelled: 0,
  }
  // 两只桶各记「上一次因长等待落行」的钟点，用来做五分钟节流；0 表示还没记过。
  const lastWaitLogAt: Record<GhBucket, number> = { read: 0, write: 0 }

  // 桶名归一：不是写桶一律按读桶算，调用方传错也不炸。
  function normBucket(b: unknown): GhBucket { return b === 'write' ? 'write' : 'read' }

  // 命令短标签归一：只留日志里指认用的短标签，去掉空白并截短；空就是没给。
  // 为什么截短：这个字段要进日志白名单，宁可不全，也不能让一整条命令原文从参数里漏进去。
  function normCmd(c: unknown): string {
    const s = String(c == null ? '' : c).replace(/\s+/g, ' ').trim()
    return s.length > 40 ? s.slice(0, 40) : s
  }

  // 清掉某个等待者的排队计时器：拿到的、取消的、到点的都走这一处，保证不留下悬挂的定时器。
  function clearQueueTimer(waiter: GhWaiter): void {
    if (waiter.timer == null) return
    try { timers.clearTimeout(waiter.timer) } catch (eT) {}
    waiter.timer = null
  }

  /** 常驻事件 gh.transport：冷却设上、被冷却挡回、冷却清零三件事各一行，只在真正发生时记。 */
  function logTransport(fields: Record<string, unknown>): void {
    try {
      if (laneLogCtx && typeof laneLogCtx.fire === 'function') laneLogCtx.fire('info', 'gh.transport', fields)
    } catch (eL) {}
  }

  // 泵：有空名额就放行队首；已 settle 或已中止的只记取消不占名额。
  function pump(bucket: GhBucket): void {
    const q = queues[bucket]
    while (q.length > 0 && running[bucket] < maxOf[bucket]) {
      // 类型说明：循环守了长度，断言队首一定在，运行时还是原来那个元素。
      const waiter = q.shift() as GhWaiter
      if (waiter.settled) continue
      if (waiter.signal && waiter.signal.aborted === true) {
        waiter.settled = true
        clearQueueTimer(waiter)
        stats.cancelled += 1
        waiter.reject!(cancelledError())
        continue
      }
      running[bucket] += 1
      if (running[bucket] > stats[bucket].peak) stats[bucket].peak = running[bucket]
      waiter.settled = true
      waiter.resolve!()
    }
  }

  // 拿名额：有空位直接给，没空位排队；排队期间取消按取消返回，等超预算按排队超时返回。
  function acquire(arg: GhAcquireArgs | null | undefined): Promise<() => void> {
    const a: GhAcquireArgs = arg || {}
    const bucket: GhBucket = normBucket(a.bucket)
    const service: GhService = normService(a.service)
    const signal: AbortSignal | null = a.signal || null
    if (signal && signal.aborted === true) return Promise.reject(cancelledError())
    // #1007：这条通路上这只桶刚有过 transport 级失败、冷却窗口还没过 —— 不起进程，立刻拒，并说清还剩多久。
    // 放在排队之前判：冷却期间不该再往队里塞人，否则又多一个等着赔超时的。
    // 只有设过冷却（until 非零）才读一次钟：正常路径一条命令都不多读时钟，这与日志纪律里
    // 「开关关着时日志点连时钟都不读」是同一个意思 —— 准入判断不该为不会发生的冷却白读一次时间。
    const cool = cooldown.get(coolKeyOf(service, bucket))
    if (cool && cool.until !== 0) {
      const now = Date.now()
      if (cool.until > now) {
        const info = { bucket: bucket, remainingMs: cool.until - now, reason: cool.reason, failStreak: cool.failStreak }
        // 同一轮冷却只记第一笔被挡回的调用：面板会连续调很多次，逐次记就是风暴日志。
        if (!cool.rejectLogged) {
          cool.rejectLogged = true
          logTransport({ decision: 'reject-cooling', bucket: bucket, reason: cool.reason, remainingMs: info.remainingMs, failStreak: cool.failStreak, cmd: normCmd(a.cmd) })
        }
        return Promise.reject(cooldownError(info))
      }
      // 窗口已经过期：把到期时刻清零，下次拿名额不再读钟；连续失败次数留着，等拿到退出码再清。
      cool.until = 0
    }
    if (running[bucket] < maxOf[bucket]) {
      running[bucket] += 1
      if (running[bucket] > stats[bucket].peak) stats[bucket].peak = running[bucket]
      return Promise.resolve(releaseOf(bucket))
    }
    stats[bucket].waited += 1
    // #1570：排队预算只认显式给的正数毫秒；0 表示不设上限（不建计时器）。
    const waitMs = normWaitMs(a.waitMs)
    // #960 复核：排上队的那一刻记下钟点，放行时把「等了多久、等候期间这只桶里还有谁」落一行按需日志。
    //   为什么要有：票面问的是「准入这道门到底有没有把人憋死」，只看 gh.exec 的耗时分不清「命令慢」与「排队慢」。
    const waitT0 = Date.now()
    // 类型说明：Promise 泛型只定放行函数的形状，运行时仍是原来那只 Promise。
    return new Promise<() => void>(function (resolve, reject) {
      // 类型说明：放行与取消函数先空着，随后立即补上，空只存在这两行之间。
      const waiter: GhWaiter = { settled: false, signal: signal, resolve: null, reject: null, bucket: bucket, service: service, timer: null }
      waiter.resolve = function (): void {
        clearQueueTimer(waiter)
        // #960：排队拿到名额时落一行 —— 桶名、放行时在飞数、上限、放行时队列残长、等了多久。
        //   只记短枚举与数字，不记命令、路径、票号。按需级（先判调试开关），不采样。
        try {
          const now = Date.now()
          const waitedMs = now - waitT0
          if (laneLogCtx && typeof laneLogCtx.fire === 'function' && (!laneLogCtx.isEnabled || laneLogCtx.isEnabled('debug'))) {
            laneLogCtx.fire('debug', 'gh.lane.saturated', { bucket: bucket, inflight: running[bucket], max: maxOf[bucket], queued: queues[bucket].length, waitedMs: waitedMs })
          }
          // #1101：常驻一行「门口确实憋过」的轨迹。信息和调试两档各管一件事：
          //   调试那行是逐条明细（排一次记一次，用来画分布）；这一行只说「这段时间这只桶憋过」，
          //   三秒起记、同桶五分钟最多一条，风暴一天也只有几百行，不用开调试也查得到。
          if (laneLogCtx && typeof laneLogCtx.fire === 'function' && waitedMs >= LANE_LONG_WAIT_LOG_MS && now - lastWaitLogAt[bucket] >= LANE_WAIT_LOG_INTERVAL_MS) {
            lastWaitLogAt[bucket] = now
            laneLogCtx.fire('info', 'gh.lane.wait', { bucket: bucket, waitedMs: waitedMs, inflight: running[bucket], max: maxOf[bucket], queued: queues[bucket].length })
          }
        } catch (eL) {}
        resolve(releaseOf(bucket))
      }
      waiter.reject = function (e: unknown): void { clearQueueTimer(waiter); reject(e) }
      const onAbort = function (): void {
        if (waiter.settled) return
        waiter.settled = true
        clearQueueTimer(waiter)
        const idx = queues[bucket].indexOf(waiter)
        if (idx >= 0) queues[bucket].splice(idx, 1)
        stats.cancelled += 1
        // 类型说明：排到它时取消函数一定已补上，非空断言只过类型检查。
        waiter.reject!(cancelledError())
        pump(bucket)
      }
      if (signal && typeof signal.addEventListener === 'function') {
        try { signal.addEventListener('abort', onAbort, { once: true }) } catch {}
        const origResolve = waiter.resolve
        waiter.resolve = function (): void {
          try { if (typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort) } catch {}
          origResolve!()
        }
        const origReject = waiter.reject
        waiter.reject = function (e: unknown): void {
          try { if (typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort) } catch {}
          origReject!(e)
        }
      }
      // #1570：排队计时器住闸里。到点先从队列摘下再拒（没拿到名额就不占名额），
      // 队列因此继续 pump，后面的排队者照常补位 —— 晚到的名额不泄漏。
      if (waitMs > 0) {
        waiter.timer = timers.setTimeout(function (): void {
          if (waiter.settled) return
          waiter.settled = true
          clearQueueTimer(waiter)
          const idx = queues[bucket].indexOf(waiter)
          if (idx >= 0) queues[bucket].splice(idx, 1)
          stats[bucket].timedOut += 1
          waiter.reject!(queueTimeoutError({ bucket: bucket, waitedMs: Date.now() - waitT0, limitMs: waitMs }))
          pump(bucket)
        }, waitMs)
      }
      queues[bucket].push(waiter)
      pump(bucket)
    })
  }

  // 放名额：幂等，多次放只算一次，成功失败都放。
  function releaseOf(bucket: GhBucket): () => void {
    let released = false
    return function release(): void {
      if (released) return
      released = true
      running[bucket] = Math.max(0, running[bucket] - 1)
      stats[bucket].done += 1
      pump(bucket)
    }
  }

  /**
   * 一次 transport 级失败：给同一只桶设（或续）冷却窗口，并把已经排在队里的同桶等待者一并立刻拒掉。
   * 为什么连排队的一起拒：它们等的正是这条不通的路，留它们在队里只会各自再赔满一次分档超时。
   * 排队者没起过进程，按「通路不通」拒，不记取消。
   */
  function reportTransportFailure(failure: { bucket?: string; reason?: string; cmd?: string; service?: string } | null | undefined): void {
    const f = failure || {}
    const bucket: GhBucket = normBucket(f.bucket)
    const service: GhService = normService(f.service)
    const reason = String(f.reason == null ? '' : f.reason).slice(0, 40)
    const cmd = normCmd(f.cmd)
    const key = coolKeyOf(service, bucket)
    const prev = cooldown.get(key)
    const failStreak = (prev ? prev.failStreak : 0) + 1
    cooldown.set(key, { until: Date.now() + cooldownMs, reason: reason, failStreak: failStreak, cmd: cmd, rejectLogged: false })
    logTransport({ decision: 'cooldown-set', bucket: bucket, reason: reason, remainingMs: cooldownMs, failStreak: failStreak, cmd: cmd })
    // 只拒同一只桶、同一条通路上的排队者：别的服务等的是另一条路，不能被这条路的故障一起掀掉。
    const q = queues[bucket]
    const kept: GhWaiter[] = []
    while (q.length > 0) {
      const waiter = q.shift()
      if (!waiter || waiter.settled) continue
      if (waiter.service !== service) { kept.push(waiter); continue }
      waiter.settled = true
      clearQueueTimer(waiter)
      try {
        // 类型说明：排进队时取消函数一定已补上，非空断言只过类型检查。
        waiter.reject!(cooldownError({ bucket: bucket, remainingMs: cooldownMs, reason: reason, failStreak: failStreak }))
      } catch (eR) {}
    }
    for (let i = 0; i < kept.length; i += 1) q.push(kept[i])
    pump(bucket)
  }

  /**
   * 一条命令跑完、拿到了退出码：通路是通的，冷却立刻清零，不必等窗口自己过期。
   * 没有冷却也没有连续失败时什么也不做（不记日志）—— 正常路径一条命令不多出一个事件。
   */
  function reportSuccess(req: { bucket?: string; service?: string } | null | undefined): void {
    const bucket: GhBucket = normBucket(req && req.bucket)
    const service: GhService = normService(req && req.service)
    const key = coolKeyOf(service, bucket)
    const prev = cooldown.get(key)
    if (!prev || (prev.until === 0 && prev.failStreak === 0)) return
    cooldown.set(key, { until: 0, reason: '', failStreak: 0, cmd: '', rejectLogged: false })
    logTransport({ decision: 'cooldown-cleared', bucket: bucket, reason: prev.reason, remainingMs: 0, failStreak: prev.failStreak, cmd: prev.cmd })
  }

  /** 快照：只读统计，调用方看排队与峰值用，不参与准入判断。 */
  function snapshot() {
    return {
      readMax: maxOf.read, writeMax: maxOf.write,
      readInflight: running.read, writeInflight: running.write,
      readQueued: queues.read.length, writeQueued: queues.write.length,
      readPeak: stats.read.peak, writePeak: stats.write.peak,
      readWaited: stats.read.waited, writeWaited: stats.write.waited,
      readDone: stats.read.done, writeDone: stats.write.done,
      readQueueTimedOut: stats.read.timedOut, writeQueueTimedOut: stats.write.timedOut,
      cancelled: stats.cancelled,
    }
  }

  return {
    acquire: acquire,
    reportTransportFailure: reportTransportFailure,
    reportSuccess: reportSuccess,
    snapshot: snapshot,
    limits: function (): { readMax: number; writeMax: number } { return { readMax: maxOf.read, writeMax: maxOf.write } },
  }
}

// 进程内默认的一道准入单例：四条出站路共用同一口径，类型随创建函数走。
let defaultLane: ReturnType<typeof createGhAdmission> | null = null

/** 进程内默认的一道准入：四条出站路（房间 client / runGh 薄封装 / detectionExec / execProc）共用它才叫“同一口径”。 */
export function getGhLane(logCtx?: GhLogCtxLike | null): ReturnType<typeof createGhAdmission> {
  if (logCtx) setGhLaneLogCtx(logCtx)
  if (!defaultLane) defaultLane = createGhAdmission({ readMax: READ_BUCKET_MAX, writeMax: WRITE_BUCKET_MAX })
  return defaultLane
}

/** 测试与特殊场景自建一道（不污染默认单例）。 */
export function resetGhLaneForTest(): void { defaultLane = null }

/**
 * 排队拿名额再跑（#965 共用包装器，给行数到顶的文件用，免得每个调用方各写一遍拿与放）。
 * 满了等（等不是失败）；排队出队（被取消，或传了 waitMs 且等到预算用完）时调 onQueueFailure：
 * 回调拿到的是原始错误，调用方用 isAdmissionCancelled / outboundQueueTimeoutOf 分清是哪一种——
 * 取消按取消返回、排队超时按可重试失败返回，两者不能混成一条回话。
 * 跑完放名额（成功失败都放，抛错也放）。
 * 用法：return withGhLane({ bucket: 'read', signal: opts.signal, waitMs: budget }, async function () { …真起进程… },
 *   function (e) { return outboundQueueTimeoutOf(e) ? RETRY_REPLY : CANCELLED_REPLY })。
 * 类型说明：host 域文件，只做类型标注；失败回调允许缺省（缺省时错误仍会抛，与原来一致）。
 */
export async function withGhLane(laneOpts: GhLaneOpts | null | undefined, run: () => unknown, onQueueFailure?: (e: unknown) => unknown): Promise<unknown> {
  const o: GhLaneOpts = laneOpts || {}
  let release: (() => void) | null = null
  try {
    release = await getGhLane().acquire({ bucket: o.bucket || 'read', signal: o.signal || undefined, service: o.service, waitMs: o.waitMs })
  } catch (e) {
    return onQueueFailure!(e)
  }
  try {
    return await run()
  } finally {
    try { if (release) release() } catch {}
  }
}

export default getGhLane
