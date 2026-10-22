// src/host/refresh/wiring.ts —— 刷新机制的宿主接线（#723 T19）
//
// 这个文件只做一件事：把刷新机制那几件已经落库的东西**在宿主里真的装起来**，并交回去。它不判断任何业务：
// 闸与账本是 gate.js 与 ledger.js 的产物，写事件订阅是 writeEvents.js 的产物，工作路线读写是
// workRouteReadoutForHost.js 懒装配的那一套 —— 这里只把它们之间的依赖接上。单开一个文件而不写进
// src/host/index.js 的原因：那个文件贴着 350 行上限（verify-file-granularity 的零增长基线），#723 起不许再加行。
//
// 装起来的四件（票面 3a/3b/3c/3e）：
//   a 闸与账本：createLedger + createGate，send 真的被调用（后面几件取数都经它）；
//   b 写事件订阅：createWriteEvents(...).attach(ctx)，活跃集合变化时 allowRoot / 切走时 forgetRoot；
//   c 视野模型：wf.focus 那一份「当前在看谁」就是这里的唯一来源（syncAttention 读它）；
//   e 工作路线读写：懒装配的那一套（workRouteReadoutForHost.js），工具收口与面板读数共用。
//
// 日志：本文件不新增事件。它调到的每一个模块各自记自己那几行（闸的 refresh.decide / refresh.skipped、
// 账本的 quota.spend、写事件的 write.event、工作路线落盘的 workRoute.write / workRoute.read（由 work-path-store.ts 记）——
// 旧的会话票缓存与旧链读数已随 #1271 退役）。
import { createLedger } from './ledger.js'
import { createGate } from './gate.js'
import { createWriteEvents } from './writeEvents.js'
import { createAttention, createFocusHandler } from './attention.js'
// #723（T19c）第 D 件：九个 deck_* 工具。装配口在共享层（createDeckTools 只收参数、不 import 工具文件），九个
// 工厂由 ../platform/deckToolsAssembly.js 一处读进来 —— 收在那一层是因为宿主层文件之间不许互引（同层引用门禁），
// 宿主层里再读一次那九个文件就要新增 9 条同层边，本票不许。见那个文件的文件头与交付报告第 6 节。
import { createDeckToolsForHost, DECK_TOOL_FILES, withCap } from '../../deck/registration/host-assemble.js'
// #1150：批量建图的计划游标（中间态）要真落盘，存储器在这里造、随工具依赖注入。落盘目录与文件名约定
// 都住在 plan-cursor.ts 里（planCursorDir / createFilePlanStore），不在这里另写一份。
import { createFilePlanStore, planCursorDir } from '../../deck/shell/plan-cursor.js'
// #1261：工作路线的新落盘（每个工作区一份 <根散列>.json）与读出口，两支合在一起从这里递进工具依赖。
// #1082：这套读写零件的惰性装配与面板「跨会话在办表」的挂载口搬去 workRouteReadoutForHost.ts
// （wiring 贴着 350 有效行红线；两件合一个文件，接线处只多一条同层边，已记进同层豁免清单）。
import { createLazyWorkRouteBindings, createWorkRouteTableReadout, WORK_ROUTE_TABLE_FIELD } from './workRouteReadoutForHost.js'
// #1115：计时器口的唯一实现放在共享层（本文件原先自己写了一份，写法对但仍是第二份；六处调用点收成一份）。
import { hostTimers } from '../../shared/host-timer/src/host-timers.js'
// #1159：出站控制面（名额闸 / 取消判定 / 搭车账本）由宿主实现、随进程注入一次，房间只认形状、
// 不再从宿主 import。这里与 src/host/platformChannel.ts 的 backendCtxForRooms 是两处注入点，
// 缺一处那条路上的房间会按环境失败大声报出来（宁可报错，也不静默绕过名额闸）。
import { createOutboundControl } from '../platform/outbound-control.js'
// deck 工具前置三处的等待上限：保读数含一次远端读数（读档 12 秒加排队），给 15 秒；
// 本机记忆与工作区文件是本地读，给 5 秒。超时都走既有的失败继续路径（保不住照旧往下走、
// 读不到按缺席跳过），成功路径一字不动——挂住的文件服务或排满的出站队列不能卡住整笔调用。
// 取值只有一份真源（中央 YAML 的 deckEnsureMs 键），这里直接读它生成出来的值，不再经 TUNING 中转、不留回落。
import { DECK_ENSURE_TIMEOUT_MS } from '../../shared/time-config/src/values.js'
import { createNamingSummary, readFirstUserText } from '../platform/namingSummary.js'   // #746：命名摘要编排（单例，见下）；#746 首句直读（随单下发供免锁比对）
import { hookDeckAgentTools, makeDeckRegisterReport } from '../../deck/registration/register-options.js' // #741 注册那一步（向 agent 交九个工具）：形状、循环与报告住共享层（两边都要用），这里只递表
import { hookSuggestNextSteps } from '../../deck/registration/suggest-steps-register.js' // #1406 建议工具单独登记（不进九工具装配顺序表）
import { publishDeckTable, noteDeckGate } from '../../deck/shell/table-cell.js' // #758 同进程共享格：行与宿主同一进程，表放进格子里行直接取，不经调用面
import { createSandboxPolicyFor } from '../../deck/registration/sandbox-guard.js'
import { createDeckQuotaSync } from '../../deck/registration/quota-sync.js' // #758 剩余额度读数接线：差读数先免费读一次，裁决数字不动（平台区，不新增宿主层边）
// #723（T19c）第 E 件：行级增量那半边（refresh/patch.js）同理收在 src/host/platform/refreshAssembly.js 一处。
import { createPatchForHost } from '../platform/refreshAssembly.js'
import * as budget from '../../shared/refresh/src/budget.js'
import * as toolCost from '../../shared/refresh/src/tool-cost.js'
// #1215 中央时间参数（deckEnsureMs / deckLocalReadMs / shellResolveMs）只有一份真源 config/timeouts.yaml，
// 这里直接读它生成出来的值，不再各写一份数字。
import { DECK_LOCAL_READ_TIMEOUT_MS, SHELL_RESOLVE_TIMEOUT_MS } from '../../shared/time-config/src/values.js'
// #724：闸那一侧的工作区钥匙（短散列）只有一份实现，住在共享层（宿主层文件之间不许互引，而链求值那侧也要用
// 同一把钥匙）。本文件把它转出来，「活跃集合、写事件白名单、九个 deck_* 工具、行级增量、检查链记账」五处同源。
import { hash8, workspaceKeyOf } from '../../shared/refresh-workspace-key.js'
import { parseWorkspaceFile, WORKSPACE_FILE_REL } from '../../deck/shell/workspace-anchor.js'
export { workspaceKeyOf } from '../../shared/refresh-workspace-key.js'

