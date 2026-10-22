// src/deck/tools/map-plan-create.ts —— deck_map_plan_create（#713 第六批，本批价值最高的一个；#1019 换到新树、#1035 转 TypeScript）
//
// 一次把一整张地图的骨架建出来：地图票 + 一票子票 + 子票之间的依赖边，最后逐项校验计数。
// 它贵，所以三件事都做在明面上：
//   1. **先算账再动手**：调用前算出点数、出站请求条数、会不会超单次顶、建议分几片（refresh-core/src/tool-cost.ts）；
//      超过一片就只做第一片，把「下一次要带的子票清单」原样回给 AI，自己绝不一口气建几百张。
//   2. **可续跑的中间态**：每建成一张票、每建成一条边都记一笔（deps.planStore 落盘；没注入时按工作区
//      目录建文件游标，再不行退化成进程内存，那时返回值里会如实说「这次不是落盘的」）。
//      重跑同一个 planId：已经建成的键直接跳过，不再花钱。
//   3. **逐项校验**：建完按父票列一遍子票，把「计划几张、实际几张」对一次，数字对不上就说 partial，不假装成功。
//
// 幂等靠契约层（#711）：每一个建票动作都带一个由 planId 推出来的锚，重试同一次计划不会多出票。
// 限时（#895）：整包活包一层调用上下文——剩余额度不够就停发新调用（部分成功+游标），
// 每一次远端调用单独钳制，超时只坏自己那一项；同计划标识并发第二跑直接拒绝。
import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { withCallScope } from '../shell/call-budget.js'
import { createMemoryPlanStore, createFilePlanStore, planCursorDir } from '../shell/plan-cursor.js'
import { matchAnchor, isAnchorHit } from '../../shared/refresh/src/idempotency.js'
import { applyParentEdge, applyBlockEdges, statusOfItems, childrenOf } from '../shell/edge-landing.js'
import { ensureLabels, ensureBody, anchorKeyFor, MAP_BLOCK_TITLES } from '../shell/minimal-spec.js'
// #1413：子票的位置与标签口径只在 rules/object-kind.ts 那份位置表里写一份，这里照它收口，不再自带一套。
import { resolveCreateKind, labelsToEnsure, isTypeLabel, MAP_TICKET_LABELS } from '../rules/object-kind.js'
import type { CreateKindResolution } from '../rules/object-kind.js'
// 「这张票有没有 ## 进度」用共享的进度区剥离判，别在这里再抄一条进度标题的正则。
import { stripProgressSections } from '../../shared/issue-file/src/progress.js'
import * as budget from '../../shared/refresh/src/budget.js'
import { estimateToolCost, toolCostInputFrom } from '../../shared/refresh/src/tool-cost.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { DECK_SANDBOX_TIMEOUT_MS, DECK_STORE_TIMEOUT_MS } from '../../shared/time-config/src/values.js'

export const definition = {
  name: 'deck_map_plan_create',
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。一次建一整张 map 的骨架（map ISSUE + child ISSUE + 依赖边），带逐项校验与可续跑中间态。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '地图票的标题' },
      body: { type: 'string', description: '地图正文；缺省时自动补五个区块' },
      planId: { type: 'string', description: '这次计划的标识；重跑时带同一个值就能接着上次没做完的部分继续；想建第二张内容相同的计划时传一个不同的值' },
      children: {
        type: 'array',
        description: '要建的子票清单',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '计划内的短标识，边用它来指代这张票' },
            title: { type: 'string' },
            body: { type: 'string' },
            kind: { type: 'string', enum: ['map-ticket', 'bug', 'issue'], description: '这张子票是三种位置里的哪一种：map-ticket（地图工单，必须同时给 label，四选一）/ bug（缺陷票）/ issue（普通票）。地图本体由这个工具自己建，不要放进 children。' },
            label: { type: 'string', enum: MAP_TICKET_LABELS, description: '地图工单的种类，只在 kind=map-ticket 时给：wayfinder:research / wayfinder:prototype / wayfinder:grilling / wayfinder:task，四选一；别的 kind 别给。' },
            labels: { type: 'array', items: { type: 'string' } },
            assignees: { type: 'array', items: { type: 'string' } },
          },
          required: ['key', 'title', 'kind'],
          additionalProperties: false,
        },
      },
      edges: {
        type: 'array',
        description: '子票之间的边；from 是计划内的短标识（也可以是地图自己，写 @map）',
        items: {
          type: 'object',
          properties: { from: { type: 'string' }, to: { type: 'string' }, type: { type: 'string', enum: ['blocked-by', 'parent'] } },
          required: ['from', 'to'],
          additionalProperties: false,
        },
      },
      labels: { type: 'array', items: { type: 'string' } },
      workRouteDetail: { type: 'string', enum: ['core', 'standard'], description: '成功后回执里在办表（data.workRoute）带多细：core 只带票号、会话、时间（缺省，最多 20 条），standard 再加标题与动作（全部条目）' },
      effortId: { type: 'string', description: '只有本地后端需要填，填票所在的目录名，根目录的不填' },
    },
    required: ['title', 'children'],
    additionalProperties: false,
  },
}

/** 同计划标识的并发执行互斥（进程内）：第二跑直接拒绝，不与第一跑交错写。 */
const ACTIVE_PLANS = new Map()

/** 地图骨架里允许的三个子票位置（#1413）：地图工单、缺陷票、普通票；地图本体由工具自己按 kind=map 建，不收进 children。 */
const CHILD_KINDS = ['map-ticket', 'bug', 'issue']

