/**
 * src/tracker/rooms/github/client.ts — gh CLI 封装（契约对齐版）。
 *
 * 文件头原写 `backends/github/client.js`，是 #1019 目录归位前的旧路径；#1052 把读路径这一片
 * 的文件头逐个改成今天的真名，并给 gh.exec 补上 via 这一格（本文件也在这一片里）。
 * 同票续做时又给 gh.exec 补了一格 opId（宿主起这一趟操作的编号，原样取 `ctx.opId`），
 * 让房间这一层的行能与宿主那层的 host.call 靠同一个键对上；没给编号的调用方记空串，行为不变。
 *
 * 定版依据：#138 §1.3 + #129 平台三底座（BackendContext.platform 已解析实例注入）。
 * - gh 可执行经 `platform.resolveExecutable('gh')`（null → env fail，不抛）
 * - 命令执行经 `ctx.exec('gh', args, {cwd, timeout, signal})`（timeout 30s，signal abort）
 * - 超时/signal 与 timers 竞速由 ctx.exec 内部托管（此处只透传 opts）
 * - stdout 解析在调用方（issues/comments 等）；此处只做 exec+错误归一化，不产 parse kind（parse 由 JSON 层）
 * - 返回 OpResult，不 throw；错误经 ghVerdictOf 归一（档位表在 src/tracker/kernel/error-rules.ts）
 * - 调用点可以在 opts.via 里给一个短标签（「哪条操作、走到哪一支」），它随常驻 gh.exec 落盘；
 *   标签只在调用点上写死，本层不猜也不推断。没给标签的调用点照常不记，行为与从前一字不差。
 * - gh.exec 还会记一格 opId，取自 `ctx.opId`（宿主起这一趟操作时生成的编号）。这一格不由调用点给：
 *   调用点拿不到「这一趟操作」的编号，只有上下文里有；不给编号时记空串，与从前一字不差。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { BackendPlatform, ExecResult, OpContext } from '../../contract/contexts.js';
import type { TrackerError } from '../../contract/results.js';
import { fail, rawText } from '../../kernel/preflight.js'
// 记日志那层壳在内核一份（#1182 第 3 件）：本房只管给出级别、事件名与字段。
import { guardEmit } from '../../kernel/log-emit.js'
import { ghFailureMessage, ghVerdictOf } from './errors.js'
// #1446：每一次真实出站同时记进「这一次操作」的计数器（op-usage.ts 在操作表外层取走）。
import { noteGithubUsage } from './op-usage.js'
import { timeoutForGhArgs, isWriteGhArgs, ghCommandLabel, normalizeGhStringFields, ghOutboundEntryOf, graphqlCorrectionOf, ghPointNoteOf, READ_TIMEOUT_MS, WRITE_TIMEOUT_MS, PROBE_TIMEOUT_MS } from '../../kernel/outbound-tiers.js'
// 默认超时住中央 YAML（config/timeouts.yaml 的 githubClientTimeoutMs 键），这里只留别名。
import { GITHUB_CLIENT_TIMEOUT_MS } from '../../../shared/time-config/src/values.js'
// #1159：名额闸与搭车账本不再从宿主 import —— 它们是有状态的运行时能力，形状由契约层声明
// （`OutboundControl`），实现由宿主在接线处挂进 `ctx.outbound`。这与本房已有的 `ctx.gate`
// 是同一条路：闸由接线处注入，本房不 import 它。读不到就按环境失败大声报出来，不许静默直通。
import type { OutboundControl } from '../../contract/outbound.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GITHUB_PROBE_TIMEOUT_MS } from '../../../shared/time-config/src/values.js'

/**
 * 一个 gh 客户端自己数到的真实出站（#1446）：请求条数与点数。
 * 客户端是「谁真正发了命令」的那一层，用量只在这里数一次；上层拿到的永远是这一份的分身。
 * #1482 起两格的单位分清了：requests 是 REST 请求条数，GraphQL 不占这个数；
 * points 是 GraphQL 点数，尽量取回包里的真实值（起进程前只能按 1 点估，成功后补差）。
 */
export interface GhUsage {
  /** 真正发出去的 REST 请求条数（一次命令一条；GraphQL 命令不算）。 */
  requests: number
  /** 真正花掉的 GraphQL 点数（拿不到真实 cost 时按 1 点估）。 */
  points: number
}

/** gh 执行成功的数据：三件套，调用方读 stdout 解析，stderr 留查，code 为 0。 */
export interface GhExecData {
  stdout: string;
  stderr: string;
  code: number;
}

/** gh 失败的错误：在契约三段式上多带退出码与超时/取消标记，调用方据此区分“命令报错”与“没拿到退出码”。 */
export interface GhOpError extends TrackerError {
  code: number;
  timedOut?: boolean;
  cancelled?: boolean;
}

/** gh 命令的返回：成功带三件套，失败带本家错误，不断言、不抛。 */
export type GhExecResult = { ok: true; data: GhExecData } | { ok: false; error: GhOpError };

/** gh JSON 调用的返回：成功带解析结果（空输出给 null），失败带契约错误（无退出码可带）。 */
export type GhJsonResult = { ok: true; data: unknown } | { ok: false; error: TrackerError };

