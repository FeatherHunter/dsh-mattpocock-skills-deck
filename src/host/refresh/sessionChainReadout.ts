/**
 * src/host/refresh/sessionChainReadout.ts —— 把工作路线转成界面能读的一份读数（票 #721 T17 的宿主半边）
 *
 * 这一票（#721）的用户可见面是「每个会话在处理哪些票」那一块，它住在界面上
 * （src/client/views/shared/sessionChainView.js）；本文件是它要读的那份读数由谁产出。
 *
 * 为什么要有这一层，而不是把内存表直接扔给界面：
 *   1. 界面上能读到的只有快照回包里那几样东西，链本身（会话散列、工作区根散列、后端、票键、时间、
 *      动作类别）得有人挑一遍——挑哪几样、每样叫什么名字，只有一处说了算，免得两边各写一份形状；
 *   2. 这份读数要能明确地说自己没取到（ok:false 加上一个代号）。链不在、读的时候抛错、
 *      形状不对，都要说得出是哪一种：界面上那句「读不到」的判据就是这里的 ok 与 reason
 *     （不许让界面拿「空列表」冒充「没有人在处理票」）。
 *
 * 本文件是纯映射：不读盘、不联网、不看时钟（时刻由调用方传进来）、不记日志。它不 import 同层的
 * workRoute.ts（同层互引是仓库明令禁止的，门禁 tests/verify-dependency-rules.ts 会红），
 * 只要求调用方把一个「有 snapshot() 的对象」交进来——#714 的 createWorkRoute 返回值正好是它。
 *
 * 接线还没做（不属于本票的改动范围）：宿主组装快照回包时挂上这一个字段，界面才会真的画出来。
 * 那一步是一行，归统筹者（本条链的宿主接线归 #723 / T19 那批）：
 *
 *   const readout = buildSessionChainReadout({ tickets: workRoute, at: Date.now() })
 *   reply[SESSION_CHAIN_FIELD] = readout        // reply 就是 wf.snapshot 的回包
 *
 * 在那一行接上之前，界面会照实说「工作路线读不到」——那是事实，不是故障装饰。
 *
 * （2026-10-18 #1247 从 sessionChainReadout.js 转成 .ts：只加类型标注与注释，逻辑一行未动。
 * 导出形态保持一一对应，因为 src/host/refresh/wiring.ts 按具名引用这里的两个名字，
 * 改了名字那一侧的接线会直接断掉。）
 */

// ---------------------------------------------------------------------------
// 类型（#1247 转写：只写类型不写实现）。
//
// 为什么这样标：从外面进来的快照形状不可信（旧落盘、半截写入、测试手捏的夹具都可能进来），
// 所以入口按 any 收，收窄发生在下面每一处的形状判断里（Array.isArray、typeof、正则），
// 类型不替代那些运行时判断。读数回包的形状是界面与门禁的约定（ok 与 reason 是判据），
// 这里把四个字段写死，免得以后有人顺手多塞路径原文或命令原文进来。
// ---------------------------------------------------------------------------

/** 链上单条记录转给界面看的那一行：只有票键、工作单元、时刻与动作词，没有原文。 */
interface ChainReadoutEntry {
  ticketKey: string
  effortId: string
  at: number
  action: string
}

/** 一个会话那一格：会话只以散列出现，条目按时间倒序，空格不出现。 */
interface ChainReadoutSession {
  shardId: string
  backend: string
  entries: ChainReadoutEntry[]
}

/** 读数回包的完整形状：成功与失败都是同一张脸，界面不用猜。 */
interface SessionChainReadout {
  ok: boolean
  at: number
  reason: string
  sessions: ChainReadoutSession[]
}

/** 有 snapshot() 的那一侧（#714 的 createWorkRoute 返回值正好是它，本文件只读这一格）。 */
interface TicketsPort {
  snapshot(): unknown
}

/** buildSessionChainReadout 的入参：时刻由调用方传进来，本文件不看时钟。 */
interface ReadoutInput {
  at?: unknown
  tickets?: TicketsPort | null
}

