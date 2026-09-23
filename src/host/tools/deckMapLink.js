// src/host/tools/deckMapLink.js —— deck_map_link（#713 第六批）
//
// 给**已经存在**的票补边或改边：父子和阻塞两种，逐条做、逐条校验。
// 「每条边在返回里标出落点」就落在这里：写完之后读回一次那张票，按它自己的结构字段与正文判，
// 判不出来就说「说不好」，绝不默认写成「原生层级」（判据与反证方向见 shell.js 的 classifyEdgeLanding）。
// 校验用计数：改完按父票列一遍子票 / 再读一次依赖，把「要几条、实际几条」对一次，对不上就说 partial。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import { classifyEdgeLanding, unsupportedEvidence, edgeEvidence, statusOfItems } from '../../shared/deck-tools/edges.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'

export const definition = {
  name: 'deck_map_link',
  description: '给已经存在的票补父子或阻塞边，写完读回一次并逐条标出这条边落在哪一列。',
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

    return shell.call({ tool: 'deck_map_link', kind: 'write', session: s, pick: pick, repo: repo, estimate: est }, async (c) => {
      const items = []
      const notes = []
      const touched = []
      let done = 0
      for (const job of jobs) {
        const key = String(job.key || '').trim()
        if (!key) { items.push({ key: '', status: 'failed', reason: 'edges 里有一项没写 key。' }); continue }
        if (job.parentKey !== undefined && job.parentKey !== null) {
          const want = String(job.parentKey)
          const written = await c.tracker.setParent(repo, key, want, {}, c.opCtx)
          let ev = null
          if (written && written.ok === true) {
            const back = typeof c.tracker.get === 'function' ? await c.tracker.get(repo, key, {}, c.opCtx) : null
            ev = classifyEdgeLanding('parent', want, { issue: (back && back.ok === true) ? back.data : null })
            if (ev.ok) { done += 1; touched.push(key) }
          } else {
            ev = unsupportedEvidence(String((written && written.error && written.error.message) || '后端没给出原因').slice(0, 200))
          }
          items.push(Object.assign({ key: key, status: written && written.ok === true && ev.ok ? 'ok' : 'failed' }, edgeEvidence('parent', want, ev)))
        }
        if (job.blockedBy !== undefined && job.blockedBy !== null) {
          const want = asList(job.blockedBy)
          const written = await c.tracker.setBlockedBy(repo, key, want, {}, c.opCtx)
          let ev = null
          if (written && written.ok === true) {
            const back = typeof c.tracker.get === 'function' ? await c.tracker.get(repo, key, {}, c.opCtx) : null
            const dep = typeof c.tracker.getDependencies === 'function' ? await c.tracker.getDependencies(repo, key, {}, c.opCtx) : null
            const after = { issue: (back && back.ok === true) ? back.data : null, dependencies: (dep && dep.ok === true) ? dep.data : null }
            // 逐条判：要几条、读回来几条，逐项列出来（不是只回一个总数）。
            const landed = asList(after.dependencies && after.dependencies.blockedBy ? after.dependencies.blockedBy.map((r) => (r && r.key) || r) : (after.issue && after.issue.blockedBy) || [])
            for (const target of want) {
              const hit = landed.indexOf(target) >= 0
              const e2 = hit ? classifyEdgeLanding('block', target, after) : { kind: 'unknown', ok: false, text: '写后读回：这条依赖没出现在票上（要 ' + target + '，读回来 ' + (landed.join('、') || '空') + '）' }
              items.push(Object.assign({ key: key, status: hit ? 'ok' : 'failed' }, edgeEvidence('block', target, e2)))
              if (e2.ok) { done += 1; touched.push(key) }
            }
            const extra = landed.filter((k) => want.indexOf(k) < 0)
            if (extra.length) notes.push('票 ' + key + ' 上还有计划外的阻塞边：' + extra.join('、') + '（setBlockedBy 是整批替换，后端却留下了它们，读回来核对一次）。')
          } else {
            items.push(Object.assign({ key: key, status: 'failed' }, edgeEvidence('block', want.join('、'), unsupportedEvidence(String((written && written.error && written.error.message) || '后端没给出原因').slice(0, 200)))))
          }
        }
      }
      const status = statusOfItems(items)
      if (status !== DECK_STATUS.OK) notes.push('有几条边没建成，逐条原因在上面的 items 里：别把它们当成已经建好。')
      return {
        value: {
          status: status,
          reason: status === DECK_STATUS.OK ? '' : REFUSAL_REASONS.BACKEND_UNSUPPORTED,
          text: '这次要补 ' + items.length + ' 条边，建成 ' + done + ' 条。',
          data: { requested: jobs.length, done: done, jobs: jobs },
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
