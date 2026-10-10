// src/host/tools/deckMapPlanCreate.js —— deck_map_plan_create（#713 第六批，本批价值最高的一个）
//
// 一次把一整张地图的骨架建出来：地图票 + 一票子票 + 子票之间的依赖边，最后逐项校验计数。
// 它贵，所以三件事都做在明面上：
//   1. **先算账再动手**：调用前算出点数、出站请求条数、会不会超单次顶、建议分几片（refresh-core/src/tool-cost.ts）；
//      超过一片就只做第一片，把「下一次要带的子票清单」原样回给 AI，自己绝不一口气建几百张。
//   2. **可续跑的中间态**：每建成一张票、每建成一条边都记一笔（deps.planStore 落盘；没注入时按工作区
//      目录建文件游标，再不行退化成进程内存，那时返回值里会如实说「这次不是落盘的」）。
//      重跑同一个 planId：已经建成的键直接跳过，不再花钱。
//   3. **逐项校验**：建完按父票列一遍子票，把「计划几张、实际几张」对一次，数字对不上就说 partial，不假装成功。
//
// 幂等靠契约层（#711）：每一个建票动作都带一个由 planId 推出来的锚，重试同一次计划不会多出票。
// 限时（#895）：整包活包一层调用上下文——剩余额度不够就停发新调用（部分成功+游标），
// 每一次远端调用单独钳制，超时只坏自己那一项；同计划标识并发第二跑直接拒绝。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import { sessionContextOfAsync } from '../../shared/deck-tools/session-resolve.js'
import { withCallScope } from '../../shared/deck-tools/call-scope.js'
import { createMemoryPlanStore, createFilePlanStore } from '../../shared/deck-tools/plan-store.js'
import { matchAnchor, isAnchorHit } from '../../shared/refresh/idempotency.js'
import { applyParentEdge, applyBlockEdges, statusOfItems, childrenOf } from '../../shared/deck-tools/edges.js'
import { ensureLabels, ensureBody, anchorKeyFor } from '../../shared/deck-tools/plan.js'
import * as budget from '../../shared/refresh/budget.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'

export const definition = {
  name: 'deck_map_plan_create',
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。一次建一整张 map 的骨架（map ISSUE + child ISSUE + 依赖边），带逐项校验与可续跑中间态。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '地图票的标题' },
      body: { type: 'string', description: '地图正文；缺省时自动补五个区块' },
      planId: { type: 'string', description: '这次计划的标识；重跑时带同一个值就能接着上次没做完的部分继续' },
      children: {
        type: 'array',
        description: '要建的子票清单',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '计划内的短标识，边用它来指代这张票' },
            title: { type: 'string' },
            body: { type: 'string' },
            kind: { type: 'string', enum: ['task', 'bug', 'map'] },
            labels: { type: 'array', items: { type: 'string' } },
            assignees: { type: 'array', items: { type: 'string' } },
          },
          required: ['key', 'title'],
          additionalProperties: false,
        },
      },
      edges: {
        type: 'array',
        description: '子票之间的边；from 是计划内的短标识（也可以是地图自己，写 @map）',
        items: {
          type: 'object',
          properties: { from: { type: 'string' }, to: { type: 'string' }, type: { type: 'string', enum: ['blocked-by', 'parent'] } },
          required: ['from', 'to'],
          additionalProperties: false,
        },
      },
      labels: { type: 'array', items: { type: 'string' } },
      effortId: { type: 'string', description: '只有本地后端需要填，填票所在的目录名，根目录的不填' },
    },
    required: ['title', 'children'],
    additionalProperties: false,
  },
}

/** 同计划标识的并发执行互斥（进程内）：第二跑直接拒绝，不与第一跑交错写。 */
const ACTIVE_PLANS = new Map()

function numOpt(v) { return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : undefined }
// 等待竞速：沙箱超时按缺席走老路；游标读超时按空游标（锚预检与幂等键仍是去重权威，不多出票），写超时吞掉。
function withCap(promise, ms) { return Promise.race([Promise.resolve(promise).then(function (v) { return { ok: true, value: v } }, function () { return { ok: false } }), new Promise(function (resolve) { setTimeout(function () { resolve({ ok: false, timedOut: true }) }, ms) })]) }
const SANDBOX_TIMEOUT_MS = 5000; const STORE_TIMEOUT_MS = 10000

