// src/host/tools/deckIssueCreate.js —— deck_issue_create（#713 第六批）
//
// 建一张票。三件小事由代码保证，不靠 AI 记得：
//   1. 必备标签（按种类：地图 wayfinder:map、任务 wayfinder:task、缺陷 bug + needs-triage）缺就补，
//      补没补上按结果说 —— 只读仓库上没挂上时不说“补了”，按部分成功回并写清原因（#992）；
//   2. 进度区（地图补五个区块，别的票补一个「## 进度」）；
//   3. 创建幂等锚（#711 的契约字段 idempotencyKey）：同一个会话、同一个标题、同一批标签在 5 分钟窗口里
//      重复调一次，契约层按锚回查，复用同一张票 —— 重试不会重复花钱，也不会多出票。
//
// 返回值就是**写后的真状态**（契约 create 回的那张票），AI 不必再读一次确认。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import { sessionContextOfAsync } from '../../shared/deck-tools/session-resolve.js'
import { classifyEdgeLanding, unsupportedEvidence, edgeEvidence } from '../../shared/deck-tools/edges.js'
import { withCallScope } from '../../shared/deck-tools/call-scope.js'
import { ensureLabels, ensureBody, anchorKeyFor } from '../../shared/deck-tools/plan.js'
import * as budget from '../../shared/refresh/budget.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'

function numOpt(v) { return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : undefined }
function withCap(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).then(function (v) { return { ok: true, value: v } }, function () { return { ok: false } }),
    new Promise(function (resolve) { setTimeout(function () { resolve({ ok: false, timedOut: true }) }, ms) }),
  ])
}
const SANDBOX_TIMEOUT_MS = 5000
const HOOK_TIMEOUT_MS = 5000
// 执行层失败（抛错/超时/中止/预算耗尽）与后端诚实失败的分界：前者在进壳之前会直接抛到
// 壳的统一出口（reason=backend-threw，可重试），后者走逐项的 BACKEND_UNSUPPORTED（能力缺失，
// 不当成 transient 重试）。壳外新加的钳制不能把前者改判成后者，否则 AI 会放弃重试。
const TRANSPORT_KINDS = ['backend-threw', 'timeout', 'aborted', 'over-budget']
function transportMessage(result) {
  const e = result && result.error
  if (e && TRANSPORT_KINDS.indexOf(e.kind) >= 0) return String(e.message || '执行层没回来')
  return null
}

