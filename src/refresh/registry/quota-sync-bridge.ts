// src/refresh/registry/quota-sync-bridge.ts —— 剩余额读数的那截接线（#758 建，#1443 改道）
// （旧 src/host/platform/deckQuotaSync.js，#1019 机械搬家只挪位置不改行为。）
//
// 只讲一件事：闸的裁决要看剩余额度，可剩余额度读数从没有任何一路写入
// （账本的 syncDue / syncServer 都在，调它的生产代码一处都没有）。
// 重启后剩余额度恒为零，读请求撞上保底线，工具调用撞上红档，
// 九个工具在闸口就被诚实推迟——干跑码钓到的 gate-defer 就是它。
//
// #1443 起改道：工具动手前先看账本差不差这一次读数，差就经 Tracker 会话调 readBudget
// （房间自己读 gh，成功回两桶，三态回未知带原因；读预算这件事本身不花额度）。
// 读数落账后再走原流程。进程里 60 秒最多打一次（失败冷却），并发调用只打一次（本实例内并单）。
// gh 不在、没登录、解析不出，三种都认失败并让原流程照旧被闸推迟——
// 如实，不抛，不替工作区攒失败计数（失败只退避，不记数）。
//
// 住在平台区：宿主层文件之间不许互相引用，平台区是被排除的位置。
// 本文件零导入（只读中央时间数字），读数实现住房间，会话由接线方以 readBudget 递进来。
// 日志不新增事件：走既有 host.call（deck.quotaSync，失败带 ok:false 与原因码，见 #1006 复核）；
// 冷却期挡下的不记（预期行为，记了就是垃圾）。

// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { QUOTA_SYNC_COOLDOWN_MS } from '../../shared/time-config/src/values.js'

/** 一个桶的水位：上限与剩余（房间读数的形状；重置时刻房间不给，落账时占位）。 */
export interface SessionBucket { limit: number; remaining: number }
/** 会话读数的结果形状（与契约的 BudgetReading 同形，桥里只认形状，不引契约运行时）。 */
export type SessionBudgetReading =
  | { known: true; kind: 'two-buckets'; buckets: { rest: SessionBucket; graphql: SessionBucket } }
  | { known: true; kind: 'requests-only'; requests: SessionBucket }
  | { known: true; kind: 'off-network' }
  | { known: false; reason: 'not-measured' | 'unavailable' | 'unsupported' };
/** 会话 readBudget 的回执（成功信封里装读数；房间三态都走成功信封，见房间 budget.ts）。 */
export type SessionBudgetResult = { ok: true; data: SessionBudgetReading } | { ok: false; error?: unknown };
/** 读一次预算的出口：接线方递进来的 Tracker 会话 readBudget（按工作区目录读）。 */
export type ReadBudgetFn = (cwd: unknown) => Promise<SessionBudgetResult | SessionBudgetReading | null | undefined>;
/** 落账两桶的形状（账本 syncServer 收的就是这一份，reset 占位见下）。 */
export interface LedgerReadings { rest?: { limit: number; remaining: number; reset: number }; graphql?: { limit: number; remaining: number; reset: number }; requests?: { limit: number; remaining: number; reset: number } }
/** 额度同步的依赖：账本的两件、读预算的会话出口、日志口；缺一件即缺席。 */
export interface QuotaSyncDeps { syncDue?: unknown; syncServer?: unknown; readBudget?: unknown; logCtx?: QuotaSyncLogCtx | null; cooldownMs?: unknown }
/** 宿主日志口：成功记既有 host.call；失败靠既有那几行，不另记不刷屏。 */
export interface QuotaSyncLogCtx { fire(level: string, event: string, fields: Record<string, unknown>): void }
/** 保读数的结果：ok 为真表示这次读数可用（fresh 说是不是刚打来的）；不成功一律带原因码。 */
export interface QuotaSyncResult { ok: boolean; fresh?: boolean; reason?: string }

/**
 * 会话回执归一成读数：成功信封取 data，裸读数（门禁夹具走这一条）直接认，其余一律按没量出来。
 * 归一失败不抛 —— 调用方只认「有没有数」，形状不对等于没数。
 */
function asReading(raw: unknown): SessionBudgetReading | null {
  try {
    if (!raw || typeof raw !== 'object') return null
    const bag = raw as Record<string, unknown>;
    if (bag.ok === true && bag.data && typeof bag.data === 'object') return bag.data as SessionBudgetReading
    if (bag.known === true || bag.known === false) return bag as unknown as SessionBudgetReading
    return null
  } catch { return null }
}

/** 有限数字才算数：读数里缺格、字符串、NaN，一律按缺格处理（调用方认失败，不编数）。 */
function num(v: unknown): number | null { return (typeof v === 'number' && isFinite(v)) ? v : null }

/**
 * 造剩余额同步（依赖全由接线方显式传入，不在文件顶层抓单例）。
 * 失败冷却缺省 60000 毫秒：gh 不在的机器上失败是常态，不加冷却每次调用白起一次失败的读数。
 * 成功清零，失败记时，冷却内直接认失败（调用方照旧被闸推迟）。
 */
