// src/deck/tools/issue-list.ts —— deck_issue_list（全局薄列表，补其他八个工具没有的那一块；#1019 换到新树、#1035 转 TypeScript）
//
// 为什么需要它：deck_context 只给地图清单，deck_map_snapshot 要逐张地图传 key 才给子票，
// 全仓开放清单、按 label 与 assignee 筛这两件事原来只能走 gh。这一只走同一只壳、同一道闸、
// 同一个账（读一档），薄行不回正文与评论，调用方按需再用 deck_issue_get 读全文。
//
// 过滤口径：state、type 与 label 交给后端 filter（全选就省略）；#1830 起 label 也下推了，
// GitHub 的多标签下推是 OR 超集，所以拿回来仍要在内存里按 AND 再收窄一遍（markdown 房自己按标签筛，
// 这一步只等于复核）；assignee、query 一直在内存里筛。三后端因此行为一致，不逐后端写分支。
// 顺序沿用后端原序，不重排。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { MD_SCOPE_LOCATE, applyMdScope, mdScopeNote } from './md-scope.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { callDeckSession, openDeckSession } from './tracker-session.js'
import { estimateToolCost, toolCostInputFrom } from '../../refresh/kernel/tool-call-budget.js'
import { withCallScope } from '../../refresh/rooms/host/tool-call-budget-enforcement.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { DECK_SANDBOX_TIMEOUT_MS, READ_CALL_TIMEOUT_MS } from '../../shared/time-config/src/values.js'
import { withCap } from '../shell/capped-wait.js'
import { evidenceFields, failureOf, reasonForResult } from '../shell/receipt-reason.js'
// #1831：内存二次筛与行形状收口搬去独立文件（主文件有效行要落在 350 行以内）。
import { filterRows } from './issue-list-filter.js'

// #1830：后端撞到自己取数上限时，回执正文与 notes 共用这一句。data.backendTruncated 是唯一的判据，
// 本地 limit 截断（data.truncated）另有说法，两件事不互相顶替。
const BACKEND_INCOMPLETE = '后端到自己的取数上限就停了，这份清单可能不全。'

/** 失败回执里的「下一步做什么」：reason 已经回答了下一步，text 要跟它指向同一件事。
 *  只给本工具判断得了的几种码补一句；其余（后端说做不到等）保持原话，不替后端发明退路。 */
function nextStepText(reason: string): string {
  if (reason === REFUSAL_REASONS.BAD_ARGS) return '过滤条件可能写错了：换一组条件（state / type / label / assignee / query）再试一次。'
  if (reason === REFUSAL_REASONS.BACKEND_TIMEOUT) return '等一会儿再调一次：重新读没有副作用，这次只是没等到回包。'
  if (reason === REFUSAL_REASONS.BACKEND_THREW) return '重新读一次没有副作用，可以直接再调一次。'
  if (reason === REFUSAL_REASONS.OVER_CAP) return '稍等一会儿再调，或把过滤条件收窄一点。'
  return ''
}

/**
 * 装配层注入的依赖袋。壳要用的键原样透传（没列的键也一律接受：壳自己还没标类型，这一层不替它把关）；
 * 列出来的是本工具自己会读的那几个，缺席时各自退默认：没有沙箱策略就跳过那一步等待，没有时钟就用 Date.now。
 */
export interface DeckIssueListDeps {
  readonly [key: string]: unknown
  /** 沙箱许可策略：给工作区与会话，回这一轮的策略快照；等不到就当没有（不拦事）。
   *  两个值都按会话壳给的原样传（工作区没定下来时可能还没有），不许在这里补空串或假目录。 */
  sandboxPolicyFor?: (arg: { cwd: string | undefined; sessionId: string | undefined }) => Promise<unknown>
  /** 读调用整趟的总时限（毫秒）：缺省退 toolTimeoutMs，再退中央键。
   *  #1831：列表读必须比宿主 run_code 的 120 秒先收手，以前没传就落到 5 分钟的工具预算上。 */
  readTimeoutMs?: number
  /** 预算壳留给收尾的余量（毫秒）。 */
  toolMarginMs?: number
  /** 单次后端调用的超时预算（毫秒）；缺省由预算壳自己定。 */
  toolTimeoutMs?: number
  /** 时钟旁路：测试里换成假时钟用，缺省 Date.now。 */
  now?: () => number
}

