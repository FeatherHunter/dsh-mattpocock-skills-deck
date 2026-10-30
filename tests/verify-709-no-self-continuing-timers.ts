// tests/verify-709-no-self-continuing-timers.ts —— #709 行为断言：退避算术与一次评估的 REST 条数
//
// 这个文件原先还兼着一道「全库不再有自续定时器」的源码文本门禁：读 src/** 与 src/client/** 的
// .js 文本、扫 setInterval 与自名递归排期、钉住旧名字不许回来。那种断言的对象是手写源码的文本，
// 等价重构（改写法、搬文件、改注释）就会变红，2026-10 按维护者口径整段撤掉。留下来的两段断言的
// 都是**跑起来的结果**：
//   ① 把 src/refresh/kernel/failure-backoff.ts 的退避纯函数真跑一遍（档位、推进、缓存寿命、预检寿命）；
//   ② 拼一个最小宿主接一次真的 wf.chain 求值，数这一轮对外问了几条 REST。
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// 时间压缩：本门的墙钟时间全花在「等超时」上 —— 那套最小宿主给 repoKeys 的 timer 是按 TIMEOUT_MS=30000
// 排的每操作预算，假进程几十微秒就回，预算没人清掉，于是进程要空等 30 秒才肯退出（实测 30.1 秒里 30 秒是它）。
// 压缩成虚拟时间以后真实只等几毫秒。这一段里两条断言都不看时间：退避算术是纯函数（喂进去的毫秒数都是字面量），
// 「一次评估的 REST 条数」数的是假进程的 spawn 次数 —— 假进程的 done 是已经落定的 Promise，竞速里永远赢过定时器，
// 虚拟时钟怎么走都不改变这个次序。所以断言一条没动；理由、两条不能破的语义与边界见 tests/lib/time-compress.js 文件头。
// 本文件原先兼的那道「全库不再有自续定时器」源码文本门禁已于 2026-10 整段撤掉（见文件头第 3～5 行），
// 现在留下的两段都是「跑起来的结果」，与真实触发时刻无关。
import { installTimeCompression, uninstallTimeCompression } from './lib/time-compress.js'
import { CHAIN_BACKOFF_MS, CHAIN_ALL_GREEN_TTL_MS, PREFLIGHT_TTL_MS } from '../src/shared/time-config/values.js'

// 这一段假件只落在「起进程」那一处接缝上，下面三类形状就是那处接缝的账本条目与请求。
// 三种用途（git 探远端、gh 探登录与可达、gh 取当前用户名）都从同一个 spawn 走，
// 所以账本里只留 argv 与「这一笔算不算 REST」两个字段，够后面按命令分类数数用。
interface RecordedSpawn { argv: string[]; rest: boolean }
interface SpawnRequest { argv?: unknown[]; cwd?: string; stdio?: Record<string, unknown>; graceMs?: number }
interface FakeReply { code: number; stdout: string }

// 装载时间压缩必须在任何断言之前：它把全局定时器换成虚拟时钟，退避与预检那些「等超时」的路径
// 才不会真等满 30 秒；收工（文件末尾汇总之后）必须还原，多扇门禁同进程跑时不能把虚拟时钟留给后面。
installTimeCompression()

let failed = false
let total = 0
function check(ok: boolean, msg: string, detail?: string): void {
  total++
  if (ok) console.log('  PASS ' + msg)
  else { failed = true; console.log('  FAIL ' + msg + (detail ? ' — ' + detail : '')) }
}

console.log('== #709 行为断言：退避算术 + 一次评估的 REST 条数 ==')

