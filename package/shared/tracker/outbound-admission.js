/**
 * 同时在飞的 gh 进程上限（读桶大、写桶小）。#962 定版时是暂定值读 8 / 写 2，
 * 2026-10-10 按真机证据放宽到读 24 / 写 4（#1007）。
 *
 * 为什么放宽，说清它到底防什么：这道护栏防的不是 GitHub —— GitHub 的约束是配额
 * （每小时 5000 次请求），gh 每条调用都是独立进程，本身没有并发上限；我们自己的闸
 * 也已经按预算限了"每小时花多少"。它防的是**本机**：一次真出站就是一个 gh 进程
 * （几十 MB），几十路并发各等满 30 秒会把弱终端拖死（#960 那次投诉）。
 *
 * 读 8 / 写 2 为什么不够：真机日志里 417 条调用摊在 52 分钟（约 8 次/分钟），正常
 * 根本挤不满;挤满的原因是**慢调用占着名额**——一条调用能占到 30 秒才被掐，8 个名额
 * 全被占住时，后来的调用只能排队，而排队段过去没有上限（到外层的 30 秒钳制才结束），
 * 于是整片工具看起来都调不动。现在的两道一起用：名额放宽到很少排队，加上房内自己
 * 掐表（读 12 秒 / 写 30 秒 / 探活 3 秒，含排队段）让名额最多被占本档那么久。
 * 终值仍以测量回填（#967 测量 / #966 收口）为准，这里的数字只影响"什么时候开始排队"。
 */

export const READ_BUCKET_MAX = 24
export const WRITE_BUCKET_MAX = 4

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
