// tests/verify-1114-timer-exit.ts —— 工具等待结束之后，进程要能很快自然退出（#1114 第二批）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1114-timer-exit.ts
//
// 守的是什么（#1114 的现象）：工具层九份 withCap 原来各自写着同一段
//   Promise.race([真结果, new Promise(resolve => setTimeout(resolve, 上限毫秒))])
// 快的那一支赢了之后，等待定时器没人取消、句柄也没人清。于是每笔 deck_* 调用都会在事件循环里
// 留下一枚最长 15 秒（沙箱策略等待）的定时器，宿主在最后一次调用之后最长被多留 60 秒。
// #1114 第一批修好了壳层五处等待口；第二批把这些工具层等待收进共享实现（src/deck/shell/capped-wait.ts）。
//
// 这一条门禁分三层：
//   一、共享等待口自己的账（进程内）：快支赢、超时赢、对方抛错三条路都交出原来的形状，
//       跑完租约归零、本进程里不留 Timeout。
//   二、进程真的能退出（子进程，带对照）：子进程跑一笔「真结果很快、上限 3 秒」的等待，
//       它必须在远小于上限的时间里自己退出；退出时进程里不留 Timeout。
//       对照组故意用修复前的裸竞速，它必须被那枚定时器吊住直到上限 —— 证明本门禁量的是真现象，
//       不是一条恒绿的空判据。
//   三、超时那一支不能被 unref 弄丢（子进程）：上限 250 毫秒、真结果永不结算，子进程必须活到
//       结算并拿到 { ok:false, timedOut:true }。等待定时器 unref 之后，唯一让进程活到结算的
//       就是存活租约（#1157）；没有它子进程会提前带着退出码 0 收摊，文件里就什么都没有。
//
// 为什么非要在子进程里量（同 tests/verify-1146、verify-1157）：观测对象是「进程多久退出」这件事，
// 进程内观测不到。子进程的输出必须写文件、stdio 一律丢掉——管道本身是被引用的 Socket，
// 它会替子进程吊住事件循环，把要观测的现象抹掉。
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { withCap } from '../src/deck/shell/capped-wait.js'
import { inFlightLeaseSnapshot } from '../src/deck/shell/in-flight-lease.js'
import { planGates } from '../scripts/lib/discover-gates.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SELF_REL = 'tests/verify-1114-timer-exit.ts'

/** 父进程起子进程时用的两个环境变量：跑哪个场景、结果写到哪。 */
const ENV_MODE = 'DSH_1114_CHILD'
const ENV_OUT = 'DSH_1114_OUT'

/** 快支那一趟的上限：故意放大到 3 秒；修好之后子进程应当几百毫秒内退出。 */
const FAST_CAP_MS = 3000
/** 快支退出时间的上限：远小于 FAST_CAP_MS，又给解释器启动与模块加载留足余量。 */
const FAST_EXIT_LIMIT_MS = 1500
/** 超时那一趟的上限与判定余量：子进程必须活到约这么长才结算。 */
const TIMEOUT_CAP_MS = 250
const TIMEOUT_EARLY_MARGIN_MS = 30
/** 对照组那枚裸定时器的寿命：修复前的现场；子进程会被它吊这么久。 */
const LEAK_HOLD_MS = 800

/** 子进程场景：fast = 快支赢；timeout = 真结果永不结算；leak = 修复前的裸竞速（对照组）。 */
type ChildMode = 'fast' | 'timeout' | 'leak'

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

  const main = async function (): Promise<void> {
    if (mode === 'leak') {
      // 对照组：修复前的形状——快支赢了，等待定时器还挂着，而且是会被引用的。
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
      const result = await withCap(neverWait, TIMEOUT_CAP_MS)
      write('RESULT ' + JSON.stringify(result))
      write('TIMEOUTS ' + timeouts())
      write('ELAPSED ' + (Date.now() - started))
      write('CHILD-END')
      return
    }
    const result = await withCap(Promise.resolve('quick'), FAST_CAP_MS)
    write('RESULT ' + JSON.stringify(result))
    // 等一轮微任务与宏任务队列清空：定时器的清理就发生在这之前；再多等一轮 setImmediate，
    // 免得把「刚要清」误记成「没清」。
    await new Promise<void>(function (resolve) { setImmediate(resolve) })
    write('TIMEOUTS ' + timeouts())
    write('ELAPSED ' + (Date.now() - started))
    write('CHILD-END')
  }

  main().catch(function (e: unknown) {
    write('CHILD-CRASH ' + String((e && (e as Error).stack) || e))
    process.exitCode = 1
  })
}

