// src/refresh/registry/deck-tool-bridge.ts —— deck 工具桥的装配机（#1427 F3 · 桥部分）
//
// 这是 deck 工具桥的唯一落点：把九个工具工厂（读点仍在 src/deck/registration/host-assemble.ts，
// 平台豁免的读入位置不动）装成一张表，依赖全部由调用方现取现传。自己不判断业务，不记日志。
//
// 会合说明（目标地图 B12 与 F3）：宿主运行时的桥段（原 refresh-runtime.ts D 段 deckToolsForHost 闭包，
// 绑着闸、账本与后端上下文那一份）#1429 已并入本文件（createDeckToolBridge，运行时只留装配胶水）；
// F3 的工厂侧（createDeckToolsForHost）早先已在这里，两处旧实现并一处桥，调用已收成文件内直调。
//
// 本文件住登记层（registry/）：只被宿主房与门禁引用，不被房外深引（refresh-outside-only-contract 管着）。
import { createDeckTools } from '../../deck/shell/tool-table.js'
import { DECK_TOOL_FACTORIES, DECK_TOOL_FILES, withCap } from '../../deck/registration/host-assemble.js'
// #1003 单出口：判定函数由平台层递进九个工具共用的依赖（平台→探测跨层，门禁不计数；壳内部零新增引用边）。
//   没递到时壳走老路；老路删除时本行与壳里的 fallback 一起删。
import { decideBackend } from '../../tracker/detection/backendDecision.js'
// 声明文件读取的等待上限住中央 YAML（config/timeouts.yaml 的 deckAssemblyMs 键）：这里只留别名，
// 名字与位置不动（#1030 Q4 冻的是数值与位置，别名不断），调时间改 YAML。
// 值由 tests/verify-time-config.ts 看守一致。
import { DECK_ASSEMBLY_TIMEOUT_MS as CENTRAL_DECK_ASSEMBLY_TIMEOUT_MS, DECK_LOCAL_READ_TIMEOUT_MS, SHELL_RESOLVE_TIMEOUT_MS } from '../../shared/time-config/src/values.js'
// #1429 B12：桥段的静态依赖（原 refresh-runtime.ts D 段的导入，随闭包一起搬过来；各模块仍只有一份定义，这里只是导入）：
// #1150 计划游标落盘（planCursorDir / createFilePlanStore）、#1115 计时器口（hostTimers）、
// #1159 出站控制面（createOutboundControl，与平台通道那一处同源的两处注入点之一）。
import { createFilePlanStore, planCursorDir } from '../../deck/shell/plan-cursor.js'
import { hostTimers } from '../contract/host-timer-ports.js'
import { createOutboundControl } from '../rooms/host/outbound-control.js'
import { publishDeckTable, noteDeckGate } from '../../deck/shell/table-cell.js'
import { createSandboxPolicyFor } from '../../deck/registration/sandbox-guard.js'
import { parseWorkspaceFile, WORKSPACE_FILE_REL } from '../../deck/shell/workspace-anchor.js'
import * as budget from '../kernel/host-budget.js'
import * as toolCost from '../kernel/tool-call-budget.js'
import { decideByBudget } from '../kernel/budget-admission.js'
import type { BudgetLimits } from '../kernel/budget-admission.js'
import { createAccountPort } from '../kernel/backend-accounting.js'
import type { AccountInput, BackendBudgetModel, BudgetReading } from '../../tracker/contract/budget-model.js'


/** 未知形状的对象（接线递进来的依赖包先按这形接住，用到哪格验哪格，不猜）。 */
type UnknownRecord = Record<string, unknown>;

/** 账本一桶的视图（#1446 定稿形状；这里只声明桥用到的几格，避免把账本类型带进登记层）。 */
interface LedgerView { allowance?: number; remaining?: number | null; reserve?: number; resetAt?: number; synced?: boolean; serverLimit?: number; serverRemaining?: number | null }
/** 桥要用到的账本两口：按后端取一桶，以及总览（没有可显式指认的后端时，用它认唯一的那个）。 */
interface LedgerLike {
  view?: (backendId: string, bucket: string) => LedgerView
  snapshot?: () => { buckets?: Record<string, LedgerView> }
}

