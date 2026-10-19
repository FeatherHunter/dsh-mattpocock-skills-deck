// src/deck/shell/call-shell.ts —— 九个 deck_* 工具共用的薄壳机制（#713 第六批；#1040 转 TypeScript）
//
// 为什么单独一层而不是写在宿主工具目录：九个工具若各写一份「从会话上下文取工作区、过闸、三态返回、永不抛」，
// 同一套规则就会有九份。这个文件放在 shell/ 里，九个工具文件各自 import 它一条边（工具 → 壳是允许的方向），
// 规则仍然只有一份。当初撑着这件事的是「同一层里的文件不许互相引用」那条门禁（这些文件那时住在 src/shared/）；
// 2026-10 搬进 src/deck/ 之后那条门禁不再覆盖这棵树，但「一份规则、九个工具各引一条边」的形状照旧不变，
// 地图 #1037（规则只有一份）继续沿这个方向往下拆。
//
// 本文件不 import 闸、后端注册表、额度常量、算账函数这类运行时依赖：它们都由接线方（或测试）从构造函数传进来。
// 这不是洁癖 —— 额度常量住在 src/shared/refresh/budget.js，本层不该反向去取，所以只能由调用方取好传进来
// （做法与宿主侧的 gate.js / ledger.js、纯函数层的 policy.ts / backoff.ts 一致）。
// 本文件自己的运行时 import 只有三处：./in-flight-lease.js（并发同票串行）、./work-path-record.js
// （#1261 成功收口记一笔）与中央超时的值；其余形状全部 `import type` 自 ./call-shell-types.js，只借形状。
// （work-path-record.ts 内部另外运行时 import 了一处共享纯逻辑，那笔边记在它自己的文件头上。）
// 为什么要拆出那份形状文件：这个文件补完类型标注之后有效行数到了 461，越过了「单文件 350 行」那条上限
// （tests/verify-file-granularity.ts）。拆开的唯一原因就是那条上限，不是为了分层 —— 与同目录 rules/ 那几份的口径一致。
//
// 这个壳守住四条硬要求（票面点名的三条 + 加固补充里那条）：
//   1. 每次后端调用都过宿主闸：选后端那一次探测与真正的读写各过一次闸，走 AI 那一档
//      （gate.admitAiTool 先判硬顶，超顶直接拒绝并说明用了多少、顶在哪；gate.send 再记真实花费）。
//      工具文件里没有一处直接调后端实现，也没有一处自己判后端是谁。
//   2. 后端一律走既有优先级出口 registry.select（用户手动选择 > 锚文件 > 自动识别），工具不自己挑。
//   3. 工作区与仓库从会话上下文取（exec.agent.session），不接受调用方传参；解析不出来就如实说做不到。
//   4. 工具永不抛异常：后端实现抛错、闸拒绝、没后端、会话取不到，一律变成 ok:false/partial 的三态返回
//      —— 抛出去 AI 会退回去用它熟悉的 gh，两条写路径同时开火。
//
// 三态与「拒绝」的关系（这里说清，免得以后有人以为少了第四种状态）：
//   ok          这一次做成了（部分成功用 partial）；
//   partial     一批里有的成、有的没成，逐项列出谁成了谁没成；
//   unsupported 这件事没做成，并且如实说了为什么 —— 原因写在 reason 字段里，取值见下面 REFUSAL_REASONS。
//
// 类型口径（#1040 转 TypeScript 时定下）：本文件是「取数与注入」的交界，外面递进来的东西
// （exec、会话、闸、注册表、估算函数）形状都不由本文件决定，所以入参按 unknown 收、用之前逐格验；
// 本文件发出去的两样东西则给出明确契约 —— 三态信封 DeckEnvelope 与选后端结论 PickResult，
// 九个工具与测试都按这两张形状读。这些形状（含 DeckShellDeps 与 DeckShell 自己）都住在
// ./call-shell-types.ts，那边同时写明「改字段名要连带看哪些门禁」。

