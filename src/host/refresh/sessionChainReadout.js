/**
 * src/host/refresh/sessionChainReadout.js —— 把处理链转成界面能读的一份读数（票 #721 T17 的宿主半边）
 *
 * 这一票（#721）的用户可见面是「每个会话在处理哪些票」那一块，它住在界面上
 * （src/client/views/shared/sessionChainView.js）；本文件是它要读的那份**读数**由谁产出。
 *
 * 为什么要有这一层，而不是把内存表直接扔给界面：
 *   1. 界面能读到的只有快照回包里那几样东西，链本身（会话散列、工作区根散列、后端、票键、时间、
 *      动作类别）得有人挑一遍——挑哪几样、每样叫什么名字，只有一处说了算，免得两边各写一份形状；
 *   2. 这份读数要能**明确地说自己没取到**（ok:false 加上一个代号）。链不在、读的时候抛错、
 *      形状不对，都要说得出是哪一种：界面上那句「读不到」的判据就是这里的 ok 与 reason
 *      （不许让界面拿「空列表」冒充「没有人在处理票」）。
 *
 * 本文件是纯映射：不读盘、不联网、不看时钟（时刻由调用方传进来）、不记日志。它不 import 同层的
 * sessionTickets.js（同层互引是仓库明令禁止的，门禁 tests/verify-no-same-layer-import.js 会红），
 * 只要求调用方把一个「有 snapshot() 的对象」交进来——#714 的 createSessionTickets 返回值正好是它。
 *
 * **接线还没做（不属于本票的改动范围）**：宿主组装快照回包时挂上这一个字段，界面才会真的画出来。
 * 那一步是一行，归统筹者（本条链的宿主接线归 #723 / T19 那批）：
 *
 *   const readout = buildSessionChainReadout({ tickets: sessionTickets, at: Date.now() })
 *   reply[SESSION_CHAIN_FIELD] = readout        // reply 就是 wf.snapshot 的回包
 *
 * 在那一行接上之前，界面会照实说「处理链读不到」——那是事实，不是故障装饰。
 */

/** 宿主把这份读数挂在快照回包的哪个字段上（界面那一半读的就是这个名字，门禁核对两边相等）。 */
export const SESSION_CHAIN_FIELD = 'sessionTickets'

/** 票键的形状（与链一侧的 key 同形：纯数字串）。这里只做形状检查，不重新归一。 */
function keyLike(v) {
  const t = (v === null || v === undefined) ? '' : String(v).trim()
  return /^\d{1,10}$/.test(t) ? t : ''
}

function atOf(v) {
  return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : 0
}

function entriesOf(raw) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    const key = keyLike(e ? e.ticketKey : '')
    if (!key) continue
    out.push({
      ticketKey: key,
      at: atOf(e ? e.at : 0),
      action: (e && e.action !== null && e.action !== undefined) ? String(e.action) : '',
    })
  }
  return out
}

/** 一格链里最新那条的时刻（用来把「最近还在动」的会话排在前面）；没有条目就是 0。 */
function newestAt(session) {
  let best = 0
  const rows = session && Array.isArray(session.entries) ? session.entries : []
  for (let i = 0; i < rows.length; i++) if (rows[i].at > best) best = rows[i].at
  return best
}

/**
 * 产出界面要读的那份读数。返回的一定是这一个形状（四种情况都长得一样，界面不用猜）：
 *
 *   { ok: true,  at, reason: 'host.chain.ok'|'host.chain.empty', sessions: [...] }
 *   { ok: false, at, reason: 'host.chain.absent'|'host.chain.read-failed'|'host.chain.shape', sessions: [] }
 *
 * `sessions` 一格一个会话：`{ shardId, backend, entries: [{ ticketKey, at, action }] }`。
 * 里面**没有会话 id 原文、没有路径、没有命令、没有票标题**：会话只以它那一格散列出现
 * （链从落地起就只留散列，界面显示散列前 8 位），标题由界面从它已经拿到的票列表里查。
 * 顺序按「这一格最新一条的时刻」从新到旧排；空的一格不出现。
 */
export function buildSessionChainReadout(input) {
  const at = atOf(input ? input.at : 0)
  const tickets = (input && input.tickets) ? input.tickets : null
  if (!tickets || typeof tickets.snapshot !== 'function') {
    return { ok: false, at: at, reason: 'host.chain.absent', sessions: [] }
  }
  let shards = null
  try {
    shards = tickets.snapshot()
  } catch (e) {
    return { ok: false, at: at, reason: 'host.chain.read-failed', sessions: [] }
  }
  if (!Array.isArray(shards)) return { ok: false, at: at, reason: 'host.chain.shape', sessions: [] }
  const sessions = []
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i]
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
  sessions.sort(function (a, b) { return newestAt(b) - newestAt(a) })
  return { ok: true, at: at, reason: sessions.length ? 'host.chain.ok' : 'host.chain.empty', sessions: sessions }
}
