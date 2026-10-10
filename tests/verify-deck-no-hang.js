// verify-deck-no-hang.js —— 门禁：九个 deck 工具的挂起对抗（无上限等待一律有竞速兜底）
// 用法：在插件根目录执行 node tests/verify-deck-no-hang.js，可独立运行。
//
// 为什么要这一段：线上曾出现 deck 工具“停在这边不动”——实测每次读 25～37 秒，
// 尾部还有发出后无回包的一笔。排查结论不是无限死锁，而是串行远端调用的叠加
// （单票读含全仓扫描、上下文含预检加全量清单）加出站排队无上限的等待。
// 本次加固给每一处无上限等待都加了竞速：归一、保读数、显式读、沙箱许可、
// 钩子、游标读写进壳钳制（单次 30 秒、整笔 120 秒留 10 秒收尾）。本文件钉住：
//   ① 挂住的归一 → 如实失败（no-session-context），不凑钥匙；
//   ② 挂住的沙箱/钩子/游标 → 走既有缺席路径，成功路径不变；
//   ③ 挂住的后端 → 30 秒内诚实回超时（backend-threw，可重试），不改判成“做不到”；
//   ④ 已中止的调用 → 立刻诚实回，不起新进程；
//   ⑤ 执行层抛错仍走 backend-threw（可重试），与“做不到”分得开（与 verify-deck-tools ⑨ 同口径）。
// 本文件不联网：后端全是桩，只量“回不回、快不快、判得对不对”。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const hanging = () => new Promise(() => {})
// 按契约挂住的后端：永远不回正常结果，但必须响应 OpContext.signal（真实后端都响应，
// execGh/detectionExec 见到中止即结算）。不响应信号的后端会让任何钳制都等不到结算——
// 那是后端违约，不是工具能修的；工具只保证信号发出并放回名额。
const hangingHonest = (ctx) => new Promise((resolve, reject) => {
  const sig = ctx && ctx.signal
  if (sig && sig.aborted === true) { reject(new Error('调用方已中止')) ; return }
  if (sig && typeof sig.addEventListener === 'function') {
    sig.addEventListener('abort', () => reject(new Error('调用方已中止')), { once: true })
  }
})
const fastUnsupported = { ok: false, error: { kind: 'unsupported', message: '桩：做不到' } }

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
    bound: () => 'stub',
    describe: () => ({ backend: 'stub', refId: pickRefId, name: pickRefId, url: '' }),
  }
}

