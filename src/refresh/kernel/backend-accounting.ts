/**
 * src/refresh/kernel/backend-accounting.ts —— 把一次房间调用实际花掉的量换算成账本要记的那几笔（#1446 A3）
 *
 * 为什么换算放在这个纯函数文件里：规格 1439 第 8 节要求「账本以『后端 id 加桶名』为键，
 * countsRequests / countsPoints / independentBuckets 决定记账口径，算式只读模型、不读 backend id」。
 * 算式只读模型这件事要能被门禁盯住，就不能散在装配层；这里没有读盘、联网、看时钟的代码，
 * 输入一份口径声明加一份房间回包，输出「记哪几个桶、各记多少」，可以整块测干净。
 *
 * 用量从哪来：房间成功信封上的 usage（见 src/tracker/contract/results.ts 的 OpUsage）。
 * 房间自己数着每一笔出站，别的层都没有第一手数据 —— 估算（tool-call-budget）是调用前猜的，
 * 不能拿来记账；这里只认结果里自报的那一份。
 *
 * 四种口径各记各的（与规格的实现决定第 8 节一一对应）：
 *  - 两桶（independentBuckets 真）：请求记 rest 桶、点数记 graphql 桶，一笔调用可能两笔都记（极少见，如实记）。
 *  - 只计请求：只记 requests 桶，点数一律不记（该口径没有点数这一说）。
 *  - 未知模型：只记请求数，落在 requests 桶（「还不知道按什么口径花，但发出去的请求是实数」）。
 *  - 离网：一笔都不记（本来就没有额度这回事，账上留零）。
 */
import type { AccountInput, AccountPort } from '../../tracker/contract/budget-model.js'
import type { OpUsage } from '../../tracker/contract/results.js'

/** 记账落在账本的哪个桶上（与 src/refresh/rooms/host/quota-ledger.ts 的桶名同义，账本那一份是唯一真源）。 */
export type AccountBucket = 'rest' | 'graphql' | 'requests'

/** 一次调用要记的一笔（账本按桶逐笔记，same 桶可能有两笔，所以是数组）。 */
export interface AccountSpend {
  bucket: AccountBucket
  requests: number
  points: number
}

/** 本文件在仓库里的位置（产物里留着它，用来证明产物确实来自这份源码）。 */
export const ACCOUNTING_SOURCE = 'src/refresh/kernel/backend-accounting.ts'

/** 取一个非负整数；NaN、负数、小数一律按 0 或截断处理，绝不让脏数进账本。 */
function nonNegInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

/**
 * 从房间回包里读出实际用量（没有就回 null，调用方据此打一行「这次没数」的诊断，不写假数）。
 *
 * 两种回包都认：
 *  - 成功信封（`ok: true`）上的 usage —— 23 条操作都走这个形状。
 *  - 定位口的裸值（没有 `ok`，例如 `getRepoKey` 回 `{ owner, name, usage }`）—— 契约规定定位口
 *    没有成功信封，答案本身就是名字或者空；它真起了 gh 时用量只能挂在同一个对象上（#1453）。
 * 显式失败（`ok: false`）一律不记：失败信封没有「做成了」可言，房间不该在失败时附用量，
 * 真附了也不替它编一笔账；失败那次花没花由调用方按口径决定记零。
 */
export function usageOfResult(result: unknown): OpUsage | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  if (r.ok === false) return null
  const usage = r.usage
  if (!usage || typeof usage !== 'object') return null
  const u = usage as Record<string, unknown>
  return { requests: nonNegInt(u.requests), points: nonNegInt(u.points) }
}

/**
 * 把一次调用换算成账本要记的几笔（纯函数：只读口径声明与回包，不碰任何外部状态）。
 * 回空数组表示「这次不记」（离网后端、或者确实零花）；夹着口径与用量的关系写在这里，
 * 账本只管按桶累加，不再自己解释模型。
 */
export function spendsOfAccount(input: AccountInput): AccountSpend[] {
  const budget = input.budget
  if (!budget) return []
  // 离网后端：本来就没有额度，记零（连桶都不必建）。这一条必须先于「读用量」，慢了就会在
  // 一个没有桶的后端上尝试记账，账本会按「桶不存在」当场炸——那是装配错误，不是离网该有的样子。
  if (budget.kind === 'off-network') return []
  const usage = usageOfResult(input.result)
  if (!usage) return []
  const requests = budget.countsRequests === true ? usage.requests : 0
  const points = budget.countsPoints === true ? usage.points : 0
  if (budget.kind === 'requests-only') {
    // 只计请求：这条口径只有一桶，点数声明恒为否，即便房间误报了点数也不记。
    return requests > 0 ? [{ bucket: 'requests', requests: requests, points: 0 }] : []
  }
  if (budget.independentBuckets === true) {
    const out: AccountSpend[] = []
    if (requests > 0) out.push({ bucket: 'rest', requests: requests, points: 0 })
    if (points > 0) out.push({ bucket: 'graphql', requests: 0, points: points })
    return out
  }
  // 未知模型（kind === 'unknown'，或者两种桶互不相通的声明缺席）：只记请求数，落在 requests 桶。
  // 「不知道按什么口径花」不等于「没花」，请求数是实数，记下来比记零更接近真相。
  return requests > 0 ? [{ bucket: 'requests', requests: requests, points: 0 }] : []
}

