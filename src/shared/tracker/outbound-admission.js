/**
 * shared/gh-admission.js — gh 出站传输层准入（#965 · T2a · 架子 + 暂定值）。
 *
 * 解决的问题（#960）：gh 唯一出口没有同时在飞上限，弱终端上几十路并发各等满
 * 30 秒，系统被拖死。闸（gate.js）只记账不排队，所以这一道设在传输层：
 * 真起进程之前先拿名额，满了就排队等——等不是失败。
 *
 * 读写分桶（#962 定版）：读桶大、写桶小。暂定值读 8 / 写 2（报告人补丁 4 作下限参考、
 * 定版 64 作上限参考，不直接二选一；终值等 #967 测量回填，#966 执行）。
 * 只数真起来的进程：排队等待不占名额；取消（排队中被杀）直接出队，不算失败。
 *
 * 纯模块：不读盘、不联网；定时器只用于无信号时的默认永不超时等待（调用方传 signal 即可取消）。
 * 单进程单例由 getGhLane 提供（三个出站路同进程共享同一道计数）；测试用 createGhAdmission 自建。
 */

export const READ_BUCKET_MAX = 8
export const WRITE_BUCKET_MAX = 2

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
