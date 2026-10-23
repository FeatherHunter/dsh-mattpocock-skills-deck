// tests/verify-1392-disposed-timer.ts —— 门禁：插件运行实例被销毁之后，仍在飞的外部命令不许把宿主带走（#1392）
//
// 用户看到的样子：在市场里点一次「更新本插件」，大约三秒后整个 DSH 桌面端进程退出，
// 报 dsh: fatal load failure: CordisError: cannot create effect on inactive context。
// 原因不在更新逻辑本身：插件实例被宿主销毁之后，这一趟已经起好的 gh 子进程还在飞，
// 它落定时要建一个等待上限计时器（timer.timeout），而计时器是挂在已销毁实例上的 effect，
// 于是同步抛 INACTIVE_EFFECT；这一下没人接住，变成未处理拒绝，宿主按「大声失败」直接 exit(1)。
//
// 本门禁量五件事（都跑真源码，只把外部进程与计时器换成假件）：
//   A. runGh：计时器抛 INACTIVE_EFFECT 时 —— 返回失败信封（kind=disposed），不抛；
//      子进程被终止；gh 准入名额归还；子进程收尾的拒绝被接住（不产生未处理拒绝）。
//   B. runGh：计时器抛别的错时 —— 先收尾（名额归还、子进程终止）再把错误原样抛出，不静默吞。
//   C. execProc：同样两条路。它返回的失败对象没有 kind 字段，保持原形状。
//   D. 成功路径不变：命令正常结束返回 ok，名额只还一次，子进程不被无故终止。
//   E. runGh：计时器建出来之后实例才被销毁（计时器被撤销、Promise 以拒绝落定）—— 仍按原行为报
//      spawn 档失败；子进程终止、名额归还、拒绝被接住（这一条覆盖 race 那一路新增的收尾）。
//
// 为什么不能先判活再调用：这一层没有宿主上下文（ctx.active 不存在，ctx.fiber 是宿主内部字段），
// 唯一可靠的「已销毁」信号就是那次调用抛出的 INACTIVE_EFFECT。所以判据只看错误码，不看 message
// （message 文案会随框架版本变）。
//
// 门禁归属: src/refresh/rooms/host/git-execution.ts
// 门禁归属: src/shared/command-cleanup/src/command-cleanup.ts
//
// 用法（在插件根目录；不需要先构建，本门禁跑的是真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-1392-disposed-timer.ts
import { createRepoKeys } from '../src/refresh/rooms/host/git-execution.ts'
import { getGhLane, resetGhLaneForTest } from '../src/refresh/rooms/host/outbound-admission.ts'

let failed = false
let total = 0
const check = function (ok: unknown, msg: string): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
const sleep = function (ms: number): Promise<void> {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}

// 宿主框架在「实例已销毁」时抛出来的那个错误：判据只看 code，message 只是给人看的。
const inactiveError = function (): any {
  const e: any = new Error('cannot create effect on inactive context')
  e.code = 'INACTIVE_EFFECT'
  return e
}

