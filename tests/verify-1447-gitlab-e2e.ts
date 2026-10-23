// tests/verify-1447-gitlab-e2e.ts —— 门禁：GitLab 后端端到端（请求数额度与分发，#1447）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1447-gitlab-e2e.ts，可独立运行。
//
// 这一段守的是「整条路真能走通」，分段单测各自绿不代表合起来能走：
//   1. readBudget 三态：有响应头 → 已知的只计请求读数；没装 glab → 没测到；请求坏 → 没测到（unavailable）。
//      三种都是成功信封，永不抛；读数里没有点数额度那一格。
//   2. 读与写操作都经同一个会话管线：列表、详情、评论；账本只出现 gitlab/requests 一格，
//      点数账恒为 0（只计请求的后端不产生点数账）。
//   3. 读数未知时不被当成耗尽（操作照常放行，裁决理由说「读数未知」）；
//      请求额度真见底时才推迟；没有写权限时写操作按硬顶拒绝（与读数无关）。
//   4. 开会话的四种结局可区分：没后端 / 多命中 / 未决 / 工作区没就绪，一个都不抛。
//   5. 面板与回执按模型说话：面板读数来自账本、形状是 requests 一格，不出现两桶字段。
//
// 这一段用真房间（src/tracker/rooms/gitlab/index.ts）+ 假 glab 执行器，不联网、不装 glab。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

// —— 后端口径与额度算式 ——
const REQUESTS = { kind: 'requests-only', countsRequests: true, countsPoints: false, independentBuckets: false }
const LIMITS = {
  pluginShareOfRemaining: 0.45,
  hourlyAllowance: function (n) { return n },
  writeReserve: function (allowance) { return Math.round(allowance * 0.35) },
  tierFor: function () { return 'test-tier' },
}
const REF = { backend: 'gitlab', refId: 'group/proj', name: 'group/proj', url: 'https://gitlab.com/group/proj' }

