/**
 * shared/gh-timeout-tiers.js —— 去 GitHub 的分档超时（#969 暂定值）。
 *
 * 为什么分三档：读操作等得久会拖住界面，写操作杀得早会让用户不敢重试，
 * 查登录态与版本号的探活本该最快回来。从前全仓只有一档 30000，谁都要等满才放弃。
 * 慢网下超时一律归网络档（未知、稍后再试），不能说成没登录让用户去重登。
 *
 * 暂定值（终值等 #967 测出耗时分布后回填，由 #966 收口执行）：
 *   读 12000 毫秒、写 30000 毫秒、探活 15000 毫秒。
 * 探活从 3000 提到 15000（#1160）：gh auth status 在插件里是冷启动，
 * keyring 读取加 TLS 握手在代理环境下经常超 3 秒，从前那条 3 秒的上限会把登录态误判成网络异常。
 * 上限参考（4 下限、64 上限）管的是同时在飞几个，不管等多久，这里不混用。
 *
 * 这个文件是纯函数：不读盘、不联网、不起定时器。调用方显式传了超时就按调用方的来。
 *
 * #1482 起：GraphQL 的判档、真实点数与报账口径也收在这里 —— 判档与报账必须同口径，
 * 分开放会让出口各自猜一遍，账本也就各自记歪。
 */

// 四档时长住中央 YAML（config/timeouts.yaml 的 outbound* 四键）：这里只留同名别名，
// 调时间改 YAML，不改这里。值由 tests/verify-time-config.ts 看守一致。
import { OUTBOUND_READ_TIMEOUT_MS, OUTBOUND_WRITE_TIMEOUT_MS, OUTBOUND_PROBE_TIMEOUT_MS, OUTBOUND_DEFAULT_TIMEOUT_MS, OUTBOUND_TRANSPORT_COOLDOWN_MS, GH_QUEUE_WAIT_TIMEOUT_MS } from '../../shared/time-config/src/values.js'

export const READ_TIMEOUT_MS = OUTBOUND_READ_TIMEOUT_MS
export const WRITE_TIMEOUT_MS = OUTBOUND_WRITE_TIMEOUT_MS
export const PROBE_TIMEOUT_MS = OUTBOUND_PROBE_TIMEOUT_MS

/** 拿不到档位时的旧默认：沿用历史 30000，不静默变快。 */
export const DEFAULT_TIMEOUT_MS = OUTBOUND_DEFAULT_TIMEOUT_MS
/** 通路失败之后的冷却窗口（#1007）：一次 transport 级失败之后，同一只桶这段时间内不再起进程。 */
export const TRANSPORT_COOLDOWN_MS = OUTBOUND_TRANSPORT_COOLDOWN_MS

/**
 * 参数归一成字符串数组：非数组按空数组处理，空位按空串处理。
 * 类型说明：host 域文件，只做类型标注；收未知输入，运行时仍是原判断。
 */
function partsOf(args: unknown): string[] {
  return (Array.isArray(args) ? args : []).map(function (a: unknown) { return String(a == null ? '' : a) })
}

/** 写操作动词：命中即走写档（等得最久，且调用方不许自动重试，见 #969）。 */
const WRITE_VERBS = new Set(['create', 'edit', 'close', 'reopen', 'comment', 'delete', 'lock', 'unlock', 'pin', 'unpin'])

function isApiWrite(parts: string[]): boolean {
  // 经接口写票一定带写方法：-X POST 之类或 --method 覆盖时才是写，默认读。
  if (parts[0] !== 'api') return false
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p === '-X' || p === '--method') {
      const m = String(parts[i + 1] || '').toUpperCase()
      if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') return true
    }
    if (/^--method=(post|put|patch|delete)$/i.test(p)) return true
  }
  return false
}

/**
 * 这条去 GitHub 的调用是不是写操作（写档 + 不自动重试，调用方人工核对）。
 * 类型说明：调用方传的是进程参数数组，收未知以兼容旧调用，运行时仍按数组判断。
 */
export function isWriteGhArgs(args: unknown): boolean {
  const parts = partsOf(args)
  if (parts.length < 2) return false
  if (parts[0] === 'issue' || parts[0] === 'pr') return WRITE_VERBS.has(parts[1])
  if (parts[0] === 'api') return isApiWrite(parts)
  if (parts[0] === 'label' || parts[0] === 'release') return true
  return false
}

