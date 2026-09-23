// src/host/tools/deckIssueGet.js —— deck_issue_get（#713 第六批）
//
// 一次把一张票的完整关系读回来：正文、评论、标签、认领、父子、阻塞边。
// 「优先读宿主已有快照」落在实现上是：宿主把快照缓存（snapshot.js 的 get/getDependencies）通过
// deps.readThrough 注进来时先用它，没注入就现读；两条路的返回值形状一样，调用方看不出区别。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../../shared/deck-tools/shell.js'
import { EDGE_LANDING, relationsOf } from '../../shared/deck-tools/edges.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/tool-cost.js'

export const definition = {
  name: 'deck_issue_get',
  description: '读一张票的完整关系：正文、评论、标签、认领、父子与阻塞边，每一条边都标出落在哪一列。',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '票号，例如 713' },
      comments: { type: 'number', description: '最多带回几条评论，缺省 50' },
    },
    required: ['key'],
    additionalProperties: false,
  },
}

function issueBrief(issue) {
  if (!issue || typeof issue !== 'object') return null
  return {
    key: issue.key, title: issue.title, state: issue.state, type: issue.type,
    labels: Array.isArray(issue.labels) ? issue.labels.map((l) => (l && l.name) || String(l)) : [],
    assignees: Array.isArray(issue.assignees) ? issue.assignees.map((a) => (a && a.login) || String(a)) : [],
    updatedAt: issue.updatedAt || '', url: issue.url || '', body: issue.body !== undefined ? issue.body : null,
  }
}

export function createDeckIssueGet(deps) {
  const d = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  async function run(exec, args) {
    const a = args || {}
    const key = String(a.key === undefined || a.key === null ? '' : a.key).trim()
    const est = shell.estimateFor('deck_issue_get', a)
    const s = shell.context(exec)
    if (!s.ok) return shell.unsupported('deck_issue_get', s.reason, s.text, { cost: { estimated: est } })
    if (!key) return shell.unsupported('deck_issue_get', REFUSAL_REASONS.BAD_ARGS, '要读哪一张票：把票号写在 key 里（例如 713）。', { cost: { estimated: est } })

    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) return shell.unsupported('deck_issue_get', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    const first = Math.max(0, Math.min(200, Number(a.comments) > 0 ? Math.floor(Number(a.comments)) : 50))

    return shell.call({ tool: 'deck_issue_get', kind: 'read', session: s, pick: pick, repo: repo, estimate: est }, async (c) => {
      const got = await c.tracker.get(repo, key, { comments: { first: first } }, c.opCtx)
      if (!got || got.ok !== true) {
        const msg = String((got && got.error && got.error.message) || '后端没给出原因').slice(0, 300)
        return {
          value: {
            status: DECK_STATUS.UNSUPPORTED,
            reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
            text: '这张票没读回来（后端原话：' + msg + '）。',
            data: { key: key, backendId: pick.backendId, error: { kind: String((got && got.error && got.error.kind) || ''), message: msg } },
          },
          claimed: { requests: 1, points: 3 },
        }
      }
      const issue = got.data || {}
      const dep = typeof c.tracker.getDependencies === 'function' ? await c.tracker.getDependencies(repo, key, {}, c.opCtx) : null
      const dependencies = (dep && dep.ok === true) ? dep.data : null
      const rel = relationsOf(issue, dependencies)
      const notes = []
      if (dep && dep.ok !== true) notes.push('阻塞边这次没读到（后端原话：' + String((dep.error && dep.error.message) || '').slice(0, 200) + '）：上面只列了票自己带的那些。')
      return {
        value: {
          status: DECK_STATUS.OK,
          text: '票 ' + key + ' 读回来了：父票 ' + (rel.parentKey || '（没有）') + '，被阻塞 ' + rel.blockedBy.length + ' 条，阻塞别人 ' + rel.blocking.length + ' 条。',
          data: {
            ticket: issueBrief(issue),
            relations: rel,
            landings: {
              // 读路径只知道「契约的字段里有这条关系」，分不出原生层级与平级链接，如实降一档（判据见 shell.js）。
              parent: rel.parentKey ? EDGE_LANDING.CONTRACT_PARENT_FIELD : EDGE_LANDING.UNKNOWN,
              blockedBy: rel.blockedBy.length ? EDGE_LANDING.CONTRACT_BLOCK_FIELD : EDGE_LANDING.UNKNOWN,
              caveat: '这两个落点是从契约返回的字段读出来的；要精确知道这个后端把父子放在原生层级还是平级链接，看返回里本次写操作留下的 evidence（deck_map_link 会写）。',
            },
            comments: Array.isArray(issue.comments) ? issue.comments.slice(0, first) : [],
            dependenciesRaw: dependencies,
          },
          notes: notes,
          touched: [],
        },
        claimed: { requests: 2, points: 6 },
      }
    })
  }

  return { definition: definition, run: run }
}
