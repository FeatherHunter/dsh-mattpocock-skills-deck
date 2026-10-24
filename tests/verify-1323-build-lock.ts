// tests/verify-1323-build-lock.ts —— #1365 同工作区构建互斥文件锁（#1323 方案甲）的门禁
// 门禁归属: scripts/lib/build-lock.mts
// 门禁归属: scripts/build.mts
// 上面两行各守一处：锁本身的模块，与构建主流程里的接线（拿锁/复核/释放/兜底/人工闸）。
//
// 要守的事（票 #1365 的验收判据）：
//   ① 争锁串行：两个进程同时要锁，只有一个能进去，另一个排队等，前面放锁后面才能拿到；
//   ② 持锁者抛错即释放：真构建中途抛错，进程退出时锁必须已经没了，不留死锁；
//   ③ 陈旧锁可接管：持锁进程死了（pid 不在或心跳停了超有效期），等锁的人改名接管，不用人工介入；
//   ④ 超时错误含 pid 与锁路径：活锁等到上限还拿不到，报错退出，报错里写清持锁 pid 与锁文件在哪；
//   ⑤ 时间单源头：锁用的三档时间就是 YAML 生效的那三份，模块源码里没有第二份数字。
//
// 怎么测：临时目录当锁目录，起子进程当「另一个构建」互相抢。
// 子进程就是本文件自己（--driver）：生产路径（build.mts 调 acquireBuildLock）与驱动走同一份模块代码，
// 测的不是仿制品。子进程一律带 --import scripts/ts-hook.mts 起，与链上跑测试是同一套装载。
// 时间覆盖用 testOnlyOverrideTimes 把「等五分钟」缩到几秒（只缩等待上限，心跳与陈旧仍走 YAML 的真值，
// 除非某条用例特别说明）；生产路径永远不传覆盖，值永远从 YAML 来，第⑤条当场对账。
//
// 不测的两件事（都属于「今天的行为不许变」，本票没碰）：
//   · 真构建本身的内容与顺序（锁只管「谁先进」，不管里面干什么）；
//   · 两终端人工并发（那是验收动作，人在两台终端各跑一次构建看日志，本门禁只保子进程这一层）。
//
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1323-build-lock.ts

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const SELF = __filename
const HOOK = path.join(ROOT, 'scripts', 'ts-hook.mts')
const BUILD_LOCK_SRC = path.join(ROOT, 'scripts', 'lib', 'build-lock.mts')
const BUILD_SRC = path.join(ROOT, 'scripts', 'build.mts')
const VALUES_TS = path.join(ROOT, 'src', 'shared', 'time-config', 'src', 'values.ts')

let failed = false
let total = 0
const check = (ok: boolean, msg: string, detail?: string): void => {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok || !detail ? '' : '（' + detail + '）'))
  if (!ok) failed = true
}

/** 从生成物文本里取出构建锁的三档（与模块里读的是同一份文件，单源头的对账就落在这里）。 */
function readLockTimesFromValues(): Record<string, number> {
  const text: string = fs.readFileSync(VALUES_TS, 'utf8')
  const out: Record<string, number> = {}
  for (const m of text.matchAll(/export const (BUILD_LOCK_\w+): number = (\d+);/g)) {
    out[m[1]] = Number(m[2])
  }
  return out
}

interface DriverResult {
  status: number | null
  stdout: string
  stderr: string
}

/** 起一个驱动子进程（本文件 --driver）：同步等它跑完，输出全收下来。 */
function runDriver(args: string[]): DriverResult {
  const r: any = spawnSync(process.execPath, ['--import', pathToFileURL(HOOK).href, SELF, '--driver', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
  })
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') }
}

/** 起一个不等的驱动子进程（当「另一个构建」）：输出攒起来，调 done() 等它结束。 */
function startDriver(args: string[]): { done: () => Promise<DriverResult>; kill: () => void } {
  const child: any = spawn(process.execPath, ['--import', pathToFileURL(HOOK).href, SELF, '--driver', ...args], { cwd: ROOT })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d: any) => { stdout += String(d) })
  child.stderr.on('data', (d: any) => { stderr += String(d) })
  let settled = false
  let code: number | null = null
  const waiter: Array<(r: DriverResult) => void> = []
  child.on('close', (c: number | null) => {
    settled = true
    code = c
    const r: DriverResult = { status: c, stdout, stderr }
    for (const w of waiter.splice(0)) w(r)
  })
  return {
    done: () => new Promise<DriverResult>((resolve) => {
      if (settled) resolve({ status: code, stdout, stderr })
      else waiter.push(resolve)
    }),
    kill: () => { try { child.kill() } catch { /* 已经退了就不用管 */ } },
  }
}

