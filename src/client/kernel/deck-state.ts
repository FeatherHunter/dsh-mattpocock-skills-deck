/**
 * src/client/kernel/deck-state.ts — #1612 两个按工作区开关（状态栏胶囊 / deck 工具箱）的唯一读口与写口
 *
 * 契约：本文件是内核模块（ESM 导出）；scripts/build.mts 构建时去掉每行行首 export 关键字，把声明体文本
 *   拼回 src/client/index.ts 里那一行 kernel:deckState 拼接标记处（apply 闭包内原位），与其它内核片同模式。
 *
 * 为什么单独一片：本票有四处要读同两个开关（状态栏胶囊、设置页工作区表、提示词注入、右侧面板打开口）。
 *   如果每处各判各的，就会出现「胶囊已经折叠、工具却还开着」这种谁也解释不了的错位；所以取值口径与两笔写
 *   都收在这里，调用方只问下面这几个名字。
 *
 * 语义（#1612 维护者拍板）：
 *   · statusBar：'show' 显示胶囊；'hide' 折叠（缺省）。胶囊折叠时那颗胶囊换成折叠条，环境检查类横幅一起不显示。
 *   · deckTools：'on' 启用 deck（缺省）；'off' 关闭 —— 该工作区工具、胶囊、右侧面板三处一起关。
 *   · 胶囊实际折没折 = deck 关了**或者** statusBar 是 hide：deck 关了就再没有地方显示胶囊。
 *   · 旧字段 bannerFolded 与旧 localStorage 键都已退役（#1612 维护者拍板删掉迁移）：读口不再问它们，
 *     缺 statusBar 一律按缺省 hide 处理。
 *
 * 值怎么落地：写走 kernel/settings-view-write.ts 的 setViewFlagValue（整份文档里改这一格、写前重读合并、
 *   写失败留队列重试）；写成功后把同一个工作区的各会话 emit 一次，界面立刻跟着重画。
 *   写不进文件（认不出工作区根、文件只读、老产物里没有写这一趟）时返回 false，界面可以据此提示。
 */
// 跨闭包的名字按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）：
//   viewFlagOf 的真源在 kernel/settings-view.ts，setViewFlagValue 的真源在 kernel/settings-view-write.ts，
//   keyOf/emit/shared/stores 由界面闭包提供。类型一律写 any 是刻意的（理由同其它 kernel 片）。
declare function viewFlagOf(...args: any[]): any
declare function setViewFlagValue(...args: any[]): any
declare function keyOf(...args: any[]): any
declare function emit(...args: any[]): any
declare const shared: any
declare const stores: any

// 这两个值就是设置文件里写的那几个字面量：读的时候只认它们，写的时候也只写它们。
const DECK_TOOLS_ON = 'on'
const DECK_TOOLS_OFF = 'off'
const DECK_STATUS_BAR_SHOW = 'show'
const DECK_STATUS_BAR_HIDE = 'hide'

// 读回来的一格先规整成文字再比：缺格、旧布尔值、别的东西一律当「说不清」，交给调用处按缺省走。
const deckFlagText = function (v: any): any {
  try { return (v === null || v === undefined) ? '' : String(v) } catch (e) { return '' }
}

// 这个工作区的 deck 工具箱开没开：只认文件里写的 off，其余（缺格、旧文件、读失败）都按开算 ——
//   缺省是「开」（维护者拍板），而读失败时按开算才不会把用户的工具悄悄关掉。
export const deckToolsOf = function (cwd: any): any {
  try { return deckFlagText(viewFlagOf(cwd, 'deckTools')) === DECK_TOOLS_OFF ? DECK_TOOLS_OFF : DECK_TOOLS_ON } catch (e) { return DECK_TOOLS_ON }
}

// 这个工作区的胶囊状态栏显不显示：只认 show；缺格、读失败、别的一律按折叠算（缺省折叠，维护者拍板）。
export const deckStatusBarOf = function (cwd: any): any {
  try {
    const v = deckFlagText(viewFlagOf(cwd, 'statusBar'))
    return (v === DECK_STATUS_BAR_SHOW) ? DECK_STATUS_BAR_SHOW : DECK_STATUS_BAR_HIDE
  } catch (e) { return DECK_STATUS_BAR_HIDE }
}

// deck 关了没有：关的是整个 deck（工具、胶囊、右侧面板三处一起关），所以这个判断比「胶囊折没折」更早。
export const isDeckClosed = function (cwd: any): boolean {
  try { return deckToolsOf(cwd) === DECK_TOOLS_OFF } catch (e) { return false }
}

// 胶囊此刻折没折（渲染口径：状态栏、横幅、右侧面板都用它）：deck 关了或者胶囊开关是折叠，两条任一成立就算折。
export const isDeckCapsuleFolded = function (cwd: any): boolean {
  try { return isDeckClosed(cwd) || deckStatusBarOf(cwd) !== DECK_STATUS_BAR_SHOW } catch (e) { return true }
}

// 同一个工作区的各会话一起重画（与 store-prefs 的 emitBannerFold 同例）：设置页改一处、状态栏与面板立刻跟上。
const deckEmitWorkspace = function (cwd: any): void {
  try {
    const nk = String((typeof keyOf === 'function') ? (keyOf(cwd) || '') : (cwd || ''))
    if (!nk) return
    try { if (typeof shared !== 'undefined' && shared && shared.cwd && String(keyOf(shared.cwd) || '') === nk) emit(shared) } catch (e1) {}
    try {
      if (typeof stores !== 'undefined' && stores) {
        Object.keys(stores).forEach(function (k: any): void {
          const st2 = stores[k]
          if (st2 && st2.cwd && String(keyOf(st2.cwd) || '') === nk) emit(st2)
        })
      }
    } catch (e2) {}
  } catch (e) {}
}

// 改「deck 工具箱」：on 传 true 是开、false 是关。返回值表示这一笔有没有交给设置文件那条路
//   （false ＝ 认不出工作区根/文件只读/写这一趟不在，界面可以照旧提示，但不能假装已经落盘）。
export const setDeckTools = function (cwd: any, on: any): boolean {
  const next = (on === true) ? DECK_TOOLS_ON : DECK_TOOLS_OFF
  let ok = false
  try { ok = (typeof setViewFlagValue === 'function') ? (setViewFlagValue(cwd, 'deckTools', next) === true) : false } catch (e) { ok = false }
  deckEmitWorkspace(cwd)
  return ok
}

// 改「胶囊状态栏」：show 传 true 是显示、false 是折叠。返回值含义同上。
export const setDeckStatusBar = function (cwd: any, show: any): boolean {
  const next = (show === true) ? DECK_STATUS_BAR_SHOW : DECK_STATUS_BAR_HIDE
  let ok = false
  try { ok = (typeof setViewFlagValue === 'function') ? (setViewFlagValue(cwd, 'statusBar', next) === true) : false } catch (e) { ok = false }
  deckEmitWorkspace(cwd)
  return ok
}
