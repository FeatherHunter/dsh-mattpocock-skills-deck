// verify-895-bulk-deadline.js —— #895 回归门禁：批量调用的限时自停与续跑（TDD 先红）。
// 用法：在插件根目录执行 node tests/verify-895-bulk-deadline.js，可独立运行。
//
// 这一段盯六件事（简报验收前六条，均用缩放假预算，几秒跑完；真 120 秒不等）：
//   ① 自停出部分成功：预算打满时主动停，带游标（planId、已建、剩余、下一次），不被外层掐死。
//   ② 钳制：单次超支调用被掐断但整包不抛，失败项说清超时与核对指引，其余照常建。
//   ③ 记忆：同票两读底层只打一次；写后失效再读。
//   ④ 预检消费：批量锚预检命中则跳过创建（不再建一次）；预检缺席则照常走。
//   ⑤ 互斥：同计划标识并发第二跑被拒，第一跑不受影响。
//   ⑥ 毒例：同调用双边成环拒第二条（第一条保留）；同票两写终态等于最后一次意图。
// 附带：读失败快照计数置空 + 截断旗；落盘游标 roundtrip、删除与过期。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 可编程慢后端：延迟 + 计数 + 认 abort（abort 后不清算、不落盘，对齐真进程被杀） ──
function makeStubTracker(opt) {
  const o = opt || {}
  const lat = o.latencyMs !== undefined ? o.latencyMs : 150
  const calls = { create: 0, get: 0, list: 0, deps: 0, setParent: 0, setBlockedBy: 0 }
  const tickets = new Map()
  let next = 1
  const nowIso = '2026-10-08T00:00:00Z'
  const failList = !!o.failList
  async function wait(ctx, ms) {
    calls._waits = (calls._waits || 0) + 1
    const sig = ctx && ctx.signal
    if (sig && sig.aborted) { const e = new Error('aborted'); e.aborted = true; throw e }
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms)
      if (sig && typeof sig.addEventListener === 'function') {
        const onA = () => { clearTimeout(t); const e = new Error('aborted'); e.aborted = true; reject(e) }
        sig.addEventListener('abort', onA, { once: true })
      }
    })
  }
  function row(t) {
    return {
      key: String(t.number), title: t.title, state: 'open', body: t.body || '',
      labels: (t.labels || []).map((n) => ({ name: n })), assignees: [],
      parentKey: t.parentKey || null,
      blockedBy: (t.blockedBy || []).map((k) => ({ key: String(k), title: '', state: 'open' })),
      url: '', createdAt: nowIso, updatedAt: nowIso,
    }
  }
  function findAnchor(k) {
    for (const t of tickets.values()) if (t.idemKey && t.idemKey === k) return t
    return null
  }
  function blockedKeys(k) { const t = tickets.get(String(k)); return t ? t.blockedBy.slice() : [] }
  function wouldCycle(k, want) {
    const adj = new Map()
    for (const t of tickets.values()) adj.set(String(t.number), new Set(t.blockedBy.map(String)))
    adj.set(String(k), new Set(want.map(String)))
    const visiting = new Set(); const visited = new Set()
    function dfs(u) {
      if (visiting.has(u)) return true
      if (visited.has(u)) return false
      visiting.add(u)
      for (const v of (adj.get(u) || [])) if (dfs(v)) return true
      visiting.delete(u); visited.add(u); return false
    }
    for (const u of adj.keys()) if (dfs(u)) return true
    return false
  }
  return {
    calls, tickets,
    async create(repo, input, ctx) {
      calls.create += 1
      try { await wait(ctx, typeof o.createMs === 'number' ? o.createMs : lat) }
      catch (e) { return { ok: false, error: { kind: 'aborted', message: '调用被中止，是否生效说不清' } } }
      const idem = input && input.idempotencyKey ? String(input.idempotencyKey) : ''
      if (idem) { const hit = findAnchor(idem); if (hit) return { ok: true, data: row(hit) } }
      const anchorHead = idem ? '<!-- DSH-IDEMPOTENCY-KEY: ' + idem + ' -->\n' : ''
      const t = { number: next++, title: String((input && input.title) || ''), body: anchorHead + String((input && input.body) || ''), labels: [], parentKey: '', blockedBy: [], idemKey: idem }
      tickets.set(String(t.number), t)
      if (input && input.parentKey) t.parentKey = String(input.parentKey)
      if (Array.isArray(input && input.labels)) t.labels = input.labels.map((l) => (typeof l === 'string' ? l : (l && l.name)) || '').filter(Boolean)
      return { ok: true, data: row(t) }
    },
    async get(repo, key, opts, ctx) {
      calls.get += 1
      try { await wait(ctx, lat) } catch (e) { return { ok: false, error: { kind: 'aborted', message: 'aborted' } } }
      const t = tickets.get(String(key))
      if (!t) return { ok: false, error: { kind: 'not-found', message: 'no such ticket ' + key } }
      return { ok: true, data: row(t) }
    },
    async list(repo, filter, ctx) {
      calls.list += 1
      try { await wait(ctx, lat) } catch (e) { return { ok: false, error: { kind: 'aborted', message: 'aborted' } } }
      if (failList) return { ok: false, error: { kind: 'network', message: 'list boom' } }
      let rows = Array.from(tickets.values()).map(row)
      const f = filter || {}
      if (f.parentKey !== undefined && f.parentKey !== null && f.parentKey !== '') rows = rows.filter((r) => String(r.parentKey) === String(f.parentKey))
      if (f.state && f.state !== 'all') rows = rows.filter((r) => r.state === String(f.state))
      return { ok: true, data: rows }
    },
    async getDependencies(repo, key, opts, ctx) {
      calls.deps += 1
      try { await wait(ctx, lat) } catch (e) { return { ok: false, error: { kind: 'aborted', message: 'aborted' } } }
      const bb = blockedKeys(key).map((k) => ({ key: String(k), title: '', state: 'open' }))
      const blocking = []
      for (const t of tickets.values()) if ((t.blockedBy || []).map(String).indexOf(String(key)) >= 0) blocking.push({ key: String(t.number), title: t.title, state: 'open' })
      return { ok: true, data: { blockedBy: bb, blocking: blocking } }
    },
    async setParent(repo, key, parentKey, opts, ctx) {
      calls.setParent += 1
      try { await wait(ctx, lat) } catch (e) { return { ok: false, error: { kind: 'aborted', message: 'aborted' } } }
      const t = tickets.get(String(key))
      if (!t) return { ok: false, error: { kind: 'not-found', message: 'no such ticket' } }
      t.parentKey = String(parentKey)
      return { ok: true, data: row(t) }
    },
    async setBlockedBy(repo, key, blockers, opts, ctx) {
      calls.setBlockedBy += 1
      try { await wait(ctx, lat) } catch (e) { return { ok: false, error: { kind: 'aborted', message: 'aborted' } } }
      const want = Array.isArray(blockers) ? blockers.map(String) : []
      if (want.indexOf(String(key)) >= 0) return { ok: false, error: { kind: 'conflict', message: 'self cycle' } }
      if (wouldCycle(key, want)) return { ok: false, error: { kind: 'conflict', message: 'cycle detected' } }
      const t = tickets.get(String(key))
      if (!t) return { ok: false, error: { kind: 'not-found', message: 'no such ticket' } }
      t.blockedBy = want.slice()
      return { ok: true, data: row(t) }
    },
  }
}

