// src/host/tools/deckContext.js —— deck_context（#713 第六批）
//
// 这个工具回答一句话：我这是站在哪个工作区、哪个后端、哪个仓库上，初始化好了没有，
// 这个仓库现在有哪些地图。它同时也是「查重起点」——AI 要建票之前先看这里有哪些地图与票。
// 详细语义故意放在它的返回值里，别的六个工具的 description 只留一句话（描述会进所有会话的系统提示）。
//
// 拿不到的东西一律如实说：没有会话工作区、没有后端、后端不认这条路，都在返回值里写明。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import * as budget from '../../shared/refresh/budget.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'

export const definition = {
  name: 'deck_context',
  description: '看当前工作区、后端、仓库与初始化状态，外带这个仓库的地图清单；动票之前先调它一次。',
  // 参数说明不进描述（描述会进所有会话的系统提示）：本工具不要参数，语义全在返回值里。
  parameters: { type: 'object', properties: {}, additionalProperties: false },
}

/** 一张地图在清单里长什么样（只放人需要的那几格，正文不进清单）。 */
function mapRow(issue) {
  return { key: issue.key, title: issue.title, state: issue.state, level: issue.level, url: issue.url || '' }
}

export function createDeckContext(deps) {
  const d = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  async function run(exec, args) {
    const s = shell.context(exec)
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

    return shell.call({ tool: 'deck_context', kind: 'read', session: s, pick: pick, repo: repo, estimate: est }, async (c) => {
      const pre = typeof c.tracker.preflight === 'function' ? await c.tracker.preflight({ cwd: s.cwd }, c.opCtx) : null
      const listed = await c.tracker.list(repo, { type: 'map' }, c.opCtx)
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
            // 这一句是给 AI 的用法说明（描述只有一句话，语义放这里）。
            howto: '写票之前先用本工具确认工作区与后端；建票用 deck_issue_create，建整张地图骨架用 deck_map_plan_create，补边用 deck_map_link，改票用 deck_issue_patch，读一张票用 deck_issue_get，看一张地图的全部子票用 deck_map_snapshot。工作区与仓库不接受参数：它们只从当前会话取。',
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
