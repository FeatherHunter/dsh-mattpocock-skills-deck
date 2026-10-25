// src/deck/tools/map-snapshot.ts —— deck_map_snapshot（#713 第六批；#1019 换到新树、#1035 转 TypeScript）
//
// 一张地图的全部子票 + 进度统计 + 五区块。进度统计不在这里自己数：它调共享层的 deriveDeck
// （src/tracker/deck-derive.ts，界面与快照用的是同一份投影），这样工具报的数字与面板上看到的
// 是同一套口径，不会出现「工具说 3 张未关闭、面板说 2 张」。
// 五区块（Destination / Notes / Decisions so far / Not yet specified / Out of scope）用共享层的
// parseMapBody 解析，同样是单源。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { MD_SCOPE_LOCATE, applyMdScope, mdScopeNote } from './md-scope.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { callDeckSession, openDeckSession } from './tracker-session.js'
import { childrenOf } from '../shell/edge-landing.js'
import { deriveDeck, parseProgress } from '../../tracker/deck-derive.js'
import { parseMapBody, parseOriginalWords, parseProgressDetail } from '../../tracker/body-parse.js'
import { estimateToolCost, toolCostInputFrom } from '../../refresh/kernel/tool-call-budget.js'
import { withCallScope } from '../../refresh/rooms/host/tool-call-budget-enforcement.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { DECK_SANDBOX_TIMEOUT_MS } from '../../shared/time-config/src/values.js'
import { withCap } from '../shell/capped-wait.js'

/** 数字型参数的统一收口：正的有限数才要（取整），其余一律当「没给」，由调用方退自己的默认。 */
function numOpt(v: unknown): number | undefined { return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : undefined }
// 沙箱许可等待上限见 ../shell/capped-wait.ts（#1114 第二批）：到点就交卷并清掉等待定时器；
// 超时按缺席走老路（不限权），与既有 catch null 同形。

/**
 * 装配层注入的依赖袋。壳要用的键原样透传（没列的键也一律接受：壳自己还没标类型，这一层不替它把关）；
 * 列出来的是本工具自己会读的那几个，缺席时各自退默认：没有沙箱策略就跳过那一步等待，没有时钟就用 Date.now。
 */
export interface DeckMapSnapshotDeps {
  readonly [key: string]: unknown
  /** 沙箱许可策略：给工作区与会话，回这一轮的策略快照；等不到就当没有（不拦事）。两个值原样传，可能还没有。 */
  sandboxPolicyFor?: (arg: { cwd: string | undefined; sessionId: string | undefined }) => Promise<unknown>
  /** 时钟旁路：测试里换假时钟用，缺省 Date.now。 */
  now?: () => number
}

/** 工具定义（唯一事实）：路由、参数名与给 AI 看的那句话都从这里出，别在别处再抄一份。 */
export const definition = {
  name: 'deck_map_snapshot',
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。看一个 map 的全部 child ISSUE、进度统计与五个区块，用来判断 map 做到哪一步。detail=thin 只要薄行不断（见 detail 参数）。',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '地图那张票的票号' },
      frontierOnly: { type: 'boolean', description: '只回可接的子票（未关闭、未认领、阻塞已满足），缺省回全部' },
      detail: { type: 'string', enum: ['full', 'thin'], description: '子票行要多细。缺省 full：每行带正文进度（回包大，票多时被截断）。thin：只要键、标题、状态、标签、认领、阻塞（回包小、清单不断；统计与进度表照算不变；要正文用 deck_issue_get 逐张取）。' },
      ...MD_SCOPE_LOCATE,
    },
    required: ['key'],
    additionalProperties: false,
  },
}

