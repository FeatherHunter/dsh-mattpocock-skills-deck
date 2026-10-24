/**
 * statusbar/SessionChainCapsule.ts — 状态栏胶囊里「这个会话在办哪张票」那一段
 *
 * 只做一件事：把宿主已经写下的跨会话在办表里，属于当前会话的那几行，挑最新一条画进胶囊。
 * 数据只有一个来源：面板快照的 workRouteTable 字段（宿主 refresh/rooms/host/work-route-readout.ts 的产物，
 * 与工具回执 data.workRoute 同一份读数）；旧链的 workRoute 字段与 sessionChainView.js 已随 #1271 退役。
 * 本文件不自己推断谁在办票、不读会话事件、不解析命令行、不读落盘文件。
 *
 * 三件事（第一性原理定案）：
 *   1. 跟谁走：只跟当前会话。宿主在挂表时已经按这次取快照的会话标好 currentSession，
 *      这里只收标着的那几行 —— 对不上就当没有，不把别的会话的票算到当前头上。
 *      标题、状态与是不是地图按（工作单元，票号）就近查，查不到回落到只按票号（下面那张就近表）。
 *   2. 点开跳哪：点这一段就切列表页并打开那张票（下面 capsuleOpenTicket，再把面板打开），
 *      悬停里给动作、时间与完整说明。
 *   3. 空态：没快照、没记录、当前会话没记录 —— 整段不画、不占位（与 #721「还没有就不画」
 *      同一条纪律）；真读坏了（read-failed / shape）画一枚 11 像素小图标，完整话进悬停，
 *      不独占一行（与 SessionChainStrip 那枚标记同形）。
 *
 * 折叠阶梯：这一段不进 capFold.ts 的让位表（那张表被门禁钉死在 12 段，加一段就红），它是
 *   「载荷」—— 与计数器数字、段图标同类：任何宽度都不撤，只用省略号收宽度
 *   （maxWidth 加 ellipsis 加 flex 收缩）。没有记录时它根本不存在，所以窄宽度下它不占地方。
 *
 * 契约：模块真源（ESM 导出）；构建时剥行首 export，拼回 src/client/index.ts
 *   的 leaf 标记处（源码树里只有这一份真源）。文案全部走词条（chainView.capsuleDoing 复用 action 词条与 openTip），
 *   本文件零中文字符串（门禁扫 CJK， locale-completeness 那条「干净」覆盖它）。
 * （#1251：本文件由同名 .js 转成 .ts，只补类型标注（形参一律 any）与环境声明，运行时行为一字不动。约束：不许加运行时 import（跨文件名字一律 ambient declare，构建拼闭包时拒收残留 import）；不许 export default；只写可剥离类型。）
 */
/**
 * 闭包环境声明（#1251 转 TS 时补的）：下面这些名字在源码树里没有定义，
 * 它们是别的叶子拼进同一个浏览器闭包时带进来的；类型检查靠这里声明形状。
 * 构建转译时会把 declare 整段抹掉，所以运行时一字不差。
 * 约束：以后新增跨文件引用只许在这里加 declare，不要加运行时 import
 * （构建侧 toSpliceableFragment 会拒收残留的 import，整个片段拼不进去）；
 * 也不要写 export default（构建侧 inlineExportDeclarations 不收 as 改名）。
 */
// 调用的动作函数（在办表读数、动作词条键、地图跳转、菜单定位开关）。
declare function capsuleOwnRouteFallbackNode(...args: any[]): any; declare function capsuleOwnRoutePick(...args: any[]): any; declare function ownWorkRouteSlotOf(...args: any[]): any;
declare function clearStatusClose(...args: any[]): any;
declare function findMapByIdentity(...args: any[]): any;
declare function Ic(props?: any): any;
declare function openPanel(...args: any[]): any;
declare function placeStatusOverlay(...args: any[]): any;
declare function pushNav(...args: any[]): any;
declare function scheduleStatusClose(...args: any[]): any;
declare function workRouteActionKeyOf(...args: any[]): any;
declare function workRouteTableClock(...args: any[]): any;
declare function workRouteTableOf(...args: any[]): any;
// 值引用的组件与字段名（弹层、悬停提示）。
declare const PortalOverlay: any;
declare const Tip: any;

/** ISO 时刻 → 毫秒（读数里 actionAt 是 ISO 串；解析不了回 0，调用方显示空串）。 */
const capsuleAtMsOf = function (v: any) {
  if (typeof v !== 'string' || v === '') return 0
  const t = Date.parse(v)
  return isFinite(t) && t > 0 ? Math.floor(t) : 0
};

/** 票键的形状检查：只收纯数字串（与旧链同一条口径）。 */
const capsuleTicketKeyOf = function (v: any) {
  const t = v === null || v === undefined ? '' : String(v).trim()
  return /^\d{1,10}$/.test(t) ? t : ''
};