export const definition = {
  name: 'deck_issue_create',
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。建一个 ISSUE（map / task / bug），自动补必备 label 与 progress 区，重复调用按锚复用同一张。',
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
      effortId: { type: 'string', description: '只有本地后端需要填，填票所在的目录名，根目录的不填' },
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
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    if (!s.ok) return shell.unsupported('deck_issue_create', s.reason, s.text, { cost: { estimated: est } })
    if (!title) return shell.unsupported('deck_issue_create', REFUSAL_REASONS.BAD_ARGS, '要建哪一张票：title 不能空。', { cost: { estimated: est } })

    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) return shell.unsupported('deck_issue_create', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    const effortId = (a.effortId === undefined || a.effortId === null) ? '' : String(a.effortId).trim()
    if (effortId) repo.effortId = effortId

    const ensured = ensureLabels(a.labels, kind)
    const body = ensureBody(a.body, kind)
    const now = (typeof d.now === 'function') ? d.now() : Date.now()
    const anchor = a.idempotencyKey ? String(a.idempotencyKey) : anchorKeyFor({ tool: 'deck_issue_create', sessionId: s.sessionId, workspaceKey: s.workspaceKey, title: title, labels: ensured.labels, now: now })
    let sandbox = null
    try {
      if (typeof d.sandboxPolicyFor === 'function') {
        const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), SANDBOX_TIMEOUT_MS)
        sandbox = (raced && raced.ok === true) ? raced.value : null
      }
    } catch (eS) { sandbox = null }

    return shell.call({ tool: 'deck_issue_create', kind: 'write', session: s, pick: pick, repo: repo, estimate: est, sandbox: sandbox }, async (c) => {
      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), now: (typeof d.now === 'function') ? d.now : Date.now })
      const t = sc.tracker
      const opCtx = sc.opCtx
      const rel = (a.parentKey === undefined || a.parentKey === null || a.parentKey === '') ? null : String(a.parentKey)
      const input = { title: title, body: body.body, type: kind, labels: ensured.labels, idempotencyKey: anchor }
      if (rel) input.parentKey = rel
      if (Array.isArray(a.assignees) && a.assignees.length) input.assignees = a.assignees
      const created = await t.create(repo, input, opCtx)
      // 执行层失败原样抛给壳（走 backend-threw，可重试）；后端诚实失败才走下面的部分成功。
      const createdTransport = transportMessage(created)
      if (createdTransport) throw new Error(createdTransport)
      const notes = []
      if (effortId) notes.push('这次带了 effortId（' + effortId.slice(0, 60) + '）：本地后端只在那一个目录里找，远端后端忽略它。')
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
      // #992：标签没挂上（后端在票上记了 labelError）不再报“补了”——按结果说话。
      //   幂等锚的取值保持不动（改它会动去重语义，另议）。
      const labelFailed = !!(issue && issue.labelError)
      const labelWhy = labelFailed ? String((issue.labelError && issue.labelError.message) || '后端没给出原因').slice(0, 300) : ''
      if (ensured.added.length && !labelFailed) notes.push('我替你补了必备标签：' + ensured.added.join('、'))
      if (labelFailed) notes.push('标签没挂上，别把它当成已经打上：逐条原因在同包的 items 里。')
      // #746：建票直达命名守护（调用会话即建号会话；hook 缺失、失败或超时都不影响已建成的返回）。
      try {
        if (typeof d.onTicketCreated === 'function' && issue.key) {
          const raced = await withCap(d.onTicketCreated({ sessionId: s.sessionId, key: String(issue.key), title: title }), HOOK_TIMEOUT_MS)
          void raced
        }
      } catch (eHook) {}
      const items = []
      let parentLanded = true
      let parentEvidence = null
      if (rel) {
        // 父子边：写入已在 create 里做过（contract 的 parentKey 输入），这里只判它落在哪一列。
        // #790：classify 的 ok 只表示“判出来了”，未知也回 true；必须按读回的 parentKey 是否等于目标判。
        const readBack = (typeof t.get === 'function' && !sc.outOfBudget()) ? await t.get(repo, issue.key, {}, opCtx) : null
        const after = (readBack && readBack.ok === true) ? { issue: readBack.data } : null
        const ev = after ? classifyEdgeLanding('parent', rel, after) : unsupportedEvidence('写后没读回来，判不了这条父子落点')
        parentEvidence = ev
        const landedKey = (after && after.issue && after.issue.parentKey !== undefined && after.issue.parentKey !== null) ? String(after.issue.parentKey) : ''
        // 建票时 tracker.create 回来的票自带 parentKey 时也认（读回抖动时不误报失败）。
        const createdKey = (issue && issue.parentKey !== undefined && issue.parentKey !== null) ? String(issue.parentKey) : ''
        parentLanded = (landedKey === String(rel)) || (createdKey === String(rel)) || ((ev && ev.kind) === 'body-line')
        if (ev && ev.kind === 'unsupported') parentLanded = false
        items.push(Object.assign({ key: issue.key, edge: { op: 'parent', target: rel }, status: parentLanded ? 'ok' : 'failed' }, edgeEvidence('parent', rel, ev)))
      }
      if (rel && !parentLanded) {
        // 票建成了、边没挂上：按部分成功回，不再报“建好了（父票 X）”。
        const why = String((parentEvidence && parentEvidence.text) || '后端没给出原因').slice(0, 300)
        notes.push('父子边没建成，别把它当成已经挂上：逐条原因在上面的 items 里。')
        if (labelFailed) items.push({ key: issue.key, step: 'labels', status: 'failed', reason: labelWhy })
        return {
          value: {
            status: DECK_STATUS.PARTIAL,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '票 ' + (issue.key || '（后端没回票号）') + ' 建好了：' + title + '。父子边没挂上（要 ' + rel + '）：' + why
              + (labelFailed ? '标签也没挂上：' + labelWhy : ''),
            data: { ticket: issue, kind: kind, idempotencyKey: anchor, limits: { maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL } },
            items: items,
            notes: notes,
            touched: issue.key ? [String(issue.key)] : [],
          },
          claimed: { requests: 3, points: 6 },
        }
      }
      if (labelFailed) {
        // 票建成了、标签没挂上：按部分成功回（照父子边没挂上的 PARTIAL 先例），不再报“我替你补了”。
        items.push({ key: issue.key, step: 'labels', status: 'failed', reason: labelWhy })
        return {
          value: {
            status: DECK_STATUS.PARTIAL,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '票 ' + (issue.key || '（后端没回票号）') + ' 建好了：' + title + '。标签没挂上：' + labelWhy,
            data: { ticket: issue, kind: kind, idempotencyKey: anchor, limits: { maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL } },
            items: items,
            notes: notes,
            touched: issue.key ? [String(issue.key)] : [],
          },
          claimed: { requests: 3, points: 6 },
        }
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