/** 等到文件出现（毫秒）：等锁轮询与「另一个构建」起锁都是异步的，轮询比 sleep 固定时长可靠。 */
function waitForFile(abs: string, timeoutMs: number): boolean {
  const end: number = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (fs.existsSync(abs)) return true
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
  return fs.existsSync(abs)
}

/** 输出里取 DRIVER <键>=<值> 这一行。 */
function driverValue(out: string, key: string): string {
  const m: RegExpMatchArray | null = out.match(new RegExp('^DRIVER ' + key + '=(.*)$', 'm'))
  return m ? m[1].trim() : ''
}

/** 造一个「已经死了的 pid」：起一个立刻退出的子进程，它退了之后 pid 就是死的（跨平台都成立，不赌某个大数字没人用）。 */
function deadPid(): number {
  const r: any = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' })
  if (typeof r.pid !== 'number') throw new Error('拿不到刚退出子进程的 pid，造不出已死进程')
  return r.pid
}

async function driverMain(driverArgs: string[]): Promise<void> {
  const get = (name: string): string => {
    const hit: string | undefined = driverArgs.find((a) => a === name || a.startsWith(name + '='))
    if (!hit) return ''
    return hit.includes('=') ? hit.slice(name.length + 1) : ''
  }
  const repoRoot: string = get('--repoRoot') || ROOT
  const dir: string = get('--dir')
  const mode: string = get('--mode') || 'try-once'
  if (!dir) throw new Error('driver 缺 --dir（锁目录）')
  const mod: any = await import(pathToFileURL(BUILD_LOCK_SRC).href)
  if (mode === 'print-times') {
    const t: any = mod.loadBuildLockTimes(repoRoot)
    console.log('DRIVER times=' + JSON.stringify({ waitMs: t.waitMs, heartbeatMs: t.heartbeatMs, staleMs: t.staleMs }))
    return
  }
  if (mode === 'describe') {
    console.log('DRIVER describe=' + mod.describeBuildLock(dir))
    return
  }
  const waitOverride: string = get('--waitMs')
  const opts: any = { repoRoot, cacheDir: dir }
  if (waitOverride) opts.testOnlyOverrideTimes = { waitMs: Number(waitOverride) }
  if (mode === 'pulse-taken-over') {
    const lock: any = mod.acquireBuildLock(opts)
    process.on('exit', () => { try { mod.releaseBuildLock(lock) } catch { /* 退出兜底里不抛 */ } })
    // 模拟「另一个构建把我当成死锁接管了」：锁文件直接换成另一个 pid/主机/token。
    fs.writeFileSync(path.join(dir, 'dsh-build.lock'), JSON.stringify({
      pid: 12345, host: 'taker-host', startedAt: Date.now(), heartbeatAt: Date.now(), token: 'taker-token',
    }), 'utf8')
    const ok: boolean = mod.pulseBuildLock(lock)
    console.log('DRIVER pulse=' + String(ok))
    console.log('DRIVER pulseFailure=' + String(lock.lastPulseFailure || ''))
    return
  }
  if (mode === 'hold' || mode === 'hold-then-throw' || mode === 'try-once') {
    let lock: any = null
    try {
      lock = mod.acquireBuildLock(opts)
    } catch (e: any) {
      console.log('DRIVER ACQUIRE_FAIL ' + (e && e.message ? e.message : String(e)))
      process.exitCode = 3
      return
    }
    // 抛错也放锁：生产里靠 build.mts 的 process.on('exit') 兜底，驱动里复制同一做法——
    // 测的就是「这个兜底写法真能放掉锁」，而不是绕过它。
    process.on('exit', () => { try { mod.releaseBuildLock(lock) } catch { /* 退出兜底里不抛 */ } })
    console.log('DRIVER ' + (mode === 'try-once' ? 'ACQUIRED' : 'LOCKED') + ' waitedMs=' + lock.waitedMs + ' token=' + lock.token)
    if (mode === 'hold') {
      const holdMs: number = Number(get('--holdMs') || '3000')
      await new Promise<void>((resolve) => setTimeout(resolve, holdMs))
      mod.releaseBuildLock(lock)
      console.log('DRIVER RELEASED')
      return
    }
    if (mode === 'hold-then-throw') {
      throw new Error('驱动模拟真构建中途抛错（拿锁之后、释放之前）')
    }
    mod.releaseBuildLock(lock)
    console.log('DRIVER RELEASED')
    return
  }
  throw new Error('driver 不认识的 --mode=' + mode)
}

