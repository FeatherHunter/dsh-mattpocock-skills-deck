// src/host/tools/deckMapPlanCreate.js —— deck_map_plan_create（#713 第六批，本批价值最高的一个）
//
// 一次把一整张地图的骨架建出来：地图票 + 一票子票 + 子票之间的依赖边，最后逐项校验计数。
// 它贵，所以三件事都做在明面上：
//   1. **先算账再动手**：调用前算出点数、出站请求条数、会不会超单次顶、建议分几片（refresh-core/src/tool-cost.ts）；
//      超过一片就只做第一片，把「下一次要带的子票清单」原样回给 AI，自己绝不一口气建几百张。
//   2. **可续跑的中间态**：每建成一张票、每建成一条边都记一笔（deps.planStore 落盘；没注入时退化成进程内存，
//      那时返回值里会如实说「这次不是落盘的」）。重跑同一个 planId：已经建成的键直接跳过，不再花钱。
//   3. **逐项校验**：建完按父票列一遍子票，把「计划几张、实际几张」对一次，数字对不上就说 partial，不假装成功。
//
// 幂等靠契约层（#711）：每一个建票动作都带一个由 planId 推出来的锚，重试同一次计划不会多出票。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import { classifyEdgeLanding, unsupportedEvidence, edgeEvidence, statusOfItems, childrenOf } from '../../shared/deck-tools/edges.js'
import { ensureLabels, ensureBody, anchorKeyFor } from '../../shared/deck-tools/plan.js'
import * as budget from '../../shared/refresh/budget.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'

export const definition = {
  name: 'deck_map_plan_create',
  description: '一次建一整张地图的骨架（地图票 + 子票 + 子票之间的依赖边），带逐项校验与可续跑的中间态。',
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
    },
    required: ['title', 'children'],
    additionalProperties: false,
  },
}

function memoryStore() {
  const table = new Map()
  return {
    durable: false,
    load(planId) { return table.get(String(planId)) || null },
    save(planId, state) { table.set(String(planId), state) },
  }
}

