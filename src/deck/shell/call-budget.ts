// src/deck/shell/call-budget.ts —— 批量调用的执行上下文（#895；#1040 转 TypeScript）
//
// 为什么有这个文件：单次工具调用有墙钟上限（agent 注册那份 AGENT_TOOL_TIMEOUT_MS），
// 而批量活要发几十次远端调用。超限被外层掐死会丢掉全部进度，所以调用自己要会看钟：
//   1. 剩余额度不够就停发新的调用，主动报部分成功（调用方拿游标续跑）；
//   2. 每一次远端调用单独钳制超时并可中止，超支的只坏自己那一项，不炸整包；
//   3. 同一次调用里重复读只发一次（纯读记忆），写操作只废掉被波及的条目；
//   4. 超时与中止的回执永远诚实（生效与否说不清 + 核对指引），不假装成功。
//
// 住共享层：宿主工具文件各自 import 它（host → shared 是允许的方向）。
// 记忆那半（读缓存、票关系名册、缓存键）住在同目录的 call-memo.ts，本文件从那里取。
// 拆开的唯一原因是「单文件 350 行」那条上限（tests/verify-file-granularity.ts）：补完类型标注
// 之后这个文件的有效行数到了 428，越线了。为什么这么拆、键的形状为什么不能改，写在 call-memo.ts 的文件头。
// 后端房间可按需读 ctx.memo（房间 → 壳是允许的方向），ctx.memo 缺席时一切照旧——面板与旧调用方不受影响。
// 日志：不新增事件名、不记新字段（复用宿主壳既有的 host.call 两行）。

import { canon, createCallMemo, isArr, repoIdOf, rosterAddCreated, rosterAdoptList, rosterDirty, rosterUpsert, type CallMemo } from './call-memo.js'
import { withInFlightLease } from './in-flight-lease.js'
// 三个预算数住中央 YAML（config/timeouts.yaml 的 tool* 三键）：这里只留别名，
// 对外导出的仍是 DEFAULT_* 名字，调时间改 YAML。值由 tests/verify-time-config.ts 看守一致。
import { TOOL_TIMEOUT_MS, TOOL_MARGIN_MS, PER_OP_TIMEOUT_MS } from '../../shared/time-config/src/values.js'

/** 单次执行允许的最长时间（毫秒）：与 agent 注册那份 AGENT_TOOL_TIMEOUT_MS 同值，改一边必须同步另一边。
 *  同值由 tests/verify-895-bulk-deadline.js 第⑦节断言看守（注册侧文件不引用其他层的文件，不能靠 import 收成一份）。
 *  2026-10-14 由 120000 放宽到 300000（票 #1040）：批量活要发几十次远端调用，两分钟常在半路被外层
 *  掐死、整包进度作废；放宽后最坏情况多等三分钟，换回来的是整批活能跑完。
 *  为什么宁可放宽也不许为了「省额度」做慢做坏，见 docs/adr/20261014-quota-function-first.md。 */
export const DEFAULT_TOOL_TIMEOUT_MS = TOOL_TIMEOUT_MS
/** 剩余额度到这条线就停发新调用：留给收尾回包与误差（只大不小，方向安全）。
 *  预算从两分钟放到五分钟后，余量跟着从 10 秒放到 15 秒：收尾那几笔（写游标、拼回执）在慢后端上要更宽的边。 */
export const DEFAULT_TOOL_MARGIN_MS = TOOL_MARGIN_MS
/** 单次远端调用默认钳制（毫秒）：与 github 房单条命令默认同值；改那边时同步改这里。 */
export const DEFAULT_PER_OP_TIMEOUT_MS = PER_OP_TIMEOUT_MS

/** 未知形状的入参统一按这张表逐格验，不猜。 */
type UnknownRecord = Record<string, unknown>;

/**
 * 取消信号的最小形状：本文件只用它三件事——看 aborted、挂 abort 监听、摘监听。
 * 为什么不用 DOM 的 AbortSignal 类型：本层是宿主侧代码，将来圈进 tsconfig 时不一定带 DOM 库；
 * 按形状声明，DOM 环境与测试里的假信号都能满足，行为一字不变。
 */