/** 数字型参数的统一收口：正的有限数才要（取整），其余一律当「没给」，由调用方退自己的默认。 */
function numOpt(v: unknown): number | undefined { return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : undefined }
/** 钳制等待的结果：等到了给值；超时或对方自己失败都算「没等到」，调用方一律退老路。 */
type CapResult<T> = { ok: true; value: T } | { ok: false; timedOut?: true }
// 等待竞速：沙箱超时按缺席走老路；游标读超时按空游标（锚预检与幂等键仍是去重权威，不多出票），写超时吞掉。
function withCap<T>(promise: Promise<T> | T, ms: number): Promise<CapResult<T>> { return Promise.race([Promise.resolve(promise).then(function (v): CapResult<T> { return { ok: true, value: v } }, function (): CapResult<T> { return { ok: false } }), new Promise<CapResult<T>>(function (resolve) { setTimeout(function () { resolve({ ok: false, timedOut: true }) }, ms) })]) }

/**
 * 宿主的文件读写能力：每样都可能缺（缺了就不落盘），下面用它之前都先判过一次类型。
 * 读写两样收的是 unknown 而不是路径串：宿主那份文件服务是目标形状（吃 resolve() 的产物），
 * 老形状才收路径串，两条都从这一格过（见 storeIoFrom 里那一段）。
 */
type HostFs = {
  resolve?: (p: string, o?: unknown) => unknown
  readText?: (p: unknown) => unknown
  writeText?: (p: unknown, t: string) => unknown
  mkdir?: (p: unknown) => unknown
}

/** 宿主能力袋：backendCtx 回的就是它（平台工具与文件读写）；缺哪样就退哪条老路。 */
type HostBackendCtx = { platform?: { path?: { join: (a: string, c: string) => string }; fs?: HostFs }; fs?: HostFs } | null | undefined

/**
 * 按注入的宿主能力组一份「文件读写 + 目录」给计划游标用：宿主给了 backendCtx 就走它，没给就退回注入袋本身。
 * 路径优先用平台的 path.join（宿主换别的分隔符也跟着走），没有就按 `/` 拼。缺一样能力就回 null，
 * 调用方退到内存游标，并在回执里如实说「这次没有落盘」。
 */
function storeIoFrom(deps: DeckMapPlanCreateDeps, cwd: string | undefined) {
  try {
    // backendCtx 回什么只有装配层知道，这里按 HostBackendCtx 收口（纯类型断言，取到的还是那个值）：
    // 编译器看不穿「可选依赖 + typeof 判过再调」这一段，收一下口才能往下读 platform / fs。
    const b = ((deps && typeof deps.backendCtx === 'function') ? deps.backendCtx() : deps.backendCtx) as HostBackendCtx
    const platform = (b && b.platform) || null
    const fs = (b && b.fs) || (platform && platform.fs) || null
    if (!platform || !fs || typeof fs.resolve !== 'function' || typeof fs.readText !== 'function' || typeof fs.writeText !== 'function') return null
    // 这几样能力在下面的闭包里还会再读一次：typeof 判过的那道收窄带不进闭包（编译器只对 const 变量保留收窄），
    // 所以按 `!` 收口 —— 纯类型断言，读的还是同一格、同一个 this，真缺的时候照样抛 TypeError。
    const join = (platform.path && typeof platform.path.join === 'function')
      ? function (a: string, c: string) { return platform.path!.join(a, c) }
      : function (a: string, c: string) { return String(a).replace(/\\/g, '/') + '/' + c }
    const dir = planCursorDir(cwd, join)
    // 读写前一律先 resolve：宿主那份文件服务是目标形状 —— readText / writeText 收的是 resolve() 的产物
    // （{ targetKey, displayPath }），给裸路径串会被拒（docs/cache-and-diagnostics.md 第 7.1 节）。
    // 这条老路（没有注入存储器、由本文件自建 IO）以前直接把路径串递过去，于是写盘每次都被拒、而拒掉是静默的
    // ——回执照样说 durable:true（#1150 抓到的就是这一格）。
    // 没有 resolve 就整条不建（2026-10-14 深挖补的一刀）：造不出目标对象，硬写就只能递裸路径串，
    // 那等于把这个坑原样带回来；退回内存并在回执里如实说 durable:false，才是诚实的。
    const rs = (fs as HostFs).resolve as (p: string, o?: unknown) => unknown
    const target = function (p: string) { return Promise.resolve(rs(p)) }
    return {
      readText: function (p: string) { return target(p).then(function (t) { return fs.readText!(t) }) },
      writeText: function (p: string, t: string) { return target(p).then(function (x) { return fs.writeText!(x, t) }) },
      mkdir: (typeof fs.mkdir === 'function') ? function (p: string) { return fs.mkdir!(p) } : undefined,
      dir: dir,
    }
  } catch (e) { return null }
}

/**
 * 装配层注入的依赖袋：这里只列本工具会主动去调的键，缺席时各自退默认（那行索引签名兜住其余键——
 * 装配时是把整袋依赖递进来的，多出来的键一律原样透传给壳）。
 */
export interface DeckMapPlanCreateDeps {
  readonly [key: string]: unknown
  /** 宿主能力袋：文件读写与平台工具从这儿取（本地后端要把计划游标落盘）；回不来就按工作区目录自己拼一份。 */
  backendCtx?: () => HostBackendCtx
  /**
   * 计划游标存储器（#1150）。两种形状都收：
   *   · 现成的一份（形状见下面 PlanStoreLike）：测试与别的宿主直接给；
   *   · 按这次调用现造的工厂 `(info: { cwd, workspaceKey }) => store | null`：宿主接线走这条 —— 装配在进程
   *     启动时只跑一次，那时还不知道这次调用落在哪个工作区，而游标按工作区分区（文件名里带工作区键），
   *     所以由工厂在拿到工作区键之后现造一份。工厂回不来（缺文件能力）就退到本文件自建的那条路。
   */
  planStore?: unknown
  /** 沙箱许可策略：给工作区与会话，回这一轮的策略快照；两个值原样传，可能还没有。 */
  sandboxPolicyFor?: (arg: { cwd: string | undefined; sessionId: string | undefined }) => Promise<unknown>
  /** 时钟旁路：测试里换假时钟用，缺省 Date.now。 */
  now?: () => number
  /** 建号钩子：地图票建好之后通知调用方一声（#746 地图票直达命名守护），抛错吞掉、不影响返回。 */
  onTicketCreated?: (arg: { sessionId: string; key: string; title: string }) => unknown
}

