// tests/verify-deck-quota-sync.ts —— 门禁：剩余额读数经 Tracker 会话同步（#758 建，#1443 改道）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-deck-quota-sync.ts，可独立运行。
//
// 为什么改道：从前桥里自己拼 gate.send + runGh 打免费的 gh api rate_limit —— 那是绕开会话的旧直调。
// #1443 起同步只调经 Tracker 会话的 readBudget（房间自己读 gh），桥里不再有 runGh、gate.send、noteRateLimited。
// 本门禁盯住：不差不打、差就读一次落账、未知与失败永不抛、并发单飞、冷却退避、失败不进工作区计数。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 会话 readBudget 的成功回执长这样（房间装进成功信封的两桶读数）。
function twoBuckets(restRemaining, gqlRemaining) {
  return { ok: true, data: { known: true, kind: 'two-buckets', buckets: { rest: { remaining: restRemaining, limit: 5000 }, graphql: { remaining: gqlRemaining, limit: 5000 } } } }
}
// 失败与未知的原因只许是这五个（没有工作区失败计数那一格，同步失败只退避）。
function reasonKnown(reason) { return ['missing-dep', 'sync-cooldown', 'sync-empty', 'sync-threw', 'ensure-threw'].indexOf(reason) >= 0 }

async function main() {
  console.log('剩余额读数同步门禁（#1443：经会话 readBudget，不再直调 gh）')
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
  check(idleOut && idleOut.ok === true && idleOut.fresh === false && reads1 === 0, '账本说不差，会话读数一次都不调')

  // —— 2. 差就读一次，读数落账 ——
  let reads2 = 0
  let synced = null
  let readCwd = ''
  const fired = []
  const fakeLog = { fire: function (level, event, fields) { fired.push({ level: level, event: event, fields: fields }) } }
  const live = mod.createDeckQuotaSync({ syncDue: function () { return true }, syncServer: function (readings) { synced = readings }, readBudget: async function (cwd) { reads2 += 1; readCwd = String(cwd); return twoBuckets(4321, 4300) }, logCtx: fakeLog })
  const liveOut = await live.ensureReading('/ws', 'ws-abc')
  check(liveOut && liveOut.ok === true && liveOut.fresh === true, '差读数时同步成功（经会话读数）')
  check(reads2 === 1 && readCwd === '/ws', '只读一次，工作区目录递过去')
  check(synced && synced.rest.remaining === 4321 && synced.rest.limit === 5000 && synced.graphql.remaining === 4300 && synced.graphql.limit === 5000, '读数落进账本两桶（剩多少与上限分开）')
  check(fired.length === 1 && fired[0].level === 'info' && fired[0].event === 'host.call' && fired[0].fields.method === 'deck.quotaSync' && fired[0].fields.ok === true, '落账成功留一行既有 host.call（无新事件无新字段）')

  // —— 3. 读数未知认失败，永不抛 ——
  const unknown = mod.createDeckQuotaSync({ syncDue: function () { return true }, syncServer: function () { throw new Error('不该落账') }, readBudget: async function () { return { ok: true, data: { known: false, reason: 'unavailable' } } } })
  const unknownOut = await unknown.ensureReading('/ws', 'ws-1')
  check(unknownOut && unknownOut.ok === false && unknownOut.reason === 'sync-empty' && reasonKnown(unknownOut.reason), '读数未知回 sync-empty（调用方照旧走原流程，不抛）')
  const threw = mod.createDeckQuotaSync({ syncDue: function () { return true }, syncServer: function () {}, readBudget: async function () { throw new Error('gh 炸了') } })
  const threwOut = await threw.ensureReading('/ws', 'ws-1')
  check(threwOut && threwOut.ok === false && reasonKnown(threwOut.reason), '会话读数抛了也收成失败回值（这一趟记 sync 原因，不抛）')

  // —— 4. 缺件如实说缺件 ——
  const noReader = mod.createDeckQuotaSync({ syncDue: function () { return true }, syncServer: function () {} })
  const noReaderOut = await noReader.ensureReading('/ws', 'ws-1')
  check(noReaderOut && noReaderOut.ok === false && noReaderOut.reason === 'missing-dep', '没给 readBudget 就认缺件（不打空枪）')
  const noLedger = mod.createDeckQuotaSync({ syncDue: function () { return true }, readBudget: async function () { return twoBuckets(1, 1) } })
  const noLedgerOut = await noLedger.ensureReading('/ws', 'ws-1')
  check(noLedgerOut && noLedgerOut.ok === false && noLedgerOut.reason === 'missing-dep', '没给 syncServer 就认缺件（读了没处落，等于没读）')

  // —— 5. 失败冷却退避，过了冷却能再读（失败不进工作区计数，不永久推迟） ——
  let reads5 = 0
  const cooling = mod.createDeckQuotaSync({ syncDue: function () { return true }, syncServer: function () {}, readBudget: async function () { reads5 += 1; if (reads5 === 1) return { ok: true, data: { known: false, reason: 'unavailable' } }; return twoBuckets(7, 7) }, cooldownMs: 30 })
  const coolFail = await cooling.ensureReading('/ws', 'ws-1')
  const coolFast = await cooling.ensureReading('/ws', 'ws-1')
  check(coolFail && coolFail.ok === false && coolFast && coolFast.ok === false && coolFast.reason === 'sync-cooldown' && reads5 === 1, '失败后冷却期内直接认失败，不重复打会话读数')
  await sleep(60)
  const coolRetry = await cooling.ensureReading('/ws', 'ws-1')
  check(coolRetry && coolRetry.ok === true && reads5 === 2, '过了冷却能再读且能成功（失败只退避，不记工作区失败数）')

  // —— 6. 并发单飞 ——
  let reads6 = 0
  const single = mod.createDeckQuotaSync({ syncDue: function () { return true }, syncServer: function () {}, readBudget: async function () { reads6 += 1; await sleep(20); return twoBuckets(3, 3) } })
  const both = await Promise.all([single.ensureReading('/ws', 'ws-1'), single.ensureReading('/ws', 'ws-1')])
  check(reads6 === 1 && both[0].ok === true && both[1].ok === true, '并发两笔只读一次（本实例内并单）')

  console.log(failed ? ('\n' + total + ' 条断言，失败') : ('\n' + total + ' 条断言，全部通过')); process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.log('  FAIL 门禁抛错：' + String((e && e.message) || e)); process.exit(1) })
