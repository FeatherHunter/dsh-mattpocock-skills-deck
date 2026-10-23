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
 */

import { TUNING } from '../../refresh/contract/tuning-parameters.js'

// 取值住共用调参表（真源 src/refresh/contract/tuning-parameters.ts），这里只留缺表回落的缺省值（与今天一致）。
export const READ_BUCKET_MAX = TUNING.readBucketMax ?? 64
export const WRITE_BUCKET_MAX = TUNING.writeBucketMax ?? 16

// #1101：排队放行时「等了很久」的常驻轨迹门槛与节流间隔。
//   为什么要有：调试开关默认关着，2026-10-21 那种「64 个名额全满、队尾排到 338 位、等 15 秒」的风暴
//   在普通用户的日志里一行都不留 —— 事后只能看到一串耗时十几秒的 gh.exec，分不出慢在命令还是慢在门口。
//   为什么要节流：风暴期间每秒都有放行，逐条记一天就是几十万行的垃圾；同桶五分钟最多一行足够定性。
const LANE_LONG_WAIT_MS = 3000
const LANE_WAIT_LOG_INTERVAL_MS = 5 * 60 * 1000

// 准入桶：读与写两只桶，配额与统计都按桶隔离，跨桶不抢名额。
type GhBucket = 'read' | 'write'
// 排队等待者的形状：创建时放行与取消函数先空着，随后立即补上真正的函数。
interface GhWaiter {
  settled: boolean
  signal: AbortSignal | null
  resolve: (() => void) | null
  reject: ((e: unknown) => void) | null
  bucket: GhBucket
}
// 准入选项与拿名额参数的形状：调用方没给就用缺省桶与缺省配额。
interface GhAdmissionOpts {
  readMax?: number
  writeMax?: number
}
interface GhAcquireArgs {
  bucket?: string
  signal?: AbortSignal | null
}
interface GhLaneOpts {
  bucket?: string
  signal?: AbortSignal | null | undefined
}
// 取消错误的形状：标准 Error 上加两个标记，调用方靠它们认出取消而非失败。
type AdmissionCancelledError = Error & { code: string; admissionCancelled: boolean }
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

function cancelledError(): AdmissionCancelledError {
  // 类型说明：标准 Error 上加两个取消标记，断言不改变运行时对象。
  const e = new Error('gh admission: cancelled while queued') as AdmissionCancelledError
  e.code = ADMISSION_CANCELLED
  e.admissionCancelled = true
  return e
}

/**
 * 建一道准入。opts: { readMax, writeMax }。
 * 用法：const release = await lane.acquire({ bucket: 'read'|'write', signal }); try { … } finally { release() }。
 * 排队期间 signal 中止 → acquire 抛取消错误（不占名额、不记失败，调用方按取消返回）。
 * 类型说明：host 域文件，只做类型标注，不动逻辑不动结构；选项与参数缺省都按读桶处理。
 */
