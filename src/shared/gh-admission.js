/**
 * shared/gh-admission.js — 外部小命令的传输层准入（#965 · 架子 + 暂定值）。
 *
 * 解决的问题（#960）：以前同时起几十个外部小命令，各自等满 30 秒才放弃，
 * 弱终端上直接把界面拖死。闸（gate.js）只记账不排队，所以这一道设在传输层：
 * 真起进程之前先拿名额，满了就排队等，等不是失败。
 *
 * 用法（三路出站都认这一道才叫同一口径）：
 *   const release = await getGhLane().acquire({ bucket: 读还是写, signal: 调用方传来的取消信号 });
 *   try { 真起进程 } finally { release(); }
 * 排队时调用方取消了，acquire 抛取消错误，调用方按取消返回，不算失败。
 *
 * 读写分桶（#962 定版）：读桶大、写桶小。暂定值读 8 写 2：
 * 报告里的 4 作下限参考，定版的 64 作上限参考，不直接二选一；
 * 终值等 #967 量完耗时与同时在飞分布，由 #966 回填，这里的数字只换值不用改调用处。
 * 只数真起来的进程：排队等待不占名额；取消出队后名额让给后面的人。
 *
 * 纯模块：不读盘、不联网、不起定时器；取消只靠调用方传来的信号，不自己计时。
 * 同层不互引：本文件零引用，宿主三路与房间经跨层引用它，不触发同层门禁。
 */

export const READ_BUCKET_MAX = 8
export const WRITE_BUCKET_MAX = 2

/** 取消错误的标记：调用方靠它区分取消与失败。 */
export const ADMISSION_CANCELLED = 'admission-cancelled'

/** 是不是准入排队时被取消的错误（是取消，不是失败）。 */
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
 * 这组参数是不是写操作（写走小桶）。认不准的一律按读算：
 * 读桶大，误放进读桶只是多占一个读名额；误放进写桶会把读请求卡在只有 2 个名额的小桶里。
 * 暂定启发式，#966 回填终值时可一起收紧，不改调用处。
 */
export function isWriteGhArgs(args) {
  try {
    const a = Array.isArray(args) ? args.map((x) => String(x || '')) : []
    if (a.length === 0) return false
    const head = a[0]
    const second = a[1] || ''
    if (head === 'issue' && ['create', 'edit', 'close', 'reopen', 'comment', 'delete', 'lock', 'unlock', 'pin', 'unpin', 'transfer', 'develop'].indexOf(second) >= 0) return true
    if (head === 'pr' && ['create', 'edit', 'close', 'reopen', 'comment', 'merge', 'ready', 'diff'].indexOf(second) >= 0 && second !== 'diff') return true
    if (head === 'release' && ['create', 'delete', 'upload', 'edit'].indexOf(second) >= 0) return true
    if (head === 'repo' && ['create', 'delete', 'fork', 'rename'].indexOf(second) >= 0) return true
    if (head === 'api') {
      for (let i = 0; i < a.length; i++) {
        if ((a[i] === '--method' || a[i] === '-X') && a[i + 1]) {
          const m = String(a[i + 1]).toUpperCase()
          if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') return true
        }
      }
      return false
    }
    return false
  } catch {
    return false
  }
}

/**
 * 按命令与参数选桶：git 只读本地（版本管理页签第一版零网络），一律读桶；
 * 其余按写启发式分桶。调用方直接拿这个结果去拿名额，四路口径一致。
 */
export function bucketForCommand(cmd, args) {
  try {
    const base = String(cmd || '').split(/[/\\]/).pop()
    if (base === 'git') return 'read'
    return isWriteGhArgs(args) ? 'write' : 'read'
  } catch {
    return 'read'
  }
}

/**
 * 建一道准入。opts: { readMax 读桶几个, writeMax 写桶几个 }，缺省用暂定值。
 * 拿名额：acquire({ bucket: 'read' 或 'write', signal })，拿到后得一个放行函数；
 * 用完必须调放行函数让出名额（调两次只算一次）。排队时 signal 中止就抛取消错误。
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
      if (!waiter || waiter.settled) continue
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
      const waiter = { settled: false, signal: signal, resolve: null, reject: null }
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
      readMax: maxOf.read,
      writeMax: maxOf.write,
      readInflight: running.read,
      writeInflight: running.write,
      readQueued: queues.read.length,
      writeQueued: queues.write.length,
      readPeak: stats.read.peak,
      writePeak: stats.write.peak,
      readWaited: stats.read.waited,
      writeWaited: stats.write.waited,
      readDone: stats.read.done,
      writeDone: stats.write.done,
      cancelled: stats.cancelled,
    }
  }

  function limits() { return { readMax: maxOf.read, writeMax: maxOf.write } }

  return { acquire: acquire, snapshot: snapshot, limits: limits }
}

let defaultLane = null

/** 进程内默认的一道准入：三路出站与版本管理只读路共用它才叫同一口径。 */
export function getGhLane() {
  if (!defaultLane) defaultLane = createGhAdmission({ readMax: READ_BUCKET_MAX, writeMax: WRITE_BUCKET_MAX })
  return defaultLane
}

/** 测试自建一道，不污染默认单例。 */
export function resetGhLaneForTest() { defaultLane = null }

export default getGhLane
