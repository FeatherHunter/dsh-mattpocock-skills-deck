// src/deck/shell/call-shell.ts —— 九个 deck_* 工具共用的薄壳机制（#713 第六批；#1040 转 TypeScript）
//
// 为什么单独一层而不是写在宿主工具目录：九个工具若各写一份「调用前算账、三态返回、仓库身份拼装」，
// 同一套规则就会有九份。这个文件放在 shell/ 里，九个工具文件各自 import 它一条边（工具 → 壳是允许的方向），
// 规则仍然只有一份。当初撑着这件事的是「同一层里的文件不许互相引用」那条门禁（这些文件那时住在 src/shared/）；
// 2026-10 搬进 src/deck/ 之后那条门禁不再覆盖这棵树，但「一份规则、九个工具各引一条边」的形状照旧不变，
// 地图 #1037（规则只有一份）继续沿这个方向往下拆。
//
// #1443 起选后端与过闸那两条旧路已经整段删掉：选后端走 src/deck/tools/tracker-session.ts 的 openDeckSession
// （判定出口 → 读数保底 → 闸裁决 → Tracker 会话），调用走同一文件的 callDeckSession（管线里过裁决与记账）。
// 本文件只剩三样不碰管线的纯拼装：调用前算账（estimateFor）、三态信封（envelope / unsupported）、
// 仓库身份拼装（repoOf）。九个工具的 open / call 调用点都在 tracker-session.ts，不再经过这里。
//
// 本文件不 import 闸、后端注册表、额度常量、算账函数这类运行时依赖：它们都由接线方（或测试）从构造函数传进来。
// 这不是洁癖 —— 额度常量住在 src/refresh/kernel/host-budget.ts，本层不该反向去取，所以只能由调用方取好传进来
// （做法与宿主侧的 refresh-gate.ts / quota-ledger.ts、纯函数层的 admission-policy.ts / failure-backoff.ts 一致）。
// 本文件自己的运行时 import 已经没有了：形状全部 `import type` 自 ./call-shell-types.js，只借形状。
//
// 为什么要拆出那份形状文件：这个文件补完类型标注之后有效行数曾到 461，越过了「单文件 350 行」那条上限
// （tests/verify-file-granularity.ts）。拆开的唯一原因就是那条上限，不是为了分层 —— 与同目录 rules/ 那几份的口径一致。
//
// 这个壳现在守住两条硬要求：
//   1. 调用前算账只认接线方递进来的估算函数与额度常量，工具不自己定顶。
//   2. 工具永不抛异常：信封拼装本身不碰任何外部调用，抛不出去 —— 抛出去 AI 会退回去用它熟悉的 gh，
//      两条写路径同时开火（这条原来写在旧路的文件头，路搬走了，规矩留下）。
//
// 三态与「拒绝」的关系（这里说清，免得以后有人以为少了第四种状态）：
//   ok          这一次做成了（部分成功用 partial）；
//   partial     一批里有的成、有的没成，逐项列出谁成了谁没成；
//   unsupported 这件事没做成，并且如实说了为什么 —— 原因写在 reason 字段里，取值见下面 REFUSAL_REASONS。
//
// 类型口径（#1040 转 TypeScript 时定下）：本文件是「取数与注入」的交界，外面递进来的东西
// （估算函数、额度常量）形状都不由本文件决定，所以入参按 unknown 收、用之前逐格验；
// 本文件发出去的东西给出明确契约 —— 三态信封 DeckEnvelope，九个工具与测试都按这张形状读。
// 这些形状（含 DeckShellDeps 与 DeckShell 自己）都住在 ./call-shell-types.ts，那边同时写明「改字段名要连带看哪些门禁」。
//
import type {
  CostEstimate, DeckEnvelope, DeckLimits, DeckRepo, DeckRepoRef,
  DeckShell, DeckShellDeps, HourUsageView, PickSuccess,
  ShellSession, UnknownRecord,
} from './call-shell-types.js'

/** 这批工具的身份（写日志时进 host.call 的 kind 字段；不是新事件，沿用它原有的字段清单）。 */
export const DECK_TOOL_KIND = 'deck-tool'
/** 三态返回的取值。edges.ts 的 statusOfItems 返回的就是这三个字符串（验收脚本有一条断言钉住这件事）。 */
export const DECK_STATUS = Object.freeze({ OK: 'ok', PARTIAL: 'partial', UNSUPPORTED: 'unsupported' })
/**
 * 「这件事没做成」的原因取值。文案给人的那句话说在返回的 text 里，这里只放机器可读的那一格。
 * ai-tool-refused 有两种用法：额度用尽（OVER_CAP 这个名字的来源），以及「工具面上的规矩不允许」——
 * 例如 deck_issue_patch 拒绝重开（#1298）。两种都是「AI 这一侧不许做这件事」，所以不再分一个新码。
 */
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
function num(v: unknown): number { return (typeof v === 'number' && isFinite(v)) ? v : 0 }
function str(v: unknown): string { return (typeof v === 'string') ? v : '' }
/** 额度常量从 host-budget.js 取好传进来时的对照表：字段名与 src/refresh/kernel/host-budget.ts 的导出同名。 */
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
 *   budget     必填，额度常量（真源 src/refresh/kernel/host-budget.ts），只为拼出 limits 用
 *   estimate   必填，算账函数（真源 src/refresh/kernel/tool-call-budget.ts）
 *   costInputFrom 可选，参数翻译（缺席时只按工具名算）
 *   hourUsage  可选，本小时已花（缺席按 0 算，只影响建议，不影响硬顶裁决）
 */
export function createDeckShell(deps?: DeckShellDeps): DeckShell {
  const d = (deps || {}) as DeckShellDeps
  // 两个必填项按「装配方已经给了」来用：缺了就在用到的那一刻报错，与转 TypeScript 之前的行为一致。
  // 闸与注册表不再经过这里（旧路 #1443 已删，见文件头），这里只读算账要的那几格。
  const budget = (d.budget || {}) as UnknownRecord
  const estimate = d.estimate as (input: unknown, withHour: HourUsageView) => unknown
  const limits = limitsFromBudget(budget)

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
  return {
    limits: limits,
    estimateFor: estimateFor,
    repoOf: repoOf,
    unsupported: unsupported,
    envelope: envelope,
  }
}