/** 读数里的数字可能缺格（旧缓存或手写夹具）：缺格按 0 算，与账本的兜底口径一致。 */
function numOf(value: unknown): number { return (typeof value === 'number' && isFinite(value)) ? value : 0 }
/** 装配依赖包：九个工具工厂要的全部依赖，由宿主接线方现取现传（与门禁里直接喂给工厂的那一份同形）。 */
export interface HostToolDeps { gate?: unknown; registry?: unknown; budget?: unknown; estimate?: unknown; costInputFrom?: unknown; handleFor?: unknown; backendCtx?: unknown; invalidate?: unknown }

/**
 * 配出 Tracker 会话要的三件（#1442，读缓存、裁决、记账各一件）。
 * 读数按后端的口径给形状（#1446）：离网后端如实报「这一口径不支持读数」，只计请求的后端
 * 给 requests 桶，双桶后端要求 rest 与 graphql 两个桶都同步过；认不出后端、或该桶还没同步过，
 * 一律报未知，不拿 0 冒充。裁决交给 budget-admission 里的纯函数：硬顶先行、离网与未知放行、
 * 只计请求看 requests 余量、双桶逐桶看写保底。本文件只负责把「哪个后端、哪个桶」交给账本，
 * 不自己写额度数字；记账按口径分桶，离网恒记零花，写账统一走 kernel/backend-accounting.ts 的
 * createAccountPort（#1454：全仓只有那一处调 ledger.spend）。
 *
 * 为什么导出：门禁 tests/verify-deck-tools-matrix.ts 要判断「每一条远端命令发出去的时候，
 * 是不是正处在一次经裁决放行、还没记账的操作里」。它需要的就是装配层这一份裁决与记账
 * （而不是在门禁里另抄一份口径），所以这里把这一份原样交出去；宿主装配仍只用本文件里这一个实例。
 */