console.log('\n— 退避算术本身：把纯函数真跑一遍 —')
{
  // 这一段是功能断言，不是查字符串：把退避做坏（例如让它永远停在第 0 档、或者忽略「有进展回快档」），
  // 下面这几条会立刻红。门禁只查「函数在不在」是挡不住这种改法的。
  const bo = await import('../src/refresh/kernel/failure-backoff.js')
  const budget = await import('../src/refresh/kernel/host-budget.js')
  const limits = {
    backoffMs: CHAIN_BACKOFF_MS,
    allGreenTtlMs: CHAIN_ALL_GREEN_TTL_MS,
    preflightTtlMs: PREFLIGHT_TTL_MS,
    preflightRetryAfterFailure: budget.PREFLIGHT_RETRY_AFTER_FAILURE,
  }
  check(limits.backoffMs.length === 4, '退避序列有 4 档')
  check(bo.backoffDelayMs(0, limits) === 8000, '第 0 档 = 8 秒')
  check(bo.backoffDelayMs(1, limits) === 30000, '第 1 档 = 30 秒')
  check(bo.backoffDelayMs(2, limits) === 120000, '第 2 档 = 2 分钟')
  check(bo.backoffDelayMs(3, limits) === 300000, '第 3 档 = 5 分钟')
  check(bo.backoffDelayMs(99, limits) === 300000, '超到第 99 档仍停在最慢那档（不回绕、不归零）')
  // 连续无进展：0 → 1 → 2 → 3 → 停
  let step = 0
  step = bo.advanceChainStep(step, false, limits); check(step === 1, '无进展：退到第 1 档')
  step = bo.advanceChainStep(step, false, limits); check(step === 2, '无进展：退到第 2 档')
  step = bo.advanceChainStep(step, false, limits); check(step === 3, '无进展：退到第 3 档')
  step = bo.advanceChainStep(step, false, limits); check(step === 3, '无进展：停在最慢那档不越界')
  step = bo.advanceChainStep(step, true, limits); check(step === 0, '有进展：立刻回第一档（快档）')
  // 全绿缓存 30 分钟
  const green = { step: 0, evaluatedAtMs: 1_000_000, allGreen: true }
  check(bo.chainCacheUsable(green, 1_000_000 + 29 * 60_000, limits) === true, '全绿后 29 分钟：缓存仍能用')
  check(bo.chainCacheUsable(green, 1_000_000 + 30 * 60_000, limits) === false, '全绿后满 30 分钟：缓存过期')
  check(bo.chainCacheUsable({ step: 0, evaluatedAtMs: 0, allGreen: false }, 1_000_000, limits) === false, '没求过值 / 没全绿：一律当不能用')
  check(bo.chainCacheUsable(green, 999_000, limits) === false, '时钟回拨（now 早于上次求值）：当不能用')
  const vCached = bo.chainRefreshVerdict(green, 1_000_000 + 60_000, limits)
  check(vCached.needed === false && vCached.reason === 'all-green-cached', '全绿缓存期内：不重算，原因代号 all-green-cached')
  const vTooSoon = bo.chainRefreshVerdict({ step: 0, evaluatedAtMs: 1_000_000, allGreen: false }, 1_000_000 + 1000, limits)
  check(vTooSoon.needed === false && vTooSoon.waitMs === 7000, '刚求值过 1 秒：不重算，还差 7000 毫秒')
  const vDue = bo.chainRefreshVerdict({ step: 0, evaluatedAtMs: 1_000_000, allGreen: false }, 1_000_000 + 9000, limits)
  check(vDue.needed === true, '过了 8 秒：该重算了')
  // 环境预检寿命 10 分钟
  check(bo.preflightUsable(true, 2_000_000, 2_000_000 + 9 * 60_000, limits) === true, '预检成功 9 分钟：结果仍能用')
  check(bo.preflightUsable(true, 2_000_000, 2_000_000 + 10 * 60_000, limits) === false, '预检成功满 10 分钟：结果过期')
  check(bo.preflightUsable(false, 2_000_000, 2_000_000 + 1000, limits) === false, '预检失败：不缓存（一律当不能用）')
  check(bo.preflightRetryAllowed(0, limits) === true, '预检失败第 0 次：允许立刻重试')
  check(bo.preflightRetryAllowed(1, limits) === true, '预检失败第 1 次：仍允许（上限就是 1 次）')
  check(bo.preflightRetryAllowed(2, limits) === false, '预检失败第 2 次：不许再连环重试（防重试风暴）')
}