/** 数字型参数的统一收口：正的有限数才要（取整），其余一律当「没给」，由调用方退自己的默认。 */
function numOpt(v: unknown): number | undefined { return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : undefined }

/** 读调用这一趟的总时限：回退顺序 readTimeoutMs → toolTimeoutMs → READ_CALL_TIMEOUT_MS。
 *  老门禁注入 toolTimeoutMs 小预算继续生效；没注入的读工具落到 90 秒，不再等满 5 分钟。 */
function readTimeoutOf(d: DeckIssueListDeps): number {
  const own = numOpt(d.readTimeoutMs)
  if (own !== undefined) return own
  const legacy = numOpt(d.toolTimeoutMs)
  if (legacy !== undefined) return legacy
  return READ_CALL_TIMEOUT_MS
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

// 沙箱许可等待上限见 ../shell/capped-wait.ts（#1114 第二批）：到点就按「没等到」处理并清掉等待定时器；
// 超时按缺席走老路（不限权），与既有 catch null 同形。

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
      const sc = withCallScope(c, exec, { timeoutMs: readTimeoutOf(d), marginMs: numOpt(d.toolMarginMs), startedAt: toolEntryAt, now: (typeof d.now === 'function') ? d.now : Date.now })
      // 走到这里 tracker 一定在（预算壳自己的约定：能进这一段就是选好后端了）；
      // 断言只为让编译器安静，运行时一个字节都不动 —— 真为空时下面那句照样抛 TypeError 走 backend-threw。
      const t = sc.tracker!
      const opCtx = sc.opCtx
      // 列表过滤是本文件自己拼的，两个可选条件（state / type）下面按需补：先声明成一张表，
      // 补字段时编译器才不拦（运行时拼出来的形状一字不变）。
      const filter: Record<string, unknown> = {}
      if (state !== 'all') filter.state = state
      if (type !== 'all') filter.type = type
      // #1830：标签与状态一样是「取数窗口」的筛选，必须下推给后端 —— 否则 500 条的窗口里装的是整仓
      // 最新票，标签只在内存里筛，筛出的子集既不是全部命中的票，也没有任何一格能看出它只是窗口的一部分。
      // 后端对多标签可能是 OR（GitHub 实测是并集），下面的内存筛按 AND 再收窄一次，两层各司其职。
      if (wantLabels.length) filter.labels = wantLabels.slice()
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
            // #1799：reason 走统一映射（薄查也是读后端），失败证据留后端原档位与映射后的码。
            const ev = failureOf(thinBody, 'read')
            // #1831：读超时回已经拿到的部分并明确标没读全，不再回「没取回来」的空手；
            // 文案只用读口径（读没有副作用），不出现写操作那句「不要直接重放写操作」。
            if (thinBody.error && String(thinBody.error.kind) === 'timeout') {
              return {
                value: {
                  status: DECK_STATUS.PARTIAL,
                  reason: ev.code,
                  text: 'ISSUE 列表这次没读全（超时了：在限时内没等到后端回话）。这次读没有副作用，等一会儿重调一次就行（清单为空只说明这次没拿到，不代表没有）。',
                  data: { total: null, returned: 0, truncated: true, backendTruncated: false, issues: [], partial: true, incomplete: 'timeout', opId: String((opCtx && (opCtx as Record<string, unknown>).opId) || '') },
                  notes: ['这次是读超时：只回了已经拿到的部分，清单为空不代表没有。'],
                  touched: [],
                },
                claimed: { requests: 1, points: 3 },
              }
            }
            return {
              value: {
                status: DECK_STATUS.UNSUPPORTED,
                reason: ev.code,
                text: 'ISSUE 列表没取回来（后端原话：' + thinMsg + '）。' + nextStepText(ev.code),
                data: { error: Object.assign({ message: thinMsg }, evidenceFields(ev)) },
              },
              claimed: { requests: 1, points: 3 },
            }
          }
          const thinRows = (thinBody.data && Array.isArray(thinBody.data.rows)) ? thinBody.data.rows : []
          const mapped = thinMapRowsToIssues(thinRows as ThinMapRow[], { state: state })
          const thinTotal = mapped.length
          const thinSliced = mapped.slice(0, limit)
          const thinTruncated = thinTotal > thinSliced.length
          // #1830：薄查也会撞封顶页数（map 只取回前若干张），那是「后端到自己的上限」，与本地 limit 截断是两件事。
          const thinBackendTruncated = !!(thinBody.data && thinBody.data.truncated === true)
          const thinCond = []
          thinCond.push('state=' + state)
          if (type !== 'all') thinCond.push('type=' + type)
          if (wantLabels.length) thinCond.push('label=' + wantLabels.join('&'))
          const thinNotes = ['这次走地图薄查快速回（只筛地图标签，不读正文）。']
          if (thinBackendTruncated) thinNotes.push('地图只取回了前 ' + mapped.length + ' 张（共 ' + String(thinBody.data && thinBody.data.total) + ' 张，撞到封顶页数），剩下的这次没拿。')
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
            backendTruncated: thinBackendTruncated,
            issues: thinSliced,
            opId: thinOpId,
          }
          return {
            value: {
              status: DECK_STATUS.OK,
              text: 'ISSUE 列表：共 ' + thinTotal + ' 行符合（' + thinCond.join('，') + '），回 ' + thinSliced.length + ' 行。' + (thinBackendTruncated ? BACKEND_INCOMPLETE : ''),
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
        // #1799：与薄查同一套映射，不再把任何后端失败都写成「后端做不到」。
        const ev = failureOf(listed, 'read')
        // #1831：与薄查同款——读超时回部分结果 + 明确标没读全，文案只用读口径。
        if (listed && listed.error && String(listed.error.kind) === 'timeout') {
          return {
            value: {
              status: DECK_STATUS.PARTIAL,
              reason: ev.code,
              text: 'ISSUE 列表这次没读全（超时了：在限时内没等到后端回话）。这次读没有副作用，等一会儿重调一次就行（清单为空只说明这次没拿到，不代表没有）。',
              data: { total: null, returned: 0, truncated: true, backendTruncated: false, issues: [], partial: true, incomplete: 'timeout', opId: String((opCtx && (opCtx as Record<string, unknown>).opId) || '') },
              notes: ['这次是读超时：只回了已经拿到的部分，清单为空不代表没有。'],
              touched: [],
            },
            claimed: { requests: 1, points: 3 },
          }
        }
        return {
          value: {
            status: DECK_STATUS.UNSUPPORTED,
            reason: ev.code,
            text: 'ISSUE 列表没取回来（后端原话：' + msg + '）。' + nextStepText(ev.code),
            data: { error: Object.assign({ message: msg }, evidenceFields(ev)) },
          },
          claimed: { requests: 1, points: 3 },
        }
      }
      const rows = Array.isArray(listed.data) ? listed.data : []
      // 后端自己的列表都有安全上限：GitHub 是「工单 500 条、拉取请求 1000 条」的总量上限，
      // GitLab 是「每页最多 100 条、只取第一页」的页上限（#1770）；它到顶就停，却仍回成功。
      // 走了 REST 降级通道时也一样：REST 自己有翻页上限，尾页失败时只回已经拿到的。
      // 这几种「可能不全」都要如实转告，别让调用方当成「库里就这么多」（#1304）。
      const backendTruncated = listed.truncated === true
      const backendFallback = listed.fallback === 'rest'
      // 降级原因与操作编号一起摆出来：配额耗尽与其它失败走的是同一条 REST，日志里按 opId 才能对上同一趟。
      const fallbackReason = String((listed as { fallbackReason?: unknown }).fallbackReason || '')
      const opId = String(((opCtx as Record<string, unknown> | null | undefined) || {}).opId || '')
      // #1831：内存二次筛与行形状搬进 issue-list-filter.ts（主文件撞了 350 行粒度上限）。
      // 传过去的都是本层已经收口的值：type 四档之一、labels 原样、assignee 与 query 已 trim+小写；
      // 逐条筛选口径与行字段顺序一个字都没变。
      const matched = filterRows(rows, { type: type, labels: wantLabels, assignee: wantAssignee, query: wantQuery })
      const total = matched.length
      const sliced = matched.slice(0, limit)
      const truncated = total > sliced.length
      // #1790 缺陷 A 的 P4：text 里的冲突数按「这次回给调用方的行」数，与上面的 returned 同一口径；
      // 冲突行自己带 statusConflict=true，数字与行能对上。
      let statusConflictCount = 0
      for (const row of sliced) if (row.statusConflict === true) statusConflictCount += 1
      const cond = []
      cond.push('state=' + state)
      if (type !== 'all') cond.push('type=' + type)
      if (wantLabels.length) cond.push('label=' + wantLabels.join('&'))
      if (wantAssignee) cond.push('assignee=' + String(a.assignee).trim())
      if (wantQuery) cond.push('query=' + String(a.query).trim().slice(0, 40))
      const notes = []
      if (scope.effortId) notes.push(mdScopeNote(scope.scene, scope.effortId))
      // 「可能不全」只跟 backendTruncated 走：REST 降级本身不等于没取全（今天 GitHub 的降级路确实总会
      // 标 truncated，但半径按事实说，不按通道名说）。notes 与下面的 text 因此永远说同一件事。
      const backendIncompleteNote = backendTruncated ? '这份清单可能不全：收窄 state 或 label 再查一次（这两样会真的下推给后端；assignee 与 query 只在本层筛，收窄它们不会让后端少取）。' : ''
      if (backendFallback) {
        // 配额耗尽与其它失败分开说：前者等额度恢复，后者按 opId 去日志里查 read.degraded 同一趟的原因。
        if (fallbackReason === 'quota') notes.push('后端主路这次因配额耗尽走了 REST 降级通道（opId ' + (opId || '未知') + '）：REST 自己有翻页上限，尾页失败时只回已经拿到的。' + backendIncompleteNote)
        else notes.push('后端主路这次用不了，走的是 REST 降级通道（原因 ' + (fallbackReason || 'other') + '，opId ' + (opId || '未知') + '，日志里按 opId 查 read.degraded 就是同一趟）：REST 自己有翻页上限，尾页失败时只回已经拿到的。' + backendIncompleteNote)
      }
      else if (backendTruncated) notes.push('后端这次取到自己的上限就停了（GitLab 是每页最多 100 条、只取第一页；GitHub 是工单 500 条、拉取请求 1000 条），这份清单可能不全：收窄 state 或 label 再查一次（这两样会真的下推给后端；assignee 与 query 只在本层筛，收窄它们不会让后端少取）。')
      if (truncated) notes.push('只回前 ' + sliced.length + ' 行（共 ' + total + ' 行符合）：收窄过滤或调大 limit 再取一次。')
      // #1559：宿主收工具返回值时要求无损 JSON，data 上不许出现 undefined。缺省的键就不出现
      // （不用 null 顶替：金标准 03-deck_issue_list.golden.json 里本来就没有这两个键，序列化后的形状与它一致）；
      // opId 正常总有值，恒为字符串。
      // #1830：data 上两个旗标各说一件事 —— truncated 是「本地 limit 截断了这份回执」，
      // backendTruncated 是「后端到自己的取数上限就停了，这份清单可能不全」。两者可能同时成立。
      // 降级通道标了截断时，别把「到取数上限」这句硬按到它头上：notes 已说明是降级通道，正文只说可能不全。
      const backendIncompleteText = backendTruncated ? (backendFallback ? '这份清单可能不全。' : BACKEND_INCOMPLETE) : ''
      const data: Record<string, unknown> = {
        total: total,
        returned: sliced.length,
        truncated: truncated,
        backendTruncated: backendTruncated,
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
          text: 'ISSUE 列表：共 ' + total + ' 行符合（' + cond.join('，') + '），回 ' + sliced.length + ' 行，其中状态冲突 ' + statusConflictCount + ' 张。' + backendIncompleteText,
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