/** 宿主把这份读数挂在快照回包的哪个字段上（界面那一半读的就是这个名字，门禁核对两边相等）。 */
export const SESSION_CHAIN_FIELD = 'workRoute'

/** 票键的形状（与链一侧的 key 同形：纯数字串）。这里只做形状检查，不重新归一。 */
function keyLike(v: unknown): string {
  const t = (v === null || v === undefined) ? '' : String(v).trim()
  return /^\d{1,10}$/.test(t) ? t : ''
}

function atOf(v: unknown): number {
  return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : 0
}

function entriesOf(raw: unknown): ChainReadoutEntry[] {
  const list: any[] = Array.isArray(raw) ? raw : []
  const out: ChainReadoutEntry[] = []
  for (let i = 0; i < list.length; i++) {
    const e: any = list[i]
    const key = keyLike(e ? e.ticketKey : '')
    if (!key) continue
    const effort = (e && (e.effortId === null || e.effortId === undefined)) ? '' : String(e ? e.effortId : '')
    out.push({
      ticketKey: key,
      effortId: effort,
      at: atOf(e ? e.at : 0),
      action: (e && e.action !== null && e.action !== undefined) ? String(e.action) : '',
    })
  }
  return out
}

/** 一格链里最新那条的时刻（用来把「最近还在动」的会话排在前面）；没有条目就是 0。 */
function newestAt(session: any): number {
  let best = 0
  const rows: any[] = session && Array.isArray(session.entries) ? session.entries : []
  for (let i = 0; i < rows.length; i++) if (rows[i].at > best) best = rows[i].at
  return best
}

/**
 * 产出界面要读的那份读数。返回的一定是这一个形状（四种情况都长得一样，界面不用猜）：
 *
 *   { ok: true,  at, reason: 'host.chain.ok'|'host.chain.empty', sessions: [...] }
 *   { ok: false, at, reason: 'host.chain.absent'|'host.chain.read-failed'|'host.chain.shape', sessions: [] }
 *
 * `sessions` 一格一个会话：`{ shardId, backend, entries: [{ ticketKey, effortId, at, action }] }`。
 * 里面没有会话 id 原文、没有路径、没有命令、没有票标题：会话只以它那一格散列出现
 * （链从落地起就只留散列，界面显示散列前 8 位），标题由界面从它已经拿到的票列表里查。
 * #783：每条带着它自己的工作单元（目录名；单工作单元后端、扁平布局、远端、老记录都是空串）。
 * 顺序按「这一格最新一条的时刻」从新到旧排；空的一格不出现。
 */
export function buildSessionChainReadout(input: ReadoutInput | null | undefined): SessionChainReadout {
  const at = atOf(input ? input.at : 0)
  const tickets = (input && input.tickets) ? input.tickets : null
  if (!tickets || typeof tickets.snapshot !== 'function') {
    return { ok: false, at: at, reason: 'host.chain.absent', sessions: [] }
  }
  let shards: any = null
  try {
    shards = tickets.snapshot()
  } catch (e) {
    return { ok: false, at: at, reason: 'host.chain.read-failed', sessions: [] }
  }
  if (!Array.isArray(shards)) return { ok: false, at: at, reason: 'host.chain.shape', sessions: [] }
  const sessions: ChainReadoutSession[] = []
  for (let i = 0; i < shards.length; i++) {
    const s: any = shards[i]
    if (!s || typeof s !== 'object') continue
    const shardId = (s.shardId === null || s.shardId === undefined) ? '' : String(s.shardId)
    if (!shardId) continue
    const entries = entriesOf(s.entries)
    if (!entries.length) continue
    sessions.push({
      shardId: shardId,
      backend: (s.backend === null || s.backend === undefined) ? '' : String(s.backend),
      entries: entries,
    })
  }
  sessions.sort(function (a: ChainReadoutSession, b: ChainReadoutSession): number { return newestAt(b) - newestAt(a) })
  return { ok: true, at: at, reason: sessions.length ? 'host.chain.ok' : 'host.chain.empty', sessions: sessions }
}
