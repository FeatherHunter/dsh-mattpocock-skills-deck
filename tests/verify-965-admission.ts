#!/usr/bin/env node
/**
 * verify-965-admission.ts —— 传输层准入架子（#965）的行为门禁。
 *
 * 2026-10-17 从 .js 转成 TypeScript：只改文件名、用法这行与几处类型标注，判据与断言一条没动。
 *
 * 只看外部行为，不看内部队列数组长什么样：
 * 1. 并发压 N 路，峰值不超过暂定上限（读 8 / 写 2）。
 * 2. 满了就等，调用方看到等待而不是失败（全部成功，等过的人记入等待数）。
 * 3. 取消能出队，被取消的不算失败（取消数加一，成功数不受影响）。
 * 4. 终值可回填（读桶写桶上限可配，#966 执行时换数字不用改调用处）。
 * 5. 全进程共用同一道默认单例（三次拿是同一个对象，上限一致）。
 * 6. 排队最多等多久由闸自己管（#1570）：给 waitMs 才起表，到点抛可辨认「排队超时」并带走时辰；
 *    到点的那一笔没有拿过名额，名额不泄漏；取消仍按取消返回、与到点分得开；缺省不给预算时维持不设上限。
 *
 * 原来那组「读宿主源码文本、断言 getGhLane / outbound-admission 字样出现过」的接线检查
 * 已删：断言对象是手写源码文件的文本，等价重构（换写法、搬文件、改注释）就会误报。
 *
 * 用法：node --import ./scripts/ts-hook.mts tests/verify-965-admission.ts
 * 退出码：0 = 通过；1 = 有违规。
 */
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: unknown) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '\n         → ' + detail))
  if (!ok) failed = true
}

