// tests/verify-1443-github-readbudget.ts —— 门禁：GitHub 房间回答额度读数（#1443）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1443-github-readbudget.ts，可独立运行。
//
// 为什么要这一段：#1435 的验收 2、3 卡在「读数未知被当成 0」上 —— gh 缺失、未登录、
// 网络失败三条路都要回「读数未知」并带原因，不回 0、不抛异常；成功时回 REST 与 GraphQL 两个桶。
// 本门禁盯住：三态映射、成功两桶、解析不出、工厂装配、登记翻档、md 行、会话直达、没 gh 不推迟。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

function rateLimitText(restRemaining, gqlRemaining) {
  return JSON.stringify({ resources: { core: { limit: 5000, remaining: restRemaining, reset: 9999999999 }, graphql: { limit: 5000, remaining: gqlRemaining, reset: 9999999999 } } })
}

// 房内 gh 客户端要的三件执行桩：平台解析、起进程、出站控制面，缺一件房内按环境失败。
function makeCtx(execFn, resolveFn) {
  const outbound = { acquire: async function () { return function release() {} }, isCancelled: function () { return false }, noteWrite: function () {} }
  return { cwd: '/ws-test-1443', signal: undefined,
    platform: { resolveExecutable: resolveFn,
      path: { join: function () { return Array.prototype.join.call(arguments, '/') }, sep: '/', isAbsolute: function (p) { return String(p).charAt(0) === '/' }, dirname: function (p) { const i = String(p).lastIndexOf('/'); return i > 0 ? String(p).slice(0, i) : '/' } },
      fs: { resolve: async function (rel) { return rel }, readText: async function () { throw new Error('no-file') } },
      env: { get: function () { return undefined }, has: function () { return false } } },
    fs: null, exec: execFn, timers: { setTimeout: setTimeout, clearTimeout: clearTimeout },
    logEvent: function () {}, isEnabled: function () { return false }, outbound: outbound, gate: null }
}

const ghMissingExec = async function () { return { stdout: '', stderr: 'gh is not recognized as a command', code: 1 } }
const ghMissingResolve = async function () { return null }
const ghPresentResolve = async function () { return 'gh-on-path' }
const notLoggedInExec = async function (cmd, args) {
  if (String(cmd) === 'gh' && String(args[0]) === '--version') return { stdout: 'gh version 2.60.0', stderr: '', code: 0 }
  return { stdout: '', stderr: 'To authenticate, please run gh auth login.', code: 4 }
}
const networkFailExec = async function (cmd, args) {
  if (String(cmd) === 'gh' && String(args[0]) === '--version') return { stdout: 'gh version 2.60.0', stderr: '', code: 0 }
  return { stdout: '', stderr: 'Failed to connect to api.github.com port 443 after 10000 ms: Timed out', code: 1 }
}
const successExec = async function () { return { stdout: rateLimitText(4999, 4995), stderr: '', code: 0 } }
const badShapeExec = async function () { return { stdout: '{}', stderr: '', code: 0 } }