console.log('\n— 一次评估里环境预检只花一次（断言取数路径本身） —')
{
  // 这一段不断言任何内部变量。它把真实的那几块（repoKeys 的 runGh、platformChannel 那条 exec 的形状、
  // detectionService、detectChain 本身、github 后端模块）拼成一个最小宿主，接一次真的 wf.chain 求值，
  // 在一层假的「起进程」接缝上数：**这一轮到底对外问了几条 REST**。
  // 从前一次评估是 5 条（登录态 ×2、仓库可达 ×2，另加取当前登录用户名 1 条），本票要求降到 3 条。
  const ROOTDIR = join(dirname(fileURLToPath(import.meta.url)), '..')
  const imp = (p: string) => import(pathToFileURL(p).href)

  // 假进程的账本：每一笔「起进程」都记下来，并按 argv 回一份该命令该有的输出。
  function makeHost() {
    const spawns: RecordedSpawn[] = []
    const replyFor = (argv: string[]): FakeReply => {
      const rest = argv.slice(1).map(String)
      const a = rest.join(' ')
      if (/git(\.exe)?$/i.test(String(argv[0] || ''))) {
        return (a.indexOf('remote get-url origin') >= 0)
          ? { code: 0, stdout: 'git@github.com:FeatherHunter/dsh-mattpocock-skills-deck.git\n' }
          : { code: 0, stdout: '' }
      }
      if (a === '--version') return { code: 0, stdout: 'gh version 2.62.0 (2025-01-01)\n' }
      if (a === 'auth status') return { code: 0, stdout: 'github.com\n  ok Logged in to github.com account FeatherHunter (keyring)\n' }
      if (a.indexOf('api user') === 0) return { code: 0, stdout: 'FeatherHunter\n' }
      if (a.indexOf('api repos/') === 0) return { code: 0, stdout: '{}\n' }
      if (a.indexOf('repo view') === 0) return { code: 0, stdout: 'FeatherHunter/dsh-mattpocock-skills-deck\n' }
      return { code: 0, stdout: '{}\n' }
    }
    // 「算 REST」判据与票面同一口径：gh auth status 与 gh api 这两类才去 GitHub；`--version` 探 gh 存不存在不算。
    const isRest = (argv: string[]): boolean => {
      const rest = argv.slice(1).map(String)
      if (rest.length === 1 && rest[0] === '--version') return false
      return rest.some((x) => x === 'auth' || x === 'api')
    }
    const spawn = (req?: SpawnRequest) => {
      const argv = ((req && req.argv) || []).map(String)
      const out = replyFor(argv)
      spawns.push({ argv: argv, rest: isRest(argv) })
      return { done: Promise.resolve({ exitCode: out.code }), collected: { stdout: { readFrom: () => ({ text: out.stdout }) }, stderr: { readFrom: () => ({ text: '' }) } }, terminate() {} }
    }
    const platform = {
      resolveExecutable: async (n) => (String(n) === 'gh' ? 'C:/fake/gh.exe' : String(n) === 'git' ? 'C:/fake/git.exe' : null),
      fs: {
        resolve: async (p) => String(p),
        readText: async () => 'origin: backends/github/tracker.js\n\n后端：github\n',
        exists: async () => true,
        listDir: async () => [],
      },
      path: { join: (a, b) => String(a || '') + '/' + String(b || '') },
      env: { get: () => undefined },
      getHome: async () => 'C:/Users/fake',
      os: 'win32',
    }
    let ghPath = null
    const repoKeys = repoKeysMod.createRepoKeys({
      subprocess: { spawn: spawn },
      timer: { timeout: (ms) => new Promise((r) => setTimeout(() => r({ exitCode: -1, signal: 'timeout' }), ms)) },
      fs: null, DEFAULT_CWD: ROOTDIR, TIMEOUT_MS: 30000, repoKeys: {}, repoRoots: {},
      getGhPath: () => ghPath, setGhPath: (v) => { ghPath = v }, getGhLastError: () => null, setGhLastError: () => {},
      getPlatform: async () => platform, getWorkspaceStore: async () => null,
      setCache: () => {}, clearWorkspaceStore: () => {}, namingSweepSoon: () => {}, getChainBackoff: async () => null,
      parseGithubRepo: (s) => {
        const m = /github\.com[:/]([^/]+)\/([^/#?]+)/i.exec(String(s || ''))
        return m ? { owner: m[1], name: m[2].replace(/\.git$/, '') } : null
      },
      logCtx: null,
    })
    // 第二条出口的形状与 platformChannel 的 detectionExec 一致（都从 subprocess.spawn 起 gh）。
    const detectionExec = async (cmd: unknown, args?: unknown[], opts?: { cwd?: string }) => {
      const h = spawn({ argv: [String(cmd)].concat(args || []), cwd: (opts && opts.cwd) || ROOTDIR, stdio: {}, graceMs: 2000 })
      const outcome = await h.done
      return { stdout: h.collected.stdout.readFrom(0).text, stderr: '', code: outcome.exitCode }
    }
    const registered = new Map()
    const registry = {
      has: (id) => registered.has(String(id)),
      describe: () => ({ backendId: 'github', refId: 'FeatherHunter/dsh-mattpocock-skills-deck' }),
      get: (id) => registered.get(String(id)) || null,
      select: async () => null,
      modules: () => Array.from(registered.values()),
      register: (id, m) => registered.set(String(id), m),
      on: () => {},
    }
    registry.register('github', Object.assign({}, githubMod.githubModule, githubMod.githubModule.create({})))
    const noStore = { get: () => null, set: () => {}, has: () => false, clear: () => {}, invalidate: () => {}, invalidateByKey: () => {}, keys: () => [], onRegistryBindStale: () => {} }
    const svc = (detMod.createDetectionService || detMod.default)({
      registry, getPlatform: async () => platform, getFs: () => platform.fs,
      getTimers: () => ({ setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) }),
      workspaceStore: noStore, skillProbe: async () => ({ ok: true, missing: [], probes: {} }),
      resolveRepoHandle: async (h) => ({ cwd: h.cwd || '', refId: 'FeatherHunter/dsh-mattpocock-skills-deck' }),
      exec: detectionExec, getChoiceStore: async () => null, logCtx: null,
    })
    // 每一次评估都另起一套实例（与真机一次评估等价），所以这里每次新建 repoKeys 与 detectChain。
    const chain = detectChainMod.createDetectChain({
      canonicalKey: async (c) => String(c || ROOTDIR), DEFAULT_CWD: ROOTDIR,
      resetGhCache: () => repoKeys.resetGhCache(),
      getDetectionService: async () => svc, getPlatform: async () => platform, getTrackerRegistry: async () => registry,
      getRepoKey: repoKeys.getRepoKey, runGh: repoKeys.runGh,
      // #1444：检查链不再直调 gh，登录态与仓库可达问只读会话。这里的假会话把两条能力接到同一处假进程接缝上
      //（与真房间同序：找 gh → gh auth status → api repos/o/n；取登录名走 api user），所以本门禁数的
      //「一次评估对外问了几条 REST」仍然量的是同一件事，只是现在问的人换成了会话。
      openSession: async () => ({
        ok: true, backendId: 'github',
        call: function (fn) {
          const session = {
            preflight: async function (handle) {
              const ghp = await platform.resolveExecutable('gh')
              if (!ghp) return { ok: false, error: { kind: 'env', message: 'gh not found', raw: '' } }
              const a = await detectionExec('gh', ['auth', 'status'], { cwd: handle && handle.cwd })
              if (a.code !== 0) return { ok: false, error: { kind: 'auth', message: 'auth status failed', raw: '' } }
              const ref = handle && handle.refId ? String(handle.refId) : ''
              const b = await detectionExec('gh', ['api', 'repos/' + ref], { cwd: handle && handle.cwd })
              if (b.code !== 0) return { ok: false, error: { kind: 'not-found', message: 'api repos failed', raw: '' } }
              return { ok: true }
            },
            getCurrentUser: async function () {
              const u = await detectionExec('gh', ['api', 'user', '-q', '.login'])
              return u.code === 0 ? { ok: true, data: { login: String(u.stdout || '').trim() } } : { ok: false, error: { kind: 'auth', message: 'api user failed' } }
            },
          }
          return fn(session, { cwd: ROOTDIR, caller: 'refresh' })
        },
      }),
      timer: { timeout: (ms) => new Promise((r) => setTimeout(() => r(null), ms)), setTimeout: (fn, ms) => setTimeout(fn, ms) },
      probeSkill: async () => ({ ok: true, level: 'ok', detail: 'fake' }),
      mdPredicate: async () => ({ status: 'pass', detail: 'fake' }),
      getChainCache: () => null, setChainCache: () => {},
      getChainBackoff: async () => ({ verdict: async () => ({ needed: true, reason: 'due', waitMs: 0, cached: null }), note: async () => {} }),
      logCtx: null,
    })
    return { chain: chain, spawns: spawns }
  }
  const countOf = (spawns: RecordedSpawn[], cmd0: string, cmd1: string) => spawns.filter((s) => s.rest && String(s.argv[1]) === cmd0 && String(s.argv[2]) === cmd1).length

  const repoKeysMod = await imp(join(ROOTDIR, 'src/refresh/rooms/host/git-execution.ts'))
  const detMod = await imp(join(ROOTDIR, 'src/tracker/detection/detectionService.ts'))
  const githubMod = await imp(join(ROOTDIR, 'src/tracker/rooms/github/room/index.ts'))
  const detectChainMod = await imp(join(ROOTDIR, 'src/refresh/rooms/host/check-chain-evaluation.ts'))
  const gateMod = await imp(join(ROOTDIR, 'src/refresh/rooms/host/refresh-gate.ts'))
  const ledgerMod = await imp(join(ROOTDIR, 'src/refresh/rooms/host/quota-ledger.ts'))

  // 第 1 次评估：挂载时那一种调用（force=true，客户端不带 trigger）
  const host1 = makeHost()
  const out1 = await host1.chain.handleChain({ cwd: ROOTDIR, backendId: 'github', lang: 'zh', force: true })
  const restN1 = host1.spawns.filter((s) => s.rest).length
  check(restN1 === 3, '一次评估的 REST 条数 = 3（票面口径：5 条降到 3 条）', '实得 ' + restN1 + ' 条：' + JSON.stringify(host1.spawns.filter((s) => s.rest).map((s) => s.argv.join(' '))))
  check(countOf(host1.spawns, 'auth', 'status') === 1, '登录态（gh auth status）一轮只问外部一次', '实得 ' + countOf(host1.spawns, 'auth', 'status') + ' 次')
  check(host1.spawns.filter((s) => s.rest && String(s.argv[1]) === 'api' && String(s.argv[2]).indexOf('repos/') === 0).length === 1, '仓库可达（gh api repos/…）一轮只问外部一次', '实得 ' + host1.spawns.filter((s) => s.rest && String(s.argv[1]) === 'api' && String(s.argv[2]).indexOf('repos/') === 0).length + ' 次')
  check(!!(out1 && out1.ok) && (out1.fullSnapshot.steps || []).every((s) => s.status === 'done'), '这一轮链全绿（省下来的那两条没有把判定省坏）')

  // 第 2 次评估：另起一套实例，必须照旧是 3 条 —— 复用位只活在这一次里，既不永久缓存、也不跨轮串味
  const host2 = makeHost()
  const out2 = await host2.chain.handleChain({ cwd: ROOTDIR, backendId: 'github', lang: 'zh', force: true })
  check(host2.spawns.filter((s) => s.rest).length === 3, '换一套实例再评估一次，仍然是 3 条（复用位不跨评估、不永久缓存）', '实得 ' + host2.spawns.filter((s) => s.rest).length + ' 条')
  check(!!(out2 && out2.ok), '第 2 次评估照样成功')

  console.log('\n— 挂载时主动调 force 刷新的那个调用点：被标成非用户事件 —')
  // 闸的那张调用点表（gate.js 的 CALL_SITE_CATEGORIES）说了算：它把每个调用点归到四类之一，
  // 账本再按类别分档记（user-action 一档、插件自己一档）。这里拿**真跑出来的结果**去问闸，
  // 不是拿一个测试内部自己编的名字去问 —— 断言的是取数路径给出的身份。
  const assertSource = (label: string, chainSource: string, wantCategory: string): void => {
    const ledger = ledgerMod.createLedger({ now: () => 1700000000000 })
    // #1446 账本按后端分键：读数落在这一个后端的桶里，换后端不许混账。
    ledger.ensureBackend('github', { kind: 'two-buckets' })
    ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: 1700003600000 }, graphql: { limit: 5000, remaining: 5000, reset: 1700003600000 } }, 1700000000000)
    const gate = gateMod.createGate({ ledger: ledger, now: () => 1700000000000 })
    const cls = gateMod.classify(chainSource)
    const verdict = gate.decideFor({ source: chainSource, kind: 'chain', workspaceKey: 'ws-1' })
    check(cls.known === true && cls.category === wantCategory && verdict.verdict === 'allow',
      label + '：闸把它归成「' + wantCategory + '」并放行（实得 ' + cls.category + '/' + verdict.verdict + '，source=' + chainSource + '）',
      '这一档若归成 user-action，账本就把插件自己的动作记成人手动过的了')
  }
  assertSource('挂载时主动调 force 刷新（force=true，客户端不带 trigger）', out1 && out1.chainSource, 'background')
  assertSource('人亲手点「重新检查」（trigger=user-recheck）', (await makeHost().chain.handleChain({ cwd: ROOTDIR, backendId: 'github', lang: 'zh', force: true, trigger: 'user-recheck' })).chainSource, 'user-action')
  // 四种事件里另外两种也各问一遍：做完可能改变它的动作、写入成功之后 —— 它们同样不算人的动作。
  assertSource('做完可能改变它的动作（trigger=action-done）', (await makeHost().chain.handleChain({ cwd: ROOTDIR, backendId: 'github', lang: 'zh', force: true, trigger: 'action-done' })).chainSource, 'background')
  assertSource('切进工作区（trigger=enter-workspace）', (await makeHost().chain.handleChain({ cwd: ROOTDIR, backendId: 'github', lang: 'zh', force: true, trigger: 'enter-workspace' })).chainSource, 'background')
}

console.log('\n— 汇总 —')
console.log('  total=' + total + '  failed=' + (failed ? '有' : '0'))
// 收工先把全局时钟还原：本仓打算把多扇门禁放进同一个进程跑，别把虚拟时钟留给后面那几扇。
uninstallTimeCompression()
if (failed) { console.log('\n  FAIL verify-709-no-self-continuing-timers — 有失败'); process.exit(1) }
console.log('\n  PASS verify-709-no-self-continuing-timers — 全部通过 (#709)')
