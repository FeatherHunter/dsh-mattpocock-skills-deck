/**
 * src/client/statusbar/deckDoor.ts — #1612 状态栏胶囊上那扇「关/开整个 deck」的门
 * #1655 起两边都是跟随式二次确认（红色叉关闭 / 展开条展开），老的全屏居中确认框已下线。
 *
 * 契约：本文件是界面叶子（ESM 导出）；scripts/build.mts 构建时去掉每行行首 export 关键字，把声明体文本
 *   拼回 src/client/index.ts 里 leaf:deckDoor 拼接标记处（apply 闭包内原位，排在 statusBar 之前）。
 *   约束与其它叶子相同：不许运行时 import（跨文件名字一律 ambient declare），不许 export default，
 *   只写可剥离的 TypeScript。
 *
 * 这里装六件事（#1612 验收 ③④⑤ 与 ② 的界面侧，#1655 把 ③④ 都改成跟随式）：
 *   · 胶囊展开时，在「∨」右边一颗红色「X」：点它先在叉旁边冒跟随小浮层，确认才关闭整个 deck
 *     （工具、胶囊、右侧面板三处一起关）；点浮层外面、按退出键、点取消都算取消，一个开关都不写。
 *   · 「∨」的语义收窄成只折叠胶囊：只写 statusBar，不碰 deckTools，所以工具与右侧面板都照旧。
 *   · 折叠条上那颗「展开」：deck 开着就直接展开胶囊；deck 关着时先冒跟随在展开键旁边的小浮层，
 *     写明会开启 deck 工具箱、右侧面板和胶囊状态栏，确认后三处一起开、取消什么都不改。
 *   · 两处跟随浮层（关 deckDoorCloseConfirmEl / 开 deckDoorConfirmEl）：开关各一颗会话布尔旗，
 *     关了会话就没，不落盘；定位都走悬停提示那份纯函数（上方优先、放不下翻面、贴边内收、宽 220）。
 *   · 写设置文件那条路接不下时浮层不收，原地提示一句没关掉或没打开、请再试一次。
 *   · 点一下的动作各带一颗 data-log（#1335 界面反馈的口径）：关那边三颗（确认/取消/遮罩）与开那边三颗互相分开，
 *     全仓唯一，门禁按文件与全仓两层查。
 * 样式沿用状态栏门控窗与 LogDangerConfirm.ts 那一套（同一组 CSS 变量、同样的按钮类名），不引新颜色。
 */
declare function isDeckClosed(...args: any[]): any
declare function setDeckTools(...args: any[]): any
declare function setDeckStatusBar(...args: any[]): any
declare function togglePanel(...args: any[]): any
declare function openPanel(...args: any[]): any
declare function computeTipPlace(...args: any[]): any
declare const Ic: any
declare const Tip: any

// 跟随浮层的宽度上限：与悬停提示共用 220（#1655 实现决策：锚定规则直接复用，不新写定位）。
// 定位本身只调 computeTipPlace（views/primitives/tipPlace.ts 那份纯函数）；它缺席时（生产闭包里不会缺，
// 构建顺序 tipPlace 排在 deckDoor 之前）退回无坐标渲染，保证不抛、门禁可断言形态。
const DECK_DOOR_TIP_WIDTH = 220
// 首帧估高：确认卡的真实高度要挂载后才量得到（ref 回调里按实测纠正），首帧先按这个估算决定朝向与横坐标。
// 红色叉与展开键都住在底部的状态栏一带，上方几乎总有整块地方，所以估差只影响矮窗口那一次翻面，纠正后即贴住。
const DECK_DOOR_TIP_EST_HEIGHT = 180

