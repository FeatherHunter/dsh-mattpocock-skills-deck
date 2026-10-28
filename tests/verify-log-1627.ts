// verify-log-1627.ts —— #1627「配额与限流诊断日志一次加到位」的回放门禁。
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-log-1627.ts。
// 做法：拿 2026-10-28 真实日志（见 tests/fixtures/1627-log-replay.json，按分钟聚合）回放
//   src/refresh/rooms/host/quota-observer.ts 的观察器，只驱动 noteSpend / noteOp / tick 三类调用
//   （noteSync 不在真实日志里逐条出现，另用构造数据单测）；断言的是票面第 5 节那几件事：
//   1）quota.window 的 points 合计 20,739、requests 合计 2,688 —— 以 quota.spend 为准；
//      同一天 gh.exec 逐行 points 之和是 20,782，比它多 43 点（估算口径把失败行也算进去了），
//      所以窗口合计不能拿 gh.exec 对；
//   2）quota.incident 恰 3 条：UTC 分钟分别落在 2026-10-27 16:32、2026-10-28 10:42 与 12:17，
//      其他分钟零误报（当天全部 7 条限流失败就这三簇，同簇里第二、三条被 60 秒去重与每分钟上限压掉）；
//   3）quota.recover 恰 3 条，每条都在一次事故之后（安静至少 30 秒的第一条成功操作算恢复）；
//   4）构造数据单测 quota.sync：同一后端同一时刻 rest 与 graphql 两桶合成一行、graphql 优先，
//      driftPoints 按「上一次剩余减本次剩余再减本地已花」算，resetSeen 看重置前进，ageMs 看两次读数间隔。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

const observerMod = require(path.join(ROOT, 'src', 'refresh', 'rooms', 'host', 'quota-observer.js'))
const { createQuotaObserver } = observerMod

// 假日志出口：只收行，不落盘；级别全开（观察器会据此把调试档的行也发出来）。
function makeSink(rows) {
  return { isEnabled: () => true, fire: (level, event, fields) => rows.push({ level, event, fields }) }
}

function minuteOf(t) {
  return Math.floor(t / 60000) * 60000
}

const OP_BASE = {
  account: 'ai-tool', backendId: 'github', purpose: '', requests: 0, points: 0,
  pointSource: '', bucket: 'graphql', remaining: null, tier: null, httpStatus: 0, top: '',
}

// 把夹具里的分钟聚合展开成观察器事件：花费按分钟起点、成功操作按该分钟均匀分布、
// 普通失败按类别各造一笔；限流失败不进分钟聚合，按 failures 里的精确时刻单独喂。
function buildEvents(fixture) {
  const events = []
  let seq = 0
  const push = (at, kind, report) => events.push({ at: at, kind: kind, seq: seq++, report: report })
  for (const minute of fixture.minutes) {
    for (const spend of minute.spends) {
      push(minute.t, 'spend', { at: minute.t, account: spend.account, backendId: 'github', bucket: spend.bucket, requests: spend.requests, points: spend.points, kind: spend.bucket })
    }
    const ok = minute.ops.ok || 0
    for (let i = 0; i < ok; i += 1) {
      const at = minute.t + Math.floor(((i + 0.5) * 60000) / ok)
      push(at, 'ok', Object.assign({}, OP_BASE, { at: at, op: 'replay.ok', opId: 'replay-ok-' + seq, caller: 'replay.ok', ok: true, latencyMs: 0, errorKind: '', rateClass: '' }))
    }
    for (const category of ['network', 'auth', 'env', 'other']) {
      const n = minute.ops[category] || 0
      for (let i = 0; i < n; i += 1) {
        const at = minute.t + Math.floor(((i + 0.5) * 60000) / n)
        push(at, 'fail', Object.assign({}, OP_BASE, { at: at, op: 'replay.' + category, opId: 'replay-fail-' + seq, caller: 'replay.' + category, ok: false, latencyMs: 0, errorKind: category, rateClass: '' }))
      }
    }
  }
  for (const fail of fixture.failures) {
    push(fail.at, 'ratelimit', Object.assign({}, OP_BASE, {
      at: fail.at, op: fail.via, opId: fail.opId, caller: fail.via, ok: false,
      latencyMs: fail.latencyMs, points: 1, pointSource: 'estimate', errorKind: 'ratelimit', rateClass: fail.rateClass,
    }))
  }
  events.sort((a, b) => (a.at - b.at) || (a.seq - b.seq))
  return events
}

function sumOf(rows, key) {
  let sum = 0
  for (const row of rows) sum += Number(row.fields[key]) || 0
  return sum
}

function replay() {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', '1627-log-replay.json'), 'utf8'))
  const rows = []
  const ob = createQuotaObserver({ log: makeSink(rows), lane: () => null, readings: () => null })
  const events = buildEvents(fixture)
  for (const event of events) {
    if (event.kind === 'spend') ob.noteSpend(event.report)
    else ob.noteOp(event.report)
  }
  ob.tick(events[events.length - 1].at + 120000)
  return { fixture: fixture, rows: rows }
}