/** 探活动词：查登录态与版本号，走探活档。类型说明：同写操作判断，收未知参数数组。 */
export function isProbeGhArgs(args: unknown): boolean {
  const parts = partsOf(args)
  if (parts.length === 0) return false
  if (parts[0] === '--version') return true
  if (parts[0] === 'auth' && parts[1] === 'status') return true
  if (parts[0] === 'api' && String(parts[1] || '').indexOf('user') === 0 && parts.length <= 3) return true
  return false
}

/** 这条调用走哪一档：写最久，其余读，探活走自己的档（#1160 起探活 15 秒，比读档久）。类型说明：返回值收窄为三档字面量。 */
export function tierForGhArgs(args: unknown): 'write' | 'probe' | 'read' {
  if (isWriteGhArgs(args)) return 'write'
  if (isProbeGhArgs(args)) return 'probe'
  return 'read'
}

/**
 * 日志里那一格「哪一类命令」的短标签（#1007 复核补）。
 *
 * 为什么要有它：从前 gh.exec / gh.timeout 只记 `argv0: 'gh'`，失败时日志分不出是查登录态、
 * 列票还是改票 —— 而票面要的正是「失败带命令名」。命令整行不能进日志（带仓库名、票号、
 * 查询正文），所以只留两段：子命令族与动词（`issue:create`、`auth:status`），
 * api 只留接口族的第一段（`api:graphql`、`api:repos`），参数部分（owner/repo、编号、查询串）一律丢掉。
 *
 * 取值是有限集合，便于按值聚合；认不出的子命令只回第一段（例如 `--version`），不会回空。
 * 类型说明：收未知参数数组（兼容旧调用），运行时仍按数组判断。
 */
export function ghCommandLabel(args: unknown): string {
  const parts = partsOf(args)
  if (parts.length === 0) return ''
  const head = parts[0]
  if (head === 'api') {
    // 接口族第一段就够定位：graphql / rate_limit / user / repos …… 后面的 owner、仓库名与编号不进日志。
    const family = String(parts[1] || '').split('/')[0]
    return family ? 'api:' + family : 'api'
  }
  // 只有第二段是纯小写动词时才拼进去（`issue view` 拼成 issue:view）；第二段是票号或路径时只留族名。
  const second = String(parts[1] || '')
  if (parts.length >= 2 && /^[a-z][a-z-]*$/.test(second)) return head + ':' + second
  return head
}

/** 这一档等多久（毫秒）。类型说明：档位收字符串，未知档按读档处理，与原来一致。 */
export function timeoutForTier(tier: string): number {
  if (tier === 'write') return WRITE_TIMEOUT_MS
  if (tier === 'probe') return PROBE_TIMEOUT_MS
  return READ_TIMEOUT_MS
}

/** 这条调用等多久：调用方显式传的优先，否则按档位来。类型说明：显式超时收未知，数字且为正才采用。 */
export function timeoutForGhArgs(args: unknown, explicitTimeout?: unknown): number {
  if (typeof explicitTimeout === 'number' && isFinite(explicitTimeout) && explicitTimeout > 0) return explicitTimeout
  return timeoutForTier(tierForGhArgs(args))
}

/**
 * 排队拿名额这一段最多等多久：本档预算与中央排队上限取更小的那个（#1560 乙方案）。
 *
 * 为什么取更小的那个：名额满时不该把整档预算（读 12 秒 / 写 30 秒）全花在排队上；
 * 但本档预算比排队上限还短时（例如调用方显式传了几百毫秒），排队自然只等到本档超时，
 * 不出现「排队比整档还久」。拿到名额之后起进程的等待仍按本档超时算，总墙钟仍是本档，
 * 预检与外层预算都不用加账（甲方案要重算 54 秒内层，乙不碰）。
 *
 * 为什么住在这里：房间侧不许 import 宿主模块，而这条算式要同时供房间客户端、平台通道与宿主两路使用。
 * #1570 起「排队最多等多久」由出站准入闸自己执行（闸收 waitMs、到点抛排队超时并归还晚到名额），
 * 各出口只在这里算出预算再递给闸 —— 计时与归还都只有闸那一份，出口不许再自己起表赛跑。
 * 值本身仍只在中央 YAML 有一处定义（config/timeouts.yaml 的 ghQueueWaitTimeoutMs 键），
 * 这里只引用中央常量，不抄数字。
 */
