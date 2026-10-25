// verify-1245-plan-resume.ts —— #1245 回归门禁：建整图的外层掐断续跑（自动标识稳定加孤儿修复）。
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1245-plan-resume.ts，可独立运行。
//
// 这一段盯六件事（#1245 验收，均用内存游标加 stub 后端，几秒跑完；真 300 秒不等）：
//   ① 自动计划标识稳定：不传 planId 时同一份输入两次得到同一个标识，第二次零新建。
//   ② 同计划标识续跑零重复：预算打满部分成功后，带同 planId 重跑无剩余、锚无重复。
//   ③ 孤儿修复：已建跳过的子票父边缺失时续跑补挂，不再建新票。
//   ④ 时间同源（对抗审查后）：单次钳制与房兜底同 30 秒，游标 10 秒；放宽未经测量，不做。
//   ⑤ 故意建第二张：显式不同计划标识建新票，不复用旧票。
//   ⑥ 外层掐断的后果（#1245 原始现象）：首调用只落一部分子票、父边缺失、游标与回执都随进程消失，
//      十分钟后用同样输入重跑：自动标识不变、一张票不重造、孤儿父边补挂、按父票数得齐。
const path = require('path')
const { pathToFileURL } = require('url')
const { makeDecideStub, chooseWorkspace } = require('./lib/deck-decide-stub.js')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)

// —— 可编程 stub 后端：建票记锚、父边可缺 ——
function makeStubTracker(opt: any = {}) {
  const lat = opt.latencyMs ?? 5
  const calls: any = { create: 0, get: 0, list: 0 }
  const tickets = new Map<string, any>()
  let next = 1
  const nowIso = '2026-10-17T00:00:00Z'
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  function row(t: any) {
    return { key: String(t.number), title: t.title, state: 'open', body: t.body || '', labels: [], assignees: [], parentKey: t.parentKey || null, blockedBy: [], url: '', createdAt: nowIso, updatedAt: nowIso }
  }
  function findAnchor(k: string) { for (const t of tickets.values()) if (t.idemKey === k) return t; return null }
  return {
    calls, tickets,
    async create(repo: any, input: any, ctx: any) {
      calls.create += 1
      await wait(typeof opt.createMs === 'number' ? opt.createMs : lat)
      const idem = input && input.idempotencyKey ? String(input.idempotencyKey) : ''
      if (idem) { const hit = findAnchor(idem); if (hit) return { ok: true, data: row(hit) } }
      // 模拟「这一批里没来得及写完的几张」：按计划内短标识拒绝，票不落盘。
      if (Array.isArray(opt.failKeys) && opt.failKeys.some((k: string) => idem.indexOf('-child-' + k) >= 0)) {
        return { ok: false, error: { kind: 'network', message: '模拟写失败：' + String((input && input.title) || '') } }
      }
      const anchorHead = idem ? '<!-- DSH-IDEMPOTENCY-KEY: ' + idem + ' -->\n' : ''
      const t: any = { number: next++, title: String((input && input.title) || ''), body: anchorHead + String((input && input.body) || ''), parentKey: '', idemKey: idem }
      tickets.set(String(t.number), t)
      // 模拟孤儿：调用方要求时第一批不挂父边
      if (!opt.dropParent && input && input.parentKey) t.parentKey = String(input.parentKey)
      return { ok: true, data: row(t) }
    },
    async get(repo: any, key: any, opts: any, ctx: any) {
      calls.get += 1
      await wait(lat)
      const t = tickets.get(String(key))
      if (!t) return { ok: false, error: { kind: 'not-found', message: 'no such ticket' } }
      return { ok: true, data: row(t) }
    },
    async list(repo: any, filter: any, ctx: any) {
      calls.list += 1
      await wait(lat)
      let rows = Array.from(tickets.values()).map(row)
      const f = filter || {}
      if (f.parentKey !== undefined && f.parentKey !== null && f.parentKey !== '') rows = rows.filter((r) => String(r.parentKey) === String(f.parentKey))
      if (f.state && f.state !== 'all') rows = rows.filter((r) => r.state === String(f.state))
      return { ok: true, data: rows }
    },
    async getDependencies(repo: any, key: any, opts: any, ctx: any) { return { ok: true, data: { blockedBy: [], blocking: [] } } },
    async setParent(repo: any, key: any, parentKey: any, opts: any, ctx: any) {
      const t = tickets.get(String(key))
      if (!t) return { ok: false, error: { kind: 'not-found', message: 'no such ticket' } }
      t.parentKey = String(parentKey)
      return { ok: true, data: row(t) }
    },
    async setBlockedBy(repo: any, key: any, blockers: any, opts: any, ctx: any) { return { ok: true, data: row(tickets.get(String(key))) } },
  }
}