// ---------------------------------------------------------------------------
// 类型（#1155 类型标注，只写类型不写实现）。
//
// 为什么 deps 整包按 any 收：这包是宿主入口现拼的（src/host/index.ts 里那一行
// import('./refresh/wiring.js')），字段多达二十个且随宿主演进增减，调用方还有门禁里
// 手捏的各种夹具形状。类型在这里假装列全，只会让后来加字段的人先改两处类型再改一处
// 逻辑；收窄发生在下面各使用点的 typeof 判断、可选链与 try 包裹里，不在这里替调用方假设。
// 同理各回调的入参按 any 收：它们递进的工厂（quota-sync、writeEvents、patch 那几件）
// 有的还是旧语言文件，类型只会越标越错；运行期形状一个字没改，标注只给编译器看。
//
// 两处不得不写的标注（都是 strict 模式的硬性要求，运行时不存在）：
//   1. catch 后面括号里的变量：strict 下它是 unknown，体里读 .message 必须先断言成 any；
//   2. 以 null 起手的盒子（once 的 box、stats 的回包）：null 不会自动长大，必须写明它以后装什么。
// ---------------------------------------------------------------------------

/** 把一堆依赖包装成「取一次、以后复用」的惰性实例（模块加载失败不许把整个插件带崩）。 */
function once(fn: () => any): () => any {
  const box: { done: boolean; value: any } = { done: false, value: null }
  return function (): any {
    if (!box.done) {
      box.done = true
      try { box.value = fn() } catch (e: any) { box.value = null }
    }
    return box.value
  }
}

/**
 * 造宿主入口那一侧**唯一的那一套**刷新机制（调用多少次都只建一次，所有使用者共用同一个实例）。
 *
 * 为什么「唯一」是硬要求而不是省事：闸的活跃集合、写事件的白名单、视野模型这三件
 * 认的是**同一个「当前在看谁」**。宿主要是建了两套（哪怕两套代码一模一样），标活跃标在一套上、
 * 过闸走在另一套上，后台档的 background-inactive 就会把写事件那一笔恒判推迟 —— 生产里看起来谁都在
 * 工作，实际一次都发不出去，而且读数那一边永远空着。（#723 复核抓到的正是这个：入口一处、wf.focus 又一处。）
 */
export function makeRefreshLoader(deps: any): () => Promise<any> {
  let load: Promise<any> | null = null
  return async function (): Promise<any> {
    if (!load) load = (async function (): Promise<any> {
      const w: any = createRefreshWiring(deps)
      try { w.attach() } catch (eAt: any) {}
      // 界面读数（e）：面板「跨会话在办表」由 workRouteTableReadout 产出（#1271 起唯一的读数口）。
      // wf.focus 的处理器（c）：用的就是这一套里的视野模型；上报之后把活跃集合同步给白名单与闸。
      const focus = (function (): any {
        let h: any = null
        return async function (args: any): Promise<any> {
          if (!h) h = createFocusHandler({ attention: w.attention, afterReport: function (): any { return w.syncAttention() } })
          return await h(args)
        }
      })()
      return Object.assign({}, w, { focus: focus, workRouteTableReadout: w.workRouteTableReadout, workRouteTableField: WORK_ROUTE_TABLE_FIELD })
    })()
    return await load
  }
}

/**
 * 装一套刷新机制。deps 由宿主入口显式传入（本文件不 import 宿主同层的模块，除本目录这几个）：
 *   ctx            宿主上下文（写事件订阅要 ctx.on）
 *   logCtx         宿主日志出口（{ fire, isEnabled }）
 *   canonicalKey   会话目录 → 工作区键的既有出口（src/host/repoKeys.js 的 canonicalKey）
 *   runGh / execProc / getRepoKey / getCacheDir / readDiskCache / writeDiskCache / getTrackerRegistry / getPlatform
 *                  宿主既有出口，交给各件跑腿用
 *   trackerRegistry 可选：后端注册表（九个 deck 工具的壳要用它选后端）
 *   gate / ledger  可选：已经造好的闸与账本（门禁与单测里注入用）；不给就现场造
 *
 * 回包：{ ledger, gate, writeEvents, attention, noteWorkspaceActive,
 *        workRouteTableReadout, workRouteTableField, makeFetch, attach, stats }
 */