import type {
  AdmitResult, CallCtx, CallMeta, CostEstimate, DeckEnvelope, DeckLimits, DeckLogLike, DeckRepo, DeckRepoRef,
  DeckShell, DeckShellDeps, GateLike, GateSendResult, HourUsageView, PickResult, PickSuccess, RegistryLike,
  ShellSession, UnknownRecord, WaitSignal,
} from './call-shell-types.js'
import { withInFlightLease } from './in-flight-lease.js'
import { noteWorkRoute } from './work-path-record.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { SHELL_RESOLVE_TIMEOUT_MS } from '../../shared/time-config/values.js'

/** 这批工具的身份（写日志时进 host.call 的 kind 字段；不是新事件，沿用它原有的字段清单）。 */
export const DECK_TOOL_KIND = 'deck-tool'
/** 三态返回的取值。edges.ts 的 statusOfItems 返回的就是这三个字符串（验收脚本有一条断言钉住这件事）。 */
export const DECK_STATUS = Object.freeze({ OK: 'ok', PARTIAL: 'partial', UNSUPPORTED: 'unsupported' })
/** 「这件事没做成」的原因取值。文案给人的那句话说在返回的 text 里，这里只放机器可读的那一格。 */
export const REFUSAL_REASONS = Object.freeze({
  NO_SESSION: 'no-session-context',
  OVER_CAP: 'ai-tool-refused',
  NO_BACKEND: 'no-backend',
  GATE_DEFER: 'gate-defer',
  BACKEND_THREW: 'backend-threw',
  BACKEND_TIMEOUT: 'backend-timeout',
  BACKEND_UNSUPPORTED: 'backend-unsupported',
  BAD_ARGS: 'bad-args',
})

// 落点表（EDGE_LANDING）与它的判定（landingOf / classifyEdgeLanding / edgeEvidence / childrenOf / statusOfItems）
// 住在同目录的 rules/ 里：那边写的是「规矩」，这里写的是「机制」（会话怎么取、闸怎么过、信封怎么拼）。
// 拆成两个文件的唯一原因是 350 行的单文件上限（tests/verify-file-granularity.ts），不是为了分层。

// 会话、额度、算账结论、仓库身份、选后端结论、闸与注册表、日志出口、建壳依赖、三态信封、调用上下文
// 这些形状都搬到了同目录的 call-shell-types.ts（只借形状，不留运行时边），这里不再重复声明。
// 只有两张内部草稿留在本文件：判定出口交回来的东西（OutletResult）与选后端过程中在手上滚的草稿（PickedDraft）。

/** 判定出口（#1003 单出口）交回来的东西：字段可能缺，缺了就按未决处理。 */
interface OutletResult {
  backendId?: unknown;
  source?: unknown;
  ref?: unknown;
  multiHit?: unknown;
  pending?: unknown;
  canWrite?: unknown;
}

/** 选后端过程中在手上滚的那份草稿：边问边补 ref，最后才收成 PickResult。 */
interface PickedDraft {
  backendId: unknown;
  source: string;
  ref: DeckRepoRef | null;
  multiHit?: unknown;
  pending?: boolean;
}


function num(v: unknown): number { return (typeof v === 'number' && isFinite(v)) ? v : 0 }
function str(v: unknown): string { return (typeof v === 'string') ? v : '' }
/**
 * 缺省等待口：真定时器。只有这里碰全局时钟，deps.sleep 一注入就绕开了它。
 * 收到中止信号就提前放行——工具侧拿它当单次调用的钳制（call-budget.ts 的 sleepFn），
 * 调用方一中止，等待不该还硬挺着；没有信号时与原来一模一样。
 */
function realSleep(ms: number, signal?: WaitSignal | null): Promise<unknown> {
  return new Promise(function (resolve) {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onAbort = function () { finish() }
    const finish = function () {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort)
      resolve(null)
    }
    timer = setTimeout(finish, ms)
    // 只为「到点提醒」的定时器不许决定进程活多久（#1114 的实测教训）：
    // 赢的那一方先到时，这里没人清它，于是进程被吊着——unref 之后它照样会到点提醒，
    // 但不再拦住退出；真还有活干时，干活的那条路自己会留住进程。
    try {
      const t = timer as unknown as { unref?: () => void }
      if (t && typeof t.unref === 'function') t.unref()
    } catch (e) {}
    if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort)
  })
}
function hash8(text: unknown): string {
  let h = 5381
  const t = String(text || '')
  for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}