export function queueTimeoutForTier(tierTimeoutMs: number): number {
  return Math.min(tierTimeoutMs, GH_QUEUE_WAIT_TIMEOUT_MS)
}

/**
 * 把 GraphQL 调用里的 owner 与 name 从 `-F` 改成 `-f`。
 *
 * 为什么要改：`gh api -F` 会按值推断类型，纯数字的 GitHub 账号（例如 776317107）会被发成
 * JSON 数字；而 GraphQL 查询把 `$owner` 与 `$name` 声明为 `String!`，gh 于是回
 * `Variable $owner of type String! was provided invalid value`（#1375）。`-f` 是原始字符串，
 * 不做类型推断。只改这两个字段，`number`、`first` 等整型字段继续用 `-F`。
 *
 * 没有要改的地方时原样返回同一个数组，调用方可以放心直接赋值。
 */
export function normalizeGhStringFields(args: string[]): string[] {
  if (!Array.isArray(args) || args[0] !== 'api' || String(args[1] || '').indexOf('graphql') !== 0) return args
  let changed = false
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if ((a === '-F' || a === '--field') && typeof args[i + 1] === 'string' && /^(owner|name)=/.test(args[i + 1])) {
      out.push('-f')
      changed = true
    } else {
      out.push(a)
    }
  }
  return changed ? out : args
}

/**
 * 这条 gh 命令是不是 GraphQL（#1482）。
 *
 * 为什么要单开一处判：`gh api graphql` 的真实 argv 是 ['api','graphql',...]，第一段是 api；
 * 从前几个出口都拿第一段去 indexOf('graphql')，永远判不中，GraphQL 于是被当成 REST 记了一条请求
 * （#1482 的账本虚增就是这么来的）。
 */
export function isGraphqlGhArgs(args: unknown): boolean {
  const parts = partsOf(args)
  if (parts.length === 0) return false
  return parts[0] === 'api' && String(parts[1] || '').indexOf('graphql') === 0
}

/**
 * 从 gh api graphql 的回包里读这一趟的真实点数（rateLimit.cost）（#1482）。
 *
 * 为什么读它：GraphQL 按点数计费，一次查询不一定是 1 点（#1482 实测单页列表 cost=4、一次 deck 工具调用 cost=5）。
 * 读不到（不是 JSON、没带 rateLimit、cost 不是非负整数）就回 0，调用方沿用估算值，不把猜的当真值记。
 */
export function graphqlCostOf(stdout: unknown): number {
  try {
    const parsed = JSON.parse(String(stdout == null ? '' : stdout)) as { rateLimit?: { cost?: unknown } } | null
    const cost = parsed && parsed.rateLimit ? parsed.rateLimit.cost : undefined
    return (typeof cost === 'number' && isFinite(cost) && cost >= 0) ? Math.floor(cost) : 0
  } catch { return 0 }
}

/** 闸身上报账用到的两个口（#1482）：起进程前报一笔、成功之后补 GraphQL 点数差额。 */
export interface OutboundGateLike {
  noteOutbound(fields: { requests: number; points: number }): void
  noteOutboundCorrection?(fields: { requests: number; points: number }): void
}

/** GraphQL 一笔在还不知道真实 cost 之前的估算点数（#1482）：先按 1 点报闸，成功后再补差额。 */
const GRAPHQL_ESTIMATE_POINTS = 1

/**
 * 拿到 gh 的子命令参数：各条出站路径传进来的 argv 形状不一样 ——
 * 宿主进程出口拿到的是整条 ['gh','api','graphql',...]，gh 客户端与旧装配的 runGh
 * 传进来的已经是剥好程序名的 ['api','graphql',...]。
 *
 * 所以只在第一段确实像 gh 可执行文件（gh / gh.exe，带目录也算）时才剥；其它形状原样返回。
 * 为什么不能无条件剥第一段（#1482 复审）：已经剥过的参数再剥一次会把 api 当成程序名吃掉，
 * 于是 api graphql 判不成 GraphQL，账本又把 GraphQL 记成一条 REST 请求 ——
 * 正是这张票要修的症状，只是换了一条路复发。
 */
export function ghArgsOf(argv: unknown): string[] {
  const parts = partsOf(argv)
  if (parts.length === 0) return []
  // 真机上第一段可能是 'C:\Program Files\GitHub CLI\gh.exe' 这样的完整路径，只取文件名再比。
  const head = String(parts[0] || '').replace(/^.*[\\/]/, '')
  return /^gh(\.exe)?$/i.test(head) ? parts.slice(1) : parts
}

