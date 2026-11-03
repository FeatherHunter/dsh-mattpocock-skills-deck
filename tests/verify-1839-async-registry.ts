// tests/verify-1839-async-registry.ts —— 额度读数取注册表必须走异步（#1839）
// 门禁归属: src/refresh/rooms/host/budget-state.ts
// 门禁归属: src/host/tracker/snapshot.ts
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1839-async-registry.ts
//
// 真机（批次 1833-listhead-r1）发现：健康 GitHub 仓库打开列表页，通知中心的铃铛从不出现。
// 根因在取数链上，按宿主真实形状（异步）复现：
//   1. 宿主接给预算读数的 getTrackerRegistry 是异步函数（src/host/index.ts:80 返回 Promise）。
//   2. 生产者 budget-state.ts 从前同步调用它，把 Promise 当注册表，永远读不到 modules，
//      读数恒为 null，快照里永远没有 refresh.backend。
//   3. 客户端 budgetTierViewOf 因此返回 null；notificationCenter.ts 在「历史为空且额度视图为空」时
//      整块不画 —— 铃铛与额度行一起消失。
//
// 这扇门禁按「宿主真实形状」验三层，等价重构不会假红：
//   一、生产者：异步 getTrackerRegistry（含延迟 resolve）能取到预算声明；同步注册表仍兼容；坏掉回 null。
//   二、链路：快照编排器 await 异步读数口后，回包里 refresh.backend 真的出现（修复前这一格恒缺席）。
//   三、界面判据：用回包那一格算出的通知中心额度视图非空、头部徽标让格（额度行因此才画得出来）。
//   四、源码形状：取注册表必须是 await 的（把 #1839 的回归钉在这里）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBudgetState } from '../src/refresh/rooms/host/budget-state.js'
import { createSnapshotComposer } from '../src/host/tracker/snapshot.js'
import { lagPromiseFor, tierFor } from '../src/refresh/kernel/host-budget.js'
import { budgetTierViewOf, freshnessToneColor, truthAgoViewOf } from '../src/client/views/shared/truthLines.js'
import { noticeBudgetViewOf, noticeHeadBadgeOf } from '../src/client/views/shared/notificationCenterModel.js'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-1839-async-registry'
let total = 0
let failed = false
const check = function (ok: any, msg: string): void {
  total += 1
  if (!ok) failed = true
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
}

// 客户端那两个模块的依赖在拼接闭包里由全局名供给，单测这里照同一约定手工挂上。
const G: any = globalThis
G.freshnessToneColor = freshnessToneColor
G.truthAgoViewOf = truthAgoViewOf
G.budgetTierViewOf = budgetTierViewOf
G.tierFor = tierFor
G.lagPromiseFor = lagPromiseFor
G.tr = function (key: any) { return String(key) }
G.React = { useState: function (v: any) { return [v, function () {}] } }
G.host = { call: async function () { return { ok: true, events: [] } } }
G.flash = function () {}

const REF = { backend: 'fake', refId: 'acme/demo', name: 'demo', url: '' }
const TWO_BUCKETS = { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true }
const REQUESTS_ONLY = { kind: 'requests-only', countsRequests: true, countsPoints: false, independentBuckets: false }
const registryOf = function (budget: any): any { return { modules: function (): any[] { return [{ id: 'fake', budget: budget }] } } }
const ledgerOf = function (restRemaining: number, graphqlRemaining: number): any {
  const levels: any = {
    rest: { remaining: restRemaining, allowance: 5000 },
    graphql: { remaining: graphqlRemaining, allowance: 5000 },
    requests: { remaining: restRemaining, allowance: 5000 },
  }
  return { view: function (_id: string, bucket: string): any { return levels[bucket] || null } }
}

