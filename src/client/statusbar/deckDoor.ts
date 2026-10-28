/**
 * src/client/statusbar/deckDoor.ts — #1612 状态栏胶囊上那扇「关/开整个 deck」的门
 *
 * 契约：本文件是界面叶子（ESM 导出）；scripts/build.mts 构建时去掉每行行首 export 关键字，把声明体文本
 *   拼回 src/client/index.ts 里 leaf:deckDoor 拼接标记处（apply 闭包内原位，排在 statusBar 之前）。
 *   约束与其它叶子相同：不许运行时 import（跨文件名字一律 ambient declare），不许 export default，
 *   只写可剥离的 TypeScript。
 *
 * 这里装四件事（#1612 验收 ③④⑤ 与 ② 的界面侧）：
 *   · 胶囊展开时，在「∨」右边多一颗红色「X」：点它关闭该工作区的整个 deck（工具、胶囊、右侧面板三处一起关）。
 *   · 「∨」的语义收窄成只折叠胶囊：只写 statusBar，不碰 deckTools，所以工具与右侧面板都照旧。
 *   · 点折叠条上的「展开」时：deck 开着就直接展开胶囊；deck 关着就先弹确认框，写明会开启 deck 工具箱、
 *     右侧面板和胶囊状态栏，确认后三处一起开、取消什么都不改。
 *   · 确认框本体（deckDoorConfirmEl）：显示与否放在会话状态 st.deckDoorConfirm 上，开、关都 emit(st) 重画。
 *
 * 点一下的动作各带一颗 data-log（#1335 界面反馈的口径：界面点击记一行事件）。这里不新造 log() 事件，
 * 免得动日志事件清单那份真源；data-log 名称在全仓唯一，门禁按文件与全仓两层查。
 * 样式沿用状态栏门控窗与 LogDangerConfirm.ts 那一套（同一组 CSS 变量、同样的按钮类名）。
 */
declare function isDeckClosed(...args: any[]): any
declare function setDeckTools(...args: any[]): any
declare function setDeckStatusBar(...args: any[]): any
declare function togglePanel(...args: any[]): any
declare function openPanel(...args: any[]): any
declare const Ic: any
declare const Tip: any

// 胶囊显示/折叠只走本机设置文件那一条路（kernel/deck-state.ts 的 setDeckStatusBar），接不下时该函数如实返回 false。
// 这里不把旧 localStorage 表（dsws.bannerFold）写回去 —— #1612 要求旧状态只读一次做迁移，迁移后不再写旧键。


// 折叠条上那颗「展开」按钮点下去先走这里（StatusBar 的 expandBanner 转调）。
// deck 关着时不能直接展开：那样胶囊显示出来、工具与面板却还是关的，三处对不上；
// 所以只把确认框标记置上、emit 一次让界面画出确认框。deck 开着时才直接写 statusBar=show。
export const deckDoorExpand = function (st: any): void {
  try {
    if (isDeckClosed(st && st.cwd)) { st.deckDoorConfirm = true; emit(st); return }
    setDeckStatusBar(st && st.cwd, true)
  } catch (e) {}
}

// 「∨」：只折叠胶囊，不动 deck 工具箱（验收 ⑤：只关胶囊时工具与右侧面板都不受影响）。
// 横幅上那些叉按钮也转调这里——它们此前等价于「收起整个功能区」，现在等价于「∨」。
export const deckDoorFold = function (st: any): void {
  try { setDeckStatusBar(st && st.cwd, false) } catch (e) {}
}

// 红色「X」：关掉该工作区的整个 deck —— 工具箱、胶囊、右侧面板三处一起关（验收 ④）。
// 顺序必须「先关右侧面板、再写 deckTools=off」：router 的 openPanel 对 deck 关着的工作区会拒开，
// 反过来先写 deckTools 的话，关面板那一步会被自己的闸门挡住（而且面板状态已经和 deck 对不上）。
// 平台限制：宿主右栏没有「按会话关掉某一格」的接口，所以这里只能把面板状态改回关、保证不再新开；
// 已经开着的右栏标签要等下次刷新页面才消失（票面允许的退路，router.ts 里同一段也有说明）。
export const deckDoorCloseDeck = function (st: any): void {
  // 记下关之前面板是不是开着：确认重开时按这一格把右侧面板恢复回去（验收 ③ 说的「三处恢复」）。
  try { if (st) st.deckDoorPanelWasOpen = !!(st.open) } catch (eWas) {}
  try { if (st && st.open && typeof togglePanel === 'function') togglePanel(st) } catch (ePanel) {}
  try { if (st) st.deckDoorConfirm = false } catch (eConfirm) {}
  try { setDeckTools(st && st.cwd, false) } catch (eDeck) {}
  try { emit(st) } catch (eEmit) {}
}

