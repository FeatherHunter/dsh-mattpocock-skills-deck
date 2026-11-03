// tests/verify-1852-async-gate-model.ts —— 额度闸的预算模型必须等异步注册表（#1852）
// 门禁归属: src/refresh/rooms/host/budget-model.ts
// 门禁归属: src/refresh/rooms/host/refresh-runtime.ts
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1852-async-gate-model.ts
//
// 为什么有这扇门禁：宿主接给刷新装配的 getTrackerRegistry 是异步函数（src/host/index.ts:80 返回 Promise），
// 闸的裁决口（refresh-gate.ts 的 slotOf）却是同步读。修复前装配处直接同步调它，模型恒为「未知」：
// 两桶水位不参与裁决、真实出站只记请求数落进不存在的桶（被闸吞掉）。这扇门禁按生产形状
// （真账本 + 真接线 + 异步注册表）验四件事，等价重构不假红：
//   一、会花钱的 send：回包 budgetKind 是 two-buckets、两次 send 只解析一次注册表（修复前恒 unknown）；
//   二、记账：noteStepOutbound 报的请求数真的进 rest 桶（修复前被「账本没有这个桶」吞掉）；
//   三、退路：注册表拒绝或抛错时回 unknown 但不崩、照常发（与修复前同一条退路）；
//   四、源码形状：send 里 await 了 budgetModel.ensure()，装配处不再同步调用注册表。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLedger } from '../src/refresh/rooms/host/quota-ledger.js'
import { createRefreshWiring } from '../src/refresh/rooms/host/refresh-runtime.js'
import { createBudgetModel } from '../src/refresh/rooms/host/budget-model.js'
import { noteStepOutbound } from '../src/refresh/kernel/step-pricing.js'
import { printGateResult } from './lib/gate-result.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'verify-1852-async-gate-model'
const CLOCK = 1700000000000
const TWO_BUCKETS = { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true }
const registryOf = function (budget: any): any { return { modules: function (): any[] { return [{ id: 'github', budget: budget }] } } }
let total = 0
let failed = false
const check = function (ok: any, msg: string): void {
  total += 1
  if (!ok) failed = true
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
}

/** 真账本：GitHub 两桶都建好、都同步过读数（所以闸读得到 known 的水位）。 */
function ledgerOf(): any {
  const base = createLedger({ now: function (): number { return CLOCK } })
  base.ensureBackend('github', { kind: 'two-buckets' })
  base.syncServer('github', {
    rest: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 },
    graphql: { limit: 5000, remaining: 5000, reset: CLOCK + 3600000 },
  }, CLOCK)
  return base
}

/** 生产形状的接线：真账本、不注入闸（要测的就是接线里那一份真闸）。 */
function wiringOf(src: any): any {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-1852-'))
  const ledger = ledgerOf()
  const w = createRefreshWiring({
    ctx: { on: function (): any { return function (): void {} }, get: function (): any { return undefined } },
    logCtx: { isEnabled: function (): boolean { return false }, fire: function (): void {} },
    canonicalKey: async function (x: any): Promise<string> { return String(x) },
    getCacheDir: async function (): Promise<string> { return cacheDir },
    ledger: ledger,
    getTrackerRegistry: src,
  })
  return { w: w, ledger: ledger }
}

/** 三种注册表来源：延迟 resolve（生产）、同步假件（门禁与老调用点）、坏掉（拒绝 / 同步抛错）。 */
function registrySource(mode: string): any {
  let calls = 0
  const src = function (): any {
    calls += 1
    if (mode === 'reject') return Promise.reject(new Error('registry down'))
    if (mode === 'throw') throw new Error('registry threw')
    if (mode === 'sync') return registryOf(TWO_BUCKETS)
    return new Promise(function (resolve: any): void { setTimeout(function (): void { resolve(registryOf(TWO_BUCKETS)) }, 5) })
  }
  return { src: src, calls: function (): number { return calls }, reset: function (): void { calls = 0 } }
}

const REQ = { source: 'panel.detail', category: 'user-action', kind: 'detail', backendId: 'github', workspaceKey: 'w-1' }
const perform = async function (): Promise<any> { noteStepOutbound({ requests: 1 }); return { requests: 1, points: 0 } }