/** 一行子票（full 档）。行的形状是后端回来的运行时真值（契约层没建模），按开放表收口。 */
function childRow(issue: Record<string, unknown>) {
  const labels = Array.isArray(issue.labels) ? issue.labels.map((l) => (l && l.name) || String(l)) : []
  const assignees = Array.isArray(issue.assignees) ? issue.assignees.map((a) => (a && a.login) || String(a)) : []
  const blockedBy = Array.isArray(issue.blockedBy) ? issue.blockedBy.map((r) => (r && r.key) || String(r)) : []
  // 进度直接从正文算（与汇总用的同一个函数，结果一致）：汇总那张表按池内身份存键，
  // 行里拿裸票号去查恒查不到，之前有子票的地图就整包被外层拒收（只读空地图能过）。
  // #1090：数字（progress）保留给面板与既有读法；另给 progressDetail 结构化那一条，
  // 里面含记录时间与说明，与 deck_issue_get 读回来的是同一份。
  return {
    key: issue.key, title: issue.title, state: issue.state, labels: labels, assignees: assignees, blockedBy: blockedBy,
    updatedAt: issue.updatedAt || '', progress: parseProgress(issue.body),
    progressDetail: parseProgressDetail(issue.body),
    // #1092：full 行也带上「维护者原话」的结构化读回，与 deck_issue_get 是同一份（同一函数、逐字）。
    // thin 行故意不加：薄行是「票多时只要清单」那一档，要原话的人应当逐张读 deck_issue_get。
    originalWords: parseOriginalWords(issue.body),
  }
}

// 薄行：只要画清单用得上的格，不要正文与进度（回包小、票多时不断；统计与进度表另有去处）。
function thinRow(issue: Record<string, unknown>) {
  const labels = Array.isArray(issue.labels) ? issue.labels.map((l) => (l && l.name) || String(l)) : []
  const assignees = Array.isArray(issue.assignees) ? issue.assignees.map((a) => (a && a.login) || String(a)) : []
  const blockedBy = Array.isArray(issue.blockedBy) ? issue.blockedBy.map((r) => (r && r.key) || String(r)) : []
  return { key: issue.key, title: issue.title, state: issue.state, labels: labels, assignees: assignees, blockedBy: blockedBy, updatedAt: issue.updatedAt || '' }
}

/**
 * 装配层调一次，拿到这对 { definition, run }。deps 是宿主注入的依赖袋（见 DeckMapSnapshotDeps），
 * 什么都不给也能跑：壳与这里的每一处都各自退默认。
 */