async function main() {
  console.log('GitHub 房间额度读数门禁（#1443：三态回未知带原因，成功回两桶）')
  let budget = null
  try { budget = await imp('src/tracker/rooms/github/budget.ts') } catch (e) {
    check(false, '读数模块可加载（src/tracker/rooms/github/budget.ts）：' + String((e && e.message) || e))
    console.log('\n' + total + ' 条断言，失败'); process.exit(1)
  }
  check(budget && typeof budget.readGithubBudget === 'function', '交出 readGithubBudget（房间读数实现）')
  check(budget && typeof budget.parseRateLimit === 'function', '交出 parseRateLimit（两桶解析，桥里旧解析的唯一后继）')
  const full = budget.parseRateLimit(rateLimitText(1234, 1222))
  check(full && full.rest.remaining === 1234 && full.rest.limit === 5000 && full.graphql.remaining === 1222 && full.graphql.limit === 5000, '全格解析出两桶水位（剩多少与上限分开）')
  check(budget.parseRateLimit('不是 JSON') === null, '非 JSON 算解析不出')
  check(budget.parseRateLimit('{}') === null, '缺桶算解析不出')
  check(budget.parseRateLimit(null) === null, '空输入算解析不出')
  const missing = await budget.readGithubBudget(makeCtx(ghMissingExec, ghMissingResolve))
  check(missing && missing.ok === true && missing.data && missing.data.known === false && missing.data.reason === 'not-measured', 'gh 缺失回读数未知（not-measured），装进成功信封')
  const denied = await budget.readGithubBudget(makeCtx(notLoggedInExec, ghPresentResolve))
  check(denied && denied.ok === true && denied.data && denied.data.known === false && denied.data.reason === 'not-measured', '未登录回读数未知（not-measured：机器没准备好，不是临时取不到），装进成功信封')
  const netFail = await budget.readGithubBudget(makeCtx(networkFailExec, ghPresentResolve))
  check(netFail && netFail.ok === true && netFail.data && netFail.data.known === false && netFail.data.reason === 'unavailable', '网络失败回读数未知（unavailable），装进成功信封')
  const okReading = await budget.readGithubBudget(makeCtx(successExec, ghPresentResolve))
  check(okReading && okReading.ok === true && okReading.data && okReading.data.known === true && okReading.data.kind === 'two-buckets', '成功时报已知两桶口径')
  check(okReading && okReading.data && okReading.data.buckets && okReading.data.buckets.rest.remaining === 4999 && okReading.data.buckets.rest.limit === 5000 && okReading.data.buckets.graphql.remaining === 4995, '两桶水位与上限原样交回（不回 0、不编数）')
  const badShape = await budget.readGithubBudget(makeCtx(badShapeExec, ghPresentResolve))
  check(badShape && badShape.ok === true && badShape.data && badShape.data.known === false && badShape.data.reason === 'unavailable', '解析不出两桶回读数未知（unavailable）')
  let factory = null
  try { factory = await imp('src/tracker/rooms/github/backend.ts') } catch (e) { check(false, '后端工厂可加载：' + String((e && e.message) || e)) }
  let backend = null
  try { backend = factory.createGithubBackend(makeCtx(successExec, ghPresentResolve)) } catch (e) { check(false, '工厂可装配：' + String((e && e.message) || e)) }
  check(backend && typeof backend.readBudget === 'function', '工厂交出 readBudget 成员（登记推成员，缺了编译先红）')
  let register = null
  try { register = await imp('src/tracker/rooms/github/capability-register.ts') } catch (e) { check(false, '登记可加载：' + String((e && e.message) || e)) }
  const tier = register && register.GITHUB_CAPABILITY_REGISTER && register.GITHUB_CAPABILITY_REGISTER.readBudget && register.GITHUB_CAPABILITY_REGISTER.readBudget.tier
  check(tier === 'provided', '登记里 readBudget 已是明确提供功能（不再是 planned，欠账清掉）')
  const fs = await import('node:fs')
  const md = fs.readFileSync(path.join(ROOT, 'docs/tracker/capability-github.md'), 'utf8')
  const mdRow = md.split(/\r?\n/).filter(function (l) { return l.indexOf('readBudget') >= 0 })
  check(mdRow.length >= 1 && mdRow[0].indexOf('明确提供功能') >= 0, '给人看的表里 readBudget 也是明确提供功能（登记与表同档）')
  let sessionMod = null
  try { sessionMod = await imp('src/tracker/session/open-tracker.ts') } catch (e) { check(false, '会话入口可加载：' + String((e && e.message) || e)) }
  const registryStub = { select: async function () { return { backendId: 'github' } }, get: function (id) { return id === 'github' ? backend : undefined }, modules: function () { return [{ id: 'github', budget: { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true } }] } }
  const ports = { getCachedReading: async function () { return { known: false, reason: 'not-measured' } }, admit: async function () { return { allowed: true, reason: 'test-permissive' } }, account: async function () {} }
  const opened = await sessionMod.openTracker({ cwd: '/ws-test-1443' }, { registry: registryStub, getCachedReading: ports.getCachedReading, admit: ports.admit, account: ports.account, canWrite: false, canWriteReason: '读数会话只读不写' })
  check(opened && opened.ok === true, '只读会话能打开（选后端走注册表桩）')
  const viaSession = await opened.session.readBudget(makeCtx(successExec, ghPresentResolve))
  check(viaSession && viaSession.ok === true && viaSession.data && viaSession.data.known === true && viaSession.data.buckets.rest.remaining === 4999, '会话 readBudget 直达房间（成功读数原样回来）')
  const noGhBackend = factory.createGithubBackend(makeCtx(ghMissingExec, ghMissingResolve))
  const noGhRegistry = { select: async function () { return { backendId: 'github' } }, get: function (id) { return id === 'github' ? noGhBackend : undefined }, modules: function () { return [{ id: 'github', budget: { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true } }] } }
  const noGhOpened = await sessionMod.openTracker({ cwd: '/ws-test-1443' }, { registry: noGhRegistry, getCachedReading: ports.getCachedReading, admit: ports.admit, account: ports.account, canWrite: false, canWriteReason: '读数会话只读不写' })
  const noGhBudget = await noGhOpened.session.readBudget({ cwd: '/ws-test-1443' })
  check(noGhBudget && noGhBudget.ok === true && noGhBudget.data && noGhBudget.data.known === false, '没 gh 时会话 readBudget 回未知（不是失败信封，不触发失败计数）')
  const noGhList = await noGhOpened.session.list({ owner: 'o', name: 'n', refId: 'o/n' }, {}, makeCtx(ghMissingExec, ghMissingResolve))
  const noGhKind = (noGhList && noGhList.error && noGhList.error.kind) || ''
  const noGhText = JSON.stringify(noGhList)
  check(noGhList && noGhList.ok === false && noGhKind !== 'rate-limit' && /gh/i.test(noGhText), '没 gh 时列表调用报环境失败（gh 不可用），不是额度已用完，更不是推迟')
  console.log(failed ? ('\n' + total + ' 条断言，失败') : ('\n' + total + ' 条断言，全部通过')); process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.log('  FAIL 门禁抛错：' + String((e && e.message) || e)); process.exit(1) })
