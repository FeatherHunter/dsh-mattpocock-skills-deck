// verify-1195-budget-start.ts —— #1195 第一件门禁：工具预算从入口起算。
// 用法：在插件根目录执行 node tests/verify-1195-budget-start.ts，可独立运行。
//
// 为什么要这一段：预算壳的起算点曾经落在建壳那一刻（withCallScope 里 startedAt: nowFn()），
// 而建壳发生在选后端、探沙箱之后 —— 入口前耗时（会话归一、选后端、探沙箱）在慢装置上
// 可以很长，内层预算却看不见它。现在起算点统一为工具入口（run 开头记下的那一刻），
// 经 startedAt 传给预算壳。本文件钉住三层，任一层被拿掉都红：
//   ① 单元：withCallScope 认 startedAt（剩余额度从入口算；未来的值按现在算，不倒欠）。
//   ② 行为：沙箱那一步把假时钟推后 5800 毫秒、整笔预算 6000 毫秒时，读票直接诚实回没做成
//       （剩余额度 200 毫秒不够收尾余量 500 毫秒）；沙箱不慢时照样成功。
//   ③ 接线：九个工具都把入口时间传给 withCallScope（回退任一文件即红）。
// 本文件不联网：后端与沙箱全是桩；时钟是假时钟，只量“看不看得见入口前耗时”。
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

function stubGateLedger(budget, gateMod, ledgerMod) {
  const clock = { now: 1700000000000 }
  const ledger = ledgerMod.createLedger({ now: () => clock.now })
  const gate = gateMod.createGate({ ledger: ledger, now: () => clock.now })
  ledger.syncServer({ rest: { limit: 5000, remaining: 5000, reset: clock.now + 3600000 }, graphql: { limit: 5000, remaining: 5000, reset: clock.now + 3600000 } }, clock.now)
  return { gate: gate, ledger: ledger, clock: clock }
}

function stubRegistry(pickRefId, tracker) {
  return {
    select: async () => ({ backendId: 'stub', source: 'explicit', ref: { backend: 'stub', refId: pickRefId, name: pickRefId, url: '' }, pending: false }),
    get: () => tracker,
    has: () => true,
    describe: () => ({ backend: 'stub', refId: pickRefId, name: pickRefId, url: '' }),
  }
}

const demoIssue = { key: '7', title: '演练票', state: 'open', type: 'issue', labels: [], assignees: [], updatedAt: '', closedAt: '', url: '', body: '# 演练票\n' }

function okTracker(over) {
  const o = over || {}
  return Object.assign({
    preflight: async () => ({ ok: true }),
    list: async () => ({ ok: true, data: [] }),
    get: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    getDependencies: async () => ({ ok: true, data: { blockedBy: [], blocking: [] } }),
  }, o)
}

function baseDeps(now, over) {
  const o = over || {}
  const base = Object.assign({
    estimate: (input) => ({ points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 60, text: '' }),
    costInputFrom: () => ({ tool: 't' }),
    backendCtx: {},
    handleFor: (s) => ({ cwd: (s && s.cwd) || '' }),
    log: null,
    now: now,
    canonicalKey: async (raw) => raw,
    workspaceKeyOf: (cwd) => 'ws-test',
    toolTimeoutMs: 6000,
    toolMarginMs: 500,
  }, o)
  if (!base.decideBackend && base.registry) base.decideBackend = makeDecideStub(base.registry)
  chooseWorkspace('D:/demo', 'stub')
  return base
}

function execFor(cwd) {
  return { agent: { session: { id: 's-1195', cwd: cwd || 'D:/demo' } } }
}

async function main() {
  console.log('1195 预算起算点门禁（入口前耗时进预算）')
  const budgetMod = await imp('src/refresh/rooms/host/tool-call-budget-enforcement.ts')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.ts')

  // ① 单元：startedAt 进剩余额度
  {
    const now = { current: 6800 }
    const nowFn = () => now.current
    const c = { tracker: null, now: nowFn }
    const withEntry = budgetMod.withCallScope(c, null, { timeoutMs: 6000, marginMs: 500, startedAt: 1000, now: nowFn })
    check(withEntry.budget.startedAt === 1000, '起算点用传进来的入口时间（实得 ' + withEntry.budget.startedAt + '）')
    check(withEntry.remainingMs() === 200, '剩余额度从入口算（实得 ' + withEntry.remainingMs() + '）')
    check(withEntry.outOfBudget() === true, '剩 200 毫秒不够 500 毫秒收尾余量时判超支')
    const withoutEntry = budgetMod.withCallScope(c, null, { timeoutMs: 6000, marginMs: 500, now: nowFn })
    check(withoutEntry.remainingMs() === 6000, '没传起算点时按老口径（建壳这一刻，实得 ' + withoutEntry.remainingMs() + '）')
    check(withoutEntry.outOfBudget() === false, '老口径下同样的时间点判不超支')
    const futureEntry = budgetMod.withCallScope(c, null, { timeoutMs: 6000, marginMs: 500, startedAt: 99999, now: nowFn })
    check(futureEntry.remainingMs() === 6000, '未来的起算点按现在算、不倒欠（实得 ' + futureEntry.remainingMs() + '）')
  }

  // ② 行为：入口前耗时（这里是沙箱那一步）能被内层预算看见
  {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp('src/deck/tools/issue-get.ts')
    const now = { current: 1000000 }
    const slowSandbox = async () => { now.current += 5800; return null }
    const slowTool = mod.createDeckIssueGet(baseDeps(() => now.current, { gate: g.gate, registry: stubRegistry('o/n', okTracker()), budget: budget, sandboxPolicyFor: slowSandbox }))
    const slowR = await slowTool.run(execFor(), { key: '7' })
    check(slowR && slowR.ok === false, '入口前耗掉 5800 毫秒后整笔诚实回没做成（实得 ok=' + (slowR && slowR.ok) + '）')
    const now2 = { current: 1000000 }
    const fastTool = mod.createDeckIssueGet(baseDeps(() => now2.current, { gate: g.gate, registry: stubRegistry('o/n', okTracker()), budget: budget, sandboxPolicyFor: async () => null }))
    const fastR = await fastTool.run(execFor(), { key: '7' })
    check(fastR && fastR.status === 'ok', '入口前不耗时时照样成功（实得 ' + (fastR && fastR.status) + '）')
  }

  // ③ 接线：九个工具都传 startedAt
  {
    const tools = ['context', 'issue-get', 'issue-list', 'map-snapshot', 'issue-create', 'map-plan-create', 'map-link', 'issue-patch', 'issue-report']
    for (const name of tools) {
      const src = fs.readFileSync(path.join(ROOT, 'src', 'deck', 'tools', name + '.ts'), 'utf8')
      check(src.indexOf('startedAt: toolEntryAt') >= 0, name + ' 把入口时间传给预算壳')
    }
  }

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