async function testMain(): Promise<void> {
  console.log('构建互斥文件锁（#1365，方案甲）')
  const tmpRoot: string = fs.mkdtempSync(path.join(os.tmpdir(), 'build-lock-test-'))
  try {
    // —— 第⑤条先行：时间单源头（后面几条用到的 staleMs 等都以这里对过账的值为准） ——
    const fromValues: Record<string, number> = readLockTimesFromValues()
    check(
      fromValues['BUILD_LOCK_WAIT_MS'] > 0 && fromValues['BUILD_LOCK_HEARTBEAT_MS'] > 0 && fromValues['BUILD_LOCK_STALE_MS'] > 0,
      '生成物里有构建锁的三档时间',
      '读到的是 ' + JSON.stringify(fromValues),
    )
    const pt: DriverResult = runDriver(['--repoRoot=' + ROOT, '--dir=' + tmpRoot, '--mode=print-times'])
    const printed: any = JSON.parse(driverValue(pt.stdout, 'times') || 'null')
    check(pt.status === 0 && printed !== null, '驱动能读出三档时间', '退出码 ' + String(pt.status) + '；输出：' + (pt.stdout + pt.stderr).slice(-300))
    if (printed !== null) {
      check(
        printed.waitMs === fromValues['BUILD_LOCK_WAIT_MS']
          && printed.heartbeatMs === fromValues['BUILD_LOCK_HEARTBEAT_MS']
          && printed.staleMs === fromValues['BUILD_LOCK_STALE_MS'],
        '模块读到的三档时间与 YAML 生效值一致（单源头，没有第二份数字）',
        '模块读到 ' + JSON.stringify(printed) + '，生成物是 ' + JSON.stringify(fromValues),
      )
    }
    const staleMs: number = fromValues['BUILD_LOCK_STALE_MS'] || 60000

    // —— 接线检查：构建主流程真调了锁（锁模块写得再对，不调等于没有） ——
    const buildSrc: string = fs.readFileSync(BUILD_SRC, 'utf8')
    for (const token of ['acquireBuildLock', 'releaseBuildLock', 'pulseBuildLock', '--break-stale-lock']) {
      check(buildSrc.includes(token), 'scripts/build.mts 里接了 ' + token, '接线被删掉的话锁模块再对也等于没有')
    }
    // —— #1393 第 1 项的防倒退：命中先查、没命中才拿锁，拿锁后再复核一次，兜底跟在拿锁之后 ——
    const firstHit: number = buildSrc.indexOf('tryBuildCacheHit(args)')
    const acquirePos: number = buildSrc.indexOf('acquireBuildLock(')
    const lastHit: number = buildSrc.lastIndexOf('tryBuildCacheHit(args)')
    const exitHook: number = buildSrc.indexOf("process.on('exit'")
    check(firstHit !== -1 && acquirePos !== -1 && firstHit < acquirePos, '缓存命中先查、没命中才拿锁（命中退出的那条路不碰锁）', '拿锁又跑到第一次缓存检查前面去了，命中也要白排队')
    check(lastHit !== -1 && lastHit > acquirePos, '拿锁成功后再复核一次缓存（排队时别人可能已构建完）', '拿锁后的复核被删掉的话，排队等完只能重复构建')
    check(exitHook !== -1 && exitHook > acquirePos, '退出兜底挂在拿锁之后（命中退出的那条路没拿锁）', '兜底挂到拿锁前面去了，命中退出会去释放一把没拿过的锁')
    // 只查代码顺序管不住文档：有人把这五份说明改回「命中也要拿锁」，代码没动、上面三条不会亮红，
    // 下一个人就会照着文档把代码也改回去。所以每份说明的关键短语也钉住。
    // 将来要改写这几句，改完同步改这里的短语——这是有意为之的钉子，不是漏跑。
    const sites: Array<{ file: string; phrase: string }> = [
      { file: 'scripts/build.mts', phrase: '命中直接退出的那条路不碰锁' },
      { file: 'scripts/build.mts', phrase: '这条路不拿锁' },
      { file: 'scripts/lib/build-lock.mts', phrase: '缓存命中直接退出的那条路不碰锁' },
      { file: 'docs/design/1323-build-mutex.md', phrase: '缓存命中的路径不拿锁' },
      { file: 'docs/agents/verification.md', phrase: '缓存命中直接退出的那条路不碰锁' },
      { file: 'docs/agents/parallel-sessions.md', phrase: '缓存命中的构建不拿锁' },
    ]
    for (const site of sites) {
      const text: string = fs.readFileSync(path.join(ROOT, site.file), 'utf8')
      check(text.includes(site.phrase), '说法还在：' + site.file + ' 仍写着「' + site.phrase + '」', '这处改回旧说法的话，下一个人会照着文档把代码也改回去；只改措辞就同步改本条门禁里的短语')
    }

    // —— 第①条：争锁串行 ——
    const dir1: string = path.join(tmpRoot, 'contend')
    fs.mkdirSync(dir1, { recursive: true })
    const holder = startDriver(['--repoRoot=' + ROOT, '--dir=' + dir1, '--mode=hold', '--holdMs=3000'])
    const lockFile1: string = path.join(dir1, 'dsh-build.lock')
    check(waitForFile(lockFile1, 15000), '持锁的子进程先把锁拿住（ contention 的前提成立）', '15 秒都没见到锁文件，持锁进程可能没起来')
    const waiter: DriverResult = runDriver(['--repoRoot=' + ROOT, '--dir=' + dir1, '--mode=try-once', '--waitMs=30000'])
    const holderRes = await holder.done()
    check(holderRes.status === 0, '持锁进程正常放锁退出', '退出码 ' + String(holderRes.status) + '；输出：' + (holderRes.stdout + holderRes.stderr).slice(-300))
    check(waiter.status === 0 && waiter.stdout.includes('DRIVER ACQUIRED'), '等锁的进程排到队、拿到锁才继续', '退出码 ' + String(waiter.status) + '；输出：' + (waiter.stdout + waiter.stderr).slice(-300))
    const waitedRaw: string = driverValue(waiter.stdout, 'ACQUIRED waitedMs')
    const waitedMs: number = Number((waitedRaw.split(' ')[0] || '-1').trim())
    check(waitedMs >= 2500, '等锁的人是等前面放锁才进去的（不是同时进去的）', '实际等了 ' + waitedMs + 'ms，持锁方占了 3000ms')
    holder.kill()

    // —— 第②条：持锁者抛错即释放 ——
    const dir2: string = path.join(tmpRoot, 'throw')
    fs.mkdirSync(dir2, { recursive: true })
    const crasher: DriverResult = runDriver(['--repoRoot=' + ROOT, '--dir=' + dir2, '--mode=hold-then-throw'])
    check(crasher.status === 1, '模拟真构建抛错，进程非零退出', '退出码 ' + String(crasher.status))
    check(!fs.existsSync(path.join(dir2, 'dsh-build.lock')), '抛错退出的进程没留下死锁（exit 兜底放掉了）', '锁文件还在，后面谁都拿不到锁')

    // —— 第③条：陈旧锁可接管 ——
    const dir3: string = path.join(tmpRoot, 'stale')
    fs.mkdirSync(dir3, { recursive: true })
    const then: number = Date.now() - staleMs * 10
    fs.writeFileSync(
      path.join(dir3, 'dsh-build.lock'),
      JSON.stringify({ pid: deadPid(), host: 'test-host', startedAt: then, heartbeatAt: then, token: 'fake-token' }),
      'utf8',
    )
    const taker: DriverResult = runDriver(['--repoRoot=' + ROOT, '--dir=' + dir3, '--mode=try-once', '--waitMs=10000'])
    check(taker.status === 0 && taker.stdout.includes('DRIVER ACQUIRED'), '死锁（进程不在了、心跳停了）能被改名接管', '退出码 ' + String(taker.status) + '；输出：' + (taker.stdout + taker.stderr).slice(-300))
    check(taker.stdout.includes('上一把锁已经没人管了'), '接管走的是「改名旧锁再建」那一路（日志如实说了）', taker.stdout.slice(-300))
    // try-once 拿到就放：锁文件已经不在了，文件里的新主人信息由持锁时的那次改名保证（改名是原子操作，输的人会改名失败回去重等）。

    // —— 锁被接管时，心跳检查要说清接管者是谁（构建停下时的报错要能直接指向接管者，而不是只说「没了或被接管」） ——
    const dir6: string = path.join(tmpRoot, 'pulse-taken')
    fs.mkdirSync(dir6, { recursive: true })
    const taken: DriverResult = runDriver(['--repoRoot=' + ROOT, '--dir=' + dir6, '--mode=pulse-taken-over'])
    const pulseOut: string = taken.stdout + taken.stderr
    check(driverValue(pulseOut, 'pulse') === 'false', '锁被接管时 pulse 返回假（调用方据此停下构建）', pulseOut.slice(-400))
    const pulseFailure: string = driverValue(pulseOut, 'pulseFailure')
    check(pulseFailure.includes('12345') && pulseFailure.includes('taker-host'),
      'pulse 的失败原因写清接管者 pid 与主机（不用翻别的日志就能找到是谁接管了）', pulseFailure || pulseOut.slice(-400))

    // —— 第④条：超时错误含 pid 与锁路径 ——
    const dir4: string = path.join(tmpRoot, 'timeout')
    fs.mkdirSync(dir4, { recursive: true })
    const now: number = Date.now()
    fs.writeFileSync(
      path.join(dir4, 'dsh-build.lock'),
      JSON.stringify({ pid: process.pid, host: 'test-host', startedAt: now, heartbeatAt: now, token: 'live-token' }),
      'utf8',
    )
    const timeout: DriverResult = runDriver(['--repoRoot=' + ROOT, '--dir=' + dir4, '--mode=try-once', '--waitMs=2000'])
    check(timeout.status === 3, '活锁等到上限拿不到就报错退出（不等、不抢）', '退出码 ' + String(timeout.status) + '；输出：' + (timeout.stdout + timeout.stderr).slice(-300))
    const timeoutOut: string = timeout.stdout + timeout.stderr
    check(timeoutOut.includes(String(process.pid)), '超时报错里写清持锁 pid（知道去看哪个进程）', timeoutOut.slice(-300))
    check(timeoutOut.includes(dir4), '超时报错里写清锁文件在哪（知道去看哪个目录）', timeoutOut.slice(-300))
    check(timeoutOut.includes('开始等') && timeoutOut.includes('已等约'), '超时报错里写清什么时候开始等、已经等了多久', timeoutOut.slice(-300))
    check(timeoutOut.includes('拿锁时间'), '超时报错里写清持锁人是什么时候拿的锁', timeoutOut.slice(-300))
    const desc4: DriverResult = runDriver(['--repoRoot=' + ROOT, '--dir=' + dir4, '--mode=describe'])
    check(desc4.stdout.includes('被持有'), '活锁的 describe 说的是「被持有」（不是无人接管）', desc4.stdout.slice(-200))

    // —— describe 的「没锁」一路 ——
    const dir5: string = path.join(tmpRoot, 'empty')
    fs.mkdirSync(dir5, { recursive: true })
    const desc5: DriverResult = runDriver(['--repoRoot=' + ROOT, '--dir=' + dir5, '--mode=describe'])
    check(desc5.stdout.includes('没有构建锁'), '空目录的 describe 说的是「没有构建锁」', desc5.stdout.slice(-200))
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      // 临时目录清不掉不判红（系统 tmp 会自己收），不断言。
    }
  }

  console.log('')
  console.log('共 ' + total + ' 条，' + (failed ? '有失败' : '全过'))
  if (failed) process.exit(1)
}

const isDriver: boolean = process.argv.includes('--driver')
if (isDriver) {
  driverMain(process.argv.slice(2)).catch((e: any) => {
    console.error('DRIVER_ERROR ' + (e && e.message ? e.message : String(e)))
    process.exit(1)
  })
} else {
  testMain().catch((e: any) => {
    console.error('FAIL 门禁自己抛错了：' + (e && e.message ? e.message : String(e)))
    process.exit(1)
  })
}
