// src/refresh/registry/quota-sync-bridge.ts —— 剩余额读数的那截接线（#758 建，#1443 改道，#1006 后台化）
// （旧 src/host/platform/deckQuotaSync.js，#1019 机械搬家只挪位置不改行为。）
//
// 只讲一件事：闸的裁决要看剩余额度，可剩余额度读数从没有任何一路写入
// （账本的 syncDue / syncServer 都在，调它的生产代码一处都没有）。
// 重启后剩余额度恒为零，读请求撞上保底线，工具调用撞上红档，
// 九个工具在闸口就被诚实推迟——干跑码钓到的 gate-defer 就是它。
//
// #1443 起改道：工具动手前先看账本差不差这一次读数，差就经 Tracker 会话调 readBudget
// （房间自己读 gh，成功回两桶，三态回未知带原因；读预算这件事本身不花额度）。
//
// #1006 起改三件事（票面五条期望、research/998 的推荐）：
// 1. 关键路径不再等读数：账本不差就直接过；差就立刻把同步放后台跑、当次返回 pending，
//    调用方照旧往下走，闸按账本里已有的旧读数诚实推迟。完全没有读数时也不挡路——等不等闸都会推迟，
//    后台刷回来之前调用注定被推迟，不如立刻给诚实推迟、后台去刷。
// 2. 失败冷却按工作区键分开存：A 工作区连续失败不再让 B 工作区也认失败；键表有上限并淘汰最久没更新的。
// 3. 冷却锚从「上次失败的时刻」改成「下次允许尝试的时刻」，失败越久等越久（起步按硬/软两档，
//    按 2 的幂往上翻，封顶后不再拉长）；成功立刻清零。硬失败（这台机器没装 gh、没登录）要人处理，
//    起步就比软失败（超时、网络、解析不出）久。
//
// 为什么按工作区分：一次失败只说明这一处读不到数（例如它自己的 gh 没登录），别的目录未必一样。
// 为什么还要全局单飞：同一时刻只放一笔读数，省外部服务的额度与进程；别人来问就搭同一班车。
// 为什么硬/软只分两档：当前失败量是每分钟几次的量级，分得更细没有对应价值（research/998 的判断）。
// 为什么必须有上限：不封顶时长期坏的工作区会退到几小时一次，等于悄悄放弃。
//
// 住在平台区：宿主层文件之间不许互相引用，平台区是被排除的位置。
// 本文件只读中央时间数字（import 冷却常量），读数实现住房间，会话由接线方以 readBudget 递进来。
// 日志不新增事件：走既有 host.call（deck.quotaSync，失败带 ok:false 与原因码，见 #1006 复核）；
// 冷却期挡下的不记（预期行为，记了就是垃圾）。后台同步落定后另经 onSettled 交给界面（#1006 期望⑤）。

// 冷却数字住中央 YAML，调时间改 config/timeouts.yaml。
import {
  QUOTA_SYNC_COOLDOWN_MS,
  QUOTA_SYNC_HARD_COOLDOWN_MS,
  QUOTA_SYNC_MAX_COOLDOWN_MS,
} from '../../shared/time-config/src/values.js'

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
/** 后台同步的失败类别（#1006 期望③）：hard = 机器没准备好要人处理；soft = 这次没连上、等它自己好。 */
export type QuotaSyncFailKind = 'hard' | 'soft'
/** 后台同步落定后的结论：界面据此说清「读数为什么还没同步上来」（#1006 期望⑤）。 */
export interface QuotaSyncSettledInfo { ok: boolean; failKind?: QuotaSyncFailKind; reason?: string; at: number }
/** 额度同步的依赖：账本的两件、读预算的会话出口、日志口、界面回执口；缺一件即缺席。 */
export interface QuotaSyncDeps { syncDue?: unknown; syncServer?: unknown; readBudget?: unknown; logCtx?: QuotaSyncLogCtx | null; cooldownMs?: unknown; hardCooldownMs?: unknown; maxCooldownMs?: unknown; now?: unknown; onSettled?: unknown }
/** 宿主日志口：成功与失败都记既有 host.call；冷却期挡下的不记。 */
export interface QuotaSyncLogCtx { fire(level: string, event: string, fields: Record<string, unknown>): void }
/**
 * 保读数的结果（#1006 后台化后多两格）：
 * - ok= true 且 pending=true：这一次读数放后台了，当次没等它；sync 是后台那一趟（门禁要看结果就 await，生产不等）。
 * - ok= true：账本不差，直接过（fresh=false）。
 * - ok= false：冷却中 / 缺件 / 入口兜底，原因码见 reason；本函数永不抛。
 */