/** 起 gh 命令时的选项：工作目录、取消信号、超时毫秒、这一次调用的短标签，全可选，缺了按上下文与分档来。 */
export interface GhExecOpts {
  cwd?: string;
  signal?: AbortSignal;
  timeout?: number;
  /**
   * 这一次调用是谁发的、走到哪一支的短标签，例如 `list.gql`、`get.rest`、`counts.gql`。
   *
   * 为什么要有它：gh.exec 一行只记命令名与耗时，而一次读操作（比如拉全列表）会落好几行
   * 长得一模一样的 gh.exec，事后对着导出包分不出哪一行属于哪条操作、走的是主路还是降级路。
   * 有了标签，「谁发的、走的哪一支」在那一行上直接读得出来，不用再数行数去猜。
   *
   * 命名约定（改标签含义就当改事件，照 #489 附录 1.4 的规矩走）：
   *  - 小写字母开头、点分两段：前一段是操作名（list / get / counts / listPage / subIssues /
   *    preflight / permissions / repo / describe / issueAddress），后一段是这一支的名字；
   *  - 只写短枚举，不记票号、不记仓库原文、不记路径原文（那三样都不许落盘）。
   */
  via?: string;
}

/** 到点哨兵：与真正在等的东西赛跑，落地的是它就说明房内表先到点了，真结果里不会有这一格。 */
interface DeadlineHit {
  __deadlineHit: boolean;
}

/** 是不是到点哨兵：只有房内表到点才会产出这个形状，真结果里不会有这一格。 */
function isDeadlineHit(v: unknown): v is DeadlineHit {
  return !!v && typeof v === 'object' && (v as DeadlineHit).__deadlineHit === true;
}

/** 出站闸的最小口：只认记账这一个方法，闸由接线处注入，本房不 import 它。 */
interface OutboundGate {
  noteOutbound: (r: { requests: number; points: number }) => void;
  /** 事后补报差额（#1482）：GraphQL 拿到回包里的真实点数后，把比 1 点大的部分补进闸。闸没接上这一口时跳过。 */
  noteOutboundCorrection?: (r: { requests: number; points: number }) => void;
}

// 房内埋点（#494 O1）：gh.exec（#5 常驻）/ gh.timeout（#6 告警）/ gh.resolve.fail（#7 告警），字段按 #489 附录 1.4。
// gh.exec 高频：外层先判 isEnabled（信息），关闭时不组装字段；告警两项常驻直发；参数只记命令名，不记完整参数（避免令牌落盘）。
function hash8(s: unknown): string { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch { return '00000000' } }

function roomLogEvent(ctx: OpContext, level: string, event: string, fields: Record<string, unknown>): void {
  guardEmit(ctx, (c) => {
    c.logEvent(level, event, fields)
  })
}

function roomInfoEnabled(ctx: OpContext): boolean {
  try {
    if (ctx && typeof ctx.isEnabled === 'function') return ctx.isEnabled('info') === true
    return true
  } catch { return true }
}

/**
 * 这一层起 gh 命令时用的默认超时（毫秒）。#723（T19）把它交出去：`src/refresh/rooms/host/check-chain-evaluation.js` 里
 * 那条链要按「命令 + 工作目录 + 超时」认「是不是同一件事」，从前它在自己文件里又写了一遍
 * 30000 —— 两处各写一份，改一处就会静默对不上（实测踩过：一边带 30000、一边不带，白问两遍）。
 * 现在那个文件从宿主接线接这一个数（`src/host/registerPhones.js` 转发），全仓只有这一处字面量。
 * #1215 起这个数的真源是中央 YAML（config/timeouts.yaml 的 githubClientTimeoutMs 键），
 * 这里只留别名，调时间改 YAML。值由 tests/verify-time-config.ts 看守一致。
 */
export const TIMEOUT_MS = GITHUB_CLIENT_TIMEOUT_MS

/** 取进程执行器：优先 ctx.exec，兼容历史挂在 platform 上的写法，哪个都没有就回 null，调用方按环境失败处理。 */
function getExec(ctx: OpContext): OpContext['exec'] | null {
  if (ctx && typeof ctx.exec === 'function') return ctx.exec.bind(ctx)
  // 兼容：BackendContext.platform + fs/timers 注入时，exec 可能在 ctx 上或 ctx.platform 上
  const plat = (ctx && (ctx as unknown as { platform?: unknown }).platform) as BackendPlatform | undefined;
  if (plat && typeof plat.exec === 'function') return (plat.exec.bind(plat) as OpContext['exec'])
  return null
}

/**
 * #1159：装配那一刻宿主交来的出站控制面，全房共用一份。
 *
 * 为什么要有这一格：宿主给房间造「这一次操作的上下文」的地方有十几处（列表页、地图票、会话快照、
 * 评论线程……），逐处挂一遍既啰嗦又容易漏；而名额闸与搭车账本本身就是**进程级单例**，一份就够。
 * 所以宿主在装配点（注册表造本房时）把能力放进创建上下文，本房在这里记下来，房内每一笔出站共用。
 * 当次操作的上下文里若也带着一份（门禁夹具常这么给），以它为准 —— 这样单测可以逐场替换。
 */
let assembledOutbound: OutboundControl | null = null