/**
 * 一条 gh 命令起进程之前该记的条数与点数：GraphQL 记 0 条 REST 请求、先按 1 点估；
 * 其它命令记 1 条请求、0 点。四个出口都从这里拿，别各写一遍（ADR 20261021 §2.1）。
 */
export function ghOutboundEntryOf(args: unknown): { requests: number; points: number } {
  const isGraphql = isGraphqlGhArgs(args)
  return { requests: isGraphql ? 0 : 1, points: isGraphql ? GRAPHQL_ESTIMATE_POINTS : 0 }
}

/**
 * GraphQL 成功之后要补的点数差额（#1482）：回包 rateLimit.cost 比先前估的 1 点多的那部分。
 * 不是 GraphQL、读不到 cost、或 cost 不超过 1 就回 null（不补，也不替账面改数）。
 */
export function graphqlCorrectionOf(args: unknown, stdout: unknown): { requests: number; points: number } | null {
  if (!isGraphqlGhArgs(args)) return null
  const cost = graphqlCostOf(stdout)
  return cost > GRAPHQL_ESTIMATE_POINTS ? { requests: 0, points: cost - GRAPHQL_ESTIMATE_POINTS } : null
}

/**
 * 日志里那一格「这一笔记进账多少点、点数是哪来的」（#1482）。
 *
 * 为什么要有它：账本记错时，人要能从日志看出这一笔是回包给了真实 cost，还是按 1 点估的；
 * 从前只记条数不记点数，虚增了也查不出。points：非 GraphQL 记 0，GraphQL 拿到 cost 就记真实点数、
 * 拿不到按 1 点估。pointSource：server（回包给了 cost）/ estimate（按 1 点估）/ 空串（不是 GraphQL）。
 */
export function ghPointNoteOf(args: unknown, stdout?: unknown): { points: number; pointSource: string } {
  if (!isGraphqlGhArgs(args)) return { points: 0, pointSource: '' }
  const cost = graphqlCostOf(stdout)
  return cost > 0 ? { points: cost, pointSource: 'server' } : { points: GRAPHQL_ESTIMATE_POINTS, pointSource: 'estimate' }
}

/** 起进程前先报一笔（I1）：口径见 ghOutboundEntryOf。 */
export function reportGhOutbound(gate: OutboundGateLike | null, args: string[] | null | undefined): OutboundGateLike | null {
  if (!gate) return null
  gate.noteOutbound(ghOutboundEntryOf(args))
  return gate
}