export function createDeckMapSnapshot(deps?: DeckMapSnapshotDeps) {
  const d: DeckMapSnapshotDeps = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))

  /**
   * 跑一次：exec 是 DSH 给的执行上下文（会话与沙箱都从它取），args 是模型填的参数。
   * 参数先当「未知」再逐项收口（key / effort / feature / frontierOnly / detail 各收一次），回执形状由壳统一渲染。
   * exec 上只声明本文件真正会读的那个字段（取消信号），其余字段一律不碰、照旧整只交给壳，
   * 所以下面取 signal 的地方不必写一串断言。
   */
  async function run(exec: { signal?: unknown } | null | undefined, args: Record<string, unknown>): Promise<unknown> {
    // 预算起算点：入口前耗时（会话归一、选后端、探沙箱）也要算进预算（#1195）。
    const toolEntryAt = (typeof d.now === 'function') ? d.now() : Date.now()
    const a: Record<string, unknown> = args || {}
    const key = String(a.key === undefined || a.key === null ? '' : a.key).trim()
    const est = shell.estimateFor('deck_map_snapshot', a)
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    // 会话没解析出来时回的是「为什么」那一支。编译器分不出两支（ok 在会话壳里是运行时布尔，
    // 那一层还没标类型，见 #1040），所以这里按形状取 reason —— 取到的值与老写法逐字相同。
    if (!s.ok) return shell.unsupported('deck_map_snapshot', (s as { reason: string }).reason, s.text, { cost: { estimated: est } })
    if (!key) return shell.unsupported('deck_map_snapshot', REFUSAL_REASONS.BAD_ARGS, '要看哪一张地图：把地图那张票的票号写在 key 里。', { cost: { estimated: est } })

    const pick = await openDeckSession({ deps: d, exec: exec, session: s, estimate: est, tool: 'deck_map_snapshot', kind: 'read' })
    if (!pick.ok) return shell.unsupported('deck_map_snapshot', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } })
    const repo = shell.repoOf(pick, s)
    const scope = applyMdScope(repo, a)
    if (!scope.ok) return shell.unsupported('deck_map_snapshot', REFUSAL_REASONS.BAD_ARGS, scope.message, { cost: { estimated: est } })

    // exec 的形状由 DSH 给（会话壳那批还没标类型，见 #1040），三处 exec.signal 各按纯类型断言收口：
    // 取值表达式一字不动，所以转译出来的 JS 与转换前逐字节一致。
    return callDeckSession({ deps: d, opened: pick, session: s, repo: repo, estimate: est, tool: 'deck_map_snapshot', sandbox: (await (async function () { try { if (typeof d.sandboxPolicyFor !== 'function') return null; const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), DECK_SANDBOX_TIMEOUT_MS); return (raced && raced.ok === true) ? raced.value : null } catch (eS) { return null } })()), signal: (exec && exec.signal && typeof exec.signal === 'object') ? exec.signal : undefined }, async (c: unknown) => {
      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), startedAt: toolEntryAt, now: (typeof d.now === 'function') ? d.now : Date.now })
      // 走到这里 tracker 一定在（预算壳自己的约定：能进这一段就是选好后端了）；
      // 断言只为让编译器安静，运行时一个字节都不动 —— 真为空时下面那句照样抛 TypeError 走 backend-threw。
      const t = sc.tracker!
      const opCtx = sc.opCtx
      // 地图与子票清单互相独立，同时取（两份读缓存的键不同，不会互相覆盖）
      const mapPromise = t.get(repo, key, {}, opCtx)
      const kidsPromise = t.list(repo, { parentKey: key }, opCtx)
      const gotMap = await mapPromise
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
      const kids = await kidsPromise
      const listed = (kids && kids.ok === true && Array.isArray(kids.data)) ? kids.data : []
      const picked = childrenOf(listed, key)
      const children = picked.children
      const notes = []
      if (scope.effortId) notes.push(mdScopeNote(scope.scene, scope.effortId))
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
        // 索引签名只为让下面按票号存、按票号取能过编译；键与值的算法一个字没改。
        const stateByKey: Record<string, unknown> = {}
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
      // 行级明细缺省全量：只有显式传 thin 才变薄。统计、进度表、阻塞键都用全量行算好
      // 再薄行，数字与 full 一字不差；行里不带正文，回包小、票多时不断。
      // 远端传输量今天不变（瘦的是回包，不是这一趟的拉取），注记里如实说。
      const thin = String(a.detail || 'full').trim().toLowerCase() === 'thin'
      if (thin) notes.push('子票行是薄的（detail=thin：无正文无行级进度，回包小、清单不断；统计与进度表照算不变；要正文用 deck_issue_get 逐张取，远端拉取量今天与 full 相同）。')
      // labels 是后端回来的运行时真值（元素可能是名字串，也可能是带 name 的对象，契约层没建模），
      // 所以给 data.map 里那个回调参数就地标 any：取到的值、判据与顺序与老写法逐字相同。
      return {
        value: {
          status: partial ? DECK_STATUS.PARTIAL : DECK_STATUS.OK,
          reason: partial ? REFUSAL_REASONS.BACKEND_UNSUPPORTED : '',
          text: partial ? '地图 ' + key + '：子票没取全（后端没给全），手上这 ' + children.length + ' 张算出来的数偏乐观，先重调一次再看数。' : '地图 ' + key + '：子票 ' + children.length + ' 张，未关闭 ' + projection.stats.open + ' 张、已关闭 ' + projection.stats.closed + ' 张、可接 ' + projection.stats.frontier + ' 张、被阻塞 ' + projection.stats.blocked + ' 张。',
          data: {
            map: { key: map.key, title: map.title, state: map.state, labels: Array.isArray(map.labels) ? map.labels.map((l: any) => (l && l.name) || String(l)) : [], updatedAt: map.updatedAt || '', url: map.url || '' },
            children: shown.map((t) => (thin ? thinRow(t) : childRow(t))),
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