// 点按钮那一下把锚与视口快照进会话状态（纯数字，不存 DOM 节点）：
//   锚从点到的那颗按钮量（e.currentTarget.getBoundingClientRect），视口读 window，拿不到就记 null。
// 渲染只认这两份快照（不读实时 DOM），所以门禁用合成矩形就能盖住定位分支；挂载后 ref 再按实测纠正一次。
const deckDoorCapture = function (st: any, el: any, anchorKey: string, viewportKey: string): void {
  try {
    let r: any = null
    try { if (el && typeof el.getBoundingClientRect === 'function') r = el.getBoundingClientRect() } catch (eR) {}
    if (r && (r.width || r.height || r.left || r.top || r.right || r.bottom)) {
      try { st[anchorKey] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } } catch (eA) {}
    } else {
      try { st[anchorKey] = null } catch (eA2) {}
    }
  } catch (e) { try { st[anchorKey] = null } catch (e2) {} }
  try {
    if (typeof window !== 'undefined' && window && typeof window.innerWidth === 'number' && typeof window.innerHeight === 'number') {
      try { st[viewportKey] = { width: window.innerWidth, height: window.innerHeight } } catch (eV) {}
    } else {
      try { st[viewportKey] = null } catch (eV2) {}
    }
  } catch (eW) { try { st[viewportKey] = null } catch (eW2) {} }
}

// 跟随落点：锚、视口、卡片尺寸按 computeTipPlace 的入参顺序传，拿回左上角与实际生效宽度。
// 首帧按估高算，ref 回调里按实测重算一次；算不出（无锚、无视口、函数缺席）就回 null，调用处退回无坐标渲染。
const deckDoorPlace = function (st: any, anchorKey: string, viewportKey: string, tipH: any): any {
  try {
    if (typeof computeTipPlace !== 'function') return null
    let anchor: any = null
    try { anchor = st ? st[anchorKey] : null } catch (eA) {}
    if (!anchor) return null
    let vp: any = null
    try { vp = st ? st[viewportKey] : null } catch (eV) {}
    if (!vp) return null
    const h = (typeof tipH === 'number' && isFinite(tipH) && tipH > 0) ? tipH : DECK_DOOR_TIP_EST_HEIGHT
    return computeTipPlace(anchor, { width: DECK_DOOR_TIP_WIDTH, height: h }, vp, DECK_DOOR_TIP_WIDTH)
  } catch (e) { return null }
}

// 挂载后按实测纠正一次（首帧是估高，矮窗口下翻面可能差一次）：量卡片真实宽高，用实时视口重算，
// 对回 left/top/maxWidth。ref 在单测桩里永远不会被调用，所以门禁只看首帧；真机上纠正后即贴住按钮。
const deckDoorCorrectRef = function (st: any, anchorKey: string, viewportKey: string): any {
  return function (node: any): void {
    try {
      if (!node || typeof node.getBoundingClientRect !== 'function') return
      let r: any = null
      try { r = node.getBoundingClientRect() } catch (eR) { return }
      if (!r || !r.width || !r.height) return
      if (typeof computeTipPlace !== 'function') return
      let anchor: any = null
      try { anchor = st ? st[anchorKey] : null } catch (eA) {}
      if (!anchor) return
      let vp: any = null
      try {
        if (typeof window !== 'undefined' && window && typeof window.innerWidth === 'number' && typeof window.innerHeight === 'number') {
          vp = { width: window.innerWidth, height: window.innerHeight }
        } else if (st) { vp = st[viewportKey] || null }
      } catch (eV) { try { vp = st ? st[viewportKey] : null } catch (eV2) {} }
      if (!vp) return
      let placed: any = null
      try { placed = computeTipPlace(anchor, { width: r.width, height: r.height }, vp, DECK_DOOR_TIP_WIDTH) } catch (eP) { return }
      if (!placed || typeof placed.x !== 'number' || typeof placed.y !== 'number') return
      try { node.style.left = placed.x + 'px' } catch (eX) {}
      try { node.style.top = placed.y + 'px' } catch (eY) {}
      try { if (typeof placed.effectiveMaxWidth === 'number' && placed.effectiveMaxWidth > 0) node.style.maxWidth = placed.effectiveMaxWidth + 'px' } catch (eM) {}
    } catch (e) {}
  }
}