export function createDeckQuotaSync(deps: unknown): { ensureReading: (cwd: unknown, workspaceKey: unknown) => Promise<QuotaSyncResult> } {
  const d = (deps || {}) as QuotaSyncDeps;
  const syncDue = d.syncDue as (() => boolean) | undefined;
  const syncServer = d.syncServer as ((readings: LedgerReadings) => void) | undefined;
  const readBudget = d.readBudget as ReadBudgetFn | undefined;
  const logCtx = d.logCtx || null
  // 失败冷却：gh 不在的机器上失败是常态，不加冷却每次调用白起一次失败的读数。
  // 成功清零，失败记时，冷却内直接认失败（调用方照旧被闸推迟）。
  const cooldownMs = (typeof d.cooldownMs === 'number' && d.cooldownMs >= 0) ? Math.floor(d.cooldownMs) : QUOTA_SYNC_COOLDOWN_MS
  let lastFailAt = 0

  // 读数落账这一笔留痕（常驻：进程里 60 秒至多一次，跨进程边界，低频）。
  // 成功记既有 host.call；失败靠既有那几行，不另记（缺 gh 的机器不刷屏）。
  function fireSynced(ms: number): void {
    try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('info', 'host.call', { method: 'deck.quotaSync', latencyMs: ms, ok: true, kind: 'deck-tool' }) } catch (eL) {}
  }

  // 失败那一趟也留一行（#1006 复核补，仍是既有 host.call，不新增事件）。
  // 为什么要有：从前同步失败只回一个原因码，日志里查不到「这一轮 60 秒冷却为什么开始」，
  // 于是票面那种「失败 7 次、零原因」的现场只能靠猜。现在每次真去读了却没读成，都留原因码
  // （sync-empty = 会话没给可用读数，sync-threw = 这一趟抛了，ensure-threw = 入口兜底）。
  // 为什么用 info 不用告警：gh 不在的机器上失败是常态，告警会淹掉真问题；ok:false 足够对账。
  // 冷却期挡下的不记 —— 那是预期行为，每次工具调用都会走一遍，记了就是垃圾。
  function fireFailed(reason: string, ms: number): void {
    try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('info', 'host.call', { method: 'deck.quotaSync', latencyMs: ms, ok: false, kind: 'deck-tool', reason: reason }) } catch (eL) {}
  }

  let flying: Promise<QuotaSyncResult> | null = null

  function doSync(cwd: unknown, workspaceKey: unknown): Promise<QuotaSyncResult> {
    if (flying) return flying
    flying = (async function (): Promise<QuotaSyncResult> {
      const t0 = Date.now()
      try {
        if (typeof readBudget !== 'function' || typeof syncServer !== 'function') return { ok: false, reason: 'missing-dep' }
        let applied = false
        // 经会话读一次（房间自己读 gh）：未知读数等于没读到，不落账、不抛，调用方照旧走原流程。
        const reading = asReading(await readBudget(cwd))
        // #1446：只计请求的后端（GitLab 这种）只有 requests 一格，同样要能同步进账本；
        // 离网后端没有桶（账本不建），读数也恒离网，这里自然跳过。
        if (reading && reading.known === true && reading.kind === 'requests-only') {
          const req1 = (reading as { requests?: SessionBucket | null }).requests
          const lr = req1 ? num(req1.limit) : null
          const rr = req1 ? num(req1.remaining) : null
          if (lr !== null && rr !== null) {
            try {
              (syncServer as (readings: LedgerReadings) => void)({ requests: { limit: lr, remaining: rr, reset: 0 } });
              applied = true
            } catch (eS) {}
          }
        } else if (reading && reading.known === true && reading.kind === 'two-buckets' && reading.buckets) {
          const rest = reading.buckets.rest as SessionBucket | null | undefined;
          const graphql = reading.buckets.graphql as SessionBucket | null | undefined;
          const l1 = rest ? num(rest.limit) : null
          const r1 = rest ? num(rest.remaining) : null
          const l2 = graphql ? num(graphql.limit) : null
          const r2 = graphql ? num(graphql.remaining) : null
          if (l1 !== null && r1 !== null && l2 !== null && r2 !== null) {
            try {
              // 房间读数不带重置时刻，账本该格只写不读，给 0 占位；额度耗尽的等待仍由裁决按分桶剩余算，不靠这一格。
              (syncServer as (readings: LedgerReadings) => void)({ rest: { limit: l1, remaining: r1, reset: 0 }, graphql: { limit: l2, remaining: r2, reset: 0 } });
              applied = true
            } catch (eS) {}
          }
        }
        if (applied) { fireSynced(Date.now() - t0); return { ok: true, fresh: true } }
        fireFailed('sync-empty', Date.now() - t0)
        return { ok: false, reason: 'sync-empty' }
      } catch (e) { fireFailed('sync-threw', Date.now() - t0); return { ok: false, reason: 'sync-threw' } } finally {
        flying = null
      }
    })()
    return flying
  }

  /**
   * 动手前保一次读数：账本说不差就直接过，差就经会话读一次。
   * 任何一步走不通都回不成功，调用方照旧走原流程（闸会诚实推迟）。
   * 本函数永不抛。
   */
  async function ensureReading(cwd: unknown, workspaceKey: unknown): Promise<QuotaSyncResult> {
    try {
      if (typeof syncDue === 'function' && !syncDue()) return { ok: true, fresh: false }
      if (typeof syncDue !== 'function' && typeof syncServer !== 'function') return { ok: false, reason: 'missing-dep' }
      if (lastFailAt !== 0 && Date.now() - lastFailAt < cooldownMs) return { ok: false, reason: 'sync-cooldown' }
      const r = await doSync(cwd, workspaceKey)
      if (r && r.ok) lastFailAt = 0
      else lastFailAt = Date.now()
      return r
    } catch (e) { fireFailed('ensure-threw', 0); return { ok: false, reason: 'ensure-threw' } }
  }

  return { ensureReading: ensureReading }
}
