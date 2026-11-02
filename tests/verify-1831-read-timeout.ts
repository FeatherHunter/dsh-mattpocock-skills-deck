// verify-1831-read-timeout.ts —— #1831 门禁：读操作有硬截止、超时回部分结果、只用读口径文案。
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1831-read-timeout.ts
//
// 为什么单独一扇：票面两件事（读调用挂死到宿主先判死；列表回执同时出现「不要直接重放写操作」
// 与「重新读没有副作用」）都出在「读」这条路上，而现有门禁用的是守约响应中止信号的桩
// （tests/verify-1195-timeout-split.ts 的 hangingHonest）—— 那种桩一旦中止就落地，看不见
// 「执行器根本不理中止、调用方一直 await」这个真正的故障。本文件全部用**挂死且忽略信号**的桩，
// 每个用例外面再套一层 6 秒兜底：旧行为是挂到兜底判 FAIL，不是把门禁一起拖死。
const path = require('path')
const { pathToFileURL } = require('url')
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
// 兜底：把「旧代码挂死」变成一条明确的 FAIL，而不是让门禁自己卡住等 CI 超时。
function cap(p, ms) {
  return Promise.race([
    Promise.resolve(p),
    new Promise((resolve, reject) => { setTimeout(() => reject(new Error('超过 ' + ms + ' 毫秒还没回来')), ms) }),
  ])
}
// 挂死桩：永远不落地，也完全不看 ctx.signal —— 模拟「执行器不理中止」的真实故障形态。
const hang = () => new Promise(() => {})
function deadTracker(over) {
  return Object.assign({
    preflight: hang, list: hang, get: hang, getDependencies: hang, listMaps: hang,
    create: hang, update: hang, comment: hang, close: hang, reopen: hang,
    setLabels: hang, setAssignees: hang, setParent: hang, setBlockedBy: hang,
  }, over || {})
}
const demoIssue = { key: '7', title: '演练票', state: 'open', type: 'issue', labels: [], assignees: [], updatedAt: '', closedAt: '', url: '', body: '# 演练票\n' }
function okTracker(over) {
  return Object.assign({
    preflight: async () => ({ ok: true }),
    list: async () => ({ ok: true, data: [] }),
    get: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    getDependencies: async () => ({ ok: true, data: { blockedBy: [], blocking: [] } }),
    create: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    update: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    comment: async () => ({ ok: true, data: { key: '7' } }),
    close: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    reopen: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    setLabels: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    setAssignees: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    setParent: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    setBlockedBy: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
  }, over || {})
}
function stubGateLedger(budget, gateMod, ledgerMod) {
  const clock = { now: 1700000000000 }
  const ledger = ledgerMod.createLedger({ now: () => clock.now })
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock.now })
  ledger.ensureBackend('github', { kind: 'two-buckets' })
  ledger.syncServer('github', { rest: { limit: 5000, remaining: 5000, reset: clock.now + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock.now + 3600000 } }, clock.now)
  return { gate: gate, ledger: ledger, clock: clock }
}
function stubRegistry(pickRefId, tracker) {
  return {
    select: async () => ({ backendId: 'stub', source: 'explicit', ref: { backend: 'stub', refId: pickRefId, name: pickRefId, url: '' }, pending: false }),
    get: () => tracker,
    has: () => true,
    modules: () => [{ id: 'stub', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false } }],
    describe: () => ({ backend: 'stub', refId: pickRefId, name: pickRefId, url: '' }),
  }
}
function baseDeps(over) {
  const o = over || {}
  const base = Object.assign({
    estimate: () => ({ points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 60, text: '' }),
    costInputFrom: () => ({ tool: 't' }),
    backendCtx: {},
    handleFor: (s) => ({ cwd: (s && s.cwd) || '' }),
    log: null,
    now: () => Date.now(),
    canonicalKey: async (raw) => raw,
    workspaceKeyOf: () => 'ws-test',
    toolTimeoutMs: 2000,
    toolMarginMs: 300,
  }, o)
  if (!base.decideBackend && base.registry) base.decideBackend = makeDecideStub(base.registry)
  chooseWorkspace('D:/demo', 'stub')
  return base
}
function execFor() { return { agent: { session: { id: 's-1831', cwd: 'D:/demo' } } } }