// 两处跟随浮层共用的卡片与透明遮罩（#1655 实现决策：开与关学同一套）：
//   卡片是 role=dialog 的对话框（无障碍名取标题键，确认键自动聚焦）；遮罩透明只为接住点外面，不挡视线。
//   点外面、按退出键、点取消都走 onCancel（一个开关都不写）；点确认走 onConfirm。
const deckDoorFollowCard = function (h: any, st: any, opts: any): any {
  try {
    const o: any = opts || {}
    const close = function (): void { try { if (typeof o.onCancel === 'function') o.onCancel() } catch (e) {} }
    const confirm = function (): void { try { if (typeof o.onConfirm === 'function') o.onConfirm() } catch (e) {} }
    const placed: any = deckDoorPlace(st, o.anchorKey, o.viewportKey, 0)
    const effW = (placed && typeof placed.effectiveMaxWidth === 'number' && placed.effectiveMaxWidth > 0) ? placed.effectiveMaxWidth : DECK_DOOR_TIP_WIDTH
    const cardStyle: any = { position: 'fixed', background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 12, padding: 16, width: '100%', maxWidth: effW, boxShadow: '0 8px 30px rgba(0,0,0,.45)', boxSizing: 'border-box' }
    try { if (placed && typeof placed.x === 'number' && typeof placed.y === 'number') { cardStyle.left = placed.x; cardStyle.top = placed.y } } catch (eXY) {}
    const onKey = function (e: any): void {
      try {
        const k = e && e.key
        if (k === 'Escape' || k === 'Esc') { try { if (e.stopPropagation) e.stopPropagation() } catch (eS) {} close() }
      } catch (eK) {}
    }
    let failOn = false
    try { failOn = !!st[o.failKey] } catch (eF) {}
    const card = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': tr(o.titleKey), ref: deckDoorCorrectRef(st, o.anchorKey, o.viewportKey), style: cardStyle }, [
      h('div', { style: { fontSize: 14, fontWeight: 700, marginBottom: 6 } }, tr(o.titleKey)),
      h('div', { style: { fontSize: 12, color: '#9a9aa5', marginBottom: 12, lineHeight: 1.6 } }, tr(o.bodyKey)),
      failOn ? h('div', { style: { fontSize: 12, color: '#f87171', marginBottom: 8, lineHeight: 1.5 } }, tr(o.failTextKey)) : null,
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } }, [
        h('button', { className: 'dsws-btn ghost dsws-hov', 'data-press': 'button', 'data-log': o.cancelLog, onClick: function (e: any) { e.stopPropagation(); close() }, style: { fontSize: 12 } }, tr(o.cancelKey)),
        h('button', { className: 'dsws-btn dsws-hov', 'data-press': 'button', 'data-log': o.confirmLog, autoFocus: true, onClick: function (e: any) { e.stopPropagation(); confirm() }, style: { fontSize: 12 } }, tr(o.okKey)),
      ]),
    ])
    return h('div', { onClick: function (e: any) { if (e.target === e.currentTarget) close() }, onKeyDown: onKey, 'data-press': 'other', 'data-log': o.backdropLog, style: { position: 'fixed', inset: 0, zIndex: 30, background: 'transparent' } }, [card])
  } catch (e) { return null }
}

// 胶囊显示/折叠只走本机设置文件那一条路（kernel/deck-state.ts 的 setDeckStatusBar），接不下时该函数如实返回 false。
// 旧 localStorage 表（dsws.bannerFold）与旧字段 bannerFolded 已退役（维护者 2026-10-29 拍板删掉迁移）：这里既不读也不写。


// 折叠条上那颗「展开」按钮点下去先走这里（StatusBar 的 expandBanner 转调，按钮本体一并传进来留锚）。
// deck 关着时不能直接展开：那样胶囊显示出来、工具与面板却还是关的，三处对不上；
// 所以只把确认框标记置上、记下锚与视口、emit 一次让界面画出跟随浮层。deck 开着时才直接写 statusBar=show。
export const deckDoorExpand = function (st: any, el?: any): void {
  try {
    if (isDeckClosed(st && st.cwd)) {
      try { st.deckDoorConfirm = true } catch (eF) {}
      try { st.deckDoorConfirmFail = false } catch (eFF) {}
      deckDoorCapture(st, el, 'deckDoorConfirmAnchor', 'deckDoorConfirmViewport')
      try { emit(st) } catch (eE) {}
      return
    }
    setDeckStatusBar(st && st.cwd, true)
  } catch (e) {}
}

// 「∨」：只折叠胶囊，不动 deck 工具箱（验收 ⑤：只关胶囊时工具与右侧面板都不受影响）。
// 横幅上那些叉按钮也转调这里——它们此前等价于「收起整个功能区」，现在等价于「∨」。
export const deckDoorFold = function (st: any): void {
  try { setDeckStatusBar(st && st.cwd, false) } catch (e) {}
}