export function buildTrackerPorts(base: UnknownRecord): { getCachedReading: (backendId?: unknown) => unknown; admit: (input: unknown) => Promise<unknown>; account: (input: unknown) => Promise<void> } {
  // 账本视图里总额度叫 allowance（不是 limit）：这里按 allowance 取，裁决的写保底才算得对。
  const ledger = (base.ledger || null) as LedgerLike | null;

  // 额度算式从宿主那一份注入：本文件只负责把「哪个后端、哪个桶」交给账本，不自己写数字。
  const limits: BudgetLimits = {
    pluginShareOfRemaining: budget.PLUGIN_SHARE_OF_REMAINING,
    hourlyAllowance: budget.hourlyAllowance,
    writeReserve: budget.writeReserve,
    tierFor: budget.tierFor,
    // #1527：AI 工具这一档的保底按服务端上限的 5% 算（不是插件份额的 30% 写保底）。
    aiToolFloor: budget.aiToolFloor,
  };

  /**
   * 接受方传来的后端编号优先；桥自己的入参次之；最后才看账本总览 —— 账本里只有一个后端时，
   * 它的账就是这一趟的账，认它不会把两个后端的额度混在一起。都认不出来就回空串：
   * 空串意味着「读数未知」，裁决会如实放行，而不是拿零冒充。
   */
  const backendIdOf = function (explicit?: unknown): string {
    if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
    const declared = base.backendId;
    if (typeof declared === 'string' && declared.trim()) return declared.trim();
    if (typeof declared === 'function') {
      try {
        const value = (declared as () => unknown)();
        if (typeof value === 'string' && value.trim()) return value.trim();
      } catch { /* 取不到就按未知处理，不抛 */ }
    }
    try {
      if (ledger && typeof ledger.snapshot === 'function') {
        const snapshot = ledger.snapshot() || {};
        const ids: string[] = [];
        for (const key of Object.keys((snapshot && snapshot.buckets) || {})) {
          const cut = key.indexOf('/');
          const id = cut > 0 ? key.slice(0, cut) : '';
          if (id && ids.indexOf(id) < 0) ids.push(id);
        }
        if (ids.length === 1) return ids[0];
      }
    } catch { /* 总览读不出来就当没有可认的后端 */ }
    return '';
  };

  /** 注册表里这个后端的口径声明；桥没拿到注册表或没有这一条时回 null，由读数形状兜底。 */
  const modelOf = function (backendId: string): BackendBudgetModel | null {
    if (!backendId) return null;
    try {
      const registry = base.registry as { modules?: () => Array<{ id?: unknown; budget?: unknown }> } | undefined;
      if (!registry || typeof registry.modules !== 'function') return null;
      const found = registry.modules().filter(function (m) { return m && m.id === backendId; })[0];
      const model = found && found.budget as BackendBudgetModel | undefined;
      return model && typeof model.kind === 'string' ? model : null;
    } catch { return null; }
  };

  const viewOf = function (backendId: string, bucket: string): LedgerView | null {
    try {
      return ledger && typeof ledger.view === 'function' ? (ledger.view(backendId, bucket) || null) : null;
    } catch { return null; }
  };

  /**
   * 一族读数的形状（#1527）：数字取服务端真实读数，不取插件份额。
   *   - limit 用服务端上限（5000 点/条）算保底；读数缺上限才退回账本份额（旧缓存夹具）。
   *   - remaining 用「服务端剩余 − 本插件自同步以来花掉的」，花完这一笔还剩多少由它推。
   * 只改 AI 工具这条路；后台刷新仍读账本份额（policyQuotaOf），两边各自按自己的口径自律。
   */
  const levelOf = function (v: LedgerView) {
    const serverLimit = numOf(v.serverLimit)
    const serverRemaining = (typeof v.serverRemaining === 'number' && isFinite(v.serverRemaining)) ? v.serverRemaining : numOf(v.remaining)
    return { remaining: serverRemaining, limit: serverLimit > 0 ? serverLimit : numOf(v.allowance), resetAt: numOf(v.resetAt) };
  };

  const getCachedReading = function (backendId?: unknown): unknown {
    if (!ledger || typeof ledger.view !== 'function') return { known: false, reason: 'not-measured' };
    const id = backendIdOf(backendId);
    if (!id) return { known: false, reason: 'not-measured' };
    const model = modelOf(id);
    // 离网后端本来就不花额度：这是「读数已知且明确不需要额度」，与「还没量出来」「不支持读数」都不是一回事
    // （规格第 7 节要求未知、离网、耗尽三件事分开说），所以回 known:true 的离网读数，不混进未知那一支。
    if (model && model.kind === 'off-network') return { known: true, kind: 'off-network' };
    const requests = viewOf(id, 'requests');
    const rest = viewOf(id, 'rest');
    const graphql = viewOf(id, 'graphql');
    const wantRequests = model ? model.kind === 'requests-only' : !!(requests && requests.synced === true);
    if (wantRequests) {
      if (!requests || requests.synced !== true) return { known: false, reason: 'not-measured' };
      return { known: true, kind: 'requests-only', requests: levelOf(requests) };
    }
    // 两桶要两个桶都同步过才给读数：只同步了一桶时报未知，不拿另一桶的 0 冒充。
    if (!rest || !graphql || rest.synced !== true || graphql.synced !== true) return { known: false, reason: 'not-measured' };
    return { known: true, kind: 'two-buckets', buckets: { rest: levelOf(rest), graphql: levelOf(graphql) } };
  };

  const admit = async function (input: unknown): Promise<unknown> {
    const rec = (input || {}) as UnknownRecord;
    // 口径与读数都按契约形状接：桥不知道后端细节，裁决也不认后端名字。
    const decision = decideByBudget({
      op: String(rec.op || ''),
      budget: (rec.budget || { kind: 'unknown', countsRequests: false, countsPoints: false, independentBuckets: false }) as BackendBudgetModel,
      reading: (rec.reading || { known: false, reason: 'not-measured' }) as BudgetReading,
      canWrite: rec.canWrite !== false,
      // #1527：把这一笔的预计花费交给裁决，「花完还剩多少」才判得准。
      points: numOf(rec.points),
      requests: numOf(rec.requests),
    }, limits);
    return decision;
  };
  // #1454：deck 工具这条路的真实用量记 'ai-tool' 档。换算与写账都收在 createAccountPort 里，
  // 与刷新后台（session-opener，记 'plugin' 档）共用同一个写入口，只是档位不同。
  const accountPort = createAccountPort({ ledger: ledger, account: 'ai-tool' });
  const account = async function (input: unknown): Promise<void> {
    await accountPort(input as AccountInput);
  };
  return { getCachedReading: getCachedReading, admit: admit, account: account };
}