// —— 一、预算壳：硬截止 / 取消下传 / 读写分文案（不经过工具，直接量 execOp）——
async function sectionBudget(budgetMod) {
  console.log('\n[一] 预算壳：到点必须结束等待，取消要传给后端，文案读写分套')
  let seen = null
  const scope = budgetMod.withCallScope(
    { tracker: deadTracker({ get: (repo, key, f, ctx) => { seen = ctx; return hang() } }), opCtx: { opId: 'op-1831-read' } },
    {},
    { timeoutMs: 2500, marginMs: 400, perOpTimeoutMs: 600, now: () => Date.now() },
  )
  const t0 = Date.now()
  let r = null
  try { r = await cap(scope.tracker.get({ backend: 'stub', refId: 'o/n' }, '7', {}, scope.opCtx), 6000) } catch (e) { check(false, '读调用到点必须结束等待（' + e.message + '）'); return }
  const dt = Date.now() - t0
  check(r && r.ok === false && r.error && r.error.kind === 'timeout', '读调用到点回 timeout（实得 ' + JSON.stringify(r && r.error) + '）')
  check(dt < 5000, '读调用在钳制附近返回，不挂到兜底（' + dt + 'ms）')
  check(seen && seen.signal && seen.signal.aborted === true, '到点后交给后端的 signal 已中止（取消下传）')
  check(seen && seen.opId === 'op-1831-read', '后端上下文带着这次操作的 opId（日志按 opId 串得起来）')
  const readMsg = String((r && r.error && r.error.message) || '')
  check(readMsg.indexOf('不要直接重放写操作') < 0, '读超时文案不出现写操作口径（实际：' + readMsg.slice(0, 80) + '…）')
  check(readMsg.indexOf('读') >= 0 && /重调|重试/.test(readMsg), '读超时文案明说这是一次读、可以重调（实际：' + readMsg.slice(0, 80) + '…）')

  // 写操作：到点仍保留「核对现状再续、不要直接重放写操作」这套口径（#1799 的映射不动，文案分工要保留）。
  const wscope = budgetMod.withCallScope(
    { tracker: deadTracker({ create: () => hang() }), opCtx: { opId: 'op-1831-write' } },
    {},
    { timeoutMs: 2500, marginMs: 400, perOpTimeoutMs: 600, now: () => Date.now() },
  )
  let wr = null
  try { wr = await cap(wscope.tracker.create({ backend: 'stub', refId: 'o/n' }, { title: '演练' }, wscope.opCtx), 6000) } catch (e) { check(false, '写调用到点必须结束等待（' + e.message + '）'); return }
  const writeMsg = String((wr && wr.error && wr.error.message) || '')
  check(wr && wr.ok === false && wr.error.kind === 'timeout', '写调用到点回 timeout')
  check(writeMsg.indexOf('不要直接重放写操作') >= 0, '写超时文案仍保留「不要直接重放写操作」（实际：' + writeMsg.slice(0, 80) + '…）')

  // 调用方取消：不必等到钳制，应当立刻收摊，并且把中止信号传给后端。
  const ac = new AbortController()
  let seen2 = null
  const cscope = budgetMod.withCallScope(
    { tracker: deadTracker({ list: (repo, filter, ctx) => { seen2 = ctx; return hang() } }), opCtx: { opId: 'op-1831-cancel' } },
    { signal: ac.signal },
    { timeoutMs: 60000, marginMs: 400, now: () => Date.now() },
  )
  setTimeout(() => { try { ac.abort() } catch (e) {} }, 150)
  const t1 = Date.now()
  let cr = null
  try { cr = await cap(cscope.tracker.list({ backend: 'stub', refId: 'o/n' }, {}, cscope.opCtx), 6000) } catch (e) { check(false, '调用方取消后必须结束等待（' + e.message + '）'); return }
  const cdt = Date.now() - t1
  check(cr && cr.ok === false && cr.error && cr.error.kind === 'aborted', '调用方取消回 aborted（实得 ' + JSON.stringify(cr && cr.error) + '）')
  check(cdt < 4000, '调用方取消不等钳制到点（' + cdt + 'ms）')
  check(seen2 && seen2.signal && seen2.signal.aborted === true, '调用方取消也传给了后端（signal 已中止）')
}

// —— 二、读票：超时回部分结果，不假装完整 ——
async function sectionIssueGet(budget, ledgerMod, gateMod) {
  console.log('\n[二] 读票超时：回 partial + 未完成标记，文案只用读口径')
  const mod = await imp('src/deck/tools/issue-get.ts')
  const g = stubGateLedger(budget, gateMod, ledgerMod)
  const tool = mod.createDeckIssueGet(baseDeps({
    gate: g.gate,
    registry: stubRegistry('o/n', okTracker({ get: hang, getDependencies: hang })),
    budget: budget,
    readTimeoutMs: 900,
  }))
  const t0 = Date.now()
  let r = null
  try { r = await cap(tool.run(execFor(), { key: '7' }), 6000) } catch (e) { check(false, '读票超时必须结束等待（' + e.message + '）'); return }
  const dt = Date.now() - t0
  check(r && r.ok === false && r.status === 'partial', '读票超时回 status=partial（实得 ' + (r && r.status) + '）')
  check(r && r.reason === 'backend-timeout', '读票超时 reason 仍是 backend-timeout（#1799 映射不动，实得 ' + (r && r.reason) + '）')
  check(r && r.data && r.data.partial === true && r.data.incomplete === 'timeout', '读票超时 data 带 partial:true / incomplete:timeout')
  check(r && String(r.text).indexOf('不要直接重放写操作') < 0, '读票超时文案不出现写操作口径（实际：' + String((r && r.text) || '').slice(0, 90) + '…）')
  check(r && String(r.text).indexOf('读') >= 0, '读票超时文案明说这是一次读')
  check(dt < 5000, '读票超时有硬截止（' + dt + 'ms）')
}