// 一套假世界：假子进程、假计时器、假日志出口。opts.timerMode 决定计时器怎么坏。
const makeWorld = function (opts: any): any {
  const logs: any[] = []
  const handles: any[] = []
  const logCtx = {
    isEnabled: function (_level: string): boolean { return true },
    fire: function (level: string, event: string, fields: any): void {
      logs.push({ level: level, event: event, fields: (typeof fields === 'function') ? fields() : fields })
    },
  }
  const timer = {
    timeout: function (_ms: number): any {
      if (opts.timerMode === 'inactive') throw inactiveError()
      if (opts.timerMode === 'other') throw new Error('boom from timer')
      if (opts.timerMode === 'revoked') {
        // 计时器建出来之后实例才被销毁：框架撤销计时器时，它交回的 Promise 以拒绝落定（没有 code）。
        return new Promise(function (_resolve: any, reject: any) {
          setTimeout(function () { reject(new Error('Context has been disposed')) }, 0)
        })
      }
      return new Promise(function () {})
    },
  }
  const subprocess = {
    spawn: function (_req: any): any {
      let resolveDone: any = null
      let rejectDone: any = null
      let settled = false
      const done = new Promise(function (resolve, reject) { resolveDone = resolve; rejectDone = reject })
      const handle: any = {
        done: done,
        terminated: 0,
        terminate: function (): void {
          handle.terminated += 1
          // 真宿主终止子进程之后，done 可能以拒绝落定；这一拒绝必须被这一层接住，否则又会带走宿主。
          if (opts.terminateRejects && !settled) {
            settled = true
            rejectDone(new Error('subprocess terminated while plugin was disposed'))
          }
        },
        collected: {
          stdout: { readFrom: function () { return { text: opts.stdout != null ? opts.stdout : '{"ok":true}' } } },
          stderr: { readFrom: function () { return { text: '' } } },
        },
      }
      handles.push(handle)
      if (opts.autoFinish) {
        setTimeout(function () { if (!settled) { settled = true; resolveDone({ exitCode: 0 }) } }, 0)
      }
      return handle
    },
  }
  let ghPath: string | null = 'gh'
  const rk = createRepoKeys({
    subprocess: subprocess,
    timer: timer,
    fs: null,
    DEFAULT_CWD: 'D:/repo',
    TIMEOUT_MS: 30000,
    repoKeys: {},
    repoRoots: {},
    getGhPath: function (): string | null { return ghPath },
    setGhPath: function (v: string | null): void { ghPath = v },
    getGhLastError: function (): string | null { return null },
    setGhLastError: function (_v: string | null): void {},
    getPlatform: async function (): Promise<any> {
      return {
        resolveExecutable: async function (): Promise<string> { return 'C:/fake/gh.exe' },
        getHome: async function (): Promise<string> { return 'D:/home' },
        path: { join: function (...parts: string[]): string { return parts.join('/') } },
        fs: {},
      }
    },
    getWorkspaceStore: async function (): Promise<any> { return null },
    setCache: function (_v: any): void {},
    clearWorkspaceStore: function (): void {},
    namingSweepSoon: function (_ms: number): void {},
    getChainBackoff: undefined,
    parseGithubRepo: function (_text: string): any { return null },
    logCtx: logCtx,
    gate: null,
    getGate: undefined,
  })
  return { rk: rk, logs: logs, handles: handles }
}

// 把「抛出去」变成「拿到结果」，断言能写清楚是返回错了还是抛了。
const call = async function (fn: () => Promise<any>): Promise<any> {
  try { return { threw: false, value: await fn() } } catch (e) { return { threw: true, error: e } }
}

const unhandled: any[] = []
const onUnhandled = function (reason: any): void { unhandled.push(reason) }
process.on('unhandledRejection', onUnhandled)

const runGhArgs = ['issue', 'list', '--limit', '5']

async function scenarioA(): Promise<void> {
  console.log('\n== A. runGh：计时器在实例销毁后抛 INACTIVE_EFFECT ==')
  resetGhLaneForTest()
  const lane = getGhLane()
  const before = lane.snapshot()
  const world = makeWorld({ timerMode: 'inactive', terminateRejects: true })
  const got = await call(function () { return world.rk.runGh(runGhArgs, 'D:/repo', 'verify-1392') })
  await sleep(30)
  const after = lane.snapshot()
  check(got.threw === false, 'A1 runGh 不抛错，失败以信封返回（实际抛了：' + (got.threw ? String(got.error && got.error.message) : '无') + '）')
  check(got.threw === false && got.value.ok === false, 'A2 返回 ok:false（实得 ' + JSON.stringify(got.value) + '）')
  check(got.threw === false && got.value.kind === 'disposed', 'A3 失败类别是 disposed（实得 ' + (got.threw ? '抛错' : String(got.value && got.value.kind)) + '）')
  check(world.handles.length === 1 && world.handles[0].terminated === 1, 'A4 子进程被终止且只终止一次（实得 ' + (world.handles[0] ? world.handles[0].terminated : '没起进程') + '）')
  check(after.readInflight === 0, 'A5 gh 准入名额已归还（在飞 ' + after.readInflight + ' 个）')
  check(after.readDone === before.readDone + 1, 'A6 名额恰好归还一次（done ' + before.readDone + ' → ' + after.readDone + '）')
  check(unhandled.length === 0, 'A7 没有未处理的 Promise 拒绝（实得 ' + unhandled.length + ' 条）')
  const disposedRows = world.logs.filter(function (r) { return r.event === 'gh.exec' && r.fields && r.fields.kind === 'disposed' })
  check(disposedRows.length === 1, 'A8 落了一条 gh.exec kind=disposed 的常驻日志（实得 ' + disposedRows.length + ' 条）')
  check(disposedRows.length === 1 && typeof disposedRows[0].fields.cwdHash === 'string', 'A9 日志里带 cwdHash，能说出是哪一趟命令')
}

