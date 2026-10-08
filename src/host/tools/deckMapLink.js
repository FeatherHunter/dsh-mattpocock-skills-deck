// src/host/tools/deckMapLink.js —— deck_map_link（#713 第六批）
//
// 给**已经存在**的票补边或改边：父子和阻塞两种，逐条做、逐条校验。
// 「每条边在返回里标出落点」就落在这里：写完之后读回一次那张票，按它自己的结构字段与正文判，
// 判不出来就说「说不好」，绝不默认写成「原生层级」（判据与反证方向见 shell.js 的 classifyEdgeLanding）。
// 校验用计数：改完按父票列一遍子票 / 再读一次依赖，把「要几条、实际几条」对一次，对不上就说 partial。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import { classifyEdgeLanding, unsupportedEvidence, edgeEvidence, statusOfItems } from '../../shared/deck-tools/edges.js'
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
      const blockedDone = new Map()
      for (const job of jobs) {
        if (sc.outOfBudget()) {
          items.push({ key: String((job && job.key) || ''), status: 'failed', reason: '剩余额度不够发这一次调用了，这张票的边这次没动：带同样参数再调一次即可。' })
          continue
        }
        const key = String(job.key || '').trim()
        if (!key) { items.push({ key: '', status: 'failed', reason: 'edges 里有一项没写 key。' }); continue }
        if (job.parentKey !== undefined && job.parentKey !== null) {
          const want = String(job.parentKey)
          const written = await t.setParent(repo, key, want, {}, opCtx)
          let ev = null
          let landedOk = false
          if (written && written.ok === true) {
            const back = typeof t.get === 'function' ? await t.get(repo, key, {}, opCtx) : null
            const afterIssue = (back && back.ok === true) ? back.data : null
            const backError = (back && back.ok !== true && back.error && back.error.message) ? String(back.error.message).slice(0, 200) : ''
            ev = classifyEdgeLanding('parent', want, { issue: afterIssue })
            // #790：classify 的 ok 只表示“判出来了”，未知也回 true；必须按读回的 parentKey 是否等于目标判。
            // 正文兜底行（body-line）仍算落下，其余未知一律按没挂上处理，不再默认成功。
            const landedKey = (afterIssue && afterIssue.parentKey !== undefined && afterIssue.parentKey !== null) ? String(afterIssue.parentKey) : ''
            landedOk = (landedKey === String(want)) || ((ev && ev.kind) === 'body-line')
            if (landedOk) { done += 1; touched.push(key) }
            else if (ev && ev.kind !== 'unsupported') {
              // #829：读回本身失败（网络、配额、REST 降级丢 parent）时，不能只说“parentKey = 空”，
              // 必须把读失败的后端原话一起带出去，否则写成的边会被误报成没建成且无从查起。
              ev = backError
                ? { kind: 'unknown', ok: false, text: '写后读回失败：读票没成功（后端原话：' + backError + '）；写操作已回成功，边可能已建成但没确认。票的 parentKey 读到的是 ' + (landedKey || '空') + '，要的是 ' + want }
                : { kind: 'unknown', ok: false, text: '写后读回：票的 parentKey = ' + (landedKey || '空') + '，要的是 ' + want + '（这条父子没挂上）' }
            }
          } else {
            ev = unsupportedEvidence(String((written && written.error && written.error.message) || '后端没给出原因').slice(0, 200))
          }
          items.push(Object.assign({ key: key, status: landedOk ? 'ok' : 'failed' }, edgeEvidence('parent', want, ev)))
        }
        if (job.blockedBy !== undefined && job.blockedBy !== null) {
          const prev = blockedDone.get(key)
          if (prev) {
            // 同一票号的阻塞边已按合并后的完整集合写过并读回过，这一重复项不再重写，
            // 按当时的读回结果为它自己的目标逐个补明细（写失败时同样逐个补失败）。
            for (const target of asList(job.blockedBy)) {
              const hit = !prev.failed && prev.landed.indexOf(target) >= 0
              const e2 = prev.failed ? prev.failed
                : hit ? classifyEdgeLanding('block', target, prev.after)
                : { kind: 'unknown', ok: false, text: '写后读回：这条依赖没出现在票上（要 ' + target + '，读回来 ' + (prev.landed.join('、') || '空') + '）' }
              items.push(Object.assign({ key: key, status: hit ? 'ok' : 'failed' }, edgeEvidence('block', target, e2)))
              if (e2.ok) { done += 1; touched.push(key) }
            }
          } else {
            const want = mergedBlocked.get(key) || asList(job.blockedBy)
            const written = await t.setBlockedBy(repo, key, want, {}, opCtx)
            let ev = null
            if (written && written.ok === true) {
              const back = typeof t.get === 'function' ? await t.get(repo, key, {}, opCtx) : null
              const dep = typeof t.getDependencies === 'function' ? await t.getDependencies(repo, key, {}, opCtx) : null
              const after = { issue: (back && back.ok === true) ? back.data : null, dependencies: (dep && dep.ok === true) ? dep.data : null }
              // 逐条判：要几条、读回来几条，逐项列出来（不是只回一个总数）。
              // 这一项只为它自己声明的目标出明细，同一票号的其余目标由各自那一项出明细，
              // 共用这一次合并写的读回结果（明细数与调用形状一致，不重复计数）。
              const landed = asList(after.dependencies && after.dependencies.blockedBy ? after.dependencies.blockedBy.map((r) => (r && r.key) || r) : (after.issue && after.issue.blockedBy) || [])
              for (const target of asList(job.blockedBy)) {
                const hit = landed.indexOf(target) >= 0
                const e2 = hit ? classifyEdgeLanding('block', target, after) : { kind: 'unknown', ok: false, text: '写后读回：这条依赖没出现在票上（要 ' + target + '，读回来 ' + (landed.join('、') || '空') + '）' }
                items.push(Object.assign({ key: key, status: hit ? 'ok' : 'failed' }, edgeEvidence('block', target, e2)))
                if (e2.ok) { done += 1; touched.push(key) }
              }
              const extra = landed.filter((k) => want.indexOf(k) < 0)
              if (extra.length) notes.push('票 ' + key + ' 上还有计划外的阻塞边：' + extra.join('、') + '（setBlockedBy 是整批替换，后端却留下了它们，读回来核对一次）。')
              blockedDone.set(key, { landed: landed, after: after, failed: null })
            } else {
              ev = unsupportedEvidence(String((written && written.error && written.error.message) || '后端没给出原因').slice(0, 200))
              items.push(Object.assign({ key: key, status: 'failed' }, edgeEvidence('block', want.join('、'), ev)))
              blockedDone.set(key, { landed: [], after: { issue: null, dependencies: null }, failed: ev })
            }
          }
        }
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
