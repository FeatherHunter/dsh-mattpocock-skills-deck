// tests/verify-709-no-self-continuing-timers.js — #709（T5）硬断言：全库不再有自续定时器
//
// 票面「加固补充」要求把验收改成硬断言：**全库（src/** 与 src/client/**）除「刚离开工作区那个
// 30 秒收尾定时器」外，不再有任何自续定时器**；同时检查页在事件触发下仍能自动变绿。
//
// 什么算「自续定时器」：自己给自己排下一跳、没有人叫它也会一直跑下去的那种。两种形态：
//   ① setInterval —— 天生就是每 N 毫秒自己回来一次；
//   ② 自名递归排期 —— 一个函数体里排了「再叫我自己」的一次定时器（从前命名守护的
//      namingLoopTick、客户端的 namingGuardianKick 的 tick、链的 scheduleChainAutoRefresh 都是这一种）。
// 一次性的防抖、超时、退场动画、有次数上限的重试都不算（它们会自己停下来），本文件不把它们判红。
//
// 本文件同时钉住两件与之配套的事：本票点名的四处删除点确实清了零，刷新决策确实由
// refresh-core 的纯函数（退避 / 全绿缓存）说了算。
//
// 用法：node tests/verify-709-no-self-continuing-timers.js
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let failed = false
let total = 0
function check(ok, msg, detail) {
  total++
  if (ok) console.log('  PASS ' + msg)
  else { failed = true; console.log('  FAIL ' + msg + (detail ? ' — ' + detail : '')) }
}

console.log('== #709 硬断言：全库除 30 秒收尾定时器外没有自续定时器 ==')

/**
 * 允许名单：全库唯一被本票放行的自续定时器 —— 「刚离开工作区那个 30 秒收尾定时器」。
 * 它由 #707（T3 · 视野模型）落地：刚离开的那个工作区还算活跃 30 秒，到期即归零。
 * 写成模式而不是写死文件路径：T3 那个文件叫什么、落地了没有，都不该让本断言变成假红或假绿。
 */
const LINGER_ALLOWED = [/lingering|linger/i]

/**
 * 声明例外名单：既不是本票点名的删除点，也不是刷新机制那一族，今天确实还留在库里。
 * 每一条都要写清「为什么它不是自续的刷新活」以及「谁负责」——不写理由的不许进这张表。
 * 这张表是本次施工如实记下的现状（见回报第 6 节），不是「本票认为这些没问题」。
 */
const DECLARED_EXCEPTIONS = [
  // 2026-09-24（#725）：原先这里还登记着「client/statusbar/StatusBar.js 的 2 秒折叠重算」——
  //   那一条随本票拆掉阶梯机时一起去掉了（折叠改由 ResizeObserver 与每次提交后重算一次接管），
  //   所以这条豁免跟着删：状态栏里再长出无人叫醒的定时器，本门会当场红。
  { match: /client[\\/]panelAssembly\.js$/, why: '老宿主没有 ctx.inject 时的注册重试，最多试 10 次就自己停（有次数上限，不是自续）' },
  { match: /client[\\/]kernel[\\/]api-new-session\.js$/, why: '交接文档落盘探测，最多试 600 次（约 10 分钟）就自己停，且只在人点过「交接」之后才跑' },
  { match: /client[\\/]views[\\/]useUpdatePanel\.js$/, why: '安装与校验任务进行中才跑，任务结束即停（由 updJobState 收口，不是自续）' },
  { match: /client[\\/]kernel[\\/]probe-auto\.js$/, why: '变化探测栅格的老节拍，属于 #707（T3 · 视野模型与客户端节拍改造）那一张票的范围，随那张票改' },
]

/** 目录遍历：只要 .js，跳过 node_modules / package / 产物目录。 */
function walk(dir, acc) {
  let ents = []
  try { ents = readdirSync(dir) } catch (e) { return acc }
  for (const name of ents) {
    if (name === 'node_modules' || name === 'package' || name === '.git') continue
    const p = join(dir, name)
    let st = null
    try { st = statSync(p) } catch (e) { continue }
    if (st.isDirectory()) walk(p, acc)
    else if (/\.js$/.test(name)) acc.push(p)
  }
  return acc
}

/** 去掉注释再扫：注释里提到 setInterval 不算（我们把删除写在注释里说明也是常见做法）。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/([^:\w])\/\/[^\n]*/g, '$1')
}

/** 从某个声明处起，用花括号配对找出这个函数的函数体范围。 */
function bodySpan(code, declIndex) {
  const open = code.indexOf('{', declIndex)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < code.length; i++) {
    const c = code.charAt(i)
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return { start: open, end: i } }
  }
  return null
}

