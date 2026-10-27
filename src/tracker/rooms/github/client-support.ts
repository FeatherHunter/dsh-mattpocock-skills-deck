/**
 * src/tracker/rooms/github/client-support.ts —— gh 客户端的外围零件：上下文取口、房内埋点、到点哨兵
 *
 * 人的话：gh 客户端（client.ts）里「真的执行一条 gh 命令」那条流程很长，文件早就超过文件粒度
 * 门禁的上限（tests/verify-file-granularity.ts：单文件 350 有效行）。下面这些零件与那条流程
 * 没有依赖，只是被它顺手用到：从上下文里取执行器、平台与工作目录；造「整档到点」与
 * 「排队上限到点」两个哨兵；以及 gh.exec / gh.timeout 两条日志的字段拼装。
 * 搬出来是为了让 client.ts 回到上限以里；逻辑一字未改，调用点照旧，只是多传一个 ctx。
 *
 * 几条不能丢的约定（搬动时原样保留）：
 *  - 到点这件事要能「掀桌子」：光中止信号不够（执行器不理中止时 promise 不落地），
 *    所以另备一个只用于宣告到点的哨兵，与真正在等的东西赛跑。
 *  - 队列两条路径共用同一个哨兵形状：排队上限先到时报「还在排队」（Q3，不等整档）。
 *  - gh.exec 高频：外层先判 isEnabled，关着时不组装字段；参数只记命令名，不记完整参数（避免令牌落盘）。
 */
import type { BackendPlatform, OpContext } from '../../contract/contexts.js'
// 默认超时住中央 YAML（config/timeouts.yaml 的 githubClientTimeoutMs 键），这里直接用生成值。
import { GITHUB_CLIENT_TIMEOUT_MS } from '../../../shared/time-config/src/values.js'
// 记日志那层壳在内核一份（#1182 第 3 件）：本房只管给出级别、事件名与字段。
import { guardEmit } from '../../kernel/log-emit.js'

/** 取进程执行器：优先 ctx.exec，兼容历史挂在 platform 上的写法，哪个都没有就回 null，调用方按环境失败处理。 */
export function getExec(ctx: OpContext): OpContext['exec'] | null {
  if (ctx && typeof ctx.exec === 'function') return ctx.exec.bind(ctx)
  // 兼容：BackendContext.platform + fs/timers 注入时，exec 可能在 ctx 上或 ctx.platform 上
  const plat = (ctx && (ctx as unknown as { platform?: unknown }).platform) as BackendPlatform | undefined;
  if (plat && typeof plat.exec === 'function') return (plat.exec.bind(plat) as OpContext['exec'])
  return null
}

/** 取平台实例：优先契约的 platform，兼容历史把方法直接挂在 ctx 顶层的写法，都没有就回 null。 */
export function getPlatform(ctx: OpContext): BackendPlatform | null {
  if (ctx && ctx.platform && typeof ctx.platform.resolveExecutable === 'function') return ctx.platform
  // 兼容历史：早期调用方把 resolveExecutable 直接挂在 ctx 顶层，按同一方法名认，行为与原来一致。
  const legacy = (ctx as unknown as Record<string, unknown>).resolveExecutable;
  if (ctx && typeof legacy === 'function') return ctx as unknown as BackendPlatform
  return null
}

/** 取工作目录：调用方显式给的优先，否则用上下文的，都没有就省略（执行器按自己的默认来）。 */
export function getCwd(ctx: OpContext, explicitCwd: string | undefined): string | undefined {
  if (explicitCwd) return explicitCwd
  if (ctx && typeof ctx.cwd === 'string' && ctx.cwd) return ctx.cwd
  return undefined
}

/** 到点哨兵：与真正在等的东西赛跑，落地的是它就说明房内表先到点了，真结果里不会有这一格。 */
export interface DeadlineHit {
  __deadlineHit: boolean;
}

/** 是不是到点哨兵：只有房内表到点才会产出这个形状，真结果里不会有这一格。 */
export function isDeadlineHit(v: unknown): v is DeadlineHit {
  return !!v && typeof v === 'object' && (v as DeadlineHit).__deadlineHit === true;
}

