// src/host/tools/deckIssueCreate.js —— deck_issue_create（#713 第六批）
//
// 建一张票。三件小事由代码保证，不靠 AI 记得：
//   1. 必备标签（按种类：地图 wayfinder:map、任务 wayfinder:task、缺陷 bug + needs-triage）缺就补，返回值里
//      写明「我替你加了什么」；
//   2. 进度区（地图补五个区块，别的票补一个「## 进度」）；
//   3. 创建幂等锚（#711 的契约字段 idempotencyKey）：同一个会话、同一个标题、同一批标签在 5 分钟窗口里
//      重复调一次，契约层按锚回查，复用同一张票 —— 重试不会重复花钱，也不会多出票。
//
// 返回值就是**写后的真状态**（契约 create 回的那张票），AI 不必再读一次确认。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import { classifyEdgeLanding, unsupportedEvidence, edgeEvidence } from '../../shared/deck-tools/edges.js'
import { ensureLabels, ensureBody, anchorKeyFor } from '../../shared/deck-tools/plan.js'
import * as budget from '../../shared/refresh/budget.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'

export const definition = {
  name: 'deck_issue_create',
  description: '建一张票（地图 / 任务 / 缺陷），自动补必备标签与进度区，重复调用按锚复用同一张票。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '票的标题' },
      body: { type: 'string', description: '正文；缺省时按种类补最小骨架' },
      kind: { type: 'string', enum: ['task', 'bug', 'map'], description: '票的种类，缺省 task' },
      parentKey: { type: 'string', description: '父票（一般是地图那张票）的票号' },
      labels: { type: 'array', items: { type: 'string' }, description: '要带的标签，会在必备标签之外追加' },
      assignees: { type: 'array', items: { type: 'string' }, description: '认领人' },
      idempotencyKey: { type: 'string', description: '这一批写的幂等锚，重试时带同一个值' },
    },
    required: ['title'],
    additionalProperties: false,
  },
}

function kindOf(a) {
  const k = String((a && a.kind) || 'task').trim()
  return (k === 'map' || k === 'bug') ? k : 'task'
}

export function createDeckIssueCreate(deps) {
  const d = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  async function run(exec, args) {
    const a = args || {}
    const title = String(a.title === undefined || a.title === null ? '' : a.title).trim()
    const kind = kindOf(a)
    const est = shell.estimateFor('deck_issue_create', a)
    const s = shell.context(exec)
    if (!s.ok) return shell.unsupported('deck_issue_create', s.reason, s.text, { cost: { estimated: est } })
    if (!title) return shell.unsupported('deck_issue_create', REFUSAL_REASONS.BAD_ARGS, '要建哪一张票：title 不能空。', { cost: { estimated: est } })

    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) return shell.unsupported('deck_issue_create', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)

    const ensured = ensureLabels(a.labels, kind)
    const body = ensureBody(a.body, kind)
    const now = (typeof d.now === 'function') ? d.now() : Date.now()
    const anchor = a.idempotencyKey ? String(a.idempotencyKey) : anchorKeyFor({ tool: 'deck_issue_create', sessionId: s.sessionId, workspaceKey: s.workspaceKey, title: title, labels: ensured.labels, now: now })

    return shell.call({ tool: 'deck_issue_create', kind: 'write', session: s, pick: pick, repo: repo, estimate: est }, async (c) => {
      const rel = (a.parentKey === undefined || a.parentKey === null || a.parentKey === '') ? null : String(a.parentKey)
      const input = { title: title, body: body.body, type: kind, labels: ensured.labels, idempotencyKey: anchor }
      if (rel) input.parentKey = rel
      if (Array.isArray(a.assignees) && a.assignees.length) input.assignees = a.assignees
      const created = await c.tracker.create(repo, input, c.opCtx)
      const notes = []
      if (ensured.added.length) notes.push('我替你补了必备标签：' + ensured.added.join('、'))
      if (body.added.length) notes.push('我替你补了正文区块：' + body.added.join('、'))
      if (!a.idempotencyKey) notes.push('这次用的是自动幂等锚（同会话 + 同标题 + 同标签，5 分钟窗口内重复调用复用同一张票）。')
      if (!created || created.ok !== true) {
        const msg = String((created && created.error && created.error.message) || '后端没给出原因').slice(0, 300)
        return {
          value: { status: DECK_STATUS.UNSUPPORTED, reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED, text: '这张票没建成（后端原话：' + msg + '）。', data: { error: { kind: String((created && created.error && created.error.kind) || ''), message: msg } }, notes: notes },
          claimed: { requests: 1, points: 4 },
        }
      }
      const issue = created.data || {}
      const items = []
      if (rel) {
        // 父子边：写入已在 create 里做过（contract 的 parentKey 输入），这里只判它落在哪一列。
        const readBack = typeof c.tracker.get === 'function' ? await c.tracker.get(repo, issue.key, {}, c.opCtx) : null
        const after = (readBack && readBack.ok === true) ? { issue: readBack.data } : null
        const ev = after ? classifyEdgeLanding('parent', rel, after) : unsupportedEvidence('写后没读回来，判不了这条父子落点')
        items.push(Object.assign({ key: issue.key, edge: { op: 'parent', target: rel }, status: ev.ok === false ? 'failed' : 'ok' }, edgeEvidence('parent', rel, ev)))
      }
      return {
        value: {
          status: DECK_STATUS.OK,
          text: '票 ' + (issue.key || '（后端没回票号）') + ' 建好了：' + title + (rel ? '（父票 ' + rel + '）' : '') + '。返回值就是写后的真状态，不必再读一次。',
          data: { ticket: issue, kind: kind, idempotencyKey: anchor, limits: { maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL } },
          items: items,
          notes: notes,
          touched: issue.key ? [String(issue.key)] : [],
        },
        claimed: { requests: rel ? 3 : 2, points: rel ? 6 : 4 },
      }
    })
  }

  return { definition: definition, run: run }
}
