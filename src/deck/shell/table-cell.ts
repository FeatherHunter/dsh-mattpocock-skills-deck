// src/deck/shell/table-cell.ts —— 宿主那张表在同一进程里的共享格（#758；#1040 转 TypeScript）
//
// 只讲一件事：行与宿主跑在同一个进程里（同一份组合、同一份工具注册表，
// 预设行经作用域读全局层，见上游 web-app 组合注释），所以宿主装好的那张表
// 不需要经任何调用面递过去——宿主把它放进这一格，行直接来取。
// 若两边真不在同一进程（旧桌面那种），这一格永远是空的，行按原路退回，
// 一行老行为都不变。
//
// 本树内部只有一处导入：进程存活租约（#1157，等表装好这段算一场没结算的活）；其余最小工具自带一份，不引同层别的文件。
// 状态只有三种：empty（宿主还没放）、pending（放了还没装好）、ready（装好了）。
// pid 只在进程内比对，永不外发（探针只报比对结果的布尔值）。
// 另附一小段闸口径迹：壳把每次裁决的机器码（阶段、结论、原因枚举）记在这里，
// 探针读走，线上卡在哪一段一眼可见。正文与路径一律不记。

import { withInFlightLease } from './in-flight-lease.js'

/** 格子的三种状态：宿主还没放、放了还没装好、装好了。 */
type CellState = 'empty' | 'pending' | 'ready';

/** 别人递进来的「装表承诺」只按形状验：有 then 函数即可，不要求真是 Promise 实例。 */
interface Thenable {
  then(onOk: () => void, onErr: () => void): unknown;
}

/** 一格裁决口径迹：三段都是机器码，白名单外的词一律归一成空串。 */
interface GateNote {
  phase: string;
  verdict: string;
  reason: string;
}

/** 等表装好时可注入的等待口（测试换假时钟用）。 */
export interface DeckTableWaitOpts {
  sleep?: (ms: number) => Promise<unknown>;
}

const cell: { state: CellState; promise: unknown; hostPid: number } = {
  state: 'empty',
  promise: null,
  hostPid: 0,
}

/**
 * 取当前进程号：Node 有 process.pid，其它环境（浏览器壳、测试沙箱）没有——一律回 0。
 * 为什么不直接写 process.pid：#1040 把本层圈进严格类型检查，而本层不装 @types/node，
 * 直接写 process 会被判「找不到名字」；从 globalThis 上按形状取，两种环境都不报错，
 * 判定条件与原来的 typeof process !== 'undefined' && typeof process.pid === 'number' 一致。
 */
function pidNow(): number {
  try {
    const g = globalThis as unknown as { process?: { pid?: unknown } }
    const p = g.process
    if (p && typeof p.pid === 'number') return p.pid
  } catch (e) {}
  return 0
}

/** 宿主接线装表时调一次：把装表那份承诺放进来（重复调只留第一次）。 */
export function publishDeckTable(tableP: unknown): void {
  try {
    if (cell.state !== 'empty') return
    const p = (tableP || null) as Thenable | null
    if (!p || typeof p.then !== 'function') return
    cell.state = 'pending'
    cell.promise = tableP
    cell.hostPid = pidNow()
    p.then(
      function () { try { if (cell.state === 'pending') cell.state = 'ready' } catch (e) {} },
      function () { try { if (cell.state === 'pending') cell.state = 'ready' } catch (e2) {} },
    )
  } catch (e3) {}
}

/** 同步看一眼：空就别等（对方进程根本没放），有才值得等。 */
export function peekDeckTable(): { state: CellState; sameProcess: boolean } | null {
  try {
    if (cell.state === 'empty' || !cell.promise) return null
    return { state: cell.state, sameProcess: cell.hostPid !== 0 && cell.hostPid === pidNow() }
  } catch (e) { return null }
}

// 缺省等待口：真定时器。到点或被喊停都清掉定时器；定时器一律 unref（#1114 的实测教训）——
// 一个只负责「到点提醒」的定时器不该成为进程活下去的理由。
// 只有这里碰全局时钟，注入 sleep 之后就绕开了它。
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

/**
 * 等表装好：超时就回空，调用方按原路退回，不抛。
 * opts.sleep 是等待口（缺省真定时器）：测试拿假时钟就能把「等不到」那条路走通。
 * 类型参数 T 给调用方点名「等到的表长什么样」用；不点名时按未知形状交回，
 * 因为这一格只负责把宿主放的东西原样递过去，不替调用方决定表的结构。
 */
export function awaitDeckTable<T = unknown>(timeoutMs?: number, opts?: DeckTableWaitOpts): Promise<T | null> {
  try {
    const peek = peekDeckTable()
    if (!peek) return Promise.resolve(null)
    const o = opts || {}
    const sleep = (typeof o.sleep === 'function') ? o.sleep : realSleep
    const cap = (typeof timeoutMs === 'number' && timeoutMs > 0) ? Math.floor(timeoutMs) : 25000
    // #1157：这家竞速还没结算，先扣一份存活租约。等待口是 unref 过的（#1114），宿主一直没装表时
    // 唯一活着的东西就是这笔等待；没有租约进程会带着它收摊，调用方永远等不到「没有表」这个结论。
    return withInFlightLease(function () {
      return Promise.race([
        Promise.resolve(cell.promise).then(function (t: unknown) { return (t as T) || null }, function () { return null }),
        sleep(cap).then(function () { return null }, function () { return null }),
      ])
    })
  } catch (e) { return Promise.resolve(null) }
}

const gateNotes: GateNote[] = []

/** 机器码白名单：小写字母开头，只含小写字母、数字与连字符，最长 64 个字符；其余回空串。 */
function cleanGateWord(v: unknown): string {
  try {
    const t = String(v || '')
    if (/^[a-z][a-z0-9-]{0,63}$/.test(t)) return t
    return ''
  } catch (e) { return '' }
}

/** 壳记一笔裁决口径：只收机器码（阶段、结论、原因枚举），正文路径一律不收。 */
export function noteDeckGate(info: unknown): void {
  try {
    const at = (info || {}) as Record<string, unknown>
    gateNotes.push({
      phase: cleanGateWord(at.phase),
      verdict: cleanGateWord(at.verdict),
      reason: cleanGateWord(at.reason),
    })
    while (gateNotes.length > 8) gateNotes.shift()
  } catch (e) {}
}

/** 读走口径迹（探针用）：只含机器码的数组副本。 */
export function readDeckGate(): GateNote[] {
  try { return gateNotes.map(function (n) { return { phase: n.phase, verdict: n.verdict, reason: n.reason } }) } catch (e) { return [] }
}

const lastPath: { tool: string; via: string } = { tool: '', via: '' }

/** 行记一笔这次走的哪条路（探针用）：工具名是自家的，路是四选一枚举。 */
export function noteDeckPath(tool: unknown, via: unknown): void {
  try {
    const t = (typeof tool === 'string' && tool) ? tool : ''
    const v = (via === 'cell' || via === 'connection' || via === 'fetch' || via === 'fallback') ? via : ''
    if (t && v) { lastPath.tool = t; lastPath.via = v }
  } catch (e) {}
}

/** 读走上次走的路（探针用）。 */
export function readDeckPath(): { tool: string; via: string } {
  try { return { tool: lastPath.tool, via: lastPath.via } } catch (e) { return { tool: '', via: '' } }
}