export interface QuotaSyncResult { ok: boolean; fresh?: boolean; pending?: boolean; reason?: string; sync?: Promise<QuotaSyncResult> }

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
 * 冷却三个数字缺省取自中央 YAML（软失败 60 秒起、硬失败 10 分钟起、封顶 30 分钟）；
 * 门禁可以显式传小值，并用 now 注入假时钟（时间相关判定不许依赖真时间，否则门禁必抖）。
 */
export function createDeckQuotaSync(deps: unknown): { ensureReading: (cwd: unknown, workspaceKey: unknown) => Promise<QuotaSyncResult> } {
  const d = (deps || {}) as QuotaSyncDeps;
  const syncDue = d.syncDue as (() => boolean) | undefined;
  const syncServer = d.syncServer as ((readings: LedgerReadings, at?: number) => void) | undefined;
  const readBudget = d.readBudget as ReadBudgetFn | undefined;
  const logCtx = d.logCtx || null
  const onSettled = d.onSettled as ((info: QuotaSyncSettledInfo) => void) | undefined
  const clock = (typeof d.now === 'function') ? (d.now as () => number) : function (): number { return Date.now() }
  // 三个冷却数字：非负有限数才收，其余退回中央值（坏配置不许把冷却变成负数或 NaN）。
  function numOr(v: unknown, fallback: number): number {
    return (typeof v === 'number' && isFinite(v) && v >= 0) ? Math.floor(v) : fallback
  }
  const cooldownMs = numOr(d.cooldownMs, QUOTA_SYNC_COOLDOWN_MS)
  const hardCooldownMs = numOr(d.hardCooldownMs, QUOTA_SYNC_HARD_COOLDOWN_MS)
  const maxCooldownMs = numOr(d.maxCooldownMs, QUOTA_SYNC_MAX_COOLDOWN_MS)

  // 读数落账这一笔留痕（常驻：进程里原本 60 秒至多一次，跨进程边界，低频）。
  // 成功记既有 host.call；失败也记同一事件、带 ok:false 与原因码，不新增事件名。
  function fireSynced(ms: number): void {
    try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('info', 'host.call', { method: 'deck.quotaSync', latencyMs: ms, ok: true, kind: 'deck-tool' }) } catch (eL) {}
  }

  // 失败那一趟也留一行（#1006 复核补，仍是既有 host.call，不新增事件）。
  // 为什么要有：从前同步失败只回一个原因码，日志里查不到「这一轮冷却为什么开始」，
  // 于是票面那种「失败 7 次、零原因」的现场只能靠猜。现在每次真去读了却没读成，都留原因码
  // （sync-empty = 会话没给可用读数，sync-threw = 这一趟抛了，ensure-threw = 入口兜底）。
  // 为什么用 info 不用告警：gh 不在的机器上失败是常态，告警会淹掉真问题；ok:false 足够对账。
  // 冷却期挡下的不记 —— 那是预期行为，每次工具调用都会走一遍，记了就是垃圾。
  function fireFailed(reason: string, ms: number): void {
    try { if (logCtx && typeof logCtx.fire === 'function') logCtx.fire('info', 'host.call', { method: 'deck.quotaSync', latencyMs: ms, ok: false, kind: 'deck-tool', reason: reason }) } catch (eL) {}
  }

  // 后台同步的结论交给界面（#1006 期望⑤：后台化后失败不许只剩日志）。
  // 界面侧只认「最近一次失败」，成功那一笔用于把旧失败清掉；这里不翻译、不判断，原样递。
  function report(info: QuotaSyncSettledInfo): void {
    try { if (typeof onSettled === 'function') onSettled(info) } catch (eS) {}
  }

  // 冷却表：键是工作区键（有 workspaceKey 用它，没有退回工作区目录）。
  // 每条记「下次允许尝试的时刻」「连续失败次数」「硬还是软」；上限 64 格，满了淘汰最久没更新的。
  interface FailRec { nextAt: number; fails: number; kind: QuotaSyncFailKind }
  const MAX_SCOPES = 64
  const failTable = new Map<string, FailRec>()

  /**
   * 冷却与退避按工作区分格：有工作区键就用工作区键（工作区键怎么归一由接线方唯一负责 ——
   * deck-tool-bridge 已经写明不许别处再造一个归一），没有才退回工作区目录原串。
   * 退回原串是保底、不是等价替换：Windows 上同一个目录的大小写/斜杠写法不同会各占一格冷却，
   * 最坏只是多试一次，不会把成功当成失败；反过来在这里自己造归一，会与接线方那份悄悄分叉。
   */
  function scopeKeyOf(cwd: unknown, workspaceKey: unknown): string {
    const key = (typeof workspaceKey === 'string') ? workspaceKey.trim() : ''
    return key || String(cwd == null ? '' : cwd)
  }

  /**
   * 一次失败后要等多久再试：硬/软两档各按 2 的幂往上翻，最后由 maxCooldownMs 收口（数字来自中央 YAML）。
   * 次数只由 rememberFail 封顶一处（16）；这里不再另设一个上限 —— 两处各封一次时小的那个永远不生效，
   * 读代码的人会以为还有一道保险，实际上没有。
   */
  function waitAfterFail(kind: QuotaSyncFailKind, fails: number): number {
    const base = kind === 'hard' ? hardCooldownMs : cooldownMs
    const span = base * Math.pow(2, Math.max(0, fails - 1))
    return Math.min(span, maxCooldownMs)
  }

  /**
   * 记一次失败：连续次数加一（封顶 16，2 的幂最多到 2^15，再由 maxCooldownMs 兜住），下次允许时刻 = 现在 + 退避。
   * 同键重写先删再插，让它排到 Map 最后（= 最近更新过的那条），淘汰时先淘汰最久没更新的。
   */
  function rememberFail(key: string, kind: QuotaSyncFailKind, at: number): void {
    const prev = failTable.get(key)
    const fails = Math.min((prev ? prev.fails : 0) + 1, 16)
    if (failTable.has(key)) failTable.delete(key)
    failTable.set(key, { nextAt: at + waitAfterFail(kind, fails), fails: fails, kind: kind })
    while (failTable.size > MAX_SCOPES) {
      const oldest = failTable.keys().next().value as string
      failTable.delete(oldest)
    }
  }

  let flying: Promise<QuotaSyncResult> | null = null

  /**
   * 这一次失败算硬还是软（#1006 期望③的唯一判别点）：
   * - 会话这一层抛了：临时故障居多，按软处理等它自己好。
   * - 会话回失败信封：环境/鉴权/起进程失败都是「这台机器没准备好」，要人处理，归硬；其余按软。
   *   判断用的三个值：'env' / 'auth' 是跟踪器契约 ERROR_KIND 里的两档，'spawn' 是宿主 gh 执行层
   *   起进程失败自己回的第三档（不在契约八档里，见 gh-execution.ts 的 kind: 'spawn'）。
   *   这里按值比较，不引契约运行时 —— 桥住在平台区，只认形状。
   * - 读数到手但形状不完整（缺桶、格子不是数）：解析这一档，等下一次读，按软。
   * - 房间说量不出来：not-measured（没装 gh、没登录）归硬；unavailable（网络、超时、解析）归软。
   */
  function failKindOf(raw: unknown, reading: SessionBudgetReading | null, threw: boolean): QuotaSyncFailKind {
    if (threw) return 'soft'
    const err = (raw && typeof raw === 'object') ? (raw as { error?: unknown }).error : null
    const kind = (err && typeof err === 'object') ? (err as { kind?: unknown }).kind : null
    if (kind === 'env' || kind === 'auth' || kind === 'spawn') return 'hard'
    if (!reading) return 'soft'
    if (reading.known === true) return 'soft'
    return reading.reason === 'not-measured' ? 'hard' : 'soft'
  }

  /** 成功落定：清掉这个工作区的失败记录、留一行 host.call、把成功结论交给界面。 */
  function settleOk(key: string, ms: number): void {
    failTable.delete(key)
    fireSynced(ms)
    report({ ok: true, at: clock() })
  }

  /** 失败落定：按硬/软记退避、留一行 host.call（带原因码）、把失败结论交给界面。 */
  function settleFail(key: string, kind: QuotaSyncFailKind, reason: string, ms: number): void {
    const at = clock()
    rememberFail(key, kind, at)
    fireFailed(reason, ms)
    report({ ok: false, failKind: kind, reason: reason, at: at })
  }

  /**
   * 真去读一次并落账（只由 ensureReading 起，调用方不等它）。
   * 落账带「取数开始时刻」而不是落账时刻：慢请求迟到时，账本按这个时刻判断新旧，
   * 旧读数不许盖新读数（#1006 验收⑤，账本那一侧只有一句判据）。
   * 全局单飞：已经在飞就搭同一班车（同一时刻只放一笔，避免把当前后端编号串来串去）。
   */
  function doSync(cwd: unknown, key: string, startedAt: number): Promise<QuotaSyncResult> {
    if (flying) return flying
    const p = (async function (): Promise<QuotaSyncResult> {
      const t0 = Date.now()
      let threw = false
      try {
        if (typeof readBudget !== 'function' || typeof syncServer !== 'function') return { ok: false, reason: 'missing-dep' }
        let raw: unknown = null
        // 经会话读一次（房间自己读 gh）：未知读数等于没读到，不落账、不抛，调用方照旧走原流程。
        try { raw = await readBudget(cwd) } catch (eR) { threw = true }
        const reading = threw ? null : asReading(raw)
        let applied = false
        // #1446：只计请求的后端（GitLab 这种）只有 requests 一格，同样要能同步进账本；
        // 离网后端没有桶（账本不建），读数也恒离网，这里自然跳过。
        if (reading && reading.known === true && reading.kind === 'requests-only') {
          const req1 = (reading as { requests?: SessionBucket | null }).requests
          const lr = req1 ? num(req1.limit) : null
          const rr = req1 ? num(req1.remaining) : null
          if (lr !== null && rr !== null) {
            try {
              (syncServer as (readings: LedgerReadings, at?: number) => void)({ requests: { limit: lr, remaining: rr, reset: 0 } }, startedAt);
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
              (syncServer as (readings: LedgerReadings, at?: number) => void)({ rest: { limit: l1, remaining: r1, reset: 0 }, graphql: { limit: l2, remaining: r2, reset: 0 } }, startedAt);
              applied = true
            } catch (eS) {}
          }
        }
        if (applied) { settleOk(key, Date.now() - t0); return { ok: true, fresh: true } }
        // 真读了却没落成：原因码仍是既有那两个（sync-empty / sync-threw），不新增码。
        const reason = threw ? 'sync-threw' : 'sync-empty'
        settleFail(key, failKindOf(raw, reading, threw), reason, Date.now() - t0)
        return { ok: false, reason: reason }
      } catch (e) {
        settleFail(key, 'soft', 'sync-threw', Date.now() - t0)
        return { ok: false, reason: 'sync-threw' }
      }
    })()
    flying = p
    // 收尾一定要清掉单飞位：不清会让后续调用永远搭上一辆已经开走的车。
    p.then(function (): void { if (flying === p) flying = null }, function (): void { if (flying === p) flying = null })
    return p
  }

  /**
   * 动手前保一次读数：账本说不差就直接过，差就把同步放到后台并立即返回 pending。
   * 任何一步走不通都回不成功或 pending，调用方照旧走原流程（闸会诚实推迟）。
   * 本函数永不抛。
   */
  async function ensureReading(cwd: unknown, workspaceKey: unknown): Promise<QuotaSyncResult> {
    try {
      // 账本说不差：不打读数，关键路径零等待。
      if (typeof syncDue === 'function' && !syncDue()) return { ok: true, fresh: false }
      // 缺读数出口或缺落账口：如实说缺件（读了没处落等于没读）。
      if (typeof readBudget !== 'function' || typeof syncServer !== 'function') return { ok: false, reason: 'missing-dep' }
      const key = scopeKeyOf(cwd, workspaceKey)
      const at = clock()
      const prev = failTable.get(key)
      // 冷却中：这一笔直接认没保住，调用方照旧往下走；不读、不记日志、不动锚（锚就是下次允许尝试的时刻）。
      if (prev && at < prev.nextAt) return { ok: false, reason: 'sync-cooldown' }
      // #1006：读数放后台，这一笔立刻往下走。要看同步结果的调用方 await 返回里的 sync（门禁走这条）。
      return { ok: true, fresh: false, pending: true, sync: doSync(cwd, key, at) }
    } catch (e) { fireFailed('ensure-threw', 0); return { ok: false, reason: 'ensure-threw' } }
  }

  return { ensureReading: ensureReading }
}
