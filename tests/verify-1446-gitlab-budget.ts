// tests/verify-1446-gitlab-budget.ts —— 门禁：GitLab 请求数读数与预算裁决分支（#1446 G2）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1446-gitlab-budget.ts，可独立运行。
//
// 为什么要这一段：#1446 把账本从「一个固定桶集合」换成「按后端建模」，GitLab 是只计请求的那一家：
// 它只有请求条数，没有点数、没有 35% 写保底。本门禁盯两件事：
//   1. GitLab 读数三态：有 RateLimit 响应头 → 已知请求桶；无头 → 未知（unavailable）；
//      请求失败 → 未知（unavailable）；本机没装 glab → 未知（not-measured）。一律成功信封、不抛。
//   2. 裁决纯函数 decideByBudget 的分支顺序：硬顶 → 离网 → 未知 → 只计请求 → 两桶保底；
//      并证明保底判据（#1527 起是服务端上限的 5%）对两种口径都用，只是读数未知时不问。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

// GitLab 房内 glab 客户端要的两件执行桩：平台解析与起进程。缺平台/执行器时房内按 127 回，不抛。
function makeCtx(execFn, resolveFn) {
  return { cwd: '/ws-test-1446', signal: undefined,
    platform: { resolveExecutable: resolveFn,
      path: { join: function () { return Array.prototype.join.call(arguments, '/') }, sep: '/', isAbsolute: function (p) { return String(p).charAt(0) === '/' }, dirname: function (p) { const i = String(p).lastIndexOf('/'); return i > 0 ? String(p).slice(0, i) : '/' } },
      fs: { resolve: async function (rel) { return rel }, readText: async function () { throw new Error('no-file') } },
      env: { get: function () { return undefined }, has: function () { return false } } },
    fs: null, exec: execFn, timers: { setTimeout: setTimeout, clearTimeout: clearTimeout },
    logEvent: function () {}, isEnabled: function () { return false }, gate: null }
}

// glab api --include 的真实输出：响应头 + 空行 + 响应体；限额两格在响应头里。
function includeText(limit, remaining) {
  return 'HTTP/2.0 200 OK\r\ncontent-type: application/json\r\nratelimit-limit: ' + limit + '\r\nratelimit-remaining: ' + remaining + '\r\n\r\n{}'
}
const glabMissingResolve = async function () { return null }
const glabPresentResolve = async function () { return 'glab-on-path' }
const successExec = async function () { return { stdout: includeText(600, 590), stderr: '', code: 0 } }
const noHeaderExec = async function () { return { stdout: '{}', stderr: '', code: 0 } }
const failExec = async function () { return { stdout: '', stderr: '401 Unauthorized', code: 1 } }

const TWO = { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true }
const REQUESTS = { kind: 'requests-only', countsRequests: true, countsPoints: false, independentBuckets: false }
const OFFLINE = { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false }
const twoReading = function (restRemaining, graphqlRemaining) {
  return { known: true, kind: 'two-buckets', buckets: { rest: { remaining: restRemaining, limit: 1000 }, graphql: { remaining: graphqlRemaining, limit: 1000 } } }
}
const requestsReading = function (remaining) { return { known: true, kind: 'requests-only', requests: { remaining: remaining, limit: 600 } } }
const UNKNOWN = { known: false, reason: 'not-measured' }
// #1527：AI 工具的保底线按服务端上限的 5% 算 —— 上限 1000 → 50，上限 600 → 30。测试里显式注入，纯函数自己不写这个数字。
const limits = {
  pluginShareOfRemaining: 0.45,
  hourlyAllowance: function (n) { return n },
  writeReserve: function (allowance) { return Math.round(allowance * 0.35) },
  aiToolFloor: function (limit) { return Math.floor(limit * 0.05) },
  tierFor: function () { return 'test-tier' },
}

