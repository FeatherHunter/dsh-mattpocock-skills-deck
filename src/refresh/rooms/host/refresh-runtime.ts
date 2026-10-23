// src/refresh/rooms/host/refresh-runtime.ts —— 刷新机制的宿主接线（#723 T19）
//
// 这个文件只做一件事：把刷新机制那几件已经落库的东西**在宿主里真的装起来**，并交回去。它不判断任何业务：
// 闸与账本是 refresh-gate.js 与 quota-ledger.js 的产物，写事件订阅是 write-event-subscription.js 的产物，工作路线读写是
// work-route-readout.js 懒装配的那一套 —— 这里只把它们之间的依赖接上。单开一个文件而不写进
// src/host/index.js 的原因：那个文件贴着 350 行上限（verify-file-granularity 的零增长基线），#723 起不许再加行。
//
// 装起来的四件（票面 3a/3b/3c/3e）：
//   a 闸与账本：createLedger + createGate，send 真的被调用（后面几件取数都经它）；
//   b 写事件订阅：createWriteEvents(...).attach(ctx)，活跃集合变化时 allowRoot / 切走时 forgetRoot；
//   c 视野模型：wf.focus 那一份「当前在看谁」就是这里的唯一来源（syncAttention 读它）；
//   e 工作路线读写：懒装配的那一套（work-route-readout.js），工具收口与面板读数共用。
//
// 日志：本文件不新增事件。它调到的每一个模块各自记自己那几行（闸的 refresh.decide / refresh.skipped、
// 账本的 quota.spend、写事件的 write.event、工作路线落盘的 workRoute.write / workRoute.read（由 work-path-store.ts 记）——
// 旧的会话票缓存与旧链读数已随 #1271 退役）。
import { createLedger } from './quota-ledger.js'
import { createGate } from './refresh-gate.js'
import { createWriteEvents } from './write-event-subscription.js'
import { createAttention, createFocusHandler } from './host-attention.js'
// #723（T19c）第 D 件：九个 deck_* 工具的桥段已并入登记层（#1429 B12），这里只留装配胶水：
// 建桥（createDeckToolBridge）与登记（hookDeckAgentTools，见下）。withCap 留在这里是给保读数（#758）用的，
// DECK_TOOL_FILES 随桥段搬去桥里（各模块仍只有一份定义，见桥文件头）。
import { withCap } from '../../../deck/registration/host-assemble.js'
import { createDeckToolBridge } from '../../registry/deck-tool-bridge.js'
// #1261：工作路线的新落盘（每个工作区一份 <根散列>.json）与读出口，两支合在一起从这里递进工具依赖。
// #1082：这套读写零件的惰性装配与面板「跨会话在办表」的挂载口搬去 work-route-readout.ts
// （wiring 贴着 350 有效行红线；两件合一个文件，接线处只多一条同层边，已记进同层豁免清单）。
import { createLazyWorkRouteBindings, createWorkRouteTableReadout, WORK_ROUTE_TABLE_FIELD } from './work-route-readout.js'
// deck 工具前置三处的等待上限：保读数含一次远端读数（读档 12 秒加排队），给 15 秒；
// 本机记忆与工作区文件是本地读，给 5 秒。超时都走既有的失败继续路径（保不住照旧往下走、
// 读不到按缺席跳过），成功路径一字不动——挂住的文件服务或排满的出站队列不能卡住整笔调用。
// 取值只有一份真源（中央 YAML 的 deckEnsureMs 键），这里直接读它生成出来的值，不再经 TUNING 中转、不留回落。
import { DECK_ENSURE_TIMEOUT_MS } from '../../../shared/time-config/src/values.js'
import { createNamingSummary, readFirstUserText } from '../../../host/platform/namingSummary.js'   // #746：命名摘要编排（单例，见下）；#746 首句直读（随单下发供免锁比对）
import { hookDeckAgentTools, makeDeckRegisterReport } from '../../../deck/registration/register-options.js' // #741 注册那一步（向 agent 交九个工具）：形状、循环与报告住共享层（两边都要用），这里只递表
import { hookSuggestNextSteps } from '../../../deck/registration/suggest-steps-register.js' // #1406 建议工具单独登记（不进九工具装配顺序表）
import { createDeckQuotaSync } from '../../registry/quota-sync-bridge.js'
import { openTracker } from '../../../tracker/session/open-tracker.js'
import { createOutboundControl } from './outbound-control.js'
import { hostTimers } from '../../contract/host-timer-ports.js' // #758 剩余额度读数接线：差读数先免费读一次，裁决数字不动（平台区，不新增宿主层边）
// #723（T19c）第 E 件：行级增量那半边（src/refresh/rooms/host/row-patch.js）同理收在 src/refresh/rooms/host/refresh-assembly.js 一处。
import { createPatchForHost } from './refresh-assembly.js'
// #724：闸那一侧的工作区钥匙（短散列）只有一份实现，住在共享层（宿主层文件之间不许互引，而链求值那侧也要用
// 同一把钥匙）。本文件把它转出来，「活跃集合、写事件白名单、九个 deck_* 工具、行级增量、检查链记账」五处同源。
import { hash8, workspaceKeyOf } from '../../contract/workspace-keys.js'
export { workspaceKeyOf } from '../../contract/workspace-keys.js'