/** 额度常量从 budget.js 取好传进来时的对照表：字段名与 refresh-core/src/budget.ts 的导出同名。 */
export function limitsFromBudget(b: unknown): DeckLimits {
  const src = (b || {}) as UnknownRecord
  return {
    maxPointsPerCall: num(src.AI_TOOL_MAX_POINTS_PER_CALL),
    maxRequestsPerCall: num(src.AI_TOOL_MAX_REQUESTS_PER_CALL),
    maxChildTicketsPerCall: num(src.AI_TOOL_MAX_CHILD_TICKETS_PER_CALL),
    maxPointsPerHour: num(src.AI_TOOL_MAX_POINTS_PER_HOUR),
    maxRequestsPerHour: num(src.AI_TOOL_MAX_REQUESTS_PER_HOUR),
  }
}

// 会话目录取法只有 session-workdir.ts 一份（九个工具全走它的 Async 版）；本文件曾有的同步复件已删，免得两份分叉。
// 边的落点判定与逐项证据（landingOf / classifyEdgeLanding / childrenOf / statusOfItems）住在同目录的 rules/ 里：
// 纯规则侧不许引宿主侧（门禁 deck-rules-stay-pure），所以那边自带一份最小的字符串工具函数，
// 拆开的理由见 rules 那几份的文件头。
// 「一批里有的成、有的没成 → partial」这条总结论也在那边（statusOfItems），这里不再留第二份。

/**
 * 建一个壳。deps：
 *   gate       必填，宿主闸（src/host/refresh/gate.js 的产物）：admitAiTool / send / stats
 *   registry   必填，后端注册表（src/tracker/registry/core.ts 的产物）：select / get
 *   budget     必填，额度常量（src/shared/refresh/budget.js 的产物），只为拼出 limits 用
 *   estimate   必填，算账函数（src/shared/refresh/tool-cost.js 的产物）
 *   backendCtx 可选，后端 ctx（platform / fs / exec 那一套）；不传时用 opCtx 顶上
 *   log        可选，日志出口 { fire }（写 host.call / host.call.fail 两行；#1048 起同一个出口也递给
 *              判定出口，叫这一趟判定留下自己的结论线，事件名仍是判定那两件，壳本身不新增事件名）
 *   now        可选，取时间（测试注入假时钟）
 *   sleep      可选，等待口：(毫秒, 中止信号?) => Promise，缺省真定时器（测试注入假时钟，就不必真等 8 秒）；
 *   invalidate 可选，写后失效缓存该票条目：invalidate({ repo, backendId, keys, workspace })
 *   ensureReading 可选，动手前保剩余额度读数：ensureReading(cwd, workspaceKey)，缺席时跳过
 *   resolveTimeoutMs 可选，仓库标识补全等待上限毫秒数（缺席 8000，测试可调小）
 *   readWorkspaceFileText 可选，读工作区文件原文：(规范根) => string | null（缺席跳过文件层）
 *   parseWorkspaceFile 可选，解析文件文本（与 readWorkspaceFileText 同给同缺）
 *   readDeclarationId 可选，读声明文件写明的后端（#1003，缺席跳过声明层）
 */