function storeIoFrom(deps, cwd) {
  try {
    const b = (deps && typeof deps.backendCtx === 'function') ? deps.backendCtx() : deps.backendCtx
    const platform = (b && b.platform) || null
    const fs = (b && b.fs) || (platform && platform.fs) || null
    if (!platform || !fs || typeof fs.readText !== 'function' || typeof fs.writeText !== 'function') return null
    const join = (platform.path && typeof platform.path.join === 'function')
      ? function (a, c) { return platform.path.join(a, c) }
      : function (a, c) { return String(a).replace(/\\/g, '/') + '/' + c }
    const dir = join(String(cwd || ''), '.dsh-mattskillsdeck-cache') + '/deck-plans'
    return {
      readText: function (p) { return fs.readText(p) },
      writeText: function (p, t) { return fs.writeText(p, t) },
      mkdir: (typeof fs.mkdir === 'function') ? function (p) { return fs.mkdir(p) } : undefined,
      dir: dir,
    }
  } catch (e) { return null }
}

export function createDeckMapPlanCreate(deps) {
  const d = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))
  const fallbackStore = createMemoryPlanStore()
  const nowFn = (typeof d.now === 'function') ? d.now : Date.now

  async function run(exec, args) {
    const a = args || {}
    const title = String(a.title === undefined || a.title === null ? '' : a.title).trim()
    const children = Array.isArray(a.children) ? a.children.filter((c) => c && c.key && c.title) : []
    const edges = Array.isArray(a.edges) ? a.edges.filter((e) => e && e.from && e.to) : []
    const est = shell.estimateFor('deck_map_plan_create', a)
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    if (!s.ok) return shell.unsupported('deck_map_plan_create', s.reason, s.text, { cost: { estimated: est } })
    if (!title || !children.length) {
      return shell.unsupported('deck_map_plan_create', REFUSAL_REASONS.BAD_ARGS, '建整张地图至少要给 title 与一张子票（children 里每项要有 key 与 title）。', { cost: { estimated: est } })
    }
    const planId = String(a.planId || anchorKeyFor({ tool: 'deck_map_plan_create', sessionId: s.sessionId, workspaceKey: s.workspaceKey, title: title, labels: children.map((c) => c.key), now: nowFn() }))
    if (ACTIVE_PLANS.get(planId)) {
      return shell.unsupported('deck_map_plan_create', REFUSAL_REASONS.BACKEND_UNSUPPORTED, '同一个计划标识（' + planId.slice(0, 60) + '）正在另一次执行里跑（进行中），这次没动手：等它做完再来，或换一个 planId。', { cost: { estimated: est } })
    }
    ACTIVE_PLANS.set(planId, 1)
    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) { ACTIVE_PLANS.delete(planId); return shell.unsupported('deck_map_plan_create', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } }) }
    const repo = shell.repoOf(pick, s)
    const effortId = (a.effortId === undefined || a.effortId === null) ? '' : String(a.effortId).trim()
    if (effortId) repo.effortId = effortId

    let store = (d.planStore && typeof d.planStore.load === 'function') ? d.planStore : null
    if (!store) {
      const built = storeIoFrom(d, s.cwd)
      store = built ? createFilePlanStore({ io: built, dir: built.dir, workspaceKey: s.workspaceKey, now: nowFn }) : fallbackStore
    }
    // 游标读写加竞速：挂住的文件服务不能卡住整笔建图。读超时按空游标继续——去重权威
    // 从来不是游标，而是幂等锚预检与建票幂等键，只多花几次列表读数，不多出票；写超时吞掉。
    const rawStore = store
    store = {
      durable: rawStore.durable,
      load: function (id) {
        return withCap(rawStore.load(id), STORE_TIMEOUT_MS).then(function (r) { return (r && r.ok === true) ? r.value : null })
      },
      save: function (id, st) {
        return withCap(rawStore.save(id, st), STORE_TIMEOUT_MS).then(function () {}, function () {})
      },
      remove: (typeof rawStore.remove === 'function') ? function (id) {
        return withCap(rawStore.remove(id), STORE_TIMEOUT_MS).then(function () {}, function () {})
      } : undefined,
    }

    let out = null
    try {
      out = await shell.call({ tool: 'deck_map_plan_create', kind: 'write', session: s, pick: pick, repo: repo, estimate: est, sandbox: (await (async function () { try { if (typeof d.sandboxPolicyFor !== 'function') return null; const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), SANDBOX_TIMEOUT_MS); return (raced && raced.ok === true) ? raced.value : null } catch (eS) { return null } })()), signal: (exec && exec.signal && typeof exec.signal === 'object') ? exec.signal : undefined }, async (c) => {      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), now: nowFn })
      const t = sc.tracker
      const opCtx = sc.opCtx
      const prev = (await store.load(planId)) || { planId: planId, mapKey: '', keys: {}, edges: [], done: [] }
      const state = { planId: planId, mapKey: prev.mapKey || '', keys: Object.assign({}, prev.keys), edges: Array.isArray(prev.edges) ? prev.edges.slice() : [], done: Array.isArray(prev.done) ? prev.done.slice() : [] }
      const items = []
      const notes = []
      if (effortId) notes.push('这次带了 effortId（' + effortId.slice(0, 60) + '）：本地后端只在那一个目录里找，远端后端忽略它。')
      const storeDurable = store.durable !== false
      if (!storeDurable) notes.push('这次的中间态只记在本进程的内存里（没有注入落盘的存储器）：进程重启后重跑同一个 planId 会重新建票。')
      let stoppedEarly = false

      // ① 地图票本身：只建一次，锚由 planId 推出来。
      if (!state.mapKey) {
        const mapEnsured = ensureBody(a.body, 'map')
        const created = await t.create(repo, {
          title: title, body: mapEnsured.body, type: 'map', labels: ensureLabels(a.labels, 'map').labels,
          idempotencyKey: 'deck-plan-' + planId + '-map',
        }, opCtx)
        if (!created || created.ok !== true) {
          const msg = String((created && created.error && created.error.message) || '后端没给出原因').slice(0, 300)
          return {
            value: { status: DECK_STATUS.UNSUPPORTED, reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED, text: '地图票没建成（后端原话：' + msg + '），后面的子票与边都没动。', data: { planId: planId, error: { kind: String((created && created.error && created.error.kind) || ''), message: msg } }, notes: notes },
            claimed: { requests: 1, points: 4 },
          }
        }
        state.mapKey = String((created.data && created.data.key) || '')
        state.done.push('map')
        await store.save(planId, state)
        items.push({ key: state.mapKey, role: 'map', title: title, status: 'ok' })
      } else {
        notes.push('地图票 ' + state.mapKey + ' 上次已经建好了，这次直接接着做。')
        items.push({ key: state.mapKey, role: 'map', title: title, status: 'ok', skipped: true })
      }

      // ①b 批量锚预检：一次列表把已建的子票认回来（命中就跳过创建）；拿不准就照常走，不挡事。
      try {
        const untouched = children.filter((ch) => !state.keys[String(ch.key)])
        if (untouched.length) {
          const all = await t.list(repo, { state: 'all' }, opCtx)
          const rows = (all && all.ok === true && Array.isArray(all.data)) ? all.data : null
          const cands = rows ? rows.filter((r) => r && typeof r.body === 'string').map((r) => ({ key: String(r.key), body: r.body, state: r.state })) : []
          if (cands.length) {
            for (const ch of untouched) {
              let m = null
              try { m = matchAnchor(cands, repo.refId, 'deck-plan-' + planId + '-child-' + String(ch.key)) } catch (eM) { m = null }
              if (m && isAnchorHit(m)) {
                state.keys[String(ch.key)] = String(m.key)
                state.done.push('child:' + String(ch.key))
                items.push({ key: String(m.key), role: 'child', planKey: String(ch.key), title: String(ch.title), status: 'ok', skipped: true })
              }
            }
            await store.save(planId, state)
          }
        }
      } catch (ePre) {}

      // ② 子票：按分片上限做这一片；已经建成的键跳过（这就是「续跑要跳过的键」）。
      // 这一片同时建（各子票互相独立；本地后端的取号落盘在房间的写者队列里串行，不会取重号）。
      // 结果按分片顺序合回，中间态一次一存；剩余额度不够时主动停：剩下的记进 restKeys，下一次带同 planId 接着建。
      const pending = children.filter((ch) => !state.keys[String(ch.key)])
      const skippedKeys = children.filter((ch) => state.keys[String(ch.key)]).map((ch) => String(ch.key))
      const shard = pending.slice(0, est.perShard)
      let restKeys = pending.slice(est.perShard).map((ch) => String(ch.key))
      const made = await Promise.all(shard.map(async (ch) => {
        if (sc.outOfBudget()) return { ch: ch, over: true, created: null }
        const kind = (ch.kind === 'bug' || ch.kind === 'map') ? ch.kind : 'task'
        const ensured = ensureLabels(ch.labels, kind)
        const body = ensureBody(ch.body, kind)
        const created = await t.create(repo, {
          title: String(ch.title).trim(), body: body.body, type: kind, labels: ensured.labels,
          parentKey: state.mapKey, assignees: Array.isArray(ch.assignees) && ch.assignees.length ? ch.assignees : undefined,
          idempotencyKey: 'deck-plan-' + planId + '-child-' + String(ch.key),
        }, opCtx)
        return { ch: ch, over: false, created: created }
      }))
      const overKeys = []
      for (const o of made) {
        if (o.over) { stoppedEarly = true; overKeys.push(String(o.ch.key)); continue }
        const created = o.created
        if (created && created.ok === true) {
          state.keys[String(o.ch.key)] = String((created.data && created.data.key) || '')
          state.done.push('child:' + String(o.ch.key))
          items.push({ key: state.keys[String(o.ch.key)], role: 'child', planKey: String(o.ch.key), title: String(o.ch.title), status: 'ok' })
        } else {
          const msg = String((created && created.error && created.error.message) || '后端没给出原因').slice(0, 200)
          items.push({ key: '', role: 'child', planKey: String(o.ch.key), title: String(o.ch.title), status: 'failed', reason: msg })
        }
        await store.save(planId, state)
      }
      restKeys = overKeys.concat(restKeys)

      // ③ 边：端点都在计划里才做；落点由写后读回判（写加判见 edges.js 的共用函数）。
      // #898：设置阻塞边是整批替换语义，同一张票的多条阻塞边先合并成完整集合再写一次，
      // 否则后一次写会删掉前一次写上的边；校验按本次该票的全部目标逐个核对。
      // 同一张票的写组内逐条来（同时写同一张票会丢一次改动），不同票的组同时写；
      // 结果按边的传入顺序合回，中间态落盘与原来一样逐条记。
      const keyOf = (ref) => (String(ref) === '@map' ? state.mapKey : (state.keys[String(ref)] || ''))
      let edgeCount = 0
      const edgeJobs = []
      for (const e of edges) {
        const from = keyOf(e.from)
        const to = keyOf(e.to)
        if (!from || !to) { items.push({ key: from || '', role: 'edge', status: 'failed', reason: '边的端点还没有票号（' + String(e.from) + ' → ' + String(e.to) + '）：先把它那一张建出来再补这条边。' }); continue }
        edgeJobs.push({ idx: edgeJobs.length, from: from, to: to, parent: e.type === 'parent' })
      }
      const parentByFrom = new Map()
      for (const j of edgeJobs) if (j.parent) { if (!parentByFrom.has(j.from)) parentByFrom.set(j.from, []); parentByFrom.get(j.from).push(j) }
      const blockByFrom = new Map()
      const blockOrder = []
      for (const j of edgeJobs) {
        if (j.parent) continue
        let g = blockByFrom.get(j.from)
        if (!g) { g = { targets: [], occ: [] }; blockByFrom.set(j.from, g); blockOrder.push(j.from) }
        if (g.targets.indexOf(j.to) < 0) g.targets.push(j.to)
        g.occ.push(j)
      }
      const edgeRecs = []
      if (!sc.outOfBudget() && edgeJobs.length) {
        const parentOut = await Promise.all(Array.from(parentByFrom.values()).map(async (list) => {
          const out = []
          for (const j of list) {
            if (sc.outOfBudget()) { out.push({ idx: j.idx, over: true }); continue }
            const r = await applyParentEdge(t, repo, opCtx, j.from, j.to)
            out.push({ idx: j.idx, over: false, item: r.item, rec: r.applied ? { from: j.from, to: j.to, op: 'parent' } : null, save: r.applied })
          }
          return out
        }))
        const blockOut = await Promise.all(blockOrder.map(async (from) => {
          const g = blockByFrom.get(from)
          if (sc.outOfBudget()) return g.occ.map((j) => ({ idx: j.idx, over: true }))
          const r = await applyBlockEdges(t, repo, opCtx, from, g.targets, g.occ.map((j) => j.to))
          return g.occ.map((j, k) => ({ idx: j.idx, over: false, item: r.items[k], rec: r.applied.indexOf(j.to) >= 0 ? { from: from, to: j.to, op: 'block' } : null, save: k === g.occ.length - 1 && !r.failed }))
        }))
        for (const group of parentOut) for (const o of group) edgeRecs.push(o)
        for (const group of blockOut) for (const o of group) edgeRecs.push(o)
        edgeRecs.sort((x, y) => x.idx - y.idx)
        for (const o of edgeRecs) {
          if (o.over) { stoppedEarly = true; continue }
          items.push(o.item)
          if (o.rec) { edgeCount += 1; state.edges.push(o.rec); state.done.push('edge:' + o.rec.from + '-' + o.rec.op + '-' + o.rec.to) }
          if (o.save) await store.save(planId, state)
        }
      } else if (edgeJobs.length) { stoppedEarly = true }

      // ④ 逐项校验：按父票把子票列一遍，计划几张、实际几张，数字对不上就说 partial。
      // 剩余额度不够时跳过这一步（以“没校验”如实返回，不硬撑）。
      const listed = sc.outOfBudget() ? null : await t.list(repo, { parentKey: state.mapKey }, opCtx)
      const liveRows = (listed && listed.ok === true && Array.isArray(listed.data)) ? listed.data : null
      const picked = liveRows ? childrenOf(liveRows, state.mapKey) : { children: null, filtered: false, note: '' }
      const plannedLive = Object.keys(state.keys).length
      let counts = { planned: plannedLive + 1, actual: null, ok: false, compared: picked.filtered }
      if (picked.children) {
        counts = { planned: plannedLive + 1, actual: picked.children.length + 1, ok: picked.children.length === plannedLive, compared: picked.filtered }
      }
      if (!counts.ok) notes.push('逐项校验没对上：计划里有 ' + counts.planned + ' 张（含地图票），按父票列出来 ' + (counts.actual === null ? '拿不到（后端没给出原因）' : counts.actual + ' 张') + '。以这个数字为准，别按计划数字往下走。')
      if (picked.note) notes.push(picked.note)

      // #746：地图票直达命名守护（调用会话即建号会话；子票走既有索引轮询分配；hook 不影响返回）。
      try { if (typeof d.onTicketCreated === 'function' && state.mapKey) await d.onTicketCreated({ sessionId: s.sessionId, key: String(state.mapKey), title: title }) } catch (eHook) {}
      const rawStatus = statusOfItems(items)
      // 没做完（限时自停或还有剩余）但逐项全成时，诚实报部分成功，不假装做完。
      const status = (rawStatus === DECK_STATUS.OK && (stoppedEarly || restKeys.length)) ? DECK_STATUS.PARTIAL : rawStatus
      let text = '计划 ' + planId + '：这一片建了 ' + shard.length + ' 张子票（共计划 ' + children.length + ' 张），建成 ' + edgeCount + ' 条边' +
        (restKeys.length ? '；还有 ' + restKeys.length + ' 张没建（' + restKeys.join('、') + '），带同一个 planId 再调一次就接着建。' : '。')
      if (stoppedEarly) text += '时间不够先停在这里（剩余额度不足），已建的不用重建。'
      if (status === DECK_STATUS.OK && !restKeys.length && typeof store.remove === 'function') {
        try { await store.remove(planId) } catch (eRm) {}
      }
      return {
        value: {
          status: status,
          reason: status === DECK_STATUS.OK ? '' : REFUSAL_REASONS.BACKEND_UNSUPPORTED,
          text: text,
          data: {
            planId: planId, mapKey: state.mapKey, durable: storeDurable,
            builtKeys: Object.values(state.keys), skippedKeys: skippedKeys, restKeys: restKeys,
            edges: state.edges, counts: counts,
            shards: { suggested: est.shards, perShard: est.perShard, maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL },
            nextCall: restKeys.length ? { tool: 'deck_map_plan_create', planId: planId, hint: '带同一个 planId、把 restKeys 这些子票再传一次' } : null,
          },
          items: items,
          notes: notes,
          touched: [state.mapKey].concat(Object.values(state.keys)).filter(Boolean),
        },
        claimed: { requests: est.requests, points: est.points },
      }
      })
    } finally { ACTIVE_PLANS.delete(planId) }
    return out
  }

  return { definition: definition, run: run }
}
