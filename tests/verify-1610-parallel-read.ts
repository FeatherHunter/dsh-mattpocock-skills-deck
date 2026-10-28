// tests/verify-1610-parallel-read.ts —— #1610：读票与读阻塞边一起发出去，报账按实际发出数。
//
// 为什么有这扇门禁：deck_issue_get 读一张票要发两次远端调用（票本身、反向阻塞边）。从前这两条
// 是串行等的，两次等待相加；回执里的实际用量又写死成 requests:1/2、points:3/6，读票先失败、
// 依赖查询却已经发出去的时候，回执照样报 1 条，账对不上。本票要求：两条查询一起发出去；
// 报账数字由预算壳数出来的「已经派发出去的远端调用数」决定，不再写死。
//
// 怎么证明并发：桩房间的两条查询进门时各记一笔「此刻同时开着几条」，两条都进门之后才放行。
// 串行时后一条永远进不来，同时在开的峰值只到 1；并发时峰值是 2。这条断言不掐时间，
// 慢机器上也不会误红。
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

let total = 0
let failed = 0
function check(ok: unknown, label: string): void {
  total += 1
  if (!ok) { failed += 1; console.error('FAIL ' + label) } else { console.log('ok ' + total + ' ' + label) }
}
async function imp(p: string): Promise<any> {
  return import('../' + p.replace(/\.js$/, '.ts'))
}

/** 一个真实本地 Markdown 工作区（与 tests/verify-1442-tracker-tools.ts 同一套做法）。 */
function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1610-'))
  const dir = path.join(root, '.scratch', 'demo')
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true })
  const plat = {
    path: path.posix,
    fs: {
      async resolve(p: string) { return String(p).replace(/\\/g, '/') },
      async readText(t: string) { return fs.readFileSync(t, 'utf8') },
      async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8') },
      async lstat(t: string) { try { return fs.statSync(t) } catch { return null } },
      async listDir(t: string) { try { return fs.readdirSync(t) } catch { return [] } },
      async stat(t: string) { try { return fs.statSync(t) } catch { return null } },
    },
  }
  const rootPosix = root.replace(/\\/g, '/')
  return {
    root: root, rootPosix: rootPosix,
    ctx: { platform: plat, fs: plat.fs, cwd: rootPosix, get(name: string) { return name === 'fs' ? plat.fs : undefined } },
    cleanup() { try { fs.rmSync(root, { recursive: true, force: true }) } catch { } },
  }
}

const TWO_BUCKETS = { kind: 'two-buckets', countsRequests: true, countsPoints: true, independentBuckets: true }
const WRITE_OPS = ['create', 'close', 'reopen', 'comment', 'update', 'setLabels', 'setAssignees', 'setParent', 'setBlockedBy']

/** 测试本地的裁决口：与 tests/verify-1442-tracker-tools.ts 里那一份同口径（硬顶先行、未知与离网放行）。 */
function makeAdmit(budgetMod: any) {
  return async (input: any) => {
    const op = String((input && input.op) || '')
    const model = (input && input.budget) || {}
    const reading = input && input.reading
    if (WRITE_OPS.indexOf(op) >= 0 && input && input.canWrite === false) {
      return { allowed: false, kind: 'rate-limit', message: '硬顶：本次调用没有写权限，写操作直接拒绝。' }
    }
    if (!reading || reading.known === false) return { allowed: true, reason: 'unknown-reading' }
    if (model.kind === 'off-network' || reading.kind === 'off-network') return { allowed: true, reason: 'off-network' }
    const buckets = (reading.buckets || {}) as Record<string, { remaining: number; limit: number }>
    for (const name of Object.keys(buckets)) {
      if (buckets[name].remaining <= budgetMod.writeReserve(buckets[name].limit)) {
        return { allowed: false, kind: 'rate-limit', message: '额度的 ' + name + ' 桶已经见底，这次先不执行。' }
      }
    }
    return { allowed: true, reason: 'sufficient' }
  }
}

/**
 * 探针：包住真实 Markdown 房间的 get / getDependencies 两条查询。
 * 每条进门先记「此刻同时开着几条」，等另一条也进门（期望 want 条）才放行；串行时另一条一辈子
 * 进不来，兜底 120 毫秒后放行——这样串行不会卡死，但峰值只到 1，门禁靠峰值断言判红。
 * 两条回执上都带 usage（生产口径：房间成功信封上的用量），让账本那条链一起被验证。
 */
