/**
 * views/shared/sessionChainView.js — 「每个会话在处理哪些票」这一块的判据与画法（票 #721，T17）。
 *
 * ===== 展示面暂时下线：能力保留，等维护者指一张票再在别处挂载（2026-09-24 维护者定）=====
 * 这一块已经从右侧面板正文最上面摘下来了：**UI 上先不显示，能力全留着** ——
 * 本文件的判据与画法一行未删、导出照旧，词条（chainView.*）也照旧留着，谁都不许趁「反正不画了」
 * 把判据里的断言或词条删掉。挂载点原来在 panel/Dock.js 的正文第一行，那处已摘掉（那里留了指针）。
 *
 * 为什么先不显示：维护者原话是「UI 上先不显示这个，但是能力层面还具备这个能力，未来会根据之前的
 * issuePath 找个地方进行显示」。
 * 未来在哪儿挂：**票号未找到，待维护者指明**。动手前查过仓里的 docs/ 与 research/，也翻过 GitHub 票
 * （与处理链有关的只有 #714 数据侧、#721 这块展示面自己、#704 那张地图、#726），没有一张说「将来在
 * 哪显示」；「issuePath」在本仓指的是状态栏那枚「当前处理 Issue」面包屑，它随 #345 退役、#494 在
 * research/489-appendix.md 里落定，跟这一块的落点无关 —— 所以没有拿它顶一个票号。
 * 那一天要做的事只有一件：把 panel/Dock.js 正文第一行那个挂载点接回去。
 *
 * 门禁现状（改挂载点的人先看这两条）：
 *   · tests/verify-chain-view-ui.js 量的是「面板的列表页里没有这一块，而能力本体仍画得出来」
 *     （后者是反向自检：真把它挂出来时，同一把尺子必须找得到标题、会话行与「读不到处理记录」）。
 *   · tests/verify-chain-view.js 量的是本文件的判据与词条（能力层断言一条没少）。
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
 * 的 leaf 标记处（一源两物）。从前画在右侧面板顶部那一条（views/panel/Dock.js 的正文最上面），
 * 现在那一处不挂了（见上）。
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
 *   2. **「还没有」与「读坏了」分开说**（2026-09-24 维护者定，改过一次口径）：
 *      宿主没写下这份读数、或宿主自己说没有链实例 —— 都等于「这个进程里还没有任何处理记录」，
 *      与「取到了、就是没有」是同一种事实，整块不画，绝不冒出一句常驻的道歉（那种句子占版面、
 *      又不携带用户可行动的信息，只会训练用户忽略这一块）。只有读的时候真出错（read-failed）
 *      与形状不对（shape）才画一个可见的小标记，而且只是一个标记、不独占一行。
 *      任何情况下都不许用 0 或一个空列表把「不知道」说成「没有人在处理票」。
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
 * 取数路径：只读宿主写下的那一个字段，输出四种状态之一。
 *
 *   · `idle`      还没拿到面板快照（开关刚打开、正在取数）：什么都不说，也不占位。
 *   · `empty`     这个进程里还没有任何处理记录（见下面那条判断的依据）：整块不画。
 *   · `unreadable` 读这份记录那一步真坏了（读的时候抛错 / 形状不对）：画一个小标记，原因在悬停里。
 *   · `ok`        宿主说取到了：逐格收会话，形状不对的格子整格丢掉（宁可少显示，也不显示错的）。
 *
 * 判据一条也不在界面里现算：状态与原因都来自宿主写下的那两个字（ok 与 reason）。
 *
 * **为什么 `host.chain.absent` 归「空」而不归「读不到」**（2026-09-24 维护者定）：
 *   这个代号的两处来源说的是同一件事 —— 字段没挂上（宿主那条回包路径没带它，或还没取到第一份快照），
 *   以及宿主自己说没有链实例。两处都等于「这个进程里还没有任何处理记录」，
 *   与 `host.chain.empty`（取到了、就是没有）是**同一种事实**，不是错误。
 *   它不是「文件该有却被删了」：链的记录是只写的内存表加上落盘，进程里没有记录就是没有记录，
 *   界面无从判断、也不该替宿主假设一份记录被谁动了。既然不是错误，就不该冒出一句道歉 ——
 *   一句常驻的道歉比沉默更差：它占掉一行，还训练用户忽略那一块（而且它不携带任何用户可行动的信息）。
 *   真的坏了只有两种：`host.chain.read-failed`（读的时候抛错）、`host.chain.shape`（形状不对）。
 */