function syncUnit() {
  const rows = []
  const ob = createQuotaObserver({ log: makeSink(rows), lane: () => null, readings: () => null })
  const t0 = 1793000000000
  // 第一条读数没有上一次可对，driftPoints 与 ageMs 记 -1。
  ob.noteSync({ at: t0, trigger: 'probe', backendId: 'github', bucket: 'graphql', serverLimit: 5000, serverRemaining: 4000, resetSec: 100, allowance: 5000, spentPoints: 0 })
  ob.tick(t0 + 1000)
  // 第二条：同一后端同一时刻两个桶，rest 与 graphql 只能合成一行，graphql 优先；
  //   剩余从 4000 掉到 3990、本地又花了 10 点，所以漂移应为 0；resetSec 前进了，resetSeen 为真。
  ob.noteSync({ at: t0 + 60000, trigger: 'sync', backendId: 'github', bucket: 'rest', serverLimit: 5000, serverRemaining: 5000, resetSec: 200, allowance: 5000, spentPoints: 0 })
  ob.noteSync({ at: t0 + 60000, trigger: 'sync', backendId: 'github', bucket: 'graphql', serverLimit: 5000, serverRemaining: 3990, resetSec: 200, allowance: 5000, spentPoints: 10 })
  ob.tick(t0 + 61000)
  // 第三条：resetSec 没再前进，resetSeen 应为假；两次读数间隔正好一分钟。
  ob.noteSync({ at: t0 + 120000, trigger: 'sync', backendId: 'github', bucket: 'graphql', serverLimit: 5000, serverRemaining: 3980, resetSec: 200, allowance: 5000, spentPoints: 10 })
  ob.tick(t0 + 121000)
  return rows.filter((row) => row.event === 'quota.sync').map((row) => row.fields)
}

const replayResult = replay()
const rows = replayResult.rows
const fixture = replayResult.fixture
const windows = rows.filter((row) => row.event === 'quota.window')
const incidents = rows.filter((row) => row.event === 'quota.incident')
const recovers = rows.filter((row) => row.event === 'quota.recover')

console.log('配额与限流诊断回放门禁（#1627：真实日志逐分钟回放观察器，断言票面第 5 节）')

// 一、回放结果本身要够用：每个有事件的分钟恰好一行窗口，且日期范围与夹具一致。
check(fixture.failures.length === 7, '夹具里 7 条限流失败齐全（当天全部限流失败）')
check(fixture.minutes.length === 674, '夹具按分钟聚合后 674 个有事件的分钟（' + fixture.minutes.length + '）')
check(windows.length === fixture.minutes.length, '每个有事件的分钟恰好一行 quota.window（实得 ' + windows.length + '，应得 ' + fixture.minutes.length + '）')

// 二、窗口合计：points 与 requests 以 quota.spend 为准，不用 gh.exec（单行估算含失败，差 43 点）。
const windowPoints = sumOf(windows, 'points')
const windowRequests = sumOf(windows, 'requests')
check(windowPoints === 20739, '窗口 points 合计 20,739（实得 ' + windowPoints + '；gh.exec 逐行合计 20,782 多 43 点是估算口径，不作判据）')
check(windowRequests === 2688, '窗口 requests 合计 2,688（实得 ' + windowRequests + '）')
check(sumOf(windows, 'limitCount') === 7, '窗口 limitCount 合计 7（只有那 7 笔真限流失败计入）')
check(sumOf(windows, 'failCount') === 78, '窗口 failCount 合计 78（7 限流 + 59 网络 + 2 认证 + 10 环境）')

// 三、事故：恰 3 条，分钟与操作都要对上当天那三簇；除这三分钟外零误报。
const expectedMinutes = ['2026-10-27T16:32', '2026-10-28T10:42', '2026-10-28T12:17']
check(incidents.length === 3, 'quota.incident 恰 3 条（实得 ' + incidents.length + '；同簇第二、三条被去重与每分钟上限压掉）')
const firstClusters = []
const clusterOf = []
for (const fail of fixture.failures) {
  const minute = new Date(fail.at).toISOString().slice(0, 16)
  if (firstClusters.indexOf(minute) < 0) firstClusters.push(minute)
}
check(firstClusters.length === 3 && firstClusters[0] === expectedMinutes[0] && firstClusters[1] === expectedMinutes[1] && firstClusters[2] === expectedMinutes[2], '夹具里的限流失败只落在三个 UTC 分钟：' + expectedMinutes.join('、') + '（实得 ' + firstClusters.join('、') + '）')
const incidentVia = incidents.map((row) => row.fields.via)
const incidentOpId = incidents.map((row) => row.fields.opId)
const firstFails = fixture.failures.filter((fail, i, list) => list.findIndex((other) => new Date(other.at).toISOString().slice(0, 16) === new Date(fail.at).toISOString().slice(0, 16)) === i)
check(incidents.every((row) => row.fields.rateClass === 'unknown'), '三条事故的 rateClass 都是 unknown（日志原文没有分类文字，回放按合同统一记 unknown）')
check(incidentVia.length === 3 && incidentVia[0] === firstFails[0].via && incidentVia[1] === firstFails[1].via && incidentVia[2] === firstFails[2].via, '三条事故的 via 对得上每簇第一笔失败：' + incidentVia.join('、'))
check(incidentOpId.length === 3 && incidentOpId[0] === firstFails[0].opId && incidentOpId[1] === firstFails[1].opId && incidentOpId[2] === firstFails[2].opId, '三条事故的 opId 对得上每簇第一笔失败：' + incidentOpId.join('、'))
check(incidents.every((row) => row.level === 'warn'), 'quota.incident 是告警级（始终落盘），三条都是 warn')
// attempt 只核对是正整数：回放里成功操作没有真实操作名（夹具按分钟只聚合数量），观察器按 op 名
//   累计失败次数、只有同名成功才清零，所以这里看到的不是真实接线里的那个数字；真实接线由
//   tracker-session / pipeline 传真实 op 名，成功一次就清零，门禁不在这份合成输入上假装它成立。
check(incidents.every((row) => Number(row.fields.attempt) >= 1 && Number(row.fields.retryGapMs) >= 0), '三条事故的 attempt 都是正整数、retryGapMs 都是非负数')