/** 这个文件里所有「自续定时器」的坐标。 */
function selfContinuingSites(code) {
  const sites = []
  const iv = /setInterval\s*\(/g
  let m
  while ((m = iv.exec(code))) sites.push({ kind: 'setInterval', index: m.index })
  // 自名递归排期：函数体里排了「再叫我自己」。
  // 只认函数声明（function / 箭头函数）：`timer.timeout(3000)` 这种「拿毫秒数换一个 promise」的写法
  // 里那个名字是数字变量，不是函数，不能判成递归。
  const declRe = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g
  const seen = new Set()
  let d
  while ((d = declRe.exec(code))) {
    const name = d[1]
    if (seen.has(name)) continue
    seen.add(name)
    const span = bodySpan(code, d.index)
    if (!span) continue
    const head = code.slice(d.index, span.start)
    if (!/function|=>/.test(head)) continue
    const body = code.slice(span.start, span.end)
    const selfRe = new RegExp('(?:timer\\.timeout|timer\\.setTimeout|setTimeout|setInterval)\\s*\\(\\s*' + name + '\\b')
    if (selfRe.test(body)) sites.push({ kind: 'self-recursive', name: name, index: d.index })
  }
  return sites
}

const scanned = []
for (const dir of ['src', join('src', 'client')]) walk(join(ROOT, dir), scanned)
// src/client 在 src 底下，walk 会重复收一遍；去重。
const files = Array.from(new Set(scanned))

const unknown = []
const allowed = []
const declared = []
for (const abs of files) {
  const rel = relative(ROOT, abs)
  let code = ''
  try { code = stripComments(readFileSync(abs, 'utf8')) } catch (e) { continue }
  const sites = selfContinuingSites(code)
  if (!sites.length) continue
  for (const s of sites) {
    const line = code.slice(0, s.index).split('\n').length
    const item = { rel: rel.split(sep).join('/'), line: line, kind: s.kind + (s.name ? ':' + s.name : '') }
    if (LINGER_ALLOWED.some(function (re) { return re.test(item.rel) })) { allowed.push(item); continue }
    if (DECLARED_EXCEPTIONS.some(function (x) { return x.match.test(item.rel) })) { declared.push(item); continue }
    unknown.push(item)
  }
}

console.log('\n— 扫描面 —')
check(files.length > 100, '扫描到 src/** 与 src/client/** 下的 .js 文件（' + files.length + ' 份）')

console.log('\n— 硬断言：除 30 秒收尾定时器外没有自续定时器 —')
console.log('  放行（30 秒收尾定时器）：' + (allowed.length ? allowed.map(function (x) { return x.rel + ':' + x.line }).join('、') : '（今天还没有落地）'))
console.log('  声明例外（逐条写了理由，见本文件 DECLARED_EXCEPTIONS）：')
for (const x of declared) console.log('    ' + x.rel + ':' + x.line + ' [' + x.kind + ']')
check(unknown.length === 0, '全库没有任何「不在放行名单、也不在声明例外名单」的自续定时器', unknown.length ? JSON.stringify(unknown) : '')

console.log('\n— 本票点名的四处删除点：确实是零 —')
{
  const mustBeZero = [
    'src/host/namingGuardian.js',
    'src/client/kernel/api-naming.js',
    'src/client/kernel/probe-chain.js',
    'src/client/views/ChecksTab.js'
  ]
  for (const rel of mustBeZero) {
    let code = ''
    try { code = stripComments(readFileSync(join(ROOT, rel), 'utf8')) } catch (e) { check(false, rel + ' 可读', String(e.message)); continue }
    const sites = selfContinuingSites(code)
    check(sites.length === 0, rel + ' 里没有自续定时器', JSON.stringify(sites.map(function (s) { return s.kind })))
  }
  // 退掉的老名字一个都不许回来（回来了说明有人把旧循环又抄了一遍）。
  // 判据只看代码、去掉注释：施工说明里写「从前那个 15 秒 tick 叫 NAMING_TICK_MS」是应该的，
  // 那不算复活。
  const noComments = function (p) { try { return stripComments(readFileSync(join(ROOT, p), 'utf8')) } catch (e) { return '' } }
  const hostSrc = noComments('src/host/namingGuardian.js') + noComments('src/host/index.js')
  check(!/NAMING_TICK_MS|NAMING_SWEEP_MS|namingLoopTick|startNamingGuardianLoop/.test(hostSrc), '宿主侧命名守护的 15 秒自续 tick 已彻底退役（含旧名字）')
  const apiSrc = noComments('src/client/kernel/api-naming.js') + noComments('src/client/panelAssembly.js')
  check(!/NAMING_POLL_MS|startNamingGuardianPoll|_namingPollTimer/.test(apiSrc), '客户端命名轮询已彻底退役（含旧名字）')
  check(/startNamingGuardianEvents/.test(apiSrc), '客户端改为事件驱动入口 startNamingGuardianEvents')
  const chainSrc = noComments('src/client/kernel/probe-chain.js')
  check(!/CHAIN_AUTO_POLL_MS|scheduleChainAutoRefresh|cancelChainAutoRefresh|_chainAutoPollTimers/.test(chainSrc), '客户端链的 8 秒自轮询已彻底退役（含旧名字）')
  check(/chainEventRefresh/.test(chainSrc) && /CHAIN_EVENT_REASONS/.test(chainSrc), '链改为事件驱动入口 chainEventRefresh（四种事件）')
  const checksSrc = noComments('src/client/views/ChecksTab.js')
  check(!/checks-poll/.test(checksSrc) && !/setInterval/.test(checksSrc), '检查页那条 20 秒静默重查也已退役')
}

console.log('\n— 刷新决策确实由 refresh-core 的纯函数说了算 —')
{
  const tsSrc = readFileSync(join(ROOT, 'refresh-core/src/backoff.ts'), 'utf8')
  check(/export function chainRefreshVerdict/.test(tsSrc), 'backoff.ts 提供「这一刻该不该重算」的判定（chainRefreshVerdict）')
  check(/export function advanceChainStep/.test(tsSrc), 'backoff.ts 提供「有进展立刻回快档」的推进规则（advanceChainStep）')
  check(/export function chainCacheUsable/.test(tsSrc), 'backoff.ts 提供「全绿缓存还能不能用」的判定（chainCacheUsable）')
  check(/export function preflightUsable/.test(tsSrc), 'backoff.ts 提供环境预检 10 分钟寿命的判定（preflightUsable）')
  check(/preflightRetryAfterFailure/.test(tsSrc), 'backoff.ts 提供预检失败后允许立刻重试一次的判定（preflightRetryAfterFailure）')
  const prod = readFileSync(join(ROOT, 'src/shared/refresh/backoff.js'), 'utf8')
  check(/AUTO-GENERATED by node refresh-core\/build\.mjs/.test(prod), '产物 src/shared/refresh/backoff.js 由构建生成')
  check(/export function chainRefreshVerdict/.test(prod), '产物里有 chainRefreshVerdict（构建没跑就红）')
  const budget = readFileSync(join(ROOT, 'refresh-core/src/budget.ts'), 'utf8')
  check(/CHAIN_BACKOFF_MS = \[8_000, 30_000, 2 \* 60_000, 5 \* 60_000\]/.test(budget), '退避序列 8 秒 → 30 秒 → 2 分钟 → 5 分钟的唯一真源在 budget.ts')
  check(/CHAIN_ALL_GREEN_TTL_MS = 30 \* 60_000/.test(budget), '全绿缓存 30 分钟的唯一真源在 budget.ts')
  check(/PREFLIGHT_TTL_MS = 10 \* 60_000/.test(budget), '预检寿命 10 分钟的唯一真源在 budget.ts')
  const shell = readFileSync(join(ROOT, 'src/host/refresh/chainBackoff.js'), 'utf8')
  check(/budget\.CHAIN_BACKOFF_MS/.test(shell) && !/_000\s*[,;]/.test(shell), '宿主薄壳不写数字，数字全部取自 budget.js')
  check(/chainRefreshVerdict/.test(shell) && /advanceChainStep/.test(shell), '宿主薄壳确实调用纯函数做判定与推进')
}

console.log('\n— 四种事件触发都在 —')
{
  const chainSrc = readFileSync(join(ROOT, 'src/client/kernel/probe-chain.js'), 'utf8')
  for (const r of ["'enter-workspace'", "'user-recheck'", "'action-done'", "'write-done'"]) {
    check(chainSrc.includes(r), '链的事件类型里有 ' + r)
  }
  check(/CHAIN_EVENT_REASONS\.enterWorkspace/.test(readFileSync(join(ROOT, 'src/client/views/ChecksTab.js'), 'utf8')), '检查页打开时按「切进工作区」触发一次')
  // 下面两条原先按字面找 `loadChain(st, true, '<原因>')`。这几个调用点后来都改走内核那一个事件入口
  //   chainEventRefresh（见 #669 门禁的 E 组，那里逐条量了「哪一路走哪一个入口」）—— 事件驱动的
  //   这一点没变，变的只是入口的名字与落点，所以这两条跟着新落点量。
  check(/chainEventRefresh\(st, 'user-recheck'\)/.test(readFileSync(join(ROOT, 'src/client/kernel/probe-auto.js'), 'utf8')), '「重新检查」按钮带 user-recheck（人的动作永不降档）')
  check(/chainEventRefresh\(st, 'action-done'\)/.test(readFileSync(join(ROOT, 'src/client/kernel/store-switch.js'), 'utf8')), '绑定后端按「做完可能改变它的动作」触发')
  check(/noteWriteActivity/.test(readFileSync(join(ROOT, 'src/host/repoKeys.js'), 'utf8')), '写入成功之后（gh issue 写操作拦到）把退避拉回第一档')
  const hostNaming = readFileSync(join(ROOT, 'src/host/namingGuardian.js'), 'utf8')
  check(/NAMING_FALLBACK_MS = 10 \* 60_000/.test(hostNaming), '命名守护留 10 分钟兜底')
  check(/opts\.oneRepo/.test(hostNaming) && /_namingSweepCursor/.test(hostNaming), '兜底每跳最多扫 1 个仓库且轮转')
}

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
