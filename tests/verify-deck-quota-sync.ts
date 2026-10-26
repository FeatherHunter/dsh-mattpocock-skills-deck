// tests/verify-deck-quota-sync.ts —— 门禁：剩余额读数经 Tracker 会话同步（#758 建，#1443 改道，#1006 后台化）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-deck-quota-sync.ts，可独立运行。
//
// 为什么改道：从前桥里自己拼 gate.send + runGh 打免费的 gh api rate_limit —— 那是绕开会话的旧直调。
// #1443 起同步只调经 Tracker 会话的 readBudget（房间自己读 gh），桥里不再有 runGh、gate.send、noteRateLimited。
// #1006 起本门禁盯住票面五条期望与六条验收：
//   · 冷却锚是「下次允许尝试的时刻」，失败越久等越久、有封顶、成功后立刻清零；
//   · 冷却按工作区分开存，一个工作区不影响另一个；
//   · 同一时刻只放一笔读数（全局单飞）；
//   · 关键路径不再等读数：差读数就放后台，当次回 pending；
//   · 落账带「取数开始时刻」，慢请求迟到不许盖新读数；
//   · 失败按硬/软两档退避（没装 gh / 没登录等得久，超时 / 网络 / 解析等得短）；
//   · 后台落定后经 onSettled 把结论交给界面；不新增日志事件（只走既有 host.call）。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

// 会话 readBudget 的成功回执长这样（房间装进成功信封的两桶读数）。
function twoBuckets(restRemaining, gqlRemaining) {
  return { ok: true, data: { known: true, kind: 'two-buckets', buckets: { rest: { remaining: restRemaining, limit: 5000 }, graphql: { remaining: gqlRemaining, limit: 5000 } } } }
}
// 读数未知（房间说量不出来），reason 三档之一。
function unknownReading(reason) {
  return { ok: true, data: { known: false, reason: reason || 'unavailable' } }
}
// 会话回失败信封（开会话失败、起进程失败等）：reason 之外还有 error.kind。
function failedEnvelope(kind) {
  return { ok: false, error: { kind: kind, message: '会话那一层失败' } }
}
// 失败与未知的原因只许是这五个（没有工作区失败计数那一格，同步失败只退避）。
function reasonKnown(reason) { return ['missing-dep', 'sync-cooldown', 'sync-empty', 'sync-threw', 'ensure-threw'].indexOf(reason) >= 0 }
// 假时钟：冷却与退避是时间判定，门禁必须能把时间拨快，不许依赖真时间（否则必抖）。
function makeClock(start) {
  let now = start || 1700000000000
  return { now: function () { return now }, advance: function (ms) { now += ms; return now }, at: function () { return now } }
}
function fakeLog() {
  const fired = []
  return { fired: fired, ctx: { fire: function (level, event, fields) { fired.push({ level: level, event: event, fields: fields }) } } }
}
// 一个最小的桥：读一次、落账口空实现、假时钟；具体行为由 reading 决定。
function makeSync(reading, extra) {
  const deps = Object.assign({
    syncDue: function () { return true },
    syncServer: function () {},
    readBudget: async function () { return reading },
    onSettled: function () {},
  }, extra || {})
  return { deps: deps, mod: null }
}

