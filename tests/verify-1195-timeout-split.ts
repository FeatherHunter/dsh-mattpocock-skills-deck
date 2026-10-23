// verify-1195-timeout-split.ts —— #1195 第三件门禁：四处工具的超时与抛错分家。
// 用法：在插件根目录执行 node tests/verify-1195-timeout-split.ts，可独立运行。
//
// 为什么要这一段：读票那一处（issue-get）已有 no-hang ③ 钉着超时走 backend-timeout；
// 其余四处（上报、建票、上下文、改票）同形同理，但没有各自的门禁 —— 任一处回退
// （超时重新抛给壳、与抛错共用 backend-threw），这里就红。本文件每处钉两层：
//   ① 后端挂住（守约响应信号）→ 超时走独立原因码 backend-timeout；
//   ② 后端直接抛错 → 仍走 backend-threw（两层分得开）。
// 本文件不联网：后端全是桩；挂住的桩都响应中止信号。
const path = require('path')
const { pathToFileURL } = require('url')
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const hangingHonest = (ctx) => new Promise((resolve, reject) => {
  const sig = ctx && ctx.signal
  if (sig && sig.aborted === true) { reject(new Error('调用方已中止')); return }
  if (sig && typeof sig.addEventListener === 'function') {
    sig.addEventListener('abort', () => reject(new Error('调用方已中止')), { once: true })
  }
})

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
    create: async (repo, input) => ({ ok: true, data: Object.assign({}, demoIssue, { key: '8' }) }),
    update: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    comment: async () => ({ ok: true, data: { key: '7' } }),
    close: async () => ({ ok: true, data: Object.assign({}, demoIssue, { state: 'closed' }) }),
    reopen: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    setLabels: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    setAssignees: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    setParent: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    setBlockedBy: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
  }, o)
}

function baseDeps(over) {
  const o = over || {}
  const base = Object.assign({
    estimate: (input) => ({ points: 1, requests: 1, tickets: 0, withinCallCap: true, shards: 1, perShard: 60, text: '' }),
    costInputFrom: () => ({ tool: 't' }),
    backendCtx: {},
    handleFor: (s) => ({ cwd: (s && s.cwd) || '' }),
    log: null,
    now: () => Date.now(),
    canonicalKey: async (raw) => raw,
    workspaceKeyOf: (cwd) => 'ws-test',
    toolTimeoutMs: 2000,
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
  console.log('1195 超时分家门禁（上报 / 建票 / 上下文 / 改票：超时与抛错各走各的码）')
  const budget = await imp('src/refresh/kernel/host-budget.js')
  const ledgerMod = await imp('src/host/refresh/ledger.ts')
  const gateMod = await imp('src/host/refresh/gate.ts')
  // 注意各操作的形参个数（壳按 backend.ts 的原形调，ctx 永远是最后一个）：
  // preflight(handle, ctx) / list(repo, filter, ctx) / get(repo, key, f, ctx) ——
  // list 曾经错写成两个参，ctx 拿到的其实是 filter，桩永远等不到中止（查 #1195 过程记录）。
  const hangAll = { preflight: (h, ctx) => hangingHonest(ctx), list: (repo, filter, ctx) => hangingHonest(ctx), get: (repo, key, f, ctx) => hangingHonest(ctx), getDependencies: (repo, key, f, ctx) => hangingHonest(ctx), create: (repo, input, ctx) => hangingHonest(ctx), update: (repo, key, p, ctx) => hangingHonest(ctx), comment: (repo, key, body, ctx) => hangingHonest(ctx) }
  const boomAll = { preflight: () => { throw new Error('探针故意做坏') }, list: () => { throw new Error('探针故意做坏') }, get: () => { throw new Error('探针故意做坏') }, create: () => { throw new Error('探针故意做坏') }, update: () => { throw new Error('探针故意做坏') }, comment: () => { throw new Error('探针故意做坏') } }
  const cases = [
    ['issue-report', 'src/deck/tools/issue-report.ts', 'createDeckIssueReport', { key: '7' }],
    ['issue-create', 'src/deck/tools/issue-create.ts', 'createDeckIssueCreate', { title: '分家演练票', kind: 'issue' }],
    ['context', 'src/deck/tools/context.ts', 'createDeckContext', {}],
    ['issue-patch', 'src/deck/tools/issue-patch.ts', 'createDeckIssuePatch', { key: '7', comment: '分家演练' }],
  ]
  for (const c of cases) {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp(c[1])
    const hangingTool = mod[c[2]](baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker(hangAll)), budget: budget }))
    const t1 = Date.now()
    const r = await hangingTool.run(execFor(), c[3])
    const dt = Date.now() - t1
    check(r && r.ok === false && r.reason === 'backend-timeout', c[0] + '：挂住走独立超时码（实得 ' + (r && r.reason) + '）')
    check(dt < 10000, c[0] + '：挂住在钳制内回来（' + dt + 'ms）')
    const g2 = stubGateLedger(budget, gateMod, ledgerMod)
    const throwingTool = mod[c[2]](baseDeps({ gate: g2.gate, registry: stubRegistry('o/n', okTracker(boomAll)), budget: budget }))
    const r2 = await throwingTool.run(execFor(), c[3])
    check(r2 && r2.ok === false && r2.reason === 'backend-threw', c[0] + '：抛错仍走 backend-threw（实得 ' + (r2 && r2.reason) + '）')
  }

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过'))
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