// 房内埋点（#494 O1）：gh.exec（#5 常驻）/ gh.timeout（#6 告警）/ gh.resolve.fail（#7 告警），字段按 #489 附录 1.4。
// gh.exec 高频：外层先判 isEnabled（信息），关闭时不组装字段；告警两项常驻直发；参数只记命令名，不记完整参数（避免令牌落盘）。
export function hash8(s: unknown): string { try { const t = String(s || ''); let h = 5381; for (let i = 0; i < t.length; i++) h = (((h << 5) + h + t.charCodeAt(i)) >>> 0); return ('0000000' + h.toString(16)).slice(-8) } catch { return '00000000' } }

export function roomLogEvent(ctx: OpContext, level: string, event: string, fields: Record<string, unknown>): void {
  guardEmit(ctx, (c) => {
    c.logEvent(level, event, fields)
  })
}

export function roomInfoEnabled(ctx: OpContext): boolean {
  try {
    if (ctx && typeof ctx.isEnabled === 'function') return ctx.isEnabled('info') === true
    return true
  } catch { return true }
}

// 还没进账本的 gh.exec 行用这一格（#1482 复审）：排队被取消、解析执行器失败、执行器没接上这几种
// 都发生在报闸之前，账上一条都没有；日志若照 GraphQL 估成「1 点 / estimate」，读日志的人会以为
// 已记过账，与账本对不上。只有过了报闸的失败与成功才写真实/估算点数。
export const NOT_ACCOUNTED = { points: 0, pointSource: '' }

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
// 默认是信息级别（高频、外层先判开关）；出站控制面没接上这类「一条命令都没发」的轨迹按告警级别记，
// 那时不需要问 isEnabled —— 与从前那一行告警口径一致。level 是本文件唯一的调用点差异，字段拼法完全同一份。
export function emitGhExec(ctx: OpContext, kind: string, exitCode: number, t0: number, cwd: string | undefined, waitedMs: number | undefined, via: string | undefined, cmd: string | undefined, pointNote: { points: number; pointSource: string }, level?: string): void {
  try {
    const lv = String(level || 'info')
    if (lv === 'info' && !roomInfoEnabled(ctx)) return
    roomLogEvent(ctx, lv, 'gh.exec', { argv0: 'gh', via: String(via || ''), opId: String((ctx && ctx.opId) || ''), cwdHash: hash8(cwd || ''), latencyMs: Date.now() - t0, waitedMs: (typeof waitedMs === 'number' && isFinite(waitedMs) && waitedMs > 0) ? Math.floor(waitedMs) : 0, kind: String(kind || 'unknown'), exitCode: typeof exitCode === 'number' ? exitCode : -1, cmd: String(cmd || ''), points: pointNote.points, pointSource: pointNote.pointSource })
  } catch {}
}

// #6 gh.timeout（告警，常驻）：只记命令名、超时毫秒与「在哪一层到点」。
// #1007 复核起多记 layer：room-tier = 房内自己掐表到点（client.ts 里的 selfTimeoutOutcome），
// host-clamp = 宿主那层的外包钳制（git-process.ts）。判读很直接 —— 房内修好之后
// gh.timeout 里再出现 host-clamp，就说明房内还有漏口；只出现 room-tier 则是在本层正常到点。
// #1101 排查起多记四格：via 是谁发的、cmd 是哪条 gh 命令、waitedMs 在名额队列里等了多久、
// phase 到点发生在哪一段（queue 还在排队没起进程 / inflight 进程已经起来）。
// 为什么非记不可：「面板所有功能超时」这类报告，只有这三格能把「守在门口排到超时」与
// 「命令自己跑到超时」分开；从前四条超时行长得一模一样，只能靠猜。
export function emitGhTimeout(ctx: OpContext, timeoutMs: number, layer?: string, via?: string, cmd?: string, waitedMs?: number, phase?: string): void {
  try {
    roomLogEvent(ctx, 'warn', 'gh.timeout', { argv0: 'gh', timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : GITHUB_CLIENT_TIMEOUT_MS, layer: String(layer || 'room-tier'), via: String(via || ''), cmd: String(cmd || ''), waitedMs: (typeof waitedMs === 'number' && isFinite(waitedMs) && waitedMs > 0) ? Math.floor(waitedMs) : 0, phase: String(phase || 'inflight') })
  } catch {}
}
