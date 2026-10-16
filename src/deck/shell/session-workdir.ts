// src/deck/shell/session-workdir.ts —— 会话目录归一（#934 工作区钥匙单源；#1040 转 TypeScript）
//
// 住共享层（src/deck/shell/），九个工具直接引用它；本树内部只有一处导入——进程存活租约
// （#1157，等归一这段算一场没结算的活）；其余最小工具自带一份，不引同层别的文件。
// 归一出口 canonicalKey 由宿主注入（归一加锚根只有那一份实现）；缺席时沿用原始目录（旧门禁兼容）。
// 归一在场却算不出规范根时如实失败，不凑钥匙——超时、抛错、空结果走同一条路，不新增语义。
//
// 时钟：等待上限走注入的等待口 sleep（缺省真定时器）。为什么要能注入：这条 5 秒竞速平时从不走到，
// 只有对手挂住时才会发生；不给假时钟的入口，测试想验这一支就得真等 5 秒。生产行为一字不变。
//
// 本文件的返回形状是「两支合一」：ok 为真那支带 cwd/workspaceKey/sessionId/source（source 是
// 从 exec 的哪一格取到的目录，排错用），ok 为假那支带机器码 reason 与给 AI 看的 text。
// 调用方按 ok 分两支之后，各自的字段才是可用的——这是本文件给出去的唯一契约。

import { withInFlightLease } from './in-flight-lease.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { CANONICAL_TIMEOUT_MS } from '../../shared/time-config/values.js'

/** 外层递进来的东西都是未知形状（exec 由 DSH 给、deps 由工具与测试拼），逐格验，不猜。 */
type UnknownRecord = Record<string, unknown>;

/** 本文件要的依赖：归一出口与工作区键算法由宿主注入；sleep 只给测试换假时钟用。 */
export interface SessionWorkdirDeps {
  /**
   * 归一出口：把任意目录归一到工作区根；缺席时沿用原始目录。
   * 按 unknown 收：工具与测试各自那份依赖袋把这两格声明成 unknown（形状由宿主定），
   * 这里写成函数签名会让它们当场赋不进来。用之前验是不是函数 —— 本文件本来就这么写。
   */
  canonicalKey?: unknown;
  /** 工作区键算法：宿主那份归一加锚根的唯一实现；缺席时用本文件自带的短散列。同上一格，按 unknown 收。 */
  workspaceKeyOf?: unknown;
  /** 等待口：等多少毫秒；缺省真定时器。只有这里碰全局时钟。 */
  sleep?: (ms: number) => Promise<unknown>;
}

/** 拿不到会话目录，或规范根算不出来：reason 是机器码，text 是原样交给 AI 的那句话。 */
export interface SessionContextFailure {
  ok: false;
  reason: string;
  sessionId: string;
  text: string;
}

/** 拿到会话目录：rawCwd 只在「归一之后与取到的原文不同」时出现（留原文是给排错看）。 */
export interface SessionContextSuccess {
  ok: true;
  cwd: string;
  workspaceKey: string;
  sessionId: string;
  source: string;
  text: string;
  rawCwd?: string;
}

/** 两种结论合一：调用方先看 ok，再看各自那支的字段。 */
export type SessionContextResult = SessionContextSuccess | SessionContextFailure;

/** 竞速结论：原样带回，或如实失败（超时与抛错不区分，走同一条老路）。 */
type CapResult<T> = { ok: true; value: T } | { ok: false; timedOut?: boolean };

function str(v: unknown): string { return (typeof v === 'string') ? v : '' }
function hash8(t: unknown): string {
  let h = 5381
  const s = String(t || '')
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0)
  return ('0000000' + h.toString(16)).slice(-8)
}

const NO_SESSION = 'no-session-context'
// 归一等待上限（毫秒）：对手是挂住的文件服务。

// 缺省等待口：真定时器。到点或被喊停都清掉定时器；定时器一律 unref（#1114 的实测教训）——
// 一个只负责「到点提醒」的定时器不该成为进程活下去的理由。
// 生产就靠它；测试注入 sleep 之后这一行不会被走到。
function realSleep(ms: number): Promise<unknown> {
  return new Promise(function (resolve) {
    let timer: ReturnType<typeof setTimeout> | null = null
    let done = false
    const finish = function (): void {
      if (done) return
      done = true
      if (timer !== null) { try { clearTimeout(timer) } catch (e) {} timer = null }
      resolve(null)
    }
    try {
      timer = setTimeout(finish, ms)
      const t = timer as unknown as { unref?: () => void }
      if (t && typeof t.unref === 'function') { try { t.unref() } catch (e) {} }
    } catch (e) { finish() }
  })
}

/** 算不出规范根时的同一句回执：三处调用点（超时、抛错、空结果）逐字同形，收成一个。 */
function canonicalFailure(sessionId: string): SessionContextFailure {
  return { ok: false, reason: NO_SESSION, sessionId: sessionId, text: '这次没能把工作区目录归一到工作区根，所以我不动任何票。' }
}

