// src/deck/tools/issue-list.ts —— deck_issue_list（全局薄列表，补其他八个工具没有的那一块；#1019 换到新树、#1035 转 TypeScript）
//
// 为什么需要它：deck_context 只给地图清单，deck_map_snapshot 要逐张地图传 key 才给子票，
// 全仓开放清单、按 label 与 assignee 筛这两件事原来只能走 gh。这一只走同一只壳、同一道闸、
// 同一个账（读一档），薄行不回正文与评论，调用方按需再用 deck_issue_get 读全文。
//
// 过滤口径：state 与 type 交给后端 filter（全选就省略）；label（AND）、assignee、query
// 在内存里再筛一遍 —— GitHub 房的列表查询本来就是批量取回内存筛（见 backends/github/queries.js
// 的 LIST_QUERY 注释），三后端行为一致，不逐后端写分支。顺序沿用后端原序，不重排。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { callDeckSession, openDeckSession } from './tracker-session.js'
import { estimateToolCost, toolCostInputFrom } from '../../refresh/kernel/tool-call-budget.js'
import { withCallScope } from '../../refresh/rooms/host/tool-call-budget-enforcement.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { DECK_SANDBOX_TIMEOUT_MS } from '../../shared/time-config/src/values.js'
// #1277：类型没标对的规格票靠票面文件头标记兜底认出来（与宿主快照组装层同一口径）。
import { isSpecHeaderMarked } from '../../shared/issue-file/src/marker.js'

/**
 * 装配层注入的依赖袋。壳要用的键原样透传（没列的键也一律接受：壳自己还没标类型，这一层不替它把关）；
 * 列出来的是本工具自己会读的那几个，缺席时各自退默认：没有沙箱策略就跳过那一步等待，没有时钟就用 Date.now。
 */
export interface DeckIssueListDeps {
  readonly [key: string]: unknown
  /** 沙箱许可策略：给工作区与会话，回这一轮的策略快照；等不到就当没有（不拦事）。
   *  两个值都按会话壳给的原样传（工作区没定下来时可能还没有），不许在这里补空串或假目录。 */
  sandboxPolicyFor?: (arg: { cwd: string | undefined; sessionId: string | undefined }) => Promise<unknown>
  /** 时钟旁路：测试里换成假时钟用，缺省 Date.now。 */
  now?: () => number
}