function stubGate() {
  return { admitAiTool: () => ({ admitted: true }), send: async (req: any, perform: any) => { await perform(); return { sent: true, requests: 0, points: 0 } } }
}
function execOf(cwd?: string) { return { agent: { session: { cwd: cwd || 'C:/fake-ws-1245', id: 'sess-1245' } } } as any }

async function main() {
  console.log('#1245 回归门禁：自动标识稳定加孤儿修复')
  const storeMod: any = await imp('src/deck/shell/plan-cursor.ts')
  const budget: any = await imp('src/refresh/kernel/host-budget.js')
  const toolCost: any = await imp('src/refresh/kernel/tool-call-budget.js')
  const planMod: any = await imp('src/deck/tools/map-plan-create.ts')
  const values: any = await imp('src/shared/time-config/values.js')
  check(typeof planMod.createDeckMapPlanCreate === 'function', '建图工厂存在')

  function shellDeps(tracker: any, extra: any = {}) {
    // #1439（#1442）起打开 Tracker 会话时要按后端编号取预算声明，预算声明是必填项：这里的桩后端照
    // 「离网」口径声明（不发请求、不计条数与点数），少了 modules 这一格 openTracker 会回 pending，
    // 工具就一路回 backend-threw（看上去像后端抛错，其实根本没走到 work 闭包）。
    const registry: any = {
      select: async () => ({ backendId: 'stub', source: 'test' }),
      get: () => tracker,
      modules: () => [{ id: 'stub', budget: { kind: 'off-network', countsRequests: false, countsPoints: false, independentBuckets: false } }],
    }
    chooseWorkspace('C:/fake-ws-1245', 'stub')
    return Object.assign({ gate: stubGate(), registry, budget, estimate: toolCost.estimateToolCost, costInputFrom: toolCost.toolCostInputFrom, now: Date.now, hourUsage: () => ({}), decideBackend: makeDecideStub(registry) }, extra)
  }

  // —— ① 自动计划标识稳定：不传 planId，两次同一输入得同一标识，第二次零新建 ——
  {
    const tracker = makeStubTracker({ latencyMs: 5 })
    const mem = storeMod.createMemoryPlanStore()
    const kids = [{ key: 'a', title: '甲', kind: 'issue' }, { key: 'b', title: '乙', kind: 'issue' }]
    const p1 = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: mem, toolTimeoutMs: 8000, toolMarginMs: 500 }))
    const r1: any = await p1.run(execOf(), { title: '自动图', children: kids })
    const v1 = r1.value || r1
    const id1 = v1.data && v1.data.planId
    check(typeof id1 === 'string' && id1.indexOf('auto-') === 0, '没传 planId 时回自动标识（实得 ' + id1 + '）')
    const n1 = tracker.tickets.size
    const p2 = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: mem, toolTimeoutMs: 8000, toolMarginMs: 500 }))
    const r2: any = await p2.run(execOf(), { title: '自动图', children: kids })
    const v2 = r2.value || r2
    check((v2.data && v2.data.planId) === id1, '同一份输入第二次得同一自动标识')
    check(tracker.tickets.size === n1, '第二次零新建（' + n1 + ' 票不变）')
    const notes2 = ((v2.notes || []) as string[]).join('\n')
    check(/自动计划标识/.test(notes2) || /planId/.test(v2.text || ''), '回执带续跑指引')
  }

  // —— ② 同计划标识续跑零重复：先紧预算部分成功，再足预算续跑 ——
  {
    const tracker = makeStubTracker({ latencyMs: 90 })
    const mem = storeMod.createMemoryPlanStore()
    const kids = ['k1', 'k2', 'k3', 'k4'].map((k) => ({ key: k, title: '子票' + k, kind: 'issue' }))
    const p1 = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: mem, toolTimeoutMs: 300, toolMarginMs: 150 }))
    const r1: any = await p1.run(execOf(), { title: '图', children: kids, planId: 'p1245-stop' })
    const v1 = r1.value || r1
    check(v1.status === 'partial', '预算打满 → 部分成功（实得 ' + v1.status + '）')
    const p2 = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: mem, toolTimeoutMs: 8000, toolMarginMs: 200 }))
    const r2: any = await p2.run(execOf(), { title: '图', children: kids, planId: 'p1245-stop' })
    const v2 = r2.value || r2
    check(((v2.data && v2.data.restKeys) || []).length === 0, '续跑后无剩余')
    const seen = new Set<string>()
    let dup = 0
    for (const t of tracker.tickets.values()) { if (t.idemKey) { if (seen.has(t.idemKey)) dup += 1; seen.add(t.idemKey) } }
    check(dup === 0, '续跑零重复锚（重复 ' + dup + '）')
  }

  // —— ③ 孤儿修复：首批丢父边，续跑补挂且不新建 ——
  {
    const tracker = makeStubTracker({ latencyMs: 5, dropParent: true })
    const mem = storeMod.createMemoryPlanStore()
    const kids = [{ key: 'c1', title: '丙', kind: 'issue' }]
    const p1 = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: mem, toolTimeoutMs: 8000, toolMarginMs: 500 }))
    const r1: any = await p1.run(execOf(), { title: '孤儿图', children: kids, planId: 'p1245-orphan' })
    const v1 = r1.value || r1
    const childKey = v1.data && (v1.data.builtKeys || []).filter((k: string) => k !== (v1.data.mapKey || ''))[0]
    check(!!childKey, '首批建出子票')
    // 首批因 dropParent 留下父空
    const g1: any = await tracker.get({}, childKey, {}, {})
    check(String(g1.data.parentKey || '') === '', '首批子票父边为空（孤儿）')
    const n1 = tracker.tickets.size
    // 第二次用正常后端（同票仓）续跑同一计划：应补挂父边，不新建
    const tracker2: any = tracker
    delete (tracker2 as any).dropParent
    ;(tracker2 as any).dropParent = false
    const p2 = planMod.createDeckMapPlanCreate(shellDeps(tracker2, { planStore: mem, toolTimeoutMs: 8000, toolMarginMs: 500 }))
    const r2: any = await p2.run(execOf(), { title: '孤儿图', children: kids, planId: 'p1245-orphan' })
    const v2 = r2.value || r2
    const g2: any = await tracker2.get({}, childKey, {}, {})
    check(String(g2.data.parentKey || '') === String(v2.data.mapKey), '续跑补挂父边')
    check(tracker2.tickets.size === n1, '补挂不新建（' + n1 + ' 票不变）')
  }

  // —— ④ 时间同源（#1245：房兜底 30 秒、游标 10 秒；单次钳制 2026-10-22 按列表实测从 30 秒放宽到 60 秒） ——
  {
    const t = values.TIME_YAML || {}
    check(t.perOpTimeoutMs === 60000, '单次远端钳制 60 秒（实 ' + t.perOpTimeoutMs + '）')
    check(t.githubClientTimeoutMs === 30000, '房兜底 30 秒（实 ' + t.githubClientTimeoutMs + '）')
    check(t.outboundWriteMs === 30000, '写档 30 秒（实 ' + t.outboundWriteMs + '）')
    check(t.deckStoreMs === 10000, '游标 10 秒（实 ' + t.deckStoreMs + '）')
  }

  // —— ⑤ 故意建第二张：显式不同计划标识建新票，不复用旧票 ——
  {
    const tracker = makeStubTracker({ latencyMs: 5 })
    const mem = storeMod.createMemoryPlanStore()
    const kids = [{ key: 'd1', title: '丁', kind: 'issue' }]
    const pa = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: mem, toolTimeoutMs: 8000, toolMarginMs: 500 }))
    const ra: any = await pa.run(execOf(), { title: '同名图', children: kids, planId: 'p1245-first' })
    const va = ra.value || ra
    const n1 = tracker.tickets.size
    check(n1 === 2, '首张计划建出地图加子票（实 ' + n1 + ' 票）')
    const pb = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: mem, toolTimeoutMs: 8000, toolMarginMs: 500 }))
    const rb: any = await pb.run(execOf(), { title: '同名图', children: kids, planId: 'p1245-second' })
    const vb = rb.value || rb
    check(tracker.tickets.size === n1 + 2, '显式不同标识建出新计划（实 ' + tracker.tickets.size + ' 票）')
    check(String((vb.data && vb.data.planId) || '') === 'p1245-second', '新计划回自己的标识')
  }

  // —— ⑥ 外层掐断的后果：首调用只落一部分、游标与回执都没了，十分钟后同样输入重跑 ——
  {
    const kids = ['e1', 'e2', 'e3', 'e4'].map((k) => ({ key: k, title: '子票' + k, kind: 'issue' }))
    // 首调用：父边故意丢（模拟两段式写父边前被掐断），e3、e4 写失败（模拟这一批里没来得及写完的那几张）。
    // 跑完以后下面故意不再用它的回执与游标 —— 外层掐断时这两样都会随进程消失。
    const stubOpt: any = { latencyMs: 5, dropParent: true, failKeys: ['e3', 'e4'] }
    const tracker = makeStubTracker(stubOpt)
    const doomedStore = storeMod.createMemoryPlanStore()
    const t0 = 1787000000000
    const p1 = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: doomedStore, toolTimeoutMs: 8000, toolMarginMs: 500, now: () => t0 }))
    const r1: any = await p1.run(execOf(), { title: '掐断图', children: kids })
    const v1 = r1.value || r1
    check(v1.status === 'partial', '首调用部分成功（实得 ' + v1.status + '）')
    check(tracker.tickets.size === 3, '首调用只落一张地图与两张子票（实 ' + tracker.tickets.size + ' 票）')
    const orphans: any[] = Array.from(tracker.tickets.values()).filter((t: any) => t.idemKey && t.idemKey.indexOf('-child-') >= 0)
    check(orphans.length === 2 && orphans.every((t) => String(t.parentKey || '') === ''), '首调用建成的子票父边为空（孤儿）')
    const orphanKeys = orphans.map((t) => String(t.number))
    // 进程被掐断后重跑：后端恢复正常，游标换一份全新的内存存储器。
    stubOpt.dropParent = false
    stubOpt.failKeys = []
    const freshStore = storeMod.createMemoryPlanStore()
    const t1 = t0 + 10 * 60 * 1000
    const p2 = planMod.createDeckMapPlanCreate(shellDeps(tracker, { planStore: freshStore, toolTimeoutMs: 8000, toolMarginMs: 500, now: () => t1 }))
    const r2: any = await p2.run(execOf(), { title: '掐断图', children: kids })
    const v2 = r2.value || r2
    const mapKey = String((v2.data && v2.data.mapKey) || '')
    check(!!mapKey && mapKey === String((v1.data && v1.data.mapKey) || ''), '重跑沿用首调用建的那张地图票（实 ' + mapKey + '）')
    check(String((v2.data && v2.data.planId) || '') === String((v1.data && v1.data.planId) || ''), '隔十分钟同样输入仍是同一个自动标识')
    check(tracker.tickets.size === 5, '十分钟后重跑不重造一张票（实 ' + tracker.tickets.size + ' 票，完整应为 5 票）')
    const seen = new Set<string>()
    let dup = 0
    for (const t of tracker.tickets.values()) { if (t.idemKey) { if (seen.has(t.idemKey)) dup += 1; seen.add(t.idemKey) } }
    check(dup === 0, '重跑零重复锚（重复 ' + dup + '）')
    let childCount = 0, unparented = 0
    for (const t of tracker.tickets.values()) {
      if (String(t.number) === mapKey) continue
      if (!(t.idemKey && t.idemKey.indexOf('-child-') >= 0)) continue
      childCount += 1
      if (String(t.parentKey || '') !== mapKey) unparented += 1
    }
    check(childCount === 4 && unparented === 0, '四张子票全部挂回地图票（子票 ' + childCount + ' 张，父边缺失 ' + unparented + ' 张）')
    const repaired: any[] = await Promise.all(orphanKeys.map((k) => tracker.get({}, k, {}, {})))
    check(repaired.every((g) => g && g.ok === true && String(g.data.parentKey || '') === mapKey), '首调用留下的孤儿父边被补挂')
    check(((v2.data && v2.data.skippedKeys) || []).length === 2, '已建的两张按锚认回、没有重建')
    check(v2.status === 'ok' && ((v2.data && v2.data.restKeys) || []).length === 0, '重跑把整张计划做完（状态 ' + v2.status + '）')
    check(!!(v2.data && v2.data.counts && v2.data.counts.ok === true), '按父票数得齐四张子票（计数不再漏孤儿）')
  }

  console.log('\n共 ' + total + ' 条，' + (failed ? '有失败' : '全过'))
  if (failed) process.exit(1)
}

main().catch((e) => { console.error('FAIL 异常', e); process.exit(1) })