;(async function () {
  // ---------- 一、生产者：宿主真实形状（异步注册表） ----------
  const read = createBudgetState({
    getTrackerRegistry: function () { return new Promise(function (resolve) { setTimeout(function () { resolve(registryOf(TWO_BUCKETS)) }, 5) }) },
    ledger: ledgerOf(4500, 4200),
  })
  const pending = read('fake')
  check(!!pending && typeof pending.then === 'function', '读数口返回 Promise（宿主那边本来就是异步接线）')
  const delayed = await pending
  check(!!delayed && delayed.budgetKind === 'two-buckets' && delayed.readKnown === true, '异步取到的注册表也能读出预算模型（修复前恒 null）')
  check(!!delayed && !!delayed.buckets && delayed.buckets.rest.remaining === 4500 && delayed.buckets.graphql.remaining === 4200, '两桶读数原样带出来（4500 / 4200）')

  const requests = await createBudgetState({
    getTrackerRegistry: async function () { return registryOf(REQUESTS_ONLY) },
    ledger: ledgerOf(3000, 3000),
  })('fake')
  check(!!requests && requests.budgetKind === 'requests' && requests.readKnown === true && requests.requests.remaining === 3000, '只计请求的后端同样按异步注册表读出读数')

  const syncState = await createBudgetState({
    getTrackerRegistry: function () { return registryOf(TWO_BUCKETS) },
    ledger: ledgerOf(1000, 1000),
  })('fake')
  check(!!syncState && syncState.budgetKind === 'two-buckets', '同步注册表仍兼容（门禁与老调用点不受影响）')

  const rejected = await createBudgetState({
    getTrackerRegistry: function () { return Promise.reject(new Error('registry down')) },
    ledger: ledgerOf(1, 1),
  })('fake')
  const threw = await createBudgetState({
    getTrackerRegistry: function () { throw new Error('registry threw') },
    ledger: ledgerOf(1, 1),
  })('fake')
  check(rejected === null && threw === null, '注册表取不到（拒绝或抛错）时回 null，不编一个模型、也不抛给调用方')

  const offNetwork = await createBudgetState({
    getTrackerRegistry: async function () { return registryOf({ kind: 'off-network' }) },
    ledger: ledgerOf(0, 0),
  })('fake')
  check(!!offNetwork && offNetwork.offNetwork === true && offNetwork.budgetKind === 'none', '离网模型照旧翻成「没有额度」（异步化不改口）')

  // ---------- 二、链路：快照里真的出现 refresh.backend ----------
  const state = createBudgetState({
    getTrackerRegistry: async function () { return registryOf(TWO_BUCKETS) },
    ledger: ledgerOf(4500, 4200),
  })
  const composer = createSnapshotComposer(
    { get: function (bid: string): any { return bid === REF.backend ? { list: async function (): Promise<any> { return { ok: true, data: [] } } } : undefined } },
    {
      snapshotTtl: 1,
      depsTtl: 1,
      // 与宿主入口同一形状：wf.snapshot 的 budgetReadout 是「等 wiring 好了再问 budgetState」，天然是 Promise。
      budgetReadout: function (id: string): any { return Promise.resolve().then(function () { return state(id) }) },
    },
  )
  const snap = await composer.composeSnapshot(REF.backend, REF, {}, { force: true })
  check(snap.ok === true && !!snap.snapshot && !!snap.snapshot.refresh, '快照照常成功（额度读数不拖垮整份快照）')
  const backend = snap.snapshot && snap.snapshot.refresh && snap.snapshot.refresh.backend
  check(!!backend && backend.id === REF.backend && backend.budgetKind === 'two-buckets' && backend.readKnown === true, 'wf.snapshot 回包的 refresh.backend 在（修复前这一格永远缺席）')
  check(!!backend && !!backend.buckets && backend.buckets.rest.remaining === 4500 && backend.buckets.graphql.remaining === 4200, '读数经形状校验后原样到客户端（4500 / 4200）')
  check(!!snap.snapshot && snap.snapshot.refresh.tier === null && snap.snapshot.refresh.deferred === false && snap.snapshot.refresh.paused === false && snap.snapshot.refresh.notRefreshing === false, '旧四格语义不变（tier 仍 null、其余仍 false）')

  // ---------- 三、界面：额度视图与头部徽标 ----------
  const st = { snapshot: snap.snapshot, snapMode: 'real', snapError: null }
  const budgetView = noticeBudgetViewOf(st)
  check(!!budgetView && budgetView.tier === 'plenty', '通知中心的额度视图非空且档位「充足」')
  check(!!budgetView && budgetView.stateKey === 'notice.budgetPlenty' && budgetView.lines.length === 2, '档位翻成「充足」词条，逐条读数两句都在')
  check(noticeHeadBadgeOf({ readable: true, events: [] }, st) === 'badge', '历史为空但有额度可看时，头部徽标让出一格（铃铛因此才画）')
  const empty = { snapshot: { refresh: { tier: null, deferred: false, paused: false, notRefreshing: false } }, snapMode: 'real', snapError: null }
  check(noticeBudgetViewOf(empty) === null && noticeHeadBadgeOf({ readable: true, events: [] }, empty) === '', '没有额度也没有历史时仍不让格（不占窄面板地方）')

  // ---------- 四、源码形状：回归钉 ----------
  const budgetSrc = fs.readFileSync(path.join(ROOT, 'src/refresh/rooms/host/budget-state.ts'), 'utf8')
  check(/await\s+deps\.getTrackerRegistry\(\)/.test(budgetSrc), 'budget-state.ts 取注册表是 await 的（异步形状的唯一允许写法）')
  check(!/const reg: any = \(typeof deps\.getTrackerRegistry === 'function'\) \? deps\.getTrackerRegistry\(\)/.test(budgetSrc), '不再有「同步调用注册表」那一行（#1839 的回归钉）')

  console.log('verify-1839-async-registry：共 ' + total + ' 条断言，失败 ' + failed + ' 条')
  printGateResult(GATE, total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
})().catch(function (e: any) {
  console.log('FAIL 门禁自身抛错：' + String(e && e.stack ? e.stack : e))
  printGateResult(GATE, total, 1)
  process.exit(1)
})
