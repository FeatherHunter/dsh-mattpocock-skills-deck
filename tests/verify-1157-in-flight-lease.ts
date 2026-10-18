// tests/verify-1157-in-flight-lease.ts —— 进程存活租约：有活没结算，进程就不许退（#1157）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1157-in-flight-lease.ts
//
// 守的是什么（#1157 的现象）：产品壳里五处等待口都按 #1114 把定时器 unref 掉了（提醒不拥有存活，
// 方向是对的），但一场还没结算的竞速里如果只剩下这一笔等待，Node 会因为「没有被引用的句柄」当场
// 收摊，**退出码还是 0** —— 选后端那一笔从未结算，本门禁落地前的实测是 77 毫秒退出、
// tests/verify-deck-repo-resolve.js 拆掉绕行后 13 条断言只跑到 7 条。
//
// 这一条把两件事分开钉住：
//   一、租约自己的账：并发几场只建一支句柄、取得与释放对称、work 抛错也放、放行函数只真正放一次。
//   二、存活这件事本身，而且要有对照：同样一笔「只剩 unref 过的等待」的竞速，
//       圈进租约要跑到 120 毫秒那一端（进程活到了结算），不圈租约的对照组要当场收摊。
//       对照组同时是观测机制的自检：它要是不收摊，说明这个环境里有别的句柄替它吊着，
//       本门禁的因果判据失效 —— 那时候该红，红得说清是环境的问题，不是产品回归。
//
// 为什么非要在子进程里看：「提前收摊」就是「进程没了」这件事本身，进程内观测不到（进程都没了）。
// 所以跑法是父进程起同文件的子进程，子进程把自己的进度写进临时文件，父进程读文件判定。
//
// 为什么子进程的输出必须写文件、绝不能走管道：管道本身是一个被引用的 Socket，它会替子进程吊住
// 事件循环，于是「提前收摊」永远不会发生，本门禁会变成一条恒绿的空门禁。同理子进程的 stdio 一律丢掉。
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as leaseModule from '../src/deck/shell/in-flight-lease.js'
import { inFlightLeaseSnapshot, withInFlightLease } from '../src/deck/shell/in-flight-lease.js'
import { planGates } from '../scripts/lib/discover-gates.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SELF_REL = 'tests/verify-1157-in-flight-lease.ts'

/** 父进程起子进程时用的两个环境变量：跑哪个场景、进度写到哪。 */
const ENV_MODE = 'DSH_1157_CHILD'
const ENV_OUT = 'DSH_1157_OUT'

/** 竞速的等待上限：真等这么久才叫「活到了结算」。 */
const WAIT_MS = 120
/** 并发第二场的等待上限：比上面短，用来证明「先结束的一场不会把那支共用句柄拆掉」。 */
const SHORT_MS = 30

/** 子进程场景：leased = 圈进租约；bare = 对照组的裸竞速（不圈租约）。 */
type ChildMode = 'leased' | 'bare'

/** 一笔永远不结算的等待：竞速里真正会赢的只有那笔 unref 过的等待。 */
const neverWait: Promise<never> = new Promise(function () { /* 故意不结算 */ })

/** 产品侧 realSleep 的形状：排完立刻 unref（#1114：只为到点提醒的定时器不许决定进程活多久）。 */
function unrefSleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    const timer = setTimeout(resolve, ms)
    const t = timer as unknown as { unref?: () => void }
    if (t && typeof t.unref === 'function') { try { t.unref() } catch (e) {} }
  })
}

/**
 * 子进程那一半：在真事件循环上摆出「这场竞速只剩一笔 unref 过的等待」这个现场。
 * 一切输出都自己写文件（原因见文件头），不用 console。
 */
