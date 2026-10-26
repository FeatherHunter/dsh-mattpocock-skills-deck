// tests/verify-1114-timer-exit.ts —— 工具等待结束之后，进程要能很快自然退出（#1114 第二批）
// 门禁归属: src/deck/shell/capped-wait.ts
// 门禁归属: src/deck/shell/in-flight-lease.ts
// 门禁归属: src/deck/registration/register-options.ts
// 门禁归属: src/deck/registration/suggest-steps-register.ts
//
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1114-timer-exit.ts
//
// 守的是什么（#1114 的现象）：工具层原来各写一份同一段等待竞速
//   Promise.race([真结果, new Promise(resolve => setTimeout(resolve, 上限毫秒))])
// 真结果那一支赢了之后，等待定时器没人取消、句柄也没人清。于是每笔 deck_* 调用都会在事件循环里
// 留下一枚最长 15 秒（沙箱策略等待）的定时器，宿主在最后一次调用之后最长被多留 60 秒。
// #1114 第一批修好了壳层五处等待口；第二批把工具层、壳层、注册重试的等待统一收进
// src/deck/shell/capped-wait.ts，本门禁从七个方面钉住这个收口：
//
//   一、共享等待口自己的账（进程内）：真结果先到、超时先到、对方自己抛错三条路都交出原来的形状，
//       跑完租约归零、本进程里不留 Timeout。
//   二、进程真的能退出（子进程，带对照）：子进程跑一笔「真结果很快、上限 3 秒」的等待，
//       它必须在远小于上限的时间里自己退出；退出时进程里不留 Timeout。
//       对照组故意用修复前的裸竞速，它必须被那枚定时器吊住直到上限 —— 证明本门禁量的是真现象，
//       不是一条恒绿的空判据。
//   三、超时那一支不能被 unref 弄丢（子进程）：上限 250 毫秒、真结果永不结算，子进程必须活到
//       结算并拿到 { ok:false, timedOut:true }。等待定时器 unref 之后，唯一让进程活到结算的
//       就是存活租约（#1157）；没有它子进程会提前带着退出码 0 收摊，文件里就什么都没有。
//   四、工具里真实用到的等待上限（子进程）：工具层包沙箱策略用的是 15 秒，这一趟就拿这个真实
//       数字跑一笔「真结果先到」的等待，断言进程在 3 秒门槛之内退出 —— 这是票面要求的
//       「工具结束后进程多久退出」，不是只拿一个短上限做样子。
//   五、注册重试的等待只许走共享等待口（静态扫源码）：register-options.ts 与
//       suggest-steps-register.ts 里不许再出现自己写的 setTimeout；两份文件还都要从
//       in-flight-lease.ts 取 withInFlightLease，把整条重试链圈进存活租约。
//   六、注册重试的整条链必须活到登记结果写出来（子进程，两个反例）：工具服务晚两轮才就绪时，
//       九工具登记与建议工具登记都必须活过那两次等待、写出 RESULT；只把等待定时器 unref 而
//       不拿存活租约，子进程会在第一次等待里带着退出码 0 静默收摊，RESULT 永远不会出现。
//   七、真工具链（子进程）：createDeckContext(...).run 走真实装配，沙箱许可那一刻套着 15 秒的
//       等待上限；真结果先到之后进程不许为这枚定时器多留，必须远在门槛之内自己退出。
//
// 为什么非要在子进程里量（同 tests/verify-1146、verify-1157）：观测对象是「进程多久退出」这件事，
// 进程内观测不到。子进程的输出必须写文件、stdio 一律丢掉——管道本身是被引用的 Socket，
// 它会替子进程吊住事件循环，把要观测的现象抹掉。父进程那一半的公共骨架在 tests/lib/child-probe.ts。
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DECK_SANDBOX_TIMEOUT_MS } from '../src/shared/time-config/src/values.js'
import { withCap } from '../src/deck/shell/capped-wait.js'
import { inFlightLeaseSnapshot } from '../src/deck/shell/in-flight-lease.js'
import { hookDeckAgentTools } from '../src/deck/registration/register-options.js'
import { hookSuggestNextSteps } from '../src/deck/registration/suggest-steps-register.js'
import { createDeckContext } from '../src/deck/tools/context.js'
import * as budgetMod from '../src/refresh/kernel/host-budget.js'
import * as ledgerMod from '../src/refresh/rooms/host/quota-ledger.js'
import * as gateMod from '../src/refresh/rooms/host/refresh-gate.js'
import * as registryMod from '../src/tracker/registry/core.js'
import * as toolCostMod from '../src/refresh/kernel/tool-call-budget.js'
import { ROOT, lineOf, jsonOf, runChildScenario, show } from './lib/child-probe.ts'
import { makeDecideStub, chooseWorkspace } from './lib/deck-decide-stub.js'
import { planGates } from '../scripts/lib/discover-gates.ts'