async function scenarioB(): Promise<void> {
  console.log('\n== B. runGh：计时器抛别的错 ==')
  resetGhLaneForTest()
  const lane = getGhLane()
  const before = lane.snapshot()
  const world = makeWorld({ timerMode: 'other', terminateRejects: true })
  const got = await call(function () { return world.rk.runGh(runGhArgs, 'D:/repo', 'verify-1392') })
  await sleep(30)
  const after = lane.snapshot()
  check(got.threw === true, 'B1 未知错误照旧抛出，不静默吞')
  check(got.threw === true && String(got.error && got.error.message) === 'boom from timer', 'B2 抛出来的是原来那个错误（实得 ' + (got.threw ? String(got.error && got.error.message) : '没抛') + '）')
  check(world.handles[0] && world.handles[0].terminated === 1, 'B3 抛之前也把子进程终止了（实得 ' + (world.handles[0] ? world.handles[0].terminated : '没起进程') + '）')
  check(after.readInflight === 0 && after.readDone === before.readDone + 1, 'B4 抛之前也把准入名额还了（done ' + before.readDone + ' → ' + after.readDone + '）')
  check(unhandled.length === 0, 'B5 没有未处理的 Promise 拒绝（实得 ' + unhandled.length + ' 条）')
}

async function scenarioC(): Promise<void> {
  console.log('\n== C. execProc：同样两条路 ==')
  resetGhLaneForTest()
  {
    const world = makeWorld({ timerMode: 'inactive', terminateRejects: true })
    const got = await call(function () { return world.rk.execProc(['git', 'rev-parse', '--show-toplevel'], 'D:/repo', 'verify-1392') })
    await sleep(30)
    check(got.threw === false, 'C1 execProc 不抛错，失败以结果返回')
    check(got.threw === false && got.value.ok === false && typeof got.value.error === 'string', 'C2 返回 ok:false 且带错误正文（实得 ' + JSON.stringify(got.value) + '）')
    check(got.threw === false && got.value.ok === false && got.value.error.indexOf('实例已销毁') >= 0, 'C3 错误正文说清是实例已销毁（实得 ' + (got.threw ? '抛错' : String(got.value && got.value.error)) + '）')
    check(got.threw === false && got.value.ok === false && got.value.kind === undefined, 'C4 失败对象不新增 kind 字段（保持 ProcFail 原形状）')
    check(world.handles[0] && world.handles[0].terminated === 1, 'C5 子进程被终止（实得 ' + (world.handles[0] ? world.handles[0].terminated : '没起进程') + '）')
    check(unhandled.length === 0, 'C6 没有未处理的 Promise 拒绝（实得 ' + unhandled.length + ' 条）')
  }
  {
    const world = makeWorld({ timerMode: 'other', terminateRejects: true })
    const got = await call(function () { return world.rk.execProc(['git', 'status'], 'D:/repo', 'verify-1392') })
    await sleep(30)
    check(got.threw === true, 'C7 execProc 的未知错误照旧抛出（实得 ' + (got.threw ? '抛了' : '没抛') + '）')
    check(world.handles[0] && world.handles[0].terminated === 1, 'C8 抛之前也终止了子进程（实得 ' + (world.handles[0] ? world.handles[0].terminated : '没起进程') + '）')
    check(unhandled.length === 0, 'C9 没有未处理的 Promise 拒绝（实得 ' + unhandled.length + ' 条）')
  }
}