export interface AbortLike {
  aborted?: boolean;
  addEventListener?(type: string, listener: () => void, opts?: unknown): unknown;
  removeEventListener?(type: string, listener: () => void, opts?: unknown): unknown;
}

/** 取消控制器的最小形状（与 AbortLike 配套，同样不依赖 DOM 类型定义）。 */
export interface AbortControllerLike {
  signal: AbortLike;
  abort(): void;
}

/** 等待口：等到多少毫秒，或收到中止信号就提前放行。缺省是真定时器（realSleep）。 */
export type SleepFn = (ms: number, signal?: AbortLike | null) => Promise<unknown>;

/** 后端调用回执：成功那支带 data，失败那支带 kind 与给人看的 message；四支（成功/超时/中止/被拒）同形。 */
export interface OpOutcome {
  ok: boolean;
  /**
   * 后端回执那一格：故意留 any，但这是一笔记着账的欠账，不是刻意的边界。九个工具按后端原样读它
   * （先 `r.data || {}` 再取字段；按 `.data` 字面量数，九个工具里 35 处，连壳与工具登记一起 57 处）。
   * 契约层其实早就给每个操作的结果建了模（`OpResult<Issue>` 等，见 `src/tracker/contract/operations.ts`），
   * 三个后端也各自把原始回执归一化成契约的 `Issue`，所以这一格装的是归一化之后的结果。
   * 之所以不改成 unknown：那只是把红点从这一处挪到上面那些读法上；真要收窄，正解是把本接口的结果
   * 参数化到契约已有的 `OpResult<T>`。这笔账的更正记录见 #1108 末尾的评论。
   */
  data?: any;
  error?: { kind?: string; message?: string };
  timeout?: boolean;
  aborted?: boolean;
  refused?: string;
  [key: string]: unknown;
}

/**
 * list 的回执（#1304）：在通用回执上多带两格 —— `truncated` 与 `fallback`。
 * `truncated: true` 表示这份名单可能不全（到了后端安全上限，或降级通道只拿到一部分），
 * 这时 `data` 只是「拿到的这些」，不许当成整仓；
 * `fallback: 'rest'` 是「主路不可用、走了 REST 降级通道」的事实，REST 自己也可能只拿到一部分，
 * 所以单凭它也**不能**把名册标成完整。
 * 类型源头在契约（`src/tracker/contract/results.ts` 的 `IssueListResult`），这里只把它带进工具层，
 * 工具不再对回执做强制转换去猜这两格。
 */
export interface ListOpOutcome extends OpOutcome {
  truncated?: boolean;
  fallback?: string;
}

/**
 * 注入的后端实现：方法可缺（缺哪个就诚实回「没拿到后端实现」或 unsupported），
 * 参数与返回值形状由后端房间自己保证，本层只负责看钟、钳制、缓存与名册，不看内容。
 */
export interface BackendLike {
  get?(repo: unknown, key: unknown, filter: unknown, ctx: unknown): Promise<unknown>;
  list?(repo: unknown, filter: unknown, ctx: unknown): Promise<unknown>;
  getDependencies?(repo: unknown, key: unknown, filter: unknown, ctx: unknown): Promise<unknown>;
  create?(repo: unknown, input: unknown, ctx: unknown): Promise<unknown>;
  setParent?(repo: unknown, key: unknown, parent: unknown, filter: unknown, ctx: unknown): Promise<unknown>;
  setBlockedBy?(repo: unknown, key: unknown, blockers: unknown, filter: unknown, ctx: unknown): Promise<unknown>;
  preflight?(handle: unknown, ctx: unknown): Promise<unknown>;
  getRepoPermissions?(repo: unknown, ctx: unknown): Promise<unknown>;
  close?(repo: unknown, key: unknown, filter: unknown, ctx: unknown): Promise<unknown>;
  reopen?(repo: unknown, key: unknown, ctx: unknown): Promise<unknown>;
  comment?(repo: unknown, key: unknown, body: unknown, ctx: unknown): Promise<unknown>;
  update?(repo: unknown, key: unknown, patch: unknown, ctx: unknown): Promise<unknown>;
  setLabels?(repo: unknown, key: unknown, labels: unknown, filter: unknown, ctx: unknown): Promise<unknown>;
  setAssignees?(repo: unknown, key: unknown, assignees: unknown, filter: unknown, ctx: unknown): Promise<unknown>;
  [method: string]: unknown;
}

