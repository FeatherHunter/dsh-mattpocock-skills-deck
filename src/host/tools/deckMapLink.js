// src/host/tools/deckMapLink.js —— deck_map_link（#713 第六批）
//
// 给**已经存在**的票补边或改边：父子和阻塞两种，逐条做、逐条校验。
// 「每条边在返回里标出落点」就落在这里：写完之后读回一次那张票，按它自己的结构字段与正文判，
// 判不出来就说「说不好」，绝不默认写成「原生层级」（判据与反证方向见 shell.js 的 classifyEdgeLanding）。
// 校验用计数：改完按父票列一遍子票 / 再读一次依赖，把「要几条、实际几条」对一次，对不上就说 partial。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import { classifyEdgeLanding, edgeEvidence, statusOfItems, applyParentEdge, applyBlockEdges } from '../../shared/deck-tools/edges.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'
import { withCallScope } from '../../shared/deck-tools/call-scope.js'

function numOpt(v) { return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : undefined }

export const definition = {
  name: 'deck_map_link',
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。给已存在的 ISSUE 补 parent 或 blockedBy 边，写完读回并逐条标出落点。',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '要改的那张票（子票）' },
      parentKey: { type: 'string', description: '要挂到的父票；不传就不动父子' },
      blockedBy: { type: 'array', items: { type: 'string' }, description: '这张票被哪些票阻塞（整批替换）' },
      edges: {
        type: 'array',
        description: '一次改多张票的边；与 key/parentKey/blockedBy 二选一',
        items: {
          type: 'object',
          properties: { key: { type: 'string' }, parentKey: { type: 'string' }, blockedBy: { type: 'array', items: { type: 'string' } } },
          required: ['key'],
          additionalProperties: false,
        },
      },
      effortId: { type: 'string', description: '只有本地后端需要填，填票所在的目录名，根目录的不填' },
    },
    additionalProperties: false,
  },
}

function asList(v) {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []
}