/** 声明文件读取的等待上限（毫秒）：挂住的文件服务不能卡住选后端，超时按缺席跳过。数值与位置全冻（#1030 Q4），真源见中央 YAML。 */
export const DECK_ASSEMBLY_TIMEOUT_MS = CENTRAL_DECK_ASSEMBLY_TIMEOUT_MS

/**
 * 装一次，回 createDeckTools 的原话：{ tools, names, definitions, missing }。
 * toolDeps 就是九个工具工厂的依赖（闸、注册表、额度、算账、会话→句柄、后端 ctx、planStore、
 * invalidate）—— 与 tests/verify-deck-tools.js 里直接喂给工厂的那一份同形，
 * 所以「门禁里跑得通」与「宿主里跑得通」是同一件事，而不是两份各自能跑的实现。
 */
export function createDeckToolsForHost(toolDeps: unknown): unknown {
  const base = ((toolDeps as UnknownRecord | null | undefined) || {}) as UnknownRecord;
  // #1003 补声明文件这一层：工具壳新增的 readDeclarationId 缺席时，由装配层按现有文件服务现拼一个。
  //   读与解析与探测器同路径同口径（docs/agents/issue-tracker.md + parseIssueTracker），不另起第二套。
  // #1572：声明读法要把解析器的置信度一并交回判定层；低置信只作证据（方案 A），不再只回一个 id。
  let readDeclarationId = base.readDeclarationId as ((rootCwd: unknown) => Promise<unknown>) | undefined;
  if (typeof readDeclarationId !== 'function') {
    readDeclarationId = async function (rootCwd: unknown): Promise<unknown> {
      try {
        const backendHolder = base as { backendCtx?: () => unknown };
        const backendObj = (typeof backendHolder.backendCtx === 'function' ? backendHolder.backendCtx() : (base.backendCtx || {})) as UnknownRecord | null;
        const fsSvc = (backendObj && (backendObj.fs as UnknownRecord | null)) || (backendObj && backendObj.platform && ((backendObj.platform as UnknownRecord).fs as UnknownRecord | null)) || null;
        const fsOps = fsSvc as { resolve?: (target: string, opts: { cwd: unknown }) => Promise<unknown>; readText?: (target: unknown) => Promise<unknown> } | null;
        if (!fsOps || typeof fsOps.resolve !== 'function' || typeof fsOps.readText !== 'function') return null;
        const raced = await withCap(
          Promise.resolve(fsOps.resolve('docs/agents/issue-tracker.md', { cwd: rootCwd })).then(function (t: unknown) { return (fsOps as { readText: (target: unknown) => Promise<unknown> }).readText(t); }, function () { return null; }),
          DECK_ASSEMBLY_TIMEOUT_MS
        );
        const raw = (raced && raced.ok === true) ? raced.value : null;
        if (!raw) return null;
        const { parseIssueTracker, normalizeTrackerText } = await import('../../tracker/detection/parseIssueTracker.js');
        const parseFn = parseIssueTracker as (text: string) => { explicitBackendId?: unknown; confidence?: unknown; reason?: unknown } | null;
        const normalizeFn = normalizeTrackerText as (text: string) => string;
        const parsed = parseFn(normalizeFn(raw as string));
        if (parsed && parsed.explicitBackendId) {
          // 未注册的 id 由调用方按“未知层跳过”处理，这里只透传文本结论。
          // 高置信与低置信都回同一形状（#1572）：高置信不带原因，判定层按缺省的 declaration-hit 记；
          // 低置信把解析器原因一并带上（步骤原因 declaration-low-<原因>），判定层只把它当证据、不当结论。
          const hint: { id: string; confidence: 'high' | 'low'; reason?: string } = { id: parsed.explicitBackendId as string, confidence: parsed.confidence === 'low' ? 'low' : 'high' };
          if (parsed.confidence === 'low' && typeof parsed.reason === 'string' && parsed.reason) hint.reason = parsed.reason;
          return hint;
        }
        return null;
      } catch {
        return null;
      }
    };
  }
  const createTools = createDeckTools as (factories: unknown, deps: unknown) => unknown;
  const decideBackendFn = (decideBackend as unknown) || null;
  // #1442：Tracker 会话要的三件（读缓存、裁决、记账）由装配层配齐，九个工具只管调会话，不自己找闸与账本。
  // 调用方已经配好的不动（门禁直调工厂时自带桩，本层不覆盖）；1443 才接真正的分桶读数缓存，
  // 本票的读缓存先从账本即时读（同步过就有数，没同步过就诚实报未知，未知不拦事）。
  const ports = buildTrackerPorts(base);
  // 装配后的依赖包换一个名字：与入参同名叫 toolDeps 时是重复声明（TS2300，宿主与刷新两份配置各报一次）。
  const mergedDeps = Object.assign({}, base, { readDeclarationId, decideBackend: decideBackendFn });
  if (typeof mergedDeps.getCachedReading !== 'function') mergedDeps.getCachedReading = ports.getCachedReading;
  if (typeof mergedDeps.admit !== 'function') mergedDeps.admit = ports.admit;
  if (typeof mergedDeps.account !== 'function') mergedDeps.account = ports.account;
  return createTools(DECK_TOOL_FACTORIES, { toolDeps: mergedDeps })
}


