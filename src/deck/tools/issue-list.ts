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
import { MD_SCOPE_LOCATE, applyMdScope, mdScopeNote } from './md-scope.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { callDeckSession, openDeckSession } from './tracker-session.js'
import { estimateToolCost, toolCostInputFrom } from '../../refresh/kernel/tool-call-budget.js'
import { withCallScope } from '../../refresh/rooms/host/tool-call-budget-enforcement.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { DECK_SANDBOX_TIMEOUT_MS } from '../../shared/time-config/src/values.js'
import { withCap } from '../shell/capped-wait.js'
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
      ...MD_SCOPE_LOCATE,
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

// 沙箱许可等待上限见 ../shell/capped-wait.ts（#1114 第二批）：到点就按「没等到」处理并清掉等待定时器；
// 超时按缺席走老路（不限权），与既有 catch null 同形。

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

/** 地图薄查认的标签（写死小写）：发给服务端的筛子与内存二次校验都用它，大小写输入先归一到它再比。 */
export const THIN_MAP_LABEL = 'wayfinder:map'

/** 分流判定的输入（调用方已收口的值：type 是小写四档之一，assignee/query 已 trim+小写，effortId 是 scope 收口后的目录名）。 */
export interface ThinRouteInput {
  /** 已收口的 type（issue | map | spec | all）。 */
  type: string
  /** 原始 labels（本函数内逐项 trim+小写后再判，调用方不用先归一）。 */
  labels: unknown
  /** 已 trim+小写 的 assignee（空串表示没筛）。 */
  assignee: string
  /** 已 trim+小写 的 query（空串表示没搜）。 */
  query: string
  /** scope 收口后的目录名（空串表示不限）。 */
  effortId: string
}

/**
 * 纯地图筛才走薄查（#1604）：只筛地图标签的列表走 listMaps 快速回，其余一律走老全量路径。
 *
 * 走薄查当且仅当同时满足这五条（按要不要正文分流，不按调用方名字分流）：
 * 一、没带文本搜（query 要读标题加正文，薄行没有正文）；
 * 二、没带指派筛（assignee 细筛后要正文确认，薄行没有认领格）；
 * 三、没带目录限定（effortId 薄行没有这格，老路才懂）；
 * 四、type 不是 spec/issue（规格识别要读票面标记，普通票薄行里根本没有）；
 * 五、labels 非空且逐项归一后全是地图标签（没筛标签就不是纯地图筛，掺了别的标签薄行对不上）。
 * 大小写输入一视同仁：逐项 trim+小写后再比，大写筛与小写筛走同一条路。
 */
export function shouldUseThinMapList(opts: ThinRouteInput): boolean {
  try {
    const o = (opts || {}) as unknown as Record<string, unknown>
    if (String(o.query || '')) return false
    if (String(o.assignee || '')) return false
    if (String(o.effortId || '')) return false
    const t = String(o.type || 'all')
    if (t === 'spec' || t === 'issue') return false
    if (t !== 'map' && t !== 'all') return false
    const raw = Array.isArray(o.labels) ? (o.labels as unknown[]) : []
    const lows = raw.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
    if (!lows.length) return false
    for (const l of lows) if (l !== THIN_MAP_LABEL) return false
    return true
  } catch (e) { return false }
}

/** 薄查回来的行形状（listMaps 的 MapRow：只有画清单要的四格）。 */
export interface ThinMapRow {
  key: unknown
  title: unknown
  state: unknown
  url: unknown
}

/**
 * 薄行转列表行（#1604）：type 写死地图，labels 写死小写单个地图标签。
 *
 * 薄行本来就没有的格如实留空（认领、更新时间、目录、父票）：纯地图筛的调用方只看
 * key/title/state/url 四格，空串与 null 不是缺行（行数不缺），与 deck_context 首屏
 * 拿薄行直接画清单同一口径。state 在这里再按调用方的要求过滤一次（薄查内部两种
 * 状态都要，all 全留，其余只留对上的那一档），顺序沿用薄查交出来的更新时间倒序。
 */