export function createDeckShell(deps?: DeckShellDeps): DeckShell {
  const d = (deps || {}) as DeckShellDeps
  // 三个必填项按「装配方已经给了」来用：缺了就在用到的那一刻报错，与转 TypeScript 之前的行为一致。
  const gate = d.gate as GateLike
  const registry = d.registry as RegistryLike
  const budget = (d.budget || {}) as UnknownRecord
  const estimate = d.estimate as (input: unknown, withHour: HourUsageView) => unknown
  const log = (d.log || null) as DeckLogLike | null
  const now: () => number = typeof d.now === 'function' ? d.now : Date.now
  const sleep: (ms: number, signal?: WaitSignal | null) => Promise<unknown> = typeof d.sleep === 'function' ? d.sleep : realSleep
  const limits = limitsFromBudget(budget)

  function fire(method: string, ms: number, ok: boolean, errorHash?: string): void {
    if (!log || typeof log.fire !== 'function') return
    try {
      if (ok) log.fire('info', 'host.call', { method: method, latencyMs: ms, ok: true, kind: DECK_TOOL_KIND })
      else log.fire('warn', 'host.call.fail', { method: method, kind: DECK_TOOL_KIND, errorHash: errorHash || hash8('unknown') })
    } catch (e) { /* 日志坏了不影响工具干活 */ }
  }

  // 闸口径迹（#758 干跑诊断用）：把每次裁决的机器码记进共享格，探针读走。
  // 只记阶段、结论、原因枚举，正文路径一律不记；口子缺席就跳过。
  function noteGate(phase: string, verdict: string, reason: string): void {
    try { if (typeof d.noteGate === 'function') d.noteGate({ phase: phase, verdict: verdict, reason: reason }) } catch (eN) {}
  }

  /** 后端 ctx（platform / fs / exec 那一套）：可以给对象，也可以给一个现取的函数（多工作区共用一个壳时后者更顺手）。 */
  function backendCtxNow(): UnknownRecord {
    const b = d.backendCtx
    if (typeof b === 'function') { try { return (b() || {}) as UnknownRecord } catch (e) { return {} } }
    return (b || {}) as UnknownRecord
  }

  /**
   * 调用前算账：工具名 + 参数 → 点数、请求数、超没超单次顶、建议分几片。
   * 「本小时 AI 工具已经花了多少」由接线方给（deps.hourUsage，通常接账本的 hourOf('ai-tool')）：
   * 拿不到时按 0 算，只影响建议里那句「本小时快用满了」，不影响单次硬顶的裁决（那是闸的事）。
   */
  function estimateFor(tool: string, args?: unknown): CostEstimate {
    let used: UnknownRecord = {}
    if (typeof d.hourUsage === 'function') {
      try { used = (d.hourUsage() || {}) as UnknownRecord } catch (e) { used = {} }
    }
    const input = typeof d.costInputFrom === 'function' ? d.costInputFrom(tool, args) : { tool: tool }
    const withHour = Object.assign({}, limits, { usedPointsThisHour: num(used.points), usedRequestsThisHour: num(used.requests) })
    return estimate(input, withHour) as CostEstimate
  }

  /** 统一的返回信封。 */
  function envelope(tool: string, status: string, extra?: UnknownRecord): DeckEnvelope {
    const base: DeckEnvelope = {
      ok: status === DECK_STATUS.OK,
      status: status,
      tool: tool,
      reason: '',
      text: '',
    }
    return Object.assign(base, extra || {})
  }

  function unsupported(tool: string, reason: string, text: string, extra?: UnknownRecord): DeckEnvelope {
    return envelope(tool, DECK_STATUS.UNSUPPORTED, Object.assign({ reason: reason, text: text }, extra || {}))
  }

  /** 超顶：把闸那句原话端出去（哪一项顶住了、用了多少，都由闸说），工具不自己编一个数。 */
  function refused(tool: string, est: CostEstimate, s: ShellSession, admit: AdmitResult): DeckEnvelope {
    const est2 = Object.assign({}, est, admit && admit.points != null ? { points: admit.points, requests: admit.requests } : {})
    return unsupported(tool, REFUSAL_REASONS.OVER_CAP, admit && admit.text ? String(admit.text) : '这次调用超过了插件给 AI 工具设的硬顶，我没有动手。', {
      cost: { estimated: est2 },
      workspace: { root: s.cwd, key: s.workspaceKey },
    })
  }

  /**
   * 过闸选后端。这是每笔工具调用的第一次后端调用（matches 会真的去读工作区/问远端），
   * 所以它也过一次闸；结论原样交给调用方与 AI（包括「没有后端」与「还没定」两种情形）。
   * 动手前先保一次剩余额度读数（#758）：账本差读数时免费读一次，不差不打；
   * 保不住就照旧往下走，闸会诚实推迟——保读数永不代替裁决。
   */
  async function pickBackend(exec: unknown, s: unknown): Promise<PickResult> {
    const ss = (s || null) as ShellSession | null
    if (!(ss && typeof ss.cwd === 'string' && ss.cwd.trim() !== '')) return { ok: false, reason: REFUSAL_REASONS.NO_BACKEND, text: '这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区后再试。' }; // #1003 空目录闸
    // 「会话 → 句柄」由接线方给（宿主知道这个工作区绑了哪个 refId / effortId）；没给时只用会话里的目录。
    const handle = (typeof d.handleFor === 'function') ? (d.handleFor(ss) || { cwd: ss.cwd }) : { cwd: ss.cwd }
    let picked: PickedDraft | null = null
    let failure: unknown = null
    let sent: GateSendResult | null = null
    const t0 = now()
    try { if (typeof d.ensureReading === 'function') await d.ensureReading(ss.cwd, ss.workspaceKey) } catch (eR) {}
    // #1003 单出口：显式那几层（工作区文件 > 声明文件，缺席跳过，未注册忽略）整段交统一判定；
    //   自动识别包着配额闸走（probe 一格，成功记 1 请求；里面直调，不 double 记账）。
    //   本文件不引用判定服务（它归宿主侧，壳只收装配层递进来的函数），函数只经依赖值由装配层递进来。
    const useOutlet = (typeof d.decideBackend === 'function') ? d.decideBackend : null
    if (!useOutlet) {
      // 缺依赖即装配错：如实说没动手，不抛（工具永不抛），不编一个后端出来。
      // 这里回的是「选后端没成」的失败形状（与其他每一条失败分支同形）：工具拿到 reason 与 text
      // 之后会用自己的工具名重拼信封。2026-10-14 转 TypeScript 时类型检查发现原来这一行把
      // 附加字段塞进了 text 那一格（信封里 text 成了对象、reason 成了整句中文），一并改回同形。
      return { ok: false, reason: REFUSAL_REASONS.BACKEND_THREW, text: '判定出口这次没装上，我没往下做。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者。', errorHash: hash8('missing-decideBackend') }
    }
    {
      // 整段包进闸（与接单出口前同一闸口径）：probe 一格。
      const directSelect = async function (h: unknown, actx?: unknown): Promise<unknown> {
        const a = (actx || null) as UnknownRecord | null
        return registry.select(h, Object.assign({}, backendCtxNow(), { cwd: ss.cwd, caller: (a && a.caller) || DECK_TOOL_KIND, signal: (a && a.signal) || undefined }))
      }
      try {
        sent = await gate.send({ source: 'tool.call', kind: 'probe', bucket: 'rest', workspaceKey: ss.workspaceKey, plan: [{ phase: 'select' }] }, async () => {
          const o = (await useOutlet(ss.cwd, {
            registry: registry, backendCtx: backendCtxNow(),
            readWorkspaceFileText: d.readWorkspaceFileText, parseWorkspaceFile: d.parseWorkspaceFile,
            readDeclarationId: d.readDeclarationId, caller: DECK_TOOL_KIND, autodetect: directSelect,
            // #1048 收口补做：把宿主日志出口一并递进判定出口，这条路上的判定才留下结论线
            //   （平时一条常驻结论，调试开关打开时逐层记步骤）。递进去的是同一个 logCtx，
            //   所以「开关打开即三层全问」这条在这条路上也一样成立。
            logCtx: log,
          })) as OutletResult | null
          if (o && o.backendId) {
            picked = { backendId: o.backendId, source: str(o.source), ref: (o.ref || null) as DeckRepoRef | null, multiHit: o.multiHit, pending: !!o.pending }
            if (!picked.ref) { try { picked.ref = registry.describe(handle, picked.backendId) as DeckRepoRef | null } catch (eD) { picked.ref = null } }
          } else if (o && o.pending) {
            picked = { backendId: null, source: 'fallback', pending: true, ref: null, multiHit: o.multiHit }
          } else {
            picked = { backendId: null, source: 'fallback', ref: null }
          }
          return { requests: 1, points: 0 }
        })
      } catch (e) { failure = e }
    }
    const ms = now() - t0
    if (failure) { const f = (failure || null) as UnknownRecord | null; return { ok: false, reason: REFUSAL_REASONS.BACKEND_THREW, text: '选后端这一步的后端实现抛错了，我没往下做。', errorHash: hash8(String((f && f.message) || failure)) } }
    if (!sent || sent.sent !== true) {
      noteGate('select', 'defer', str(sent && sent.reason))
      return { ok: false, reason: REFUSAL_REASONS.GATE_DEFER, text: '这一次选后端被闸推迟了（' + str(sent && sent.detail) + '），先不做。' }
    }
    // 仓库标识补全（#758）：匹配源常带空标识（注册表只认显式 refId），而房间读写真要它。
    // 有该能力的后端（契约定位口 getRepoKey）调用方按通用形状自己补，不逐后端写分支；
    // 没有该能力的后端没有这一格，跳过，下游照旧诚实失败。补全本身也过一次闸（读探针一格）。
    // 上面那段在闸的回调里赋值，控制流分析看不到它，会把 picked 当成一直是 null；
    // 这里显式读一次并声明类型（draft 与 picked 是同一个对象，后面补 ref 也补在它身上）。
    const draft = picked as PickedDraft | null
    if (draft && draft.backendId && (!draft.ref || !draft.ref.refId)) {
      try {
        const tracker = (registry && typeof registry.get === 'function') ? registry.get(draft.backendId) : null
        const tRec = (tracker || null) as UnknownRecord | null
        const getRepoKey = tRec ? tRec.getRepoKey : null
        if (typeof getRepoKey === 'function') {
          const cap = (typeof d.resolveTimeoutMs === 'number' && d.resolveTimeoutMs > 0) ? Math.floor(d.resolveTimeoutMs) : SHELL_RESOLVE_TIMEOUT_MS
          let key: unknown = null
          let resolveSent: GateSendResult | null = null
          try {
            resolveSent = await gate.send({ source: 'tool.call', kind: 'probe', bucket: 'rest', workspaceKey: ss.workspaceKey, plan: [{ phase: 'resolve' }] }, async () => {
              try {
                // #1157：这场竞速还没结算，就先扣一份存活租约。下面的等待口是 unref 过的
                // （#1114：提醒不拥有存活），补全真挂住时唯一还活着的东西就是这笔等待 ——
                // 没有租约，Node 会带着这场没结算的竞速收摊，工具调用永远没有下文。
                key = await withInFlightLease(function () {
                  return Promise.race([
                    Promise.resolve((getRepoKey as (cwd: string, ctx: unknown) => unknown)(ss.cwd, Object.assign({}, backendCtxNow(), { cwd: ss.cwd, caller: DECK_TOOL_KIND }))),
                    sleep(cap).then(function () { return null }, function () { return null }),
                  ])
                })
              } catch (eResolve) { key = null }
              return { requests: 1, points: 0 }
            })
          } catch (eSend) { resolveSent = null }
          noteGate('resolve', resolveSent && resolveSent.sent === true ? 'allow' : 'defer', resolveSent && typeof resolveSent.reason === 'string' ? resolveSent.reason : '')
          const kRec = (key || null) as UnknownRecord | null
          if (resolveSent && resolveSent.sent === true && kRec && typeof kRec.owner === 'string' && kRec.owner && typeof kRec.name === 'string' && kRec.name) {
            const refId = kRec.owner + '/' + kRec.name
            draft.ref = { backend: draft.backendId, refId: refId, name: refId, url: 'https://github.com/' + refId }
          }
        }
      } catch (eR) {}
    }
    if (draft && draft.backendId && str(draft.source) !== 'explicit' && ((Array.isArray(draft.multiHit) && draft.multiHit.length > 1) || draft.pending)) { const mh = Array.isArray(draft.multiHit) && draft.multiHit.length > 1; return { ok: false, reason: REFUSAL_REASONS.NO_BACKEND, text: mh ? '这个工作区同时被 ' + (draft.multiHit as unknown[]).length + ' 个后端认出，请在面板中选定后再试。' : '后端还没定下来，先在面板上选一次后端。' } }
    if (!draft || !draft.backendId) {
      const pending = draft && draft.pending
      return { ok: false, reason: REFUSAL_REASONS.NO_BACKEND, text: pending ? '后端还没定下来（自动识别有超时未决），先在面板上选一次后端。' : '这个工作区还没有后端（既没有手动选过，也没有识别到锚文件）。先在面板上选一个后端。' }
    }
    // 2026-10-16 维护者拍板：工具壳不再要求「人亲手选过」。判定出口给出了哪个后端，壳就用哪个——
    // 声明文件与自动识别来的结论同样放行（只有声明文件、没有工作区配置文件的工作区不再被拦）。
    // 判定出口照旧如实标出来源与写权限（canWrite / reason），排查时看日志里的结论线即可。
    // 壳里剩下的拒绝只有三类：多命中或未决（上面那一支）、连后端都没有（下面那一支）、闸与后端自身失败。
    fire('deck.select', ms, true)
    noteGate('select', 'allow', '')
    return { ok: true, backendId: str(draft.backendId), source: str(draft.source), ref: draft.ref || null, pending: !!draft.pending, requests: num(sent.requests), points: num(sent.points) }
  }

  /** 由后端 id + 选出来的 ref 拿到一个可用的仓库身份（ref 缺字段时用后端 id 顶上，不造假名字）。 */
  function repoOf(pick: PickSuccess, s: unknown): DeckRepo {
    const ss = (s || {}) as ShellSession
    const ref = (pick.ref || {}) as DeckRepoRef
    return {
      backend: str(ref.backend) || str(pick.backendId),
      refId: str(ref.refId),
      name: str(ref.name),
      url: str(ref.url),
      effortId: ref.effortId,
      _cwd: ss.cwd,
    }
  }

  /** 真去调后端实现的那一步：先过 admitAiTool（硬顶），再过 gate.send（记账），异常一律收成三态。 */
  async function call(meta: CallMeta, work: (ctx: CallCtx) => unknown): Promise<DeckEnvelope> {
    const tool = meta.tool
    const s = meta.session
    const est = meta.estimate
    const admit = gate.admitAiTool({ points: est.points, requests: est.requests, childTickets: est.tickets }, { workspaceKey: s.workspaceKey, kind: 'tool-batch', bucket: 'graphql' })
    if (!admit.admitted) {
      fire(tool, 0, false, hash8(admit.reason))
      noteGate('admit', 'refuse', str(admit.reason))
      return refused(tool, est, s, admit)
    }
    let value: unknown = null
    let failure: unknown = null
    let sent: GateSendResult | null = null
    const t0 = now()
    // 沙箱那格按 unknown 收（九个工具里有的给 null、有的给一次探测的结论）：先验是不是对象，不是就当没有。
    const sbM = (meta && meta.sandbox && typeof meta.sandbox === 'object') ? (meta.sandbox as UnknownRecord) : {} as UnknownRecord; const sbPolicy = sbM.policy; const sbSessionId = (typeof sbM.sessionId === 'string' && sbM.sessionId) ? sbM.sessionId : str(s && s.sessionId)
    const ctx: CallCtx = {
      session: s,
      pick: meta.pick,
      repo: meta.repo,
      gate: gate,
      now: now,
      sleep: sleep,
      tracker: registry.get(meta.pick.backendId),
      opCtx: Object.assign({}, backendCtxNow(), { cwd: s.cwd, signal: undefined, caller: DECK_TOOL_KIND, sandboxPolicy: sbPolicy, sessionId: sbSessionId }),
      admit: admit,
    }
    try {
      sent = await gate.send({
        source: 'tool.call', kind: 'tool-batch', bucket: 'graphql', workspaceKey: s.workspaceKey, plan: [{ phase: meta.kind || 'op' }],
      }, async () => {
        const out = await work(ctx)
        const orec = (out && typeof out === 'object') ? out as UnknownRecord : null
        value = (orec && 'value' in orec) ? orec.value : out
        const claimed = (orec && orec.claimed) ? orec.claimed as UnknownRecord : { requests: est.requests, points: est.points }
        return { requests: num(claimed.requests), points: num(claimed.points) }
      })
    } catch (e) { failure = e }
    const ms = now() - t0
    if (failure) {
      const f = (failure || null) as UnknownRecord | null
      const eh = hash8(String((f && f.message) || failure))
      fire(tool, ms, false, eh)
      return unsupported(tool, REFUSAL_REASONS.BACKEND_THREW, '后端实现抛错了（我没有把它抛给 AI，按三态返回）：' + String((f && f.message) || failure).slice(0, 300), {
        workspace: { root: s.cwd, key: s.workspaceKey },
        backend: { id: meta.pick.backendId, source: meta.pick.source },
        errorHash: eh,
        cost: { estimated: est },
      })
    }
    if (!sent || sent.sent !== true) {
      fire(tool, ms, false, hash8('gate'))
      noteGate('op', 'defer', str(sent && sent.reason))
      return unsupported(tool, REFUSAL_REASONS.GATE_DEFER, '这一次被闸推迟了（' + str(sent && sent.detail) + '），我没有动手。', {
        workspace: { root: s.cwd, key: s.workspaceKey }, cost: { estimated: est },
      })
    }
    const vRec = (value && typeof value === 'object') ? value as UnknownRecord : null
    const failed = vRec ? (vRec.ok === false) : false
    fire(tool, ms, !failed, failed ? hash8(str(vRec && vRec.reason)) : '')
    noteGate('op', failed ? 'fail' : 'allow', failed ? str(vRec && vRec.reason) : '')
    // #1261/#1262：五个写工具（report、create、patch、plan、link）成功收口处把这一次记进工作路线，
    // 并在合并信封之前把在办表与摘要带进回执；四个读工具、失败与被闸推迟的调用都不记。
    if (!failed) {
      await noteWorkRoute(d, tool, s, str(meta.pick.backendId), value)
    }
    const out = envelope(tool, DECK_STATUS.OK, {
      workspace: { root: s.cwd, key: s.workspaceKey },
      backend: { id: meta.pick.backendId, source: meta.pick.source },
      repo: { backend: meta.repo.backend, refId: meta.repo.refId, name: meta.repo.name, url: meta.repo.url },
      cost: {
        estimated: { points: est.points, requests: est.requests, withinCallCap: est.withinCallCap, shards: est.shards, perShard: est.perShard, text: est.text },
        actual: { requests: num(sent.requests), points: num(sent.points), remaining: num(sent.remaining), tier: str(sent.tier) },
      },
    })
    return mergeOutcome(out, value, tool)
  }

  /** 把工具自己那份结果并进信封：状态、逐项、落点、写后失效缓存，都在这儿收口。 */
  function mergeOutcome(out: DeckEnvelope, value: unknown, tool: string): DeckEnvelope {
    const v = (value && typeof value === 'object') ? value as UnknownRecord : {}
    out.status = str(v.status) || DECK_STATUS.OK
    out.ok = out.status === DECK_STATUS.OK
    out.reason = str(v.reason)
    out.text = str(v.text)
    out.data = v.data !== undefined ? v.data : null
    out.items = Array.isArray(v.items) ? v.items : []
    out.notes = Array.isArray(v.notes) ? v.notes : []
    out.readBack = v.readBack !== undefined ? v.readBack : null
    const touched = Array.isArray(v.touched) ? v.touched.filter((k): k is string => typeof k === 'string' && !!k) : []
    out.touched = touched
    if (touched.length && typeof d.invalidate === 'function') {
      // workspace 一起交给接线方：宿主那侧的缓存是按工作区目录存的（getCache/setCache 都按 cwd 分桶），
      // 只给 repo 与票号它认不出该作废哪一份快照。#723（T19c）实测踩过：少了这一格，宿主里的
      // 「写后失效缓存」这一步静默什么也没做（门禁断言当场抓住）。
      try { d.invalidate({ repo: out.repo, backendId: out.backend ? out.backend.id : '', keys: touched, workspace: out.workspace }) } catch (e) { /* 缓存失效失败不影响已经写成的结果 */ }
    }
    void tool
    return out
  }

  return {
    limits: limits,
    estimateFor: estimateFor,
    pickBackend: pickBackend,
    repoOf: repoOf,
    call: call,
    unsupported: unsupported,
    envelope: envelope,
    hash8: hash8,
    fire: fire,
  }
}