/**
 * 号码 → 标题、工作单元与状态（只从已拿到的快照里查；旧链 sessionChainView.js 那一套，
 * #1271 起搬到这里 —— 那份叶子已删，标题就近查只剩胶囊用）。
 * 字段叫 ticketTitle 是为避开原生 title 提示（见 verify-no-title）。isMap 只认归一过的 type='map'。
 * 同号多张时按（工作单元，票号）取，另留只按票号那一把给老记录与远端用。
 */
const capsuleTitlesOf = function (st: any) {
  const byId: any = {}
  const byNumber: any = {}
  const snap = (st && st.snapshot) ? st.snapshot : null
  if (!snap) return { byId: byId, byNumber: byNumber }
  const put = function (x: any) {
    if (!x || typeof x !== 'object') return
    const n = capsuleTicketKeyOf(x.number)
    if (!n) return
    const eff = (x.effortId === null || x.effortId === undefined) ? '' : String(x.effortId)
    const id = eff + '\0' + n
    const rs = (x.state === null || x.state === undefined) ? '' : String(x.state).toUpperCase()
    // #1286：状态栏这张胶囊里的「地图」只认探索地图（type==='map'）。规格（type==='spec'）刻意不算地图：
    //   状态栏不另立「规格」计数，也不新造一个元素，规格就按普通票出现（点开走票详情那条路）。
    const row = { ticketTitle: (x.title === null || x.title === undefined) ? '' : String(x.title), effortId: eff, ticketState: rs === 'CLOSED' ? 'CLOSED' : (rs === 'OPEN' ? 'OPEN' : ''), isMap: x.type === 'map' }
    if (!byId[id]) byId[id] = row
    if (!byNumber[n]) byNumber[n] = row
  }
  const issues = Array.isArray(snap.issues) ? snap.issues : []
  for (let i = 0; i < issues.length; i++) put(issues[i])
  const maps = Array.isArray(snap.maps) ? snap.maps : []
  for (let i = 0; i < maps.length; i++) {
    const ts = (maps[i] && Array.isArray(maps[i].tickets)) ? maps[i].tickets : []
    for (let j = 0; j < ts.length; j++) put(ts[j])
  }
  // #907：首屏不收的行宿主另留了一份瘦身行 —— 胶囊那一行仍要显示标题。
  //   放在最后 put：票池里已有的行以票池那份为准（put 只认第一次写进去的那条）。
  const thin = Array.isArray(snap.thinTickets) ? snap.thinTickets : []
  for (let i = 0; i < thin.length; i++) put(thin[i])
  return { byId: byId, byNumber: byNumber }
};

const capsuleTitleFor = function (titles: any, ticketKey: any, effortId: any) {
  const eff = (effortId === null || effortId === undefined) ? '' : String(effortId)
  if (titles && titles.byId && titles.byId[eff + '\0' + ticketKey]) return titles.byId[eff + '\0' + ticketKey]
  if (titles && titles.byNumber && titles.byNumber[ticketKey]) return titles.byNumber[ticketKey]
  return null
};

/**
 * 在办表的一行 → 胶囊要用的那几个格：读数只保证票号/动作/时刻/会话标签，
 * 标题、状态与是不是地图按就近表补（读数自带的标题只当回落，票池里有更新的以票池为准）。
 */
const capsuleRowOf = function (titles: any, e: any) {
  const key = capsuleTicketKeyOf(e ? e.ticketKey : '')
  if (!key) return null
  const known = capsuleTitleFor(titles, key, '')
  const action = (e && e.action !== null && e.action !== undefined) ? String(e.action) : ''
  let actionKey = ''
  try { actionKey = (typeof workRouteActionKeyOf === 'function') ? String(workRouteActionKeyOf(action) || '') : '' } catch (eKey) { actionKey = '' }
  return {
    ticketKey: key,
    ticketTitle: (known && known.ticketTitle) ? known.ticketTitle : ((e && typeof e.title === 'string') ? e.title : ''),
    effortId: (known && known.effortId) ? known.effortId : '',
    ticketState: (known && known.ticketState) ? known.ticketState : '',
    isMap: !!(known && known.isMap === true),
    sessionLabel: (e && typeof e.sessionLabel === 'string') ? e.sessionLabel : '',
    action: action,
    actionKey: actionKey,
    at: capsuleAtMsOf(e ? e.actionAt : ''),
    atIso: (e && typeof e.actionAt === 'string') ? e.actionAt : '',
  }
};

/**
 * 点一行跳到那张票：切回列表页再进详情（用读数记下的票号）。地图进地图详情页，
 * 须同时满足是地图与按票身份找得到地图对象，否则回落普通票（#780 那条护栏：
 * 面板找不到地图对象时会画成列表页，而导航栈却说在地图页）。
 */