// 四、恢复：恰 3 条，每条都在事故之后，且安静期过后才写。
check(recovers.length === 3, 'quota.recover 恰 3 条（实得 ' + recovers.length + '）')
check(recovers.every((row) => row.level === 'info'), 'quota.recover 是信息级常驻，三条都是 info')
check(recovers.every((row) => Number(row.fields.durationMs) >= 30000), '每次恢复的 durationMs 都至少 30 秒（恢复判据是安静至少 30 秒后的第一条成功操作）')
check(recovers.filter((row) => row.fields.incidents >= 1).length === 3, '每次恢复都至少见过 1 行事故（incidents 字段大于等于 1）')

// 五、构造数据单测 quota.window 里那几格裁决计数（夹具只有花费与操作，没有闸的裁决行，所以这里补一小段）。
function decisionUnit() {
  const rows = []
  const ob = createQuotaObserver({ log: makeSink(rows), lane: () => null, readings: () => null })
  const t0 = 1793000000000
  ob.noteDecision({ at: t0, category: 'user-action', verdict: 'allow', reason: 'ok' })
  ob.noteDecision({ at: t0 + 1000, category: 'ai-tool', verdict: 'allow', reason: 'allow-soft' })
  ob.noteDecision({ at: t0 + 2000, category: 'background', verdict: 'allow', reason: 'bg' })
  ob.noteDecision({ at: t0 + 3000, category: 'ai-tool', verdict: 'defer', reason: 'busy' })
  ob.noteDecision({ at: t0 + 4000, category: 'user-action', verdict: 'reject', reason: 'nope' })
  ob.tick(t0 + 120000)
  const windows = rows.filter((row) => row.event === 'quota.window')
  return windows.length ? windows[0].fields : null
}

const decisionWindow = decisionUnit()
check(decisionWindow !== null, '裁决计数用例写出了 quota.window 行')
if (decisionWindow) {
  check(decisionWindow.allowUser === 1 && decisionWindow.allowAi === 1 && decisionWindow.allowBg === 1, 'allowUser / allowAi / allowBg 按类别各数各的（reject 不计入 allow）')
  check(decisionWindow.softOver === 1, 'softOver 只数结论为 allow 且原因代号含 -soft 的那笔')
  check(decisionWindow.deferCount === 1, 'deferCount 数所有 defer（不看类别）')
}

// 六、构造数据单测 quota.sync（真实日志里不逐条出现，单独测合成与漂移口径）。
const syncs = syncUnit()
check(syncs.length === 3, 'quota.sync 合成后恰 3 行（同一后端同一时刻的两个桶算一行）')
check(syncs[0].driftPoints === -1 && syncs[0].resetSeen === false && syncs[0].ageMs === -1, '第一条读数没有上一次可比：driftPoints -1、resetSeen false、ageMs -1')
check(syncs[1].serverLimit === 5000 && syncs[1].serverRemaining === 3990 && syncs[1].spentSinceSync === 10, '第二条读数合成时 graphql 优先：剩余 3990、本地花了 10 点')
check(syncs[1].driftPoints === 0, '第二条读数的漂移为 0（上一次剩余 4000 减本次 3990 再减本地已花 10）')
check(syncs[1].resetSeen === true && syncs[1].ageMs === 60000, '第二条读数看到重置前进（resetSeen true），距上一次读数 60000 毫秒')
check(syncs[2].resetSeen === false, '第三条读数 resetSec 没再前进，resetSeen 为假')

console.log(failed ? '\n存在失败 — verify-log-1627 未通过' : '\n全部通过 — 配额与限流诊断回放门禁生效（' + total + ' 项断言）')
process.exit(failed ? 1 : 0)