async function main() {
  let mod: Record<string, any> | null = null
  try {
    mod = await import(pathToFileURL().href)
  } catch (e: any) {
    check(false, '准入模块能被测到', String((e && e.message) || e))
    finish()
    return
  }
  const { createGhAdmission, getGhLane, READ_BUCKET_MAX, WRITE_BUCKET_MAX, isAdmissionCancelled, isAdmissionQueueTimeout, ADMISSION_CANCELLED } = mod!

  check(READ_BUCKET_MAX === 64, '读桶上限 64（保险丝：远高于实测峰值 12，正常永不介入）', '实得 ' + String(READ_BUCKET_MAX))
  check(WRITE_BUCKET_MAX === 16, '写桶上限 16（写需求远小于读，仍留一道远高于需求的保险丝）', '实得 ' + String(WRITE_BUCKET_MAX))

  // 1. 并发压 16 路读，峰值不超过读上限，且全部成功（等不是失败）。
  {
    const lane = createGhAdmission({ readMax: 4, writeMax: 1 })
    let peak = 0
    let live = 0
    const jobs = []
    for (let i = 0; i < 16; i++) {
      jobs.push((async () => {
        const release = await lane.acquire({ bucket: 'read' })
        live += 1
        if (live > peak) peak = live
        await new Promise((r) => setTimeout(r, 10))
        live -= 1
        release()
        return true
      })())
    }
    const results = await Promise.all(jobs)
    const snap = lane.snapshot()
    check(peak <= 4, '并发 16 路读，峰值不超过上限 4（实得峰值 ' + peak + '）')
    check(results.every((v) => v === true), '满了就等：16 路全部成功，没有一路因满而失败')
    check(snap.readWaited > 0, '等过的人被记下来（等待数 ' + snap.readWaited + '，不是失败数）')
  }

  // 2. 读写分桶：读桶满了，写桶还能进。
  {
    const lane = createGhAdmission({ readMax: 1, writeMax: 1 })
    const releaseRead = await lane.acquire({ bucket: 'read' })
    let writeGot = false
    const w = lane.acquire({ bucket: 'write' }).then((r) => { writeGot = true; return r })
    const releaseWrite = await w
    check(writeGot === true, '读桶满了不挡写桶（写请求照样拿到名额）')
    releaseRead()
    releaseWrite()
  }

  // 3. 取消能出队，被取消的不算失败。
  {
    const lane = createGhAdmission({ readMax: 1, writeMax: 1 })
    const releaseFirst = await lane.acquire({ bucket: 'read' })
    const ctl = new AbortController()
    let cancelledSeen = false
    const queued = lane.acquire({ bucket: 'read', signal: ctl.signal }).then(
      () => ({ ok: true }),
      (e) => { cancelledSeen = isAdmissionCancelled(e); return { ok: false, cancelled: cancelledSeen } }
    )
    const ctl2 = new AbortController()
    const queued2 = lane.acquire({ bucket: 'read', signal: ctl2.signal }).then(
      (release) => ({ ok: true, release }),
      () => ({ ok: false })
    )
    ctl.abort()
    const r1 = await queued
    check(r1.ok === false && r1.cancelled === true, '排队中被取消：调用方看到取消而不是失败')
    // 取消标记是契约：排队取消的错误带着 ADMISSION_CANCELLED 码，调用方靠它区分取消与失败。
    const ctl3 = new AbortController()
    const lane3 = createGhAdmission({ readMax: 1, writeMax: 1 })
    const hold3 = await lane3.acquire({ bucket: 'read' })
    const q3 = lane3.acquire({ bucket: 'read', signal: ctl3.signal }).then(() => null, (e) => e)
    ctl3.abort()
    const e3 = await q3
    check(e3 && e3.code === ADMISSION_CANCELLED, '取消错误的码是 ADMISSION_CANCELLED（实得 ' + String(e3 && e3.code) + '）')
    hold3()
    const snapMid = lane.snapshot()
    check(snapMid.cancelled === 1, '被取消的记入取消数（实得 ' + snapMid.cancelled + '），不记入失败')
    releaseFirst()
    const r2 = await queued2
    check(r2.ok === true, '取消出队后，后面排队的人能补上空位')
    if (r2.ok) r2.release()
  }

  // 4. 终值可回填：换数字不用改调用处（#966 执行）。
  {
    const lane = createGhAdmission({ readMax: 3, writeMax: 5 })
    const limits = lane.limits()
    check(limits.readMax === 3 && limits.writeMax === 5, '读写上限可配（实得读 ' + limits.readMax + ' 写 ' + limits.writeMax + '），终值回填只换数字')
  }

  // 5. 全进程共用同一道计数（三路出站同一口径的前提）。
  {
    const a = getGhLane()
    const b = getGhLane()
    check(a === b, '默认单例是同一道（三次拿是同一个对象）')
    const limits = a.limits()
    check(limits.readMax === 64 && limits.writeMax === 16, '默认单例用现行上限（读 64 写 16）')
  }

  // 6. 排队最多等多久（#1570）：到点由闸抛「排队超时」、名额不泄漏、取消与到点分得开。
  {
    const { outboundQueueTimeoutOf } = await import(pathToFileURLOf('src/tracker/kernel/outbound-tiers.ts'))
    // 可手动触发的表：不睡真实时间，到点时刻由测试自己点。
    const pending: any[] = []
    const timers = {
      setTimeout: (fn: () => void, ms: number) => { const h: any = { fn: fn, ms: ms, cleared: false }; pending.push(h); return h },
      clearTimeout: (h: any) => { if (h) h.cleared = true },
    }
    const lane = createGhAdmission({ readMax: 1, writeMax: 1, timers: timers })
    const releaseHeld = await lane.acquire({ bucket: 'read' })
    let queueErr: any = null
    const queued = lane.acquire({ bucket: 'read', waitMs: 40 }).then(() => 'got', (e) => { queueErr = e; return 'rejected' })
    check(pending.length === 1 && pending[0].ms === 40, '排队到点：闸按「最多等多久」起表（实得 ' + JSON.stringify(pending.map((h) => h.ms)) + '）')
    pending[0].fn()
    const outcome = await queued
    check(outcome === 'rejected' && isAdmissionQueueTimeout(queueErr), '排队到点：闸抛可辨认的「排队超时」（码 ' + String(queueErr && queueErr.code) + '）')
    const info = outboundQueueTimeoutOf(queueErr)
    check(!!info && info.bucket === 'read' && info.limitMs === 40 && typeof info.waitedMs === 'number', '排队超时错误带桶、预算与已等毫秒（' + JSON.stringify(info) + '）')
    check(!isAdmissionCancelled(queueErr), '排队到点不是「取消」：两者调用方分得开')
    // 没拿到名额就不算占用：放掉占位，下一笔立刻能进，说明名额没被到点的人带走。
    releaseHeld()
    const gotAfter: any = await Promise.race([lane.acquire({ bucket: 'read' }), new Promise((res) => setTimeout(() => res('stuck'), 1000))])
    check(typeof gotAfter === 'function', '排队到点后名额不泄漏（放掉占位，下一笔立刻拿到）')
    if (typeof gotAfter === 'function') gotAfter()
    const snapQ = lane.snapshot()
    check(snapQ.readQueueTimedOut === 1 && snapQ.readQueued === 0, '到点单独计数且队列已清空（到点 ' + snapQ.readQueueTimedOut + '，仍在排 ' + snapQ.readQueued + '）')

    // 取消仍按取消返回：不算到点、不增加到点计数，那只表被撤掉。
    const releaseHeld2 = await lane.acquire({ bucket: 'read' })
    const ctl = new AbortController()
    let cancelErr: any = null
    const queued2 = lane.acquire({ bucket: 'read', waitMs: 500, signal: ctl.signal }).then(() => 'got', (e) => { cancelErr = e; return 'rejected' })
    const timedOutBefore = lane.snapshot().readQueueTimedOut
    ctl.abort()
    const outcome2 = await queued2
    check(outcome2 === 'rejected' && isAdmissionCancelled(cancelErr) && outboundQueueTimeoutOf(cancelErr) === null, '取消与排队到点分得开：取消按取消返回')
    const cancelTimer = pending[pending.length - 1]
    check(!!cancelTimer && cancelTimer.cleared === true, '取消后排队那只表被撤掉（不会稍后误触发）')
    if (cancelTimer) cancelTimer.fn()
    check(lane.snapshot().readQueueTimedOut === timedOutBefore, '取消不会增加「排队到点」计数')
    releaseHeld2()

    // 「到点的人身后还有人在等」：到点者挪出队列后，晚到的名额要落到身后那个人的手里，不能漏掉。
    const releaseHeld3 = await lane.acquire({ bucket: 'read' })
    let followerGot: any = null
    const follower = lane.acquire({ bucket: 'read' }).then((rel: any) => { followerGot = rel; return rel })
    let secondTimedOut: any = null
    const secondQueued = lane.acquire({ bucket: 'read', waitMs: 40 }).then(() => 'got', (e) => { secondTimedOut = e; return 'rejected' })
    const secondTimer = pending[pending.length - 1]
    check(!!secondTimer && secondTimer.ms === 40, '排队到点：两只排队里只有给了预算的那只建表（实得 ' + JSON.stringify(pending.slice(-1).map((h) => h.ms)) + '）')
    secondTimer.fn()
    const secondOutcome = await secondQueued
    const followerStillQueued = followerGot === null
    check(secondOutcome === 'rejected' && isAdmissionQueueTimeout(secondTimedOut), '排队到点：到点者被挪出队列并拿到可辨认错误')
    check(followerStillQueued, '排队到点：到点者身后的人没被误伤，仍在排队')
    releaseHeld3()
    const followerRel: any = await Promise.race([follower, new Promise((res) => setTimeout(() => res('stuck'), 1000))])
    check(typeof followerRel === 'function', '迟到名额由身后排队的人接住（名额没有漏掉）')
    if (typeof followerRel === 'function') followerRel()
    const snapAfterFollower = lane.snapshot()
    check(snapAfterFollower.readQueueTimedOut === 2 && snapAfterFollower.readQueued === 0, '到点两次各记一次，队列清空（到点 ' + snapAfterFollower.readQueueTimedOut + '，仍在排 ' + snapAfterFollower.readQueued + '）')

    // 缺省不给预算：维持不设上限，排队只等名额回来。
    const lane2 = createGhAdmission({ readMax: 1, writeMax: 1, timers: timers })
    const hold2 = await lane2.acquire({ bucket: 'read' })
    const pendingBefore = pending.length
    const waitOnly = lane2.acquire({ bucket: 'read' }).then(() => 'ok')
    check(pending.length === pendingBefore, '缺省不给预算时不设上限（排队不建表）')
    hold2()
    const gotWait = await Promise.race([waitOnly, new Promise((res) => setTimeout(() => res('stuck'), 1000))])
    check(gotWait === 'ok', '不设上限的排队在名额回来时照常放行')
  }

  finish()
}

function pathToFileURLOf(rel: string) {
  const { pathToFileURL: f } = require('url')
  return f(path.join(ROOT, rel)).href
}

function pathToFileURL() {
  const { pathToFileURL: f } = require('url')
  return f(path.join(ROOT, 'src', 'refresh', 'rooms', 'host', 'outbound-admission.ts'))
}

function finish() {
  console.log('\n== verify-965-admission：' + (failed ? '未通过' : '通过') + '（' + total + ' 项断言） ==')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + String((e && e.stack) || e)); process.exit(1) })