function makeProbe(opt: any) {
  const o = opt || {}
  const want = (typeof o.want === 'number') ? o.want : 2
  const mode = String(o.mode || 'ok')
  const calls: { get: number; deps: number } = { get: 0, deps: 0 }
  const waiters: Array<() => void> = []
  let open = 0
  let peak = 0
  let fallback: any = null
  function release() { while (waiters.length) { const f = waiters.shift(); if (f) f() } }
  function enter(name: 'get' | 'deps'): void {
    calls[name] += 1
    open += 1
    if (open > peak) peak = open
    if (calls.get + calls.deps >= want) {
      if (typeof o.onFull === 'function') { try { o.onFull() } catch { } }
      release()
      return
    }
    if (!fallback) fallback = setTimeout(release, 120)
  }
  function leave(): void { open -= 1 }
  function gate(ctx: any): Promise<void> {
    return new Promise(function (resolve) {
      const sig = ctx && ctx.signal
      let done = false
      const finish = function () {
        if (done) return
        done = true
        try { if (sig && typeof sig.removeEventListener === 'function') sig.removeEventListener('abort', finish) } catch { }
        resolve()
      }
      if (sig && sig.aborted === true) return finish()
      if (sig && typeof sig.addEventListener === 'function') { try { sig.addEventListener('abort', finish, { once: true }) } catch { } }
      if (calls.get + calls.deps >= want) return finish()
      waiters.push(finish)
    })
  }
  async function getOp(inner: any, repo: any, key: any, opts: any, ctx: any): Promise<any> {
    enter('get')
    try {
      await gate(ctx)
      const sig = ctx && ctx.signal
      if (sig && sig.aborted === true) return { ok: false, error: { kind: 'aborted', message: '探针：读票被取消' } }
      if (mode === 'get-fail') return { ok: false, error: { kind: 'not-found', message: '探针：这张票不存在' } }
      if (mode === 'get-timeout') return { ok: false, error: { kind: 'timeout', message: '探针：读票超时' } }
      if (mode === 'get-throw') throw new Error('探针：读票抛错')
      const d = await inner.get(repo, key, opts, ctx)
      return Object.assign({}, d, { usage: { requests: 1, points: 3 } })
    } finally { leave() }
  }
  async function depsOp(inner: any, repo: any, key: any, opts: any, ctx: any): Promise<any> {
    enter('deps')
    try {
      await gate(ctx)
      const sig = ctx && ctx.signal
      if (sig && sig.aborted === true) return { ok: false, error: { kind: 'aborted', message: '探针：读阻塞边被取消' } }
      if (mode === 'deps-fail') return { ok: false, error: { kind: 'network', message: '探针：读阻塞边失败' } }
      if (mode === 'deps-timeout') return { ok: false, error: { kind: 'timeout', message: '探针：读阻塞边超时' } }
      const d = await inner.getDependencies(repo, key, opts, ctx)
      return Object.assign({}, d, { usage: { requests: 1, points: 3 } })
    } finally { leave() }
  }
  return {
    mode: mode, calls: calls,
    peak: function () { return peak },
    get: getOp, deps: depsOp,
    cleanup: function () { if (fallback) clearTimeout(fallback) },
  }
}

/** 把探针包成一个房间模块：除这两条查询外，其余入口全部委托真实 Markdown 房间。 */
function makeProbeModule(markdownModule: any, probe: any) {
  return {
    id: 'probe-1610', label: '并发探针桩',
    matches: () => false,
    budget: TWO_BUCKETS,
    create: (ctx: unknown) => {
      const inner = markdownModule.create(ctx) as Record<string, (...a: any[]) => unknown>
      const delegate = (name: string) => async (...args: any[]) => inner[name](...args)
      return {
        id: 'probe-1610', create: delegate('create'), list: delegate('list'),
        get: (repo: any, key: any, opts: any, opCtx: any) => probe.get(inner, repo, key, opts, opCtx),
        getDependencies: (repo: any, key: any, opts: any, opCtx: any) => probe.deps(inner, repo, key, opts, opCtx),
        close: delegate('close'), reopen: delegate('reopen'), comment: delegate('comment'),
        update: delegate('update'), setLabels: delegate('setLabels'), setAssignees: delegate('setAssignees'),
        setParent: delegate('setParent'), setBlockedBy: delegate('setBlockedBy'),
        preflight: delegate('preflight'), getRepoPermissions: delegate('getRepoPermissions'),
        getRepoKey: delegate('getRepoKey'),
      }
    },
  }
}

