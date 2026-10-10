// src/host/tools/deckIssueList.js —— deck_issue_list（全局薄列表，补七个工具没有的那一块）
//
// 为什么需要它：deck_context 只给地图清单，deck_map_snapshot 要逐张地图传 key 才给子票，
// 全仓开放清单、按 label 与 assignee 筛这两件事原来只能走 gh。这一只走同一只壳、同一道闸、
// 同一个账（读一档），薄行不回正文与评论，调用方按需再用 deck_issue_get 读全文。
//
// 过滤口径：state 与 type 交给后端 filter（全选就省略）；label（AND）、assignee、query
// 在内存里再筛一遍 —— GitHub 房的列表查询本来就是批量取回内存筛（见 backends/github/queries.js
// 的 LIST_QUERY 注释），三后端行为一致，不逐后端写分支。顺序沿用后端原序，不重排。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import { sessionContextOfAsync } from '../../shared/deck-tools/session-resolve.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'
import { withCallScope } from '../../shared/deck-tools/call-scope.js'

export const definition = {
  name: 'deck_issue_list',
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。按状态、label、assignee 与关键词列出 ISSUE 薄行，不回正文与评论。',
  parameters: {
    type: 'object',
    properties: {
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: '只列哪种状态，缺省 open' },
      type: { type: 'string', enum: ['issue', 'map', 'all'], description: '只列哪种类型，缺省 all' },
      labels: { type: 'array', items: { type: 'string' }, description: '必须同时带上这些 label（AND），缺省不过滤' },
      assignee: { type: 'string', description: '只留认领含此人的行，缺省不过滤' },
      query: { type: 'string', description: '标题与正文的子串过滤，缺省不过滤' },
      limit: { type: 'number', description: '最多回几行，缺省 50，上限 200' },
      effortId: { type: 'string', description: '只有本地后端需要填，填票所在的目录名，根目录的不填' },
    },
    required: [],
    additionalProperties: false,
  },
}

function namesOf(list, pick) {
  if (!Array.isArray(list)) return []
  return list.map((l) => {
    if (typeof l === 'string') return l
    if (l && typeof l === 'object') {
      const v = pick(l)
      return v === undefined || v === null ? '' : String(v)
    }
    return ''
  }).map((s) => String(s).trim()).filter(Boolean)
}

function labelNames(list) { return namesOf(list, (l) => l.name) }
function assigneeNames(list) { return namesOf(list, (a) => (a && a.login) || '') }

// 沙箱许可等待上限：超时按缺席走老路（不限权），与既有 catch null 同形。
function withCap(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).then(function (v) { return { ok: true, value: v } }, function () { return { ok: false } }),
    new Promise(function (resolve) { setTimeout(function () { resolve({ ok: false, timedOut: true }) }, ms) }),
  ])
}
const SANDBOX_TIMEOUT_MS = 5000

function isMapRow(issue) {  try {
    if (!issue || typeof issue !== 'object') return false
    if (issue.type === 'map' || issue.isMap === true) return true
    const labs = labelNames(issue.labels).map((s) => s.toLowerCase())
    return labs.indexOf('wayfinder:map') >= 0
  } catch (e) { return false }
}

