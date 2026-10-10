// src/host/tools/deckContext.js —— deck_context（#713 第六批）
//
// 这个工具回答一句话：我这是站在哪个工作区、哪个后端、哪个仓库上，初始化好了没有，
// 这个仓库现在有哪些地图。它同时也是「查重起点」——AI 要建票之前先看这里有哪些地图与票。
// 详细语义故意放在它的返回值里，别的六个工具的 description 只留一句话（描述会进所有会话的系统提示）。
//
// 拿不到的东西一律如实说：没有会话工作区、没有后端、后端不认这条路，都在返回值里写明。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import { sessionContextOfAsync } from '../../shared/deck-tools/session-resolve.js'
import { withCallScope } from '../../shared/deck-tools/call-scope.js'
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
// 执行层失败与后端诚实失败的分界（见 deckIssueCreate.js 同名注释）：前者抛给壳走
// backend-threw（可重试），后者走 PARTIAL/notes。钳制只管超时，不改判。
const TRANSPORT_KINDS = ['backend-threw', 'timeout', 'aborted', 'over-budget']
function transportMessage(result) {
  const e = result && result.error
  if (e && TRANSPORT_KINDS.indexOf(e.kind) >= 0) return String(e.message || '执行层没回来')
  return null
}

export const definition = {
  name: 'deck_context',
  description: '这是 dsh-mattpocock-skills-deck 插件提供的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo。你要创建、查看、更新 ISSUE，查看 map 与 progress 时，先调用 deck_context 一次，确认 workspace 与 backend；如果 repo 里的说法和这里写的不一样，以这里写的为准。如果 deck_context 返回这个 workspace 还没有选 backend，或拿不到 workspace，就说明本插件不适用这个 workspace，直接停下，不再调用其余 deck 开头的工具，后续怎么做由用户决定。',
  // 参数说明不进描述（描述会进所有会话的系统提示）：本工具不要参数，语义全在返回值里。
  parameters: { type: 'object', properties: {}, additionalProperties: false },
}

/** 一张地图在清单里长什么样（只放人需要的那几格，正文不进清单；票本身没有层级格，不带它——带空值整包会被外层拒收）。 */
function mapRow(issue) {
  return { key: issue.key, title: issue.title, state: issue.state, url: issue.url || '' }
}

export function createDeckContext(deps) {
  const d = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  async function run(exec, args) {
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    const est = shell.estimateFor('deck_context', args)
    if (!s.ok) return shell.unsupported('deck_context', s.reason, s.text, { cost: { estimated: est } })

    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) {
      // 没有后端也不是一次失败：工作区解析结果照样回给 AI（它要靠这个知道该在面板上选什么）。
      return shell.unsupported('deck_context', pick.reason, pick.text, {
        workspace: { root: s.cwd, key: s.workspaceKey, sessionId: s.sessionId, source: s.source },
        backend: { id: null, source: '' },
        repo: null,
        cost: { estimated: est },
      })
    }
    const repo = shell.repoOf(pick, s)
    const callerSignal = (exec && exec.signal && typeof exec.signal === 'object') ? exec.signal : undefined
    let sandbox = null
    try {
      if (typeof d.sandboxPolicyFor === 'function') {
        const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), SANDBOX_TIMEOUT_MS)
        sandbox = (raced && raced.ok === true) ? raced.value : null
      }
    } catch (eS) { sandbox = null }

    return shell.call({ tool: 'deck_context', kind: 'read', session: s, pick: pick, repo: repo, estimate: est, sandbox: sandbox, signal: callerSignal }, async (c) => {
      // 进预算壳 + 两路并行：预检与清单互相独立，之前串行要等两份慢调用，
      // 并行后只等较慢的那一份。回包的字段与 notes 顺序与之前一致。
      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), now: (typeof d.now === 'function') ? d.now : Date.now })
      const t = sc.tracker
      const opCtx = sc.opCtx
      const preP = (typeof t.preflight === 'function') ? t.preflight({ cwd: s.cwd }, opCtx) : Promise.resolve(null)
      const listP = t.list(repo, { type: 'map' }, opCtx)
      const pre = await preP
      const listed = await listP
      const preTransport = transportMessage(pre)
      if (preTransport) throw new Error(preTransport)
      const listedTransport = transportMessage(listed)
      if (listedTransport) throw new Error(listedTransport)
      const maps = (listed.ok && Array.isArray(listed.data)) ? listed.data.map(mapRow) : []
      const notes = []
      if (!listed.ok) notes.push('地图清单这次没取到（后端原话：' + String((listed.error && listed.error.message) || '').slice(0, 200) + '）。')
      if (pre && pre.ok === false) notes.push('环境预检没过（' + String((pre.error && pre.error.message) || '').slice(0, 200) + '）：票还是能读，写操作可能失败。')
      const status = listed.ok ? DECK_STATUS.OK : DECK_STATUS.PARTIAL
      return {
        value: {
          status: status,
          reason: listed.ok ? '' : REFUSAL_REASONS.BACKEND_UNSUPPORTED,
          text: '这里是 ' + s.cwd + '，后端 ' + pick.backendId + '（' + pick.source + '，用户手动选择 > 锚文件 > 自动识别），仓库 ' + (repo.refId || '（这个后端没有仓库标识）') + '，地图 ' + maps.length + ' 张。',
          data: {
            workspace: { root: s.cwd, key: s.workspaceKey, sessionId: s.sessionId, source: s.source },
            backend: { id: pick.backendId, source: pick.source, label: '' },
            repo: { backend: repo.backend, refId: repo.refId, name: repo.name, url: repo.url },
            initialized: pre ? pre.ok === true : null,
            preflight: pre ? { ok: pre.ok === true, message: String((pre.error && pre.error.message) || '').slice(0, 300) } : null,
            maps: maps,
            // 这一句是给 AI 的用法说明（描述只有路由，语义放这里）。
            howto: '写票之前先用本工具确认工作区与后端；建票用 deck_issue_create，建整张地图骨架用 deck_map_plan_create，补边用 deck_map_link，改票用 deck_issue_patch，上报当前在办哪张票用 deck_issue_report，读一张票用 deck_issue_get，看一张地图的全部子票用 deck_map_snapshot，按状态与 label 和 assignee 列薄行用 deck_issue_list。工作区与仓库不接受参数：它们只从当前会话取。',
            quota: { perCallPoints: budget.AI_TOOL_MAX_POINTS_PER_CALL, perCallRequests: budget.AI_TOOL_MAX_REQUESTS_PER_CALL, perHourPoints: budget.AI_TOOL_MAX_POINTS_PER_HOUR, perHourRequests: budget.AI_TOOL_MAX_REQUESTS_PER_HOUR, maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL },
          },
          notes: notes,
          touched: [],
        },
        claimed: { requests: 3, points: 2 },
      }
    })
  }

  return { definition: definition, run: run }
}