function baseDeps(over) {
  const o = over || {}
  return Object.assign({
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
}

const demoIssue = { key: '7', title: '演练票', state: 'open', type: 'issue', labels: [], assignees: [], updatedAt: '', closedAt: '', url: '', body: '# 演练票\n\n## 进度\n\n- 第一步\n' }

function okTracker(over) {
  const o = over || {}
  return Object.assign({
    preflight: async () => ({ ok: true }),
    list: async () => ({ ok: true, data: [] }),
    get: async () => ({ ok: true, data: Object.assign({}, demoIssue) }),
    getDependencies: async () => ({ ok: true, data: { blockedBy: [], blocking: [] } }),
    create: async (repo, input) => ({ ok: true, data: Object.assign({}, demoIssue, { key: '8', title: (input && input.title) || '新票' }) }),
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

function execFor(cwd) {
  return { agent: { session: { id: 's-hang', cwd: cwd || 'D:/demo' } } }
}

async function main() {
  console.log('deck 工具挂起对抗门禁（竞速兜底 + 分类不变 + 中止即停）')
  const budget = await imp('src/shared/refresh/budget.js')
  const ledgerMod = await imp('src/host/refresh/ledger.js')
  const gateMod = await imp('src/host/refresh/gate.js')
  const t0 = Date.now()

  // ① 挂住的归一 → 如实失败，不凑钥匙（5 秒竞速内回来）
  {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp('src/host/tools/deckContext.js')
    const tool = mod.createDeckContext(baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker()), budget: budget, canonicalKey: hanging }))
    const t1 = Date.now()
    const r = await tool.run(execFor(), {})
    const dt = Date.now() - t1
    check(r && r.ok === false && r.reason === 'no-session-context', '挂住的归一如实失败（实得 ' + (r && r.reason) + '）')
    check(dt < 12000, '归一挂住仍在竞速内回来（' + dt + 'ms）')
  }

  // ② 挂住的沙箱许可 → 按缺席走老路，读照样回来
  {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp('src/host/tools/deckIssueGet.js')
    const tool = mod.createDeckIssueGet(baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker()), budget: budget, sandboxPolicyFor: hanging }))
    const t1 = Date.now()
    const r = await tool.run(execFor(), { key: '7' })
    const dt = Date.now() - t1
    check(r && r.status === 'ok', '沙箱挂住读照样回来（实得 ' + (r && r.status) + '）')
    check(dt < 12000, '沙箱挂住仍在竞速内回来（' + dt + 'ms）')
  }

  // ③ 挂住（但守约响应信号）的后端 get → 钳制内诚实回超时，不改判成“做不到”
  {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp('src/host/tools/deckIssueGet.js')
    const tool = mod.createDeckIssueGet(baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker({ get: (repo, key, f, ctx) => hangingHonest(ctx), getDependencies: (repo, key, f, ctx) => hangingHonest(ctx) })), budget: budget }))
    const t1 = Date.now()
    const r = await tool.run(execFor(), { key: '7' })
    const dt = Date.now() - t1
    check(r && r.ok === false && r.status === 'unsupported', '挂住的后端诚实回没做成（实得 ' + (r && r.status) + '）')
    check(r && r.reason === 'backend-threw', '超时判成可重试的执行失败（实得 ' + (r && r.reason) + '）')
    check(dt < 10000, '后端挂住仍在钳制内回来（' + dt + 'ms）')
  }

  // ④ 已中止的调用 → 立刻诚实回，不抛（守约的后端，信号即停）
  {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp('src/host/tools/deckIssueGet.js')
    const tool = mod.createDeckIssueGet(baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker({ get: (repo, key, f, ctx) => hangingHonest(ctx) })), budget: budget }))
    const ctrl = new AbortController()
    ctrl.abort()
    const exec = Object.assign(execFor(), { signal: ctrl.signal })
    let threw = null
    let r = null
    const t1 = Date.now()
    try { r = await tool.run(exec, { key: '7' }) } catch (e) { threw = e }
    const dt = Date.now() - t1
    check(!threw, '已中止的调用不抛')
    check(r && r.ok === false, '已中止的调用诚实回没做成')
    check(dt < 5000, '已中止的调用立刻回来（' + dt + 'ms）')
  }

  // ⑤ 后端抛错仍走 backend-threw（与“做不到”分得开）
  {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const boom = () => { throw new Error('探针故意做坏') }
    const mod = await imp('src/host/tools/deckIssueCreate.js')
    const tool = mod.createDeckIssueCreate(baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker({ create: boom })), budget: budget }))
    const r = await tool.run(execFor(), { title: '会抛的那一张' })
    check(r && r.ok === false && r.reason === 'backend-threw', '抛错判成可重试（实得 ' + (r && r.reason) + '）')
    check(typeof r.text === 'string' && r.text.indexOf('后端实现抛错') >= 0, '抛错原话带回 text')
  }

  // ⑥ 挂住的记链钩子 → 上报照样 OK，只如实说没记进链
  {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp('src/host/tools/deckIssueReport.js')
    const tool = mod.createDeckIssueReport(baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker()), budget: budget, chainNote: hanging }))
    const t1 = Date.now()
    const r = await tool.run(execFor(), { key: '7' })
    const dt = Date.now() - t1
    check(r && r.status === 'ok', '记链挂住上报照样 OK（实得 ' + (r && r.status) + '）')
    check(dt < 12000, '记链挂住仍在竞速内回来（' + dt + 'ms）')
  }

  // ⑦ 挂住的建票钩子 → 建票照样 OK
  {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp('src/host/tools/deckIssueCreate.js')
    const tool = mod.createDeckIssueCreate(baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker()), budget: budget, onTicketCreated: hanging }))
    const t1 = Date.now()
    const r = await tool.run(execFor(), { title: '钩子挂住的那一张' })
    const dt = Date.now() - t1
    check(r && r.status === 'ok', '建票钩子挂住照样 OK（实得 ' + (r && r.status) + '）')
    check(dt < 12000, '建票钩子挂住仍在竞速内回来（' + dt + 'ms）')
  }

  // ⑧ 游标读挂住 → 建图照样推进（锚与幂等键仍是去重权威；生产预算 120 秒，游标竞速 10 秒）
  {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp('src/host/tools/deckMapPlanCreate.js')
    const store = { durable: true, load: hanging, save: async () => {}, remove: async () => {} }
    const tool = mod.createDeckMapPlanCreate(baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker()), budget: budget, planStore: store, toolTimeoutMs: 60000, toolMarginMs: 5000 }))
    const t1 = Date.now()
    const r = await tool.run(execFor(), { title: '游标挂住的图', children: [{ key: 'c1', title: '子票一' }], planId: 'hang-plan-1' })
    const dt = Date.now() - t1
    const v = (r && r.value) || r
    check(v && (v.status === 'ok' || v.status === 'partial'), '游标挂住建图照样推进（实得 ' + (v && v.status) + '）')
    check(dt < 20000, '游标挂住仍在竞速内回来（' + dt + 'ms）')
  }

  // ⑨ 装配层竞速 helper：超时按失败回，成功原样透出
  {
    const asm = await imp('src/host/platform/deckToolsAssembly.js')
    check(typeof asm.withCap === 'function', '装配层交出竞速 helper')
    const fast = await asm.withCap(Promise.resolve(42), 1000)
    check(fast && fast.ok === true && fast.value === 42, '成功原样透出')
    const slow = await asm.withCap(hanging(), 200)
    check(slow && slow.ok === false && slow.timedOut === true, '超时按失败回')
  }

  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过') + '（总耗时 ' + (Date.now() - t0) + 'ms）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); process.exit(1) })