function runChild(mode: ChildMode, out: string): void {
  const write = (line: string): void => {
    appendFileSync(out, line + '\n')
  }
  const started = Date.now()
  const raced = function (): Promise<unknown> {
    return Promise.race([neverWait, unrefSleep(WAIT_MS)])
  }

  const main = async function (): Promise<void> {
    if (mode === 'bare') {
      // 对照组：同样的竞速，不圈租约。修复前的产品现场就是这个样子。
      await raced()
      write('BARE-RESOLVED ' + (Date.now() - started))
      write('CHILD-END')
      return
    }

    // 第一场：圈进租约的竞速。取得租约之后立刻看账，证明这一刻句柄真的在。
    const first = withInFlightLease(raced)
    write('SNAP-IN ' + JSON.stringify(inFlightLeaseSnapshot()))
    // 第二场并发：账上该是两名持有者，而句柄仍然只有那一支（不是每场各拿一支）。
    const second = withInFlightLease(function () { return Promise.race([neverWait, unrefSleep(SHORT_MS)]) })
    write('SNAP-CONCURRENT ' + JSON.stringify(inFlightLeaseSnapshot()))
    await second
    write('SNAP-AFTER-SHORT ' + JSON.stringify(inFlightLeaseSnapshot()))
    await first
    write('LEASED-RESOLVED ' + (Date.now() - started))
    write('SNAP-OUT ' + JSON.stringify(inFlightLeaseSnapshot()))

    // 抛错的活也要把租约放掉：同步抛的路径最容易漏。
    let threw = false
    try {
      await withInFlightLease(function (): never { throw new Error('故意抛错：验租约放不放') })
    } catch (e) {
      threw = true
    }
    write('THROW-RELEASED ' + String(threw))
    write('SNAP-AFTER-THROW ' + JSON.stringify(inFlightLeaseSnapshot()))
    write('CHILD-END')
  }

  main().catch(function (e: unknown) {
    write('CHILD-CRASH ' + String((e && (e as Error).stack) || e))
    process.exit(1)
  })
}

/** 父进程那一半：起一个子进程跑一个场景，把它写下的进度读回来。 */
function runScenario(mode: ChildMode, tmpDir: string): { status: number | null; text: string; wallMs: number } {
  const out = join(tmpDir, mode + '.log')
  writeFileSync(out, '')
  const started = Date.now()
  const run = spawnSync(process.execPath, ['--import', './scripts/ts-hook.mts', SELF_REL], {
    cwd: ROOT,
    env: { ...process.env, [ENV_MODE]: mode, [ENV_OUT]: out },
    // stdio 一律丢掉：管道会替子进程吊住事件循环，把要观测的「提前收摊」抹掉（见文件头）。
    stdio: 'ignore',
    timeout: 60_000,
  })
  const text = existsSync(out) ? readFileSync(out, 'utf8') : ''
  return { status: run.status, text: text, wallMs: Date.now() - started }
}

let failed = 0
let total = 0
const check = (ok: boolean, msg: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

/** 把子进程写下的进度整理成一眼能看的样子，判红时好定位。 */
const show = (text: string): string => {
  const lines = text.split(/\r?\n/).filter(Boolean)
  return lines.length ? lines.join(' ／ ') : '（子进程什么都没写）'
}

/** 从子进程写下的进度里取一行；取不到回空串。 */
const lineOf = (text: string, name: string): string => {
  const hit = text.split(/\r?\n/).find((l) => l.startsWith(name + ' '))
  return hit ? hit.slice(name.length + 1).trim() : ''
}

/** 把 SNAP-xxx 那一行的 JSON 读成账目；读不出（或形状不对）时回 null，由断言如实判红。 */
const snapOf = (text: string, name: string): { holders: number; holding: boolean; handlesOpened: number } | null => {
  const raw = lineOf(text, name)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { holders?: unknown; holding?: unknown; handlesOpened?: unknown }
    if (typeof v.holders !== 'number' || typeof v.holding !== 'boolean' || typeof v.handlesOpened !== 'number') return null
    return { holders: v.holders, holding: v.holding, handlesOpened: v.handlesOpened }
  } catch (e) {
    return null
  }
}

