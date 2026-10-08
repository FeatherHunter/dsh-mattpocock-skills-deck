/**
 * statusbar/SessionChainCapsule.js — 状态栏胶囊里「这个会话在办哪张票」那一段
 *
 * 只做一件事：把宿主已经写下的处理链读数里，属于当前会话的那一格，挑最新一条画进胶囊。
 * 数据只有一个来源：面板快照的 sessionTickets 字段（宿主 refresh/sessionChainReadout.js 的产物），
 * 判据是 views/shared/sessionChainView.js 那一套（sessionChainRowsOf 给出行，里面带标题）。
 * 本文件不自己推断谁在办票、不读会话事件、不解析命令行、不读落盘文件。
 *
 * 三件事（第一性原理定案）：
 *   1. 跟谁走：只跟当前会话。快照里会话只以散列出现，所以用与链同一套散列
 *      （refresh-core/src/chain.ts 的 chainSessionShardId，djb2 加 fnv）把当前会话 id
 *      算成散列再对格子 —— 对不上就当没有，不把别的会话的票算到当前头上。
 *      散列函数在这里自带一份（不 import：叶子拼进同一闭包，跨文件引用走闭包同名；
 *      共享层零导入先例同形，见 agent-register.js 自带散列那一段）。
 *   2. 点开跳哪：点这一段就切列表页并打开那张票（复用 sessionChainView.js 的
 *      sessionChainOpenTicket，再把面板打开），悬停里给动作、时间与完整说明。
 *   3. 空态：没快照、没记录、当前会话没记录 —— 整段不画、不占位（与 #721「还没有就不画」
 *      同一条纪律）；真读坏了（read-failed / shape）画一枚 11 像素小图标，完整话进悬停，
 *      不独占一行（与 SessionChainStrip 那枚标记同形）。
 *
 * 折叠阶梯：这一段不进 capFold.js 的让位表（那张表被门禁钉死在 9 段，加一段就红），它是
 *   「载荷」—— 与计数器数字、段图标同类：任何宽度都不撤，只用省略号收宽度
 *   （maxWidth 加 ellipsis 加 flex 收缩）。没有记录时它根本不存在，所以窄宽度下它不占地方。
 *
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
 *   的 leaf 标记处（一源两物）。文案全部走词条（chainView.capsuleDoing 复用 action 词条与 openTip），
 *   本文件零中文字符串（门禁扫 CJK， locale-completeness 那条「干净」覆盖它）。
 */
function capHashDjb2(text) {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = (h << 5) + h + text.charCodeAt(i) >>> 0
  return ('0000000' + h.toString(16)).slice(-8)
}
function capHashFnv(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0
    h = Math.imul(h, 16777619) >>> 0
  }
  return ('0000000' + h.toString(16)).slice(-8)
}
/** 当前会话 id → 它在链里的那一格散列（与 chain.ts 的 chainSessionShardId 同算法）。 */
export const capsuleShardOf = function (sid) {
  const text = sid === null || sid === undefined ? '' : String(sid).trim()
  if (!text) return ''
  return capHashDjb2(text) + capHashFnv(text)
}

/**
 * 判据：只读 sessionChainRowsOf 的行，输出三种之一。
 *   · { state: 'idle' } / { state: 'empty' } —— 没快照、没记录、当前会话没记录：调用方整段不画。
 *   · { state: 'unreadable', reason } —— 读坏了：调用方画小图标。
 *   · { state: 'ok', entry, list } —— entry 是当前会话最新那一条（胶囊版面上只写它的号），
 *     list 是当前会话全部记录（从新到旧，悬停里列出来，最多 20 条）。
 */