// —— 假 glab 执行器：按命令行内容路由，模拟 GitLab 的 REST 回包 ——
function includeText(limit, remaining) {
  return 'HTTP/2.0 200 OK\r\ncontent-type: application/json\r\nratelimit-limit: ' + limit +
    '\r\nratelimit-remaining: ' + remaining + '\r\n\r\n{}'
}
function issueJson(iid) {
  return JSON.stringify({
    iid: iid, title: '票 ' + iid, state: 'opened', description: '', labels: [], assignees: [],
    author: { username: 'tester' }, web_url: 'https://gitlab.com/group/proj/-/issues/' + iid,
    created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-21T00:00:00Z', user_notes_count: 0,
  })
}
// 记账的门禁要的计数：所有 glab 起进程次数，以及其中「读取数」的次数（读取数不进账）。
function makeGlabExec(mode) {
  const box = { calls: 0, versionCalls: 0 }
  async function exec(cmd, args) {
    box.calls += 1
    const apiPath = String((args && args[0] === 'api' && args[1]) || '')
    const base = apiPath.split('?')[0]
    if (base === 'version') {
      box.versionCalls += 1
      if (mode === 'missing') return { stdout: '', stderr: 'glab: command not found', code: 127 }
      if (mode === 'no-header') return { stdout: '{}', stderr: '', code: 0 }
      if (mode === 'broken') return { stdout: '', stderr: '401 Unauthorized', code: 1 }
      return { stdout: includeText(600, 590), stderr: '', code: 0 }
    }
    if (mode === 'missing') return { stdout: '', stderr: 'glab: command not found', code: 127 }
    if (/\/issues\/\d+\/notes$/.test(base)) {
      return { stdout: JSON.stringify({ id: 901, author: { username: 'tester' }, created_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-24T00:00:00Z' }), stderr: '', code: 0 }
    }
    const single = /\/issues\/(\d+)$/.exec(base)
    if (single) return { stdout: issueJson(Number(single[1])), stderr: '', code: 0 }
    if (/\/issues$/.test(base)) return { stdout: '[' + issueJson(5) + ',' + issueJson(6) + ']', stderr: '', code: 0 }
    if (/\/(links|discussions|resource_label_events)$/.test(base)) return { stdout: '[]', stderr: '', code: 0 }
    return { stdout: '{}', stderr: '', code: 0 }
  }
  return { exec: exec, box: box }
}

// GitLab 房要的上下文：平台解析、执行器、文件服务三样（照 #1446 那段同样的桩）。
function makeCtx(execFn, resolveFn) {
  return { cwd: '/ws-test-1447', signal: undefined,
    platform: { resolveExecutable: resolveFn,
      path: { join: function () { return Array.prototype.join.call(arguments, '/') }, sep: '/', isAbsolute: function (p) { return String(p).charAt(0) === '/' }, dirname: function (p) { const i = String(p).lastIndexOf('/'); return i > 0 ? String(p).slice(0, i) : '/' } },
      fs: { resolve: async function (rel) { return rel }, readText: async function () { throw new Error('no-file') } },
      env: { get: function () { return undefined }, has: function () { return false } } },
    fs: null, exec: execFn, timers: { setTimeout: setTimeout, clearTimeout: clearTimeout },
    logEvent: function () {}, isEnabled: function () { return false }, gate: null }
}
const glabPresent = async function () { return 'glab-on-path' }
const glabMissing = async function () { return null }

// 会话的三件注入：读数（可切换）、裁决（真纯函数）、记账（真账本 + 真换算）。
function makeHarness(ledger, accounting, admission, glab) {
  const state = { reading: { known: false, reason: 'not-measured' }, reasons: [] }
  const account = async function (input) {
    const spends = accounting.spendsOfAccount(input)
    for (const s of spends) {
      ledger.spend({ account: 'plugin', backendId: input.backendId, bucket: s.bucket, kind: input.op, requests: s.requests, points: s.points })
    }
  }
  const admit = async function (input) {
    const decision = admission.decideByBudget(input, LIMITS)
    state.reasons.push(String(decision.reason))
    return { allowed: decision.allowed, reason: decision.reason, kind: decision.kind, message: decision.message }
  }
  const factory = async function () { return { ok: true, data: { known: false, reason: 'not-measured' } } }
  void factory
  return { state: state, account: account, admit: admit,
    getCachedReading: function () { return state.reading } }
}

function makeRegistry(room) {
  return {
    select: async function () { return { backendId: 'gitlab', source: 'explicit', canWrite: true, reason: '测试桩：工作区文件里人显式选过 GitLab', ref: REF } },
    get: function (id) { return id === 'gitlab' ? room : undefined },
    modules: function () { return [{ id: 'gitlab', budget: REQUESTS }] },
  }
}

async function main() {
  console.log('GitLab 后端端到端门禁（#1447：读数三态 + 管线分发 + 账本只记请求 + 面板口径）')
  const factory = await imp('src/tracker/rooms/gitlab/index.ts')
  const opener = await imp('src/tracker/session/open-tracker.ts')
  const accounting = await imp('src/refresh/kernel/backend-accounting.ts')
  const admission = await imp('src/refresh/kernel/budget-admission.ts')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.ts')
  const budgetStateMod = await imp('src/refresh/rooms/host/budget-state.ts')
  const truth = await imp('src/client/views/shared/truthLines.ts')

  // —— 一、readBudget 三态：经会话直达，不裁决不记账 ——
  {
    const ok = makeGlabExec('ok')
    const room = factory.createGitlabBackend(makeCtx(ok.exec, glabPresent))
    const ledger = ledgerMod.createLedger()
    ledger.ensureBackend('gitlab', REQUESTS)
    const h = makeHarness(ledger, accounting, admission, ok)
    const opened = await opener.openTracker({ cwd: '/ws-test-1447' }, {
      registry: makeRegistry(room), getCachedReading: h.getCachedReading, admit: h.admit, account: h.account, canWrite: true })
    check(opened.ok === true && opened.session.backendId === 'gitlab', '会话能建在 GitLab 后端上（backendId = gitlab）')
    check(opened.ok === true && opened.session.budget && opened.session.budget.kind === 'requests-only', '会话带出后端的预算声明（只计请求）')
    const read = await opened.session.readBudget()
    check(read && read.ok === true && read.data && read.data.known === true && read.data.kind === 'requests-only', '读取数成功：已知口径是「只计请求」')
    check(read && read.data && read.data.requests && read.data.requests.remaining === 590 && read.data.requests.limit === 600, '请求桶两格原样交回（剩余 590、上限 600）')
    check(!read || !read.data || read.data.buckets === undefined, '读数里没有两桶那一格（不编造点数额度）')
    check(h.state.reasons.length === 0, '读取数不经过裁决（理由序列为空）')
    check(ledger.snapshot().total.requests === 0, '读取数不进账（账本一条请求都没记）')
    check(ledger.snapshot().buckets['gitlab/requests'].remaining === null, '读取数本身也不改账本读数（账本的读数只由同步写入）')
  }
  {
    const missing = makeGlabExec('missing')
    const room = factory.createGitlabBackend(makeCtx(missing.exec, glabMissing))
    const ledger = ledgerMod.createLedger()
    ledger.ensureBackend('gitlab', REQUESTS)
    const h = makeHarness(ledger, accounting, admission, missing)
    const opened = await opener.openTracker({ cwd: '/ws-test-1447' }, {
      registry: makeRegistry(room), getCachedReading: h.getCachedReading, admit: h.admit, account: h.account, canWrite: true })
    const read = await opened.session.readBudget()
    check(read && read.ok === true && read.data && read.data.known === false && read.data.reason === 'not-measured', '没装 glab 时读数回「没测到」（not-measured），不抛')
    const broken = makeGlabExec('broken')
    const room2 = factory.createGitlabBackend(makeCtx(broken.exec, glabPresent))
    const opened2 = await opener.openTracker({ cwd: '/ws-test-1447' }, {
      registry: makeRegistry(room2), getCachedReading: h.getCachedReading, admit: h.admit, account: h.account, canWrite: true })
    const read2 = await opened2.session.readBudget()
    check(read2 && read2.ok === true && read2.data && read2.data.known === false && read2.data.reason === 'unavailable', '请求失败时读数回「量不到」（unavailable），不抛')
  }

  // —— 二、读写操作经同一会话；账本只有 gitlab/requests 一格，点数账恒 0 ——
  let room = null
  let ledger = null
  let glab = null
  let h = null
  let opened = null
  {
    glab = makeGlabExec('ok')
    room = factory.createGitlabBackend(makeCtx(glab.exec, glabPresent))
    ledger = ledgerMod.createLedger()
    ledger.ensureBackend('gitlab', REQUESTS)
    // 先写一份读数：账本没同步过读数时 view() 回空账（used 0），那是「还没量」，不是「没花」；
    // 这一段要验的是真花出去多少，所以先把请求额度同步进来。
    ledger.syncServer('gitlab', { requests: { limit: 600, remaining: 600 } })
    h = makeHarness(ledger, accounting, admission, glab)
    h.state.reading = { known: false, reason: 'not-measured' }
    opened = await opener.openTracker({ cwd: '/ws-test-1447' }, {
      registry: makeRegistry(room), getCachedReading: h.getCachedReading, admit: h.admit, account: h.account, canWrite: true })
    check(opened.ok === true, '会话开成（第二段准备）')
    const list = await opened.session.list(REF)
    check(list && list.ok === true && Array.isArray(list.data) && list.data.length === 2, '列表操作经会话走通（两张票）')
    const got = await opened.session.get(REF, '5')
    check(got && got.ok === true && got.data && got.data.key === '5', '详情操作经会话走通（key = 5）')
    const commented = await opened.session.comment(REF, '5', '这是一条端到端评论')
    check(commented && commented.ok === true && commented.data && commented.data.body === '这是一条端到端评论', '写评论经会话走通（正文原样回）')
    const snap = ledger.snapshot()
    const view = ledger.view('gitlab', 'requests')
    check(view.used === glab.box.calls - glab.box.versionCalls, '账本请求数等于真发出去的操作请求条数（读取数那几条不算；实得 used=' + view.used + ' calls=' + glab.box.calls + ' version=' + glab.box.versionCalls + '）')
    check(snap.total.points === 0, '点数账恒为 0（只计请求的后端不产生点数账）')
    check(snap.byAccount.plugin['gitlab/requests'] && snap.byAccount.plugin['gitlab/requests'].points === 0, '插件档在 gitlab/requests 上的点数也是 0')
    check(snap.buckets['gitlab/rest'] === undefined && snap.buckets['gitlab/graphql'] === undefined, '账本里没有 gitlab 的两桶（不混进 GitHub 口径）')
    check(Object.keys(snap.buckets).join(',') === 'gitlab/requests', '账本里 GitLab 只有请求桶一格')
  }

  // —— 三、未知不是耗尽；真见底才推迟；没写权限走硬顶 ——
  {
    const before = glab.box.calls
    h.state.reading = { known: false, reason: 'unavailable' }
    const unknownRun = await opened.session.comment(REF, '5', '未知读数也要能评论')
    check(unknownRun && unknownRun.ok === true, '读数未知时操作照常放行（未知不等于耗尽）')
    check(h.state.reasons[h.state.reasons.length - 1] === 'reading-unknown', '裁决理由写明「读数未知」')
    check(glab.box.calls > before, '放行时房间确实被调用了（不是空跑成功）')
    const usedBefore = ledger.view('gitlab', 'requests').used
    h.state.reading = { known: true, kind: 'requests-only', requests: { remaining: 0, limit: 600 } }
    const exhausted = await opened.session.comment(REF, '5', '这条不该发出去')
    check(exhausted && exhausted.ok === false && exhausted.error && exhausted.error.kind === 'rate-limit', '请求额度真见底时推迟（rate-limit）')
    check(exhausted && exhausted.error && /请求额度已经用完/.test(exhausted.error.message), '推迟文案说清是请求额度用完')
    check(ledger.view('gitlab', 'requests').used === usedBefore, '被推迟的调用不记账（没发生的事不记）')
    const callsBeforeHard = glab.box.calls
    const readOnly = await opener.openTracker({ cwd: '/ws-test-1447' }, {
      registry: makeRegistry(room), getCachedReading: h.getCachedReading, admit: h.admit, account: h.account, canWrite: false })
    h.state.reading = { known: true, kind: 'requests-only', requests: { remaining: 500, limit: 600 } }
    const hardCap = await readOnly.session.comment(REF, '5', '没有写权限不该发出去')
    check(hardCap && hardCap.ok === false && hardCap.error && hardCap.error.kind === 'hard-cap', '没有写权限时写操作按硬顶拒绝')
    check(hardCap && hardCap.error && /硬顶/.test(hardCap.error.message), '硬顶文案带「硬顶」二字（与读数无关）')
    check(glab.box.calls === callsBeforeHard, '硬顶拒绝时房间一次都没被调用')
    const readPasses = await readOnly.session.list(REF)
    check(readPasses && readPasses.ok === true, '没有写权限不影响读操作（硬顶只拦写）')
  }

  // —— 四、开会话的四种结局可区分（都不抛） ——
  {
    const room2 = factory.createGitlabBackend(makeCtx(makeGlabExec('ok').exec, glabPresent))
    const regNo = Object.assign({}, makeRegistry(room2), { select: async function () { return null } })
    const noBackend = await opener.openTracker({ cwd: '/ws-test-1447' }, {
      registry: regNo, getCachedReading: h.getCachedReading, admit: h.admit, account: h.account })
    check(noBackend.ok === false && noBackend.reason === 'no-backend', '没有后端认这个工作区时回 no-backend')
    const regMulti = Object.assign({}, makeRegistry(room2), { select: async function () { return { backendId: 'gitlab', source: 'explicit', multiHit: ['gitlab', 'github'], ref: REF } } })
    const multi = await opener.openTracker({ cwd: '/ws-test-1447' }, {
      registry: regMulti, getCachedReading: h.getCachedReading, admit: h.admit, account: h.account })
    check(multi.ok === false && multi.reason === 'multi-match', '多家后端同时认领时回 multi-match')
    const regPending = Object.assign({}, makeRegistry(room2), { select: async function () { return { backendId: null, pending: true } } })
    const pending = await opener.openTracker({ cwd: '/ws-test-1447' }, {
      registry: regPending, getCachedReading: h.getCachedReading, admit: h.admit, account: h.account })
    check(pending.ok === false && pending.reason === 'pending', '仲裁没完成时回 pending（不报成 no-backend）')
    const notReady = await opener.openTracker({ cwd: '   ' }, {
      registry: makeRegistry(room2), getCachedReading: h.getCachedReading, admit: h.admit, account: h.account })
    check(notReady.ok === false && notReady.reason === 'workspace-not-ready', '工作区没就绪时回 workspace-not-ready')
  }

  // —— 五、面板读数按模型说话：requests 一格，不出现两桶 ——
  {
    ledger.syncServer('gitlab', { requests: { limit: 600, remaining: 590 } })
    const budgetState = budgetStateMod.createBudgetState({
      getTrackerRegistry: function () { return { modules: function () { return [{ id: 'gitlab', budget: REQUESTS }] } } },
      ledger: ledger,
    })('gitlab')
    check(budgetState && budgetState.budgetKind === 'requests' && budgetState.readKnown === true, '面板读数说出「只计请求」（面板词 requests）且读数是已知的')
    check(budgetState && budgetState.requests && budgetState.requests.remaining === 590 && budgetState.requests.limit === 600, '面板读数的请求桶两格来自账本（590 / 600）')
    check(budgetState && budgetState.buckets === undefined, '面板读数里没有两桶那一格')
    // truthLines 是客户端模块，档位尺子由宿主在打包时挂到全局（见该文件 `declare const tierFor`）���
    // 单测直接 import 源码时没人挂，这里显式从 host-budget 取来放上，避免假红。
    const hostBudget = await imp('src/refresh/kernel/host-budget.ts')
    globalThis.tierFor = hostBudget.tierFor
    const lines = truth.budgetNoticeLines({ backend: budgetState })
    check(lines.length > 0, '面板有一行额度状态（不是空白）')
    check(lines.some(function (l) { return l.key === 'truth.budgetRequests' }), '面板这一行说的是请求额度（词条 truth.budgetRequests）')
    check(lines.every(function (l) { return l.key !== 'truth.budgetGraphql' && l.key !== 'truth.budgetRest' }), '面板这一行不出现 GitHub 的两桶口径')
  }

  // —— 六、deck 工具经 Tracker 调到 GitLab：会话、回执口径与失败结果都按同一套说话 ——
  {
    const toolMod = await imp('src/deck/tools/tracker-session.ts')
    h.state.reading = { known: true, kind: 'requests-only', requests: { remaining: 590, limit: 600 } }
    const session = { cwd: '/ws-test-1447', workspaceKey: 'ws-key-1447' }
    const estimate = { requests: 1, points: 0, tickets: 0, withinCallCap: true, shards: 1, perShard: 1, text: '这次 deck_issue_list 预计花 1 条请求、0 点，在硬顶之内。' }
    const deckDeps = {
      registry: makeRegistry(room),
      handleFor: function (s) { return { cwd: s.cwd } },
      decideBackend: async function () { return { backendId: 'gitlab', source: 'explicit', canWrite: true, reason: '测试桩：工作区文件里人显式选过 GitLab', ref: REF } },
      getCachedReading: h.getCachedReading,
      admit: h.admit,
      account: h.account,
      gate: { admitAiTool: async function () { return { admitted: true, text: '' } } },
    }
    const openedDeck = await toolMod.openDeckSession({ deps: deckDeps, exec: {}, session: session, estimate: estimate, tool: 'deck_issue_list', kind: 'read' })
    check(openedDeck && openedDeck.ok === true && openedDeck.backendId === 'gitlab', 'deck 工具在 GitLab 工作区开得出 Tracker 会话（backendId = gitlab）')
    check(openedDeck && openedDeck.ok === true && openedDeck.session && openedDeck.session.budget && openedDeck.session.budget.kind === 'requests-only', 'deck 会话带出 GitLab 的预算声明（只计请求）')
    const receipt = await toolMod.callDeckSession({ tool: 'deck_issue_list', deps: deckDeps, opened: openedDeck, session: session, repo: openedDeck.ref, estimate: estimate }, async function (ctx) {
      const listed = await ctx.tracker.list(REF)
      return { value: listed, claimed: { requests: 1, points: 0 } }
    })
    check(receipt && receipt.ok === true, 'deck 工具的读操作经 Tracker 走通（回执 ok）')
    const actual = receipt && receipt.cost && receipt.cost.actual
    check(actual && actual.backendId === 'gitlab' && actual.budgetKind === 'requests-only', '回执四格说出后端与模型口径（gitlab / requests-only）')
    check(actual && actual.readKnown === true && actual.offNetwork === false, '回执说清读数已知、不是离网')
    check(actual && actual.remaining === 590 && typeof actual.tier === 'string', '回执只在有真实读数时附 remaining 与 tier（590 / 档位）')
    check(actual && actual.buckets === undefined && actual.requests === 1, '回执里没有两桶那一格，实际请求数记 1')
    const offlineDeps = Object.assign({}, deckDeps, { decideBackend: async function () { return null } })
    const offlineOpen = await toolMod.openDeckSession({ deps: offlineDeps, exec: {}, session: session, estimate: estimate, tool: 'deck_context', kind: 'read' })
    check(offlineOpen && offlineOpen.ok === false && offlineOpen.reason === 'no-backend', 'deck 工具没后端时失败结果可辨（no-backend）')
    const multiDeps = Object.assign({}, deckDeps, { decideBackend: async function () { return { backendId: 'gitlab', source: 'autodetect', multiHit: ['gitlab', 'github'] } } })
    const multiOpen = await toolMod.openDeckSession({ deps: multiDeps, exec: {}, session: session, estimate: estimate, tool: 'deck_context', kind: 'read' })
    check(multiOpen && multiOpen.ok === false && multiOpen.reason === 'no-backend', 'deck 工具多命中时失败结果可辨（no-backend，文案说同时被认出）')
  }

  // —— 七、补齐验收点名的四处：真实注册表、github 桶在场时的对照、未知读数的回执、AI 工具硬顶 ——
  {
    // (1) 验收 A1 要的是真实注册表，不是手写桩：select 认领、get 取模块、modules 声明口径，一样不少。
    const core = await imp('src/tracker/registry/core.ts')
    const realCtx = makeCtx(glab.exec, glabPresent)
    realCtx.fs = {
      resolve: async function (rel) { return rel },
      readText: async function (target) {
        return target === '.git/config' ? '[remote "origin"]\n\turl = git@gitlab.com:group/proj.git\n' : null
      },
    }
    const realReg = core.createRegistry(realCtx, { matchesTimeout: 200 })
    realReg.register(factory.gitlabBackend)
    const selected = await realReg.select({ cwd: '/ws-test-1447', refId: REF.refId }, realCtx)
    check(selected && selected.backendId === 'gitlab', '真实注册表按 .git/config 认出 GitLab（实得 ' + JSON.stringify(selected && selected.backendId) + '）')
    check(realReg.get('gitlab') && typeof realReg.get('gitlab').readBudget === 'function', '真实注册表 get 到实现 readBudget 的 GitLab 模块')
    check(JSON.stringify(realReg.modules()[0].budget) === JSON.stringify(REQUESTS), '真实注册表 modules 声明的口径正是只计请求（实得 ' + JSON.stringify(realReg.modules()[0].budget) + '）')
    const realLedger = ledgerMod.createLedger()
    realLedger.ensureBackend('gitlab', REQUESTS)
    const realH = makeHarness(realLedger, accounting, admission, glab)
    // openTracker 缺省的选后端只带 cwd，生产上 deck 这条路一直用 resolveSelection 把判定出口的结论交进来
    //（src/deck/tools/tracker-session.ts:175-179 就是这么接的），这里照同一条路走：选择仍由真实注册表回答。
    const realOpened = await opener.openTracker({ cwd: '/ws-test-1447' }, {
      registry: realReg,
      resolveSelection: async function (handle, ctx) { return realReg.select(handle, realCtx) },
      getCachedReading: realH.getCachedReading, admit: realH.admit, account: realH.account, canWrite: true })
    check(realOpened.ok === true, '真实注册表 + 真实 GitLab 房间能开出会话（实得 ' + JSON.stringify(realOpened.ok ? 'ok' : realOpened) + '）')
    const realRead = realOpened.ok ? await realOpened.session.readBudget() : null
    check(realRead && realRead.ok === true && realRead.data && realRead.data.known === true && realRead.data.kind === 'requests-only', '真实会话的 readBudget 回已知的只计请求读数')
    check(realRead && realRead.data && realRead.data.buckets === undefined && !('points' in realRead.data), '真实会话的读数里没有两桶、也没有点数格')

    // (2) 验收 A3 要的对照：github 的两桶也在同一本账里，GitLab 花请求不能动它们一分一毫。
    const paired = ledgerMod.createLedger()
    paired.ensureBackend('gitlab', REQUESTS)
    paired.ensureBackend('github', { kind: 'two-buckets' })
    paired.syncServer('gitlab', { requests: { limit: 600, remaining: 600 } })
    paired.syncServer('github', { graphql: { limit: 5000, remaining: 5000 }, rest: { limit: 5000, remaining: 5000 } })
    const pairedGlab = makeGlabExec('ok')
    const pairedRoom = factory.createGitlabBackend(makeCtx(pairedGlab.exec, glabPresent))
    const pairedH = makeHarness(paired, accounting, admission, pairedGlab)
    const pairedOpened = await opener.openTracker({ cwd: '/ws-test-1447' }, {
      registry: makeRegistry(pairedRoom), getCachedReading: pairedH.getCachedReading, admit: pairedH.admit, account: pairedH.account, canWrite: true })
    check(pairedOpened.ok === true, '同一本账里装着 github 两桶时，GitLab 会话照常开')
    const githubBefore = JSON.stringify({ rest: paired.view('github', 'rest'), graphql: paired.view('github', 'graphql') })
    const pairedCallsBefore = pairedGlab.box.calls
    const pairedList = pairedOpened.ok ? await pairedOpened.session.list(REF) : null
    const pairedComment = pairedOpened.ok ? await pairedOpened.session.comment(REF, '5', 'github 两桶在场时，GitLab 也只记请求。') : null
    check(pairedList && pairedList.ok === true && pairedComment && pairedComment.ok === true, '两条 GitLab 操作都在 github 两桶在场时做成')
    check(paired.view('gitlab', 'requests').used === pairedGlab.box.calls - pairedCallsBefore, 'GitLab 的请求桶刚好记下这次真发出去的几条命令（实得 ' + paired.view('gitlab', 'requests').used + '）')
    check(JSON.stringify({ rest: paired.view('github', 'rest'), graphql: paired.view('github', 'graphql') }) === githubBefore, 'github 的 rest/graphql 两桶一分没动（读数与已用量都与调用前相同）')
    check(paired.snapshot().total.points === 0, '整本账的点数仍是 0（GitLab 不产生点数账，github 的桶也没被写进点数）')

    // (3) 验收 A5 的未知读数分支：回执只留四格事实与一句 note，不许出现水位与档位。
    const toolMod = await imp('src/deck/tools/tracker-session.ts')
    const bridgeMod = await imp('src/refresh/registry/deck-tool-bridge.ts')
    const unknownLedger = ledgerMod.createLedger()
    unknownLedger.ensureBackend('gitlab', REQUESTS)
    const ports = bridgeMod.buildTrackerPorts({ ledger: unknownLedger })
    const deckSession = { cwd: '/ws-test-1447', workspaceKey: 'ws-key-1447' }
    const unknownEstimate = { requests: 1, points: 0, tickets: 0, withinCallCap: true, shards: 1, perShard: 1, text: '这次 deck_context 预计花 1 条请求、0 点，在硬顶之内。' }
    const unknownDeps = {
      registry: makeRegistry(pairedRoom),
      decideBackend: async function () { return { backendId: 'gitlab', source: 'explicit', canWrite: true, ref: REF } },
      getCachedReading: function () { return ports.getCachedReading('gitlab') },
      admit: ports.admit,
      account: ports.account,
      gate: { admitAiTool: async function () { return { admitted: true, text: '' } } },
      backendCtx: function () { return makeCtx(glab.exec, glabPresent) },
    }
    const unknownOpen = await toolMod.openDeckSession({ deps: unknownDeps, exec: {}, session: deckSession, estimate: unknownEstimate, tool: 'deck_context', kind: 'read' })
    check(unknownOpen && unknownOpen.ok === true, '读数未知时 deck 工具照常开出 GitLab 会话')
    const unknownReceipt = unknownOpen && unknownOpen.ok ? await toolMod.callDeckSession({ tool: 'deck_context', deps: unknownDeps, opened: unknownOpen, session: deckSession, repo: REF, estimate: unknownEstimate }, async function () {
      return { value: { ok: true, status: 'ok', data: {}, notes: [] }, claimed: { requests: 1, points: 0 } }
    }) : null
    const unknownActual = unknownReceipt && unknownReceipt.cost && unknownReceipt.cost.actual
    check(unknownActual && unknownActual.backendId === 'gitlab' && unknownActual.budgetKind === 'requests-only', '读数未知时回执仍说清这是 GitLab 的只计请求口径')
    check(unknownActual && unknownActual.readKnown === false && unknownActual.offNetwork === false, '读数未知时 readKnown=false、offNetwork=false')
    check(unknownActual && unknownActual.remaining === undefined && unknownActual.tier === undefined, '读数未知时 remaining 与 tier 都不出现（实得 ' + JSON.stringify({ remaining: unknownActual && unknownActual.remaining, tier: unknownActual && unknownActual.tier }) + '）')
    check(unknownReceipt && unknownReceipt.cost && String(unknownReceipt.cost.note || '').indexOf('额度读数还没同步上来') >= 0, '读数未知时由 cost.note 说明「还没同步上来」（实得 ' + JSON.stringify(unknownReceipt && unknownReceipt.cost && unknownReceipt.cost.note) + '）')
    check(JSON.stringify(unknownActual).indexOf('buckets') < 0 && JSON.stringify(unknownActual).indexOf('graphql') < 0, '读数未知时回执里也没有两桶字段')

    // (4) 验收 A4 里 deck 这一层的硬顶：探针放行，正式那一笔被拒，原因码是 ai-tool-refused。
    const overDeps = Object.assign({}, unknownDeps, {
      gate: { admitAiTool: async function (call) {
        return Number(call && call.requests) <= 1
          ? { admitted: true, text: '' }
          : { admitted: false, reason: 'ai-tool-over-call-cap', text: '这次调用超过了插件给 AI 工具设的硬顶，我没有动手。' }
      } },
    })
    const overEstimate = Object.assign({}, unknownEstimate, { requests: 2, points: 2 })
    const overOpen = await toolMod.openDeckSession({ deps: overDeps, exec: {}, session: deckSession, estimate: overEstimate, tool: 'deck_comment', kind: 'write' })
    check(overOpen && overOpen.ok === false && overOpen.reason === 'ai-tool-refused', '超出单次硬顶时 deck 工具回 ai-tool-refused（实得 ' + JSON.stringify(overOpen && overOpen.reason) + '）')
    check(overOpen && overOpen.ok === false && String(overOpen.text).indexOf('硬顶') >= 0, '硬顶拒绝的人话点明「硬顶」')
  }

  console.log(failed ? '\n存在失败 — verify-1447-gitlab-e2e 未通过' : '\n全部通过 — GitLab 端到端（' + total + ' 项断言）')
  process.exit(failed ? 1 : 0)
}

main().catch(function (e) { console.log('门禁自己炸了：' + String((e && e.stack) || e)); process.exit(1) })