/**
 * 装配点调用：把宿主给的能力记下来。传 null / 结构对不上就清空，
 * 免得上一场装配留下的旧对象被后来的房间误用。
 */
export function rememberOutbound(control: OutboundControl | null | undefined): void {
  assembledOutbound = shapeOk(control) ? (control as OutboundControl) : null
}

/** 结构对得上才算接上：三样本事缺一件都当没接上（宁可按环境失败，也不静默直通）。 */
function shapeOk(c: unknown): boolean {
  const o = c as OutboundControl | null | undefined
  return Boolean(o) && typeof o!.acquire === 'function' && typeof o!.isCancelled === 'function' && typeof o!.noteWrite === 'function'
}

/**
 * #1159：取这次调用能用的出站控制面（名额闸 / 取消判定 / 搭车账本）。
 *
 * 优先读当次上下文里的 `ctx.outbound`（装配点注入的那一份，或夹具自带的一份）；
 * 没有就退回装配时记下的那一份。两处都没有才回 null —— 调用点据此按环境失败返回，
 * 而不是静默直通（静默直通会让进程级的并发上限悄悄消失）。
 */
function getOutbound(ctx: OpContext): OutboundControl | null {
  const fromCtx = (ctx as unknown as { outbound?: OutboundControl } | null)?.outbound
  if (shapeOk(fromCtx)) return fromCtx as OutboundControl
  return assembledOutbound
}

/**
 * #723（T19）：这一笔真实出站报给闸（I1）。闸由接线处注入（`ctx.gate`，production 里是
 * `src/refresh/rooms/host/refresh-gate.js` 的产物），本房不 import 它（跨房间/同层引用都不许）。
 * 房内不报的后果是账对不上（漏网计数会露出来），所以没接上时这里什么都不做 —— 不允许
 * 「没接上就自己发出去还不说」。
 */
function reportOutbound(ctx: OpContext, args: string[], usage?: GhUsage): void {
  try {
    // #1482：GraphQL 走点数桶、不占 REST 请求条数。旧写法只看第一段是不是 graphql，
    // 而真实 argv 是 ['api','graphql',...]，于是每条 GraphQL 都被记成一条 REST 请求 ——
    // rest 桶被刷新探测刷穿之后，deck 工具被「一个桶已经见底」误停。口径收在共享层一处。
    const entry = ghOutboundEntryOf(args)
    // 留在客户端上的计数：这一次操作结束时随成功信封交给记账侧（#1446）。
    if (usage) { usage.requests += entry.requests; usage.points += entry.points }
    // 同时记进这一次操作的异步上下文：操作表外层用它拼信封，并发操作各算各的。
    noteGithubUsage(entry)
    const gate = (ctx && (ctx as unknown as Record<string, unknown>).gate) as OutboundGate | null | undefined;
    // 没接上闸时也照样留下客户端计数：用量是房间自己数的，不该因为闸缺席就丢。
    if (!gate || typeof gate.noteOutbound !== 'function') return
    gate.noteOutbound(entry)
  } catch { /* 报账失败不许影响已经起来的这一条命令 */ }
}

/**
 * GraphQL 成功后按回包里的真实点数补差（#1482）。
 *
 * 为什么要有这一支：I1 要求起进程之前就报闸，那时还没看到回包，只能按 1 点估；GraphQL 按 points 计费，
 * 实测一次列表单页 cost=4、一次 deck 工具调用 cost=5，差出来的点数不补，账上就永远偏低。
 * 补差只动点数、不动请求条数（GraphQL 不占 REST 请求），客户端计数与操作信封用的是同一份 usage。
 * 读不到 rateLimit.cost 时什么都不补，沿用 1 点估算。
 */
function reportOutboundCorrection(ctx: OpContext, args: string[], stdout: unknown, usage?: GhUsage): void {
  try {
    const entry = graphqlCorrectionOf(args, stdout)
    if (!entry) return
    if (usage) { usage.requests += entry.requests; usage.points += entry.points }
    noteGithubUsage(entry)
    const gate = (ctx && (ctx as unknown as Record<string, unknown>).gate) as OutboundGate | null | undefined;
    if (!gate || typeof gate.noteOutboundCorrection !== 'function') return
    gate.noteOutboundCorrection(entry)
  } catch { /* 补差失败不许影响已经成功的这一条命令 */ }
}

/** 取平台实例：优先契约的 platform，兼容历史把方法直接挂在 ctx 顶层的写法，都没有就回 null。 */
function getPlatform(ctx: OpContext): BackendPlatform | null {
  if (ctx && ctx.platform && typeof ctx.platform.resolveExecutable === 'function') return ctx.platform
  // 兼容历史：早期调用方把 resolveExecutable 直接挂在 ctx 顶层，按同一方法名认，行为与原来一致。
  const legacy = (ctx as unknown as Record<string, unknown>).resolveExecutable;
  if (ctx && typeof legacy === 'function') return ctx as unknown as BackendPlatform
  return null
}

/** 取工作目录：调用方显式给的优先，否则用上下文的，都没有就省略（执行器按自己的默认来）。 */
function getCwd(ctx: OpContext, explicitCwd: string | undefined): string | undefined {
  if (explicitCwd) return explicitCwd
  if (ctx && typeof ctx.cwd === 'string' && ctx.cwd) return ctx.cwd
  return undefined
}