// ── B12（#1429）：宿主侧 deck 工具桥 ─────────────────────────────────────────────
// 原 refresh-runtime.ts D 段整体搬入（注释与实现一字不动，只换落点）：memo、后端 ctx 组装、
// planStoreFor、readWorkspaceFileText 与 createDeckToolsForHost 调用（本文件内直调）。
// 依赖全部由宿主接线方现取现传（14 个字段，见下）；gate / ledger 仍是运行时造的那一份，不另造。
// 为什么工厂参数仍叫 d：搬来的闭包体里十处 d.X 原样保留，零改写就是零行为差；
// 八个别名（四个运行时函数 + gate / ledger / logCtx / workspaceKeyOf）是闭包体里的裸名，
// 在这里接到依赖包同名字段上，实例仍是运行时的那一份（gate / ledger 只造一份，不另造）。
export function createDeckToolBridge(deps: any): any {
  const d: any = deps || {}
  const ensureDeckReading = d.ensureDeckReading
  const onDeckWrite = d.onDeckWrite
  const sessionTitleSnapshotOf = d.sessionTitleSnapshotOf
  const loadWorkRouteBindings = d.loadWorkRouteBindings
  const gate = d.gate
  const ledger = d.ledger
  const logCtx = d.logCtx
  const workspaceKeyOf = d.workspaceKeyOf
  let deckToolsP: Promise<any> | null = null
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
              // 先判 .dispose 两种写法在它上面都是空操作，详见 src/refresh/contract/host-timer-ports.ts 文件头。
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
          outbound: createOutboundControl(logCtx),
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
        // 家目录、文件读写、改名与日志的细节都在 work-route-readout.ts 里，这里只取现成的实例。
        // 取不到就留给三支依赖各自回「没落上 / 没接上」的诚实原因，不静默跳过。
        let workRouteBindings: any = null
        try { workRouteBindings = await loadWorkRouteBindings() } catch (eW: any) {}
        const built: any = createDeckToolsForHost({
          gate: gate,
          ledger: ledger,
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
  return { deckToolsForHost: deckToolsForHost }
}