export function createDeckIssueList(deps) {
  const d = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  async function run(exec, args) {
    const a = args || {}
    const rawState = String(a.state === undefined || a.state === null ? 'open' : a.state).trim().toLowerCase()
    const state = (rawState === 'closed' || rawState === 'all') ? rawState : 'open'
    const rawType = String(a.type === undefined || a.type === null ? 'all' : a.type).trim().toLowerCase()
    const type = (rawType === 'issue' || rawType === 'map') ? rawType : 'all'
    const wantLabels = (Array.isArray(a.labels) ? a.labels : []).map((x) => String(x).trim()).filter(Boolean)
    const wantAssignee = String(a.assignee === undefined || a.assignee === null ? '' : a.assignee).trim().toLowerCase()
    const wantQuery = String(a.query === undefined || a.query === null ? '' : a.query).trim().toLowerCase()
    const limit = Math.max(1, Math.min(200, Number(a.limit) > 0 ? Math.floor(Number(a.limit)) : 50))
    const est = shell.estimateFor('deck_issue_list', a)
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    if (!s.ok) return shell.unsupported('deck_issue_list', s.reason, s.text, { cost: { estimated: est } })

    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) return shell.unsupported('deck_issue_list', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    const effortId = (a.effortId === undefined || a.effortId === null) ? '' : String(a.effortId).trim()
    if (effortId) repo.effortId = effortId

    const callerSignal = (exec && exec.signal && typeof exec.signal === 'object') ? exec.signal : undefined
    let sandbox = null
    try {
      if (typeof d.sandboxPolicyFor === 'function') {
        const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), SANDBOX_TIMEOUT_MS)
        sandbox = (raced && raced.ok === true) ? raced.value : null
      }
    } catch (eS) { sandbox = null }

    return shell.call({ tool: 'deck_issue_list', kind: 'read', session: s, pick: pick, repo: repo, estimate: est, sandbox: sandbox, signal: callerSignal }, async (c) => {
      const sc = withCallScope(c, exec, { timeoutMs: undefined, marginMs: undefined, now: (typeof d.now === 'function') ? d.now : Date.now })
      const t = sc.tracker
      const opCtx = sc.opCtx
      const filter = {}
      if (state !== 'all') filter.state = state
      if (type !== 'all') filter.type = type
      const listed = await t.list(repo, filter, opCtx)
      if (!listed || listed.ok !== true) {
        const msg = String((listed && listed.error && listed.error.message) || '后端没给出原因').slice(0, 300)
        return {
          value: {
            status: DECK_STATUS.UNSUPPORTED,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: 'ISSUE 列表没取回来（后端原话：' + msg + '）。',
            data: { error: { kind: String((listed && listed.error && listed.error.kind) || ''), message: msg } },
          },
          claimed: { requests: 1, points: 3 },
        }
      }
      const rows = Array.isArray(listed.data) ? listed.data : []
      const wantLabelLow = wantLabels.map((x) => x.toLowerCase())
      const matched = []
      for (const issue of rows) {
        if (!issue || typeof issue !== 'object') continue
        // type 在内存里再判一次：后端可能忽略它（契约只保证它透传，不过滤包容）。
        if (type !== 'all') {
          const isMap = isMapRow(issue)
          if (type === 'map' && !isMap) continue
          if (type === 'issue' && isMap) continue
        }
        if (wantLabelLow.length) {
          const have = labelNames(issue.labels).map((x) => x.toLowerCase())
          let hit = true
          for (const w of wantLabelLow) if (have.indexOf(w) < 0) { hit = false; break }
          if (!hit) continue
        }
        if (wantAssignee) {
          const have = assigneeNames(issue.assignees).map((x) => x.toLowerCase())
          if (have.indexOf(wantAssignee) < 0) continue
        }
        if (wantQuery) {
          const hay = String(issue.title || '') + '\n' + String(issue.body || '')
          if (hay.toLowerCase().indexOf(wantQuery) < 0) continue
        }
        matched.push({
          key: issue.key,
          title: issue.title,
          state: issue.state,
          type: issue.type || (isMapRow(issue) ? 'map' : 'issue'),
          labels: labelNames(issue.labels),
          assignees: assigneeNames(issue.assignees),
          updatedAt: issue.updatedAt || '',
          url: issue.url || '',
          effortId: issue.effortId !== undefined ? issue.effortId : '',
          parentKey: issue.parentKey !== undefined ? issue.parentKey : null,
        })
      }
      const total = matched.length
      const sliced = matched.slice(0, limit)
      const truncated = total > sliced.length
      const cond = []
      cond.push('state=' + state)
      if (type !== 'all') cond.push('type=' + type)
      if (wantLabels.length) cond.push('label=' + wantLabels.join('&'))
      if (wantAssignee) cond.push('assignee=' + String(a.assignee).trim())
      if (wantQuery) cond.push('query=' + String(a.query).trim().slice(0, 40))
      const notes = []
      if (effortId) notes.push('这次带了 effortId（' + effortId.slice(0, 60) + '）：本地后端只在那一个目录里找，远端后端忽略它。')
      if (truncated) notes.push('只回前 ' + sliced.length + ' 行（共 ' + total + ' 行符合）：收窄过滤或调大 limit 再取一次。')
      return {
        value: {
          status: DECK_STATUS.OK,
          text: 'ISSUE 列表：共 ' + total + ' 行符合（' + cond.join('，') + '），回 ' + sliced.length + ' 行。',
          data: { total: total, returned: sliced.length, truncated: truncated, issues: sliced },
          notes: notes,
          touched: [],
        },
        claimed: { requests: 2, points: 5 },
      }
    })
  }

  return { definition: definition, run: run }
}