/** 成功之后补点数差额：口径见 graphqlCorrectionOf；失败或拿不到 cost 时不补。 */
export function noteGhGraphqlCorrection(gate: OutboundGateLike | null, args: string[] | null | undefined, exitCode: unknown, stdout: unknown): void {
  if (!gate || exitCode !== 0) return
  try {
    const corr = graphqlCorrectionOf(args, stdout)
    if (corr && typeof gate.noteOutboundCorrection === 'function') gate.noteOutboundCorrection(corr)
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// 出站通路失败的冷却（#1007）：一次 transport 级失败之后，同一只桶在冷却窗口里不再起进程。
//
// 为什么把判定放在这里：房间不许 import 宿主模块（契约见 src/tracker/contract/outbound.ts），
// 但房间要认出「这次拿名额被冷却窗口挡回来了」、要分清失败是超时、被杀还是进程没起来。
// 这三件事都是纯判定，放 kernel 两边都能用；冷却状态本身仍只放在准入闸一处，不另起第二道闸。
// ---------------------------------------------------------------------------

/** 一次 transport 级失败是哪种：命令到点没回话、被中途杀掉、进程根本没起来。 */
export type OutboundTransportReason = 'timeout' | 'killed' | 'spawn-failed'

/**
 * 冷却错误码：准入闸在冷却窗口里拒绝拿名额时，错误对象带这个 code。
 * 调用方据此返回「到 GitHub 的通路现在不通，先别重试」，与「排队时被取消」「普通失败」分开。
 */
export const OUTBOUND_COOLDOWN_CODE = 'admission-cooldown'

/** 冷却错误上能读出的信息：哪只桶、还剩多久、上一次为什么失败、连续失败了几次。 */
export interface OutboundCooldownInfo {
  bucket: string
  remainingMs: number
  reason: string
  failStreak: number
}

/**
 * 从错误对象上读冷却信息；不是冷却错误就回 null。
 * 类型说明：错误值形状不可控，只按键读取，不改变运行时对象。
 */
export function outboundCooldownOf(err: unknown): OutboundCooldownInfo | null {
  if (!err || (err as { code?: unknown }).code !== OUTBOUND_COOLDOWN_CODE) return null
  const e = err as { bucket?: unknown; remainingMs?: unknown; reason?: unknown; failStreak?: unknown }
  const bucket = String(e.bucket == null ? '' : e.bucket)
  const reason = String(e.reason == null ? '' : e.reason)
  const remainingMs = typeof e.remainingMs === 'number' && isFinite(e.remainingMs) ? e.remainingMs : 0
  const failStreak = typeof e.failStreak === 'number' && isFinite(e.failStreak) ? e.failStreak : 0
  return { bucket, remainingMs: Math.max(0, Math.floor(remainingMs)), reason, failStreak: Math.max(0, Math.floor(failStreak)) }
}

/**
 * 排队超时错误码（#1570）：准入闸在队列里等过了调用方给的时间预算时，错误对象带这个 code。
 * 调用方据此返回「排队太久、一次都没跑起来」这类**可重试**的回话，与「排队时被取消」
 * 「通路冷却」和普通失败分开 —— 它说明名额竞争激烈，不是命令本身错了。
 */
export const OUTBOUND_QUEUE_TIMEOUT_CODE = 'admission-queue-timeout'

/** 排队超时错误上能读出的信息：哪只桶、等了多久、当初给的时间预算是多少。 */
export interface OutboundQueueTimeoutInfo {
  bucket: string
  waitedMs: number
  limitMs: number
}

/**
 * 从错误对象上读排队超时信息；不是排队超时错误就回 null。
 * 类型说明：错误值形状不可控，只按键读取，不改变运行时对象。
 */
export function outboundQueueTimeoutOf(err: unknown): OutboundQueueTimeoutInfo | null {
  if (!err || (err as { code?: unknown }).code !== OUTBOUND_QUEUE_TIMEOUT_CODE) return null
  const e = err as { bucket?: unknown; waitedMs?: unknown; limitMs?: unknown }
  const bucket = String(e.bucket == null ? '' : e.bucket)
  const waitedMs = typeof e.waitedMs === 'number' && isFinite(e.waitedMs) ? e.waitedMs : 0
  const limitMs = typeof e.limitMs === 'number' && isFinite(e.limitMs) ? e.limitMs : 0
  return { bucket: bucket, waitedMs: Math.max(0, Math.floor(waitedMs)), limitMs: Math.max(0, Math.floor(limitMs)) }
}

/**
 * 从失败文本里认 transport 级失败的类别；认不出回空串（调用方不设冷却）。
 * 顺序有意义：超时优先认；「被杀」其次；「起不来」最后 —— 三类都可能出现在同一条错误里，
 * 先命中的那一类才是这次真正让命令停下的原因。
 */
export function transportFailureReasonOf(text: unknown): OutboundTransportReason | '' {
  const t = String(text == null ? '' : text).toLowerCase()
  if (!t) return ''
  if (/timeout|timed out|超时/.test(t)) return 'timeout'
  if (/killed|terminated|signal|sigterm|sigkill|被杀|中止/.test(t)) return 'killed'
  if (/spawn|enoent|not found|no such file|eacces|起不来|没起来/.test(t)) return 'spawn-failed'
  return ''
}

/**
 * 把 transport 失败类别翻译成回话里的中文说法；认不出回空串（调用方不硬凑一个词）。
 * 回话里为什么要说类别：#1007 的期望是「人一眼看出这次是超时、被杀还是进程根本没起来」，
 * 只说「通路失败」会被读成同一个故障反复出现，判不出该修网络、修代理还是修命令本身。
 */
export function transportFailureReasonLabel(reason: unknown): string {
  const r = String(reason == null ? '' : reason)
  if (r === 'timeout') return '超时'
  if (r === 'killed') return '被杀'
  if (r === 'spawn-failed') return '进程没起来'
  return ''
}

/**
 * 读写两档各自该给的后续动作（#1007 期望第五条）：读没拿到数据可以直接重试；
 * 写没法确认到底成没成，先核对票面现状再决定怎么续做，不直接重放。
 * 为什么写死在这里：房内到点、房内通路冷却、宿主 runGh 排队与平台通道，四个出口说的是同一件事，
 * 同一张票从不同入口进来必须得到同一条建议；各处各拼一句迟早会有一处写成相反的意思。
 */
export function outboundFollowUpAdvice(bucket: unknown): string {
  return String(bucket == null ? '' : bucket) === 'write'
    ? '这一笔写操作没有确认结果，先核对票面现状再决定怎么续做，不要直接重放。'
    : '这一笔读操作没有拿到数据，可以直接重试。'
}

// ---------------------------------------------------------------------------
// 结局回话与上报的共用口径（#1007）：宿主平台通道与房间客户端都要说同一句话。
//
// 为什么也放在这里：这两件事要用上面那三样判定（冷却信息、失败类别），而且不许在宿主层
// 新建「宿主 -> 刷新房」或「宿主文件互引」的方向边（tests/verify-dependency-rules.ts 守着）。
// 准入桶按参数传进来，既不用 import 具体闸，也不改变「冷却状态只在准入闸一处」这条约定。
// ---------------------------------------------------------------------------

/** 上报结局只需要准入桶上这两样本事；传具体闸、宿主或房间哪一侧的实现都行。 */
export interface OutboundTransportLane {
  reportTransportFailure(request: { bucket: string; reason: OutboundTransportReason; cmd: string }): void
  reportSuccess(request: { bucket: string }): void
}

/**
 * 冷却窗口里拿名额被拒时给人的那句话；不是冷却拒绝（例如排队取消）返回空串，调用方照旧走原来的回话。
 * 说清四件事：是哪条命令、这一笔没起进程、上次是哪一类失败、还剩多久；不复述命令原文，也不带路径。
 * 冷却是连续失败计数带来的，所以把「第几次」也说出来，人一眼能看出这是同一笔故障的延续；
 * 最后接上读写各自的后续动作（outboundFollowUpAdvice），四个出口共用这一句，措辞不会分叉。
 */
export function ghCooldownReply(err: unknown, cmd: string): string {
  const cool = outboundCooldownOf(err)
  if (!cool) return ''
  const remainSec = Math.max(1, Math.round(cool.remainingMs / 1000))
  const reasonLabel = transportFailureReasonLabel(cool.reason)
  return '到 GitHub 的通路现在不通：命令 ' + (cmd || 'gh') + ' 没有起进程（上一笔连续第 ' + cool.failStreak + ' 次' + (reasonLabel ? reasonLabel + '失败' : '通路失败') + '，冷却还剩约 ' + remainSec + ' 秒）。这一笔没有执行。' + outboundFollowUpAdvice(cool.bucket)
}

/** 进程根本没起来也是 transport 级失败（spawn-failed）：同一只桶进入冷却，随后调用立刻回「通路不通」。 */
export function reportGhSpawnFailure(lane: OutboundTransportLane, bucket: string, cmd: string): void {
  try { lane.reportTransportFailure({ bucket: bucket, reason: 'spawn-failed', cmd: cmd }) } catch (eR) {}
}

/** 一趟平台 exec 结束时的上报参数：桶名、短标签、结局，以及用来辨认失败类别的两段原文。 */
export interface OutboundTransportOutcomeInfo {
  bucket: string
  cmd: string
  outcome: { exitCode?: number; signal?: string } | null | undefined
  stdout: string
  stderr: string
}

/**
 * 这一趟的结局回写给同一只准入桶（宿主平台 exec 与房间 client 共用同一套口径）：
 * 到点（signal=timeout）设冷却；拿到真实退出码（非零也算）清零；主动取消（signal=aborted）不动；
 * 其余拿不到退出码的按输出与信号认出类别，认得出才设冷却。
 */
export function reportGhOutcome(lane: OutboundTransportLane, info: OutboundTransportOutcomeInfo): void {
  try {
    const code = info.outcome && info.outcome.exitCode
    const signal = String((info.outcome && info.outcome.signal) || '')
    if (signal === 'timeout') {
      lane.reportTransportFailure({ bucket: info.bucket, reason: 'timeout', cmd: info.cmd })
    } else if (signal !== 'aborted') {
      if (typeof code === 'number' && code !== -1) {
        lane.reportSuccess({ bucket: info.bucket })
      } else {
        const reason = transportFailureReasonOf(info.stdout + ' ' + info.stderr + ' ' + signal)
        if (reason) lane.reportTransportFailure({ bucket: info.bucket, reason: reason, cmd: info.cmd })
      }
    }
  } catch (eR) {}
}