;(async function () {
  // ---------- 一、口径读取器：异步解析 + 同步读 ----------
  {
    const src = registrySource('async')
    const model = createBudgetModel({ getTrackerRegistry: src.src })
    await model.ensure()
    check(model.budgetModelOf('github').kind === 'two-buckets', '异步注册表解析完之后，同步读到 two-buckets（修复前恒 unknown）')
    await model.ensure()
    check(src.calls() === 1, 'ensure() 幂等：两次调用只解析一次注册表（实得 ' + src.calls() + ' 次）')
    check(model.budgetModelOf('github').kind === 'two-buckets', '缓存就绪后 budgetModelOf 不再碰注册表（仍读到 two-buckets）')
  }
  {
    const src = registrySource('sync')
    const model = createBudgetModel({ getTrackerRegistry: src.src })
    check(model.budgetModelOf('github').kind === 'two-buckets', '同步假注册表在缓存冷的时候也直接可用（门禁与老调用点兼容）')
    await model.ensure()
    check(model.budgetModelOf('github').kind === 'two-buckets', '同步假注册表解析完仍是 two-buckets')
  }
  {
    const model = createBudgetModel({ getTrackerRegistry: registrySource('reject').src })
    await model.ensure()
    check(model.budgetModelOf('github').kind === 'unknown', '注册表拒绝时回 unknown（不编一个模型，也不抛）')
    const threw = createBudgetModel({ getTrackerRegistry: registrySource('throw').src })
    await threw.ensure()
    check(threw.budgetModelOf('github').kind === 'unknown', '注册表同步抛错时同样回 unknown（取不到声明不拦调用）')
  }

  // ---------- 二、生产形状：真接线 + 异步注册表，send 与记账都按两桶 ----------
  {
    const src = registrySource('async')
    const { w, ledger } = wiringOf(src.src)
    // 接线时 deck 工具桥也会异步问一次注册表（它自己 await，不属本票要测的那条链），等它问完再计数。
    await new Promise(function (r): void { setTimeout(r, 50) })
    src.reset()
    const r1 = await w.send(REQ, perform)
    check(!!r1 && r1.sent === true, '第一次 send：闸放行（sent=true）')
    check(!!r1 && r1.budgetKind === 'two-buckets', '第一次 send 的回包口径是 two-buckets（修复前恒 unknown，两桶水位不参与裁决）')
    check(!!r1 && r1.readKnown === true, '两桶读数已同步时 readKnown=true（修复前未知口径恒 false）')
    check(ledger.view('github', 'rest').used === 1, '这一笔真的记进 rest 桶（noteStepOutbound 报 1 条 → used=1；修复前被「账本没有这个桶」吞掉）')
    check(src.calls() === 1, 'send 等的是同一次注册表解析：只解析一次（实得 ' + src.calls() + ' 次）')
    const r2 = await w.send(REQ, perform)
    check(!!r2 && r2.budgetKind === 'two-buckets' && ledger.view('github', 'rest').used === 2, '第二次 send 照常记进 rest 桶（used=2）')
    check(src.calls() === 1, '第二次 send 也没有再解析注册表（仍 ' + src.calls() + ' 次）')
    check(w.gate.stats().accounted.requests === 2, '闸自己的对账累计是 2 条（真发多少记多少）')
  }

  // ---------- 三、退路：注册表坏掉时照常发、回 unknown、不崩 ----------
  for (const mode of ['reject', 'throw']) {
    const src = registrySource(mode)
    const { w } = wiringOf(src.src)
    let threw = null
    let r = null
    try { r = await w.send(REQ, perform) } catch (e) { threw = e }
    check(threw === null, '注册表' + (mode === 'reject' ? '拒绝' : '抛错') + '：send 不抛（闸按未知口径照常放行）')
    check(!!r && r.budgetKind === 'unknown' && r.sent === true, '注册表' + (mode === 'reject' ? '拒绝' : '抛错') + '：回包如实说 unknown、请求照发（实得 ' + JSON.stringify(r && r.budgetKind) + '）')
  }

  // ---------- 四、源码形状：回归钉 ----------
  const runtimeSrc = fs.readFileSync(path.join(ROOT, 'src/refresh/rooms/host/refresh-runtime.ts'), 'utf8')
  const modelSrc = fs.readFileSync(path.join(ROOT, 'src/refresh/rooms/host/budget-model.ts'), 'utf8')
  check(/await budgetModel\.ensure\(\)/.test(runtimeSrc), 'refresh-runtime.ts 的 send 里 await 了 budgetModel.ensure()（异步解析的唯一允许写法）')
  check(!/budgetModelOf: budgetModelOf/.test(runtimeSrc), '装配处不再把同步 budgetModelOf 直接注入闸（#1852 的回归钉）')
  check(/Promise\.resolve\(got\)\.then/.test(modelSrc) && /cache = v \|\| null/.test(modelSrc), 'budget-model.ts 仍是「解析一次 → 写缓存」的形状（退化成每笔现取就假绿）')

  console.log('verify-1852-async-gate-model：共 ' + total + ' 条断言，失败 ' + failed + ' 条')
  printGateResult(GATE, total, failed ? 1 : 0)
  process.exit(failed ? 1 : 0)
})().catch(function (e: any) {
  console.log('FAIL 门禁自身抛错：' + String(e && e.stack ? e.stack : e))
  printGateResult(GATE, total, 1)
  process.exit(1)
})