export function createRefreshWiring(deps: any): any {
  const d: any = deps || {}
  const logCtx: any = d.logCtx || null

  const ledger: any = d.ledger || createLedger({ logCtx: logCtx })
  const gate: any = d.gate || createGate({ ledger: ledger, logCtx: logCtx })

  // #758 剩余额度读数接线：动手前先保一次读数（差就免费读，不差不打）；闸、账本、起 gh 三件都在本文件手里，包成函数递给工具依赖，失败只影响这一次调用。
  let deckQuotaSync: any = null
  function quotaSyncOf(): any {
    if (!deckQuotaSync) {
      try {
        deckQuotaSync = createDeckQuotaSync({
          send: function (req: any, perform: any): any { return gate.send(req, perform) },
          syncDue: function (): any { try { return ledger.syncDue() } catch (eS: any) { return false } },
          syncServer: function (readings: any): any { try { return ledger.syncServer(readings) } catch (eW: any) { return null } }, noteRateLimited: function (bucket: any, seconds: any, workspaceKey: any): any { try { return gate.noteRetryAfter({ bucket: bucket, seconds: seconds, workspaceKey: workspaceKey }) } catch (e: any) { return null } }, // #927 ①：读数里剩 0 时按服务端的重置时刻降档
          runGh: function (a: any, c: any): any { if (typeof d.runGh === 'function') return d.runGh(a, c); return Promise.resolve({ ok: false, error: 'no-runGh' }) },
          logCtx: logCtx,
        })
      } catch (eC: any) { deckQuotaSync = null }
    }
    return deckQuotaSync
  }
  function ensureDeckReading(cwd: any, workspaceKey: any): Promise<any> {
    try {
      const q: any = quotaSyncOf()
      if (!q || typeof q.ensureReading !== 'function') return Promise.resolve({ ok: false, reason: 'missing-dep' })
      // 排队无上限的出站不能卡住整笔调用：超时按保不住走老路（调用方照旧被闸推迟）。
      return withCap(q.ensureReading(cwd, workspaceKey), DECK_ENSURE_TIMEOUT_MS).then(function (r: any): any { return (r && r.ok === true) ? r.value : { ok: false, reason: (r && r.timedOut) ? 'sync-timeout' : 'ensure-threw' } }, function (): Promise<any> { return Promise.resolve({ ok: false, reason: 'ensure-threw' }) })
    } catch (eE: any) { return Promise.resolve({ ok: false, reason: 'ensure-threw' }) }
  }

  // 写事件触发的那一次取数（b）：闸放行之后真去做的那一步；真取行级增量（refresh/patch.js 的 run）由 T18 那批接。
  async function fetchForWriteEvent(step: any, meta: any): Promise<any> {
    return { requests: 0, points: 0 }
  }

  // b：写事件订阅（门前是归我们的工作区根白名单，见 writeEvents.ts 文件头）；只负责取数，不再喂工作路线（#1262 起写入口只在工具壳）。
  // #746：命名摘要编排单例（ctx 与 getNaming 由宿主入口经 deps 给；任一缺失则钩子静默降级）。
  let namingSummary: any = null
  function summaryOf(): any {
    if (!namingSummary && typeof d.getNaming === 'function') {
      try { namingSummary = createNamingSummary({ ctx: d.ctx, getNaming: d.getNaming, logCtx: logCtx }) } catch (e: any) { namingSummary = null }
    }
    return namingSummary
  }
  // #746 Knife4：直达钩子失败可观测 —— 内层永不抛错，失败只记既有 warn 事件（不新增事件），不影响建票返回。
  function onDeckWrite(info: any): any {
    const warnHook = function (eH: any): void {
      try { if (logCtx) logCtx.fire('warn', 'host.call.fail', { method: 'wf.namingDirect', kind: 'naming-direct', errorHash: hash8(String((eH && eH.message) || eH).slice(0, 120)) }) } catch (eL: any) {}
    }
    try {
      const s: any = summaryOf()
      if (s && typeof s.onDeckWrite === 'function') {
        const r: any = s.onDeckWrite(info)
        if (r && typeof r.catch === 'function') r.catch(warnHook)
      }
    } catch (e: any) { warnHook(e) }
    return { ok: true }
  }
  function onFirstAssistant(sid: any): void { try { const s: any = summaryOf(); if (s) s.maybeSummarize(sid) } catch (e: any) {} }
  // 首条用户消息那一下催一次改名（底座就是在这时候写首句名）：每个会话只催一次，且只认账上有号、还没锁的会话
  // —— 账上没有就什么都不做，省掉一次会读会话日志的整轮计划单（每句都催的代价在生产日志里是几十秒级的）。
  const firstUserNudged = new Set()
  function onFirstUser(sid: any): void {
    try {
      if (!sid || typeof d.getNaming !== 'function' || firstUserNudged.has(sid)) return
      if (firstUserNudged.size > 500) firstUserNudged.clear()
      firstUserNudged.add(sid)
      Promise.resolve(d.getNaming()).then(function (h: any): any {
        if (!h || typeof h.getEntry !== 'function' || typeof h.handleNamingPlan !== 'function') return null
        return Promise.resolve(h.getEntry(sid)).then(function (e: any): any { return (e && !e.locked) ? h.handleNamingPlan() : null })
      }).catch(function (): void {})
    } catch (e: any) {}
  }
  // #746：受踪判定（供写事件白名单之外的窄门：只认命名守护账上有号的会话，取数记账链不走这里）。
  function isNamingTracked(sid: any): Promise<any> {
    try {
      if (!sid || typeof d.getNaming !== 'function') return Promise.resolve(false)
      return Promise.resolve(d.getNaming()).then(function (h: any): any {
        if (!h || typeof h.getEntry !== 'function') return false
        return Promise.resolve(h.getEntry(sid)).then(function (e: any): any { return !!e }).catch(function (): boolean { return false })
      }).catch(function (): boolean { return false })
    } catch (e: any) { return Promise.resolve(false) }
  }
  const writeEvents: any = d.writeEvents || createWriteEvents({
    gate: gate, fetch: fetchForWriteEvent, canonicalKey: d.canonicalKey, logCtx: logCtx,
    onFirstAssistant: onFirstAssistant,
    onFirstUser: onFirstUser,
    isNamingTracked: isNamingTracked,
  })

  // c：视野模型。wf.focus 上报「我在看谁」之后，活跃集合就在这里，b 的白名单跟着它走。
  const attention: any = d.attention || createAttention({ canonicalKey: d.canonicalKey, logCtx: logCtx })

  /** #1263：会话标题快照（与下面 titleFactOf 同一条取法：sessions 加 sessionTitle；取不到回空串）。 */
  function sessionTitleSnapshotOf(sid: any): string {
    try {
      const ctx: any = d.ctx;
      if (!ctx || typeof ctx.get !== 'function') return '';
      const ss: any = ctx.get('sessions');
      const ts: any = ctx.get('sessionTitle');
      if (!ss || typeof ss.get !== 'function' || !ts || typeof ts.get !== 'function') return '';
      const session: any = ss.get(sid);
      if (!session) return '';
      const snap: any = ts.get(session);
      if (!snap || typeof snap.title !== 'string' || !snap.title) return '';
      return snap.title;
    } catch (e: any) { return '' }
  }

  // 上一次同步给写事件白名单的那些根（切走的那几个要 forgetRoot）。
  let allowed: string[] = []

  /**
   * 把「现在在看哪些工作区根」同步给写事件的白名单（b）与闸的活跃集合（c）——**同一份来源**（视野模型）。
   * 每次 wf.focus 上报之后调一次：新来的进白名单、切走的收摊，两个去处一起改。
   *
   * #723（T19）最关键的一处：闸那边如果没接活跃集合，写事件触发的那一次取数会被**恒判推迟**
   * （policy.js 的 background-inactive：后台档不在活跃集合里就一次都不发）—— 接线看起来接上了、
   * 实际一笔都发不出去。所以这两个去处必须由同一份「当前在看谁」同时喂，钥匙也必须是同一把：
   * writeEvents 过闸时带的 workspaceKey 是它自己的短散列（rootHash，见 writeEvents.js 的 fire），
   * 闸按那把钥匙认活跃集合，所以这里标活跃用的也是同一把（#724 起只有一处实现：workspaceKeyOf）。
   */
  async function syncAttention(): Promise<any> {
    let roots: any = []
    try {
      const st: any = attention.stateOf()
      roots = (st && Array.isArray(st.active)) ? st.active.map(function (x: any): any { return String(x.root || '') }).filter(Boolean) : []
    } catch (e: any) { roots = [] }
    for (const root of roots) {
      if (allowed.indexOf(root) < 0) { try { await writeEvents.allowRoot(root) } catch (eA: any) {} }
      try { gate.setWorkspace(workspaceKeyOf(root), { active: true }) } catch (eG: any) {}
    }
    for (const root of allowed) {
      if (roots.indexOf(root) < 0) {
        try { writeEvents.forgetRoot(root) } catch (eF: any) {}
        try { gate.setWorkspace(workspaceKeyOf(root), { active: false }) } catch (eG2: any) {}
      }
    }
    allowed = roots
    return roots
  }

  /** 一个工作区现在算不算活跃（闸裁决的输入之一：不在活跃集合里的后台档一次都不发）。 */
  function noteWorkspaceActive(root: any, active: any): any {
    // 与 syncAttention 用同一把钥匙（workspaceKeyOf）：散列层级不同就会让活跃集合里那一格认不出来，
    // 于是这条路上的每一笔都被判「推迟」（#723 复核抓到的那个「接上了却没走通」）。
    try { return gate.setWorkspace(workspaceKeyOf(root), { active: !!active }) } catch (e: any) { return null }
  }

  /** b 真订阅。宿主入口在 apply 里调一次（attach 要一个 ctx）。 */
  function attach(): any {
    let detach = function (): void {}
    try { const r: any = writeEvents.attach(d.ctx); if (r && typeof r.detach === 'function') detach = r.detach } catch (e: any) {}
    return { detach: detach }
  }

  // #1082：工作路线读写零件只造一份 —— 工具依赖与「面板跨会话在办表」共用（同一份存档、同一套零件）。
  const loadWorkRouteBindings = createLazyWorkRouteBindings({
    getPlatform: function (): any { return (typeof d.getPlatform === 'function') ? d.getPlatform() : null },
    logCtx: logCtx,
  })
  // 面板那张表的挂载口：函数形状与快照信封的读数出口一致（输入回包与当前会话，返回字段值）。
  const attachWorkRouteTable = createWorkRouteTableReadout({
    read: function (input: any): any { return loadWorkRouteBindings().then(function (b: any): any { return b.read(input) }) },
    rootKeyOf: workspaceKeyOf,
    now: function (): number { return Date.now() },
  })

  // ── D（#723 T19c）：九个 deck_* 工具在宿主里装起来 ─────────────────────────────────────────
  // 把九个工具工厂交给共享层装配口 createDeckTools，并把它要的依赖如实给全：gate（本文件造的那一个闸）、
  // registry（后端注册表，选后端走它的三级联）、budget 与 estimate/costInputFrom（额度与算账两件）、
  // handleFor（会话→注册表里绑过的真实句柄）、backendCtx（platform / fs / exec，exec 走 platformChannel
  // 的 detectionExec，也就是起进程那一层）、invalidate（写后作废那个工作区的快照缓存）、hourUsage（问账本）。
  // planStore（#1150）：把一个**落盘**的计划游标存储器注入批量建图工具，建一半断掉能靠它续跑。
  // 注入的是工厂而不是现成的一份：本函数（宿主装配）在进程启动时只跑一次，那时还不知道这次调用落在哪个
  // 工作区；而游标按工作区分区，两个工作区里的同名计划标识不能互相认成「上次建过」（认错了会跳过该建的票）。
  // 注意（2026-09-26）：loadDefineTool 固定给 null，走原生形状直接注册——照官方工具写法，插件不 import 框架包，
  // 注册纯数据对象；从前这里动态 import 自带副本，挂载后全部工具调用报 prepare undefined。
  // 退路输出与参数形状见 shared/deck-tools/agent-register.js（deckAgentOutputSchemaRaw）。
  let deckToolsP: Promise<any> | null = null; try { hookDeckAgentTools(d.ctx, deckToolsForHost, function (): Promise<any> { return Promise.resolve(null) }, makeDeckRegisterReport(logCtx), undefined) } catch (eH: any) {} // #741 注册那一步：表装好就向 agent 交九个工具，成败落既有日志（deckToolsForHost 声明提升，这里可直接用）。末尾的 undefined 是“轮数与间隔都用缺省”（五轮、每轮两秒）：原 JS 只传四个实参，被调方按缺席取缺省；这里显式写出才能过类型检查，运行期走的是同一条缺省分支。
  // #1406：建议工具单独登记一次（与九工具那条钩子并列，不进 DECK_TOOL_ORDER）。失败只落日志，不影响九个追踪器工具。
  // #1406 补（2026-10-23）：hookSuggestNextSteps 是 async，开头读上下文若抛错会变成 rejected Promise，
  // 那一行同步 try/catch 抓不到；宿主加载期会把未处理的 rejection 判成致命错误（真机启动即退出 1）。
  // 所以给返回的 Promise 再挂一层 .catch 兜底：登记失败只落既有日志，绝不拖垮启动。
  try { hookSuggestNextSteps(d.ctx, { log: logCtx }).catch(function (eSuggest: any) {}) } catch (eSuggest: any) {}
  async function deckToolsForHost(): Promise<any> {
    if (!deckToolsP) {
      deckToolsP = (async function (): Promise<any> {        const empty = { tools: {}, names: [], definitions: [], missing: [], reason: '', files: DECK_TOOL_FILES }
        let registry: any = null
        try { registry = d.getTrackerRegistry ? await d.getTrackerRegistry() : null } catch (eR: any) { registry = null }
        if (!registry || typeof registry.select !== 'function') return Object.assign({}, empty, { reason: 'no-registry' })
        let platform: any = null
        try { platform = d.getPlatform ? await d.getPlatform() : null } catch (eP: any) { platform = null }
        // 后端 ctx 一次取好、之后每笔调用复用同一份：壳按调用同步取它，所以这里不能给一个异步函数。
        const backendObj = {
          platform: platform,
          fs: (function (): any { try { return (d.ctx && typeof d.ctx.get === 'function') ? d.ctx.get('fs') : undefined } catch (e: any) { return undefined } })(),
          // #1109：选后端那条兜底等待（缺省 30 秒）要用宿主这一支 timer 服务，不能用全局时钟。
          //   不给的话这里就落到全局 setTimeout 上：门禁没法用假计时器看住它（30 秒真等不起），
          //   一挂住就只能干等，也数不清「显式绑定命中时一次计时器都没起」。形状与 OpContext.timers
          //   一致，与平台通道那一处（platformChannel.js 的 getTimers）同源，都是宿主 ctx 的 timer 服务。
          timers: (function (): any {
            try {
              const t: any = (d.ctx && typeof d.ctx.get === 'function') ? d.ctx.get('timer') : undefined
              if (!t || typeof t.timeout !== 'function') return undefined
              // 撤销那一档的判据在共享层一处（#1115）：真句柄是可调用的撤销器，全局 clearTimeout 与
              // 先判 .dispose 两种写法在它上面都是空操作，详见 src/shared/host-timer/src/host-timers.ts 文件头。
              return hostTimers(t)
            } catch (e: any) { return undefined }
          })(),
          exec: function (): any {
            if (typeof d.detectionExec === 'function') { try { return d.detectionExec.apply(null, arguments) } catch (e: any) { return Promise.reject(e) } }
            return Promise.resolve({ ok: false, kind: 'env', error: '这个宿主实例没有把起进程的出口（detectionExec）传进来，远端后端的读写做不了' })
          },
          logEvent: function (level: any, event: any, fields: any): void { try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire(level, event, fields) } catch (e: any) {} },
          isEnabled: function (level: any): any { try { return logCtx ? logCtx.isEnabled(level) : (level === 'error' || level === 'warn') } catch (e: any) { return level === 'error' || level === 'warn' } },
          // #1159：出站控制面（进程级能力，随这份后端上下文注入一次）。房间起 gh 命令前拿名额、
          // 认取消、写完记账都从这里取；缺了房间按环境失败返回，不静默绕过名额闸。
          outbound: createOutboundControl(),
        }
        /**
         * #1150：批量建图的计划游标存储器，按这一次调用的工作区现造一份落盘的。
         * 为什么现造：装配（上面这段）在进程启动时只跑一次，那时还不知道这次调用落在哪个工作区；
         *   而游标按工作区分区（文件名里带工作区键），两个工作区里的同名计划标识不能互相认成「上次建过」。
         * 为什么读写前先 resolve：宿主那份文件服务是目标形状 —— readText / writeText 收的是 resolve() 的
         *   产物（{ targetKey, displayPath }），给裸路径串会被拒（docs/cache-and-diagnostics.md 第 7.1 节）。
         *   目录不用谁来建：父目录由 writeText 递归创建，宿主那份文件服务没有 mkdir。
         * 缺文件能力就回 null：工具那边退到按工作区自建的那条路或进程内存，并在回执里如实说 durable。
         * 缺 resolve 也回 null（2026-10-14 深挖补的一刀）：没有它就造不出文件服务要的目标对象，只能把裸路径
         *   串递过去 —— 那正是 #1150 修掉的那种「说落盘、其实没落」。宁可退回内存并如实说 durable:false。
         */
        function planStoreFor(info: any): any {
          try {
            const fsSvc: any = backendObj.fs
            if (!fsSvc || typeof fsSvc.resolve !== 'function' || typeof fsSvc.readText !== 'function' || typeof fsSvc.writeText !== 'function') return null
            const cwd = String((info && info.cwd) || '')
            if (!cwd) return null
            const plat: any = backendObj.platform
            const join: any = (plat && plat.path && typeof plat.path.join === 'function') ? plat.path.join : null
            const target = function (p: any): Promise<any> { return Promise.resolve(fsSvc.resolve(p)) }
            return createFilePlanStore({
              io: {
                readText: function (p: any): Promise<any> { return target(p).then(function (t: any): any { return fsSvc.readText(t) }) },
                writeText: function (p: any, text: any): Promise<any> { return target(p).then(function (t: any): any { return fsSvc.writeText(t, text) }) },
              },
              dir: planCursorDir(cwd, join),
              workspaceKey: (info && info.workspaceKey) || '',
              now: Date.now,
            })
          } catch (e: any) { return null }
        }
        // 工作路线的新落盘装配（#1261 建、#1083 加固、#1082 起与面板读数共用一份）：
        // 家目录、文件读写、改名与日志的细节都在 workRouteReadoutForHost.ts 里，这里只取现成的实例。
        // 取不到就留给三支依赖各自回「没落上 / 没接上」的诚实原因，不静默跳过。
        let workRouteBindings: any = null
        try { workRouteBindings = await loadWorkRouteBindings() } catch (eW: any) {}
        const built: any = createDeckToolsForHost({
          gate: gate,
          registry: registry,
          budget: budget,
          estimate: toolCost.estimateToolCost,
          costInputFrom: toolCost.toolCostInputFrom,
          // 句柄就是「哪个工作区」这一件事。以前这里还要去注册表的绑定表里找这个目录有没有被绑过、
          // 好把当时那个句柄原样交回去；绑定表在 #1138 删掉之后，句柄只由这份状态自己给出，与别处同构。
          handleFor: function (s: any): any { return { cwd: (s && s.cwd) || '' } },
          // 934：会话目录洗加锚根的宿主唯一异步出口（与绑定侧同一把钥匙）；缺席时壳沿用原始目录。
          canonicalKey: (typeof d.canonicalKey === 'function') ? function (raw: any): any { return d.canonicalKey(raw) } : undefined,
          // 947 显式后两层读口：查不到一律 null（缺席即跳过，不猜）。挂住时同样按缺席跳过。
          // #1138：这里原来还递一个 readChoice（读本机记忆 H）——H 自 2026-10-12 起就不参与判定了，
          //   壳里也没有任何调用点，留着只会让后来的人以为 H 还有话语权，所以整行删掉。
          readWorkspaceFileText: function (rootCwd: any): Promise<any> { try { const fsSvc: any = backendObj && backendObj.fs; if (!fsSvc || typeof fsSvc.resolve !== 'function' || typeof fsSvc.readText !== 'function') return Promise.resolve(null); const p: any = Promise.resolve(fsSvc.resolve(WORKSPACE_FILE_REL, { cwd: rootCwd })).then(function (t: any): any { return fsSvc.readText(t) }, function (): any { return null }).then(function (txt: any): any { return (typeof txt === 'string' && txt) ? txt : null }, function (): any { return null }); return withCap(p, DECK_LOCAL_READ_TIMEOUT_MS).then(function (r: any): any { return (r && r.ok === true) ? r.value : null }, function (): any { return null }) } catch (e: any) { return Promise.resolve(null) } },
          parseWorkspaceFile: parseWorkspaceFile,
          sandboxPolicyFor: createSandboxPolicyFor(d.ctx),
          backendCtx: function (): any { return backendObj },
          // #1150：批量建图的计划游标落盘（按这次调用的工作区现造一份；看见 planStoreFor 上面那段注释）。
          planStore: planStoreFor,
          // #1147 决策 10a：仓库标识补全（resolve 步）的等待上限毫秒数。壳缺席时取 8000，
          //   这里显式传入同一数值 —— 这个上限的值由装配层拥有，不再是壳里无人认领的缺省（行为零变化）。
          //   #1215：这个数（8000）住中央 YAML 的 shellResolveMs，装配层与壳读同一份生成值。
          resolveTimeoutMs: SHELL_RESOLVE_TIMEOUT_MS,
          invalidate: function (info: any): void { try { const root: any = (info && info.workspace && info.workspace.root) || (info && info.cwd); if (typeof d.setCache === 'function' && root) d.setCache({ ts: 0, snapshot: null, error: null, cwd: String(root) }) } catch (e: any) {} },
          onTicketCreated: onDeckWrite, // #746 建票直达命名守护
          // #1263：上报成功收口记一笔 + 读在办表（壳经这两支调到；装配失败时给没落上的诚实回执，不静默跳过）。
          // 会话标题快照由宿主侧填（与 titleFactOf 同一条取法；取不到留空，读出口显示散列前 6 位）。
          workRouteNote: function (input: any): any { try { const enriched: any = (input && typeof input === 'object') ? Object.assign({}, input) : {}; if (!enriched.sessionLabel) { const t = sessionTitleSnapshotOf(enriched.sessionId); if (t) enriched.sessionLabel = t } return workRouteBindings ? workRouteBindings.note(enriched) : Promise.resolve({ ok: false, reason: 'no-store' }) } catch (e: any) { return Promise.resolve({ ok: false, reason: 'threw' }) } },
          workRouteRead: function (input: any): any { try { return workRouteBindings ? workRouteBindings.read(input) : { ok: false, reason: 'no-store' } } catch (e: any) { return { ok: false, reason: 'read-failed' } } },
          // #1086：释放（带 release=true 的上报）走这一支；装配失败时回没释放的诚实原因，由回执备注如实写出。
          workRouteRelease: function (input: any): any { try { return workRouteBindings ? workRouteBindings.release(input) : Promise.resolve({ ok: false, reason: 'no-store' }) } catch (e: any) { return Promise.resolve({ ok: false, reason: 'threw' }) } },
          hourUsage: function (): any { try { return ledger.hourOf('ai-tool') || {} } catch (e: any) { return {} } },
          ensureReading: function (cwd: any, workspaceKey: any): Promise<any> { return ensureDeckReading(cwd, workspaceKey) }, // #758 动手前保读数：差就免费读一次，不差不打；失败调用方照旧被闸推迟
          noteGate: function (info: any): void { try { noteDeckGate(info) } catch (eN: any) {} }, // #758 闸口径迹：探针读走，线上卡在哪段一眼可见
          log: logCtx || null,
          // #723（T19c）：工作区键用与活跃集合同一把短散列（workspaceKeyOf）——**不许**在这里用别的归一
          // （散列层级不同、长度不同、空串，都会让闸里那一格从来不是活跃，于是每一笔都被判推迟；
          // 这一条有门禁盯着：tests/verify-delta-wiring.js，
          // 另加 #724 的「同一个工作区根在闸里只许有一格」tests/verify-refresh-workspace-key.js）。
          //（原先还点着 tests/verify-deck-tools-host-wiring.js，那条门禁 2026-10-14 整份删掉了：
          //  它的判据没有一条是独占的，见 #1173。）
          workspaceKeyOf: workspaceKeyOf,
          now: Date.now,
        })
        return Object.assign({ reason: '', files: DECK_TOOL_FILES }, built)
      })().catch(function (): any { return { tools: {}, names: [], definitions: [], missing: [], reason: 'assembly-failed', files: DECK_TOOL_FILES } })
      try { publishDeckTable(deckToolsP) } catch (eP: any) {} // #758 同进程共享格：表一开装就行里直接取，不经调用面；跨进程时格子永远是空的，行按原路退回
    }
    return await deckToolsP
  }

  // ── E（#723 T19c）：行级增量真的能在宿主里跑起来 ────────────────────────────────────────────
  // 以前探测到变化之后没人去跑 refresh/patch.js，客户端只能整池重建；现在它在这里装起来，由 wf.probe 那条路在
  //「探测说变了」之后调用。依赖由宿主入口显式传入：readSnapshot / writeSnapshot 读写的正是宿主那份快照缓存与
  // 磁盘缓存（与客户端看到的列表同一份）；send / decide 是闸的两半，读路径的账与裁决一个字都另不算。
  let patchRunner: any = null
  function patchOf(): any {
    if (!patchRunner) {
      patchRunner = createPatchForHost({
        readSnapshot: function (cwd: any): any { try { const e: any = (typeof d.getCache === 'function') ? d.getCache(cwd) : null; return (e && e.snapshot) ? e.snapshot : null } catch (eR: any) { return null } },
        writeSnapshot: async function (cwd: any, snap: any): Promise<void> {
          try { if (typeof d.setCache === 'function') d.setCache({ ts: Date.now(), snapshot: snap, error: null, cwd: cwd }) } catch (eW: any) {}
          try { const repo: any = await d.getRepoKey(cwd); if (repo && typeof d.writeDiskCache === 'function') await d.writeDiskCache(repo, snap) } catch (eD: any) {}
        },
        indexOfSnapshot: function (snap: any): any { return (typeof d.issueIndexFromSnapshot === 'function') ? d.issueIndexFromSnapshot(snap) : {} },
        probeIndex: function (cwd: any, sinceIso: any): any { return (typeof d.fetchIssueIndex === 'function') ? d.fetchIssueIndex(cwd, sinceIso) : Promise.resolve({ ok: false }) },
        getRepoKey: function (cwd: any): any { return (typeof d.getRepoKey === 'function') ? d.getRepoKey(cwd) : Promise.resolve(null) },
        runGh: function (args2: any, cwd: any): any { return (typeof d.runGh === 'function') ? d.runGh(args2, cwd) : Promise.resolve({ ok: false, error: 'no-runGh' }) },
        send: function (req: any, perform: any): any { return gate.send(req, perform) },
        decide: function (req: any): any { return gate.decideFor(req) },
        // 与活跃集合、写事件白名单同一把短散列（见 syncAttention）：不一致就会让探测这条路每一笔都被判「推迟」。
        workspaceKeyOf: workspaceKeyOf,
        now: Date.now,
        logCtx: logCtx,
      })
    }
    return patchRunner
  }

  /**
   * 跑一次行级增量，回 patch.run 的原话（见 refresh/patch.js 文件头那一张表）。
   * 只在两条依赖齐了才跑（跑 gh 的出口与探测索引的出口）——缺任何一个都如实回 failed，
   * 让调用方照旧走整池那条老路，绝不假装补过。
   */
  async function deltaRefresh(cwd: any, opts: any): Promise<any> {
    if (typeof d.runGh !== 'function' || typeof d.fetchIssueIndex !== 'function') return { mode: 'failed', reason: 'no-transport' }
    try { return await patchOf().run(cwd, opts || {}) } catch (e: any) { return { mode: 'failed', reason: 'patch-threw' } }
  }

  /** 切进一个工作区那一下要问的事（有待办就整池、并清待办）。 */
  async function deltaEnter(cwd: any): Promise<any> {
    if (typeof d.getCache !== 'function') return { mode: 'use-cache', reason: 'no-cache-port' }
    try { return await patchOf().enterWorkspace(cwd) } catch (e: any) { return { mode: 'use-cache', reason: 'patch-threw' } }
  }

  return {
    ledger: ledger,
    gate: gate, send: function (req: any, perform: any): any { return gate.send(req, perform) }, // #927：面板取数那两路要过闸（它们是「人的动作」那一类，只记账、不降档）
    writeEvents: writeEvents,
    attention: attention,
    hash8: hash8,
    // #1082：面板「跨会话在办表」的挂载口（wf.snapshot 与 wf.refresh 两条路共用同一个函数；#1271 起唯一的读数口）。
    workRouteTableReadout: attachWorkRouteTable,
    workRouteTableField: WORK_ROUTE_TABLE_FIELD,
    deckToolsForHost: deckToolsForHost,
    deltaRefresh: deltaRefresh,
    deltaEnter: deltaEnter,
    syncAttention: syncAttention,
    noteWorkspaceActive: noteWorkspaceActive,
    firstTextOf: function (sid: any): Promise<any> { try { return readFirstUserText(d.ctx, sid) } catch (e: any) { return Promise.resolve(null) } }, // #746 首句直读（读而不激活；失败即 null）
    titleFactOf: function (sid: any): any { try { const ctx: any = d.ctx; if (!ctx || typeof ctx.get !== 'function') return null; const ss: any = ctx.get('sessions'), ts: any = ctx.get('sessionTitle'); if (!ss || typeof ss.get !== 'function' || !ts || typeof ts.get !== 'function') return null; const session: any = ss.get(sid); if (!session) return null; const snap: any = ts.get(session); if (!snap || typeof snap.title !== 'string' || !snap.title) return null; const kind: any = snap.source && typeof snap.source.kind === 'string' ? snap.source.kind : ''; return kind ? { kind: kind, title: snap.title } : null } catch (e: any) { return null } }, // 标题来源事实（写这条名的那一次是谁写的：user 人写的／fallback 底座首句名／provider 底座模型取名），取自宿主会话与标题两个原生服务；缺服务或读不到即 null，执行点退回旧判据
    attach: attach,
    once: once,
    stats: function (): any {
      const out: { gate: any; writeEvents: any; allowedRoots: number } = { gate: null, writeEvents: null, allowedRoots: allowed.length }
      try { out.gate = gate.stats() } catch (e: any) {}
      try { out.writeEvents = writeEvents.stats() } catch (e: any) {}
      return out
    },
  }
}