const SELF_REL = 'tests/verify-1114-timer-exit.ts'

/** 父进程起子进程时用的两个环境变量：跑哪个场景、进度写到哪。 */
const ENV_MODE = 'DSH_1114_CHILD'
const ENV_OUT = 'DSH_1114_OUT'

/** 短上限那一趟：故意放大到 3 秒；修好之后子进程应当几百毫秒内退出。 */
const FAST_CAP_MS = 3000
/** 短上限那一趟的退出时间上限：远小于 FAST_CAP_MS，又给解释器启动与模块加载留足余量。 */
const FAST_EXIT_LIMIT_MS = 1500
/** 超时那一趟的上限与判定余量：子进程必须活到约这么长才结算。 */
const TIMEOUT_CAP_MS = 250
const TIMEOUT_EARLY_MARGIN_MS = 30
/** 对照组那枚裸定时器的寿命：修复前的现场；子进程会被它吊这么久。 */
const LEAK_HOLD_MS = 800
/** 真实工具上限那一趟的退出时间门槛：15 秒上限的等待不许把进程留过 3 秒。 */
const SANDBOX_EXIT_LIMIT_MS = 3000
/** 注册重试两趟的节奏与判定：工具服务晚两轮就绪，中间要等两次；子进程必须活过这两次等待。 */
const REGISTER_RETRIES = 5
const REGISTER_WAIT_MS = 300
const LATE_SERVICE_READS = 2
const RETRY_LOWER_MS = 400
const RETRY_UPPER_MS = 6000
/** 真工具链那一趟的退出门槛：远小于 15 秒等待上限，又给真实模块加载留足余量。 */
const REAL_CHAIN_EXIT_LIMIT_MS = 4000

/** 子进程场景：fast = 真结果先到；timeout = 真结果永不结算；leak = 修复前的裸竞速（对照组）；
 *  sandbox = 工具真实上限；register-retry = 九工具登记重试要活到登记；suggest-retry = 建议工具登记
 *  重试要活到登记；real-chain = 真 createDeckContext 工具链。 */
type ChildMode = 'fast' | 'timeout' | 'leak' | 'sandbox' | 'register-retry' | 'suggest-retry' | 'real-chain'

/** 一笔永远不结算的等待（超时那一趟真正会赢的只有等待口）。 */
const neverWait: Promise<never> = new Promise(function () { /* 故意不结算 */ })

/**
 * 子进程那一半：在真事件循环上摆出「一笔等待结束之后」的现场，把结果与进程里剩下的
 * Timeout 记到文件里，然后让进程自己决定什么时候退出（绝不调用 process.exit）。
 */