export function createDeckMapPlanCreate(deps) {
  const d = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))
  const fallbackStore = memoryStore()

  async function run(exec, args) {
    const a = args || {}
    const title = String(a.title === undefined || a.title === null ? '' : a.title).trim()
    const children = Array.isArray(a.children) ? a.children.filter((c) => c && c.key && c.title) : []
    const edges = Array.isArray(a.edges) ? a.edges.filter((e) => e && e.from && e.to) : []
    const est = shell.estimateFor('deck_map_plan_create', a)
    const s = shell.context(exec)
    if (!s.ok) return shell.unsupported('deck_map_plan_create', s.reason, s.text, { cost: { estimated: est } })
    if (!title || !children.length) {
      return shell.unsupported('deck_map_plan_create', REFUSAL_REASONS.BAD_ARGS, '建整张地图至少要给 title 与一张子票（children 里每项要有 key 与 title）。', { cost: { estimated: est } })
    }
    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) return shell.unsupported('deck_map_plan_create', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)

    const store = (d.planStore && typeof d.planStore.load === 'function') ? d.planStore : fallbackStore
    const now = (typeof d.now === 'function') ? d.now() : Date.now()
    const planId = String(a.planId || anchorKeyFor({ tool: 'deck_map_plan_create', sessionId: s.sessionId, workspaceKey: s.workspaceKey, title: title, labels: children.map((c) => c.key), now: now }))

    return shell.call({ tool: 'deck_map_plan_create', kind: 'write', session: s, pick: pick, repo: repo, estimate: est }, async (c) => {
      const prev = store.load(planId) || { planId: planId, mapKey: '', keys: {}, edges: [], done: [] }
      const state = { planId: planId, mapKey: prev.mapKey || '', keys: Object.assign({}, prev.keys), edges: Array.isArray(prev.edges) ? prev.edges.slice() : [], done: Array.isArray(prev.done) ? prev.done.slice() : [] }
      const items = []
      const notes = []
      const storeDurable = store.durable !== false
      if (!storeDurable) notes.push('这次的中间态只记在本进程的内存里（没有注入落盘的存储器）：进程重启后重跑同一个 planId 会重新建票。')

      // ① 地图票本身：只建一次，锚由 planId 推出来。
      if (!state.mapKey) {
        const mapEnsured = ensureBody(a.body, 'map')
        const created = await c.tracker.create(repo, {
          title: title, body: mapEnsured.body, type: 'map', labels: ensureLabels(a.labels, 'map').labels,
          idempotencyKey: 'deck-plan-' + planId + '-map',
        }, c.opCtx)
        if (!created || created.ok !== true) {
          const msg = String((created && created.error && created.error.message) || '后端没给出原因').slice(0, 300)
          return {
            value: { status: DECK_STATUS.UNSUPPORTED, reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED, text: '地图票没建成（后端原话：' + msg + '），后面的子票与边都没动。', data: { planId: planId, error: { kind: String((created && created.error && created.error.kind) || ''), message: msg } }, notes: notes },
            claimed: { requests: 1, points: 4 },
          }
        }
        state.mapKey = String((created.data && created.data.key) || '')
        state.done.push('map')
        store.save(planId, state)
        items.push({ key: state.mapKey, role: 'map', title: title, status: 'ok' })
      } else {
        notes.push('地图票 ' + state.mapKey + ' 上次已经建好了，这次直接接着做。')
        items.push({ key: state.mapKey, role: 'map', title: title, status: 'ok', skipped: true })
      }

      // ② 子票：按分片上限做这一片；已经建成的键跳过（这就是「续跑要跳过的键」）。
      const pending = children.filter((ch) => !state.keys[String(ch.key)])
      const skippedKeys = children.filter((ch) => state.keys[String(ch.key)]).map((ch) => String(ch.key))
      const shard = pending.slice(0, est.perShard)
      const restKeys = pending.slice(est.perShard).map((ch) => String(ch.key))
      for (const ch of shard) {
        const kind = (ch.kind === 'bug' || ch.kind === 'map') ? ch.kind : 'task'
        const ensured = ensureLabels(ch.labels, kind)
        const body = ensureBody(ch.body, kind)
        const created = await c.tracker.create(repo, {
          title: String(ch.title).trim(), body: body.body, type: kind, labels: ensured.labels,
          parentKey: state.mapKey, assignees: Array.isArray(ch.assignees) && ch.assignees.length ? ch.assignees : undefined,
          idempotencyKey: 'deck-plan-' + planId + '-child-' + String(ch.key),
        }, c.opCtx)
        if (created && created.ok === true) {
          state.keys[String(ch.key)] = String((created.data && created.data.key) || '')
          state.done.push('child:' + String(ch.key))
          items.push({ key: state.keys[String(ch.key)], role: 'child', planKey: String(ch.key), title: String(ch.title), status: 'ok' })
        } else {
          const msg = String((created && created.error && created.error.message) || '后端没给出原因').slice(0, 200)
          items.push({ key: '', role: 'child', planKey: String(ch.key), title: String(ch.title), status: 'failed', reason: msg })
        }
        store.save(planId, state)
      }

      // ③ 边：端点都在计划里才做；落点由写后读回判（判据见 shell.js 的 classifyEdgeLanding）。
      const keyOf = (ref) => (String(ref) === '@map' ? state.mapKey : (state.keys[String(ref)] || ''))
      let edgeCount = 0
      for (const e of edges) {
        const from = keyOf(e.from)
        const to = keyOf(e.to)
        if (!from || !to) { items.push({ key: from || '', role: 'edge', status: 'failed', reason: '边的端点还没有票号（' + String(e.from) + ' → ' + String(e.to) + '）：先把它那一张建出来再补这条边。' }); continue }
        const op = (e.type === 'parent') ? 'parent' : 'block'
        const written = op === 'parent'
          ? await c.tracker.setParent(repo, from, to, {}, c.opCtx)
          : await c.tracker.setBlockedBy(repo, from, [to], {}, c.opCtx)
        let ev = null
        if (written && written.ok === true) {
          const back = typeof c.tracker.get === 'function' ? await c.tracker.get(repo, from, {}, c.opCtx) : null
          const dep = op === 'block' && typeof c.tracker.getDependencies === 'function' ? await c.tracker.getDependencies(repo, from, {}, c.opCtx) : null
          ev = classifyEdgeLanding(op, to, { issue: (back && back.ok === true) ? back.data : null, dependencies: (dep && dep.ok === true) ? dep.data : null })
          if (ev.ok) { edgeCount += 1; state.edges.push({ from: from, to: to, op: op }); state.done.push('edge:' + from + '-' + op + '-' + to); store.save(planId, state) }
        } else {
          ev = unsupportedEvidence(String((written && written.error && written.error.message) || '后端没给出原因').slice(0, 200))
        }
        items.push(Object.assign({ key: from, role: 'edge', status: written && written.ok === true ? 'ok' : 'failed' }, edgeEvidence(op, to, ev)))
      }

      // ④ 逐项校验：按父票把子票列一遍，计划几张、实际几张，数字对不上就说 partial。
      const listed = await c.tracker.list(repo, { parentKey: state.mapKey }, c.opCtx)
      const liveRows = (listed && listed.ok === true && Array.isArray(listed.data)) ? listed.data : null
      const picked = liveRows ? childrenOf(liveRows, state.mapKey) : { children: null, filtered: false, note: '' }
      const plannedLive = Object.keys(state.keys).length
      let counts = { planned: plannedLive + 1, actual: null, ok: false, compared: picked.filtered }
      if (picked.children) {
        counts = { planned: plannedLive + 1, actual: picked.children.length + 1, ok: picked.children.length === plannedLive, compared: picked.filtered }
      }
      if (!counts.ok) notes.push('逐项校验没对上：计划里有 ' + counts.planned + ' 张（含地图票），按父票列出来 ' + (counts.actual === null ? '拿不到（后端没给出原因）' : counts.actual + ' 张') + '。以这个数字为准，别按计划数字往下走。')
      if (picked.note) notes.push(picked.note)

      const status = statusOfItems(items)
      const text = '计划 ' + planId + '：这一片建了 ' + shard.length + ' 张子票（共计划 ' + children.length + ' 张），建成 ' + edgeCount + ' 条边' +
        (restKeys.length ? '；还有 ' + restKeys.length + ' 张没建（' + restKeys.join('、') + '），带同一个 planId 再调一次就接着建。' : '。')
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
  }

  return { definition: definition, run: run }
}