async function main() {
  console.log('#1610 deck_issue_get 读票与读阻塞边并发，报账按实际发出数')
  const gateMod = await imp('src/refresh/rooms/host/refresh-gate.js')
  const ledgerMod = await imp('src/refresh/rooms/host/quota-ledger.js')
  const registryMod = await imp('src/tracker/registry/core.js')
  const markdownModule = (await imp('src/tracker/rooms/markdown/index.js')).markdownModule
  const toolCost = await imp('src/refresh/kernel/tool-call-budget.js')
  const budgetMod = await imp('src/refresh/kernel/host-budget.js')
  const { chooseWorkspace, makeDecideStub } = await imp('tests/lib/deck-decide-stub.js')
  const workRouteMod = await imp('src/deck/shell/work-path-bindings.js')
  const issueGetFactory = (await imp('src/deck/tools/issue-get.js')).createDeckIssueGet
  const issueCreateFactory = (await imp('src/deck/tools/issue-create.js')).createDeckIssueCreate

  const ws = makeWorkspace()
  const clock = 1700000000000
  const DUAL_SYNCED = { known: true, kind: 'two-buckets', buckets: { rest: { remaining: 5000, limit: 5000 }, graphql: { remaining: 5000, limit: 5000 } } }

  const workPathHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-1610-workpath-'))
  const workRouteBindings = workRouteMod.createWorkRouteBindings({
    homeDir: workPathHome, now: () => clock,
    readFile: async (p: string) => { try { return fs.readFileSync(p, 'utf8') } catch { return null } },
    writeFile: async (p: string, c: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf8') },
    mkdir: async (dir: string) => { fs.mkdirSync(dir, { recursive: true }) },
  })
  const planStore = (() => { const t = new Map(); return { durable: true, load(id: string) { return t.get(String(id)) || null }, save(id: string, s: unknown) { t.set(String(id), s) } } })()

  /** 建一个世界：真闸 + 真账本 + 真注册表 + 测试本地裁决与记账；extraModules 里放这次要用的探针桩。 */
  async function buildWorld(reading: unknown, extraModules: any[], execIn?: any) {
    const backendId = 'probe-1610'
    const ledger = ledgerMod.createLedger({ now: () => clock })
    ledger.ensureBackend(backendId, { kind: 'two-buckets' })
    const b = (reading as any).buckets
    ledger.syncServer(backendId, {
      rest: { limit: b.rest.limit, remaining: b.rest.remaining, reset: clock + 3600000 },
      graphql: { limit: b.graphql.limit, remaining: b.graphql.remaining, reset: clock + 3600000 },
    }, clock)
    const gate = gateMod.createGate({ ledger, now: () => clock, budgetModelOf: () => ({ kind: 'two-buckets' }) })
    const registry = registryMod.createRegistry(Object.assign({ logEvent: () => { }, isEnabled: () => false }, ws.ctx), { matchesTimeout: 200 })
    for (const m of extraModules) registry.register(m)
    chooseWorkspace(ws.rootPosix, backendId)
    const ports = {
      admit: makeAdmit(budgetMod),
      account: async (input: any) => {
        // 记账口径与生产同源：只认成功信封上的 usage（src/refresh/kernel/backend-accounting.ts:52 的 usageOfResult）。
        // 失败信封没有用量就不记——所以「读票失败但依赖查询发出去了」那一支，回执报 2 条、账本只记依赖那 1 条。
        const model = (input && input.budget) || {}
        if (model.kind === 'off-network') return
        const result = input && input.result
        const usage = (result && result.ok === true && result.usage) ? result.usage : null
        if (!usage) return
        ledger.spend({ account: 'ai-tool', backendId: (input && input.backendId) || backendId, bucket: 'graphql', requests: usage.requests || 0, points: usage.points || 0 })
      },
      getCachedReading: () => reading,
    }
    const deps = {
      gate: gate, registry: registry, budget: budgetMod,
      estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
      backendCtx: ws.ctx, handleFor: () => ({ cwd: ws.rootPosix, refId: '.scratch/demo' }),
      decideBackend: makeDecideStub(registry),
      log: { fire: () => { } }, now: () => clock, invalidate: () => { },
      workRouteNote: (i: unknown) => workRouteBindings.note(i),
      workRouteRead: (i: unknown) => workRouteBindings.read(i),
      workRouteRelease: (i: unknown) => workRouteBindings.release(i),
      planStore: planStore, admit: ports.admit, account: ports.account, getCachedReading: ports.getCachedReading,
    }
    const tools: Record<string, any> = {
      deck_issue_get: issueGetFactory(deps),
      deck_issue_create: issueCreateFactory(deps),
    }
    const exec = execIn || { agent: { session: { id: 's-1610', cwd: ws.rootPosix } } }
    return {
      tools: tools, gate: gate, ledger: ledger, deps: deps,
      hour: () => ledger.hourOf('ai-tool', backendId),
      run: async (name: string, args: unknown) => {
        try { return { r: await tools[name].run(exec, args), threw: '' } }
        catch (e) { return { r: null, threw: String((e && (e as Error).message) || e) } }
      },
    }
  }

  const got = (r: any) => (r && r.cost && r.cost.actual) || {}
  const label = (r: any, threw: string) => threw || JSON.stringify({ status: r && r.status, reason: r && r.reason })

  // ── 一、成功路径：两条查询同时在途，回执照实报 2 条 6 点，账本同样记 2/6 ──
  const probe1 = makeProbe({})
  const w1 = await buildWorld(DUAL_SYNCED, [makeProbeModule(markdownModule, probe1)])
  const created = await w1.run('deck_issue_create', { title: '1610 甲票', kind: 'issue', body: '正文' })
  check(!created.threw && !!created.r && created.r.status === 'ok', '垫场：先建一张票（实得 ' + label(created.r, created.threw) + '）')
  const key = String((created.r && created.r.data && created.r.data.key) || '01')
  const g1 = await w1.run('deck_issue_get', { key: key })
  const r1: any = g1.r
  const a1 = got(r1)
  check(!g1.threw && !!r1 && r1.status === 'ok', '读票成功（实得 ' + label(r1, g1.threw) + '）')
  check(probe1.calls.get === 1 && probe1.calls.deps === 1, '读票与读阻塞边各发一条（实得 ' + JSON.stringify(probe1.calls) + '）')
  check(probe1.peak() === 2, '两条查询同时在途（峰值 ' + probe1.peak() + '；串行时只到 1）')
  check(a1.requests === 2 && a1.points === 6, '成功路径回执照实报 2 条 6 点（实得 ' + JSON.stringify({ requests: a1.requests, points: a1.points }) + '）')
  check(a1.requests === probe1.calls.get + probe1.calls.deps, '回执条数等于实际发出的调用数（' + a1.requests + ' vs ' + (probe1.calls.get + probe1.calls.deps) + '）')
  check(!!r1 && !!r1.data && r1.data.dependenciesRaw !== null && r1.data.dependenciesRaw !== undefined, '依赖查询的结果进了回执（dependenciesRaw 非空）')
  check(!!r1 && Array.isArray(r1.notes) && r1.notes.join('\n').indexOf('阻塞边这次没读到') < 0, '成功路径不说「阻塞边这次没读到」')
  const h1 = w1.hour() as { requests: number; points: number }
  check(h1.requests === 2 && h1.points === 6, '账本记 2 条 6 点（实得 ' + JSON.stringify(h1) + '）')

  // ── 二、blocking=false：只发读票一条，回执报 1 条 3 点，账本也记 1/3 ──
  {
    const probe = makeProbe({ want: 1 })
    const w = await buildWorld(DUAL_SYNCED, [makeProbeModule(markdownModule, probe)])
    const g = await w.run('deck_issue_get', { key: key, blocking: false })
    const r: any = g.r
    const a = got(r)
    check(!g.threw && !!r && r.status === 'ok', 'blocking=false 读票成功（实得 ' + label(r, g.threw) + '）')
    check(probe.calls.get === 1 && probe.calls.deps === 0, 'blocking=false 只发读票一条（实得 ' + JSON.stringify(probe.calls) + '）')
    check(a.requests === 1 && a.points === 3, 'blocking=false 回执报 1 条 3 点（实得 ' + JSON.stringify({ requests: a.requests, points: a.points }) + '）')
    check(!!r && Array.isArray(r.notes) && r.notes.join('\n').indexOf('反向阻塞边这次没取') >= 0, 'blocking=false 的注记说清没取反向边')
    const h = w.hour() as { requests: number; points: number }
    check(h.requests === 1 && h.points === 3, 'blocking=false 账本记 1 条 3 点（实得 ' + JSON.stringify(h) + '）')
  }

  // ── 三、读票诚实失败（后端说这张票没有）：依赖查询已经发出去了，回执照样报 2 条 ──
  {
    const probe = makeProbe({ mode: 'get-fail' })
    const w = await buildWorld(DUAL_SYNCED, [makeProbeModule(markdownModule, probe)])
    const g = await w.run('deck_issue_get', { key: key })
    const r: any = g.r
    const a = got(r)
    check(!g.threw && !!r && r.status === 'unsupported' && r.reason === 'backend-unsupported', '读票诚实失败仍走 backend-unsupported（实得 ' + label(r, g.threw) + '）')
    check(probe.peak() === 2, '读票失败时依赖查询也已经在途（峰值 ' + probe.peak() + '）')
    check(a.requests === 2 && a.points === 6, '读票失败的回执照实际发出数报 2 条 6 点（实得 ' + JSON.stringify({ requests: a.requests, points: a.points }) + '）')
  }

  // ── 四、读票超时：原因码走 backend-timeout，报账同样是 2 条 ──
  {
    const probe = makeProbe({ mode: 'get-timeout' })
    const w = await buildWorld(DUAL_SYNCED, [makeProbeModule(markdownModule, probe)])
    const g = await w.run('deck_issue_get', { key: key })
    const r: any = g.r
    const a = got(r)
    check(!g.threw && !!r && r.status === 'unsupported' && r.reason === 'backend-timeout', '读票超时走 backend-timeout（实得 ' + label(r, g.threw) + '）')
    check(a.requests === 2 && a.points === 6, '读票超时的回执照实际发出数报 2 条 6 点（实得 ' + JSON.stringify({ requests: a.requests, points: a.points }) + '）')
  }

  // ── 五、读票抛错：仍收成 backend-threw（老口径的形状保住），报账 2 条 ──
  {
    const probe = makeProbe({ mode: 'get-throw' })
    const w = await buildWorld(DUAL_SYNCED, [makeProbeModule(markdownModule, probe)])
    const g = await w.run('deck_issue_get', { key: key })
    const r: any = g.r
    const a = got(r)
    check(!g.threw && !!r && r.status === 'unsupported' && r.reason === 'backend-threw' && String(r.text || '').indexOf('后端实现抛错') >= 0,
      '读票抛错收成 backend-threw 且带原话（实得 ' + label(r, g.threw) + '）')
    check(a.requests === 2 && a.points === 6, '读票抛错的回执照实际发出数报 2 条 6 点（实得 ' + JSON.stringify({ requests: a.requests, points: a.points }) + '）')
  }

  // ── 六、依赖查询失败：票正文照回，注记说清关系没读到（不再整次失败） ──
  {
    const probe = makeProbe({ mode: 'deps-fail' })
    const w = await buildWorld(DUAL_SYNCED, [makeProbeModule(markdownModule, probe)])
    const g = await w.run('deck_issue_get', { key: key })
    const r: any = g.r
    const a = got(r)
    check(!g.threw && !!r && r.status === 'ok', '阻塞边没读到时票正文照回（实得 ' + label(r, g.threw) + '）')
    check(!!r && !!r.data && r.data.ticket && r.data.ticket.key === key, '票正文那份还在（key ' + key + '）')
    check(!!r && !!r.data && r.data.dependenciesRaw === null, '依赖那一格如实回 null（没读到就是没读到）')
    check(!!r && Array.isArray(r.notes) && r.notes.join('\n').indexOf('阻塞边这次没读到') >= 0, '注记说清阻塞边这次没读到（实得 ' + JSON.stringify(r && r.notes) + '）')
    check(a.requests === 2 && a.points === 6, '阻塞边失败时报账仍是 2 条 6 点（实得 ' + JSON.stringify({ requests: a.requests, points: a.points }) + '）')
  }

  // ── 七、依赖查询超时：同样降级成「正文照回 + 注记说明」，报账 2 条 ──
  {
    const probe = makeProbe({ mode: 'deps-timeout' })
    const w = await buildWorld(DUAL_SYNCED, [makeProbeModule(markdownModule, probe)])
    const g = await w.run('deck_issue_get', { key: key })
    const r: any = g.r
    const a = got(r)
    check(!g.threw && !!r && r.status === 'ok', '阻塞边超时时票正文照回（实得 ' + label(r, g.threw) + '）')
    check(!!r && Array.isArray(r.notes) && r.notes.join('\n').indexOf('阻塞边查询超时了') >= 0, '注记说清阻塞边查询超时（实得 ' + JSON.stringify(r && r.notes) + '）')
    check(a.requests === 2 && a.points === 6, '阻塞边超时报账仍是 2 条 6 点（实得 ' + JSON.stringify({ requests: a.requests, points: a.points }) + '）')
  }

  // ── 八、调用方中途取消：两条都已经发出去，回执照实报 2 条，整次读停下 ──
  {
    const ctrl = new AbortController()
    const probe = makeProbe({ onFull: function () { ctrl.abort() } })
    const execIn = { agent: { session: { id: 's-1610-cancel', cwd: ws.rootPosix } }, signal: ctrl.signal }
    const w = await buildWorld(DUAL_SYNCED, [makeProbeModule(markdownModule, probe)], execIn)
    const g = await w.run('deck_issue_get', { key: key })
    const r: any = g.r
    const a = got(r)
    check(probe.peak() === 2, '取消发生时两条查询都在途（峰值 ' + probe.peak() + '）')
    check(probe.calls.get === 1 && probe.calls.deps === 1, '取消时两条都已发出（实得 ' + JSON.stringify(probe.calls) + '）')
    check(!g.threw && !!r && r.status === 'unsupported' && r.reason === 'backend-threw', '取消后整次读停下，原因码走 backend-threw（实得 ' + label(r, g.threw) + '）')
    check(!!r && String(r.text || '').indexOf('后端实现抛错') >= 0, '取消走执行层失败那一支，句子与老口径一字不差')
    check(a.requests === 2 && a.points === 6, '中途取消的回执照实际发出数报 2 条 6 点（实得 ' + JSON.stringify({ requests: a.requests, points: a.points }) + '）')
  }

  // ── 九、发出去之前就被取消：两条都没派发，回执坚持报 0 条 0 点（不能把自己说成花过钱） ──
  {
    const ctrl = new AbortController()
    ctrl.abort()
    const probe = makeProbe({})
    const execIn = { agent: { session: { id: 's-1610-precancel', cwd: ws.rootPosix } }, signal: ctrl.signal }
    const w = await buildWorld(DUAL_SYNCED, [makeProbeModule(markdownModule, probe)], execIn)
    const g = await w.run('deck_issue_get', { key: key })
    const r: any = g.r
    const a = got(r)
    check(probe.calls.get === 0 && probe.calls.deps === 0, '预算壳在派发之前就拦下了两条查询（实得 ' + JSON.stringify(probe.calls) + '）')
    check(!g.threw && !!r && r.status === 'unsupported', '预发前取消的回执仍是三态里的 unsupported（实得 ' + label(r, g.threw) + '）')
    check(a.requests === 0 && a.points === 0, '没发出去的调用不报账（实得 ' + JSON.stringify({ requests: a.requests, points: a.points }) + '）')
  }

  ws.cleanup()
  try { fs.rmSync(workPathHome, { recursive: true, force: true }) } catch { }
  console.log('GATE-RESULT total=' + total + ' failed=' + failed)
  if (failed > 0) { console.error('FAIL #1610 红测：' + failed + ' 条没过'); process.exit(1) }
}
main().catch(function (e) { console.error('FAIL #1610 抛错：' + ((e && e.stack) || String(e))); process.exit(1) })