/** 工具定义（唯一事实）：路由、参数名与给 AI 看的那句话都从这里出，别在别处再抄一份。 */
export const definition = {
  name: 'deck_issue_list',
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。按状态、label、assignee 与关键词列出 ISSUE 薄行，不回正文与评论。',
  parameters: {
    type: 'object',
    properties: {
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: '只列哪种状态，缺省 open' },
      type: { type: 'string', enum: ['issue', 'map', 'spec', 'all'], description: '只列哪种类型，缺省 all' },
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

/**
 * 从后端回来的清单里挑出名字：字符串直接用，对象按下标取一项（标签取 name、认领取 login），
 * 两种混着来也认。给的清单不是数组就当空，取不到名字记空串，最后去空。
 */
function namesOf(list: unknown, pick: (item: Record<string, unknown>) => unknown): string[] {
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

/** 标签名字：对象形态取 name，字符串形态原样用。 */
function labelNames(list: unknown): string[] { return namesOf(list, (l) => l.name) }
/** 认领人名字：对象形态取 login，取不到记空串（namesOf 会把它滤掉）。 */
function assigneeNames(list: unknown): string[] { return namesOf(list, (a) => (a && a.login) || '') }

/** 钳制等待的结果：等到了给值；超时或对方自己失败都算「没等到」，调用方一律退老路。 */
type CapResult<T> = { ok: true; value: T } | { ok: false; timedOut?: true }
// 沙箱许可等待上限：超时按缺席走老路（不限权），与既有 catch null 同形。
function withCap<T>(promise: Promise<T> | T, ms: number): Promise<CapResult<T>> {
  return Promise.race([
    Promise.resolve(promise).then(function (v): CapResult<T> { return { ok: true, value: v } }, function (): CapResult<T> { return { ok: false } }),
    new Promise<CapResult<T>>(function (resolve) { setTimeout(function () { resolve({ ok: false, timedOut: true }) }, ms) }),
  ])
}

/** 这一行是不是地图：后端回的 type 认地图、或带 isMap 标记、或戴着 wayfinder:map 标签都算。 */
function isMapRow(issue: Record<string, unknown> | null | undefined): boolean {  try {
    if (!issue || typeof issue !== 'object') return false
    if (issue.type === 'map' || issue.isMap === true) return true
    const labs = labelNames(issue.labels).map((s) => s.toLowerCase())
    return labs.indexOf('wayfinder:map') >= 0
  } catch (e) { return false }
}

/** 把一行归成三种契约类型之一：地图 / 规格 / 普通票。
 *
 *  后端的 type 认 map/spec 时直接采用；没标对时按标签与票面文件头标记兜底 —— 标签先于标记，
 *  与客户端 containerKindOf、宿主快照组装层的判定次序一致（#1277 的视图兜底）。
 */
function rowKindOf(issue: Record<string, unknown> | null | undefined): string {
  try {
    if (!issue || typeof issue !== 'object') return 'issue'
    const declared = String(issue.type || '')
    if (declared === 'map' || declared === 'spec') return declared
    if (isMapRow(issue)) return 'map'
    if (isSpecHeaderMarked(issue.body)) return 'spec'
    return 'issue'
  } catch (e) { return 'issue' }
}

/**
 * 装配层调一次，拿到这对 { definition, run }。deps 是宿主注入的依赖袋（见 DeckIssueListDeps），
 * 什么都不给也能跑：壳与这里的每一处都各自退默认。
 */
export function createDeckIssueList(deps?: DeckIssueListDeps) {
  const d: DeckIssueListDeps = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  /**
   * 跑一次：exec 是 DSH 给的执行上下文（会话与沙箱都从它取），args 是模型填的参数。
   * 参数先当「未知」再逐项收口（state / type / labels / assignee / query / limit 下面各收一次），
   * 回执形状由壳统一渲染。
   */
  async function run(exec: unknown, args: Record<string, unknown>): Promise<unknown> {
    // 预算起算点：入口前耗时（会话归一、选后端、探沙箱）也要算进预算（#1195）。
    const toolEntryAt = (typeof d.now === 'function') ? d.now() : Date.now()
    const a: Record<string, unknown> = args || {}
    const rawState = String(a.state === undefined || a.state === null ? 'open' : a.state).trim().toLowerCase()
    const state = (rawState === 'closed' || rawState === 'all') ? rawState : 'open'
    const rawType = String(a.type === undefined || a.type === null ? 'all' : a.type).trim().toLowerCase()
    const type = (rawType === 'issue' || rawType === 'map' || rawType === 'spec') ? rawType : 'all'
    const wantLabels = (Array.isArray(a.labels) ? a.labels : []).map((x) => String(x).trim()).filter(Boolean)
    const wantAssignee = String(a.assignee === undefined || a.assignee === null ? '' : a.assignee).trim().toLowerCase()
    const wantQuery = String(a.query === undefined || a.query === null ? '' : a.query).trim().toLowerCase()
    const limit = Math.max(1, Math.min(200, Number(a.limit) > 0 ? Math.floor(Number(a.limit)) : 50))
    const est = shell.estimateFor('deck_issue_list', a)
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    // 会话没解析出来时回的是「为什么」那一支。编译器分不出两支（ok 在会话壳里是运行时布尔，
    // 那一层还没标类型，见 #1040），所以这里按形状取 reason —— 取到的值与老写法逐字相同。
    if (!s.ok) return shell.unsupported('deck_issue_list', (s as { reason: string }).reason, s.text, { cost: { estimated: est } })

    const pick = await openDeckSession({ deps: d, exec: exec, session: s, estimate: est, tool: 'deck_issue_list', kind: 'read' })
    if (!pick.ok) return shell.unsupported('deck_issue_list', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    const effortId = (a.effortId === undefined || a.effortId === null) ? '' : String(a.effortId).trim()
    if (effortId) repo.effortId = effortId

    // 沙箱策略的快照：等不到（超时、对方失败、没注入）一律按「没有」往下走，与老口径同形。
    let sandbox: unknown = null
    try {
      if (typeof d.sandboxPolicyFor === 'function') {
        const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), DECK_SANDBOX_TIMEOUT_MS)
        sandbox = (raced && raced.ok === true) ? raced.value : null
      }
    } catch (eS) { sandbox = null }

    return callDeckSession({ deps: d, opened: pick, session: s, repo: repo, estimate: est, tool: 'deck_issue_list', sandbox: sandbox }, async (c: unknown) => {
      const sc = withCallScope(c, exec, { timeoutMs: undefined, marginMs: undefined, startedAt: toolEntryAt, now: (typeof d.now === 'function') ? d.now : Date.now })
      // 走到这里 tracker 一定在（预算壳自己的约定：能进这一段就是选好后端了）；
      // 断言只为让编译器安静，运行时一个字节都不动 —— 真为空时下面那句照样抛 TypeError 走 backend-threw。
      const t = sc.tracker!
      const opCtx = sc.opCtx
      // 列表过滤是本文件自己拼的，两个可选条件（state / type）下面按需补：先声明成一张表，
      // 补字段时编译器才不拦（运行时拼出来的形状一字不变）。
      const filter: Record<string, unknown> = {}
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
      // 后端自己的列表有安全上限（工单 500 条、拉取请求 1000 条）：它到顶就停，却仍回成功。
      // 走了 REST 降级通道时也一样：REST 自己有翻页上限，尾页失败时只回已经拿到的。
      // 这两种「可能不全」都要如实转告，别让调用方当成「库里就这么多」（#1304）。
      const backendTruncated = listed.truncated === true
      const backendFallback = listed.fallback === 'rest'
      const wantLabelLow = wantLabels.map((x) => x.toLowerCase())
      const matched = []
      for (const issue of rows) {
        if (!issue || typeof issue !== 'object') continue
        // type 在内存里再判一次：后端可能忽略它（契约只保证它透传，不过滤包容）。
        if (type !== 'all') {
          if (rowKindOf(issue) !== type) continue
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
          type: rowKindOf(issue),
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
      if (backendFallback) notes.push('后端主路这次用不了，走的是 REST 降级通道：REST 自己有翻页上限，尾页失败时只回已经拿到的，这份清单可能不全：收窄过滤再查一次。')
      else if (backendTruncated) notes.push('后端这次只翻到自己的上限就停了（工单 500 条、拉取请求 1000 条），这份清单可能不全：收窄过滤再查一次。')
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
