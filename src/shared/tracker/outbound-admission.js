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
 * （读 12 秒 / 写 30 秒 / 探活 3 秒，含排队段，见 backends/github/client.js）。
 * 终值仍以测量回填（#967 测量 / #966 收口）为准。
 */

export const READ_BUCKET_MAX = 64
export const WRITE_BUCKET_MAX = 16

/** 取消错误的标记：调用方据此返回“取消”而非“失败”。 */
export const ADMISSION_CANCELLED = 'admission-cancelled'

export function isAdmissionCancelled(err) {
  return !!(err && (err.code === ADMISSION_CANCELLED || err.admissionCancelled === true))
}

function cancelledError() {
  const e = new Error('gh admission: cancelled while queued')
  e.code = ADMISSION_CANCELLED
  e.admissionCancelled = true
  return e
}

/**
 * 建一道准入。opts: { readMax, writeMax }。
 * 用法：const release = await lane.acquire({ bucket: 'read'|'write', signal }); try { … } finally { release() }。
 * 排队期间 signal 中止 → acquire 抛取消错误（不占名额、不记失败，调用方按取消返回）。
 */
export function createGhAdmission(opts) {
  const o = opts || {}
  const maxOf = {
    read: (typeof o.readMax === 'number' && o.readMax > 0) ? Math.floor(o.readMax) : READ_BUCKET_MAX,
    write: (typeof o.writeMax === 'number' && o.writeMax > 0) ? Math.floor(o.writeMax) : WRITE_BUCKET_MAX,
  }
  const running = { read: 0, write: 0 }
  const queues = { read: [], write: [] }
  const stats = {
    read: { peak: 0, waited: 0, done: 0 },
    write: { peak: 0, waited: 0, done: 0 },
    cancelled: 0,
  }

  function normBucket(b) { return b === 'write' ? 'write' : 'read' }

  function pump(bucket) {
    const q = queues[bucket]
    while (q.length > 0 && running[bucket] < maxOf[bucket]) {
      const waiter = q.shift()
      if (waiter.settled) continue
      if (waiter.signal && waiter.signal.aborted === true) {
        waiter.settled = true
        stats.cancelled += 1
        waiter.reject(cancelledError())
        continue
      }
      running[bucket] += 1
      if (running[bucket] > stats[bucket].peak) stats[bucket].peak = running[bucket]
      waiter.settled = true
      waiter.resolve()
    }
  }

  function acquire(arg) {
    const a = arg || {}
    const bucket = normBucket(a.bucket)
    const signal = a.signal || null
    if (signal && signal.aborted === true) return Promise.reject(cancelledError())
    if (running[bucket] < maxOf[bucket]) {
      running[bucket] += 1
      if (running[bucket] > stats[bucket].peak) stats[bucket].peak = running[bucket]
      return Promise.resolve(releaseOf(bucket))
    }
    stats[bucket].waited += 1
    return new Promise(function (resolve, reject) {
      const waiter = { settled: false, signal: signal, resolve: null, reject: null, bucket: bucket }
      waiter.resolve = function () { resolve(releaseOf(bucket)) }
      waiter.reject = function (e) { reject(e) }
      const onAbort = function () {
        if (waiter.settled) return
        waiter.settled = true
        const idx = queues[bucket].indexOf(waiter)
        if (idx >= 0) queues[bucket].splice(idx, 1)
        stats.cancelled += 1
        waiter.reject(cancelledError())
        pump(bucket)
      }
      if (signal && typeof signal.addEventListener === 'function') {
        try { signal.addEventListener('abort', onAbort, { once: true }) } catch {}
        const origResolve = waiter.resolve
        waiter.resolve = function () {
          try { if (typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort) } catch {}
          origResolve()
        }
        const origReject = waiter.reject
        waiter.reject = function (e) {
          try { if (typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort) } catch {}
          origReject(e)
        }
      }
      queues[bucket].push(waiter)
      pump(bucket)
    })
  }

  function releaseOf(bucket) {
    let released = false
    return function release() {
      if (released) return
      released = true
      running[bucket] = Math.max(0, running[bucket] - 1)
      stats[bucket].done += 1
      pump(bucket)
    }
  }

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

  return { acquire: acquire, snapshot: snapshot, limits: function () { return { readMax: maxOf.read, writeMax: maxOf.write } } }
}

let defaultLane = null

/** 进程内默认的一道准入：三个出站路（room client / detectionExec / runGh）共用它才叫“同一口径”。 */
export function getGhLane() {
  if (!defaultLane) defaultLane = createGhAdmission({ readMax: READ_BUCKET_MAX, writeMax: WRITE_BUCKET_MAX })
  return defaultLane
}

/** 测试与特殊场景自建一道（不污染默认单例）。 */
export function resetGhLaneForTest() { defaultLane = null }

/**
 * 排队拿名额再跑（#965 共用包装器，给行数到顶的文件用，免得每个调用方各写一遍拿与放）。
 * 满了等（等不是失败）；排队被取消调 onQueuedCancel；跑完放名额（成功失败都放，抛错也放）。
 * 用法：return withGhLane({ bucket: 'read', signal: opts.signal }, async function () { …真起进程… },
 *   function () { return { kind: 'cancelled', cancelled: true } })。
 */
export async function withGhLane(laneOpts, run, onQueuedCancel) {
  const o = laneOpts || {}
  let release = null
  try {
    release = await getGhLane().acquire({ bucket: o.bucket || 'read', signal: o.signal || undefined })
  } catch (e) {
    return onQueuedCancel(e)
  }
  try {
    return await run()
  } finally {
    try { if (release) release() } catch {}
  }
}

export default getGhLane
