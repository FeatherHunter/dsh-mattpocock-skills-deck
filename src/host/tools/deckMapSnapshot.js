// src/host/tools/deckMapSnapshot.js —— deck_map_snapshot（#713 第六批）
//
// 一张地图的全部子票 + 进度统计 + 五区块。进度统计不在这里自己数：它调共享层的 deriveDeck
// （src/shared/tracker/deck-derive.js，界面与快照用的是同一份投影），这样工具报的数字与面板上看到的
// 是同一套口径，不会出现「工具说 3 张未关闭、面板说 2 张」。
// 五区块（Destination / Notes / Decisions so far / Not yet specified / Out of scope）用共享层的
// parseMapBody 解析，同样是单源。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import { childrenOf } from '../../shared/deck-tools/edges.js'
import { deriveDeck, parseProgress } from '../../shared/tracker/deck-derive.js'
import { parseMapBody } from '../../shared/parser.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'
import { withCallScope } from '../../shared/deck-tools/call-scope.js'

function numOpt(v) { return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : undefined }

export const definition = {
  name: 'deck_map_snapshot',
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。看一个 map 的全部 child ISSUE、进度统计与五个区块，用来判断 map 做到哪一步。',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '地图那张票的票号' },
      frontierOnly: { type: 'boolean', description: '只回可接的子票（未关闭、未认领、阻塞已满足），缺省回全部' },
      effortId: { type: 'string', description: '只有本地后端需要填，填票所在的目录名，根目录的不填' },
    },
    required: ['key'],
    additionalProperties: false,
  },
}

function childRow(issue) {
  const labels = Array.isArray(issue.labels) ? issue.labels.map((l) => (l && l.name) || String(l)) : []
  const assignees = Array.isArray(issue.assignees) ? issue.assignees.map((a) => (a && a.login) || String(a)) : []
  const blockedBy = Array.isArray(issue.blockedBy) ? issue.blockedBy.map((r) => (r && r.key) || String(r)) : []
  // 进度直接从正文算（与汇总用的同一个函数，结果一致）：汇总那张表按池内身份存键，
  // 行里拿裸票号去查恒查不到，之前有子票的地图就整包被外层拒收（只读空地图能过）。
  return { key: issue.key, title: issue.title, state: issue.state, labels: labels, assignees: assignees, blockedBy: blockedBy, updatedAt: issue.updatedAt || '', progress: parseProgress(issue.body) }
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
    const effortId = (a.effortId === undefined || a.effortId === null) ? '' : String(a.effortId).trim()
    if (effortId) repo.effortId = effortId

    return shell.call({ tool: 'deck_map_snapshot', kind: 'read', session: s, pick: pick, repo: repo, estimate: est }, async (c) => {
      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), now: (typeof d.now === 'function') ? d.now : Date.now })
      const t = sc.tracker
      const opCtx = sc.opCtx
      const gotMap = await t.get(repo, key, {}, opCtx)
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
      const kids = await t.list(repo, { parentKey: key }, opCtx)
      const listed = (kids && kids.ok === true && Array.isArray(kids.data)) ? kids.data : []
      const picked = childrenOf(listed, key)
      const children = picked.children
      const notes = []
      if (effortId) notes.push('这次带了 effortId（' + effortId.slice(0, 60) + '）：本地后端只在那一个目录里找，远端后端忽略它。')
      if (!kids || kids.ok !== true) notes.push('子票没取全（后端原话：' + String((kids && kids.error && kids.error.message) || '').slice(0, 200) + '）：下面的进度是手上这几张票算出来的，偏乐观。')
      if (picked.note) notes.push(picked.note)
      // 进度统计走共享层同一份投影：把它当成只有这一张地图的 deck 来算。
      const projection = deriveDeck({ maps: [Object.assign({}, map, { tickets: children })], issues: [] })
      const blocks = parseMapBody(String(map.body || ''))
      const partial = !kids || kids.ok !== true
      // frontierOnly：在手上这批子票里按派生口径筛可接（未关闭、认领已知且空、阻塞已满足；
      // 图外阻塞按未知计为被阻塞，与派生视图的 NOT-FOUND 安全侧一致，不误判可接）。
      let shown = children
      let frontierNote = ''
      if (a.frontierOnly === true) {
        const stateByKey = {}
        for (const t of children) if (t && typeof t.key === 'string') stateByKey[String(t.key)] = t.state
        shown = children.filter((t) => {
          if (!t || t.state !== 'open') return false
          if (!Array.isArray(t.assignees)) return false
          if (t.assignees.length > 0) return false
          const blockers = Array.isArray(t.blockedBy) ? t.blockedBy : []
          for (const b of blockers) {
            const k = String((b && b.key) || b || '')
            if (!k) continue
            if (stateByKey[k] !== 'closed') return false
          }
          return true
        })
        frontierNote = '已按 frontierOnly 只回可接的 ' + shown.length + ' 张（总数 ' + children.length + ' 张）。'
      }
      if (frontierNote) notes.push(frontierNote)
      return {
        value: {
          status: partial ? DECK_STATUS.PARTIAL : DECK_STATUS.OK,
          reason: partial ? REFUSAL_REASONS.BACKEND_UNSUPPORTED : '',
          text: partial ? '地图 ' + key + '：子票没取全（后端没给全），手上这 ' + children.length + ' 张算出来的数偏乐观，先重调一次再看数。' : '地图 ' + key + '：子票 ' + children.length + ' 张，未关闭 ' + projection.stats.open + ' 张、已关闭 ' + projection.stats.closed + ' 张、可接 ' + projection.stats.frontier + ' 张、被阻塞 ' + projection.stats.blocked + ' 张。',
          data: {
            map: { key: map.key, title: map.title, state: map.state, labels: Array.isArray(map.labels) ? map.labels.map((l) => (l && l.name) || String(l)) : [], updatedAt: map.updatedAt || '', url: map.url || '' },
            children: shown.map((t) => childRow(t)),
            stats: partial ? null : projection.stats,
            truncated: partial,
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