function runChild(mode: ChildMode, out: string): void {
  const write = (line: string): void => { appendFileSync(out, line + '\n') }
  const started = Date.now()
  const timeouts = (): number => process.getActiveResourcesInfo().filter(function (name) { return name === 'Timeout' }).length
  const settle = async function (result: unknown): Promise<void> {
    write('RESULT ' + JSON.stringify(result))
    // 等一轮宏任务队列清空：定时器的清理就发生在这之前；再多等一轮 setImmediate，
    // 免得把「刚要清」误记成「没清」。
    await new Promise<void>(function (resolve) { setImmediate(resolve) })
    write('TIMEOUTS ' + timeouts())
    write('ELAPSED ' + (Date.now() - started))
    write('CHILD-END')
  }

  const main = async function (): Promise<void> {
    if (mode === 'leak') {
      // 对照组：修复前的形状——真结果先到，等待定时器还挂着，而且是会被引用的。
      const value = await Promise.race([
        Promise.resolve('quick'),
        new Promise<string>(function (resolve) { setTimeout(function () { resolve('late') }, LEAK_HOLD_MS) }),
      ])
      write('VALUE ' + JSON.stringify(value))
      write('ACTIVE ' + JSON.stringify(process.getActiveResourcesInfo()))
      write('TIMEOUTS ' + timeouts())
      write('ELAPSED ' + (Date.now() - started))
      write('CHILD-END')
      return
    }
    if (mode === 'timeout') {
      await settle(await withCap(neverWait, TIMEOUT_CAP_MS))
      return
    }
    if (mode === 'sandbox') {
      // 工具层真实的上限：沙箱策略等待缺省 15 秒。真结果先到时，进程不该为这枚定时器多留十几秒。
      await settle(await withCap(Promise.resolve('tool-ok'), DECK_SANDBOX_TIMEOUT_MS))
      return
    }
    if (mode === 'register-retry') {
      // 九工具登记的重试链：表晚一轮就绪、工具服务再晚两轮。两次等待都走 unref 的 sleepOnce，
      // 单靠等待定时器托不住进程；必须由 withInFlightLease 把整条链圈住，才活得到登记那一步。
      const fakeName = 'fake_tool'
      const fakeTable = {
        names: [fakeName],
        tools: { [fakeName]: { run: async function (): Promise<unknown> { return { status: 'ok', text: '探针里的假工具不会被真调到' } } } },
        definitions: [{ name: fakeName, description: '分流复核用的假工具', parameters: { type: 'object', properties: {}, additionalProperties: false } }],
      }
      const svc = { register: function (): () => void { return function (): void { /* 假注册表只记有人来注册 */ } } }
      let reads = 0
      const ctx = { get tools(): unknown { reads += 1; return reads > LATE_SERVICE_READS ? svc : null } }
      let tableReads = 0
      const getTable = function (): Promise<unknown> { tableReads += 1; return Promise.resolve(tableReads > 1 ? fakeTable : null) }
      const report = function (info: unknown): void {
        const rec = (info || {}) as { ok?: unknown; reason?: unknown; ms?: unknown }
        if (rec.ok === true) { void settle({ ok: true, latencyMs: rec.ms }) } else { void settle({ ok: false, reason: String(rec.reason || '') }) }
      }
      hookDeckAgentTools(ctx, getTable, async function (): Promise<unknown> { return null }, report, { retries: REGISTER_RETRIES, waitMs: REGISTER_WAIT_MS })
      return
    }
    if (mode === 'suggest-retry') {
      // 建议工具登记的重试链：同样晚两轮就绪；没有租约时 await 在第一次 unref 等待里就断掉，RESULT 不会出现。
      const svc = { register: function (): () => void { return function (): void { /* 真假注册表同上 */ } } }
      let reads = 0
      const ctx = { get tools(): unknown { reads += 1; return reads > LATE_SERVICE_READS ? svc : null } }
      const res = await hookSuggestNextSteps(ctx, undefined, { retries: REGISTER_RETRIES, waitMs: REGISTER_WAIT_MS })
      await settle(res)
      return
    }
    if (mode === 'real-chain') {
      // 真装配：会话、后端、预算、判定出口都按生产接，只有 tracker 与沙箱策略是桩。
      // 沙箱策略立刻成功 → 那一刻的 15 秒等待上限必须被清掉，进程不许为它多留。
      const clock = 1700000000000
      const ledger = ledgerMod.createLedger({ now: function (): number { return clock } })
      const gate = gateMod.createGate({ ledger: ledger, now: function (): number { return clock } })
      ledger.ensureBackend('github', { kind: 'two-buckets' })
      ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: clock + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock + 3600000 } }, clock)
      const registry = registryMod.createRegistry({ logEvent: function (): void { /* 夹具不记日志 */ }, isEnabled: function (): boolean { return false } }, { matchesTimeout: 200 })
      const stub = {
        id: 'stub-1114',
        label: '桩',
        matches: async function (): Promise<boolean> { return false },
        budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false },
        create: function (): unknown {
          return {
            preflight: async function (): Promise<unknown> { return { ok: true } },
            list: async function (): Promise<unknown> { return { ok: true, data: [] } },
            getRepoPermissions: async function (): Promise<unknown> { return { ok: true, data: { push: true, triage: true } } },
          }
        },
      }
      const disp = registry.register(stub)
      const handle = { cwd: '/ws/1114', refId: 'o/r' }
      chooseWorkspace('/ws/1114', 'stub-1114')
      const deps = {
        gate: gate,
        registry: registry,
        budget: budgetMod,
        estimate: toolCostMod.estimateToolCost,
        costInputFrom: toolCostMod.toolCostInputFrom,
        handleFor: function (): unknown { return handle },
        backendCtx: {},
        now: function (): number { return clock },
        log: { fire: function (): void { /* 夹具不落日志 */ } },
        invalidate: function (): void { /* 夹具没有缓存要清 */ },
        decideBackend: makeDecideStub(registry),
        sandboxPolicyFor: async function (): Promise<unknown> { return { kind: 'ok' } },
      }
      const tool = createDeckContext(deps)
      const out = await tool.run({ agent: { session: { id: 's-1114', cwd: '/ws/1114' } } }, {})
      disp.dispose()
      await settle(out)
      return
    }
    await settle(await withCap(Promise.resolve('quick'), FAST_CAP_MS))
  }

  main().catch(function (e: unknown) {
    write('CHILD-CRASH ' + String((e && (e as Error).stack) || e))
    process.exitCode = 1
  })
}

