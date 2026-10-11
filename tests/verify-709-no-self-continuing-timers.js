// tests/verify-709-no-self-continuing-timers.js —— #709 行为断言：退避算术与一次评估的 REST 条数
//
// 这个文件原先还兼着一道「全库不再有自续定时器」的源码文本门禁：读 src/** 与 src/client/** 的
// .js 文本、扫 setInterval 与自名递归排期、钉住旧名字不许回来。那种断言的对象是手写源码的文本，
// 等价重构（改写法、搬文件、改注释）就会变红，2026-10 按维护者口径整段撤掉。留下来的两段断言的
// 都是**跑起来的结果**：
//   ① 把 refresh-core 的退避纯函数真跑一遍（档位、推进、缓存寿命、预检寿命）；
//   ② 拼一个最小宿主接一次真的 wf.chain 求值，数这一轮对外问了几条 REST。
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let failed = false
let total = 0
function check(ok, msg, detail) {
  total++
  if (ok) console.log('  PASS ' + msg)
  else { failed = true; console.log('  FAIL ' + msg + (detail ? ' — ' + detail : '')) }
}

console.log('== #709 行为断言：退避算术 + 一次评估的 REST 条数 ==')

console.log('\n— 退避算术本身：把纯函数真跑一遍 —')
{
  // 这一段是功能断言，不是查字符串：把退避做坏（例如让它永远停在第 0 档、或者忽略「有进展回快档」），
  // 下面这几条会立刻红。门禁只查「函数在不在」是挡不住这种改法的。
  const bo = await import('../src/shared/refresh/backoff.js')
  const budget = await import('../src/shared/refresh/budget.js')
  const limits = {
    backoffMs: budget.CHAIN_BACKOFF_MS,
    allGreenTtlMs: budget.CHAIN_ALL_GREEN_TTL_MS,
    preflightTtlMs: budget.PREFLIGHT_TTL_MS,
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
  const imp = (p) => import(pathToFileURL(p).href)

  // 假进程的账本：每一笔「起进程」都记下来，并按 argv 回一份该命令该有的输出。
  function makeHost() {
    const spawns = []
    const replyFor = (argv) => {
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
    const isRest = (argv) => {
      const rest = argv.slice(1).map(String)
      if (rest.length === 1 && rest[0] === '--version') return false
      return rest.some((x) => x === 'auth' || x === 'api')
    }
    const spawn = (req) => {
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
    const detectionExec = async (cmd, args, opts) => {
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
      timer: { timeout: (ms) => new Promise((r) => setTimeout(() => r(null), ms)), setTimeout: (fn, ms) => setTimeout(fn, ms) },
      probeSkill: async () => ({ ok: true, level: 'ok', detail: 'fake' }),
      mdParseOkPredicate: async () => ({ status: 'pass', detail: 'fake' }),
      getChainCache: () => null, setChainCache: () => {},
      getChainBackoff: async () => ({ verdict: async () => ({ needed: true, reason: 'due', waitMs: 0, cached: null }), note: async () => {} }),
      logCtx: null,
    })
    return { chain: chain, spawns: spawns }
  }
  const countOf = (spawns, cmd0, cmd1) => spawns.filter((s) => s.rest && String(s.argv[1]) === cmd0 && String(s.argv[2]) === cmd1).length

  const repoKeysMod = await imp(join(ROOTDIR, 'src/host/repoKeys.js'))
  const detMod = await imp(join(ROOTDIR, 'src/host/tracker/detection/detectionService.js'))
  const githubMod = await imp(join(ROOTDIR, 'src/host/tracker/backends/github/index.js'))
  const detectChainMod = await imp(join(ROOTDIR, 'src/host/detectChain.js'))
  const gateMod = await imp(join(ROOTDIR, 'src/host/refresh/gate.js'))
  const ledgerMod = await imp(join(ROOTDIR, 'src/host/refresh/ledger.js'))

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
  const assertSource = (label, chainSource, wantCategory) => {
    const ledger = ledgerMod.createLedger({ now: () => 1700000000000 })
    ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: 1700003600000 }, graphql: { limit: 5000, remaining: 5000, reset: 1700003600000 } }, 1700000000000)
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
if (failed) { console.log('\n  FAIL verify-709-no-self-continuing-timers — 有失败'); process.exit(1) }
console.log('\n  PASS verify-709-no-self-continuing-timers — 全部通过 (#709)')