async function scenarioD(): Promise<void> {
  console.log('\n== D. 成功路径不变 ==')
  resetGhLaneForTest()
  const lane = getGhLane()
  const before = lane.snapshot()
  const world = makeWorld({ timerMode: 'never', autoFinish: true })
  const got = await call(function () { return world.rk.runGh(runGhArgs, 'D:/repo', 'verify-1392') })
  await sleep(30)
  const after = lane.snapshot()
  check(got.threw === false && got.value.ok === true, 'D1 runGh 成功时照旧返回 ok:true（实得 ' + JSON.stringify(got.threw ? String(got.error && got.error.message) : got.value) + '）')
  check(got.threw === false && got.value.ok === true && got.value.text === '{"ok":true}', 'D2 成功路径的文本原样带回（实得 ' + (got.threw ? '抛错' : String(got.value && got.value.text)) + '）')
  check(world.handles[0] && world.handles[0].terminated === 0, 'D3 成功时不去终止已经结束的子进程（terminate 调用 ' + (world.handles[0] ? world.handles[0].terminated : 0) + ' 次）')
  check(after.readInflight === 0 && after.readDone === before.readDone + 1, 'D4 成功时名额也只还一次（done ' + before.readDone + ' → ' + after.readDone + '）')
  const world2 = makeWorld({ timerMode: 'never', autoFinish: true })
  const got2 = await call(function () { return world2.rk.execProc(['git', 'status'], 'D:/repo', 'verify-1392') })
  check(got2.threw === false && got2.value.ok === true && got2.value.code === 0, 'D5 execProc 成功时照旧返回 ok:true、code 0（实得 ' + JSON.stringify(got2.threw ? String(got2.error && got2.error.message) : got2.value) + '）')
}

async function scenarioE(): Promise<void> {
  console.log('\n== E. runGh：计时器建好之后实例才被销毁（计时器被撤销）==')
  resetGhLaneForTest()
  const lane = getGhLane()
  const before = lane.snapshot()
  const world = makeWorld({ timerMode: 'revoked', terminateRejects: false })
  const got = await call(function () { return world.rk.runGh(runGhArgs, 'D:/repo', 'verify-1392') })
  await sleep(30)
  const after = lane.snapshot()
  check(got.threw === false, 'E1 计时器被撤销时不抛错，失败以信封返回（实际抛了：' + (got.threw ? String(got.error && got.error.message) : '无') + '）')
  check(got.threw === false && got.value.ok === false, 'E2 返回 ok:false（实得 ' + JSON.stringify(got.threw ? '抛错' : got.value) + '）')
  check(got.threw === false && got.value.kind === 'spawn', 'E3 失败类别仍按原行为是 spawn（这一路与子进程自身失败分不开；实得 ' + (got.threw ? '抛错' : String(got.value && got.value.kind)) + '）')
  check(world.handles.length === 1 && world.handles[0].terminated === 1, 'E4 子进程被终止且只终止一次（实得 ' + (world.handles[0] ? world.handles[0].terminated : '没起进程') + '）')
  check(after.readInflight === 0, 'E5 gh 准入名额已归还（在飞 ' + after.readInflight + ' 个）')
  check(after.readDone === before.readDone + 1, 'E6 名额恰好归还一次（done ' + before.readDone + ' → ' + after.readDone + '）')
  check(unhandled.length === 0, 'E7 没有未处理的 Promise 拒绝（实得 ' + unhandled.length + ' 条）')
  const spawnRows = world.logs.filter(function (r) { return r.event === 'gh.exec' && r.fields && r.fields.kind === 'spawn' })
  check(spawnRows.length === 1, 'E8 落了一条 gh.exec kind=spawn 的常驻日志（实得 ' + spawnRows.length + ' 条）')
}

async function main(): Promise<void> {
  await scenarioA()
  await scenarioB()
  await scenarioC()
  await scenarioD()
  await scenarioE()
}

main().then(function (): void {
  process.off('unhandledRejection', onUnhandled)
  console.log('')
  if (failed) console.log('FAIL：' + total + ' 条断言里有失败')
  else console.log('OK：' + total + ' 条断言全部通过')
  if (failed) process.exitCode = 1
  const t: any = setTimeout(function (): void { process.exit(failed ? 1 : 0) }, 200)
  if (t && typeof t.unref === 'function') t.unref()
}, function (err: any): void {
  console.error('门禁脚本自身出错：', err)
  process.exitCode = 1
})