/** 给一个承诺加竞速上限：到点如实失败，不抛（与「算不出就失败」同一条纪律）。 */
function withCap<T>(promise: Promise<T>, ms: number, sleep: (ms: number) => Promise<unknown>): Promise<CapResult<T>> {
  // #1157：归一还没出结果就算一场活，先扣一份存活租约。这里的等待口 unref 过（#1114），
  // 文件服务真挂住时唯一活着的东西就是这笔等待；没有租约进程会带着这场竞速收摊，归一永远不结算。
  return withInFlightLease(function () {
    return Promise.race([
      Promise.resolve(promise).then(function (v: T): CapResult<T> { return { ok: true, value: v } }, function (): CapResult<T> { return { ok: false } }),
      sleep(ms).then(function (): CapResult<T> { return { ok: false, timedOut: true } }),
    ])
  })
}

/**
 * 从 exec 里取会话目录（同步版，不归一）。取法只有一份：按优先级挨个格子看，
 * 第一个非空字符串就是答案，并把「从哪一格取到的」一起回报（source），方便日后排错。
 */
export function sessionContextOf(exec: unknown, deps?: SessionWorkdirDeps): SessionContextResult {
  const e = (exec || {}) as UnknownRecord
  const d = deps || {}
  const agent = (e.agent || {}) as UnknownRecord
  const session = (agent.session || e.session || null) as UnknownRecord | null
  const cands = [
    { where: 'exec.agent.session.cwd', value: session && session.cwd },
    { where: 'exec.agent.session.workspaceRoot', value: session && session.workspaceRoot },
    { where: 'exec.agent.session.workspace.cwd', value: session && session.workspace && (session.workspace as UnknownRecord).cwd },
    { where: 'exec.agent.cwd', value: agent.cwd },
    { where: 'exec.session.cwd', value: e.session && (e.session as UnknownRecord).cwd },
    { where: 'exec.cwd', value: e.cwd },
  ]
  let cwd = ''
  let source = ''
  for (const c of cands) {
    if (typeof c.value === 'string' && c.value.trim()) { cwd = c.value.trim(); source = c.where; break }
  }
  const sessionId = str(session && (session.id || session.sessionId)) || str(agent.sessionId)
  if (!cwd) return { ok: false, reason: NO_SESSION, sessionId: sessionId, text: '这次没拿到当前会话的工作区目录，所以我不动任何票。' }
  const key = typeof d.workspaceKeyOf === 'function' ? String(d.workspaceKeyOf(cwd)) : ('ws-' + hash8(cwd))
  return { ok: true, cwd: cwd, workspaceKey: key, sessionId: sessionId, source: source, text: '' }
}

/**
 * 会话目录的异步版：先把同步那份取到，再在有归一出口时把目录归一到工作区根，
 * 并用归一后的根重算工作区键（键必须按规范根算，否则同一目录两种写法会算出两个键）。
 * 归一缺席、算不出、超时，一律如实失败，不凑钥匙、不沿用原文。
 */
export async function sessionContextOfAsync(exec: unknown, deps?: SessionWorkdirDeps): Promise<SessionContextResult> {
  const base = sessionContextOf(exec, deps || {})
  if (!base.ok) return base
  const d = deps || {}
  const raw = base.cwd
  // 归一出口先验是不是函数，再收成一个局部常量：属性上的收窄带不进下面的闭包，
  // 收成 const 之后闭包里直接调，不必再写一个只为让编译器安静的断言。
  const canonicalKey = (typeof d.canonicalKey === 'function') ? (d.canonicalKey as (cwd: string) => unknown) : null
  if (!canonicalKey) return base
  // 等待口：deps.sleep 缺席就用真定时器（生产默认），与 now 的缺席回退同款。
  const sleep = (typeof d.sleep === 'function') ? d.sleep : realSleep
  let canon: unknown = ''
  try {
    // 调用递延进 promise 链：同步抛错也变成拒绝，走下面同一条如实失败路，
    // 与原来 try/await 同形（原来同步抛错也被 catch 接住）。
    const raced = await withCap(Promise.resolve().then(function () { return canonicalKey(raw) }), CANONICAL_TIMEOUT_MS, sleep)
    // 超时、抛错都按算不出规范根走老路：如实失败，不凑钥匙、不沿用原文。
    if (raced.ok !== true) return canonicalFailure(base.sessionId)
    canon = raced.value
  } catch (e) { return canonicalFailure(base.sessionId) }
  if (typeof canon !== 'string' || !canon.trim()) return canonicalFailure(base.sessionId)
  const root = canon.trim()
  if (root === raw) return base
  const key = typeof d.workspaceKeyOf === 'function' ? String(d.workspaceKeyOf(root)) : ('ws-' + hash8(root))
  return { ok: true, cwd: root, rawCwd: raw, workspaceKey: key, sessionId: base.sessionId, source: base.source, text: '' }
}