/** 父进程那一半：起一个子进程跑一个场景，把它的进度读回来。 */
function runScenario(mode: ChildMode, tmpDir: string): { status: number | null; text: string; wallMs: number } {
  const out = join(tmpDir, mode + '.log')
  writeFileSync(out, '')
  const started = Date.now()
  const run = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mts', SELF_REL], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { [ENV_MODE]: mode, [ENV_OUT]: out }),
    // stdio 一律丢掉：管道是被引用的 Socket，会替子进程吊住事件循环（见文件头）。
    stdio: 'ignore',
    timeout: 30_000,
  })
  const text = existsSync(out) ? readFileSync(out, 'utf8') : ''
  return { status: run.status, text: text, wallMs: Date.now() - started }
}

let failed = false
let total = 0
const check = (ok: boolean, msg: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

/** 从子进程写下的一行取值；取不到回空串。 */
const lineOf = (text: string, name: string): string => {
  const hit = text.split(/\r?\n/).find(function (l) { return l.startsWith(name + ' ') })
  return hit ? hit.slice(name.length + 1).trim() : ''
}
const jsonOf = (text: string, name: string): unknown => {
  const raw = lineOf(text, name)
  if (!raw) return null
  try { return JSON.parse(raw) } catch (e) { return null }
}
/** 子进程留下的进度，判红时一屏看完。 */
const show = (text: string): string => text.split(/\r?\n/).filter(Boolean).join(' ／ ') || '（子进程什么都没写）'

/** 本进程里此刻还剩几枚 Timeout（与子进程那边同一口径）。 */
function timeoutCount(): number {
  return process.getActiveResourcesInfo().filter(function (name) { return name === 'Timeout' }).length
}

const childMode = process.env[ENV_MODE]
if (childMode === 'fast' || childMode === 'timeout' || childMode === 'leak') {
  runChild(childMode, String(process.env[ENV_OUT]))
} else {
  console.log('工具等待结束后进程退出时间门禁（#1114 第二批）')
  const baselineTimeouts = timeoutCount()
  const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-1114-'))
  try {
    // ── 甲、共享等待口自己的账（进程内）────────────────────────────────────────
    const fast = await withCap(Promise.resolve(42), FAST_CAP_MS)
    check(fast.ok === true && fast.value === 42, '甲1 快支赢：值原样交回（实得 ' + JSON.stringify(fast) + '）')
    check(timeoutCount() === baselineTimeouts, '甲1 快支赢之后本进程没留下 Timeout（现有 ' + timeoutCount() + ' 枚，之前 ' + baselineTimeouts + ' 枚）')

    const timedOut = await withCap(neverWait, TIMEOUT_CAP_MS)
    check(timedOut.ok === false && timedOut.timedOut === true, '甲2 超时支：如实回 { ok:false, timedOut:true }（实得 ' + JSON.stringify(timedOut) + '）')

    const rejected = await withCap(Promise.reject(new Error('对方自己失败')), FAST_CAP_MS)
    check(rejected.ok === false && rejected.timedOut === undefined, '甲3 对方自己失败：按「没等到」回 { ok:false }，不抛也不冒充超时（实得 ' + JSON.stringify(rejected) + '）')

    // 注入等待口（session-workdir 的虚拟时钟门禁用）：到点照样按时结算成超时。
    const injected = await withCap(neverWait, 20, function (ms: number): Promise<unknown> {
      return new Promise(function (resolve) { setTimeout(resolve, ms) })
    })
    check(injected.ok === false && injected.timedOut === true, '甲4 注入等待口时也按时结算成超时（实得 ' + JSON.stringify(injected) + '）')

    const afterUnit = inFlightLeaseSnapshot()
    check(afterUnit.holders === 0 && afterUnit.holding === false, '甲5 本进程跑完这些等待后租约账归零（' + JSON.stringify(afterUnit) + '）')

    // ── 乙、进程真的能退出（子进程，带对照）────────────────────────────────────
    const fastChild = runScenario('fast', tmpDir)
    const fastResult = jsonOf(fastChild.text, 'RESULT') as { ok?: unknown; value?: unknown } | null
    const fastTimeouts = Number(lineOf(fastChild.text, 'TIMEOUTS'))
    check(fastChild.status === 0, '乙1 快支那一趟子进程退出码是 0（实际 ' + String(fastChild.status) + '）')
    check(!!fastResult && fastResult.ok === true && fastResult.value === 'quick', '乙1 子进程里的快支拿到了值（实得 ' + JSON.stringify(fastResult) + '）')
    check(fastTimeouts === 0 && lineOf(fastChild.text, 'TIMEOUTS') !== '', '乙1 子进程退出前进程里不留 Timeout（实得 ' + lineOf(fastChild.text, 'TIMEOUTS') + '）')
    check(fastChild.wallMs < FAST_EXIT_LIMIT_MS, '乙2 快支那一趟远在上限（' + FAST_CAP_MS + ' 毫秒）之前就自己退出（实测 ' + fastChild.wallMs + ' 毫秒，门槛 ' + FAST_EXIT_LIMIT_MS + ' 毫秒）')
    check(fastChild.text.indexOf('CHILD-END') >= 0, '乙2 子进程自己走完了（没被提前掐断）：' + show(fastChild.text))

    const leakChild = runScenario('leak', tmpDir)
    const leakTimeouts = Number(lineOf(leakChild.text, 'TIMEOUTS'))
    check(leakChild.status === 0 && lineOf(leakChild.text, 'VALUE') === JSON.stringify('quick'), '乙3 对照组（修复前的裸竞速）快支照样赢（实得 ' + lineOf(leakChild.text, 'VALUE') + '）')
    check(leakTimeouts >= 1, '乙3 对照组退出前进程里还挂着一枚被引用的 Timeout（实得 ' + lineOf(leakChild.text, 'TIMEOUTS') + '）')
    check(leakChild.wallMs >= LEAK_HOLD_MS * 0.7, '乙4 对照组被那枚定时器吊住到上限附近才退出（实测 ' + leakChild.wallMs + ' 毫秒）—— 证明本门禁量得到「定时器留下就晚退出」这个真现象')
    check(fastChild.wallMs + 300 < leakChild.wallMs, '乙4 修好的那一趟明显比对照组早退出（' + fastChild.wallMs + ' 毫秒 vs ' + leakChild.wallMs + ' 毫秒）')

    // ── 丙、超时那一支不能被 unref 弄丢（子进程）──────────────────────────────
    const timeoutChild = runScenario('timeout', tmpDir)
    const timeoutResult = jsonOf(timeoutChild.text, 'RESULT') as { ok?: unknown; timedOut?: unknown } | null
    const timeoutElapsed = Number(lineOf(timeoutChild.text, 'ELAPSED'))
    check(timeoutChild.status === 0, '丙1 超时那一趟子进程退出码是 0（实际 ' + String(timeoutChild.status) + '）')
    check(!!timeoutResult && timeoutResult.ok === false && timeoutResult.timedOut === true, '丙1 子进程等到了超时结算（实得 ' + JSON.stringify(timeoutResult) + '，' + show(timeoutChild.text) + '）')
    check(Number.isFinite(timeoutElapsed) && timeoutElapsed >= TIMEOUT_CAP_MS - TIMEOUT_EARLY_MARGIN_MS, '丙2 子进程活到了 ' + TIMEOUT_CAP_MS + ' 毫秒那一端（实测 ' + lineOf(timeoutChild.text, 'ELAPSED') + ' 毫秒）—— 存活租约把进程留到了结算')
    check(Number(lineOf(timeoutChild.text, 'TIMEOUTS')) === 0, '丙2 超时结算后进程里不留 Timeout（实得 ' + lineOf(timeoutChild.text, 'TIMEOUTS') + '）')

    // ── 丁、本文件必须在 verify 链里（不挂进链就等于没跑）─────────────────────
    const mine = planGates(ROOT).filter(function (s) { return s.file.indexOf('verify-1114-timer-exit') >= 0 })
    check(mine.length === 1, '丁 本门禁挂在 verify 链里且只挂一次（实得 ' + mine.length + ' 次）')
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