const capsuleOpenTicket = function (st: any, entry: any) {
  if (!st || !entry) return
  const n = Number(entry.ticketKey)
  if (!isFinite(n) || n <= 0) return
  try { st.tab = 'list' } catch (e) { /* 状态写不进去也不影响这一跳 */ }
  const eid = (entry.effortId === null || entry.effortId === undefined) ? '' : String(entry.effortId)
  let map = null
  if (entry.isMap === true && typeof findMapByIdentity === 'function') {
    try {
      const list = (st.snapshot && Array.isArray(st.snapshot.maps)) ? st.snapshot.maps : []
      if (eid) {
        // 读数记下了工作单元：直接进对应那一张，找得到才压地图栈。
        map = findMapByIdentity(list, n, eid)
      } else {
        // 取不到工作单元：按 780 护栏兜底 —— 同号多图就不猜，老实按普通票走。
        let sameNumber = 0
        for (let i = 0; i < list.length; i++) {
          const m = list[i]
          if (!m) continue
          const k = (m.key !== null && m.key !== undefined && m.key !== '') ? m.key : m.number
          if (k === null || k === undefined || k === '') continue
          if (String(k).padStart(2, '0') === String(n).padStart(2, '0')) sameNumber++
        }
        if (sameNumber <= 1) map = findMapByIdentity(list, n, eid)
      }
    } catch (eFind) { map = null }
  }
  if (typeof pushNav === 'function') pushNav(st, map ? 'map' : 'issue', n, eid)
};

/**
 * 判据：只读在办表读数的行，输出三种之一。
 *   · { state: 'idle' } / { state: 'empty' } —— 没快照、没记录、当前会话没记录：调用方整段不画。
 *   · { state: 'unreadable', reason } —— 读坏了：调用方画小图标。
 *   · { state: 'ok', entry, list } —— entry 是当前会话最新那一条（胶囊版面上只写它的号），
 *     list 是当前会话全部记录（从新到旧，悬停里列出来）。
 */
export const sessionChainCapsuleOf = function (st: any, sid: any) {
  // #1355：本函数不做「这张表是谁算的」的归属判断 —— 读数里没有会话号，判不出。归属靠上游保证：宿主按请求里
  //   那个会话号现算，客户端缓存不保留这张表，缺表会补发一次带当前会话号的请求。sid 保留在签名里（调用方照旧传）。
  //   行上的 currentSession 只是行级过滤，它认不出整张表属于别人 —— 那种情况登记在票里另立票。
  void sid
  // #1436：先看首帧那条只读电话的读数（本机存档，不用等整份快照重建）；一次都还没读到时画「读取中」。
  const pick = (typeof capsuleOwnRoutePick === 'function') ? capsuleOwnRoutePick(st) : null
  const view = (pick && pick.view) || ((typeof workRouteTableOf === 'function') ? workRouteTableOf(st) : null)
  if (pick && pick.fallback && (!view || view.state === 'idle' || view.state === 'empty')) return pick.fallback
  if (!view || view.state === 'idle') return { state: 'idle', reason: '', entry: null, list: [] }
  if (view.state === 'empty') return { state: 'empty', reason: '', entry: null, list: [] }
  if (view.state !== 'ok') return { state: 'unreadable', reason: String((view && view.reason) || 'host.work-route.shape'), entry: null, list: [] }
  const rows = Array.isArray(view.rows) ? view.rows : []
  const ownRaw = rows.filter(function (r: any) { return r && r.currentSession === true })
  if (!ownRaw.length) return { state: 'empty', reason: '', entry: null, list: [] }
  const titles = capsuleTitlesOf(st)
  const own: any[] = []
  for (let i = 0; i < ownRaw.length; i++) { const r = capsuleRowOf(titles, ownRaw[i]); if (r) own.push(r) }
  if (!own.length) return { state: 'empty', reason: '', entry: null, list: [] }
  return { state: 'ok', reason: '', entry: own[0], list: own }
};

/**
 * #1395 房外埋点：把上面这条判据的结论落进常驻事件 statusbar.fallback，给「这一段为什么不画」留现场。
 *
 * 此前状态栏只记 no-snapshot / no-cwd / snap-error 三档，分不清「还没有快照」（idle，整段不画）与
 * 「有快照但没有本会话的行」（empty，也整段不画）；这两者指向完全不同的修法（补拉链路 vs 这张表是谁算的）。
 * 这里在原三档之后补三档（work-route-idle / work-route-empty / work-route-unreadable），并记表一共几行、
 * 其中标了本会话的几行（没有表时两格都记 -1）。只记枚举与计数，不记票号、路径、会话号原文。
 * 同一种退化形状只记第一行，换形状才再记；正常（ok）不记，保持常驻最小。
 */