export function thinMapRowsToIssues(rows: ThinMapRow[] | unknown, opts: { state: string }): Record<string, unknown>[] {
  try {
    const list = Array.isArray(rows) ? rows : []
    const want = String((opts && opts.state) || 'all').toLowerCase()
    const out: Record<string, unknown>[] = []
    for (const r of list) {
      if (!r || typeof r !== 'object') continue
      const rec = r as Record<string, unknown>
      const st = String(rec.state || '').toLowerCase() === 'closed' ? 'closed' : 'open'
      if (want !== 'all' && st !== want) continue
      out.push({
        key: rec.key,
        title: rec.title,
        state: st,
        type: 'map',
        labels: [THIN_MAP_LABEL],
        assignees: [],
        updatedAt: '',
        url: rec.url || '',
        effortId: '',
        parentKey: null,
      })
    }
    return out
  } catch (e) { return [] }
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
    const scope = applyMdScope(repo, a)
    if (!scope.ok) return shell.unsupported('deck_issue_list', REFUSAL_REASONS.BAD_ARGS, scope.message, { cost: { estimated: est } })

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
      // #1604：纯地图筛走薄查快速回（只筛地图标签、不读正文时调 listMaps），
      // 其余（文本搜、规格识别、指派、目录限定、掺杂其它标签）一律走下面的老全量路径。
      // 薄查只有「不支持」才回落：超时与传输失败直接失败，不拿半份当整仓。
      if (shouldUseThinMapList({ type: type, labels: wantLabels, assignee: wantAssignee, query: wantQuery, effortId: (scope && scope.effortId) || '' }) && typeof t.listMaps === 'function') {
        const thin = await t.listMaps(repo, opCtx)
        const thinBody = (thin || {}) as { ok?: unknown; error?: { kind?: unknown; message?: unknown }; data?: { rows?: unknown; total?: unknown; truncated?: unknown } }
        const thinUnsupported = thinBody.ok === false && thinBody.error && String(thinBody.error.kind) === 'unsupported'
        if (!thinUnsupported) {
          if (thinBody.ok !== true) {
            const thinMsg = String((thinBody.error && thinBody.error.message) || '后端没给出原因').slice(0, 300)
            return {
              value: {
                status: DECK_STATUS.UNSUPPORTED,
                reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
                text: 'ISSUE 列表没取回来（后端原话：' + thinMsg + '）。',
                data: { error: { kind: String((thinBody.error && thinBody.error.kind) || ''), message: thinMsg } },
              },
              claimed: { requests: 1, points: 3 },
            }
          }
          const thinRows = (thinBody.data && Array.isArray(thinBody.data.rows)) ? thinBody.data.rows : []
          const mapped = thinMapRowsToIssues(thinRows as ThinMapRow[], { state: state })
          const thinTotal = mapped.length
          const thinSliced = mapped.slice(0, limit)
          const thinTruncated = thinTotal > thinSliced.length
          const thinCond = []
          thinCond.push('state=' + state)
          if (type !== 'all') thinCond.push('type=' + type)
          if (wantLabels.length) thinCond.push('label=' + wantLabels.join('&'))
          const thinNotes = ['这次走地图薄查快速回（只筛地图标签，不读正文）。']
          if (thinBody.data && thinBody.data.truncated === true) thinNotes.push('地图只取回了前 ' + mapped.length + ' 张（共 ' + String(thinBody.data.total) + ' 张，撞到封顶页数），剩下的这次没拿。')
          if (thinTruncated) thinNotes.push('只回前 ' + thinSliced.length + ' 行（共 ' + thinTotal + ' 行符合）：收窄过滤或调大 limit 再取一次。')
          const thinRawUsage: unknown = (thin as { usage?: unknown }).usage
          const thinUsageObj: { requests?: unknown; points?: unknown } = (thinRawUsage !== null && typeof thinRawUsage === 'object') ? (thinRawUsage as { requests?: unknown; points?: unknown }) : {}
          const thinClaimed = (typeof thinUsageObj.requests === 'number' && typeof thinUsageObj.points === 'number')
            ? { requests: thinUsageObj.requests, points: thinUsageObj.points }
            : { requests: 1, points: 2 }
          const thinOpId = String(((opCtx as Record<string, unknown> | null | undefined) || {}).opId || '')
          const thinData: Record<string, unknown> = {
            total: thinTotal,
            returned: thinSliced.length,
            truncated: thinTruncated,
            issues: thinSliced,
            opId: thinOpId,
          }
          return {
            value: {
              status: DECK_STATUS.OK,
              text: 'ISSUE 列表：共 ' + thinTotal + ' 行符合（' + thinCond.join('，') + '），回 ' + thinSliced.length + ' 行。',
              data: thinData,
              notes: thinNotes,
              touched: [],
            },
            claimed: thinClaimed,
          }
        }
      }
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
      // 降级原因与操作编号一起摆出来：配额耗尽与其它失败走的是同一条 REST，日志里按 opId 才能对上同一趟。
      const fallbackReason = String((listed as { fallbackReason?: unknown }).fallbackReason || '')
      const opId = String(((opCtx as Record<string, unknown> | null | undefined) || {}).opId || '')
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
      if (scope.effortId) notes.push(mdScopeNote(scope.scene, scope.effortId))
      if (backendFallback) {
        // 配额耗尽与其它失败分开说：前者等额度恢复，后者按 opId 去日志里查 read.degraded 同一趟的原因。
        if (fallbackReason === 'quota') notes.push('后端主路这次因配额耗尽走了 REST 降级通道（opId ' + (opId || '未知') + '）：REST 自己有翻页上限，尾页失败时只回已经拿到的，这份清单可能不全：收窄过滤再查一次。')
        else notes.push('后端主路这次用不了，走的是 REST 降级通道（原因 ' + (fallbackReason || 'other') + '，opId ' + (opId || '未知') + '，日志里按 opId 查 read.degraded 就是同一趟）：REST 自己有翻页上限，尾页失败时只回已经拿到的，这份清单可能不全：收窄过滤再查一次。')
      }
      else if (backendTruncated) notes.push('后端这次只翻到自己的上限就停了（工单 500 条、拉取请求 1000 条），这份清单可能不全：收窄过滤再查一次。')
      if (truncated) notes.push('只回前 ' + sliced.length + ' 行（共 ' + total + ' 行符合）：收窄过滤或调大 limit 再取一次。')
      // #1559：宿主收工具返回值时要求无损 JSON，data 上不许出现 undefined。缺省的键就不出现
      // （不用 null 顶替：金标准 03-deck_issue_list.golden.json 里本来就没有这两个键，序列化后的形状与它一致）；
      // opId 正常总有值，恒为字符串。
      const data: Record<string, unknown> = {
        total: total,
        returned: sliced.length,
        truncated: truncated,
        issues: sliced,
        opId: opId,
      }
      if (backendFallback) {
        data.fallback = 'rest'
        data.fallbackReason = fallbackReason || 'other'
      }
      return {
        value: {
          status: DECK_STATUS.OK,
          text: 'ISSUE 列表：共 ' + total + ' 行符合（' + cond.join('，') + '），回 ' + sliced.length + ' 行。',
          data: data,
          notes: notes,
          touched: [],
        },
        claimed: { requests: 2, points: 5 },
      }
    })
  }

  return { definition: definition, run: run }
}