export const sessionChainViewOf = function (st) {
  const snap = (st && st.snapshot) ? st.snapshot : null
  if (!snap) return { state: 'idle', reason: '', at: 0, sessions: [] }
  const raw = snap[SESSION_CHAIN_FIELD]
  if (raw === null || raw === undefined) return { state: 'empty', reason: 'host.chain.absent', at: 0, sessions: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { state: 'unreadable', reason: 'host.chain.shape', at: 0, sessions: [] }
  const at = sessionChainAtOf(raw.at)
  if (raw.ok !== true) {
    // 宿主自己说这次没取到：只有「还没有记录」那一种归空，别的（读失败 / 形状不对 / 说不出的代号）照实报。
    const reason = String(raw.reason || 'host.chain.not-ok')
    if (reason === 'host.chain.absent') return { state: 'empty', reason: reason, at: at, sessions: [] }
    return { state: 'unreadable', reason: reason, at: at, sessions: [] }
  }
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
 * 一行一张票（2026-09-24 晚重做，维护者原话：「不应该这样呈现，这样UI非常丑陋」）。
 *
 * 重做前那一版长这样：一句「每个会话在处理哪些票 · 宿主读数 16:50」+ 每个会话再加一条
 *   「会话 307d37e6」的小标题、标题下面才是票行 —— 两条记录就要占四行，字号还比列表行小一号；
 *   而且那串 8 位十六进制散列对人不可行动（认不出是哪个会话），「宿主读数」也是我们内部的说法。
 *
 * 现在：
 *   · 每条记录**一行**（票号 + 动作 + 相对时间），会话标识只在「换了会话」的那一行上写一次，
 *     是给人读的序号（会话 1、会话 2 —— 序号就是版面上从上到下的第几个会话），不再是散列前缀；
 *   · 完整标识（散列前 8 位）与完整说法都在悬停提示里（沿用现有 Tip 机制）；
 *   · 行数有上限（SESSION_CHAIN_ROW_CAP）：到顶就截断并在末尾说明还有多少条没画，
 *     于是整块高度随条数线性增长、且封顶。
 * 顺序就是宿主给的顺序（链那边已经按时间倒序、每会话最多 20 张），这里不再排一遍。
 */
export const sessionChainRowsOf = function (st) {
  const view = sessionChainViewOf(st)
  if (view.state !== 'ok') return []
  const titles = sessionChainTitlesOf(st)
  const out = []
  view.sessions.forEach(function (s, si) {
    const full = String(s.shardId)
    s.entries.forEach(function (e, ei) {
      const known = titles[e.ticketKey] || null
      out.push({
        shardId: s.shardId,
        label: full.slice(0, 8),
        sessionFull: full,
        sessionIndex: si,
        firstOfSession: ei === 0,
        backend: s.backend,
        ticketKey: e.ticketKey,
        ticketTitle: known ? known.ticketTitle : '',
        effortId: known ? known.effortId : '',
        action: e.action,
        actionKey: sessionChainActionKeyOf(e.action),
        at: e.at,
        time: sessionChainClock(e.at),
      })
    })
  })
  return out
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
 * 版面上最多画几行记录（2026-09-24 晚重做时人工定的上限，写进门禁断言）：
 *   到顶就截断，并在末尾说明还有多少条没画 —— 于是这一块的高度随条数线性增长、且封顶，
 *   不会因为某个会话记了几十条把面板顶部撑爆。20 条与「链那边每个会话最多记 20 张」同量级。
 */
export const SESSION_CHAIN_ROW_CAP = 20
/** 一行多高（像素）：行高 15 + 下外边距 3。区块自己的纵向内边距另算，见下一行那个常量。 */
export const SESSION_CHAIN_ROW_H = 18
/** 区块自己的纵向内边距合计（上 3 + 下 3）。 */
export const SESSION_CHAIN_BLOCK_PAD = 6

/**
 * 面板顶部这一条。四种画法，没有第五种：
 *   还没取到快照 → 整块不返回（还在取数，不到下结论的时候）；
 *   这个进程里还没有任何处理记录 → 整块不返回（与「取到了、就是没有」同一种事实：不占位、不显示空框）；
 *   读这份记录那一步真坏了 → 一枚小图标，完整的话与原因代号都在悬停里（**不独占一行**，见下）；
 *   有数据 → 一行说明（这一块是什么、什么时候更新的）+ 一行一条记录，点一行进那张票。
 */
export const SessionChainStrip = function (props) {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const st = props ? props.st : null
  const view = sessionChainViewOf(st)
  if (view.state === 'idle') return null
  // 「还没有记录」整块不画：它和「取到了、就是没有」是同一种事实，处理也一样。
  // （2026-09-24 之前这里画的是一整句道歉「读不到处理记录」，那句常驻一行、很占版面 —— 现在它不存在了。）
  if (view.state === 'empty') return null
  if (view.state !== 'ok') {
    // 只有真坏了才画，而且**不许独占一行**（2026-09-24 维护者定，第一性原理）：
    //   从前这里画的是一整句道歉占据一整行；可这句话不携带任何用户可行动的信息 —— 用户拿它没办法。
    //   现在只留一枚 11 像素的危险色小图标（它不是一句文案行）：容器纵向不留任何 padding/外边距，
    //   完整的话与宿主给的原因代号都进悬停提示，信息一点不丢。
    return h('div', { className: 'dsws-chainview dsws-chainview-broken', style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, lineHeight: '14px', color: 'var(--dsw-alias-state-error-primary,#f87171)', padding: '0 2px' } }, [
      h(Tip, { content: tr('chainView.unreadable') + ' ' + tr('chainView.unreadableTip', { reason: view.reason }) }, Ic({ n: 'alert', size: 11 })),
    ])
  }
  const all = sessionChainRowsOf(st)
  if (!all.length) return null
  const shown = all.slice(0, SESSION_CHAIN_ROW_CAP)
  const rest = all.length - shown.length
  const head = tr('chainView.title') + (view.at ? ' · ' + tr('chainView.readAtFull', { time: sessionChainClock(view.at) }) : '')
  const nodes = [h('div', { key: 'head', style: { fontSize: 12, lineHeight: '18px', height: 18, color: 'var(--dsws-label-caption,#8b8b95)', padding: '0 6px' } }, head)]
  shown.forEach(function (e, i) {
    const word = e.actionKey ? tr(e.actionKey) : e.action
    // 会话标识只在「换了会话」的那一行上写一次，而且是给人读的序号（会话 1、会话 2……）。
    // 那 8 位十六进制散列不上版面（对人不可行动）；它进悬停提示，见下面 tip。
    const text = (e.firstOfSession ? tr('chainView.sessionShort', { n: e.sessionIndex + 1 }) + ' ' : '') +
      '#' + e.ticketKey + (e.ticketTitle ? ' ' + e.ticketTitle : '') + (word ? ' · ' + word : '') + (e.time ? ' · ' + e.time : '')
    const tip = tr('chainView.sessionTip', { id: e.label }) + ' · ' + text + ' · ' + tr('chainView.openTip')
    nodes.push(h(Tip, { key: 'e' + i, content: tip }, h('div', {
      className: 'dsws-chainview-row',
      tabIndex: 0,
      role: 'link',
      'data-session': e.label,
      'aria-label': text,
      onClick: function () { sessionChainOpenTicket(st, e) },
      onKeyDown: function (ev) { if (ev && (ev.key === 'Enter' || ev.key === ' ')) { if (ev.preventDefault) ev.preventDefault(); sessionChainOpenTicket(st, e) } },
      style: { fontSize: 12, lineHeight: '15px', height: 15, marginBottom: 3, padding: '0 6px', borderRadius: 4, cursor: 'pointer', color: 'var(--dsw-alias-label-primary,#e6edf3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    }, text)))
  })
  if (rest > 0) {
    nodes.push(h('div', { key: 'rest', 'data-chain-rest': String(rest), style: { fontSize: 12, lineHeight: '15px', height: 15, padding: '0 6px', color: 'var(--dsws-label-caption,#8b8b95)' } }, tr('chainView.moreRows', { n: rest })))
  }
  // 高度写死成「若干行 × 一行高 + 区块内边距」：随条数线性增长、且封顶（行数上面已按上限截断）。
  const height = SESSION_CHAIN_BLOCK_PAD + SESSION_CHAIN_ROW_H * nodes.length
  return h('div', { className: 'dsws-chainview', style: { height: height, boxSizing: 'border-box', padding: '3px 2px', borderBottom: '1px solid var(--dsw-alias-border-l1,#2a2d35)', marginBottom: 6 } }, nodes)
}