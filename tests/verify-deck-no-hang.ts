// verify-deck-no-hang.ts —— 门禁：九个 deck 工具的挂起对抗（无上限等待一律有竞速兜底）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-deck-no-hang.ts，可独立运行。
//
// 为什么要这一段：线上曾出现 deck 工具“停在这边不动”——实测每次读 25～37 秒，
// 尾部还有发出后无回包的一笔。排查结论不是无限死锁，而是串行远端调用的叠加
// （单票读含全仓扫描、上下文含预检加全量清单）加出站排队无上限的等待。
// 本次加固给每一处无上限等待都加了竞速：归一、保读数、显式读、沙箱许可、
// 钩子、游标读写进壳钳制（单次 30 秒、整笔 5 分钟留 15 秒收尾；
// 整笔那条 2026-10-14 由两分钟放宽到五分钟、余量一并放到 15 秒，见票 #1040）。本文件钉住：
//   ① 挂住的归一 → 如实失败（no-session-context），不凑钥匙；
//   ② 挂住的沙箱/钩子/游标 → 走既有缺席路径，成功路径不变；
//   ③ 挂住的后端 → 30 秒内诚实回超时（backend-timeout，可重试），不改判成“做不到”；
//   ④ 已中止的调用 → 立刻诚实回，不起新进程；
//   ⑤ 执行层抛错仍走 backend-threw（可重试），与“做不到”分得开（与 verify-deck-tools ⑨ 同口径）。
// 本文件不联网：后端全是桩，只量“回不回、快不快、判得对不对”。
const path = require('path')
const { pathToFileURL } = require('url')
// 完成证据（#1158）：收尾交一行 GATE-RESULT。这一扇正是 #1146 的现场——21 条断言只跑到第 12 条
// 就收摊、退出码 0，整条链判绿；有了这行记录，执行器才会发现计数与期望对不上。
const { printGateResult } = require('./lib/gate-result.ts')
// 判定出口桩（#1003 单出口）：壳拿不到它时一律回「判定出口这次没装上」，
// 生产装配总会给，夹具照生产接上；桩的来历见 tests/lib/deck-decide-stub.js 文件头。
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')
// 时间压缩：本门的墙钟时间几乎全花在「等超时」上 —— ① ② ⑥ 那三处挂住的等待各等满 5 秒竞速、
// ⑦ 等满游标读写那 10 秒竞速、③ 等满工具的单次钳制。桩后端本来就永不回话，这些竞速必然走到超时那一支，
// 等的时间全是空等。压缩成虚拟时间以后真实只等几毫秒，而 Date.now() 报出来的仍是 5 秒 / 10 秒，
// 下面「不许等太久」（dt < 12000 这类）与「诚实回超时」的判据照旧成立。断言一条没动；
// 理由、两条不能破的语义与边界见 tests/lib/time-compress.js 文件头。
const { installTimeCompression, uninstallTimeCompression } = require('./lib/time-compress.js')
// 原生的定时器口，必须在 installTimeCompression 之前抓下来：下面 main 里要用它留一个「被引用」的把手。
// 原因是产品侧有几处等待口自己就是 unref 过的（src/deck/shell/call-shell.ts 里的 realSleep，见 #1114），
// 而本门禁从头到尾只靠虚拟时钟推进：虚拟队列的泵在「一个被引用的等待都没有」的时候会把自己也 unref，
// 于是事件循环会在产品还等在一个挂住的钩子上时先一步收摊 —— 后面的断言一条都不跑，
// 退出码仍然是 0，看上去像全绿（实测：21 条断言只跑到第 12 条）。
// 这个把手走原生定时器，不进虚拟队列，因此不会推开虚拟时钟，只负责让进程活到断言跑完。
const nativeSetInterval = setInterval
const nativeClearInterval = clearInterval
installTimeCompression()

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
    describe: () => ({ backend: 'stub', refId: pickRefId, name: pickRefId, url: '' }),
  }
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
  // 判定出口（#1003 单出口）：壳拿不到它时一律回「判定出口这次没装上」，生产装配总会给。
  // 这里按夹具自己那张桩注册表补上（桩的来历见 tests/lib/deck-decide-stub.js 文件头）。
  // #1138 起「这个工作区选过了」只剩工作区文件一份记录（注册表上的 bound 已整段删掉）：
  // 本夹具的会话 cwd 一律是 execFor 的缺省值 D:/demo，给它记一笔就等于这个工作区里有那份文件。
  if (!base.decideBackend && base.registry) base.decideBackend = makeDecideStub(base.registry)
  chooseWorkspace('D:/demo', 'stub')
  return base
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
  const ledgerMod = await imp('src/host/refresh/ledger.ts')
  const gateMod = await imp('src/host/refresh/gate.ts')
  const t0 = Date.now()
  // 断言跑完之前一直拖住事件循环，理由与两个原生口的来历见本文件上面 installTimeCompression 前的注释。
  // 1 秒只是随手挑的间隔：它不回话、不推进虚拟时钟，唯一作用是被事件循环算作一个还活着的句柄。
  const keepAlive = nativeSetInterval(function () {}, 1000)

  // ① 挂住的归一 → 如实失败，不凑钥匙（5 秒竞速内回来）
  {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp('src/deck/tools/context.ts')
    const tool = mod.createDeckContext(baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker()), budget: budget, canonicalKey: hanging }))
    const t1 = Date.now()
    const r = await tool.run(execFor(), {})
    const dt = Date.now() - t1
    check(r && r.ok === false && r.reason === 'no-session-context', '挂住的归一如实失败（实得 ' + (r && r.reason) + '）')
    check(dt < 12000, '归一挂住仍在竞速内回来（' + dt + 'ms）')
  }

  // ② 挂住的沙箱许可 → 按缺席走老路，读照样回来
  // #1195 起预算从工具入口算：沙箱竞速的 15 秒（各工具 SANDBOX_TIMEOUT_MS，真源是
  // config/timeouts.yaml 的 deckSandboxMs）是入口前耗时，会进剩余额度。所以这一节的整笔
  // 预算必须大于沙箱上限，否则诚实回没做成才是对的；“沙箱挂住读照样回来”不断的是
  // “按缺席走老路”这条路，不是“预算看不见入口前耗时”。
  // 2026-10-17 修：这里原来写死 12000，而 deckSandboxMs 在 #1160 已从 5 秒提到 15 秒，
  // 夹具没跟着改，于是本门禁假红（行为本身没坏）。改成从中央常量取数，以后调档不会再假红。
  {
    const tc = await imp('src/shared/time-config/values.js')
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp('src/deck/tools/issue-get.ts')
    const tool = mod.createDeckIssueGet(baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker()), budget: budget, toolTimeoutMs: tc.DECK_SANDBOX_TIMEOUT_MS * 2, sandboxPolicyFor: hanging }))
    const t1 = Date.now()
    const r = await tool.run(execFor(), { key: '7' })
    const dt = Date.now() - t1
    check(r && r.status === 'ok', '沙箱挂住读照样回来（实得 ' + (r && r.status) + '）')
    check(dt < tc.DECK_SANDBOX_TIMEOUT_MS + 5000, '沙箱挂住仍在竞速内回来（' + dt + 'ms）')
  }

  // ③ 挂住（但守约响应信号）的后端 get → 钳制内诚实回超时，不改判成“做不到”
  {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp('src/deck/tools/issue-get.ts')
    const tool = mod.createDeckIssueGet(baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker({ get: (repo, key, f, ctx) => hangingHonest(ctx), getDependencies: (repo, key, f, ctx) => hangingHonest(ctx) })), budget: budget }))
    const t1 = Date.now()
    const r = await tool.run(execFor(), { key: '7' })
    const dt = Date.now() - t1
    check(r && r.ok === false && r.status === 'unsupported', '挂住的后端诚实回没做成（实得 ' + (r && r.status) + '）')
    check(r && r.reason === 'backend-timeout', '超时判成独立的超时原因（实得 ' + (r && r.reason) + '）')
    check(dt < 10000, '后端挂住仍在钳制内回来（' + dt + 'ms）')
  }

  // ④ 已中止的调用 → 立刻诚实回，不抛（守约的后端，信号即停）
  {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp('src/deck/tools/issue-get.ts')
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
    const mod = await imp('src/deck/tools/issue-create.ts')
    const tool = mod.createDeckIssueCreate(baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker({ create: boom })), budget: budget }))
    const r = await tool.run(execFor(), { title: '会抛的那一张' })
    check(r && r.ok === false && r.reason === 'backend-threw', '抛错判成可重试（实得 ' + (r && r.reason) + '）')
    check(typeof r.text === 'string' && r.text.indexOf('后端实现抛错') >= 0, '抛错原话带回 text')
  }

  // ⑥ 挂住的建票钩子 → 建票照样 OK
  {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp('src/deck/tools/issue-create.ts')
    const tool = mod.createDeckIssueCreate(baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker()), budget: budget, onTicketCreated: hanging }))
    const t1 = Date.now()
    const r = await tool.run(execFor(), { title: '钩子挂住的那一张' })
    const dt = Date.now() - t1
    check(r && r.status === 'ok', '建票钩子挂住照样 OK（实得 ' + (r && r.status) + '）')
    check(dt < 12000, '建票钩子挂住仍在竞速内回来（' + dt + 'ms）')
  }

  // ⑦ 游标读挂住 → 建图照样推进（锚与幂等键仍是去重权威；生产预算 5 分钟，游标竞速 10 秒）
  {
    const g = stubGateLedger(budget, gateMod, ledgerMod)
    const mod = await imp('src/deck/tools/map-plan-create.ts')
    const store = { durable: true, load: hanging, save: async () => {}, remove: async () => {} }
    const tool = mod.createDeckMapPlanCreate(baseDeps({ gate: g.gate, registry: stubRegistry('o/n', okTracker()), budget: budget, planStore: store, toolTimeoutMs: 60000, toolMarginMs: 5000 }))
    const t1 = Date.now()
    const r = await tool.run(execFor(), { title: '游标挂住的图', children: [{ key: 'c1', title: '子票一' }], planId: 'hang-plan-1' })
    const dt = Date.now() - t1
    const v = (r && r.value) || r
    check(v && (v.status === 'ok' || v.status === 'partial'), '游标挂住建图照样推进（实得 ' + (v && v.status) + '）')
    check(dt < 20000, '游标挂住仍在竞速内回来（' + dt + 'ms）')
  }

  // ⑧ 装配层竞速 helper：超时按失败回，成功原样透出
  {
    const asm = await imp('src/deck/registration/host-assemble.ts')
    check(typeof asm.withCap === 'function', '装配层交出竞速 helper')
    const fast = await asm.withCap(Promise.resolve(42), 1000)
    check(fast && fast.ok === true && fast.value === 42, '成功原样透出')
    const slow = await asm.withCap(hanging(), 200)
    check(slow && slow.ok === false && slow.timedOut === true, '超时按失败回')
  }

  // 断言跑完了，把把手撤掉，别让它把进程吊在收尾之后。
  nativeClearInterval(keepAlive)
  console.log('\n' + total + ' 条断言，' + (failed ? '失败' : '通过') + '（总耗时 ' + (Date.now() - t0) + 'ms）')
  // 完成记录：total 是实际跑过的断言数（#1146 那次只跑到 12 就收摊，这里报出来的就会是 12）。
  printGateResult('verify-deck-no-hang', total, failed ? 1 : 0)
  // 收工先把全局时钟还原：本仓打算把多扇门禁放进同一个进程跑，别把虚拟时钟留给后面那几扇。
  uninstallTimeCompression()
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('门禁抛错：' + ((e && e.stack) || e)); uninstallTimeCompression(); process.exit(1) })