// 红色「X」点下去先走这里（胶囊尾部那颗叉调它，按钮本体一并传进来留锚）：
// 只冒跟随浮层，一个开关都不写；真正关三处走下面的 deckDoorCloseDeck（浮层里那颗确认键调它）。
export const deckDoorCloseRequest = function (st: any, el?: any): void {
  try {
    try { st.deckDoorCloseConfirm = true } catch (eF) {}
    try { st.deckDoorCloseFail = false } catch (eFF) {}
    deckDoorCapture(st, el, 'deckDoorCloseAnchor', 'deckDoorCloseViewport')
    try { emit(st) } catch (eE) {}
  } catch (e) {}
}

// 跟随浮层的取消口径（点外面、按退出键、点取消都到这里）：只收旗，一个开关都不写。
export const deckDoorCloseCancel = function (st: any): void {
  try {
    try { st.deckDoorCloseConfirm = false } catch (eF) {}
    try { st.deckDoorCloseFail = false } catch (eFF) {}
    try { st.deckDoorCloseAnchor = null } catch (eA) {}
    try { st.deckDoorCloseViewport = null } catch (eV) {}
    try { emit(st) } catch (eE) {}
  } catch (e) {}
}

// 确认关闭的执行（验收 ④，顺序与 #1612 一字不动：先关右侧面板、再把工具箱写成关，胶囊随整扇门收起）：
// 平台限制：宿主右栏没有「按会话关掉某一格」的接口，所以这里只能把面板状态改回关、保证不再新开；
// 已经开着的右栏标签要等下次刷新页面才消失（票面允许的退路，router.ts 里同一段也有说明）。
// 写设置文件那条路接不下（返回非 true）时不许不动声色地失败：面板改回点之前那样，浮层不收并竖起失败提示。
export const deckDoorCloseDeck = function (st: any): void {
  try {
    let wasOpen = false
    try { wasOpen = !!(st && st.open) } catch (eO) {}
    try { if (wasOpen && typeof togglePanel === 'function') togglePanel(st) } catch (ePanel) {}
    let ok = false
    try { ok = setDeckTools(st && st.cwd, false) === true } catch (eDeck) { ok = false }
    if (!ok) {
      try { if (st) { st.open = wasOpen; st.deckDoorCloseFail = true; emit(st) } } catch (eF) {}
      return
    }
    try {
      if (st) {
        try { st.deckDoorCloseConfirm = false } catch (e1) {}
        try { st.deckDoorCloseFail = false } catch (e2) {}
        try { st.deckDoorCloseAnchor = null } catch (e3) {}
        try { st.deckDoorCloseViewport = null } catch (e4) {}
        try { st.deckDoorConfirm = false } catch (e5) {}
      }
    } catch (eC) {}
    try { emit(st) } catch (eEmit) {}
  } catch (e) {}
}

// 胶囊尾部那两个控件：先原样的「∨」，再一颗红色「X」。X 与胶囊里既有小控件同尺寸（12px 图标、2px 内边距），
// 不撑破胶囊；悬停提示与无障碍名都说明它是「关闭整个 deck」，不是收起这一条。
// X 点下去只冒跟随浮层（deckDoorCloseRequest），不再直关三处。
export const deckDoorCapsuleTail = function (h: any, st: any, capsuleToggle: any): any {
  const tail: any[] = []
  try { if (capsuleToggle) tail.push(capsuleToggle) } catch (eToggle) {}
  try {
    tail.push(h(Tip, { key: 'deckCloseToggle', content: tr('banner.deckDoorTip') }, h('span', {
      className: 'dsws-fold-toggle',
      onClick: function (e: any) { e.stopPropagation(); deckDoorCloseRequest(st, e && e.currentTarget) },
      'aria-label': tr('banner.deckDoorClose'),
      'data-press': 'icon',
      'data-log': 'status.capsule.deckclose',
      style: { display: 'inline-flex', alignItems: 'center', padding: '2px 2px', borderRadius: 6, color: '#f87171', cursor: 'pointer', flex: 'none' },
    }, [Ic({ n: 'x', size: 12 })])))
  } catch (eX) {}
  return tail
}