export function createGhAdmission(opts: GhAdmissionOpts | null | undefined) {
  const o: GhAdmissionOpts = opts || {}
  const maxOf: Record<GhBucket, number> = {
    read: (typeof o.readMax === 'number' && o.readMax > 0) ? Math.floor(o.readMax) : READ_BUCKET_MAX,
    write: (typeof o.writeMax === 'number' && o.writeMax > 0) ? Math.floor(o.writeMax) : WRITE_BUCKET_MAX,
  }
  const running: Record<GhBucket, number> = { read: 0, write: 0 }
  const queues: Record<GhBucket, GhWaiter[]> = { read: [], write: [] }
  const stats = {
    read: { peak: 0, waited: 0, done: 0 },
    write: { peak: 0, waited: 0, done: 0 },
    cancelled: 0,
  }
  // 两只桶各记「上一次因长等待落行」的钟点，用来做五分钟节流；0 表示还没记过。
  const lastWaitLogAt: Record<GhBucket, number> = { read: 0, write: 0 }

  // 桶名归一：不是写桶一律按读桶算，调用方传错也不炸。
  function normBucket(b: unknown): GhBucket { return b === 'write' ? 'write' : 'read' }

  // 泵：有空名额就放行队首；已 settle 或已中止的只记取消不占名额。
  function pump(bucket: GhBucket): void {
    const q = queues[bucket]
    while (q.length > 0 && running[bucket] < maxOf[bucket]) {
      // 类型说明：循环守了长度，断言队首一定在，运行时还是原来那个元素。
      const waiter = q.shift() as GhWaiter
      if (waiter.settled) continue
      if (waiter.signal && waiter.signal.aborted === true) {
        waiter.settled = true
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

  // 拿名额：有空位直接给，没空位排队；排队期间取消按取消返回。
  function acquire(arg: GhAcquireArgs | null | undefined): Promise<() => void> {
    const a: GhAcquireArgs = arg || {}
    const bucket: GhBucket = normBucket(a.bucket)
    const signal: AbortSignal | null = a.signal || null
    if (signal && signal.aborted === true) return Promise.reject(cancelledError())
    if (running[bucket] < maxOf[bucket]) {
      running[bucket] += 1
      if (running[bucket] > stats[bucket].peak) stats[bucket].peak = running[bucket]
      return Promise.resolve(releaseOf(bucket))
    }
    stats[bucket].waited += 1
    // #960 复核：排上队的那一刻记下钟点，放行时把「等了多久、等候期间这只桶里还有谁」落一行按需日志。
    //   为什么要有：票面问的是「准入这道门到底有没有把人憋死」，只看 gh.exec 的耗时分不清「命令慢」与「排队慢」。
    const waitT0 = Date.now()
    // 类型说明：Promise 泛型只定放行函数的形状，运行时仍是原来那只 Promise。
    return new Promise<() => void>(function (resolve, reject) {
      // 类型说明：放行与取消函数先空着，随后立即补上，空只存在这两行之间。
      const waiter: GhWaiter = { settled: false, signal: signal, resolve: null, reject: null, bucket: bucket }
      waiter.resolve = function (): void {
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
          if (laneLogCtx && typeof laneLogCtx.fire === 'function' && waitedMs >= LANE_LONG_WAIT_MS && now - lastWaitLogAt[bucket] >= LANE_WAIT_LOG_INTERVAL_MS) {
            lastWaitLogAt[bucket] = now
            laneLogCtx.fire('info', 'gh.lane.wait', { bucket: bucket, waitedMs: waitedMs, inflight: running[bucket], max: maxOf[bucket], queued: queues[bucket].length })
          }
        } catch (eL) {}
        resolve(releaseOf(bucket))
      }
      waiter.reject = function (e: unknown): void { reject(e) }
      const onAbort = function (): void {
        if (waiter.settled) return
        waiter.settled = true
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

  /** 快照：只读统计，调用方看排队与峰值用，不参与准入判断。 */
  function snapshot() {
    return {
      readMax: maxOf.read, writeMax: maxOf.write,
      readInflight: running.read, writeInflight: running.write,
      readQueued: queues.read.length, writeQueued: queues.write.length,
      readPeak: stats.read.peak, writePeak: stats.write.peak,
      readWaited: stats.read.waited, writeWaited: stats.write.waited,
      readDone: stats.read.done, writeDone: stats.write.done,
      cancelled: stats.cancelled,
    }
  }

  return { acquire: acquire, snapshot: snapshot, limits: function (): { readMax: number; writeMax: number } { return { readMax: maxOf.read, writeMax: maxOf.write } } }
}

// 进程内默认的一道准入单例：三条出站路共用同一口径，类型随创建函数走。
let defaultLane: ReturnType<typeof createGhAdmission> | null = null

/** 进程内默认的一道准入：三个出站路（room client / detectionExec / runGh）共用它才叫“同一口径”。 */
export function getGhLane(logCtx?: GhLogCtxLike | null): ReturnType<typeof createGhAdmission> {
  if (logCtx) setGhLaneLogCtx(logCtx)
  if (!defaultLane) defaultLane = createGhAdmission({ readMax: READ_BUCKET_MAX, writeMax: WRITE_BUCKET_MAX })
  return defaultLane
}

/** 测试与特殊场景自建一道（不污染默认单例）。 */
export function resetGhLaneForTest(): void { defaultLane = null }

/**
 * 排队拿名额再跑（#965 共用包装器，给行数到顶的文件用，免得每个调用方各写一遍拿与放）。
 * 满了等（等不是失败）；排队被取消调 onQueuedCancel；跑完放名额（成功失败都放，抛错也放）。
 * 用法：return withGhLane({ bucket: 'read', signal: opts.signal }, async function () { …真起进程… },
 *   function () { return { kind: 'cancelled', cancelled: true } })。
 * 类型说明：host 域文件，只做类型标注；取消回调允许缺省（缺省时取消仍会抛，与原来一致）。
 */
export async function withGhLane(laneOpts: GhLaneOpts | null | undefined, run: () => unknown, onQueuedCancel?: (e: unknown) => unknown): Promise<unknown> {
  const o: GhLaneOpts = laneOpts || {}
  let release: (() => void) | null = null
  try {
    release = await getGhLane().acquire({ bucket: o.bucket || 'read', signal: o.signal || undefined })
  } catch (e) {
    return onQueuedCancel!(e)
  }
  try {
    return await run()
  } finally {
    try { if (release) release() } catch {}
  }
}

export default getGhLane
