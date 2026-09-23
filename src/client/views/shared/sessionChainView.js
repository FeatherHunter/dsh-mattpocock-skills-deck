/**
 * views/shared/sessionChainView.js — 「每个会话在处理哪些票」这一块的判据与画法（票 #721，T17）。
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
 * 的 leaf 标记处（一源两物）。画在右侧面板顶部那一条（views/panel/Dock.js 的正文最上面）。
 *
 * 这一块回答的是用户最初问的那句话。数据只有一个来源：**宿主自己写下的处理链读数**，
 * 挂在面板快照的 sessionTickets 字段上。链条本身是 #714 落地的（纯逻辑 refresh-core/src/chain.ts、
 * 宿主半 src/host/refresh/sessionTickets.js），把它转成这份读数的是
 * src/host/refresh/sessionChainReadout.js。
 *
 * 三条纪律，改这个文件的人先看这三条：
 *   1. **不在界面里推断谁在处理票**：不去读会话事件、不自己解析命令行、不自己拼链的键，也不去读
 *      那份落盘文件。这一半只认 st.snapshot 里那一个字段（字段名只有下面这一个常量）。
 *      tests/verify-chain-view.js 有一条静态断言盯着「界面没有第二个数据来源」这件事。
 *   2. **读不到就说读不到**（与 #715 同一条规矩）：宿主没写下这份读数、或写下时自己说没取到，
 *      这里就说读不到；绝不用 0、也不用一个空列表把它糊过去 —— 那等于把「不知道」说成
 *      「没有人在处理票」。反过来，宿主真说「取到了、就是没有」，这一块整块不画
 *      （票面要求：没有数据时不猜、不占位、不显示空框）。
 *   3. **话都在词条里**：这一块画的每一个字都来自词条（chainView.*），代码里一个中文字面量都不写
 *      （门禁扫代码里的中文串，写死的文案会让它红）。动作类别那几个词也一样，键集合必须与链的
 *      闭集合（chain.ts 的 CHAIN_ACTIONS，产物 src/shared/refresh/chain.js）逐个对上，
 *      门禁每次运行都对一遍：链上加了新类别而这里没跟上就红。
 *
 * 两件事界面上是「显示」不是「现算」：时间显示的是宿主记下的那一刻（条目里的 at，只做时分格式化）；
 * 票的标题是从面板已经拿到的票列表快照里按号码查出来的（不新增任何取数）——查不到就只显示号码，
 * 不编一个标题给它。
 */
export const SESSION_CHAIN_FIELD = 'sessionTickets'

/** 链的动作类别（闭集合）→ 词条键。键必须与 chain.ts 的 CHAIN_ACTIONS 逐个对上，门禁管这件事。 */
export const SESSION_CHAIN_ACTION_KEYS = {
  'create': 'chainView.action.create',
  'plan': 'chainView.action.plan',
  'comment': 'chainView.action.comment',
  'edit': 'chainView.action.edit',
  'state': 'chainView.action.state',
  'link': 'chainView.action.link',
  'file-write': 'chainView.action.file-write',
  'other-write': 'chainView.action.other-write',
}

/**
 * 一个动作类别代号挑哪个词条。认不出的代号返回空串 —— 调用方那时**照原样显示那个代号**，
 * 绝不回落到某个像样的词上（把不认识的类别说成「改状态」就是编事实）。
 */
export const sessionChainActionKeyOf = function (action) {
  const code = action === null || action === undefined ? '' : String(action)
  return Object.prototype.hasOwnProperty.call(SESSION_CHAIN_ACTION_KEYS, code) ? SESSION_CHAIN_ACTION_KEYS[code] : ''
}

const sessionChainAtOf = function (v) {
  return (typeof v === 'number' && isFinite(v) && v > 0) ? v : 0
}