/**
 * 把后端声明的预算模型收成记账口认识的四格（#1439）。认不出的口径按未知处理：只记请求数。
 * 为什么补这一层：面板与强制刷新那一路由闸把用量交过来时，闸只报「谁、哪个后端、几条请求、几个点」，
 * 预算口径要由装配处补齐；补齐规则与上面 spendsOfAccount 的分桶规则收在同一份文件里，
 * 免得两边各写一套默认值，把「不认识的口径」一半算成两桶、一半算成未知。
 */
export function normalizeBudgetDeclaration(model: unknown): Record<string, unknown> {
  const raw = (model && typeof model === 'object') ? model as Record<string, unknown> : {}
  const kind = String(raw.kind || 'unknown')
  if (kind !== 'two-buckets' && kind !== 'requests-only' && kind !== 'off-network' && kind !== 'unknown') {
    return { kind: 'unknown', countsRequests: true, countsPoints: false, independentBuckets: false }
  }
  return { kind: kind, countsRequests: raw.countsRequests === true, countsPoints: raw.countsPoints === true, independentBuckets: raw.independentBuckets === true }
}

/**
 * 账本接口里记账口用到的那两条。这里只声明形状、不 import 账本模块：本文件是纯换算层，
 * 账本（src/refresh/rooms/host/quota-ledger.ts）由装配方递进来；两处不互相依赖。
 */
interface AccountLedger {
  spend(entry: { account: string; backendId: string; bucket: string; kind?: string; requests?: number; points?: number }): unknown
  bucketsOf?(backendId: string): string[]
  ensureBackend?(backendId: string, budget: unknown): unknown
}

/** 造一个记账口要的两格：账本，以及这次调用记在账本的哪一档（插件后台 / 人的动作 / AI 工具）。 */
export interface AccountPortDeps {
  ledger: unknown
  account: string
}

/**
 * 造「操作管线的记账口」（#1454）：全仓库只有这里调 `ledger.spend`，也就是「账本只有一条写入口」。
 *
 * 为什么收在一处：deck 工具那条路（src/refresh/registry/deck-tool-bridge.ts）与刷新后台那条路
 * （src/refresh/rooms/host/session-opener.ts）的 caller 不同、记的档不同（ai-tool / plugin），
 * 但「房间报了多少、按口径落到哪几个桶」必须只有一份换算与一次写入。从前两条路各写一份：
 * 桥里那份是空函数，deck 工具的真实用量从来没进账本；闸（refresh-gate.ts）又自己写一本，
 * 同一笔花费可能记两处或一处都不记。现在写入只剩这个函数，两条路只是传入的档位不同。
 *
 * 三条边界（与 spendsOfAccount 同一口径）：
 *  - 没有后端编号：账本上的格按后端分，没有编号就宁可少记，也不编一格出来；
 *  - 没有用量（失败信封 / 读操作没自报数）：spendsOfAccount 回空数组，直接不记；
 *  - 离网：本来没有额度，一笔都不记。
 *
 * 首次记账时桶可能还没建出来（例如 deck 工具读路径的 ensureReading 因为同步未到期而没建桶）。
 * 所以写之前看一眼这个后端有没有桶，没有就按这次的口径声明建一次；ensureBackend 对同一个
 * 后端与同一口径是幂等的，已经建过不会清读数，也不会重建桶。
 */
export function createAccountPort(deps: AccountPortDeps): AccountPort {
  const ledger = (deps.ledger || null) as AccountLedger | null
  const account = String(deps.account || '')
  return async function accountPort(input: AccountInput): Promise<void> {
    if (!ledger || typeof ledger.spend !== 'function') return
    const backendId = input && typeof input.backendId === 'string' ? input.backendId : ''
    if (!backendId) return
    const spends = spendsOfAccount(input)
    if (spends.length === 0) return
    // 桶缺席时先补建：只在「这个后端一个桶都没有」时建，已有的桶不碰（ensureBackend 同口径幂等，
    // 但这里多看一眼就不必让每次记账都走一遍建桶逻辑，也避免口径声明缺格时误重建）。
    if (input.budget && typeof ledger.ensureBackend === 'function' && typeof ledger.bucketsOf === 'function') {
      const known = ledger.bucketsOf(backendId)
      if (!known || known.length === 0) ledger.ensureBackend(backendId, input.budget)
    }
    for (const spend of spends) {
      ledger.spend({ account: account, backendId: backendId, bucket: spend.bucket, kind: input.op, requests: spend.requests, points: spend.points })
    }
  }
}