export const sessionChainCapsuleOf = function (st, sid) {
  const rows = (typeof sessionChainRowsOf === 'function') ? sessionChainRowsOf(st) : []
  if (!rows.length) {
    const snap = (st && st.snapshot) ? st.snapshot : null
    if (!snap) return { state: 'idle', reason: '', entry: null, list: [] }
    const raw = snap[(typeof SESSION_CHAIN_FIELD === 'string') ? SESSION_CHAIN_FIELD : 'sessionTickets']
    // 与 sessionChainViewOf 同一条纪律：只有「还没有记录」归空，其余没取到都算读坏了。
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && raw.ok !== true &&
      String(raw.reason || '') !== 'host.chain.absent') {
      return { state: 'unreadable', reason: String(raw.reason || 'host.chain.shape'), entry: null, list: [] }
    }
    return { state: 'empty', reason: '', entry: null, list: [] }
  }
  const mine = capsuleShardOf(sid)
  if (!mine) return { state: 'empty', reason: '', entry: null, list: [] }
  const own = rows.filter(function (r) { return r && r.shardId === mine })
  if (!own.length) return { state: 'empty', reason: '', entry: null, list: [] }
  return { state: 'ok', reason: '', entry: own[0], list: own }
}

/** 关掉这张单子（开关与 BUG / 可接菜单同形：关标记、清位置、刷界面）。 */
function chainHide(st) {
  if (!st) return
  if (!st.chainMenuOpen && !st.chainMenuPos) return
  st.chainMenuOpen = false
  st.chainMenuPos = null
  try { emit(st) } catch (eEmit) {}
}