const dswsCapsuleFbLast = { key: '' }
export const logStatusFallback = function (st: any, sid: any) {
  try {
    if (!st) return
    // #1440：计数也按界面实际显示的那一份算（与胶囊展开列表同一条选路），否则同一张表在两处说两个数。
    const pick = (typeof capsuleOwnRoutePick === 'function') ? capsuleOwnRoutePick(st) : null
    const view = (pick && pick.view) || ((typeof workRouteTableOf === 'function') ? workRouteTableOf(st) : null)
    const rows = (view && Array.isArray(view.rows)) ? view.rows : null
    const tableRows = rows ? rows.length : -1
    let ownRows = -1
    if (rows) ownRows = rows.filter(function (r: any) { return r && r.currentSession === true }).length
    let reason = ''
    if (!st.snapshot) reason = 'no-snapshot'
    else if (!st.cwd) reason = 'no-cwd'
    else if (st.snapMode === 'err') reason = 'snap-error'
    else {
      const cap = sessionChainCapsuleOf(st, sid)
      const capState = (cap && typeof cap.state === 'string') ? cap.state : ''
      if (capState === 'loading') reason = 'work-route-loading'
      else if (capState === 'empty') reason = 'work-route-empty'
      else if (capState === 'unreadable') reason = 'work-route-unreadable'
      else if (capState === 'idle') { const slot = (typeof ownWorkRouteSlotOf === 'function') ? ownWorkRouteSlotOf(st) : null; reason = (slot && slot.state === 'off') ? 'work-route-off' : 'work-route-idle' }
    }
    const key = reason + '|' + tableRows + '|' + ownRows
    if (key === dswsCapsuleFbLast.key) return
    dswsCapsuleFbLast.key = key
    if (reason) log('info', 'statusbar.fallback', { reason: reason, tableRows: tableRows, ownRows: ownRows })
  } catch (eFb) {}
};

/** 关掉这张单子（开关与 BUG / 可接菜单同形：关标记、清位置、刷界面）。 */
function chainHide(st: any) {
  if (!st) return
  if (!st.chainMenuOpen && !st.chainMenuPos) return
  st.chainMenuOpen = false
  st.chainMenuPos = null
  try { emit(st) } catch (eEmit) {}
}

/** 打开这张单子：先把别家的单子收了（与 showStatusBugMenu 互斥同理），再按锚点定位。 */
function chainShow(st: any, anchorRef: any, closeRef: any) {
  if (!st) return
  try { clearStatusClose(closeRef) } catch (eClear) {}
  let changed = false
  if (st.skillsOpen || st.skillPopPos || st.skillHover || st.skillTip) { st.skillsOpen = false; st.skillHover = null; st.skillTip = null; st.skillPopPos = null; changed = true }
  if (st.bugMenuOpen || st.bugMenuPos || st.bugMenuHover) { st.bugMenuOpen = false; st.bugMenuHover = false; st.bugMenuPos = null; changed = true }
  if (st.takeMenuOpen || st.takeMenuPos || st.takeMenuHover) { st.takeMenuOpen = false; st.takeMenuHover = false; st.takeMenuPos = null; changed = true }
  if (st.backendMenuOpen || st.backendMenuPos) { st.backendMenuOpen = false; st.backendMenuPos = null; changed = true }
  if (!st.chainMenuOpen) { st.chainMenuOpen = true; changed = true }
  try {
    const p = placeStatusOverlay(anchorRef && anchorRef.current, 'left')
    if (p && (!st.chainMenuPos || st.chainMenuPos.left !== p.left || st.chainMenuPos.bottom !== p.bottom)) { st.chainMenuPos = p; changed = true }
  } catch (ePlace) {}
  if (changed) { try { emit(st) } catch (eEmit2) {} }
}

/** 离开锚点或单子：160 毫秒后关（与别家菜单同一个延时，进单子会取消这次关闭）。 */
function chainLater(st: any, closeRef: any) {
  try { scheduleStatusClose(closeRef, function () { chainHide(st) }) } catch (eLater) { chainHide(st) }
}

/**
 * #780：号怎么写 —— 地图写裸号（`#` 那个位置让给地图图标），普通票写 `#号`。
 *   规则只写这一处：版面上那一段与悬停单子里每一行的徽章都读它，免得两处各写一遍、日后走岔。
 *   注意这只是**版面**的写法；文字通道（无障碍名与悬停提示）一律仍写 `#号`，见 spoken 与单子里的 line。
 */
const chainKeyTextOf = function (isMap: any, key: any) { return isMap === true ? String(key) : '#' + String(key) }
/**
 * #780：地图那一条的那枚图标（普通票没有这一枚；段首那枚图钉不在这里）。
 *   它必须是号那个元素的**兄弟节点** —— 收字机器往挂让位号的元素里写 textContent，塞进去会被抹掉。
 */
const chainMapIconOf = function (isMap: any, size: any) { return isMap === true ? Ic({ n: 'map', size: size }) : null }