/** 本层包给工具用的后端门面：与注入的后端同名方法，但每次调用都过预算与钳制，回执形状统一。 */
export interface DeckTrackerLike {
  get(repo: unknown, key: unknown, f?: unknown, ctx?: unknown): Promise<OpOutcome>;
  list(repo: unknown, filter?: unknown, ctx?: unknown): Promise<ListOpOutcome>;
  getDependencies(repo: unknown, key: unknown, f?: unknown, ctx?: unknown): Promise<OpOutcome>;
  create(repo: unknown, input?: unknown, ctx?: unknown): Promise<OpOutcome>;
  setParent(repo: unknown, key: unknown, parent: unknown, f?: unknown, ctx?: unknown): Promise<OpOutcome>;
  setBlockedBy(repo: unknown, key: unknown, blockers: unknown, f?: unknown, ctx?: unknown): Promise<OpOutcome>;
  preflight(handle: unknown, ctx?: unknown): Promise<OpOutcome>;
  getRepoPermissions(repo: unknown, ctx?: unknown): Promise<OpOutcome>;
  close(repo: unknown, key: unknown, f?: unknown, ctx?: unknown): Promise<OpOutcome>;
  reopen(repo: unknown, key: unknown, ctx?: unknown): Promise<OpOutcome>;
  comment(repo: unknown, key: unknown, body: unknown, ctx?: unknown): Promise<OpOutcome>;
  update(repo: unknown, key: unknown, patch: unknown, ctx?: unknown): Promise<OpOutcome>;
  setLabels(repo: unknown, key: unknown, labels: unknown, f?: unknown, ctx?: unknown): Promise<OpOutcome>;
  setAssignees(repo: unknown, key: unknown, assignees: unknown, f?: unknown, ctx?: unknown): Promise<OpOutcome>;
}

/** 这次调用的预算：总上限、收尾余量、单次钳制与起算时刻。 */
export interface BudgetInfo {
  timeoutMs: number;
  marginMs: number;
  perOpTimeoutMs: number;
  startedAt: number;
}

/** 本层对外交出的执行上下文：工具拿 tracker 调后端，拿 memo 给房间读，拿预算口判断该不该继续。 */
export interface CallScope {
  tracker: DeckTrackerLike | null;
  opCtx: Record<string, unknown>;
  memo: CallMemo;
  budget: BudgetInfo;
  remainingMs(): number;
  outOfBudget(): boolean;
  execOp(label: string, fn: (ctx: Record<string, unknown>) => unknown): Promise<OpRecord>;
  ok: boolean;
}

/** 本层的入参选项：测试注入小预算与假时钟就靠它，生产一律走缺省。 */
export interface CallScopeOpts {
  timeoutMs?: unknown;
  marginMs?: unknown;
  perOpTimeoutMs?: unknown;
  /** 预算起算点（工具入口那一刻，选后端、探沙箱之前）；不传就按建壳这一刻算（老口径）。 */
  startedAt?: unknown;
  now?: () => number;
  sleep?: SleepFn;
}

/** 单次调用的内部记录：成功带回执，失败带是哪一支失败（超时/中止/被拒/抛错）。 */
type OpRecord =
  | { ok: true; result: unknown }
  | { ok: false; timeout?: true; aborted?: true; refused?: string; error?: unknown; result?: unknown };

function num(v: unknown, d: number): number { const n = (typeof v === 'number' && isFinite(v)) ? v : NaN; return isNaN(n) ? d : n }