const childMode = process.env[ENV_MODE]
const childOut = process.env[ENV_OUT]
if (childMode === 'leased' || childMode === 'bare') {
  runChild(childMode, String(childOut))
} else {
  console.log('进程存活租约门禁（#1157：有活没结算，进程就不许退）')
  const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-1157-'))
  try {
    // ── 甲、租约自己的账（进程内，不牵扯提前收摊）──────────────────────────────
    // 口径先写清：句柄是「计数 0→1 时建、回到 0 时清」（ADR 第 2 条），所以**串行**两场各建一支
    // 是设计、不是漏；「并发多场只有一支」才是这条判据要守的那一面（子进程那边另有同款一条）。

    // 甲1：返回值原样交回，跑完之后账上干干净净。
    const value = await withInFlightLease(function () { return Promise.resolve('值原样交回') })
    check(value === '值原样交回', '甲1 withInFlightLease 把 work 的返回值原样交回（实得「' + String(value) + '」）')
    const afterValue = inFlightLeaseSnapshot()
    check(afterValue.holders === 0 && afterValue.holding === false, '甲1 跑完之后持有者归零、句柄已清：' + JSON.stringify(afterValue))

    // 甲2：同时两场只建一支句柄；两场都结束之后句柄清掉，建过的支数不再涨。
    const openedBeforeTwo = inFlightLeaseSnapshot().handlesOpened
    let letGoFirst: () => void = function () { /* 下面立刻装上 */ }
    const firstStillRunning = new Promise<void>(function (resolve) { letGoFirst = resolve })
    const firstOut = withInFlightLease(function () { return firstStillRunning })
    const secondOut = withInFlightLease(function () { return new Promise<void>(function (r) { setTimeout(r, SHORT_MS) }) })
    const whileTwo = inFlightLeaseSnapshot()
    check(
      whileTwo.holders === 2 && whileTwo.handlesOpened === openedBeforeTwo + 1,
      '甲2 同时两场只建一支句柄（持有者 ' + whileTwo.holders + '、建过 ' + whileTwo.handlesOpened + ' 支，拿之前 ' + openedBeforeTwo + ' 支）',
    )
    await secondOut
    const afterShort = inFlightLeaseSnapshot()
    check(
      afterShort.holders === 1 && afterShort.holding === true,
      '甲2 短的那场结束、长的那场还在时，句柄仍在（先结束的没把共用的句柄拆掉）：' + JSON.stringify(afterShort),
    )
    letGoFirst()
    await firstOut
    const afterTwo = inFlightLeaseSnapshot()
    check(
      afterTwo.holders === 0 && afterTwo.holding === false && afterTwo.handlesOpened === openedBeforeTwo + 1,
      '甲2 两场都结束之后句柄清了、没有多建：' + JSON.stringify(afterTwo),
    )

    // 甲3：抛错的活也要放租约（这条最容易漏，漏了就是把后续所有活都吊住）。
    let threw = false
    try {
      await withInFlightLease(function (): never { throw new Error('故意抛错：验租约放不放') })
    } catch (e) {
      threw = true
    }
    const afterThrow = inFlightLeaseSnapshot()
    check(threw && afterThrow.holders === 0 && afterThrow.holding === false, '甲3 work 抛错也把租约放掉：' + JSON.stringify(afterThrow))

    // 甲4：本模块的对外面就是票面定的那一个干活的口加一个只读快照 —— 不让 acquire / release
    // 这类成对出口出去（一导出就会有人漏放；票 #1157 的方案一节写明了「跨函数持有」的用法出现再加）。
    const api = Object.keys(leaseModule).sort().join(',')
    check(
      api === 'inFlightLeaseSnapshot,withInFlightLease',
      '甲4 对外面只有 withInFlightLease 与只读快照，没有成对的 acquire / release 出口（实得 ' + api + '）',
    )

    // ── 乙、存活这件事（子进程，带对照）────────────────────────────────────────
    const leased = runScenario('leased', tmpDir)
    const leasedText = leased.text
    const snapIn = snapOf(leasedText, 'SNAP-IN')
    check(leased.status === 0, '乙1 圈了租约的子进程退出码是 0（实际 ' + String(leased.status) + '）')
    check(
      !!snapIn && snapIn.holders === 1 && snapIn.holding === true && snapIn.handlesOpened === 1,
      '乙1 取得租约那一刻账上是「一名持有者、句柄在、只建过一支」：' + JSON.stringify(snapIn),
    )
    const snapConcurrent = snapOf(leasedText, 'SNAP-CONCURRENT')
    check(
      !!snapConcurrent && snapConcurrent.holders === 2 && snapConcurrent.handlesOpened === 1,
      '乙2 并发两场时是两名持有者共用同一支句柄（不是每场各拿一支）：' + JSON.stringify(snapConcurrent),
    )
    const snapAfterShort = snapOf(leasedText, 'SNAP-AFTER-SHORT')
    check(
      !!snapAfterShort && snapAfterShort.holders === 1 && snapAfterShort.holding === true,
      '乙2 短的那一场结算后只剩长的那一场，句柄还在（先结束的没把共用的句柄拆掉）：' + JSON.stringify(snapAfterShort),
    )
    const resolved = lineOf(leasedText, 'LEASED-RESOLVED')
    const elapsed = Number(resolved)
    check(
      resolved !== '' && isFinite(elapsed) && elapsed >= WAIT_MS - 20,
      '乙3 圈了租约的竞速真的等到了 ' + WAIT_MS + ' 毫秒那一端（活到了结算，实得 ' + (resolved || '没等到') + ' 毫秒）：' + show(leasedText),
    )
    const snapOut = snapOf(leasedText, 'SNAP-OUT')
    check(
      !!snapOut && snapOut.holders === 0 && snapOut.holding === false && snapOut.handlesOpened === 1,
      '乙4 结算之后租约释放干净、句柄还是那一支：' + JSON.stringify(snapOut),
    )
    const snapAfterThrow = snapOf(leasedText, 'SNAP-AFTER-THROW')
    check(
      lineOf(leasedText, 'THROW-RELEASED') === 'true' && !!snapAfterThrow && snapAfterThrow.holders === 0,
      '乙4 子进程里那条抛错的活也把租约放掉了（放过：' + lineOf(leasedText, 'THROW-RELEASED') + '，账目：' + JSON.stringify(snapAfterThrow) + '）',
    )
    check(leasedText.includes('CHILD-END'), '乙5 子进程自己走完了（没被提前掐断）：' + show(leasedText))

    const bare = runScenario('bare', tmpDir)
    check(
      bare.status === 0 && !bare.text.includes('BARE-RESOLVED'),
      '乙6 对照组（不圈租约）当场收摊、退出码仍是 0，什么都没写下（实测 ' + bare.wallMs + ' 毫秒退出、'
        + show(bare.text) + '）—— 这就是 #1157 的现象本身，也是本门禁分得出「活到结算」与「提前收摊」的证据',
    )
    check(
      bare.wallMs < leased.wallMs,
      '乙6 对照组比圈了租约的那一趟先退出（' + bare.wallMs + ' 毫秒 vs ' + leased.wallMs + ' 毫秒）',
    )

    // ── 丙、本门禁自己不欠账：跑完这些之后不许留租约（留了会把整条链吊住）──────
    const finalSnap = inFlightLeaseSnapshot()
    check(
      finalSnap.holders === 0 && finalSnap.holding === false,
      '丙 本门禁跑完不留租约（持有者 ' + finalSnap.holders + '、句柄在不在 ' + String(finalSnap.holding) + '）',
    )

    // ── 丁、本文件必须在 verify 链里（不挂进链就等于没跑；挂重了会跑两遍；#1125 起问规划函数）──────
    {
      const mine = planGates(ROOT).filter((s) => s.file.indexOf('verify-1157-in-flight-lease') >= 0)
      check(mine.length === 1, '丁 本门禁挂在 verify 链里且只挂一次（实得 ' + mine.length + ' 次）')
    }
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      check(false, '临时目录清理失败 ' + tmpDir + '：' + String((e && (e as Error).message) || e))
    }
  }

  console.log('进程存活租约门禁：' + (total - Number(Boolean(failed))) + '/' + total + ' 条通过')
  if (failed) process.exit(1)
}