// #1263: header plus row time helpers. Leaf discipline: no new runtime import, words via tr only.
// Row time and header time reuse the work-route table's clock (same-day HH:mm, cross-day MM-DD HH:mm).
// Stale means idle for over 24 hours against Date.now().
const capsuleStaleOf = function (at: any, now: any) {
  const t = (typeof at === 'number' && isFinite(at) && at > 0) ? Math.floor(at) : 0
  const n = (typeof now === 'number' && isFinite(now) && now > 0) ? Math.floor(now) : Date.now()
  if (!t || !n || n < t) return false
  return n - t > 24 * 60 * 60 * 1000
};

// #1404: 表头压成一行用的三件小工具。叶子纪律照旧：不新增运行时 import，文字全走 tr。
//   两枚分隔线（1px 竖线、两端渐隐）用内联 SVG 画，颜色写 currentColor，跟着表头文字色走，
//   深浅两套主题共用同一套几何与不透明度；宽度、高度、峰值不透明度写死在下面两处调用点，改样式要两处一起改。
const chainSeparatorOf = function (h: any, key: any, width: any, height: any, peak: any) {
  // 渐变 id 按尺寸拼。SVG id 在整个文档里唯一：将来若真出现同尺寸的两枚分隔线，后一枚的渐变定义不生效，
  //   两枚会共用前一条——两条定义完全一样，共用不影响观感；别指望靠尺寸来防撞名。
  const id = 'dsws-chain-sep-' + String(width) + 'x' + String(height)
  const cx = width / 2
  const lineWidth = 1
  return h('svg', { key: key, width: width, height: height, 'aria-hidden': 'true', style: { flex: 'none', display: 'block' } }, [
    h('defs', null, h('linearGradient', { id: id, gradientUnits: 'userSpaceOnUse', x1: cx, y1: 0, x2: cx, y2: height }, [
      h('stop', { offset: 0, stopColor: 'currentColor', stopOpacity: 0 }),
      h('stop', { offset: 0.5, stopColor: 'currentColor', stopOpacity: peak }),
      h('stop', { offset: 1, stopColor: 'currentColor', stopOpacity: 0 }),
    ])),
    // 竖线用 rect 画：宽 1px、与 SVG 同高，填充上面那条渐变——线两头淡出，不变成一根硬起止的短线。
    h('rect', { x: cx - lineWidth / 2, y: 0, width: lineWidth, height: height, fill: 'url(#' + id + ')' }),
  ])
};
/**
 * #1404：把一句带 {name} 占位符的文案切成「文字段 + 数字段」。
 *   只认 {name} 这一种占位符，参数取 String(params[name])；找不到对应参数时原样留在文字段里（与 tr 的规矩一致）。
 *   数字段单独成元素，由调用方给它等宽数字（tabular-nums）与亮一档的颜色；文字段保持说明文字的灰色。
 *   这里刻意不引富文本机制：词条只想强调数字，切段就够，省得为一个表头加一门新语法。
 */
const chainSegmentedOf = function (h: any, text: any, params: any, numStyle: any) {
  const out: any[] = []
  const parts = String(text == null ? '' : text).split(/(\{\w+\})/)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) continue
    const hole = /^\{(\w+)\}$/.exec(part)
    if (hole && params && Object.prototype.hasOwnProperty.call(params, hole[1])) {
      out.push(h('span', { key: 'n' + i, style: numStyle }, String(params[hole[1]])))
    } else {
      out.push(part)
    }
  }
  return out
};
/**
 * #1404：工作路线弹层的表头，压成一行、两端对齐。
 *   左簇：短标题「工作路线」+ 本会话条数 + 内部那条分隔线 + 更新时间；右簇：组间那条分隔线 + 「另有 … 个会话在办 … 条」。
 *   簇内间距 6px、两簇之间 8px；整行不换行，左簇不收缩，右簇可收缩、由自动外边距推到行尾并以省略号收尾。
 *   别的会话数为 0 时右簇与组间那条分隔线都不渲染，表头仍是一行高——不额外留空位，也不改成两行。
 *   表头只做说明，不可聚焦、不可点，也不做悬停反馈（票行才有交互）。
 */