async function main() {
  console.log('GitLab 请求数读数与预算裁决门禁（#1446：三态读数 + 五个裁决分支）')
  let budget = null
  try { budget = await imp('src/tracker/rooms/gitlab/budget.ts') } catch (e) {
    check(false, '读数模块可加载（src/tracker/rooms/gitlab/budget.ts）：' + String((e && e.message) || e))
    console.log('\n' + total + ' 条断言，失败'); process.exit(1)
  }
  check(budget && typeof budget.readGitlabBudget === 'function', '交出 readGitlabBudget（房间读数实现）')
  check(budget && typeof budget.parseGitlabRateLimit === 'function', '交出 parseGitlabRateLimit（响应头解析）')
  const parsed = budget.parseGitlabRateLimit(includeText(600, 590))
  check(parsed && parsed.limit === 600 && parsed.remaining === 590, '从响应头解析出上限与剩余（两格分开，不编数）')
  const upper = budget.parseGitlabRateLimit('HTTP/2.0 200 OK\r\nRateLimit-Limit: 600\r\nRateLimit-Remaining: 580\r\n\r\n{}')
  check(upper && upper.limit === 600 && upper.remaining === 580, '响应头名字大小写不敏感（gitlab 不同版本大小写不一）')
  check(budget.parseGitlabRateLimit('{}') === null, '没有限额头算解析不出')
  check(budget.parseGitlabRateLimit(includeText(600, 590).replace('ratelimit-remaining: 590', '')) === null, '缺剩余那一格也算解析不出（不拿 0 补）')

  const measured = await budget.readGitlabBudget(makeCtx(successExec, glabPresentResolve))
  check(measured && measured.ok === true && measured.data && measured.data.known === true && measured.data.kind === 'requests-only', '有响应头时报已知的「只计请求」读数')
  check(measured && measured.data && measured.data.requests && measured.data.requests.remaining === 590 && measured.data.requests.limit === 600, '请求桶的剩余与上限原样交回')
  const noHeader = await budget.readGitlabBudget(makeCtx(noHeaderExec, glabPresentResolve))
  check(noHeader && noHeader.ok === true && noHeader.data && noHeader.data.known === false && noHeader.data.reason === 'unavailable', '无响应头回读数未知（unavailable），装进成功信封')
  const denied = await budget.readGitlabBudget(makeCtx(failExec, glabPresentResolve))
  check(denied && denied.ok === true && denied.data && denied.data.known === false && denied.data.reason === 'unavailable', '请求失败回读数未知（unavailable），不抛、不记失败信封')
  const missing = await budget.readGitlabBudget(makeCtx(failExec, glabMissingResolve))
  check(missing && missing.ok === true && missing.data && missing.data.known === false && missing.data.reason === 'not-measured', '本机没装 glab 回读数未知（not-measured）')

  // 房间装配：登记说提供，工厂就得真的有这一条；用量信封里每次 glab 调用记一条请求、零点数。
  let factory = null
  try { factory = await imp('src/tracker/rooms/gitlab/index.ts') } catch (e) { check(false, 'GitLab 后端工厂可加载：' + String((e && e.message) || e)) }
  let backend = null
  try { backend = factory.createGitlabBackend(makeCtx(successExec, glabPresentResolve)) } catch (e) { check(false, 'GitLab 工厂可装配：' + String((e && e.message) || e)) }
  check(backend && typeof backend.readBudget === 'function', '工厂交出 readBudget 成员（登记推成员，缺了编译先红）')
  const viaBackend = await backend.readBudget(makeCtx(successExec, glabPresentResolve))
  check(viaBackend && viaBackend.ok === true && viaBackend.data && viaBackend.data.known === true, '经工厂读预算能直达房间实现')
  check(viaBackend && viaBackend.usage && viaBackend.usage.requests === 1 && viaBackend.usage.points === 0, '成功信封带用量：一次 glab 调用记一条请求、点数恒 0')
  let register = null
  try { register = await imp('src/tracker/rooms/gitlab/capability-register.ts') } catch (e) { check(false, 'GitLab 登记可加载：' + String((e && e.message) || e)) }
  check(register && register.GITLAB_CAPABILITY_REGISTER.readBudget.tier === 'provided', '登记里 readBudget 已是明确提供功能（欠账清掉）')
  const fs = await import('node:fs')
  const mdRow = fs.readFileSync(path.join(ROOT, 'docs/tracker/capability-gitlab.md'), 'utf8').split(/\r?\n/).filter(function (l) { return l.indexOf('readBudget') >= 0 })
  check(mdRow.length >= 1 && mdRow[0].indexOf('明确提供功能') >= 0, '给人看的表里 readBudget 也是明确提供功能（登记与表同档）')

  // —— 裁决纯函数的五个分支 ——
  let admission = null
  try { admission = await imp('src/refresh/kernel/budget-admission.ts') } catch (e) { check(false, '裁决模块可加载：' + String((e && e.message) || e)) }
  const decide = admission.decideByBudget
  check(typeof decide === 'function', '交出 decideByBudget（纯函数）')

  const hardCap = decide({ op: 'create', budget: TWO, reading: twoReading(900, 900), canWrite: false }, limits)
  check(hardCap.allowed === false && hardCap.kind === 'hard-cap' && hardCap.message === admission.HARD_CAP_MESSAGE, '无写权限的写操作先拒绝：硬顶（不看读数还剩多少）')
  const readOnly = decide({ op: 'list', budget: TWO, reading: twoReading(900, 900), canWrite: false }, limits)
  check(readOnly.allowed === true && readOnly.reason === 'sufficient', '无写权限的读操作照常放行（硬顶只管写操作）')

  const offline = decide({ op: 'list', budget: OFFLINE, reading: { known: true, kind: 'off-network' }, canWrite: true }, limits)
  check(offline.allowed === true && offline.reason === 'off-network-free', '离网后端直接放行，理由「离网免额度」')
  const offlineUnknown = decide({ op: 'list', budget: OFFLINE, reading: UNKNOWN, canWrite: true }, limits)
  check(offlineUnknown.allowed === true && offlineUnknown.reason === 'off-network-free', '离网口径优先于「读数未知」（理由不能写成未知）')

  const unknown = decide({ op: 'list', budget: TWO, reading: UNKNOWN, canWrite: true }, limits)
  check(unknown.allowed === true && unknown.reason === 'reading-unknown', '读数未知放行，理由「读数未知」，不套剩余≤保底')

  const reqOk = decide({ op: 'list', budget: REQUESTS, reading: requestsReading(31), canWrite: true }, limits)
  check(reqOk.allowed === true && reqOk.reason === 'requests-available', '只计请求：还剩 31 条就放行（高于保底 30）')
  const reqGone = decide({ op: 'comment', budget: REQUESTS, reading: requestsReading(0), canWrite: true }, limits)
  check(reqGone.allowed === false && reqGone.kind === 'rate-limit' && reqGone.reason === 'requests-exhausted', '只计请求：剩余 0 条就推迟（请求额度用尽）')

  // #1418：两桶不是「任一桶见底就全停」—— 读只花 GraphQL 点数、写只花 REST 请求，各族只看自己那一桶。
  const restLowRead = decide({ op: 'list', budget: TWO, reading: twoReading(40, 900), canWrite: true }, limits)
  check(restLowRead.allowed === true && restLowRead.reason === 'sufficient', '#1418：REST 见底时读操作照常放行（读花 GraphQL 点数，不看 REST 桶）')
  const restLowWrite = decide({ op: 'create', budget: TWO, reading: twoReading(40, 900), canWrite: true }, limits)
  check(restLowWrite.allowed === false && restLowWrite.kind === 'rate-limit' && restLowWrite.reason === 'exhausted', '两桶：写操作遇到 REST 桶降到写保底就推迟（额度见底）')
  check(String(restLowWrite.message || '').indexOf('REST 请求') >= 0, '#1418：见底文案点名是哪一族（REST 请求）：' + String(restLowWrite.message || ''))
  const graphqlLowRead = decide({ op: 'get', budget: TWO, reading: twoReading(900, 40), canWrite: true }, limits)
  check(graphqlLowRead.allowed === false && graphqlLowRead.reason === 'exhausted', '两桶：读操作遇到 GraphQL 桶降到写保底就推迟')
  check(String(graphqlLowRead.message || '').indexOf('GraphQL 点数') >= 0, '#1418：见底文案点名 GraphQL 点数：' + String(graphqlLowRead.message || ''))
  // 恢复时刻：读数带 resetAt 时文案写「约 HH:MM 恢复」，没带就不写（不编时刻）。
  const withReset = { known: true, kind: 'two-buckets', buckets: { rest: { remaining: 40, limit: 1000, resetAt: 1761390000000 }, graphql: { remaining: 900, limit: 1000 } } }
  const withResetMsg = String(decide({ op: 'create', budget: TWO, reading: withReset, canWrite: true }, limits).message || '')
  check(/约 \d\d:\d\d 恢复/.test(withResetMsg), '#1418：读数带恢复时刻时文案写出「约 HH:MM 恢复」：' + withResetMsg)
  check(String(restLowWrite.message || '').indexOf('恢复') < 0, '#1418：读数没带恢复时刻时文案不编时刻：' + String(restLowWrite.message || ''))
  const twoHigh = decide({ op: 'list', budget: TWO, reading: twoReading(60, 60), canWrite: true }, limits)
  check(twoHigh.allowed === true && twoHigh.reason === 'sufficient', '两桶：两桶都在保底之上就放行（额度充足）')

  // 「5% 保底对两种口径都生效」：只计请求与两桶都要问 aiToolFloor，唯独读数未知时不能问（未知不是 0）。
  let floorCalls = 0
  const spied = Object.assign({}, limits, { aiToolFloor: function (limit) { floorCalls += 1; return Math.floor(limit * 0.05) } })
  decide({ op: 'list', budget: REQUESTS, reading: requestsReading(100), canWrite: true }, spied)
  check(floorCalls > 0, '只计请求的口径也调用 aiToolFloor（#1527：请求额度同样留 5% 保底）')
  floorCalls = 0
  decide({ op: 'list', budget: TWO, reading: twoReading(100, 900), canWrite: true }, spied)
  check(floorCalls > 0, '两桶口径调用 aiToolFloor（保底按服务端上限 5% 判）')
  let unknownFloorCalls = 0
  decide({ op: 'list', budget: TWO, reading: UNKNOWN, canWrite: true }, Object.assign({}, limits, { aiToolFloor: function () { unknownFloorCalls += 1; return 50 } }))
  check(unknownFloorCalls === 0, '读数未知时不调用 aiToolFloor（未知不是 0）')

  console.log(failed ? ('\n' + total + ' 条断言，失败') : ('\n' + total + ' 条断言，全部通过')); process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.log('  FAIL 门禁抛错：' + String((e && e.message) || e)); process.exit(1) })