/** 宿主记下的那一刻 → 本机的时分（只做格式化，不判断新旧：新鲜度那句话另有一处，见 truthLines.js）。 */
export const sessionChainClock = function (atMs) {
  const at = sessionChainAtOf(atMs)
  if (!at) return ''
  const d = new Date(at)
  const pad = function (n) { return (n < 10 ? '0' : '') + n }
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** 票键的形状检查：只收纯数字串。归一（去井号、去前导零）是链那一侧的事，这里不重做一遍。 */
const sessionChainTicketKeyOf = function (v) {
  const t = v === null || v === undefined ? '' : String(v).trim()
  return /^\d{1,10}$/.test(t) ? t : ''
}

/**
 * 取数路径：只读宿主写下的那一个字段，输出三种状态之一。
 *
 *   · `idle`      还没拿到面板快照（开关刚打开、正在取数）：什么都不说，也不占位。
 *   · `unreadable` 宿主没写下这份读数，或它自己说这次没取到：说读不到，并带上宿主给的代号。
 *   · `ok`        宿主说取到了：逐格收会话，形状不对的格子整格丢掉（宁可少显示，也不显示错的）。
 *
 * 判据一条也不在界面里现算：状态与原因都来自宿主写下的那两个字（ok 与 reason）。
 */
export const sessionChainViewOf = function (st) {
  const snap = (st && st.snapshot) ? st.snapshot : null
  if (!snap) return { state: 'idle', reason: '', at: 0, sessions: [] }
  const raw = snap[SESSION_CHAIN_FIELD]
  if (raw === null || raw === undefined) return { state: 'unreadable', reason: 'host.chain.absent', at: 0, sessions: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { state: 'unreadable', reason: 'host.chain.shape', at: 0, sessions: [] }
  const at = sessionChainAtOf(raw.at)
  if (raw.ok !== true) return { state: 'unreadable', reason: String(raw.reason || 'host.chain.not-ok'), at: at, sessions: [] }
  const list = Array.isArray(raw.sessions) ? raw.sessions : []
  const sessions = []
  for (let i = 0; i < list.length; i++) {
    const s = list[i]
    if (!s || typeof s !== 'object') continue
    const shardId = (s.shardId === null || s.shardId === undefined) ? '' : String(s.shardId)
    if (!shardId) continue
    const entries = Array.isArray(s.entries) ? s.entries : []
    const rows = []
    for (let j = 0; j < entries.length; j++) {
      const e = entries[j]
      const key = sessionChainTicketKeyOf(e ? e.ticketKey : '')
      if (!key) continue
      rows.push({
        ticketKey: key,
        action: (e && e.action !== null && e.action !== undefined) ? String(e.action) : '',
        at: sessionChainAtOf(e ? e.at : 0),
      })
    }
    if (!rows.length) continue
    sessions.push({ shardId: shardId, backend: (s.backend === null || s.backend === undefined) ? '' : String(s.backend), entries: rows })
  }
  return { state: 'ok', reason: '', at: at, sessions: sessions }
}

/**
 * 号码 → 这份列表快照里那张票的标题与 effort（标题只从已经拿到的数据里查，查不到就是空）。
 *
 * 这一份里那个字段叫 ticketTitle 而不是 title：界面代码里「title」这个名字已经被浏览器原生的
 * 悬停提示占住了，tests/verify-no-title.js 按文本扫它（5 处必卡，正打算把原生提示全换成 Tip）。
 * 数据字段跟着叫 ticketTitle，扫的人一眼就能分清「这是票的标题这份数据」与「这是被禁的原生提示」。
 */
const sessionChainTitlesOf = function (st) {
  const map = {}
  const snap = (st && st.snapshot) ? st.snapshot : null
  if (!snap) return map
  const put = function (x) {
    if (!x || typeof x !== 'object') return
    const n = sessionChainTicketKeyOf(x.number)
    if (!n || map[n]) return
    map[n] = {
      ticketTitle: (x.title === null || x.title === undefined) ? '' : String(x.title),
      effortId: (x.effortId === null || x.effortId === undefined) ? '' : String(x.effortId),
    }
  }
  const issues = Array.isArray(snap.issues) ? snap.issues : []
  for (let i = 0; i < issues.length; i++) put(issues[i])
  const maps = Array.isArray(snap.maps) ? snap.maps : []
  for (let i = 0; i < maps.length; i++) {
    const ts = (maps[i] && Array.isArray(maps[i].tickets)) ? maps[i].tickets : []
    for (let j = 0; j < ts.length; j++) put(ts[j])
  }
  return map
}

/**
 * 一行一个会话：每个会话带它那几张票（票号、票的标题 ticketTitle、动作词条键、时间）。
 * 顺序就是宿主给的顺序（链那边已经按时间倒序、每会话最多 20 张），这里不再排一遍 ——
 * 排第二遍就是第二份规则。读不到时返回空数组，调用方据此不画列表。
 */
export const sessionChainRowsOf = function (st) {
  const view = sessionChainViewOf(st)
  if (view.state !== 'ok') return []
  const titles = sessionChainTitlesOf(st)
  return view.sessions.map(function (s) {
    return {
      shardId: s.shardId,
      label: s.shardId.slice(0, 8),
      backend: s.backend,
      entries: s.entries.map(function (e) {
        const known = titles[e.ticketKey] || null
        return {
          ticketKey: e.ticketKey,
          ticketTitle: known ? known.ticketTitle : '',
          effortId: known ? known.effortId : '',
          action: e.action,
          actionKey: sessionChainActionKeyOf(e.action),
          at: e.at,
          time: sessionChainClock(e.at),
        }
      }),
    }
  })
}

/** 点一行跳到那张票：切回列表页再进它的详情（跳转用的是链记下的票号，不是界面猜的）。 */
export const sessionChainOpenTicket = function (st, entry) {
  if (!st || !entry) return
  const n = Number(entry.ticketKey)
  if (!isFinite(n) || n <= 0) return
  try { st.tab = 'list' } catch (e) { /* 状态写不进去也不影响这一跳 */ }
  if (typeof pushNav === 'function') pushNav(st, 'issue', n, entry.effortId ? entry.effortId : '')
}

/**
 * 面板顶部这一条。三种画法，没有第四种：
 *   读不到 → 一行说明（带宿主给的代号，鼠标悬停看得到），一个数字都不显示；
 *   取到了但没有 → 整块不返回（不占位、不显示空框）；
 *   有数据 → 先一句「哪个会话在处理哪些票」，然后一个会话一段，段里一行一张票，点一行进那张票。
 */
export const SessionChainStrip = function (props) {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const st = props ? props.st : null
  const view = sessionChainViewOf(st)
  if (view.state === 'idle') return null
  if (view.state !== 'ok') {
    return h('div', { className: 'dsws-chainview dsws-chainview-unreadable', style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--dsws-label-caption,#8b8b95)', padding: '2px 2px 4px' } }, [
      Ic({ n: 'alert', size: 11 }),
      h(Tip, { content: tr('chainView.unreadableTip', { reason: view.reason }) }, h('span', null, tr('chainView.unreadable'))),
    ])
  }
  const sessions = sessionChainRowsOf(st)
  if (!sessions.length) return null
  const nodes = [h('div', { key: 'head', style: { fontSize: 11, color: 'var(--dsws-label-caption,#8b8b95)', padding: '0 2px 3px' } }, tr('chainView.title') + (view.at ? ' · ' + tr('chainView.readAt', { time: sessionChainClock(view.at) }) : ''))]
  sessions.forEach(function (s, i) {
    nodes.push(h('div', { key: 's' + i, style: { fontSize: 10, color: 'var(--dsws-label-caption,#8b8b95)', padding: '2px 2px 0' } }, tr('chainView.session', { id: s.label })))
    s.entries.forEach(function (e, j) {
      const word = e.actionKey ? tr(e.actionKey) : e.action
      const text = '#' + e.ticketKey + (e.ticketTitle ? ' ' + e.ticketTitle : '') + (word ? ' · ' + word : '') + (e.time ? ' · ' + e.time : '')
      nodes.push(h(Tip, { key: 'e' + i + '_' + j, content: tr('chainView.openTip') }, h('div', {
        className: 'dsws-chainview-row',
        tabIndex: 0,
        role: 'link',
        'aria-label': text,
        onClick: function () { sessionChainOpenTicket(st, e) },
        onKeyDown: function (ev) { if (ev && (ev.key === 'Enter' || ev.key === ' ')) { if (ev.preventDefault) ev.preventDefault(); sessionChainOpenTicket(st, e) } },
        style: { fontSize: 11, padding: '1px 6px', borderRadius: 4, cursor: 'pointer', color: 'var(--dsw-alias-label-primary,#e6edf3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      }, text)))
    })
  })
  return h('div', { className: 'dsws-chainview', style: { padding: '4px 2px 6px', borderBottom: '1px solid var(--dsw-alias-border-l1,#2a2d35)', marginBottom: 6 } }, nodes)
}
