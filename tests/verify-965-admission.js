#!/usr/bin/env node
/**
 * verify-965-admission.js —— 传输层准入架子（#965）的行为门禁。
 *
 * 只看外部行为，不看内部队列数组长什么样：
 * 1. 并发压 N 路，峰值不超过暂定上限（读 8 / 写 2）。
 * 2. 满了就等，调用方看到等待而不是失败（全部成功，等过的人记入等待数）。
 * 3. 取消能出队，被取消的不算失败（取消数加一，成功数不受影响）。
 * 4. 终值可回填（读桶写桶上限可配，#966 执行时换数字不用改调用处）。
 *
 * 用法：node tests/verify-965-admission.js
 * 退出码：0 = 通过；1 = 有违规。
 */
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '\n         → ' + detail))
  if (!ok) failed = true
}

async function main() {
  let mod = null
  try {
    mod = await import(pathToFileURL().href)
  } catch (e) {
    check(false, '准入模块能被测到', String((e && e.message) || e))
    finish()
    return
  }
  const { createGhAdmission, getGhLane, READ_BUCKET_MAX, WRITE_BUCKET_MAX, isAdmissionCancelled, ADMISSION_CANCELLED } = mod

  check(READ_BUCKET_MAX === 24, '读桶上限是 24（#1007 按真机证据放宽：很少排队，同时仍防跑飞）', '实得 ' + String(READ_BUCKET_MAX))
  check(WRITE_BUCKET_MAX === 4, '写桶上限是 4（写仍比读小得多：写不许重复发）', '实得 ' + String(WRITE_BUCKET_MAX))

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

  // 5. 接线：真起进程的四处共用同一道（房间纪律走白名单目录；一次请求只占一个名额）。
  {
    const fs = require('fs')
    const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
    const repoKeys = read('src/host/repoKeys.js')
    const plat = read('src/host/platformChannel.js')
    const vc = read('src/host/versionControl.js')
    const room = read('src/host/tracker/backends/github/client.js')
    check(repoKeys.includes('getGhLane') && repoKeys.includes('shared/tracker/outbound-admission.js'), '取数层 runGh/execProc 走同一道准入')
    check(plat.includes('getGhLane') && plat.includes('shared/tracker/outbound-admission.js'), '探测通道 detectionExec 走同一道准入')
    check((vc.includes('getGhLane') || vc.includes('withGhLane')) && vc.includes('shared/tracker/outbound-admission.js'), '版本管理 runGit 走同一道准入（只读路同口径，包装器拿与放）')
    // 房间执行器是宿主直调（不经过下游两条路），房间必须自己拿一次名额；白名单目录引用合规，一次请求只占一个名额。
    check(room.includes('shared/tracker/outbound-admission.js'), '房间经白名单目录拿同一道名额（宿主直调，下游盖不住，不过双）')
    // 取数层 runGh/execProc 现不接取消信号（调用方无信号可传，无信号的排队只会等不会抛），取消语义由带信号的两路承担。
    check(room.includes('cancelled') && plat.includes('cancelled') && vc.includes('cancelled'), '带信号的三处把取消按取消返回（被取消的不算失败）')
  }

  // 6. 全进程共用同一道计数（三路出站同一口径的前提）。
  {
    const a = getGhLane()
    const b = getGhLane()
    check(a === b, '默认单例是同一道（三次拿是同一个对象）')
    const limits = a.limits()
    check(limits.readMax === 24 && limits.writeMax === 4, '默认单例用现行上限（读 24 写 4）')
  }

  finish()
}

function pathToFileURL() {
  const { pathToFileURL: f } = require('url')
  return f(path.join(ROOT, 'src', 'shared', 'tracker', 'outbound-admission.js'))
}

function finish() {
  console.log('\n== verify-965-admission：' + (failed ? '未通过' : '通过') + '（' + total + ' 项断言） ==')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + String((e && e.stack) || e)); process.exit(1) })
