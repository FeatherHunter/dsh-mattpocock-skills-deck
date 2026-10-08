// tests/verify-898-block-merge.js —— #898 回归门禁：一票多阻塞边不再互相覆盖（不联网）
// 测什么：设置阻塞边是整批替换语义，调用层必须把同一次调用里同一张票的
// 多条阻塞边先合并成完整集合再写一次，并按本次全部目标逐个校验。
//   A) 整图建骨架：C 被 A、B 阻塞 → 两条边明细都成功，读回两条全在，且对 C 只写一次。
//   B) 批量补边：同一票号拆两项传入 → 两目标都成功，读回全在，且只写一次。
//   C) 批量补边单项全数组写法不变：一次写，两条全在（回归旧行为）。
//   D) 跨次调用仍是整批替换：先写 [A,B] 再写 [A] → 终态只剩 A（守住 #895-⑥）。
//   E) 整图建骨架双边成环仍拒第二条（守住 #895-⑥）。
// 用法：在插件根目录执行 node tests/verify-898-block-merge.js，可独立运行。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

// —— 桩跟踪器：setBlockedBy 整批替换（与 GitHub 后端同语义），其余最小够用 ——
function makeStubTracker() {
  const calls = { create: 0, get: 0, list: 0, deps: 0, setParent: 0, setBlockedBy: 0 }
  const tickets = new Map()
  let next = 1
  const nowIso = '2026-10-08T00:00:00Z'
  function row(t) {
    return {
      key: String(t.number), title: t.title, state: 'open', body: t.body || '',
      labels: [], assignees: [],
      parentKey: t.parentKey || null,
      blockedBy: (t.blockedBy || []).map((k) => ({ key: String(k), title: '', state: 'open' })),
      url: '', createdAt: nowIso, updatedAt: nowIso,
    }
  }
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
      const idem = input && input.idempotencyKey ? String(input.idempotencyKey) : ''
      if (idem) for (const t of tickets.values()) if (t.idemKey === idem) return { ok: true, data: row(t) }
      const anchorHead = idem ? '<!-- DSH-IDEMPOTENCY-KEY: ' + idem + ' -->\n' : ''
      const t = { number: next++, title: String((input && input.title) || ''), body: anchorHead + String((input && input.body) || ''), labels: [], parentKey: '', blockedBy: [], idemKey: idem }
      tickets.set(String(t.number), t)
      if (input && input.parentKey) t.parentKey = String(input.parentKey)
      return { ok: true, data: row(t) }
    },
    async get(repo, key, opts, ctx) {
      calls.get += 1
      const t = tickets.get(String(key))
      if (!t) return { ok: false, error: { kind: 'not-found', message: 'no such ticket ' + key } }
      return { ok: true, data: row(t) }
    },
    async list(repo, filter, ctx) {
      calls.list += 1
      let rows = Array.from(tickets.values()).map(row)
      const f = filter || {}
      if (f.parentKey !== undefined && f.parentKey !== null && f.parentKey !== '') rows = rows.filter((r) => String(r.parentKey) === String(f.parentKey))
      if (f.state && f.state !== 'all') rows = rows.filter((r) => r.state === String(f.state))
      return { ok: true, data: rows }
    },
    async getDependencies(repo, key, opts, ctx) {
      calls.deps += 1
      const t = tickets.get(String(key))
      const bb = t ? t.blockedBy.map((k) => ({ key: String(k), title: '', state: 'open' })) : []
      const blocking = []
      for (const x of tickets.values()) if ((x.blockedBy || []).map(String).indexOf(String(key)) >= 0) blocking.push({ key: String(x.number), title: x.title, state: 'open' })
      return { ok: true, data: { blockedBy: bb, blocking: blocking } }
    },
    async setParent(repo, key, parentKey, opts, ctx) {
      calls.setParent += 1
      const t = tickets.get(String(key))
      if (!t) return { ok: false, error: { kind: 'not-found', message: 'no such ticket' } }
      t.parentKey = String(parentKey)
      return { ok: true, data: row(t) }
    },
    async setBlockedBy(repo, key, blockers, opts, ctx) {
      calls.setBlockedBy += 1
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
function blockedOf(rowData) { return ((rowData && rowData.blockedBy) || []).map((b) => String((b && b.key) || b)).sort().join(',') }

async function main() {
  console.log('#898 回归门禁：一票多阻塞边合并写（不联网）')
  const budget = await imp('src/shared/refresh/budget.js')
  const toolCost = await imp('src/shared/refresh/tool-cost.js')
  const storeMod = await imp('src/shared/deck-tools/plan-store.js')
  const planMod = await imp('src/host/tools/deckMapPlanCreate.js')
  const linkMod = await imp('src/host/tools/deckMapLink.js')
  function shellDeps(tracker, extra) {
    const registry = { select: async () => ({ backendId: 'stub', source: 'test' }), get: () => tracker }
    return Object.assign({
      gate: stubGate(), registry: registry, budget: budget,
      estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom,
      now: Date.now, hourUsage: () => ({}),
    }, extra || {})
  }

  // ── A) 整图建骨架：C 被 A、B 阻塞 → 明细全成功，读回两条全在，只写一次 ──
  {
    const tracker = makeStubTracker()
    const plan = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: storeMod.createMemoryPlanStore(), toolTimeoutMs: 8000, toolMarginMs: 200 }))
    const r = await plan.run(execOf(), {
      title: '图A', planId: 'p-898-a',
      children: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }, { key: 'c', title: 'C' }],
      edges: [{ from: 'c', to: 'a', type: 'blocked-by' }, { from: 'c', to: 'b', type: 'blocked-by' }],
    })
    const v = r.value || r
    const edgeItems = (v.items || []).filter((i) => i && i.role === 'edge')
    check(edgeItems.length === 2 && edgeItems.every((i) => i.status === 'ok'), 'A1 两条阻塞边明细都成功（实得 ' + JSON.stringify(edgeItems.map((i) => i.status)) + '）')
    let cKey = ''
    for (const t of tracker.tickets.values()) if (t.title === 'C') cKey = String(t.number)
    const back = await tracker.get({}, cKey, {}, {})
    const got = blockedOf(back.data)
    let aKey = '', bKey = ''
    for (const t of tracker.tickets.values()) { if (t.title === 'A') aKey = String(t.number); if (t.title === 'B') bKey = String(t.number) }
    check(got === [aKey, bKey].sort().join(','), 'A2 读回 C 的阻塞边两条全在（实得 ' + got + '）')
    check(tracker.calls.setBlockedBy === 1, 'A3 对 C 只写一次（实写 ' + tracker.calls.setBlockedBy + ' 次）')
  }

  // ── B) 批量补边：同一票号拆两项传入 → 两目标都成功，读回全在，只写一次 ──
  {
    const tracker = makeStubTracker()
    const link = linkMod.createDeckMapLink(shellDeps(tracker, { toolTimeoutMs: 8000, toolMarginMs: 200 }))
    const mk = async (title) => String((await tracker.create({}, { title: title, body: '' }, {})).data.key)
    const a = await mk('A'); const b = await mk('B'); const c = await mk('C')
    const before = tracker.calls.setBlockedBy
    const r = await link.run(execOf(), { edges: [{ key: c, blockedBy: [a] }, { key: c, blockedBy: [b] }] })
    const v = r.value || r
    const items = (v.items || []).filter((i) => String(i.key) === String(c))
    check(items.length === 2 && items.every((i) => i.status === 'ok'), 'B1 两目标明细都成功（实得 ' + JSON.stringify(items.map((i) => i.status)) + '）')
    const back = await tracker.get({}, c, {}, {})
    check(blockedOf(back.data) === [a, b].sort().join(','), 'B2 读回两条全在（实得 ' + blockedOf(back.data) + '）')
    check(tracker.calls.setBlockedBy - before === 1, 'B3 只写一次（实写 ' + (tracker.calls.setBlockedBy - before) + ' 次）')
  }

  // ── C) 单项全数组写法不变 ──
  {
    const tracker = makeStubTracker()
    const link = linkMod.createDeckMapLink(shellDeps(tracker, { toolTimeoutMs: 8000, toolMarginMs: 200 }))
    const mk = async (title) => String((await tracker.create({}, { title: title, body: '' }, {})).data.key)
    const a = await mk('A'); const b = await mk('B'); const c = await mk('C')
    const r = await link.run(execOf(), { key: c, blockedBy: [a, b] })
    const v = r.value || r
    check((v.items || []).every((i) => i.status === 'ok'), 'C1 单项全数组两目标都成功')
    const back = await tracker.get({}, c, {}, {})
    check(blockedOf(back.data) === [a, b].sort().join(','), 'C2 读回两条全在')
    check(tracker.calls.setBlockedBy === 1, 'C3 只写一次')
  }

  // ── D) 跨次调用仍是整批替换 ──
  {
    const tracker = makeStubTracker()
    const link = linkMod.createDeckMapLink(shellDeps(tracker, { toolTimeoutMs: 8000, toolMarginMs: 200 }))
    const mk = async (title) => String((await tracker.create({}, { title: title, body: '' }, {})).data.key)
    const a = await mk('A'); const b = await mk('B'); const c = await mk('C')
    await link.run(execOf(), { key: c, blockedBy: [a, b] })
    await link.run(execOf(), { key: c, blockedBy: [a] })
    const back = await tracker.get({}, c, {}, {})
    check(blockedOf(back.data) === String(a), 'D1 第二次调用的完整集合为准（实得 ' + blockedOf(back.data) + '）')
  }

  // ── E) 整图建骨架双边成环仍拒第二条 ──
  {
    const tracker = makeStubTracker()
    const plan = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: storeMod.createMemoryPlanStore(), toolTimeoutMs: 8000, toolMarginMs: 200 }))
    const r = await plan.run(execOf(), {
      title: '图E', planId: 'p-898-e',
      children: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }],
      edges: [{ from: 'a', to: 'b', type: 'blocked-by' }, { from: 'b', to: 'a', type: 'blocked-by' }],
    })
    const v = r.value || r
    const edgeItems = (v.items || []).filter((i) => i && i.role === 'edge')
    check(edgeItems.length === 2 && edgeItems[0].status === 'ok' && edgeItems[1].status !== 'ok', 'E1 第一条保留、第二条拒（实得 ' + JSON.stringify(edgeItems.map((i) => i.status)) + '）')
  }

  console.log('\n共 ' + total + ' 条，' + (failed ? '有失败' : '全部通过'))
  if (failed) process.exitCode = 1
}

main().catch((e) => { console.error('FATAL ' + String((e && e.message) || e)); process.exitCode = 1 })