// ---------------------------------------------------------------------------
// 类型（#1155 类型标注，只写类型不写实现）。
//
// 为什么 deps 整包按 any 收：这包是宿主入口现拼的（src/host/index.ts 里那一行
// import('../refresh/rooms/host/refresh-runtime.js')），字段多达二十个且随宿主演进增减，调用方还有门禁里
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

  // #758 剩余额度读数接线：动手前先保一次读数（差就经会话读一次，不差不打）；失败只影响这一次调用。
  // #1443 改道：不再经闸打免费的 gh 直调，读数走 Tracker 会话的 readBudget（房间自己读 gh，读预算本身不花额度）。
  let deckQuotaSync: any = null
  // 会话读数要的那份后端上下文：平台、文件、计时器、起进程、日志、出站控制面各一件，
  // 与桥段装配的那一份同源（生产里同一套宿主出口），只在这里为同步现拼一份（同步不经过工具装配）。
  let syncBackendObj: any = null
  function syncBackendCtxOf(): any {
    if (!syncBackendObj) {
      let platform: any = null
      try { platform = (typeof d.getPlatform === 'function') ? d.getPlatform() : null } catch (eP: any) { platform = null }
      syncBackendObj = {
        platform: platform,
        fs: (function (): any { try { return (d.ctx && typeof d.ctx.get === 'function') ? d.ctx.get('fs') : undefined } catch (e: any) { return undefined } })(),
        timers: (function (): any {
          try {
            const timerSvc: any = (d.ctx && typeof d.ctx.get === 'function') ? d.ctx.get('timer') : undefined
            if (!timerSvc || typeof timerSvc.timeout !== 'function') return undefined
            return hostTimers(timerSvc)
          } catch (e: any) { return undefined }
        })(),
        exec: function (): any {
          if (typeof d.detectionExec === 'function') { try { return d.detectionExec.apply(null, arguments) } catch (e: any) { return Promise.reject(e) } }
          return Promise.resolve({ ok: false, kind: 'env', error: '这个宿主实例没有把起进程的出口（detectionExec）传进来，额度同步读不了数' })
        },
        logEvent: function (level: any, event: any, fields: any): void { try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire(level, event, fields) } catch (e: any) {} },
        isEnabled: function (level: any): any { try { return logCtx ? logCtx.isEnabled(level) : (level === 'error' || level === 'warn') } catch (e: any) { return level === 'error' || level === 'warn' } },
        outbound: createOutboundControl(),
      }
    }
    return syncBackendObj
  }
  // 经 Tracker 会话读一次预算：只调 readBudget（管线里它直达房间，不裁决不记账）。
  // 读不到（没注册表、会话打不开、读数未知）都回失败形状，不抛 —— 桥按失败退避，工具照旧走原流程。
  async function readSessionBudget(cwd: unknown): Promise<any> {
    try {
      let registry: any = null
      try { registry = (typeof d.getTrackerRegistry === 'function') ? await d.getTrackerRegistry() : null } catch (eR: any) { registry = null }
      if (!registry || typeof registry.select !== 'function' || typeof registry.get !== 'function') return { ok: false, error: { kind: 'env', message: 'no-registry' } }
      const opened: any = await openTracker({ cwd: String(cwd || '') }, {
        registry: registry,
        getCachedReading: async function (): Promise<any> { return { known: false, reason: 'not-measured' } },
        admit: async function (): Promise<any> { return { allowed: true, reason: 'quota-sync' } },
        account: async function (): Promise<void> {},
        canWrite: false,
        canWriteReason: '额度同步只读预算，不做写操作',
      })
      if (!opened || opened.ok !== true) return { ok: false, error: { kind: 'env', message: String((opened && opened.detail) || (opened && opened.reason) || 'open-failed') } }
      const opCtx = Object.assign({}, syncBackendCtxOf(), { cwd: String(cwd || ''), signal: undefined })
      return await opened.session.readBudget(opCtx)
    } catch (eS: any) { return { ok: false, error: { kind: 'env', message: String((eS && eS.message) || eS) } } }
  }
  function quotaSyncOf(): any {
    if (!deckQuotaSync) {
      try {
        deckQuotaSync = createDeckQuotaSync({
          syncDue: function (): any { try { return ledger.syncDue() } catch (eS: any) { return false } },
          syncServer: function (readings: any): any { try { return ledger.syncServer(readings) } catch (eW: any) { return null } },
          readBudget: function (cwd: any): any { return readSessionBudget(cwd) },
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

  // 写事件触发的那一次取数（b）：闸放行之后真去做的那一步；真取行级增量（src/refresh/rooms/host/row-patch.js 的 run）由 T18 那批接。
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
   * （admission-policy.js 的 background-inactive：后台档不在活跃集合里就一次都不发）—— 接线看起来接上了、
   * 实际一笔都发不出去。所以这两个去处必须由同一份「当前在看谁」同时喂，钥匙也必须是同一把：
   * writeEvents 过闸时带的 workspaceKey 是它自己的短散列（rootHash，见 write-event-subscription.js 的 fire），
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

  // ── D（#723 T19c · #1429 B12）：九个 deck_* 工具的桥段已并入登记层 ──────────────────
  // deckToolsForHost 闭包（含 memo、planStoreFor、readWorkspaceFileText 与后端 ctx 组装）住
  // src/refresh/registry/deck-tool-bridge.ts 的 createDeckToolBridge；门禁与单测走的仍是同一个函数
  // （下面回包的 deckToolsForHost 字段直接交桥实例的方法，wf.deckExec 与各单测行为零变化）。
  // gate / ledger 与后端上下文仍是本文件造的那一份，现取现传进桥；建议工具登记（#1406）在下面原样保留。
  const deckBridge: any = createDeckToolBridge({
    ctx: d.ctx,
    getTrackerRegistry: d.getTrackerRegistry,
    getPlatform: d.getPlatform,
    canonicalKey: d.canonicalKey,
    setCache: d.setCache,
    detectionExec: d.detectionExec,
    gate: gate,
    ledger: ledger,
    logCtx: logCtx,
    workspaceKeyOf: workspaceKeyOf,
    loadWorkRouteBindings: loadWorkRouteBindings,
    ensureDeckReading: ensureDeckReading,
    onDeckWrite: onDeckWrite,
    sessionTitleSnapshotOf: sessionTitleSnapshotOf,
  })
  try { hookDeckAgentTools(d.ctx, deckBridge.deckToolsForHost, function (): Promise<any> { return Promise.resolve(null) }, makeDeckRegisterReport(logCtx), undefined) } catch (eH: any) {} // #741 注册那一步：表装好就向 agent 交九个工具，成败落既有日志（装表函数住桥实例，这里经 deckBridge 取）。末尾的 undefined 是“轮数与间隔都用缺省”（五轮、每轮两秒）：原 JS 只传四个实参，被调方按缺席取缺省；这里显式写出才能过类型检查，运行期走的是同一条缺省分支。
  // #1406：建议工具单独登记一次（与九工具那条钩子并列，不进 DECK_TOOL_ORDER）。失败只落日志，不影响九个追踪器工具。
  // #1406 补（2026-10-23）：hookSuggestNextSteps 是 async，开头读上下文若抛错会变成 rejected Promise，
  // 那一行同步 try/catch 抓不到；宿主加载期会把未处理的 rejection 判成致命错误（真机启动即退出 1）。
  // 所以给返回的 Promise 再挂一层 .catch 兜底：登记失败只落既有日志，绝不拖垮启动。
  try { hookSuggestNextSteps(d.ctx, { log: logCtx }).catch(function (eSuggest: any) {}) } catch (eSuggest: any) {}

  // ── E（#723 T19c）：行级增量真的能在宿主里跑起来 ────────────────────────────────────────────
  // 以前探测到变化之后没人去跑 src/refresh/rooms/host/row-patch.js，客户端只能整池重建；现在它在这里装起来，由 wf.probe 那条路在
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
   * 跑一次行级增量，回 patch.run 的原话（见 src/refresh/rooms/host/row-patch.js 文件头那一张表）。
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
    deckToolsForHost: deckBridge.deckToolsForHost,
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