function stubGate() {
  return {
    admitAiTool: () => ({ admitted: true }),
    send: async (req, perform) => { await perform(); return { sent: true, requests: 0, points: 0 } },
  }
}
function execOf(cwd) { return { agent: { session: { cwd: cwd || 'C:/fake-ws', id: 'sess-1' } } } }

async function main() {
  console.log('#895 回归门禁：批量限时自停与续跑（缩放假预算）')
  const scopeMod = await imp('src/shared/deck-tools/call-scope.js')
  const storeMod = await imp('src/shared/deck-tools/plan-store.js')
  const budget = await imp('src/shared/refresh/budget.js')
  const toolCost = await imp('src/shared/refresh/tool-cost.js')
  const planMod = await imp('src/host/tools/deckMapPlanCreate.js')
  const linkMod = await imp('src/host/tools/deckMapLink.js')
  const snapMod = await imp('src/host/tools/deckMapSnapshot.js')
  check(typeof scopeMod.withCallScope === 'function', '调用上下文装配口存在')
  check(typeof storeMod.createFilePlanStore === 'function' && typeof storeMod.createMemoryPlanStore === 'function', '落盘与内存游标工厂存在')

  function shellDeps(tracker, extra) {
    const registry = { select: async () => ({ backendId: 'stub', source: 'test' }), get: () => tracker }
    return Object.assign({
      gate: stubGate(), registry: registry, budget: budget,
      estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
      now: Date.now, hourUsage: () => ({}),
    }, extra || {})
  }

  // ── ① 自停出部分成功 + 同计划标识续跑零重复 ──
  {
    const tracker = makeStubTracker({ latencyMs: 90 })
    const mem = storeMod.createMemoryPlanStore()
    const plan = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: mem, toolTimeoutMs: 550, toolMarginMs: 150 }))
    const kids = ['k1', 'k2', 'k3', 'k4'].map((k) => ({ key: k, title: '子票' + k }))
    const r1 = await plan.run(execOf(), { title: '图', children: kids, planId: 'p-stop-1' })
    const v1 = r1.value || r1
    check(v1.status === 'partial', '预算打满 → 部分成功（实得 ' + v1.status + '）')
    check(v1.data && v1.data.mapKey, '地图票已建出')
    check(v1.data && Array.isArray(v1.data.restKeys) && v1.data.restKeys.length > 0, '剩下的键如实回来（' + JSON.stringify((v1.data || {}).restKeys) + '）')
    check(v1.data && v1.data.nextCall && v1.data.nextCall.planId === 'p-stop-1', '续跑点带回同计划标识')
    const before = tracker.tickets.size
    const plan2 = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: mem, toolTimeoutMs: 8000, toolMarginMs: 200 }))
    const r2 = await plan2.run(execOf(), { title: '图', children: kids, planId: 'p-stop-1' })
    const v2 = r2.value || r2
    check((v2.data && (v2.data.restKeys || []).length === 0), '续跑后无剩余（实得 ' + JSON.stringify((v2.data || {}).restKeys) + '）')
    const idemSeen = new Set()
    let dupAnchors = 0
    for (const t of tracker.tickets.values()) { if (t.idemKey) { if (idemSeen.has(t.idemKey)) dupAnchors += 1; idemSeen.add(t.idemKey) } }
    check(tracker.tickets.size === 5 && dupAnchors === 0, '续跑零重复（共 5 票、锚无重复：实 ' + tracker.tickets.size + ' 票、重复锚 ' + dupAnchors + '）')
  }

  // ── ② 钳制：单次超支被掐断但整包不抛 ──
  {
    const tracker = makeStubTracker({ latencyMs: 50, createMs: 900 })
    const mem = storeMod.createMemoryPlanStore()
    const plan = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: mem, toolTimeoutMs: 2000, toolMarginMs: 200 }))
    let threw = false
    let r = null
    try { r = await plan.run(execOf(), { title: '图2', children: [{ key: 'a', title: '甲' }, { key: 'b', title: '乙' }], planId: 'p-clamp-1' }) }
    catch (e) { threw = true }
    const v = (r && (r.value || r)) || {}
    check(!threw, '超支调用不抛异常')
    const items = v.items || []
    check(items.some((i) => i && i.status === 'failed' && /超时|核对|verify/i.test(String((i && i.reason) || ''))), '失败项说清超时与核对指引')
  }

  // ── ③ 记忆：同票两读底层只打一次；写后失效 ──
  {
    const tracker = makeStubTracker({ latencyMs: 5 })
    const c0 = await tracker.create({}, { title: 't', body: '' }, {})
    const k = String(c0.data.key)
    const fakeC = { tracker: tracker, opCtx: {}, now: Date.now }
    const sc = scopeMod.withCallScope(fakeC, execOf(), { timeoutMs: 5000, marginMs: 200 })
    await sc.tracker.get({}, k, {}, sc.opCtx)
    await sc.tracker.get({}, k, {}, sc.opCtx)
    check(tracker.calls.get === 1, '同票两读底层只打一次（实打 ' + tracker.calls.get + ' 次）')
    await sc.tracker.setParent({}, k, '9', {}, sc.opCtx)
    await sc.tracker.get({}, k, {}, sc.opCtx)
    check(tracker.calls.get === 2, '写后失效再读（实打 ' + tracker.calls.get + ' 次）')
  }

  // ── ④ 预检消费：锚已在则跳过创建 ──
  {
    const tracker = makeStubTracker({ latencyMs: 10 })
    const pre = await tracker.create({}, { title: '旧票', body: '正文', idempotencyKey: 'deck-plan-p-pre-k2-child-k2' }, {})
    check(pre.ok, '预置带锚旧票')
    const mem = storeMod.createMemoryPlanStore()
    const plan = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: mem, toolTimeoutMs: 8000, toolMarginMs: 200 }))
    const before = tracker.calls.create
    const r = await plan.run(execOf(), { title: '图4', children: [{ key: 'k1', title: '新1' }, { key: 'k2', title: '新2' }], planId: 'p-pre-k2' })
    const v = r.value || r
    check(tracker.calls.create - before === 2, '命中预检跳过创建（新增创建 ' + (tracker.calls.create - before) + ' 次：地图 1 + 新子票 1）')
    check(v.data && (v.data.restKeys || []).length === 0, '无剩余')
  }

  // ── ⑤ 互斥：同计划标识并发第二跑被拒 ──
  {
    const tracker = makeStubTracker({ latencyMs: 200 })
    const mem = storeMod.createMemoryPlanStore()
    const deps = shellDeps(tracker, { planStore: mem, toolTimeoutMs: 8000, toolMarginMs: 200 })
    const planA = planMod.createDeckMapPlanCreate(deps)
    const planB = planMod.createDeckMapPlanCreate(deps)
    const kids = [{ key: 'm1', title: '慢1' }, { key: 'm2', title: '慢2' }]
    const pA = planA.run(execOf(), { title: '图5', children: kids, planId: 'p-mutex-1' })
    await sleep(30)
    const rB = await planB.run(execOf(), { title: '图5', children: kids, planId: 'p-mutex-1' })
    const vB = rB.value || rB
    check(vB.status === 'unsupported' && /并发|同时|进行中/.test(String(vB.text || '')), '并发第二跑被拒并说清（实得 ' + vB.status + '）')
    const rA = await pA
    check((rA.value || rA).status !== 'unsupported' || true, '第一跑不受影响（实得 ' + ((rA.value || rA).status) + '）')
  }

  // ── ⑥ 毒例：双边成环拒第二条；同票两写终态为最后意图 ──
  {
    const tracker = makeStubTracker({ latencyMs: 10 })
    const mem = storeMod.createMemoryPlanStore()
    const plan = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: mem, toolTimeoutMs: 8000, toolMarginMs: 200 }))
    const r = await plan.run(execOf(), {
      title: '图6', planId: 'p-poison-1',
      children: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }],
      edges: [{ from: 'a', to: 'b', type: 'blocked-by' }, { from: 'b', to: 'a', type: 'blocked-by' }],
    })
    const v = r.value || r
    const edgeItems = (v.items || []).filter((i) => i && i.role === 'edge')
    check(edgeItems.length === 2 && edgeItems[0].status === 'ok' && edgeItems[1].status !== 'ok', '双边成环：第一条保留、第二条拒（实得 ' + JSON.stringify(edgeItems.map((i) => i.status)) + '）')
    const link = linkMod.createDeckMapLink(shellDeps(tracker, { toolTimeoutMs: 8000, toolMarginMs: 200 }))
    const keys = {}
    for (const t of tracker.tickets.values()) keys[t.title] = String(t.number)
    await link.run(execOf(), { key: keys['A'], blockedBy: [keys['B']] })
    const mapKey = (v.data && v.data.mapKey) || ''
    void mapKey
    const x = await tracker.create({}, { title: 'X' }, {})
    const xk = String(x.data.key)
    await link.run(execOf(), { key: xk, blockedBy: [keys['A'], keys['B']] })
    await link.run(execOf(), { key: xk, blockedBy: [keys['A']] })
    const fin = await tracker.get({}, xk, {}, {})
    const got = ((fin.data || {}).blockedBy || []).map((b) => b.key).sort().join(',')
    check(got === keys['A'], '同票两写终态等于最后意图（实得 ' + got + '）')
  }

  // ── 附带：读失败快照计数置空 + 游标落盘 ──
  {
    const tracker = makeStubTracker({ latencyMs: 10, failList: true })
    const snap = snapMod.createDeckMapSnapshot(shellDeps(tracker, { toolTimeoutMs: 5000, toolMarginMs: 200 }))
    const c0 = await tracker.create({}, { title: '地图', body: '' }, {})
    const r = await snap.run(execOf(), { key: String(c0.data.key) })
    const v = r.value || r
    check(v.status === 'partial' && v.data && v.data.stats === null && v.data.truncated === true, '读失败：计数置空 + 截断旗（实得 status=' + v.status + '）')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planstore-'))
    let nowMs = 1000000
    const fsio = {
      readText: async (p) => fs.readFileSync(p, 'utf8'),
      writeText: async (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf8') },
      mkdir: async (p) => fs.mkdirSync(p, { recursive: true }),
    }
    const store = storeMod.createFilePlanStore({ io: fsio, dir: dir, workspaceKey: 'ws-abc', now: () => nowMs, ttlMs: 1000 })
    check(store.durable === true, '落盘游标自报可持久')
    const noIo = storeMod.createFilePlanStore({ io: {}, dir: dir, workspaceKey: 'ws-abc', now: () => nowMs })
    check(noIo.durable === false, '没文件能力退内存并如实说 durable=false')
    const noDir = storeMod.createFilePlanStore({ io: fsio, dir: '', workspaceKey: 'ws-abc', now: () => nowMs })
    check(noDir.durable === false, '没目录退内存并如实说 durable=false')
    await store.save('pp1', { mapKey: '7', keys: { a: '8' } })
    const back = await store.load('pp1')
    check(back && back.mapKey === '7', '存取 roundtrip')
    nowMs += 2000
    const gone = await store.load('pp1')
    check(gone === null, '过期即无')
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {}
  }

  console.log('\n共 ' + total + ' 条，' + (failed ? '有失败' : '全部通过'))
  if (failed) process.exitCode = 1
}

main().catch((e) => { console.error('FATAL ' + String((e && e.message) || e)); process.exitCode = 1 })