async function main() {
  console.log('剩余额读数同步门禁（#1443 经会话 readBudget；#1006 后台化、按工作区退避）')
  let mod = null
  try { mod = await imp('src/refresh/registry/quota-sync-bridge.ts') } catch (e) {
    check(false, '接线模块可加载：' + String((e && e.message) || e))
    console.log('\n' + total + ' 条断言，失败'); process.exit(1)
  }
  check(mod && typeof mod.createDeckQuotaSync === 'function', '交出 createDeckQuotaSync（工厂）')

  // —— 1. 不差不打 ——
  let reads1 = 0
  const idle = mod.createDeckQuotaSync({ syncDue: function () { return false }, syncServer: function () { throw new Error('不该落账') }, readBudget: async function () { reads1 += 1; return twoBuckets(1, 1) } })
  const idleOut = await idle.ensureReading('/ws', 'ws-1')
  check(idleOut && idleOut.ok === true && idleOut.fresh === false && idleOut.pending !== true && reads1 === 0, '账本说不差：直接过，一次读数都不调，也不起后台任务')

  // —— 2. 差就读一次、读数落账、带取数开始时刻（#1006 验收④⑤） ——
  const clock2 = makeClock()
  const log2 = fakeLog()
  let reads2 = 0
  let cells2 = null
  let cellsAt2 = null
  let readCwd2 = ''
  const start2 = clock2.now()
  const live = mod.createDeckQuotaSync({
    syncDue: function () { return true },
    syncServer: function (readings, at) { cells2 = readings; cellsAt2 = at },
    readBudget: async function (cwd) { reads2 += 1; readCwd2 = String(cwd); clock2.advance(5000); return twoBuckets(4321, 4300) },
    logCtx: log2.ctx,
    now: clock2.now,
  })
  const liveOut = await live.ensureReading('/ws', 'ws-abc')
  check(liveOut && liveOut.ok === true && liveOut.pending === true && liveOut.fresh === false && !!liveOut.sync, '差读数时立即回 pending：当次不等后台那一趟（#1006 验收④）')
  check(reads2 === 1 && readCwd2 === '/ws', '后台真读了一次，工作区目录递过去')
  const liveDone = await liveOut.sync
  check(liveDone && liveDone.ok === true && liveDone.fresh === true, '后台那一趟成功后回 fresh=true')
  check(cells2 && cells2.rest.remaining === 4321 && cells2.rest.limit === 5000 && cells2.graphql.remaining === 4300 && cells2.graphql.limit === 5000, '读数落进账本两桶（剩多少与上限分开）')
  check(cellsAt2 === start2, '落账带的是取数开始时刻而不是落账时刻（慢请求迟到也不许盖新读数；开始=' + start2 + '，实得 ' + cellsAt2 + '；#1006 验收⑤）')
  check(log2.fired.length === 1 && log2.fired[0].level === 'info' && log2.fired[0].event === 'host.call' && log2.fired[0].fields.method === 'deck.quotaSync' && log2.fired[0].fields.ok === true, '落账成功留一行既有 host.call（无新事件无新字段）')

  // —— 3. 失败分类：硬失败等得久、软失败等得短；读数未知、抛错都不许抛（#1006 期望③） ——
  const settles = []
  async function syncOnce(reading, extra) {
    settles.length = 0
    const merged = Object.assign({
      syncDue: function () { return true },
      syncServer: function () {},
      readBudget: async function () { return reading },
      onSettled: function (info) { settles.push(info) },
    }, extra || {})
    const s = mod.createDeckQuotaSync(merged)
    const r = await s.ensureReading('/ws', 'ws-x')
    const done = await r.sync
    return { out: r, done: done, info: settles[0] || null }
  }
  const notMeasured = await syncOnce(unknownReading('not-measured'))
  check(notMeasured.done.ok === false && notMeasured.done.reason === 'sync-empty' && reasonKnown(notMeasured.done.reason), '读数未知（not-measured）回 sync-empty，不抛')
  check(notMeasured.info && notMeasured.info.ok === false && notMeasured.info.failKind === 'hard' && notMeasured.info.at > 0, 'not-measured（机器没装 gh / 没登录）归硬失败，落定结论带给界面（#1006 期望⑤）')
  const unavailable = await syncOnce(unknownReading('unavailable'))
  check(unavailable.info && unavailable.info.failKind === 'soft', 'unavailable（网络 / 超时 / 解析不出）归软失败')
  const envEnvelope = await syncOnce(failedEnvelope('env'))
  check(envEnvelope.info && envEnvelope.info.failKind === 'hard' && envEnvelope.done.reason === 'sync-empty', '会话回失败信封且错误档是 env：归硬失败（原因码仍是 sync-empty，分类只进退避）')
  const authEnvelope = await syncOnce(failedEnvelope('auth'))
  check(authEnvelope.info && authEnvelope.info.failKind === 'hard', '会话回失败信封且错误档是 auth（没登录）：归硬失败')
  const netEnvelope = await syncOnce(failedEnvelope('network'))
  check(netEnvelope.info && netEnvelope.info.failKind === 'soft', '会话回失败信封且错误档是 network：归软失败')
  const threw = await syncOnce(null, { readBudget: async function () { throw new Error('gh 炸了') } })
  check(threw.done.ok === false && threw.done.reason === 'sync-threw' && reasonKnown(threw.done.reason), '会话读数抛了也收成 sync-threw（不向上抛）')
  check(threw.info && threw.info.failKind === 'soft', '读数这一趟抛错按软失败（临时故障居多）')
  const badShape = await syncOnce({ ok: true, data: { known: true, kind: 'two-buckets', buckets: { rest: { remaining: 1, limit: 5 } } } })
  check(badShape.done.ok === false && badShape.done.reason === 'sync-empty' && badShape.info && badShape.info.failKind === 'soft', '读数形状不完整（缺桶）回 sync-empty，按软失败（等下一次读）')
  const successInfo = await syncOnce(twoBuckets(2, 2))
  check(successInfo.info && successInfo.info.ok === true && successInfo.info.failKind === undefined, '成功落定也交给界面一条 ok:true（界面据此把旧失败清掉）')

  // —— 4. 缺件如实说缺件；入口兜底不抛 ——
  const noReader = mod.createDeckQuotaSync({ syncDue: function () { return true }, syncServer: function () {} })
  const noReaderOut = await noReader.ensureReading('/ws', 'ws-1')
  check(noReaderOut && noReaderOut.ok === false && noReaderOut.reason === 'missing-dep', '没给 readBudget 就认缺件（不打空枪）')
  const noLedger = mod.createDeckQuotaSync({ syncDue: function () { return true }, readBudget: async function () { return twoBuckets(1, 1) } })
  const noLedgerOut = await noLedger.ensureReading('/ws', 'ws-1')
  check(noLedgerOut && noLedgerOut.ok === false && noLedgerOut.reason === 'missing-dep', '没给 syncServer 就认缺件（读了没处落，等于没读）')
  const dueThrows = mod.createDeckQuotaSync({ syncDue: function () { throw new Error('账本坏了') }, syncServer: function () {}, readBudget: async function () { return twoBuckets(1, 1) } })
  const dueThrowsOut = await dueThrows.ensureReading('/ws', 'ws-1')
  check(dueThrowsOut && dueThrowsOut.ok === false && dueThrowsOut.reason === 'ensure-threw' && reasonKnown(dueThrowsOut.reason), 'syncDue 抛了也收成失败回值（入口兜底，不抛）')

  // —— 5. 软失败退避：失败越久等越久、有封顶、冷却内只认失败（#1006 期望③、验收①③） ——
  const clock5 = makeClock(1700000000000)
  let reads5 = 0
  const seq = mod.createDeckQuotaSync({ syncDue: function () { return true }, syncServer: function () {}, readBudget: async function () { reads5 += 1; return unknownReading('unavailable') }, now: clock5.now })
  async function failSeq() { const r = await seq.ensureReading('/ws', 'ws-seq'); return await r.sync }
  const seqFirst = await failSeq()
  check(seqFirst.ok === false && seqFirst.reason === 'sync-empty', '软失败第一次回 sync-empty')
  const readsInside = reads5
  let insideAllCooldown = true
  for (let i = 0; i < 5; i += 1) {
    const r = await seq.ensureReading('/ws', 'ws-seq')
    if (!(r.ok === false && r.reason === 'sync-cooldown')) insideAllCooldown = false
  }
  check(insideAllCooldown && reads5 === readsInside, '冷却内连打 5 次全部直接认失败，一次读数都不起')
  const waits = []
  for (let round = 0; round < 8; round += 1) {
    // 从当前时刻起每 1 秒试一次，找到下一次允许尝试的时刻（就等于退避时长）。
    let waited = 0
    let launched = null
    while (waited <= 1900000) {
      clock5.advance(1000); waited += 1000
      const r = await seq.ensureReading('/ws', 'ws-seq')
      if (r.pending === true) { launched = r; break }
    }
    waits.push(waited)
    if (!launched) break
    await launched.sync
  }
  check(waits.length === 8, '八轮失败都测到了下一次允许尝试的时刻（实得 ' + JSON.stringify(waits) + '）')
  check(waits[0] === 60000 && waits[1] === 120000 && waits[2] === 240000 && waits[3] === 480000 && waits[4] === 960000, '软失败退避按 2 的幂拉长：60 / 120 / 240 / 480 / 960 秒（#1006 期望③）')
  check(waits[5] === 1800000 && waits[6] === 1800000 && waits[7] === 1800000, '退避封顶 30 分钟，封顶后不再拉长（不会退到「等于放弃」；#1006 验收③）')
  // 到期后连着调用多次，只放一笔（#1006 验收①：不再过期后每次调用都起 gh）。
  clock5.advance(1800000)
  const readsBeforeBurst = reads5
  const burst = []
  for (let i = 0; i < 6; i += 1) burst.push(await seq.ensureReading('/ws', 'ws-seq'))
  const burstOk = reads5 - readsBeforeBurst === 1 && burst[0].pending === true && burst.every(function (r) { return r.pending === true || (r.ok === false && r.reason === 'sync-cooldown') })
  check(burstOk, '到期后连续 6 笔调用只起一笔读数（其余搭同一班车或直接认失败），不再每笔起一次 gh（#1006 验收①）')
  await Promise.all(burst.filter(function (r) { return r.pending === true }).map(function (r) { return r.sync }))

  // —— 6. 硬失败退避：起步就比软失败久，同样有封顶 ——
  const clock6 = makeClock(1700000000000)
  const hard = mod.createDeckQuotaSync({ syncDue: function () { return true }, syncServer: function () {}, readBudget: async function () { return unknownReading('not-measured') }, now: clock6.now })
  async function failHard() { const r = await hard.ensureReading('/ws', 'ws-hard'); return await r.sync }
  const hardFirst = await failHard()
  check(hardFirst.ok === false && hardFirst.reason === 'sync-empty', '硬失败第一次也回 sync-empty（原因码不变，分类只在退避里用）')
  const hardWaits = []
  for (let round = 0; round < 4; round += 1) {
    let waited = 0
    let launched = null
    while (waited <= 1900000) {
      clock6.advance(1000); waited += 1000
      const r = await hard.ensureReading('/ws', 'ws-hard')
      if (r.pending === true) { launched = r; break }
    }
    hardWaits.push(waited)
    if (!launched) break
    await launched.sync
  }
  check(hardWaits[0] === 600000, '没装 gh / 没登录这类硬失败起步等 10 分钟，比软失败的 60 秒久（#1006 期望③；实得 ' + JSON.stringify(hardWaits) + '）')
  check(hardWaits[1] === 1200000 && hardWaits[2] === 1800000 && hardWaits[3] === 1800000, '硬失败也按 2 的幂拉长并封顶 30 分钟，不会退到「等于放弃」')

  // —— 7. 冷却按工作区分开（#1006 期望⑤、验收②） ——
  const clock7 = makeClock(1700000000000)
  let readsA = 0
  let readsB = 0
  let readsC = 0
  const sep = mod.createDeckQuotaSync({
    syncDue: function () { return true },
    syncServer: function () {},
    now: clock7.now,
    readBudget: async function (cwd) {
      const c = String(cwd)
      if (c === '/ws-a') { readsA += 1; return unknownReading('unavailable') }
      if (c === '/ws-b') { readsB += 1; return twoBuckets(9, 9) }
      readsC += 1; return unknownReading('unavailable')
    },
  })
  const a1 = await sep.ensureReading('/ws-a', 'ws-a')
  await a1.sync
  check(readsA === 1, 'A 工作区先失败一次')
  const a2 = await sep.ensureReading('/ws-a', 'ws-a')
  check(a2.ok === false && a2.reason === 'sync-cooldown' && readsA === 1, 'A 自己的工作区在冷却内直接认失败')
  const readsBeforeB = readsB
  const b1 = await sep.ensureReading('/ws-b', 'ws-b')
  check(b1.ok === true && b1.pending === true && readsB === readsBeforeB + 1, 'B 工作区不受 A 的冷却影响：照打它自己的读数（#1006 验收②）')
  const b1Done = await b1.sync
  check(b1Done.ok === true, 'B 工作区读数成功')
  const a3 = await sep.ensureReading('/ws-a', 'ws-a')
  check(a3.ok === false && a3.reason === 'sync-cooldown', 'B 成功不解除 A 的冷却（各工作区各凭各的；#1006 风险清单第 1 条）')
  const c1 = await sep.ensureReading('/ws-c', 'ws-c')
  await c1.sync
  const d1 = await sep.ensureReading('/ws-b', 'ws-b')
  await d1.sync
  const c2 = await sep.ensureReading('/ws-c', 'ws-c')
  check(c2.ok === false && c2.reason === 'sync-cooldown' && readsC === 1, '别的工作区成功也不清本工作区的冷却')
  // 没有工作区键就退回工作区目录分格。
  const clock7b = makeClock(1700000000000)
  let readsE = 0
  const noKey = mod.createDeckQuotaSync({ syncDue: function () { return true }, syncServer: function () {}, now: clock7b.now, readBudget: async function () { readsE += 1; return unknownReading('unavailable') } })
  const e1 = await noKey.ensureReading('/ws-e', null)
  await e1.sync
  const e2 = await noKey.ensureReading('/ws-e', '   ')
  check(e2.ok === false && e2.reason === 'sync-cooldown' && readsE === 1, '工作区键为空就按工作区目录分格（不退回全进程共用一格）')

  // —— 8. 关键路径不再等同步（#1006 期望④、验收④） ——
  const releases = []
  let slowDone = false
  const slow = mod.createDeckQuotaSync({
    syncDue: function () { return true },
    syncServer: function () {},
    readBudget: async function () { await new Promise(function (resolve) { releases.push(resolve) }); slowDone = true; return twoBuckets(11, 11) },
  })
  const slowOut = await slow.ensureReading('/ws', 'ws-slow')
  check(slowOut.ok === true && slowOut.pending === true && slowDone === false, '后台读还在路上时工具调用已经拿到回执：不等同步（#1006 验收④）')
  if (releases.length) releases[0]()
  const slowDoneResult = await slowOut.sync
  check(slowDoneResult.ok === true && slowDone === true, '后台那一趟读完后照常落账')

  // —— 9. 成功立刻清零冷却（#1006 期望③） ——
  const clock9 = makeClock(1700000000000)
  let reads9 = 0
  const clear9 = mod.createDeckQuotaSync({
    syncDue: function () { return true },
    syncServer: function () {},
    now: clock9.now,
    readBudget: async function () { reads9 += 1; return reads9 === 1 ? unknownReading('unavailable') : twoBuckets(5, 5) },
  })
  const cFirst = await clear9.ensureReading('/ws', 'ws-clear')
  await cFirst.sync
  const cCool = await clear9.ensureReading('/ws', 'ws-clear')
  check(cCool.ok === false && cCool.reason === 'sync-cooldown', '失败后进入冷却')
  clock9.advance(60000)
  const cRetry = await clear9.ensureReading('/ws', 'ws-clear')
  const cRetryDone = await cRetry.sync
  check(cRetryDone.ok === true && reads9 === 2, '过了冷却能再读且能成功')
  const cNext = await clear9.ensureReading('/ws', 'ws-clear')
  check(cNext.ok === true && cNext.pending === true && reads9 === 3, '成功立刻清零冷却：下一笔马上能再读（#1006 期望③）')
  await cNext.sync

  // —— 10. 并发单飞 ——
  let reads10 = 0
  let release10 = null
  const single = mod.createDeckQuotaSync({
    syncDue: function () { return true },
    syncServer: function () {},
    readBudget: async function () { reads10 += 1; await new Promise(function (resolve) { release10 = resolve }); return twoBuckets(3, 3) },
  })
  const both = await Promise.all([single.ensureReading('/ws', 'ws-1'), single.ensureReading('/ws', 'ws-1')])
  check(reads10 === 1 && both[0].pending === true && both[1].pending === true && both[0].sync === both[1].sync, '并发两笔只起一笔读数、搭同一班车（本实例内全局单飞）')
  if (release10) release10()
  const bothDone = await Promise.all([both[0].sync, both[1].sync])
  check(bothDone[0].ok === true && bothDone[1].ok === true, '两笔都等到同一个成功结果')

  // —— 11. 冷却期挡下的不记日志（不拿预期行为刷屏） ——
  const log11 = fakeLog()
  let reads11 = 0
  const quiet = mod.createDeckQuotaSync({
    syncDue: function () { return true },
    syncServer: function () {},
    logCtx: log11.ctx,
    readBudget: async function () { reads11 += 1; return unknownReading('unavailable') },
  })
  const q1 = await quiet.ensureReading('/ws', 'ws-quiet')
  await q1.sync
  const firedAfterFail = log11.fired.length
  await quiet.ensureReading('/ws', 'ws-quiet')
  check(firedAfterFail === 1 && log11.fired.length === 1 && log11.fired[0].event === 'host.call' && log11.fired[0].fields.ok === false && log11.fired[0].fields.reason === 'sync-empty', '冷却期挡下的那一笔不记日志；失败那一趟只记既有 host.call（带原因码）')

  console.log(failed ? ('\n' + total + ' 条断言，失败') : ('\n' + total + ' 条断言，全部通过')); process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.log('  FAIL 门禁抛错：' + String((e && e.message) || e)); process.exit(1) })
