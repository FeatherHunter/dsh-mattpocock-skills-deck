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
import { OUTBOUND_READ_TIMEOUT_MS, OUTBOUND_WRITE_TIMEOUT_MS, OUTBOUND_PROBE_TIMEOUT_MS, OUTBOUND_DEFAULT_TIMEOUT_MS } from '../../shared/time-config/src/values.js'

export const READ_TIMEOUT_MS = OUTBOUND_READ_TIMEOUT_MS
export const WRITE_TIMEOUT_MS = OUTBOUND_WRITE_TIMEOUT_MS
export const PROBE_TIMEOUT_MS = OUTBOUND_PROBE_TIMEOUT_MS

/** 拿不到档位时的旧默认：沿用历史 30000，不静默变快。 */
export const DEFAULT_TIMEOUT_MS = OUTBOUND_DEFAULT_TIMEOUT_MS

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
