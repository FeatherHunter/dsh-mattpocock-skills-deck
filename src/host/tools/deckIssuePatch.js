// src/host/tools/deckIssuePatch.js —— deck_issue_patch（#713 第六批）
//
// 一次调用改一张票：评论 / 标签流转 / 认领 / 关闭重开 / 标题正文 / 进度区。
// 只做调用方点名的那几件事，没点名的字段一个字都不碰（改票最怕「顺手改了别的东西」）。
// 做完的每一步都单独记一条 item：哪一步成、哪一步没成、后端原话是什么。
// 返回值就是写后的真状态（能读回就读回一次），AI 不必再读一次确认。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import { statusOfItems } from '../../shared/deck-tools/edges.js'
import { ensureBody } from '../../shared/deck-tools/plan.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'

export const definition = {
  name: 'deck_issue_patch',
  description: '改一张票：评论、标签、认领、关闭重开、标题正文、进度区，一次调用只动点名的那些。',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '要改的那张票' },
      comment: { type: 'string', description: '要发的评论正文' },
      addLabels: { type: 'array', items: { type: 'string' }, description: '要加的标签' },
      removeLabels: { type: 'array', items: { type: 'string' }, description: '要摘掉的标签' },
      assignees: { type: 'array', items: { type: 'string' }, description: '认领人（整批替换；给空数组就是取掉认领）' },
      title: { type: 'string', description: '新的标题' },
      body: { type: 'string', description: '新的正文' },
      progress: { type: 'string', description: '只改「## 进度」那一段的内容' },
      close: { type: 'boolean', description: 'true 关闭这张票，false 重新打开' },
    },
    required: ['key'],
    additionalProperties: false,
  },
}

function names(list) {
  return Array.isArray(list) ? list.map((l) => (typeof l === 'string' ? l : (l && l.name) || '')).map((s) => String(s).trim()).filter(Boolean) : []
}

/** 只替换「## 进度」那一段：前面的正文与后面的其它区块原样保留。 */
export function replaceProgressSection(body, text) {
  const src = typeof body === 'string' ? body : ''
  const block = '## 进度\n\n' + String(text === undefined || text === null ? '' : text).replace(/\s*$/, '') + '\n'
  const re = /^##\s*进度\s*$[\s\S]*?(?=^##\s|\s*$)/m
  if (re.test(src)) return src.replace(re, block)
  return (src.replace(/\s*$/, '') + '\n\n' + block).replace(/^\n+/, '')
}