const chainHeaderOf = function (h: any, tr: any, ownCount: any, otherCount: any, otherRowCount: any, headTime: any) {
  const captionColor = 'var(--dsws-label-caption,#8b8b95)'
  // 数字比说明文字亮一档：说明文字用 caption 灰，数字用 secondary（主题回退值见两处 var 的兜底）。
  const numStyle = { fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-secondary,#a1a1aa)' }
  const title = h('span', { key: 'title', style: { flex: 'none', fontWeight: 600, color: 'var(--dsw-alias-label-primary,#e6edf3)' } }, tr('chainView.capsuleHeaderTitle'))
  const own = h('span', { key: 'own', style: { flex: 'none', whiteSpace: 'nowrap' } }, chainSegmentedOf(h, tr('chainView.capsuleHeaderOwn'), { n: ownCount }, numStyle))
  const innerSep = chainSeparatorOf(h, 'sepInner', 7, 15, 0.62)
  const time = h('span', { key: 'time', style: { flex: 'none', color: captionColor } }, tr('chainView.readAtFull', { time: headTime }))
  const left = h('span', { key: 'ownSide', style: { display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none', whiteSpace: 'nowrap' } }, [title, own, innerSep, time])
  // 右簇靠自动外边距推到行尾：marginLeft:'auto' 吸收两簇之间的空白，容器上的 justifyContent:'space-between'
  //   只是原先的写法、留着无害；空间不足时 flex-shrink 收窄，里面的文字仍以省略号收尾。
  const others = otherCount > 0
    ? h('span', { key: 'otherSide', style: { display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 1 auto', minWidth: 0, whiteSpace: 'nowrap', marginLeft: 'auto' } }, [
      chainSeparatorOf(h, 'sepGroup', 6, 17, 0.78),
      h('span', { key: 'othersText', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, chainSegmentedOf(h, tr('chainView.capsuleHeaderOthers'), { x: otherCount, y: otherRowCount }, numStyle)),
    ])
    : null
  return h('div', {
    key: 'head',
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, whiteSpace: 'nowrap',
      fontSize: 11, lineHeight: '18px', padding: '2px 8px', color: captionColor,
    },
  }, [left, others])
};

/**
 * 胶囊里那一段。idle / empty 返回 null（不占位）；unreadable 返回一枚小图标；
 * ok 版面上只写图钉图标加当前那张的号（标题再长也不上版面）；鼠标悬停撑起一张单子，
 * 单子里列出当前会话的全部记录（从旧到新往下排，最新沉底离鼠标最近，行内不用 · 分隔，
 * 号与动作做成徽章），点某一行进那张票的详情。
 *
 * #780：那一条是**地图**时，号前面的 `#` 换成地图图标（读起来是「图钉 + 地图图标 + 40」），
 *   普通票仍是「图钉 + #号」；悬停单子里每行的号徽章同样处理。两条硬约束：
 *     ① 图标必须是那个号的**兄弟节点**，不许放进号里面 —— 那台按宽度收字的机器是往挂着让位号的那个
 *        元素里写 textContent 的，赋值会清掉该元素的全部子节点，图标塞进去就会被反复抹掉又装回来
 *        （一闪一闪）。本文件里那个号仍是恰好一处让位号。
 *     ② 版面上换了图标，**文字通道仍写 `#号`**（无障碍名与悬停提示），并在里面补上类型词
 *        「地图」（词条 type.map）—— 图标对读屏与复制文字的人是不存在的，不能只靠它说话。
 */
export const SessionChainCapsule = function (props: any) {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const anchorRef = React.useRef(null)
  const closeRef = React.useRef(null)
  const activeState = React.useState(null)
  const activeRow = activeState ? activeState[0] : null
  const setActiveRow = activeState && typeof activeState[1] === 'function' ? activeState[1] : function () {}
  const st = props ? props.st : null
  const sid = props ? props.sid : ''
  const view = sessionChainCapsuleOf(st, sid)
  if (view.state === 'loading') return (typeof capsuleOwnRouteFallbackNode === 'function') ? capsuleOwnRouteFallbackNode(h, tr, view, Ic) : null
  if (view.state === 'idle' || view.state === 'empty') return null
  if (view.state !== 'ok') {
    return h('span', { className: 'dsws-capsule-chain-broken', style: { display: 'inline-flex', alignItems: 'center', flex: 'none' } }, [
      h(Tip, { content: tr('chainView.unreadable') + ' ' + tr('chainView.unreadableTip', { reason: view.reason }) }, Ic({ n: 'alert', size: 11 })),
    ])
  }
  const e = view.entry
  // 单子从旧到新往下排：最新那一条沉底，离鼠标最近；在办表已经按时间倒序，这里翻一面。
  // 版面上那个号（下面那个 text span）挂在让位表第 12 号：宽度不够时它也逐字让（最后几位才让），
  //   让位机直接往纯文本元素里写字，这里两处（版面号、环境计数都是纯文本）都是安全的。
  // #1440：展开列表与主胶囊、面板同一条选路 —— 本机只读读数优先，快照兜底。只读快照的话，
  //   304 回包里挂的那张坏表会把「别的会话还有几张在办」也算成 0，标题栏跟着少报。
  const listPick = (typeof capsuleOwnRoutePick === 'function') ? capsuleOwnRoutePick(st) : null
  const listedView = (listPick && listPick.view) || ((typeof workRouteTableOf === 'function') ? workRouteTableOf(st) : null)
  const tableView = listedView
  const allRows = (tableView && Array.isArray(tableView.rows)) ? tableView.rows : []
  const otherRows = allRows.filter(function (r: any) { return r && r.currentSession !== true })
  const otherSet: any = {}
  for (let oi = 0; oi < otherRows.length; oi++) { const k = String((otherRows[oi] && otherRows[oi].sessionLabel) || ''); if (k) otherSet[k] = true }
  const otherCount = Object.keys(otherSet).length
  const nowMs = Date.now()
  const headTime = (typeof workRouteTableClock === 'function') ? workRouteTableClock(e && e.atIso, nowMs) : ''
  const displayed = view.list.slice().reverse()
  const eIsMap = e.isMap === true
  const text = chainKeyTextOf(eIsMap, e.ticketKey)
  const eState = e.ticketState === 'CLOSED' ? 'CLOSED' : (e.ticketState === 'OPEN' ? 'OPEN' : '')
  const eStateWord = eState === 'OPEN' ? tr('list.state.open') : (eState === 'CLOSED' ? tr('list.state.closed') : '')
  const eColor = eState === 'OPEN' ? '#58a6ff' : (eState === 'CLOSED' ? '#8b949e' : 'var(--dsw-alias-label-primary,#e6edf3)')
  const spoken = tr('chainView.capsuleDoing') + ' ' + (eIsMap ? tr('type.map') + ' ' : '') + '#' + e.ticketKey + (e.ticketTitle ? ' ' + e.ticketTitle : ' ' + tr('chainView.titleMissing')) + (eStateWord ? ' ' + eStateWord : '')
  const openRow = function (row: any) {
    return function (ev: any) {
      if (ev && ev.stopPropagation) ev.stopPropagation()
      try { capsuleOpenTicket(st, row) } catch (eOpen) {}
      try { openPanel(st) } catch (ePanel) {}
    }
  }
  const menu = (st.chainMenuOpen && st.chainMenuPos) ? PortalOverlay({
    className: 'dsws-chainmenu',
    onMouseEnter: function () { try { clearStatusClose(closeRef) } catch (eKeep) {} },
    onMouseLeave: function () { chainLater(st, closeRef) },
    onClick: function (ev: any) { if (ev && ev.stopPropagation) ev.stopPropagation() },
    style: {
      position: 'fixed', left: st.chainMenuPos.left, bottom: st.chainMenuPos.bottom,
      width: 420, maxWidth: 420, maxHeight: 380, overflowY: 'auto', padding: 4, zIndex: 2147483000,
      background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)',
      borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)',
    },
  }, [
    // #1404：表头是一行——左簇（标题 / 本会话条数 / 内部那条分隔线 / 更新时间）与右簇（组间那条分隔线 / 「另有 …」），
    //   两端对齐、整行不换行；没有别的会话时右簇与组间那条分隔线都不渲染，表头仍是一行高。
    chainHeaderOf(h, tr, displayed.length, otherCount, otherRows.length, headTime),
    displayed.map(function (r: any, i: any) {
      const word = r.actionKey ? tr(r.actionKey) : r.action
      const latest = i === displayed.length - 1
      const active = activeRow === i
      const rState = r.ticketState === 'CLOSED' ? 'CLOSED' : (r.ticketState === 'OPEN' ? 'OPEN' : '')
      const rStateWord = rState === 'OPEN' ? tr('list.state.open') : (rState === 'CLOSED' ? tr('list.state.closed') : '')
      const badgeColor = rState === 'OPEN' ? '#58a6ff' : (rState === 'CLOSED' ? '#8b949e' : (latest ? '#58a6ff' : '#8b8b95'))
      const badgeBorder = rState === 'OPEN' ? '#58a6ff' : (rState === 'CLOSED' ? '#8b949e' : (latest ? '#58a6ff' : '#3a3f4a'))
      const rIsMap = r.isMap === true
      const rowTime = (typeof workRouteTableClock === 'function') ? workRouteTableClock(r.atIso, nowMs) : ''
      const rowStale = capsuleStaleOf(r.at, nowMs)
      const staleWord = rowStale ? tr('chainView.capsuleStale') : ''
      const line = (rIsMap ? tr('type.map') + ' ' : '') + '#' + r.ticketKey + (r.ticketTitle ? ' ' + r.ticketTitle : ' ' + tr('chainView.titleMissing')) + (word ? ' ' + word : '') + (rowTime ? ' ' + rowTime : '') + (staleWord ? ' ' + staleWord : '') + (rStateWord ? ' ' + rStateWord : '')
      return h('div', {
        key: 'r' + i, tabIndex: 0, role: 'link', 'aria-label': line,
        className: 'dsws-chainmenu-row dsws-hov' + (active ? ' is-active' : '') + (latest ? ' is-latest' : ''),
        // 接线（#1335 界面反馈）：这一行用户点得到（点它开那张票并打开面板），所以整行接 row 这一档，
        // 文字行要有悬停反馈。日志标识带上行号与票号：同一张票在单子里可能占好几行，
        // 只用票号会撞名，所以行号在前、票号在后，拼起来既唯一又认得出是哪张票。
        'data-press': 'row',
        'data-log': 'status.chainmenu.row.' + i + '.' + r.ticketKey,
        onClick: openRow(r),
        onMouseEnter: function () { setActiveRow(i) },
        onMouseLeave: function () { setActiveRow(null) },
        onFocus: function () { setActiveRow(i) },
        onBlur: function () { setActiveRow(null) },
        onKeyDown: (function (rr: any) { return function (ev: any) { if (ev && (ev.key === 'Enter' || ev.key === ' ')) { if (ev.preventDefault) ev.preventDefault(); openRow(rr)(ev) } } })(r),
        style: {
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 4, cursor: 'pointer',
          fontSize: 12, color: rState === 'CLOSED' ? 'var(--dsw-alias-label-secondary,#a1a1aa)' : (latest || active ? 'var(--dsw-alias-label-primary,#e6edf3)' : 'var(--dsw-alias-label-secondary,#a1a1aa)'),
          background: active ? 'rgba(88,166,255,.12)' : 'transparent',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
      }, [
        // #780：地图那行的号徽章是「地图图标 + 裸号」，普通票那行仍是 `#号`
        h('span', { style: { flex: 'none', fontSize: 11, lineHeight: '16px', padding: '0 6px', borderRadius: 99, border: '1px solid ' + badgeBorder, color: badgeColor } }, rIsMap
          ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 3 } }, [chainMapIconOf(rIsMap, 11), h('span', null, chainKeyTextOf(rIsMap, r.ticketKey))])
          : chainKeyTextOf(rIsMap, r.ticketKey)),
        // #907：查不到标题就留白（一个字都不写），不再拿票号顶上 —— 那会让同一行出现两遍同一个号；
        //   「标题未取到」那句话只在文字通道里（上面 spoken 与 line 两处无障碍名）。
        h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.ticketTitle),
        word ? h('span', { style: { flex: 'none', fontSize: 11, lineHeight: '16px', padding: '1px 6px', borderRadius: 4, background: latest ? 'rgba(88,166,255,.14)' : 'rgba(139,139,149,.15)', color: latest ? '#8fb8ff' : '#a1a1aa' } }, word) : null,
        rowTime ? h('span', { style: { flex: 'none', fontSize: 11, color: '#8b8b95' } }, rowTime) : null,
        rowStale ? h('span', { style: { flex: 'none', fontSize: 11, lineHeight: '16px', padding: '1px 6px', borderRadius: 4, background: 'rgba(139,139,149,.15)', color: '#a1a1aa' } }, staleWord) : null,
      ])
    }),
  ]) : null
  return h('span', {
    ref: anchorRef,
    className: 'dsws-capsule-chain-anchor',
    style: { position: 'relative', display: 'inline-flex' },
    onMouseEnter: function () { chainShow(st, anchorRef, closeRef) },
    onMouseLeave: function () { chainLater(st, closeRef) },
  }, [
    h('span', {
      className: 'dsws-capsule-chain dsws-hov',
      tabIndex: 0,
      role: 'link',
      'aria-label': spoken + ' · ' + tr('chainView.openTip'),
      // 接线（#1335 界面反馈）：胶囊这一颗点了是开那张票并打开面板，它带文字（票号），
      // 所以按压与悬停都要有；日志标识 status.capsule.chain 与单子里那些行分开认。
      'data-press': 'button',
      'data-log': 'status.capsule.chain',
      onClick: function (ev: any) { if (ev && ev.stopPropagation) ev.stopPropagation(); try { capsuleOpenTicket(st, e) } catch (eOpen2) {} try { openPanel(st) } catch (ePanel2) {} },
      onKeyDown: function (ev: any) { if (ev && (ev.key === 'Enter' || ev.key === ' ')) { if (ev.preventDefault) ev.preventDefault(); try { capsuleOpenTicket(st, e) } catch (eOpen3) {} try { openPanel(st) } catch (ePanel3) {} } },
      // 用户 2026-10-21 实测：这颗「定位图标 + #票号」的焦点圈是直角，跟旁边那些圆角控件不统一。
      //   原因不是环画错了——环（悬停的内画描边与键盘焦点 outline）一直是跟着元素自己的边界形状走的，
      //   这一颗原先没写圆角，所以环四四方方。补一个轻微圆角（4px，与菜单项、折叠条一致），环自然跟着变圆。
      style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: eColor, cursor: 'pointer', borderRadius: 4 },
    }, [Ic({ n: 'pin', size: 12 }), chainMapIconOf(eIsMap, 12), h('span', { 'data-fold-priority': 12, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, text)]),
    menu,
  ])
}