/** 排除注释之后再看源码：注释里提到「setTimeout」不算自己写定时器。 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

/** 本进程里此刻还剩几枚 Timeout（与子进程那边同一口径）。 */
function timeoutCount(): number {
  return process.getActiveResourcesInfo().filter(function (name) { return name === 'Timeout' }).length
}

const childMode = process.env[ENV_MODE]
const childModes: readonly string[] = ['fast', 'timeout', 'leak', 'sandbox', 'register-retry', 'suggest-retry', 'real-chain']
if (childMode !== undefined && childModes.indexOf(childMode) >= 0) {
  runChild(childMode as ChildMode, String(process.env[ENV_OUT]))
} else {
  console.log('工具等待结束后进程退出时间门禁（#1114 第二批）')
  const baselineTimeouts = timeoutCount()
  const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-1114-'))
  const runScenario = function (mode: ChildMode) {
    return runChildScenario({ selfRel: SELF_REL, mode: mode, tmpDir: tmpDir, envMode: ENV_MODE, envOut: ENV_OUT, timeoutMs: 30_000 })
  }
  try {
    // ── 甲、共享等待口自己的账（进程内）────────────────────────────────────────
    const fast = await withCap(Promise.resolve(42), FAST_CAP_MS)
    check(fast.ok === true && fast.value === 42, '甲1 真结果先到：值原样交回（实得 ' + JSON.stringify(fast) + '）')
    check(timeoutCount() === baselineTimeouts, '甲1 真结果先到之后本进程没留下 Timeout（现有 ' + timeoutCount() + ' 枚，之前 ' + baselineTimeouts + ' 枚）')

    const timedOut = await withCap(neverWait, TIMEOUT_CAP_MS)
    check(timedOut.ok === false && timedOut.timedOut === true, '甲2 超时先到：如实回 { ok:false, timedOut:true }（实得 ' + JSON.stringify(timedOut) + '）')

    const rejected = await withCap(Promise.reject(new Error('对方自己失败')), FAST_CAP_MS)
    check(rejected.ok === false && rejected.timedOut === undefined, '甲3 对方自己失败：按「没等到」回 { ok:false }，不抛也不冒充超时（实得 ' + JSON.stringify(rejected) + '）')

    // 注入等待口（session-workdir 的虚拟时钟门禁用）：到点照样按时结算成超时。
    const injected = await withCap(neverWait, 20, function (ms: number): Promise<unknown> {
      return new Promise(function (resolve) { setTimeout(resolve, ms) })
    })
    check(injected.ok === false && injected.timedOut === true, '甲4 注入等待口时也按时结算成超时（实得 ' + JSON.stringify(injected) + '）')

    const afterUnit = inFlightLeaseSnapshot()
    check(afterUnit.holders === 0 && afterUnit.holding === false, '甲5 本进程跑完这些等待后租约账归零（' + JSON.stringify(afterUnit) + '）—— 这句话背后「一场竞速要扣着租约」的账本身由 verify-1157 守，这里只验共享等待口接上了它')

    // ── 乙、进程真的能退出（子进程，带对照）────────────────────────────────────
    const fastChild = runScenario('fast')
    const fastResult = jsonOf(fastChild.text, 'RESULT') as { ok?: unknown; value?: unknown } | null
    const fastTimeouts = Number(lineOf(fastChild.text, 'TIMEOUTS'))
    check(fastChild.status === 0, '乙1 短上限那一趟子进程退出码是 0（实际 ' + String(fastChild.status) + '）')
    check(!!fastResult && fastResult.ok === true && fastResult.value === 'quick', '乙1 子进程里的真结果先拿到了值（实得 ' + JSON.stringify(fastResult) + '）')
    check(fastTimeouts === 0 && lineOf(fastChild.text, 'TIMEOUTS') !== '', '乙1 子进程退出前进程里不留 Timeout（实得 ' + lineOf(fastChild.text, 'TIMEOUTS') + '）')
    check(fastChild.wallMs < FAST_EXIT_LIMIT_MS, '乙2 短上限那一趟远在上限（' + FAST_CAP_MS + ' 毫秒）之前就自己退出（实测 ' + fastChild.wallMs + ' 毫秒，门槛 ' + FAST_EXIT_LIMIT_MS + ' 毫秒）')
    check(fastChild.text.indexOf('CHILD-END') >= 0, '乙2 子进程自己走完了（没被提前掐断）：' + show(fastChild.text))

    const leakChild = runScenario('leak')
    const leakTimeouts = Number(lineOf(leakChild.text, 'TIMEOUTS'))
    check(leakChild.status === 0 && lineOf(leakChild.text, 'VALUE') === JSON.stringify('quick'), '乙3 对照组（修复前的裸竞速）真结果照样先到（实得 ' + lineOf(leakChild.text, 'VALUE') + '）')
    check(leakTimeouts >= 1, '乙3 对照组退出前进程里还挂着一枚被引用的 Timeout（实得 ' + lineOf(leakChild.text, 'TIMEOUTS') + '）')
    check(leakChild.wallMs >= LEAK_HOLD_MS * 0.7, '乙4 对照组被那枚定时器吊住到上限附近才退出（实测 ' + leakChild.wallMs + ' 毫秒）—— 证明本门禁量得到「定时器留下就晚退出」这个真现象')
    check(fastChild.wallMs + 300 < leakChild.wallMs, '乙4 修好的那一趟明显比对照组早退出（' + fastChild.wallMs + ' 毫秒 vs ' + leakChild.wallMs + ' 毫秒）')

    // ── 丙、超时那一支不能被 unref 弄丢（子进程）──────────────────────────────
    const timeoutChild = runScenario('timeout')
    const timeoutResult = jsonOf(timeoutChild.text, 'RESULT') as { ok?: unknown; timedOut?: unknown } | null
    const timeoutElapsed = Number(lineOf(timeoutChild.text, 'ELAPSED'))
    check(timeoutChild.status === 0, '丙1 超时那一趟子进程退出码是 0（实际 ' + String(timeoutChild.status) + '）')
    check(!!timeoutResult && timeoutResult.ok === false && timeoutResult.timedOut === true, '丙1 子进程等到了超时结算（实得 ' + JSON.stringify(timeoutResult) + '，' + show(timeoutChild.text) + '）')
    check(Number.isFinite(timeoutElapsed) && timeoutElapsed >= TIMEOUT_CAP_MS - TIMEOUT_EARLY_MARGIN_MS, '丙2 子进程活到了 ' + TIMEOUT_CAP_MS + ' 毫秒那一端（实测 ' + lineOf(timeoutChild.text, 'ELAPSED') + ' 毫秒）—— 存活租约把进程留到了结算')
    check(Number(lineOf(timeoutChild.text, 'TIMEOUTS')) === 0, '丙2 超时结算后进程里不留 Timeout（实得 ' + lineOf(timeoutChild.text, 'TIMEOUTS') + '）')

    // ── 丁、工具里真实用到的等待上限（子进程）──────────────────────────────────
    const sandboxChild = runScenario('sandbox')
    const sandboxResult = jsonOf(sandboxChild.text, 'RESULT') as { ok?: unknown; value?: unknown } | null
    check(sandboxChild.status === 0, '丁1 真实工具上限那一趟子进程退出码是 0（实际 ' + String(sandboxChild.status) + '）')
    check(!!sandboxResult && sandboxResult.ok === true && sandboxResult.value === 'tool-ok', '丁1 子进程里那笔工具等待拿到了真结果（实得 ' + JSON.stringify(sandboxResult) + '）')
    check(lineOf(sandboxChild.text, 'TIMEOUTS') === '0', '丁1 子进程退出前进程里不留 Timeout（实得 ' + lineOf(sandboxChild.text, 'TIMEOUTS') + '）')
    check(sandboxChild.wallMs < SANDBOX_EXIT_LIMIT_MS, '丁2 拿工具真实的 ' + DECK_SANDBOX_TIMEOUT_MS + ' 毫秒上限跑完，子进程在 ' + SANDBOX_EXIT_LIMIT_MS + ' 毫秒门槛内自己退出（实测 ' + sandboxChild.wallMs + ' 毫秒）—— 这就是票面要的「工具结束后进程多久退出」')

    // ── 戊、注册重试的等待只许走共享等待口，且整条链要扣着存活租约（静态）────────
    const waitSources = [
      'src/deck/registration/register-options.ts',
      'src/deck/registration/suggest-steps-register.ts',
    ]
    let waitBad = 0
    let waitImported = 0
    let leaseImported = 0
    for (const rel of waitSources) {
      const code = withoutComments(readFileSync(join(ROOT, rel), 'utf8'))
      if (/setTimeout\s*\(/.test(code)) {
        waitBad += 1
        console.log('  · ' + rel + ' 里还留着自己写的 setTimeout')
      }
      if (code.indexOf('capped-wait.js') >= 0 && code.indexOf('sleepOnce') >= 0) waitImported += 1
      if (code.indexOf('in-flight-lease.js') >= 0 && code.indexOf('withInFlightLease') >= 0) leaseImported += 1
    }
    check(waitBad === 0 && waitImported === waitSources.length && leaseImported === waitSources.length, '戊 注册重试的两份文件都从共享等待口取 sleepOnce、都拿 withInFlightLease 圈住重试链、不再自己写定时器（导入等待口 ' + waitImported + '/' + waitSources.length + ' 份，拿租约 ' + leaseImported + '/' + waitSources.length + ' 份，自己写定时器 ' + waitBad + ' 处）')

    // ── 己、注册重试整条链必须活到写登记结果（子进程，两个反例）──────────────
    const registerChild = runScenario('register-retry')
    const registerResult = jsonOf(registerChild.text, 'RESULT') as { ok?: unknown; latencyMs?: unknown } | null
    check(registerChild.status === 0, '己1 九工具登记重试那一趟子进程退出码是 0（实际 ' + String(registerChild.status) + '）')
    check(!!registerResult && registerResult.ok === true, '己2 工具服务晚两轮就绪时，九工具登记仍活到登记完成并写出结果（实得 ' + JSON.stringify(registerResult) + '，' + show(registerChild.text) + '）')
    check(registerChild.wallMs >= RETRY_LOWER_MS, '己3 子进程确实等过了那两次重试等待才写出结果（实测 ' + registerChild.wallMs + ' 毫秒，下限 ' + RETRY_LOWER_MS + ' 毫秒）—— 没有存活租约时它会在第一次等待里静默收摊，退出码还是 0')
    check(registerChild.wallMs < RETRY_UPPER_MS, '己3 子进程在门槛（' + RETRY_UPPER_MS + ' 毫秒）内自己退出（实测 ' + registerChild.wallMs + ' 毫秒）')
    check(lineOf(registerChild.text, 'TIMEOUTS') === '0', '己4 登记完成后进程里不留 Timeout（实得 ' + lineOf(registerChild.text, 'TIMEOUTS') + '）')

    const suggestChild = runScenario('suggest-retry')
    const suggestResult = jsonOf(suggestChild.text, 'RESULT') as { registered?: unknown; reason?: unknown } | null
    check(suggestChild.status === 0, '己5 建议工具登记重试那一趟子进程退出码是 0（实际 ' + String(suggestChild.status) + '）')
    check(!!suggestResult && suggestResult.registered === true, '己5 工具服务晚两轮就绪时，建议工具登记仍活到登记完成（实得 ' + JSON.stringify(suggestResult) + '，' + show(suggestChild.text) + '）')
    check(suggestChild.wallMs >= RETRY_LOWER_MS && suggestChild.wallMs < RETRY_UPPER_MS, '己6 建议工具那趟也活过了两次等待、又在门槛内自己退出（实测 ' + suggestChild.wallMs + ' 毫秒，区间 ' + RETRY_LOWER_MS + '～' + RETRY_UPPER_MS + ' 毫秒）')
    check(lineOf(suggestChild.text, 'TIMEOUTS') === '0', '己6 建议工具登记完成后进程里不留 Timeout（实得 ' + lineOf(suggestChild.text, 'TIMEOUTS') + '）')

    // ── 庚、真工具链跑完后进程不许为沙箱等待多留（子进程）──────────────────
    const chainChild = runScenario('real-chain')
    const chainResult = jsonOf(chainChild.text, 'RESULT') as { status?: unknown } | null
    check(chainChild.status === 0, '庚1 真工具链那一趟子进程退出码是 0（实际 ' + String(chainChild.status) + '）')
    check(!!chainResult && chainResult.status === 'ok', '庚1 真 createDeckContext 工具链跑出 ok 回执（实得 ' + JSON.stringify(chainResult) + '，' + show(chainChild.text) + '）')
    check(chainChild.wallMs < REAL_CHAIN_EXIT_LIMIT_MS, '庚2 真工具链跑完，子进程在 ' + REAL_CHAIN_EXIT_LIMIT_MS + ' 毫秒门槛内自己退出（实测 ' + chainChild.wallMs + ' 毫秒）—— 沙箱那枚 15 秒定时器必须被清掉')
    check(lineOf(chainChild.text, 'TIMEOUTS') === '0', '庚3 真工具链跑完后进程里不留 Timeout（实得 ' + lineOf(chainChild.text, 'TIMEOUTS') + '）')

    // ── 辛、本文件必须在 verify 链里（不挂进链就等于没跑）──────────────────────
    const mine = planGates(ROOT).filter(function (s) { return s.file.indexOf('verify-1114-timer-exit') >= 0 })
    check(mine.length === 1, '辛 本门禁挂在 verify 链里且只挂一次（实得 ' + mine.length + ' 次）')
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      check(false, '临时目录清理失败 ' + tmpDir + '：' + String((e && (e as Error).message) || e))
    }
  }

  console.log('工具等待结束后进程退出时间门禁：' + (total - Number(Boolean(failed))) + '/' + total + ' 条通过')
  if (failed) process.exit(1)
}