// 胶囊尾部那两个控件：先原样的「∨」，再一颗红色「X」。X 与胶囊里既有小控件同尺寸（12px 图标、2px 内边距），
// 不撑破胶囊；悬停提示与无障碍名都说明它是「关闭整个 deck」，不是收起这一条。
export const deckDoorCapsuleTail = function (h: any, st: any, capsuleToggle: any): any {
  const tail: any[] = []
  try { if (capsuleToggle) tail.push(capsuleToggle) } catch (eToggle) {}
  try {
    tail.push(h(Tip, { key: 'deckCloseToggle', content: tr('banner.deckDoorTip') }, h('span', {
      className: 'dsws-fold-toggle',
      onClick: function (e: any) { e.stopPropagation(); deckDoorCloseDeck(st) },
      'aria-label': tr('banner.deckDoorClose'),
      'data-press': 'icon',
      'data-log': 'status.capsule.deckclose',
      style: { display: 'inline-flex', alignItems: 'center', padding: '2px 2px', borderRadius: 6, color: '#f87171', cursor: 'pointer', flex: 'none' },
    }, [Ic({ n: 'x', size: 12 })])))
  } catch (eX) {}
  return tail
}

// 折叠条「展开」的确认框（验收 ③）：deck 关着时点展开先问一句，写明会开启哪三处。
// 状态放在 st.deckDoorConfirm（会话状态，不落盘）；确认 = 两个开关都写成开、右侧面板按关之前那一格恢复，
// 取消 = 只收起确认框、一个开关都不写。按钮与遮罩的点击都 stopPropagation，免得冒到下层折叠条。
export const deckDoorConfirmEl = function (h: any, st: any): any {
  try {
    if (!st || st.deckDoorConfirm !== true) return null
    const close = function (): void { try { st.deckDoorConfirm = false; emit(st) } catch (e) {} }
    // 确认 = 三处一起恢复：deck 工具箱开、胶囊显示、右侧面板回到红色 X 关掉之前那样（点在 X 上时记下的那一格）。
    // 顺序必须「先写 deckTools、再开面板」：router.openPanel 会按 deck 状态拦，反了会被自己的闸门挡住。
    const confirm = function (): void {
      try { st.deckDoorConfirm = false } catch (e0) {}
      try { setDeckTools(st && st.cwd, true) } catch (e1) {}
      try { setDeckStatusBar(st && st.cwd, true) } catch (e2) {}
      try {
        if (st && st.deckDoorPanelWasOpen === true) {
          st.deckDoorPanelWasOpen = false
          if (typeof openPanel === 'function') openPanel(st)
        }
      } catch (e3) {}
      try { emit(st) } catch (e4) {}
    }
    const card = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('banner.deckReopenTitle'),
      style: { background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 12, padding: 16, width: '100%', maxWidth: 380, boxShadow: '0 8px 30px rgba(0,0,0,.45)', boxSizing: 'border-box' } }, [
      h('div', { style: { fontSize: 14, fontWeight: 700, marginBottom: 6 } }, tr('banner.deckReopenTitle')),
      h('div', { style: { fontSize: 12, color: '#9a9aa5', marginBottom: 12, lineHeight: 1.6 } }, tr('banner.deckReopenBody')),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } }, [
        h('button', { className: 'dsws-btn ghost dsws-hov', 'data-press': 'button', 'data-log': 'status.deckdoor.cancel', onClick: function (e: any) { e.stopPropagation(); close() }, style: { fontSize: 12 } }, tr('banner.deckReopenCancel')),
        h('button', { className: 'dsws-btn dsws-hov', 'data-press': 'button', 'data-log': 'status.deckdoor.confirm', autoFocus: true, onClick: function (e: any) { e.stopPropagation(); confirm() }, style: { fontSize: 12 } }, tr('banner.deckReopenOk')),
      ]),
    ])
    // 遮罩铺满视口（折叠条容器本身没有定位上下文，用 fixed 才盖得住）；点空白处等同取消。
    return h('div', { onClick: function (e: any) { if (e.target === e.currentTarget) close() },
      'data-press': 'other',
      'data-log': 'status.deckdoor.backdrop',
      style: { position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 } }, [card])
  } catch (e) { return null }
}