/** 一次计划的中间态：mapKey 是地图票号，keys 是计划内短标识到真票号的映射，其余两格是已办事项与已落的边。 */
type PlanState = {
  planId: string
  mapKey: string
  keys: Record<string, string>
  edges: unknown[]
  done: unknown[]
}

/** 计划游标存储器（注入的 d.planStore，或本文件现建的文件/内存游标）：load 取上次的中间态，save / remove 各写一次。 */
type PlanStoreLike = {
  durable?: unknown
  load: (planId: string) => PlanState | null | Promise<PlanState | null>
  save: (planId: string, state: PlanState) => unknown
  remove?: (planId: string) => unknown
}

/** 工具定义是唯一事实（参数与给 AI 看的那段话就在上面那份 definition 里，别处不要再抄一份）；装配层调一次拿到 { definition, run }。 */
export function createDeckMapPlanCreate(deps?: DeckMapPlanCreateDeps) {
  const d: DeckMapPlanCreateDeps = deps || {}
  const shell = createDeckShell(Object.assign({}, d, {
    estimate: d.estimate || estimateToolCost,
    costInputFrom: d.costInputFrom || toolCostInputFrom,
  }))
  // 两处游标存储器都写明状态类型：plan-cursor.ts 把「游标里装什么」做成类型参数，
  // 这里装的就是本文件那份 PlanState（纯类型实参，产物一个字节都不变）。
  const fallbackStore = createMemoryPlanStore<PlanState>()
  const nowFn = (typeof d.now === 'function') ? d.now : Date.now

  /** 工具入口：exec 是宿主给的执行上下文（只读它的 signal 取消信号），args 是 AI 传的参数；回执由壳层包成最终回执。 */
  async function run(exec: unknown, args: Record<string, unknown>): Promise<unknown> {
    // 预算起算点：入口前耗时（会话归一、选后端、探沙箱、游标包装）也要算进预算（#1195）。
    const toolEntryAt = nowFn()
    const a: Record<string, unknown> = args || {}
    const title = String(a.title === undefined || a.title === null ? '' : a.title).trim()
    // 子票与边都是 AI 传来的对象数组：这里只按「有没有那几格」筛一遍，筛出来的元素仍是运行时原值。
    const children = Array.isArray(a.children) ? a.children.filter((c: Record<string, unknown>) => c && c.key && c.title) : []
    const edges = Array.isArray(a.edges) ? a.edges.filter((e: Record<string, unknown>) => e && e.from && e.to) : []
    const est = shell.estimateFor('deck_map_plan_create', a)
    const s = await sessionContextOfAsync(exec, { canonicalKey: d.canonicalKey, workspaceKeyOf: d.workspaceKeyOf })
    // 会话没解析出来时回的是「为什么」那一支。编译器分不出两支（ok 是会话壳里的运行时布尔，那一层还没标类型，
    // 见 #1040），所以这里按形状取 reason —— 取到的值与老写法逐字相同。
    if (!s.ok) return shell.unsupported('deck_map_plan_create', (s as { reason: string }).reason, s.text, { cost: { estimated: est } })
    if (!title || !children.length) {
      return shell.unsupported('deck_map_plan_create', REFUSAL_REASONS.BAD_ARGS, '建整张地图至少要给 title 与一张子票（children 里每项要有 key 与 title）。', { cost: { estimated: est } })
    }
    // #1413：子票改用两层词表。先在动手之前把每个 child 的位置与标签收口一遍，任何一张说不清就整批拒绝 ——
    // 这时还没选后端、没开计划锁、没发一个调用，盘上一张票都不会动。
    // 为什么 parentKey 固定传 '@map'：这个工具的子票父票永远是本次计划的地图票（state.mapKey），children 不再收
    // parentKey；占位符只为让共用规则层去做「地图工单必须挂父票」这一道判断，落盘时用的仍是真票号。
    const childKinds = new Map<string, CreateKindResolution>()
    for (const ch of children) {
      const planKey = String(ch.key)
      const rawKind = String(ch.kind === undefined || ch.kind === null ? '' : ch.kind).trim()
      let problem = ''
      if (CHILD_KINDS.indexOf(rawKind) < 0) {
        if (!rawKind) problem = '缺 kind：地图骨架的子票要说明位置，三选一：map-ticket（地图工单，必须同时给 label）、bug（缺陷票）、issue（普通票）。'
        else if (rawKind === 'task') problem = '传了旧的 kind=task：地图骨架里不再按 task 建票 —— 要当地图工单请改成 kind=map-ticket 并给 label（四选一：wayfinder:research / wayfinder:prototype / wayfinder:grilling / wayfinder:task）；只是普通票就改成 kind=issue。'
        else if (rawKind === 'ticket') problem = '传了旧的 kind=ticket：那是规格下的实施票，请改用 deck_issue_create 的 kind=spec-ticket 建；地图骨架的子票只认 map-ticket、bug、issue。'
        else if (rawKind === 'map') problem = '传了 kind=map：地图本体由这个工具自己建（固定一张），children 里只放子票 —— map-ticket、bug、issue 三选一。'
        else if (rawKind === 'spec' || rawKind === 'spec-ticket') problem = '传了 ' + rawKind + '：规格票与实施票要走 deck_issue_create 建，不在地图骨架里；这里只认 map-ticket、bug、issue。'
        else problem = '没有这个位置值「' + rawKind.slice(0, 40) + '」：地图骨架的子票只认 map-ticket、bug、issue 三个值。'
      }
      const resolved: CreateKindResolution = problem
        ? { ok: false, problem: problem }
        : resolveCreateKind({ kind: rawKind, label: ch.label, labels: ch.labels, parentKey: '@map' })
      if (!resolved.ok) {
        return shell.unsupported('deck_map_plan_create', REFUSAL_REASONS.BAD_ARGS, '子票「' + planKey.slice(0, 40) + '」' + String(resolved.problem || '没说明原因') + '这一批子票都没建，一张票都没动。', { cost: { estimated: est } })
      }
      childKinds.set(planKey, resolved)
    }
    // #1245：自动计划标识必须稳定（不带时间窗），否则重试跨过 5 分钟窗口就会变成新计划、按新锚建重复票。
    // 显式 planId 优先；没传时用内容哈希（会话或工作区加标题加子键），同一份输入永远得到同一个标识。
    // 为什么传 now: 0：anchorKeyFor 的锚含窗口序号，传 0 即固定在 0 号窗口；前缀 auto- 与调用方手写的计划标识区分。
    const autoPlanId = 'auto-' + anchorKeyFor({ tool: 'deck_map_plan_create', sessionId: s.sessionId, workspaceKey: s.workspaceKey, title: title, labels: children.map((c) => c.key), now: 0 })
    const usingAutoPlanId = (a.planId === undefined || a.planId === null || String(a.planId).trim() === '')
    const planId = String(usingAutoPlanId ? autoPlanId : String(a.planId))
    if (ACTIVE_PLANS.get(planId)) {
      return shell.unsupported('deck_map_plan_create', REFUSAL_REASONS.BACKEND_UNSUPPORTED, '同一个计划标识（' + planId.slice(0, 60) + '）正在另一次执行里跑（进行中），这次没动手：等它做完再来，或换一个 planId。', { cost: { estimated: est } })
    }
    ACTIVE_PLANS.set(planId, 1)
    const pick = await shell.pickBackend(exec, s)
    if (!pick.ok) { ACTIVE_PLANS.delete(planId); return shell.unsupported('deck_map_plan_create', pick.reason, pick.text, { workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est } }) }
    const repo = shell.repoOf(pick, s)
    const effortId = (a.effortId === undefined || a.effortId === null) ? '' : String(a.effortId).trim()
    if (effortId) repo.effortId = effortId

    // d.planStore 在依赖袋里是 unknown（装配层塞进来的运行时对象，形状由 plan-cursor.ts 定）：读取各按
    // 纯类型断言收口 —— 读的还是同一格 d.planStore，取值表达式一字不动；形状不对就退到下面现建的文件游标。
    // #1150：注入的既可能是现成的一份，也可能是工厂（装配层那时还不知道这次调用落在哪个工作区）；
    // 工厂抛错、或回的东西不成形，都按「没有注入」处理，往下走本文件自建的那条路。
    let store: PlanStoreLike | null = null
    try {
      const injected = (typeof d.planStore === 'function')
        ? (d.planStore as (info: { cwd: string | undefined; workspaceKey: unknown }) => unknown)({ cwd: s.cwd, workspaceKey: s.workspaceKey })
        : d.planStore
      store = (injected && typeof (injected as PlanStoreLike).load === 'function') ? (injected as PlanStoreLike) : null
    } catch (eInjected) { store = null }
    if (!store) {
      const built = storeIoFrom(d, s.cwd)
      store = built ? createFilePlanStore<PlanState>({ io: built, dir: built.dir, workspaceKey: s.workspaceKey, now: nowFn }) : fallbackStore
    }
    // 游标读写加竞速：挂住的文件服务不能卡住整笔建图。读超时按空游标继续——去重权威
    // 从来不是游标，而是幂等锚预检与建票幂等键，只多花几次列表读数，不多出票；写超时吞掉。
    const rawStore = store
    store = {
      durable: rawStore.durable,
      load: function (id: string) {
        return withCap(rawStore.load(id), DECK_STORE_TIMEOUT_MS).then(function (r) { return (r && r.ok === true) ? r.value : null })
      },
      save: function (id: string, st: PlanState) {
        return withCap(rawStore.save(id, st), DECK_STORE_TIMEOUT_MS).then(function () {}, function () {})
      },
      remove: (typeof rawStore.remove === 'function') ? function (id: string) {
        // 这一支里 remove 一定在（上面那个 typeof 已经判过）；断言只为让编译器安静（它不把闭包外的收窄带进来），
        // 运行时一个字节都不动 —— 真为空时这里照样抛 TypeError。
        return withCap(rawStore.remove!(id), DECK_STORE_TIMEOUT_MS).then(function () {}, function () {})
      } : undefined,
    }

    // exec 上那个取消信号。契约层还没给 exec 标形状（见 #1040），三处 exec.signal 各按纯类型断言收口：
    // 取值表达式一字不动，所以转译出来的 JS 与转换前逐字节一致。
    let out = null
    try {
      out = await shell.call({ tool: 'deck_map_plan_create', kind: 'write', session: s, pick: pick, repo: repo, estimate: est, sandbox: (await (async function () { try { if (typeof d.sandboxPolicyFor !== 'function') return null; const raced = await withCap(d.sandboxPolicyFor({ cwd: s.cwd, sessionId: s.sessionId }), DECK_SANDBOX_TIMEOUT_MS); return (raced && raced.ok === true) ? raced.value : null } catch (eS) { return null } })()), signal: (exec && (exec as { signal?: unknown }).signal && typeof (exec as { signal?: unknown }).signal === 'object') ? (exec as { signal?: unknown }).signal : undefined }, async (c: unknown) => {      const sc = withCallScope(c, exec, { timeoutMs: numOpt(d.toolTimeoutMs), marginMs: numOpt(d.toolMarginMs), startedAt: toolEntryAt, now: nowFn })
      // 走到这里 tracker 一定在（预算壳自己的约定：能进这一段就是选好后端了）；
      // 断言只为让编译器安静，运行时一个字节都不动 —— 真为空时下面那句照样抛 TypeError 走 backend-threw。
      const t = sc.tracker!
      const opCtx = sc.opCtx
      const prev = (await store.load(planId)) || { planId: planId, mapKey: '', keys: {}, edges: [], done: [] }
      const state: PlanState = { planId: planId, mapKey: prev.mapKey || '', keys: Object.assign({}, prev.keys), edges: Array.isArray(prev.edges) ? prev.edges.slice() : [], done: Array.isArray(prev.done) ? prev.done.slice() : [] }
      const items = []
      const notes = []
      if (effortId) notes.push('这次带了 effortId（' + effortId.slice(0, 60) + '）：本地后端只在那一个目录里找，远端后端忽略它。')
      if (usingAutoPlanId) notes.push('这次没传 planId，用了自动计划标识（' + planId.slice(0, 80) + '）：重试时必须显式传回这个 planId，否则会被当成新计划建重复票；想建第二张内容相同的计划时，必须显式传一个不同的 planId，否则会被当成重试而复用旧票。')
      const storeDurable = store.durable !== false
      if (!storeDurable) notes.push('这次的中间态只记在本进程的内存里（没有注入落盘的存储器）：进程重启后重跑同一个 planId 会重新建票。')
      let stoppedEarly = false

      // ① 地图票本身：只建一次，锚由 planId 推出来。
      if (!state.mapKey) {
        const mapEnsured = ensureBody(a.body, 'map')
        const created = await t.create(repo, {
          title: title, body: mapEnsured.body, type: 'map', labels: ensureLabels(a.labels, 'map').labels,
          idempotencyKey: 'deck-plan-' + planId + '-map',
        }, opCtx)
        if (!created || created.ok !== true) {
          const msg = String((created && created.error && created.error.message) || '后端没给出原因').slice(0, 300)
          return {
            value: { status: DECK_STATUS.UNSUPPORTED, reason: REFUSAL_REASONS.BACKEND_UNSUPPORTED, text: '地图票没建成（后端原话：' + msg + '），后面的子票与边都没动。', data: { planId: planId, error: { kind: String((created && created.error && created.error.kind) || ''), message: msg } }, notes: notes },
            claimed: { requests: 1, points: 4 },
          }
        }
        state.mapKey = String((created.data && created.data.key) || '')
        state.done.push('map')
        await store.save(planId, state)
        items.push({ key: state.mapKey, role: 'map', title: title, status: 'ok' })
      } else {
        notes.push('地图票 ' + state.mapKey + ' 上次已经建好了，这次直接接着做。')
        items.push({ key: state.mapKey, role: 'map', title: title, status: 'ok', skipped: true })
      }

      // ①b 批量锚预检：一次列表把已建的子票认回来（命中就跳过创建）；拿不准就照常走，不挡事。
      try {
        const untouched = children.filter((ch) => !state.keys[String(ch.key)])
        if (untouched.length) {
          const all = await t.list(repo, { state: 'all' }, opCtx)
          const rows = (all && all.ok === true && Array.isArray(all.data)) ? all.data : null
          const cands = rows ? rows.filter((r: Record<string, unknown>) => r && typeof r.body === 'string').map((r: Record<string, unknown>) => ({ key: String(r.key), body: r.body, state: r.state })) : []
          if (cands.length) {
            for (const ch of untouched) {
              let m = null
              try { m = matchAnchor(cands, repo.refId, 'deck-plan-' + planId + '-child-' + String(ch.key)) } catch (eM) { m = null }
              if (m && isAnchorHit(m)) {
                // 命中那一支的形状（带 key）与没命中那一支（带 status / reason）编译器合不成一个，按类型断言取 key，取到的值一字不动。
                state.keys[String(ch.key)] = String((m as { key?: string }).key)
                state.done.push('child:' + String(ch.key))
                items.push({ key: String((m as { key?: string }).key), role: 'child', planKey: String(ch.key), title: String(ch.title), status: 'ok', skipped: true })
              }
            }
            await store.save(planId, state)
          }
        }
      } catch (ePre) {}

      // ② 子票：按分片上限做这一片；已经建成的键跳过（这就是「续跑要跳过的键」）。
      // 这一片同时建（各子票互相独立；本地后端的取号落盘在房间的写者队列里串行，不会取重号）。
      // 结果按分片顺序合回，中间态一次一存；剩余额度不够时主动停：剩下的记进 restKeys，下一次带同 planId 接着建。
      const pending = children.filter((ch) => !state.keys[String(ch.key)])
      const skippedKeys = children.filter((ch) => state.keys[String(ch.key)]).map((ch) => String(ch.key))
      // #1245：孤儿修复——已建跳过的子票若父边缺失（首次建后挂边前被掐断），在此补挂，不再建新票。
      // 为什么只修跳过的：待建的子票本次新建时自带 parentKey；跳过的已落盘但可能父票为空（快照按父票列时看不到它们）。
      // 判据只认写后读回的结构字段，读不回来就不修、不报错；剩余额度不够时也不修，等下一次带同 planId 再来。
      if (skippedKeys.length && state.mapKey && !sc.outOfBudget()) {
        const repairs = await Promise.all(skippedKeys.map(async (planKey) => {
          const ticketKey = String(state.keys[String(planKey)] || '')
          if (!ticketKey || sc.outOfBudget()) return null
          let got = null
          try { got = await t.get(repo, ticketKey, {}, opCtx) } catch (eGet) { got = null }
          const lived = (got && (got as { ok?: unknown }).ok === true) ? ((got as { data?: unknown }).data as Record<string, unknown> | null) : null
          const liveParent = lived ? String((lived as Record<string, unknown>).parentKey ?? '') : ''
          if (!lived || liveParent === String(state.mapKey)) return null
          try {
            const r = await applyParentEdge(t, repo, opCtx, ticketKey, state.mapKey)
            return { planKey: planKey, ticketKey: ticketKey, item: (r as { item?: unknown }).item, applied: !!(r as { applied?: unknown }).applied }
          } catch (eRep) { return null }
        }))
        let repaired = 0
        for (const r of repairs) {
          if (!r) continue
          if (r.applied) {
            repaired += 1
            state.done.push('repaired-parent:' + String(r.planKey))
            items.push(Object.assign({ role: 'edge', planKey: String(r.planKey) }, (r.item as Record<string, unknown> || {})))
          } else if (r.item) {
            items.push(Object.assign({ role: 'edge', planKey: String(r.planKey) }, (r.item as Record<string, unknown>)))
          }
        }
        if (repaired) {
          notes.push('续跑时补挂了 ' + repaired + ' 张孤儿票的父边（首次建后挂边前被掐断留下的）：' + skippedKeys.slice(0, 8).join('、') + '。')
          await store.save(planId, state)
        }
      }
      const shard = pending.slice(0, est.perShard)
      let restKeys = pending.slice(est.perShard).map((ch) => String(ch.key))
      const made = await Promise.all(shard.map(async (ch) => {
        if (sc.outOfBudget()) return { ch: ch, over: true, created: null }
        // 位置与标签在入口已经收口过了（见 childKinds）：这里只按那份答案建票。
        // 契约类型照位置表给的用（三种子票都是 issue）；Type 行只有地图工单写，值是 label 去掉 wayfinder: 前缀的裸词；
        // 缺陷票与普通票显式给空串，后端就不会再从标签里猜一个 Type 出来。
        const resolved = childKinds.get(String(ch.key))
        const kind = (resolved && resolved.kind) ? resolved.kind : 'issue'
        const label = (resolved && resolved.label) ? resolved.label : ''
        const ensured = ensureLabels(ch.labels, kind, label)
        const body = ensureBody(ch.body, kind)
        const created = await t.create(repo, {
          title: String(ch.title).trim(), body: body.body, type: (resolved && resolved.contractType) ? resolved.contractType : 'issue',
          typeLine: kind === 'map-ticket' ? label.replace(/^wayfinder:/, '') : '',
          labels: ensured.labels,
          parentKey: state.mapKey, assignees: Array.isArray(ch.assignees) && ch.assignees.length ? ch.assignees : undefined,
          idempotencyKey: 'deck-plan-' + planId + '-child-' + String(ch.key),
        }, opCtx)
        return { ch: ch, over: false, created: created }
      }))
      const overKeys = []
      for (const o of made) {
        if (o.over) { stoppedEarly = true; overKeys.push(String(o.ch.key)); continue }
        const created = o.created
        if (created && created.ok === true) {
          state.keys[String(o.ch.key)] = String((created.data && created.data.key) || '')
          // 子票建成了，但父子边是另一件事：房把挂父失败记在票上的 parentError 里（issues-write.ts 的 IssueWithNotes），
          // 这里必须读它 —— 否则整图建骨架会在每条父子边都没挂上的情况下报 status:'ok'（#790 审查指出）。
          // 为什么断言：契约的 Issue 没声明 parentError 这一格，断言只为过编译，读的还是原来那一格。
          const childBag = (created.data || {}) as { parentError?: { message?: unknown } }
          const pErr = (childBag.parentError && childBag.parentError.message) ? String(childBag.parentError.message).slice(0, 200) : ''
          if (pErr) {
            items.push({ key: state.keys[String(o.ch.key)], role: 'child', planKey: String(o.ch.key), title: String(o.ch.title), status: 'failed', reason: '子票建成了（票号 ' + (state.keys[String(o.ch.key)] || '后端没回票号') + '），但父子边没挂上：' + pErr })
          } else {
            state.done.push('child:' + String(o.ch.key))
            items.push({ key: state.keys[String(o.ch.key)], role: 'child', planKey: String(o.ch.key), title: String(o.ch.title), status: 'ok' })
          }
        } else {
          const msg = String((created && created.error && created.error.message) || '后端没给出原因').slice(0, 200)
          items.push({ key: '', role: 'child', planKey: String(o.ch.key), title: String(o.ch.title), status: 'failed', reason: msg })
        }
        await store.save(planId, state)
      }
      restKeys = overKeys.concat(restKeys)

      // ③ 边：端点都在计划里才做；落点由写后读回判（写加判见 edge-landing.ts 的共用函数）。
      // #898：设置阻塞边是整批替换语义，同一张票的多条阻塞边先合并成完整集合再写一次，
      // 否则后一次写会删掉前一次写上的边；校验按本次该票的全部目标逐个核对。
      // 同一张票的写组内逐条来（同时写同一张票会丢一次改动），不同票的组同时写；
      // 结果按边的传入顺序合回，中间态落盘与原来一样逐条记。
      const keyOf = (ref: unknown) => (String(ref) === '@map' ? state.mapKey : (state.keys[String(ref)] || ''))
      let edgeCount = 0
      const edgeJobs = []
      for (const e of edges) {
        const from = keyOf(e.from), to = keyOf(e.to)
        if (!from || !to) { items.push({ key: from || '', role: 'edge', status: 'failed', reason: '边的端点还没有票号（' + String(e.from) + ' → ' + String(e.to) + '）：先把它那一张建出来再补这条边。' }); continue }
        edgeJobs.push({ idx: edgeJobs.length, from: from, to: to, parent: e.type === 'parent' })
      }
      const parentByFrom = new Map()
      for (const j of edgeJobs) if (j.parent) { if (!parentByFrom.has(j.from)) parentByFrom.set(j.from, []); parentByFrom.get(j.from).push(j) }
      const blockByFrom = new Map(), blockOrder = []
      for (const j of edgeJobs) {
        if (j.parent) continue
        let g = blockByFrom.get(j.from)
        if (!g) { g = { targets: [], occ: [] }; blockByFrom.set(j.from, g); blockOrder.push(j.from) }
        if (g.targets.indexOf(j.to) < 0) g.targets.push(j.to)
        g.occ.push(j)
      }
      const edgeRecs = []
      if (!sc.outOfBudget() && edgeJobs.length) {
        const parentOut = await Promise.all(Array.from(parentByFrom.values()).map(async (list) => {
          const out = []
          for (const j of list) {
            if (sc.outOfBudget()) { out.push({ idx: j.idx, over: true }); continue }
            const r = await applyParentEdge(t, repo, opCtx, j.from, j.to)
            out.push({ idx: j.idx, over: false, item: r.item, rec: r.applied ? { from: j.from, to: j.to, op: 'parent' } : null, save: r.applied })
          }
          return out
        }))
        const blockOut = await Promise.all(blockOrder.map(async (from) => {
          const g = blockByFrom.get(from)
          if (sc.outOfBudget()) return g.occ.map((j: { idx: number; to: string }) => ({ idx: j.idx, over: true }))
          const r = await applyBlockEdges(t, repo, opCtx, from, g.targets, g.occ.map((j: { idx: number; to: string }) => j.to))
          // r.applied 一支是空数组（推成 never[]）、一支是真正落上的票号，编译器合不出一个收得下字符串的类型，
          // 这里按 string[] 收口 —— 纯类型断言，值一字不动。
          return g.occ.map((j: { idx: number; to: string }, k: number) => ({ idx: j.idx, over: false, item: r.items[k], rec: (r.applied as string[]).indexOf(j.to) >= 0 ? { from: from, to: j.to, op: 'block' } : null, save: k === g.occ.length - 1 && !r.failed }))
        }))
        for (const group of parentOut) for (const o of group) edgeRecs.push(o)
        for (const group of blockOut) for (const o of group) edgeRecs.push(o)
        edgeRecs.sort((x, y) => x.idx - y.idx)
        for (const o of edgeRecs) {
          if (o.over) { stoppedEarly = true; continue }
          items.push(o.item)
          if (o.rec) { edgeCount += 1; state.edges.push(o.rec); state.done.push('edge:' + o.rec.from + '-' + o.rec.op + '-' + o.rec.to) }
          if (o.save) await store.save(planId, state)
        }
      } else if (edgeJobs.length) { stoppedEarly = true }

      // ④ 逐项校验：按父票把子票列一遍，计划几张、实际几张，数字对不上就说 partial。
      // 剩余额度不够时跳过这一步（以“没校验”如实返回，不硬撑）。
      const listed = sc.outOfBudget() ? null : await t.list(repo, { parentKey: state.mapKey }, opCtx)
      const liveRows = (listed && listed.ok === true && Array.isArray(listed.data)) ? listed.data : null
      const picked = liveRows ? childrenOf(liveRows, state.mapKey) : { children: null, filtered: false, note: '' }
      const plannedLive = Object.keys(state.keys).length
      // 逐项校验的计数：actual 先写 null（表示「拿不到」），下面按父票列出来的结果再改写一次，形状固定下来。
      let counts: { planned: number; actual: number | null; ok: boolean; compared: unknown } = { planned: plannedLive + 1, actual: null, ok: false, compared: picked.filtered }
      if (picked.children) {
        counts = { planned: plannedLive + 1, actual: picked.children.length + 1, ok: picked.children.length === plannedLive, compared: picked.filtered }
      }
      if (!counts.ok) notes.push('逐项校验没对上：计划里有 ' + counts.planned + ' 张（含地图票），按父票列出来 ' + (counts.actual === null ? '拿不到（后端没给出原因）' : counts.actual + ' 张') + '。以这个数字为准，别按计划数字往下走。')
      if (picked.note) notes.push(picked.note)

      // ④b 建后读回核对（#1413）：张数对上只说明计数没错，类型标签、父票与 ## 进度还得落到盘上才算对。
      // 地图读一次；子票用上面按父票列出来的那一批逐张核，不另发列表调用，所以 claimed 仍按估算报。
      // 读不回来就如实说「这次没核对」，不硬判失败；核出问题记进 items（failed），结论自然落到 partial。
      if (state.mapKey && !sc.outOfBudget()) {
        const problems: string[] = []
        let mapRow: Record<string, unknown> | null = null
        try {
          const gotMap = await t.get(repo, state.mapKey, {}, opCtx)
          mapRow = (gotMap && (gotMap as { ok?: unknown }).ok === true) ? (((gotMap as { data?: unknown }).data as Record<string, unknown> | null) || null) : null
        } catch (eGetMap) { mapRow = null }
        const mapBody = mapRow ? String(mapRow.body || '') : ''
        if (!mapRow) {
          notes.push('建后读回核对：地图票 ' + state.mapKey + ' 没读回来，这次没核对（不判失败）。')
        } else {
          const heads = MAP_BLOCK_TITLES.map((h) => mapBody.indexOf('## ' + h))
          const missingHeads = MAP_BLOCK_TITLES.filter((h, i) => heads[i] < 0)
          if (missingHeads.length) problems.push('地图缺五节里的：' + missingHeads.join('、'))
          if (stripProgressSections(mapBody) === mapBody) problems.push('地图没有 ## 进度')
          const at = mapBody.search(/^##\s*进度\s*$/m)
          const knownHeads = heads.filter((i) => i >= 0)
          if (at >= 0 && knownHeads.length && at < Math.max.apply(null, knownHeads)) problems.push('地图的 ## 进度没有排在五节之后')
        }
        const rows = Array.isArray(liveRows) ? (liveRows as Record<string, unknown>[]) : []
        const rowByKey = new Map<string, Record<string, unknown>>()
        for (const row of rows) if (row && row.key !== undefined && row.key !== null) rowByKey.set(String(row.key), row)
        // 只有读回来的正文是「整份文件」时才核 Type 行：本地 Markdown 房把整个文件当正文回，文件头除了
        // 幂等锚还会多出 parentKey 与 created 两行注释、正文里有 Status/Labels/Type 字段行；远端房这两行
        // 文件头注释不会落进正文（父边走原生边），正文也就没有 Type 行可核。这里按读回数据的形状判断，
        // 不按后端身份分支 —— 工具层不许拿后端 id 做判断（verify-deck-tools 的静态扫描就查这个）。
        const looksLikeWholeFile = (text: string): boolean => /^\s*<!--\s*(?:parentKey|created)\s*:/m.test(text)
        let checkedTypeLine = false
        for (const ch of children) {
          const planKey = String(ch.key)
          const ticketKey = String(state.keys[planKey] || '')
          const resolved = childKinds.get(planKey)
          if (!ticketKey || !resolved || !resolved.ok) continue
          const row = rowByKey.get(ticketKey)
          if (!row) { problems.push('子票「' + planKey + '」（票号 ' + ticketKey + '）没按父票列出来'); continue }
          const childBody = String(row.body || '')
          const names = (Array.isArray(row.labels) ? row.labels : []).map((x) => {
            return (typeof x === 'string') ? x : String((x && (x as { name?: unknown }).name) || '')
          }).filter(Boolean)
          const lower = names.map((n) => String(n).toLowerCase())
          const expected = labelsToEnsure(resolved.kind, resolved.label)
          const missingLabels = expected.filter((n) => lower.indexOf(String(n).toLowerCase()) < 0)
          if (missingLabels.length) problems.push('子票「' + planKey + '」缺标签：' + missingLabels.join('、'))
          const wantType = expected.filter((n) => isTypeLabel(n)).length
          const gotType = names.filter((n) => isTypeLabel(n)).length
          if (gotType !== wantType) problems.push('子票「' + planKey + '」有 ' + gotType + ' 枚类型标签（应为 ' + wantType + ' 枚）')
          if (String(row.parentKey || '') !== String(state.mapKey)) problems.push('子票「' + planKey + '」的父票是「' + String(row.parentKey || '') + '」（应为地图 ' + state.mapKey + '）')
          if (stripProgressSections(childBody) === childBody) problems.push('子票「' + planKey + '」没有 ## 进度')
          if (looksLikeWholeFile(childBody)) {
            checkedTypeLine = true
            const typeRows = childBody.match(/^\s*Type\s*[：:].*$/gm) || []
            if (resolved.kind === 'map-ticket') {
              const bare = String(resolved.label || '').replace(/^wayfinder:/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              const want = new RegExp('^\\s*Type\\s*[：:]\\s*' + bare + '\\s*$', 'im')
              if (!want.test(childBody)) problems.push('子票「' + planKey + '」的 Type 行不是 ' + bare + '（实得 ' + typeRows.join(' / ').slice(0, 60) + '）')
            } else if (typeRows.length) {
              problems.push('子票「' + planKey + '」不该有 Type 行（实得 ' + typeRows.join(' / ').slice(0, 60) + '）')
            }
          }
        }
        if (problems.length) {
          notes.push('建后读回核对有 ' + problems.length + ' 处没对上：' + problems.slice(0, 4).join('；') + (problems.length > 4 ? '；…' : '') + '。以盘上为准，别按计划数字往下走。')
          for (const one of problems.slice(0, 8)) items.push({ key: '', role: 'verify', status: 'failed', reason: one })
        } else if (mapRow && liveRows) {
          notes.push('建后读回核对通过：地图五节与 ## 进度齐；' + Object.keys(state.keys).length + ' 张子票的父票、类型标签、## 进度' + (checkedTypeLine ? '与 Type 行' : '') + '都对。')
        } else {
          notes.push('建后读回核对：地图读回来了，但子票没按父票列出来（' + String(picked.note || '后端没给出原因') + '），这次没核对子票。')
        }
      } else if (sc.outOfBudget()) {
        notes.push('建后读回核对：剩余额度不够，这次没核对。')
      }

      // #746：地图票直达命名守护（调用会话即建号会话；子票走既有索引轮询分配；hook 不影响返回）。
      try { if (typeof d.onTicketCreated === 'function' && state.mapKey) await d.onTicketCreated({ sessionId: s.sessionId, key: String(state.mapKey), title: title }) } catch (eHook) {}
      const rawStatus = statusOfItems(items)
      // 没做完（限时自停或还有剩余）但逐项全成时，诚实报部分成功，不假装做完。
      const status = (rawStatus === DECK_STATUS.OK && (stoppedEarly || restKeys.length)) ? DECK_STATUS.PARTIAL : rawStatus
      let text = '计划 ' + planId + '：这一片建了 ' + shard.length + ' 张子票（共计划 ' + children.length + ' 张），建成 ' + edgeCount + ' 条边' +
        (restKeys.length ? '；还有 ' + restKeys.length + ' 张没建（' + restKeys.join('、') + '），带同一个 planId 再调一次就接着建。' : '。')
      if (stoppedEarly) text += '时间不够先停在这里（剩余额度不足），已建的不用重建。'
      if (status === DECK_STATUS.OK && !restKeys.length && typeof store.remove === 'function') {
        try { await store.remove(planId) } catch (eRm) {}
      }
      return {
        value: {
          status: status,
          reason: status === DECK_STATUS.OK ? '' : REFUSAL_REASONS.BACKEND_UNSUPPORTED,
          workRouteDetail: a.workRouteDetail,
          text: text,
          data: {
            planId: planId, mapKey: state.mapKey, durable: storeDurable,
            builtKeys: Object.values(state.keys), skippedKeys: skippedKeys, restKeys: restKeys,
            edges: state.edges, counts: counts,
            shards: { suggested: est.shards, perShard: est.perShard, maxChildTicketsPerCall: budget.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL },
            nextCall: restKeys.length ? { tool: 'deck_map_plan_create', planId: planId, hint: '带同一个 planId、把 restKeys 这些子票再传一次' } : null,
          },
          items: items,
          notes: notes,
          touched: [state.mapKey].concat(Object.values(state.keys)).filter(Boolean),
        },
        claimed: { requests: est.requests, points: est.points },
      }
      })
    } finally { ACTIVE_PLANS.delete(planId) }
    return out
  }

  return { definition: definition, run: run }
}