/**
 * 造一个 gh 客户端：同一上下文内复用平台与执行器，执行与 JSON 解析两入口加一个旧签名兼容。
 *
 * 为什么收契约上下文：gh 路径走平台解析、进程走上下文执行、超时走分档表，三个底座全在上下文里，不直读全局。
 */
export function ghClient(ctx: OpContext): { execGh: (args: string[], opts?: GhExecOpts) => Promise<GhExecResult>; execJson: (args: string[], opts?: GhExecOpts) => Promise<GhJsonResult>; run: (args: string[], cwdOrId?: unknown) => Promise<GhExecResult>; usage: GhUsage } {
  const platform = getPlatform(ctx)
  const exec = getExec(ctx)
  // 这个客户端实例自己数到的出站：调用方可以在操作结束后原样读走，不需要另做前后相减。
  const usage: GhUsage = { requests: 0, points: 0 }

  // #7 gh.resolve.fail（告警，常驻）：只记是否配备用路径与错误散列，不记路径原文。
  function emitResolveFail(message: unknown): void {
    try {
      let hasGhPath = false
      try {
        const env = ctx && ctx.platform && ctx.platform.env ? ctx.platform.env : (platform && platform.env ? platform.env : null)
        hasGhPath = !!(env && typeof env.get === 'function' && env.get('DSH_GH_PATH'))
      } catch {}
      roomLogEvent(ctx, 'warn', 'gh.resolve.fail', { hasDSH_GH_PATH: hasGhPath, errorHash: hash8(message) })
    } catch {}
  }

  async function resolveGh(cwd: string | undefined): Promise<{ ok: true; ghPath: string } | { ok: false; error: TrackerError }> {
    if (!platform) {
      // platform 缺失 → env（按 contract §2，capability-by-fill 不可静默成功）
      emitResolveFail('gh not found: platform.resolveExecutable unavailable')
      return fail(ERROR_KIND.ENV, 'gh not found: platform.resolveExecutable unavailable', '')
    }
    try {
      const p = await platform.resolveExecutable('gh')
      if (p) return { ok: true, ghPath: p }
      // 回退：platform 未找到时，尝试直接通过 ctx.exec 探测 gh 是否在 PATH 可执行（Windows 上 where/直接 spawn）
      // 避免因为 subprocess.resolveExecutable 的 PATH 与 pwsh 的 PATH 不一致导致 414 这类外部建票永远拉不到
      if (exec) {
        try {
          reportOutbound(ctx, ['--version'], usage)
          const probe = await exec('gh', ['--version'], { cwd: cwd || getCwd(ctx, undefined), timeout: GITHUB_PROBE_TIMEOUT_MS })
          if (probe && probe.stdout && String(probe.stdout).includes('gh version')) {
            return { ok: true, ghPath: 'gh' }
          }
          if (probe && probe.code === 0) return { ok: true, ghPath: 'gh' }
        } catch {}
      }
      emitResolveFail('gh not found: platform.resolveExecutable returned null and gh --version probe failed')
      return fail(ERROR_KIND.ENV, 'gh not found: platform.resolveExecutable returned null and gh --version probe failed', '')
    } catch (e) {
      // 为什么转一下再读：catch 出来是 unknown，直接读 message 会报缺成员；转成最小形状后表达式与原来一字不差，运行时不变。
      const eb = e as { message?: unknown } | null;
      emitResolveFail(String((eb && eb.message) || e || 'gh not found'))
      return fail(ERROR_KIND.ENV, String((eb && eb.message) || e || 'gh not found'), e)
    }
  }

  // #5 gh.exec（信息，常驻）：高频路径，外层先判开关，关闭时不组装字段。
  // #1007 起多记一格 waitedMs：这一笔在名额队列里等了多久（没等就是 0）。
  // 有了这一格，「名额到底有没有挡过路、挡了多久」以后由日志回答，不用再靠猜着调数字。
  // #1052 起多记一格 opId：宿主起这一趟操作时生成的编号，原样取 ctx.opId。为什么要这一格——
  // 一趟读会落十几行长得一模一样的 gh.exec，只看这一层分不出哪几行属于同一趟操作；宿主那层的
  // host.call 也记同一个编号，两层因此能靠一个键对上，不用再按时间戳猜。没给编号就记空串，
  // 行为与从前一字不差（不给编号的调用方照样正常干活）。
  // #1007 复核起多记一格 cmd：这一条是哪一类 gh 命令（`issue:create`、`api:graphql` 这样的短标签）。
  // 从前只有 argv0='gh'，失败时日志分不出「查登录态坏了」还是「改票坏了」；命令整行又不能进日志
  // （带仓库名、票号与查询正文），所以只留子命令族与动词。形状由 outbound-tiers.ts 的 ghCommandLabel 定，
  // 取值是有限集合，便于按值聚合。行为不变：认不出时回第一段，不回空。
  // #1482 起多记两格：points 是这一笔记进账本的点数（GraphQL 按回包 rateLimit.cost 记真实点数，
  // 拿不到时按 1 点估；REST 记 0），pointSource 说这个点数是哪来的（server 回包给了真实 cost /
  // estimate 按 1 点估 / 空串 不是 GraphQL）。为什么要这两格：账本记错时，人得能从日志看出
  // 这一笔是真实点数还是估算 —— 从前只记条数不记点数，记歪了查不出来。
  function emitGhExec(kind: string, exitCode: number, t0: number, cwd: string | undefined, waitedMs?: number, via?: string, cmd?: string, pointNote?: { points: number; pointSource: string }): void {
    try {
      if (!roomInfoEnabled(ctx)) return
      roomLogEvent(ctx, 'info', 'gh.exec', { argv0: 'gh', via: String(via || ''), opId: String((ctx && ctx.opId) || ''), cwdHash: hash8(cwd || ''), latencyMs: Date.now() - t0, waitedMs: (typeof waitedMs === 'number' && isFinite(waitedMs) && waitedMs > 0) ? Math.floor(waitedMs) : 0, kind: String(kind || 'unknown'), exitCode: typeof exitCode === 'number' ? exitCode : -1, cmd: String(cmd || ''), points: pointNote ? pointNote.points : 0, pointSource: pointNote ? pointNote.pointSource : '' })
    } catch {}
  }

  // #6 gh.timeout（告警，常驻）：只记命令名、超时毫秒与「在哪一层到点」。
  // #1007 复核起多记 layer：room-tier = 房内自己掐表到点（本文件 :332 的 selfTimeoutOutcome），
  // host-clamp = 宿主那层的外包钳制（git-process.ts）。判读很直接 —— 房内修好之后
  // gh.timeout 里再出现 host-clamp，就说明房内还有漏口；只出现 room-tier 则是在本层正常到点。
  // #1101 排查起多记四格：via 是谁发的、cmd 是哪条 gh 命令、waitedMs 在名额队列里等了多久、
  // phase 到点发生在哪一段（queue 还在排队没起进程 / inflight 进程已经起来）。
  // 为什么非记不可：「面板所有功能超时」这类报告，只有这三格能把「守在门口排到超时」与
  // 「命令自己跑到超时」分开；从前四条超时行长得一模一样，只能靠猜。
  function emitGhTimeout(timeoutMs: number, layer?: string, via?: string, cmd?: string, waitedMs?: number, phase?: string): void {
    try {
      roomLogEvent(ctx, 'warn', 'gh.timeout', { argv0: 'gh', timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : TIMEOUT_MS, layer: String(layer || 'room-tier'), via: String(via || ''), cmd: String(cmd || ''), waitedMs: (typeof waitedMs === 'number' && isFinite(waitedMs) && waitedMs > 0) ? Math.floor(waitedMs) : 0, phase: String(phase || 'inflight') })
    } catch {}
  }

  function isTimeoutText(t: unknown): boolean { return /timeout/i.test(String(t || '')) }

  /**
   * 执行 gh 命令，返回 OpResult<{ stdout: string, stderr: string, code: number }>
   * 不做 JSON 解析；调用方自行 runJson / 解析 .out。opts.via 只影响 gh.exec 那一行的标签，不影响执行。
   * 失败时 error 的形状是 {kind, message, code}：code 是 gh 的退出码（拿不到时为 -1，例如命令根本没起来）。
   */
  async function execGh(args: string[], opts: GhExecOpts = {}): Promise<GhExecResult> {
    // #1375：gh 的 -F 会把纯数字 owner 发成 JSON 数字，GraphQL 的 String! 直接拒收；出站前归一成 -f。
    args = normalizeGhStringFields(args)
    const cwd = getCwd(ctx, opts.cwd)
    const t0 = Date.now()
    // 这一条是哪一类命令（#1007 复核）：算一次、所有分支共用，避免每处日志各拼一遍。
    const cmdLabel = ghCommandLabel(args)
    // #1159：出站控制面必须先接上。名额闸缺了还照发请求，等于进程级的并发上限悄悄消失 ——
    // 那种故障事后只看日志查不出来，所以这里按环境失败大声报出来，不发这一笔。
    const control = getOutbound(ctx)
    if (!control) {
      // #1101：这一条从前一句日志都不留，面板所有功能同时报错时，日志里只有「没拿到数据」，
      //   分不出是网络慢、命令失败，还是这道闸压根没接上。落一行同族告警轨迹（kind=env）：
      //   没起过任何进程，所以 latencyMs 只是走到这里的毫秒数、exitCode 记 -1、waitedMs 记 0。
      try {
        roomLogEvent(ctx, 'warn', 'gh.exec', { argv0: 'gh', via: String(opts.via || ''), opId: String((ctx && ctx.opId) || ''), cwdHash: hash8(cwd || ''), latencyMs: Date.now() - t0, waitedMs: 0, kind: ERROR_KIND.ENV, exitCode: -1, cmd: String(cmdLabel || ''), points: 0, pointSource: '' })
      } catch {}
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: '出站控制面没有接上：名额闸、取消判定与搭车账本都拿不到，这一笔不发出去。宿主接线要给两处：装配点造房时的上下文（生产里是 src/host/platformChannel.ts 的 backendCtxForRooms 与 src/refresh/rooms/host/refresh-runtime.js 的 backendObj），以及当次操作的上下文（ctx.outbound，门禁夹具走这一条）。', code: -1, raw: '' } }
    }
    // #969：默认超时按读写探活分档（调用方显式 timeout 优先）；#965 读写分桶拿名额。
    const bucket = isWriteGhArgs(args) ? 'write' : 'read'
    const signal = opts.signal || (ctx && ctx.signal) || undefined
    const timeout = opts.timeout != null ? opts.timeout : timeoutForGhArgs(args)
    // #1007：房内自己掐表，而且计时从「拿名额」那一刻就开始。
    // 为什么必须盖住排队段：名额被卡住的调用占满时，新调用会在队列里一直等到外层调用钳制（30 秒）才结束，
    // 既没有上限也没有名字（日志里只看到「30 秒被取消」）。计时器盖住排队段之后，这一笔最多赔本档超时
    // （读 12 秒 / 写 30 秒 / 探活 15 秒），而且如实归到「超时」，不再混进「被取消」。
    // 两种中止要分得开：房内到点 = 超时（算失败，归网络档）；调用方取消 = 取消（不算失败，照旧可重试）。
    const ctrl = (typeof AbortController === 'function') ? new AbortController() : null
    const laneSignal = ctrl ? ctrl.signal : signal
    let selfTimedOut = false
    // 为什么显式标这两个：赋 null 起手再在分支里赋值，编译器会判成隐式 any，标成定时器与回调形状才过得了严格模式。
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null
    let deadlineResolve: ((value: unknown) => void) | null = null
    // 这一笔在名额队列里等了多久（#1007：gh.exec 多记这一格，answer「名额有没有挡过路」）。
    let slotWaitedMs = 0
    // 到点这件事要能「掀桌子」：光是把信号中止还不够 —— 执行器要是不理中止、那个 promise 就一直不落地，
    // 所以另备一个只用来宣告到点的 promise，把它与每一步真正在等的东西赛跑（见 raceDeadline）。
    const deadlineHit: Promise<unknown> | null = ctrl ? new Promise<unknown>(function (res) { deadlineResolve = res }) : null
    if (ctrl && typeof setTimeout === 'function') {
      deadlineTimer = setTimeout(function () {
        selfTimedOut = true
        try { ctrl.abort() } catch (eT) {}
        try { if (deadlineResolve) deadlineResolve('deadline') } catch (eD) {}
      }, timeout)
    }
    /** 让「真正在等的那件事」与「到点」赛跑；到点先落地时回一个哨兵对象。 */
    function raceDeadline<T>(p: Promise<T> | T): Promise<T | DeadlineHit> {
      if (!deadlineHit) return Promise.resolve(p)
      return Promise.race([
        Promise.resolve(p),
        deadlineHit.then(function (): DeadlineHit { return { __deadlineHit: true } }),
      ])
    }
    // 为什么显式标：同上，赋 null 起手，回调形状标出来才过得了严格模式。
    let onCallerAbort: (() => void) | null = null
    if (signal && ctrl && typeof signal.addEventListener === 'function') {
      onCallerAbort = function (): void { try { ctrl.abort() } catch (eC) {} }
      try { signal.addEventListener('abort', onCallerAbort, { once: true }) } catch (eA) {}
    }
    function clearDeadline(): void {
      try { if (deadlineTimer !== null && typeof clearTimeout === 'function') clearTimeout(deadlineTimer) } catch (e1) {}
      try { if (onCallerAbort && signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onCallerAbort) } catch (e2) {}
    }
    /** 房内到点的统一回执：横幅按超时记，内容说清等了多久、是哪一档。 */
    function selfTimeoutOutcome(phase?: string): GhExecResult {
      emitGhExec('network', -1, t0, cwd, slotWaitedMs, opts.via, cmdLabel, ghPointNoteOf(args))
      emitGhTimeout(timeout, 'room-tier', opts.via, cmdLabel, slotWaitedMs, phase)
      // 房内到点时执行器还没有交回任何输出，这一处没有原文可交（空串是如实交代，不是漏填）。
      // 括号里那三档按当前档位值现算（毫秒换秒）、不手抄：手抄的数字会在有人调 YAML 之后悄悄变成错的。
      return { ok: false, error: { kind: ERROR_KIND.NETWORK, message: 'gh 在 ' + timeout + ' 毫秒内没有回话（房内分档超时：读 ' + Math.round(READ_TIMEOUT_MS / 1000) + ' 秒 / 写 ' + Math.round(WRITE_TIMEOUT_MS / 1000) + ' 秒 / 探活 ' + Math.round(PROBE_TIMEOUT_MS / 1000) + ' 秒），这一笔已经中止', code: -1, timedOut: true, raw: '' } }
    }
    // #965：先拿名额再起进程，满了就排队等（等不是失败）；排队中被调用方取消则按取消返回，不算失败。
    let release: (() => void) | null = null
    try {
      const acquired = await raceDeadline(control.acquire({ bucket: bucket, signal: laneSignal || undefined }))
      // #1101：先把「在门口等了多久」量出来，再判到点。从前这行赋值在到点判断之后，
      //   排队段被到点掀桌子的那一类（最该留证据的）记成 waitedMs=0，看起来像刚排上队就没耐心。
      slotWaitedMs = Date.now() - t0
      if (isDeadlineHit(acquired)) { clearDeadline(); return selfTimeoutOutcome('queue') }
      release = acquired
    } catch (eAcquire) {
      if (selfTimedOut) { slotWaitedMs = Date.now() - t0; clearDeadline(); return selfTimeoutOutcome('queue') }
      clearDeadline()
      emitGhExec('cancelled', -1, t0, cwd, slotWaitedMs, opts.via, cmdLabel, ghPointNoteOf(args))
      return { ok: false, error: { kind: ERROR_KIND.NETWORK, message: '已取消排队（出站准入等待中被取消），没有发出请求，可重试', code: -1, cancelled: true, raw: rawText(eAcquire) } }
    }
    try {
    const resolved = await raceDeadline(resolveGh(cwd))
    if (isDeadlineHit(resolved)) return selfTimeoutOutcome('inflight')
    if (!resolved.ok) {
      emitGhExec(resolved.error && resolved.error.kind ? resolved.error.kind : ERROR_KIND.ENV, -1, t0, cwd, undefined, opts.via, cmdLabel, ghPointNoteOf(args))
      // 补上 code: -1，让「失败时 error 里一定有 code」这条形状对所有失败成立（命令根本没跑起来）
      return { ok: false, error: Object.assign({ code: -1 }, resolved.error) }
    }

    if (!exec) {
      emitGhExec('env', -1, t0, cwd, undefined, opts.via, cmdLabel, ghPointNoteOf(args))
      // 这一处是「执行器根本没接上」，没有跑过任何外部命令，没有原文可交。
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'ctx.exec unavailable', code: -1, raw: '' } }
    }

    try {
      // #723（T19）：这一笔真实出站先报给闸（I1）。报在拿名额之后 —— 排队等待不算这一笔，
      // 真要起进程了才报，取消排队的不进账，账与真实出站一一对应。
      reportOutbound(ctx, args, usage)
      // #1007：起进程这一段同样与「到点」赛跑 —— 执行器要是不落地，房内的表到点就掀桌子。
      const raced = await raceDeadline(exec('gh', args, { cwd, timeout, signal: laneSignal }))
      if (isDeadlineHit(raced)) return selfTimeoutOutcome('inflight')
      const result = raced
      // DSH ctx.exec 契约：{stdout, stderr, code}
      // #620 整改（D2）：拿不到**整数**退出码时按失败处理（-1），不再当成 0。
      //   为什么：执行器原样回传底层进程的退出码，而被信号杀掉、或还没跑完就没有退出码时它是
      //   undefined/null —— 当成 0 会把「命令根本没成功」记成改色成功（仓库其实没变）。同一条路上
      //   的日志侧本来就按 -1 处理（见上面 emitGhExec 的兜底），这里与它对齐。
      const rawCode = result && result.code
      const code = Number.isInteger(rawCode) ? (rawCode as number) : -1
      const stdout = result && typeof result.stdout === 'string' ? result.stdout : (result && result.text ? result.text : '')
      const stderr = result && typeof result.stderr === 'string' ? result.stderr : ''
      if (code !== 0) {
        const note = code === -1 ? 'gh 这一次没拿到退出码（命令可能被中断，或者根本没起来）' : `gh exit ${code}`
        // 事实对象在执行处就整理好再交给判档：退出码是执行器原样交回的机器事实（#620：gh 的
        // 「需要登录 = 4」就靠它判），原文两路（stderr 与 stdout）都在手里、都要带上。
        // 这里不再自己写「看起来像哪一档」的分支 —— 档位只由 `error-rules.ts` 那张表判：
        // 哪条命中就用哪条；一条都没命中就走兜底，这时 message 会挂上「未能识别」的提示。
        // 事实分两半：原文照旧是 gh 的 stderr/stdout；「等到本地超时」这件事本身也要写成一条事实，
        // 否则「没拿到退出码又没有任何输出」会被判成「命令根本没起来」（环境档），
        // 而 #969 要的是网络档 —— 判据不是这里的分支，是交给表的那份事实。
        const elapsedMs = Date.now() - t0
        const looksTimeout = isTimeoutText(stderr) || isTimeoutText(stdout) || (code === -1 && elapsedMs >= timeout - 50)
        let factsText = rawText({ stderr: stderr, stdout: stdout })
        if (!factsText && looksTimeout) factsText = 'gh timeout: 房内等到本地超时（' + timeout + ' 毫秒）也没有收到任何回话'
        // 交给表的这份事实按「执行结果」的形状写：退出码在那个形状里叫 `code`（`factsFromError` 只认这个键，
        // 写 `exitCode` 会被丢掉，规则就看不着了）。
        const verdict = ghVerdictOf({ code: code, text: factsText }, ctx)
        emitGhExec(verdict.kind, code, t0, cwd, slotWaitedMs, opts.via, cmdLabel, ghPointNoteOf(args))
        if (looksTimeout) emitGhTimeout(timeout, 'room-tier', opts.via, cmdLabel, slotWaitedMs, 'inflight')
        // #620：退出码要一起交回调用方（调用方与界面都能看出「不是命令自己报的错」）。
        const own = String(stderr || stdout || note).slice(0, 800)
        return { ok: false, error: { kind: verdict.kind, message: ghFailureMessage(verdict, own), code, raw: rawText(result) } }
      }
      emitGhExec('ok', 0, t0, cwd, slotWaitedMs, opts.via, cmdLabel, ghPointNoteOf(args, stdout))
      // #966 收口：写成功记一笔搭车账，写过东西之后来的探测不搭旧车。
      try { if (bucket === 'write') control.noteWrite() } catch {}
      // #1482：GraphQL 的真实点数只有拿到回包才知道；在这里补差，账上点数才等于 GitHub 真正收的 cost。
      reportOutboundCorrection(ctx, args, stdout, usage)
      return { ok: true, data: { stdout, stderr, code } }
    } catch (e) {
      // exec 抛的错误（timeout/network 等）→ 归一化
      const elapsedMs = Date.now() - t0
      // #1007：先认房内自己那只表（它到点中止的按超时返回），再认调用方取消（那个不算失败）。
      if (selfTimedOut) return selfTimeoutOutcome('inflight')
      // #969：调用方取消（排队/在飞中被杀）按取消返回，不算失败；其余照旧归一。
      if (control.isCancelled(e) || (signal && signal.aborted === true)) {
        emitGhExec('cancelled', -1, t0, cwd, slotWaitedMs, opts.via, cmdLabel, ghPointNoteOf(args))
        return { ok: false, error: { kind: ERROR_KIND.NETWORK, message: '已取消（没有发出有效请求，可重试）', code: -1, cancelled: true, raw: rawText(e) } }
      }
      // 抛出来的错误同样只交给规则表判：ctx.exec 抛的 Error 里可能带着 `code`（例如 ENOTFOUND），
      // 那是错误码层认得出的事实，房里不再自己写第二份「像不像网络问题」的说法。
      const verdict = ghVerdictOf(e, ctx)
      emitGhExec(verdict.kind, -1, t0, cwd, slotWaitedMs, opts.via, cmdLabel, ghPointNoteOf(args))
      // 为什么转一下再读：catch 出来是 unknown，直接读 message 会报缺成员；转成最小形状后表达式与原来一字不差，运行时不变。
      const eb = e as { message?: unknown; stderr?: unknown } | null;
      const looksTimeout = isTimeoutText((eb && (eb.message || eb.stderr)) || e) || elapsedMs >= timeout - 50
      if (looksTimeout) emitGhTimeout(timeout, 'room-tier', opts.via, cmdLabel, slotWaitedMs, 'inflight')
      const own = String((eb && (eb.message || eb.stderr)) || e || 'gh exec failed').slice(0, 800)
      // code: -1 = 这次调用连退出码都没有（超时、spawn 失败之类），调用方据此知道「不是命令自己报的错」
      return { ok: false, error: { kind: verdict.kind, message: ghFailureMessage(verdict, own), code: -1, raw: rawText(e) } }
    } finally {
      try { if (release) release() } catch {}
    }
    } finally {
      // 拿了名额但在 resolveGh / exec 不可用分支提前返回时，在这里放回。
      try { if (release) release() } catch {}
      // #1007：房内那只表无论走哪条路都要收掉（成功、失败、提前返回都不能留着它）。
      clearDeadline()
    }
  }

  /**
   * 执行 gh 并解析 JSON（gh --json / gh api --jq . 场景）。
   * 若 --json 输出，需 GH 输出纯 JSON；若 gh api 场景，需 stdout 为 JSON
   */
  async function execJson(args: string[], opts: GhExecOpts = {}): Promise<GhJsonResult> {
    const r = await execGh(args, opts)
    if (!r.ok) return r
    const text = (r.data.stdout || '').trim()
    if (!text) return { ok: true, data: null }
    try {
      const parsed: unknown = JSON.parse(text)
      return { ok: true, data: parsed }
    } catch (e) {
      // 为什么断言再读：JSON 解析失败抛的一定是 SyntaxError（带 message），断言只为过编译，读法与原来一字不差。
      const eb = e as { message: unknown };
      // 这一份回包原文就是没能解析成 JSON 的那个东西，交出去让人自己看它到底是什么。
      return { ok: false, error: { kind: ERROR_KIND.PARSE, message: `invalid json from gh: ${String(eb.message).slice(0, 200)}`, raw: text } }
    }
  }

  // 兼容旧签名 run / runJson（供 labels.js 等旧调用方过渡；新代码优先 execGh/execJson）
  async function run(args: string[], cwdOrId?: unknown): Promise<GhExecResult> {
    // 旧 labels.js 调用：c.run(['issue','view',...], repoId) → repoId 此时作 cwd 兼容（若为 owner/repo 则忽略，用 ctx.cwd）
    // 为兼容，将 cwdOrId 仅在为路径（含 / 或 \ 或 :）时透传，否则忽略
    const cwd = typeof cwdOrId === 'string' && /[/\\]/.test(cwdOrId) ? cwdOrId : getCwd(ctx, undefined)
    return execGh(args, { cwd })
  }

  return {
    execGh,
    execJson,
    run, // 兼容旧调用
    usage, // #1446：这一次客户端生命周期内真正发出去的请求与点数
    // 便捷：gh api --paginate 模拟（简单封装，调用方传 --paginate 时由 execGh 直接交 gh 处理）
  }
}

export default ghClient