/** 打开这张单子：先把别家的单子收了（与 showStatusBugMenu 互斥同理），再按锚点定位。 */
function chainShow(st, anchorRef, closeRef) {
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
function chainLater(st, closeRef) {
  try { scheduleStatusClose(closeRef, function () { chainHide(st) }) } catch (eLater) { chainHide(st) }
}

/**
 * #780：号怎么写 —— 地图写裸号（`#` 那个位置让给地图图标），普通票写 `#号`。
 *   规则只写这一处：版面上那一段与悬停单子里每一行的徽章都读它，免得两处各写一遍、日后走岔。
 *   注意这只是**版面**的写法；文字通道（无障碍名与悬停提示）一律仍写 `#号`，见 spoken 与单子里的 line。
 */
const chainKeyTextOf = function (isMap, key) { return isMap === true ? String(key) : '#' + String(key) }
/**
 * #780：地图那一条的那枚图标（普通票没有这一枚；段首那枚图钉不在这里）。
 *   它必须是号那个元素的**兄弟节点** —— 收字机器往挂让位号的元素里写 textContent，塞进去会被抹掉。
 */
const chainMapIconOf = function (isMap, size) { return isMap === true ? Ic({ n: 'map', size: size }) : null }

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
export const SessionChainCapsule = function (props) {
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
  if (view.state === 'idle' || view.state === 'empty') return null
  if (view.state !== 'ok') {
    return h('span', { className: 'dsws-capsule-chain-broken', style: { display: 'inline-flex', alignItems: 'center', flex: 'none' } }, [
      h(Tip, { content: tr('chainView.unreadable') + ' ' + tr('chainView.unreadableTip', { reason: view.reason }) }, Ic({ n: 'alert', size: 11 })),
    ])
  }
  const e = view.entry
  // 单子从旧到新往下排：最新那一条沉底，离鼠标最近；链里最多 20 条，全部列出不折叠。
  // 版面上那个号（下面那个 text span）挂在让位表第 12 号：宽度不够时它也逐字让（最后几位才让），
  //   让位机直接往纯文本元素里写字，这里两处（版面号、环境计数都是纯文本）都是安全的。
  const displayed = view.list.slice().reverse()
  const eIsMap = e.isMap === true
  const text = chainKeyTextOf(eIsMap, e.ticketKey)
  const eState = e.ticketState === 'CLOSED' ? 'CLOSED' : (e.ticketState === 'OPEN' ? 'OPEN' : '')
  const eStateWord = eState === 'OPEN' ? tr('list.state.open') : (eState === 'CLOSED' ? tr('list.state.closed') : '')
  const eColor = eState === 'OPEN' ? '#58a6ff' : (eState === 'CLOSED' ? '#8b949e' : 'var(--dsw-alias-label-primary,#e6edf3)')
  const spoken = tr('chainView.capsuleDoing') + ' ' + (eIsMap ? tr('type.map') + ' ' : '') + '#' + e.ticketKey + (e.ticketTitle ? ' ' + e.ticketTitle : ' ' + tr('chainView.titleMissing')) + (eStateWord ? ' ' + eStateWord : '')
  const openRow = function (row) {
    return function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation()
      try { sessionChainOpenTicket(st, row) } catch (eOpen) {}
      try { openPanel(st) } catch (ePanel) {}
    }
  }
  const menu = (st.chainMenuOpen && st.chainMenuPos) ? PortalOverlay({
    className: 'dsws-chainmenu',
    onMouseEnter: function () { try { clearStatusClose(closeRef) } catch (eKeep) {} },
    onMouseLeave: function () { chainLater(st, closeRef) },
    onClick: function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation() },
    style: {
      position: 'fixed', left: st.chainMenuPos.left, bottom: st.chainMenuPos.bottom,
      minWidth: 240, maxWidth: 340, maxHeight: 380, overflowY: 'auto', padding: 4, zIndex: 2147483000,
      background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)',
      borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)',
    },
  }, [
    h('div', { key: 'head', style: { fontSize: 11, lineHeight: '18px', padding: '2px 8px', color: 'var(--dsws-label-caption,#8b8b95)' } }, tr('chainView.capsuleListTitle')),
    displayed.map(function (r, i) {
      const word = r.actionKey ? tr(r.actionKey) : r.action
      const latest = i === displayed.length - 1
      const active = activeRow === i
      const rState = r.ticketState === 'CLOSED' ? 'CLOSED' : (r.ticketState === 'OPEN' ? 'OPEN' : '')
      const rStateWord = rState === 'OPEN' ? tr('list.state.open') : (rState === 'CLOSED' ? tr('list.state.closed') : '')
      const badgeColor = rState === 'OPEN' ? '#58a6ff' : (rState === 'CLOSED' ? '#8b949e' : (latest ? '#58a6ff' : '#8b8b95'))
      const badgeBorder = rState === 'OPEN' ? '#58a6ff' : (rState === 'CLOSED' ? '#8b949e' : (latest ? '#58a6ff' : '#3a3f4a'))
      const rIsMap = r.isMap === true
      const line = (rIsMap ? tr('type.map') + ' ' : '') + '#' + r.ticketKey + (r.ticketTitle ? ' ' + r.ticketTitle : ' ' + tr('chainView.titleMissing')) + (word ? ' ' + word : '') + (r.time ? ' ' + r.time : '') + (rStateWord ? ' ' + rStateWord : '')
      return h('div', {
        key: 'r' + i, tabIndex: 0, role: 'link', 'aria-label': line,
        className: 'dsws-chainmenu-row' + (active ? ' is-active' : '') + (latest ? ' is-latest' : ''),
        onClick: openRow(r),
        onMouseEnter: function () { setActiveRow(i) },
        onMouseLeave: function () { setActiveRow(null) },
        onFocus: function () { setActiveRow(i) },
        onBlur: function () { setActiveRow(null) },
        onKeyDown: (function (rr) { return function (ev) { if (ev && (ev.key === 'Enter' || ev.key === ' ')) { if (ev.preventDefault) ev.preventDefault(); openRow(rr)(ev) } } })(r),
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
        r.time ? h('span', { style: { flex: 'none', fontSize: 11, color: '#8b8b95' } }, r.time) : null,
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
      className: 'dsws-capsule-chain',
      tabIndex: 0,
      role: 'link',
      'aria-label': spoken + ' · ' + tr('chainView.openTip'),
      onClick: function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); try { sessionChainOpenTicket(st, e) } catch (eOpen2) {} try { openPanel(st) } catch (ePanel2) {} },
      onKeyDown: function (ev) { if (ev && (ev.key === 'Enter' || ev.key === ' ')) { if (ev.preventDefault) ev.preventDefault(); try { sessionChainOpenTicket(st, e) } catch (eOpen3) {} try { openPanel(st) } catch (ePanel3) {} } },
      style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: eColor, cursor: 'pointer' },
    }, [Ic({ n: 'pin', size: 12 }), chainMapIconOf(eIsMap, 12), h('span', { 'data-fold-priority': 12, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, text)]),
    menu,
  ])
}