export function createDeckMapLink(deps) {
  const d = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  async function run(exec, args) {
    const a = args || {}
    const est = shell.estimateFor('deck_map_link', a)
    const s = shell.context(exec)
    if (!s.ok) return shell.unsupported('deck_map_link', s.reason, s.text, { cost: { estimated: est } })
    const jobs = Array.isArray(a.edges) && a.edges.length ? a.edges : (a.key ? [a] : [])
    if (!jobs.length) return shell.unsupported('deck_map_link', REFUSAL_REASONS.BAD_ARGS, '要改哪张票的边：给 key（可带 parentKey / blockedBy），或者给 edges 清单。', { cost: { estimated: est } })
    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) return shell.unsupported('deck_map_link', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    const effortId = (a.effortId === undefined || a.effortId === null) ? '' : String(a.effortId).trim()
    if (effortId) repo.effortId = effortId

    return shell.call({ tool: 'deck_map_link', kind: 'write', session: s, pick: pick, repo: repo, estimate: est }, async (c) => {
      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), now: (typeof d.now === 'function') ? d.now : Date.now })
      const t = sc.tracker
      const opCtx = sc.opCtx
      const items = []
      const notes = []
      if (effortId) notes.push('这次带了 effortId（' + effortId.slice(0, 60) + '）：本地后端只在那一个目录里找，远端后端忽略它。')
      const touched = []
      let done = 0
      // #898：设置阻塞边是整批替换语义，同一个票号在一次调用里出现多次时，
      // 先把它的阻塞目标合并成完整集合再写一次，否则后一次写会删掉前一次的边。
      // 跨次调用仍按整批替换：以每一次调用的完整集合为准。
      const mergedBlocked = new Map()
      for (const job of jobs) {
        if (job.blockedBy !== undefined && job.blockedBy !== null) {
          const k = String((job && job.key) || '').trim()
          if (!k) continue
          if (!mergedBlocked.has(k)) mergedBlocked.set(k, [])
          const arr = mergedBlocked.get(k)
          for (const target of asList(job.blockedBy)) if (arr.indexOf(target) < 0) arr.push(target)
        }
      }
      // 同一张票的边组内逐条写（同时写同一张票会丢一次改动），不同票的组同时写。
      const keyOrder = []
      const jobsByKey = new Map()
      for (const job of jobs) {
        const k = String((job && job.key) || '').trim()
        if (!k) { items.push({ key: '', status: 'failed', reason: 'edges 里有一项没写 key。' }); continue }
        if (!jobsByKey.has(k)) { jobsByKey.set(k, []); keyOrder.push(k) }
        jobsByKey.get(k).push(job)
      }
      const perKey = await Promise.all(keyOrder.map(async (key) => {
        const out = { items: [], notes: [], touched: [], done: 0, readback: null }
        for (const job of jobsByKey.get(key)) {
          if (sc.outOfBudget()) { out.items.push({ key: key, status: 'failed', reason: '剩余额度不够发这一次调用了，这张票的边这次没动：带同样参数再调一次即可。' }); continue }
          if (job.parentKey !== undefined && job.parentKey !== null) {
            const r = await applyParentEdge(t, repo, opCtx, key, String(job.parentKey))
            out.items.push(r.item)
            if (r.applied) { out.done += 1; out.touched.push(key) }
          }
          if (job.blockedBy !== undefined && job.blockedBy !== null) {
            if (out.readback) {
              // 同一票号的阻塞边已按合并后的完整集合写过并读回过，这一重复项不再重写，
              // 按当时的读回结果为它自己的目标逐个补明细（写失败时同样逐个补失败）。
              for (const target of asList(job.blockedBy)) {
                const hit = !out.readback.failed && out.readback.landed.indexOf(target) >= 0
                const e2 = out.readback.failed ? out.readback.failed
                  : hit ? classifyEdgeLanding('block', target, out.readback.after)
                  : { kind: 'unknown', ok: false, text: '写后读回：这条依赖没出现在票上（要 ' + target + '，读回来 ' + (out.readback.landed.join('、') || '空') + '）' }
                out.items.push(Object.assign({ key: key, status: hit ? 'ok' : 'failed' }, edgeEvidence('block', target, e2)))
                if (e2.ok) { out.done += 1; out.touched.push(key) }
              }
            } else {
              const want = mergedBlocked.get(key) || asList(job.blockedBy)
              const r = await applyBlockEdges(t, repo, opCtx, key, want, asList(job.blockedBy))
              if (r.failed) {
                out.items.push(Object.assign({ key: key, status: 'failed' }, edgeEvidence('block', want.join('、'), r.failed)))
                out.readback = { landed: [], after: { issue: null, dependencies: null }, failed: r.failed }
              } else {
                for (const item of r.items) {
                  out.items.push(item)
                  if (item.status === 'ok') { out.done += 1; out.touched.push(key) }
                }
                const extra = r.landed.filter((k) => want.indexOf(k) < 0)
                if (extra.length) out.notes.push('票 ' + key + ' 上还有计划外的阻塞边：' + extra.join('、') + '（setBlockedBy 是整批替换，后端却留下了它们，读回来核对一次）。')
                out.readback = { landed: r.landed, after: r.after, failed: null }
              }
            }
          }
        }
        return out
      }))
      for (const r of perKey) {
        for (const i of r.items) items.push(i)
        for (const n of r.notes) notes.push(n)
        for (const k of r.touched) touched.push(k)
        done += r.done
      }
      const status = statusOfItems(items)
      if (status !== DECK_STATUS.OK) notes.push('有几条边没建成，逐条原因在上面的 items 里：别把它们当成已经建好。')
      // #790：顶层一句话要带失败摘要，不只报计数。原因原文仍在逐条 items 的 evidence 里，这里只摘要。
      let text = '这次要补 ' + items.length + ' 条边，建成 ' + done + ' 条。'
      const failed = items.filter((i) => i && i.status !== 'ok')
      if (failed.length) {
        const sums = failed.map((i) => {
          const t = String((i && i.target) || '')
          const e = String((i && i.evidence) || (i && i.reason) || '')
          return String((i && i.key) || '?') + '→' + t + '：' + e.slice(0, 120)
        })
        text += '失败 ' + failed.length + ' 条：' + sums.join('；').slice(0, 800)
      }
      return {
        value: {
          status: status,
          reason: status === DECK_STATUS.OK ? '' : REFUSAL_REASONS.BACKEND_UNSUPPORTED,
          text: text,
          data: { requested: items.length, done: done, jobs: jobs },
          items: items,
          notes: notes,
          touched: touched,
        },
        claimed: { requests: est.requests, points: est.points },
      }
    })
  }

  return { definition: definition, run: run }
}
