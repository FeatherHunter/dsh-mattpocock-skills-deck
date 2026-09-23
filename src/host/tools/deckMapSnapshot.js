// src/host/tools/deckMapSnapshot.js —— deck_map_snapshot（#713 第六批）
//
// 一张地图的全部子票 + 进度统计 + 五区块。进度统计不在这里自己数：它调共享层的 deriveDeck
// （src/shared/tracker/deck-derive.js，界面与快照用的是同一份投影），这样工具报的数字与面板上看到的
// 是同一套口径，不会出现「工具说 3 张未关闭、面板说 2 张」。
// 五区块（Destination / Notes / Decisions so far / Not yet specified / Out of scope）用共享层的
// parseMapBody 解析，同样是单源。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import { childrenOf } from '../../shared/deck-tools/edges.js'
import { deriveDeck } from '../../shared/tracker/deck-derive.js'
import { parseMapBody } from '../../shared/parser.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'

export const definition = {
  name: 'deck_map_snapshot',
  description: '看一张地图的全部子票、进度统计与五个区块的内容，用来判断这张地图做到哪一步了。',
  parameters: {
    type: 'object',
    properties: { key: { type: 'string', description: '地图那张票的票号' } },
    required: ['key'],
    additionalProperties: false,
  },
}

function childRow(issue, progressOf) {
  const labels = Array.isArray(issue.labels) ? issue.labels.map((l) => (l && l.name) || String(l)) : []
  const assignees = Array.isArray(issue.assignees) ? issue.assignees.map((a) => (a && a.login) || String(a)) : []
  const blockedBy = Array.isArray(issue.blockedBy) ? issue.blockedBy.map((r) => (r && r.key) || String(r)) : []
  return { key: issue.key, title: issue.title, state: issue.state, labels: labels, assignees: assignees, blockedBy: blockedBy, updatedAt: issue.updatedAt || '', progress: progressOf ? progressOf[issue.key] : null }
}

export function createDeckMapSnapshot(deps) {
  const d = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  async function run(exec, args) {
    const a = args || {}
    const key = String(a.key === undefined || a.key === null ? '' : a.key).trim()
    const est = shell.estimateFor('deck_map_snapshot', a)
    const s = shell.context(exec)
    if (!s.ok) return shell.unsupported('deck_map_snapshot', s.reason, s.text, { cost: { estimated: est } })
    if (!key) return shell.unsupported('deck_map_snapshot', REFUSAL_REASONS.BAD_ARGS, '要看哪一张地图：把地图那张票的票号写在 key 里。', { cost: { estimated: est } })

    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) return shell.unsupported('deck_map_snapshot', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)

    return shell.call({ tool: 'deck_map_snapshot', kind: 'read', session: s, pick: pick, repo: repo, estimate: est }, async (c) => {
      const gotMap = await c.tracker.get(repo, key, {}, c.opCtx)
      if (!gotMap || gotMap.ok !== true) {
        const msg = String((gotMap && gotMap.error && gotMap.error.message) || '后端没给出原因').slice(0, 300)
        return {
          value: {
            status: DECK_STATUS.UNSUPPORTED,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '这张地图没读回来（后端原话：' + msg + '）。',
            data: { key: key, error: { kind: String((gotMap && gotMap.error && gotMap.error.kind) || ''), message: msg } },
          },
          claimed: { requests: 1, points: 3 },
        }
      }
      const map = gotMap.data || {}
      const kids = await c.tracker.list(repo, { parentKey: key }, c.opCtx)
      const listed = (kids && kids.ok === true && Array.isArray(kids.data)) ? kids.data : []
      const picked = childrenOf(listed, key)
      const children = picked.children
      const notes = []
      if (!kids || kids.ok !== true) notes.push('子票没取全（后端原话：' + String((kids && kids.error && kids.error.message) || '').slice(0, 200) + '）：下面的进度是手上这几张票算出来的，偏乐观。')
      if (picked.note) notes.push(picked.note)
      // 进度统计走共享层同一份投影：把它当成只有这一张地图的 deck 来算。
      const projection = deriveDeck({ maps: [Object.assign({}, map, { tickets: children })], issues: [] })
      const blocks = parseMapBody(String(map.body || ''))
      const partial = !kids || kids.ok !== true
      return {
        value: {
          status: partial ? DECK_STATUS.PARTIAL : DECK_STATUS.OK,
          reason: partial ? REFUSAL_REASONS.BACKEND_UNSUPPORTED : '',
          text: '地图 ' + key + '：子票 ' + children.length + ' 张，未关闭 ' + projection.stats.open + ' 张、已关闭 ' + projection.stats.closed + ' 张、可接 ' + projection.stats.frontier + ' 张、被阻塞 ' + projection.stats.blocked + ' 张。',
          data: {
            map: { key: map.key, title: map.title, state: map.state, labels: Array.isArray(map.labels) ? map.labels.map((l) => (l && l.name) || String(l)) : [], updatedAt: map.updatedAt || '', url: map.url || '' },
            children: children.map((t) => childRow(t, projection.progressOf)),
            stats: projection.stats,
            labels: projection.labels,
            progressOf: projection.progressOf,
            blockedByKeys: projection.blockedByKeys,
            blocks: { destination: blocks.destination || '', notes: blocks.notes || [], decisions: blocks.decisions || [], fog: blocks.fog || [], outOfScope: blocks.outOfScope || [] },
          },
          notes: notes,
          touched: [],
        },
        claimed: { requests: 2, points: 5 },
      }
    })
  }

  return { definition: definition, run: run }
}