export function createDeckIssuePatch(deps) {
  const d = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  async function run(exec, args) {
    const a = args || {}
    const key = String(a.key === undefined || a.key === null ? '' : a.key).trim()
    const est = shell.estimateFor('deck_issue_patch', a)
    const s = shell.context(exec)
    if (!s.ok) return shell.unsupported('deck_issue_patch', s.reason, s.text, { cost: { estimated: est } })
    if (!key) return shell.unsupported('deck_issue_patch', REFUSAL_REASONS.BAD_ARGS, '要改哪一张票：把票号写在 key 里。', { cost: { estimated: est } })
    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) return shell.unsupported('deck_issue_patch', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)

    const addLabels = names(a.addLabels)
    const removeLabels = names(a.removeLabels)
    const wants = {
      comment: typeof a.comment === 'string' && a.comment.trim() !== '',
      labels: addLabels.length > 0 || removeLabels.length > 0,
      assignees: Array.isArray(a.assignees),
      text: typeof a.title === 'string' || typeof a.body === 'string' || typeof a.progress === 'string',
      state: typeof a.close === 'boolean',
    }
    if (!wants.comment && !wants.labels && !wants.assignees && !wants.text && !wants.state) {
      return shell.unsupported('deck_issue_patch', REFUSAL_REASONS.BAD_ARGS, '这次没说清要改什么：至少点名一件（comment / addLabels / removeLabels / assignees / title / body / progress / close）。', { cost: { estimated: est } })
    }

    return shell.call({ tool: 'deck_issue_patch', kind: 'write', session: s, pick: pick, repo: repo, estimate: est }, async (c) => {
      const items = []
      const notes = []
      const touched = [key]
      const fail = (step, result) => {
        const msg = String((result && result.error && result.error.message) || '后端没给出原因').slice(0, 200)
        items.push({ key: key, step: step, status: 'failed', reason: msg })
      }

      if (wants.comment) {
        const r = await c.tracker.comment(repo, key, a.comment, c.opCtx)
        if (r && r.ok === true) items.push({ key: key, step: 'comment', status: 'ok' })
        else fail('comment', r)
      }

      if (wants.labels) {
        // 标签是整批替换：先读回当前标签，再加上去/摘下来 —— 只有读到了才敢整批替换。
        const cur = await c.tracker.get(repo, key, {}, c.opCtx)
        if (!cur || cur.ok !== true) fail('labels', cur)
        else {
          const have = names(cur.data && cur.data.labels)
          const want = have.concat(addLabels).filter((n) => removeLabels.indexOf(n) < 0)
          const uniq = want.filter((n, i) => want.indexOf(n) === i)
          const r = await c.tracker.setLabels(repo, key, uniq, {}, c.opCtx)
          if (r && r.ok === true) items.push({ key: key, step: 'labels', status: 'ok', labels: uniq })
          else fail('labels', r)
        }
      }

      if (wants.assignees) {
        const want = Array.isArray(a.assignees) ? a.assignees.map((x) => String(x)) : []
        const r = await c.tracker.setAssignees(repo, key, want, {}, c.opCtx)
        if (r && r.ok === true) {
          // 「回了 ok」不等于「认领人记上了」：本地 Markdown 只会把状态改成 claimed，认领人的名字不记。
          // 判据是读回来的票（后端的回答本身），不是后端是谁 —— 名字没出现在票上就如实说没记上。
          const back = (r.data && r.data.assignees) ? r.data : (typeof c.tracker.get === 'function' ? ((await c.tracker.get(repo, key, {}, c.opCtx)).data || {}) : {})
          const got = Array.isArray(back.assignees) ? back.assignees.map((x) => (x && x.login) || String(x)) : []
          const missing = want.filter((w) => got.indexOf(w) < 0)
          if (want.length && missing.length) {
            items.push({ key: key, step: 'assignees', status: 'failed', reason: '后端回了 ok，但读回来的票上没有这些认领人（' + missing.join('、') + '）：它可能只改了状态、没记认领人，别当成认领已经记上。' })
          } else items.push({ key: key, step: 'assignees', status: 'ok', assignees: want })
        } else if (r && r.error && r.error.kind === 'unsupported') {
          items.push({ key: key, step: 'assignees', status: 'failed', reason: '这个后端做不到记认领人（后端原话：' + String(r.error.message || '').slice(0, 160) + '）。' })
        } else fail('assignees', r)
      }

      if (wants.text) {
        const patch = {}
        if (typeof a.title === 'string') patch.title = a.title
        if (typeof a.body === 'string') patch.body = a.body
        if (typeof a.progress === 'string') {
          const cur = await c.tracker.get(repo, key, {}, c.opCtx)
          const base = (cur && cur.ok === true && typeof cur.data.body === 'string') ? cur.data.body : (typeof a.body === 'string' ? a.body : '')
          patch.body = replaceProgressSection(ensureBody(base, 'task').body, a.progress)
          if (typeof a.body === 'string') patch.body = replaceProgressSection(a.body, a.progress)
        }
        const r = await c.tracker.update(repo, key, patch, c.opCtx)
        if (r && r.ok === true) items.push({ key: key, step: 'text', status: 'ok', fields: Object.keys(patch) })
        else fail('text', r)
      }

      if (wants.state) {
        const r = a.close === true ? await c.tracker.close(repo, key, {}, c.opCtx) : await c.tracker.reopen(repo, key, c.opCtx)
        if (r && r.ok === true) items.push({ key: key, step: a.close === true ? 'close' : 'reopen', status: 'ok' })
        else fail(a.close === true ? 'close' : 'reopen', r)
      }

      // 写后真状态：能读回就读回一次，读不回来也如实说（别让 AI 以为已经确认过了）。
      const back = typeof c.tracker.get === 'function' ? await c.tracker.get(repo, key, {}, c.opCtx) : null
      const readBack = (back && back.ok === true) ? back.data : null
      if (!readBack) notes.push('写后没读回来（后端原话：' + String((back && back.error && back.error.message) || '没给出原因').slice(0, 160) + '）：上面每步是照后端的回答记的。')
      const status = statusOfItems(items)
      if (status !== DECK_STATUS.OK) notes.push('有的步骤没成，逐条原因在上面：别把没成的那一步当成已经改好。')
      return {
        value: {
          status: status,
          reason: status === DECK_STATUS.OK ? '' : REFUSAL_REASONS.BACKEND_UNSUPPORTED,
          text: '票 ' + key + '：这次点了 ' + items.length + ' 步，成了 ' + items.filter((i) => i.status === 'ok').length + ' 步。',
          data: { requested: Object.keys(wants).filter((k) => wants[k]), ticket: readBack },
          items: items,
          readBack: readBack,
          notes: notes,
          touched: touched,
        },
        claimed: { requests: est.requests, points: est.points },
      }
    })
  }

  return { definition: definition, run: run }
}