// —— 三、读列表：超时回部分结果，回执里不再出现互相矛盾的两句话 ——
async function sectionIssueList(budget, ledgerMod, gateMod) {
  console.log('\n[三] 读列表超时：回 partial + 未完成标记，不拼写操作口径')
  const mod = await imp('src/deck/tools/issue-list.ts')
  const g = stubGateLedger(budget, gateMod, ledgerMod)
  const tool = mod.createDeckIssueList(baseDeps({
    gate: g.gate,
    registry: stubRegistry('o/n', okTracker({ list: hang })),
    budget: budget,
    readTimeoutMs: 900,
  }))
  const t0 = Date.now()
  let r = null
  try { r = await cap(tool.run(execFor(), { state: 'all', limit: 5 }), 6000) } catch (e) { check(false, '读列表超时必须结束等待（' + e.message + '）'); return }
  const dt = Date.now() - t0
  check(r && r.ok === false && r.status === 'partial', '读列表超时回 status=partial（实得 ' + (r && r.status) + '）')
  check(r && r.reason === 'backend-timeout', '读列表超时 reason 仍是 backend-timeout（实得 ' + (r && r.reason) + '）')
  check(r && r.data && r.data.partial === true && r.data.incomplete === 'timeout', '读列表超时 data 带 partial:true / incomplete:timeout')
  const text = String((r && r.text) || '')
  check(text.indexOf('不要直接重放写操作') < 0, '读列表回执不出现「不要直接重放写操作」（实际：' + text.slice(0, 110) + '…）')
  check(text.indexOf('读') >= 0 || text.indexOf('清单') >= 0, '读列表回执明说这是一次读/清单')
  check(dt < 5000, '读列表超时有硬截止（' + dt + 'ms）')
}

// —— 四、中央时间键与日志字段 ——
async function sectionConfigAndLog(timeMod, support) {
  console.log('\n[四] 读调用总时限有中央键；gh.timeout 带 opId')
  check(typeof timeMod.READ_CALL_TIMEOUT_MS === 'number' && isFinite(timeMod.READ_CALL_TIMEOUT_MS), '中央时间键存在：READ_CALL_TIMEOUT_MS（实得 ' + timeMod.READ_CALL_TIMEOUT_MS + '）')
  check(timeMod.READ_CALL_TIMEOUT_MS < 120000, '读调用总时限小于宿主 run_code 的 120 秒（实得 ' + timeMod.READ_CALL_TIMEOUT_MS + '）')
  check(timeMod.READ_CALL_TIMEOUT_MS < timeMod.TOOL_TIMEOUT_MS, '读调用总时限比写入用的 toolTimeoutMs 短（读不该等满 5 分钟）')
  const events = []
  const ctx = { opId: 'op-1831-log', logEvent: (level, event, fields) => events.push({ level: level, event: event, fields: fields }) }
  try { support.emitGhTimeout(ctx, 1000, 'room-tier', 'verify-1831', 'api:graphql', 0, 'inflight') } catch (e) {}
  const ev = events.filter((x) => x.event === 'gh.timeout')[0]
  check(!!ev, 'gh.timeout 事件真的发出来了')
  check(!!ev && ev.fields && ev.fields.opId === 'op-1831-log', 'gh.timeout 带 opId，能和宿主那趟操作对上（实得 ' + JSON.stringify(ev && ev.fields && ev.fields.opId) + '）')
}

async function main() {
  console.log('1831 读操作超时门禁（硬截止 / 部分结果 / 读口径 / 取消下传 / opId 日志）')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const budgetMod = await imp('src/refresh/rooms/host/tool-call-budget-enforcement.ts')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')
  const timeMod = await imp('src/shared/time-config/src/values.js')
  const support = await imp('src/tracker/rooms/github/transport/client-support.ts')
  try { await sectionBudget(budgetMod) } catch (e) { check(false, '预算壳段抛错：' + ((e && e.stack) || e)) }
  try { await sectionIssueGet(budget, ledgerMod, gateMod) } catch (e) { check(false, '读票段抛错：' + ((e && e.stack) || e)) }
  try { await sectionIssueList(budget, ledgerMod, gateMod) } catch (e) { check(false, '读列表段抛错：' + ((e && e.stack) || e)) }
  try { await sectionConfigAndLog(timeMod, support) } catch (e) { check(false, '配置与日志段抛错：' + ((e && e.stack) || e)) }
  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