/** 缺省等待口：可中止的真定时器。到点或收到中止都放行一次；中止时把定时器清掉，不留尾巴。
 *  定时器一律 unref（#1114 的实测教训）：它只负责「到点提醒」，不该成为进程活下去的理由——
 *  赢的那一方到了没清它时，进程也能照常退出。**但这不等于「有活干时进程自己就活着」**：一场还没结算的
 *  调用如果只剩这笔等待在手，Node 会带着它收摊（#1157 实测 54 毫秒、退出码 0），所以那一整段
 *  由 in-flight-lease.ts 的存活租约圈住，见下面 execOp 里那句注释。
 *  单次远端调用的钳制计时走它，测试注入假时钟就能把「钳到点」那条路走通，不必真等 30 秒。
 *  为什么必须继续用全局 setTimeout：别的会话（#1052 两房）会把它换成假时钟来压缩等待；
 *  一旦把 setTimeout 捕获进模块级常量，压缩就失效了。 */
function realSleep(ms: number, signal?: AbortLike | null): Promise<void> {
  return new Promise<void>(function (resolve) {
    let done = false
    const finish = function (): void { if (done) return; done = true; resolve() }
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      timer = setTimeout(finish, ms)
      const t = timer as unknown as { unref?: () => void }
      if (t && typeof t.unref === 'function') { try { t.unref() } catch (e) {} }
    } catch (e) {}
    if (signal && typeof signal.addEventListener === 'function') {
      try {
        signal.addEventListener('abort', function () {
          try { if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer) } catch (e) {}
          finish()
        }, { once: true })
      } catch (e) {}
    }
  })
}

/** 取一个取消控制器：环境里没有 AbortController 时回 null（此时单次调用没有硬中止，只剩预算拦发）。 */
function newAbort(): AbortControllerLike | null {
  const g = globalThis as unknown as { AbortController?: new () => AbortControllerLike }
  return (typeof g.AbortController === 'function') ? new g.AbortController() : null
}


function timeoutResult(): OpOutcome {
  return { ok: false, error: { kind: 'timeout', message: '这一次远端调用在限时内没回来，是否生效说不清：先按返回里说的办法核对现状再续，不要直接重放写操作。' } }
}
function abortedResult(): OpOutcome {
  return { ok: false, error: { kind: 'aborted', message: '这次调用被中止了，没做完就是没做：按需重调一次即可。' } }
}
function budgetResult(): OpOutcome {
  return { ok: false, error: { kind: 'over-budget', message: '剩余额度不够再发一次远端调用了，这次没动手：带同样参数重调一次即可接着做。' } }
}

/**
 * 给一次工具调用包一层执行上下文。
 * c：壳给的调用上下文（tracker / opCtx / now，缺 tracker 则 scope.ok 为假）。
 * exec：工具 run 收到的 exec（只为取调用方取消信号，拿不到就当没有）。
 * opts：{ timeoutMs, marginMs, perOpTimeoutMs, startedAt, now, sleep } 全可选，测试注入小预算与假时钟就靠它。
 */