// 关闭的跟随浮层（#1655 T1）：点红色叉后冒在叉旁边，标题写明关整个门，正文列出三处并写清回去的路。
// 确认走上面的 deckDoorCloseDeck（先关面板、再写工具箱关），取消只收旗、一个开关都不写。
export const deckDoorCloseConfirmEl = function (h: any, st: any): any {
  try {
    if (!st || st.deckDoorCloseConfirm !== true) return null
    return deckDoorFollowCard(h, st, {
      titleKey: 'banner.deckCloseTitle',
      bodyKey: 'banner.deckCloseBody',
      okKey: 'banner.deckCloseOk',
      cancelKey: 'banner.deckCloseCancel',
      failKey: 'deckDoorCloseFail',
      failTextKey: 'banner.deckCloseFail',
      confirmLog: 'status.deckdoor.close.confirm',
      cancelLog: 'status.deckdoor.close.cancel',
      backdropLog: 'status.deckdoor.close.backdrop',
      anchorKey: 'deckDoorCloseAnchor',
      viewportKey: 'deckDoorCloseViewport',
      onConfirm: function (): void { deckDoorCloseDeck(st) },
      onCancel: function (): void { deckDoorCloseCancel(st) },
    })
  } catch (e) { return null }
}

// 折叠条「展开」的跟随浮层（验收 ③，#1655 起不再是全屏居中框）：deck 关着时点展开先问一句，
// 写明会开启哪三处。状态放在 st.deckDoorConfirm（会话状态，不落盘）；确认与取消口径与关那边对称。
// 确认 = 三处一起恢复（deck 工具箱开、胶囊显示、右侧面板也重新打开）；取消 = 只收起浮层、一个开关都不写。
// 写设置文件那条路接不下时浮层不收，原地提示没打开、请再试一次。
export const deckDoorConfirmEl = function (h: any, st: any): any {
  try {
    if (!st || st.deckDoorConfirm !== true) return null
    const cancel = function (): void {
      try { st.deckDoorConfirm = false } catch (e1) {}
      try { st.deckDoorConfirmFail = false } catch (e2) {}
      try { st.deckDoorConfirmAnchor = null } catch (e3) {}
      try { st.deckDoorConfirmViewport = null } catch (e4) {}
      try { emit(st) } catch (e5) {}
    }
    // 确认三处一起恢复的顺序必须「先写 deckTools、再开面板」：router.openPanel 会按 deck 状态拦，反了会被自己的闸门挡住。
    // 任一开关没写进去（返回非 true）都不许假装成功：浮层不收并竖起失败提示，由用户再点一次（幂等，可重入）。
    const confirm = function (): void {
      let okTools = false
      try { okTools = setDeckTools(st && st.cwd, true) === true } catch (e1) { okTools = false }
      let okBar = false
      try { if (okTools) okBar = setDeckStatusBar(st && st.cwd, true) === true } catch (e2) { okBar = false }
      if (!okTools || !okBar) {
        try { st.deckDoorConfirmFail = true; emit(st) } catch (eF) {}
        return
      }
      try { if (typeof openPanel === 'function') openPanel(st) } catch (e3) {}
      try {
        st.deckDoorConfirm = false
        try { st.deckDoorConfirmFail = false } catch (e4) {}
        try { st.deckDoorConfirmAnchor = null } catch (e5) {}
        try { st.deckDoorConfirmViewport = null } catch (e6) {}
      } catch (e0) {}
      try { emit(st) } catch (e7) {}
    }
    return deckDoorFollowCard(h, st, {
      titleKey: 'banner.deckReopenTitle',
      bodyKey: 'banner.deckReopenBody',
      okKey: 'banner.deckReopenOk',
      cancelKey: 'banner.deckReopenCancel',
      failKey: 'deckDoorConfirmFail',
      failTextKey: 'banner.deckReopenFail',
      confirmLog: 'status.deckdoor.confirm',
      cancelLog: 'status.deckdoor.cancel',
      backdropLog: 'status.deckdoor.backdrop',
      anchorKey: 'deckDoorConfirmAnchor',
      viewportKey: 'deckDoorConfirmViewport',
      onConfirm: confirm,
      onCancel: cancel,
    })
  } catch (e) { return null }
}