export function withCallScope(c: unknown, exec?: unknown, opts?: CallScopeOpts): CallScope {
  const o = opts || {}
  const cc = (c || {}) as UnknownRecord
  const real = (cc.tracker || null) as BackendLike | null
  const nowFn: () => number = (typeof o.now === 'function') ? o.now : ((typeof cc.now === 'function') ? cc.now as () => number : Date.now)
  // 等待口：opts 优先、其次是壳给的调用上下文、最后才是真定时器，与 now 的三级回退同款。
  const sleepFn: SleepFn = (typeof o.sleep === 'function') ? o.sleep : ((typeof cc.sleep === 'function') ? cc.sleep as SleepFn : realSleep)
  const budget: BudgetInfo = {
    timeoutMs: num(o.timeoutMs, DEFAULT_TOOL_TIMEOUT_MS),
    marginMs: num(o.marginMs, DEFAULT_TOOL_MARGIN_MS),
    perOpTimeoutMs: num(o.perOpTimeoutMs, DEFAULT_PER_OP_TIMEOUT_MS),
    // 起算点是工具入口（选后端、探沙箱之前那一刻），不是建壳这一刻（#1195）：
    // 入口前耗时也要算进预算；没传就按老口径；传了未来的值按现在算，不倒欠。
    startedAt: (typeof o.startedAt === 'number' && isFinite(o.startedAt)) ? Math.min(o.startedAt, nowFn()) : nowFn(),
  }
  const execRec = (exec || {}) as UnknownRecord
  const rawSignal = execRec.signal
  const callerSignal: AbortLike | null = (rawSignal && typeof rawSignal === 'object') ? rawSignal as AbortLike : null
  const memo = createCallMemo()
  const baseOpCtx: Record<string, unknown> = Object.assign({}, (cc.opCtx || {}) as UnknownRecord)
  baseOpCtx.memo = memo
  if (callerSignal) baseOpCtx.signal = callerSignal

  function remainingMs(): number { return Math.max(0, budget.startedAt + budget.timeoutMs - nowFn()) }
  function outOfBudget(): boolean { return remainingMs() <= budget.marginMs }

  async function execOp(label: string, fn: (ctx: Record<string, unknown>) => unknown): Promise<OpRecord> {
    void label
    if (outOfBudget()) return { ok: false, refused: 'budget' }
    if (callerSignal && callerSignal.aborted === true) return { ok: false, refused: 'aborted' }
    const clamp = Math.min(budget.perOpTimeoutMs, Math.max(1, remainingMs() - budget.marginMs))
    const ctrl = newAbort()
    const sig = ctrl ? ctrl.signal : null
    let onCaller: (() => void) | null = null
    if (callerSignal && typeof callerSignal.addEventListener === 'function' && ctrl) {
      const handle = ctrl
      onCaller = function () { try { handle.abort() } catch (e) {} }
      try { callerSignal.addEventListener('abort', onCaller, { once: true }) } catch (e) {}
    }
    let timedOut = false
    let stopWait: (() => void) | null = null
    try {
      if (ctrl) {
        // 钳制计时走等待口（缺省真定时器）：到点就标超时并中止这次调用。
        // 这次调用自己先回来时，用 stopWait 把等待叫停——注入等待口之后不再靠 clearTimeout
        // 清尾巴，改成发中止信号，语义与原来一致（等不到就不等，不留一个跑到最后才醒的定时器）。
        const handle = ctrl
        const waitCtrl = newAbort()
        stopWait = function () { try { if (waitCtrl) waitCtrl.abort() } catch (e) {} }
        Promise.resolve(sleepFn(clamp, waitCtrl ? waitCtrl.signal : undefined)).then(function () {
          if (stopWait === null) return
          timedOut = true
          try { handle.abort() } catch (e) {}
        }, function () {})
      }
      const ctx2 = sig ? Object.assign({}, baseOpCtx, { signal: sig }) : baseOpCtx
      // #1157：等这次调用回来 = 这场调用还没结算，整段圈进存活租约。缺了它，被抓的那次调用
      // 只剩钳制那笔 unref 过的等待时（#1114），进程会带着这次调用收摊——调用方永远等不到回执，
      // 契约层记的 timeout / aborted 只会随进程一起消失。
      const result = await withInFlightLease(function () { return fn(ctx2) })
      if (timedOut) return { ok: false, timeout: true, result: result }
      if (sig && sig.aborted) return { ok: false, aborted: true, result: result }
      return { ok: true, result: result }
    } catch (e) {
      if (timedOut) return { ok: false, timeout: true, error: e }
      if (sig && sig.aborted) return { ok: false, aborted: true, error: e }
      return { ok: false, error: e }
    } finally {
      const stop = stopWait
      stopWait = null
      try { if (stop) stop() } catch (e) {}
      try { if (callerSignal && onCaller && typeof callerSignal.removeEventListener === 'function') callerSignal.removeEventListener('abort', onCaller) } catch (e) {}
    }
  }

  function mapOpOutcome(r: OpRecord): OpOutcome {
    if (r.ok) return r.result as OpOutcome
    if (r.timeout) return timeoutResult()
    if (r.aborted || r.refused === 'aborted') return abortedResult()
    if (r.refused === 'budget') return budgetResult()
    const err = (r.error || null) as UnknownRecord | null
    return { ok: false, error: { kind: 'backend-threw', message: '这一次远端调用抛错了（已拦下）：' + String((err && err.message) || r.error || '未知').slice(0, 200) } }
  }

  function memoGet(kind: string, key: string): OpOutcome | null {
    const e = memo.store.get(kind + '|' + key)
    return (e && e.seq === memo.seq) ? (e.result as OpOutcome) : null
  }
  function memoPut(kind: string, key: string, result: OpOutcome, members?: unknown): void {
    memo.store.set(kind + '|' + key, { seq: memo.seq, result: result, members: isArr(members) ? members.map(String) : null })
  }
  function noTracker(): OpOutcome {
    return { ok: false, error: { kind: 'backend-threw', message: '这次没拿到后端实现，我没往下做。' } }
  }

  // 写穿透共用（新增七个操作中的六个写操作）：无记忆缓存，成功只脏该票
  // （与 setParent/setBlockedBy 同形）；超时与中止的回执与现有六个一字同形。
  async function writeThru(op: string, repo: unknown, key: unknown, invoke: (ctx: Record<string, unknown>) => unknown): Promise<OpOutcome> {
    if (!real || !real[op]) return noTracker()
    const out = mapOpOutcome(await execOp(op, function (c2) { return invoke(c2) }))
    if (out && out.ok === true) rosterDirty(memo, repo, [String(key)])
    return out
  }

  let tracker: DeckTrackerLike | null = null
  if (real) {
    tracker = {
      get: async function (repo: unknown, key: unknown, f?: unknown, ctx?: unknown): Promise<OpOutcome> {
        void ctx
        const k = repoIdOf(repo) + '|' + String(key)
        const hit = memoGet('get', k)
        if (hit) return hit
        const out = mapOpOutcome(await execOp('get', function (c2) { return real.get!(repo, key, f || {}, c2) }))
        if (out && out.ok === true && out.data) { memoPut('get', k, out); rosterUpsert(memo, out.data) }
        return out
      },
      list: async function (repo: unknown, filter?: unknown, ctx?: unknown): Promise<ListOpOutcome> {
        void ctx
        const k = repoIdOf(repo) + '|' + canon(filter || {})
        const hit = memoGet('list', k)
        if (hit) return hit
        const out: ListOpOutcome = mapOpOutcome(await execOp('list', function (c2) { return real.list!(repo, filter || {}, c2) }))
        if (out && out.ok === true && isArr(out.data)) {
          // 后端列表被上限截断过、或走了 REST 降级通道（#1304）：这份数据不能当整仓收进名册，
          // 否则名册的读者会拿不全的索引静默少边（成环检查会因此把真环判成没有）。
          // 两个条件都看：truncated 是房间给的显式事实，fallback === 'rest' 是兜底防线。
          const completeList = out.truncated !== true && out.fallback !== 'rest'
          memoPut('list', k, out, rosterAdoptList(memo, out.data, filter, { complete: completeList }))
        }
        return out
      },
      getDependencies: async function (repo: unknown, key: unknown, f?: unknown, ctx?: unknown): Promise<OpOutcome> {
        void ctx
        const k = repoIdOf(repo) + '|' + String(key)
        const hit = memoGet('deps', k)
        if (hit) return hit
        const out = mapOpOutcome(await execOp('deps', function (c2) { return real.getDependencies!(repo, key, f || {}, c2) }))
        if (out && out.ok === true && out.data) {
          memoPut('deps', k, out)
          rosterUpsert(memo, { key: String(key), blockedBy: (out.data as UnknownRecord).blockedBy })
        }
        return out
      },
      create: async function (repo: unknown, input?: unknown, ctx?: unknown): Promise<OpOutcome> {
        void ctx
        if (!real.create) return noTracker()
        const out = mapOpOutcome(await execOp('create', function (c2) { return real.create!(repo, input, c2) }))
        if (out && out.ok === true) rosterAddCreated(memo, repo, out.data)
        return out
      },
      setParent: async function (repo: unknown, key: unknown, parent: unknown, f?: unknown, ctx?: unknown): Promise<OpOutcome> {
        void ctx
        if (!real.setParent) return noTracker()
        const out = mapOpOutcome(await execOp('setParent', function (c2) { return real.setParent!(repo, key, parent, f || {}, c2) }))
        if (out && out.ok === true) rosterDirty(memo, repo, [String(key)])
        return out
      },
      setBlockedBy: async function (repo: unknown, key: unknown, blockers: unknown, f?: unknown, ctx?: unknown): Promise<OpOutcome> {
        void ctx
        if (!real.setBlockedBy) return noTracker()
        const out = mapOpOutcome(await execOp('setBlockedBy', function (c2) { return real.setBlockedBy!(repo, key, blockers, f || {}, c2) }))
        if (out && out.ok === true) rosterDirty(memo, repo, [String(key)])
        return out
      },
      // 以下七个是本次补的钳制与预算口（deck_context/patch/create/report 在此之前直调后端，
      // 无单次钳制、无剩余额度检查，串行几个慢调用就撞上外层两分钟被掐）。形状与契约同形：
      // preflight 不记名册（环境探活次次真问）；六个写操作成功只脏该票，与上面两写同形。
      preflight: async function (handle: unknown, ctx?: unknown): Promise<OpOutcome> {
        void ctx
        if (!real.preflight) return noTracker()
        return mapOpOutcome(await execOp('preflight', function (c2) { return real.preflight!(handle, c2) }))
      },
      // #992：仓库写权限旁路（只读探活一次，次次真问；没有这个方法的后端诚实回未知，
      //   不走 backend-threw —— 缺方法不是执行层失败，调用方按未知处理）。
      getRepoPermissions: async function (repo: unknown, ctx?: unknown): Promise<OpOutcome> {
        void ctx
        if (!real.getRepoPermissions) return { ok: false, error: { kind: 'unsupported', message: '这个后端没有仓库写权限旁路，按未知处理' } }
        return mapOpOutcome(await execOp('repoPermissions', function (c2) { return real.getRepoPermissions!(repo, c2) }))
      },
      close: async function (repo: unknown, key: unknown, f?: unknown, ctx?: unknown): Promise<OpOutcome> {
        void ctx
        return writeThru('close', repo, key, function (c2) { return real.close!(repo, key, f || {}, c2) })
      },
      reopen: async function (repo: unknown, key: unknown, ctx?: unknown): Promise<OpOutcome> {
        void ctx
        return writeThru('reopen', repo, key, function (c2) { return real.reopen!(repo, key, c2) })
      },
      comment: async function (repo: unknown, key: unknown, body: unknown, ctx?: unknown): Promise<OpOutcome> {
        void ctx
        return writeThru('comment', repo, key, function (c2) { return real.comment!(repo, key, body, c2) })
      },
      update: async function (repo: unknown, key: unknown, patch: unknown, ctx?: unknown): Promise<OpOutcome> {
        void ctx
        return writeThru('update', repo, key, function (c2) { return real.update!(repo, key, patch, c2) })
      },
      setLabels: async function (repo: unknown, key: unknown, labels: unknown, f?: unknown, ctx?: unknown): Promise<OpOutcome> {
        void ctx
        return writeThru('setLabels', repo, key, function (c2) { return real.setLabels!(repo, key, labels, f || {}, c2) })
      },
      setAssignees: async function (repo: unknown, key: unknown, assignees: unknown, f?: unknown, ctx?: unknown): Promise<OpOutcome> {
        void ctx
        return writeThru('setAssignees', repo, key, function (c2) { return real.setAssignees!(repo, key, assignees, f || {}, c2) })
      },
    }
  }

  return {
    tracker: tracker,
    opCtx: baseOpCtx,
    memo: memo,
    budget: budget,
    remainingMs: remainingMs,
    outOfBudget: outOfBudget,
    execOp: execOp,
    ok: !!real,
  }
}
