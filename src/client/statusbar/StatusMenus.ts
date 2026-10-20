/**
 * statusbar/StatusMenus.ts — 状态栏悬浮菜单定位与开关（从 StatusBar.js 拆出，B1 #460，纯结构、行为零变化）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 的 leaf 标记处（源码树里只有这一份真源，标记 id 与本文件名一致）。
 * 以后谁改它：改状态栏悬浮菜单跟随定位（锚点矩形测算）、BUG 菜单、可接菜单与后端菜单开关、滚动缩放重定位的人改它。
 * 接线：StatusBar.ts 留转调包装（clearClose/scheduleClose/closeBugMenu/showBugMenu/closeTakeMenu/showTakeMenu）与单调 useStatusMenus(s, refs) 供装配；
 *   本文件不引用 StatusBackend.ts（同闭包拼回，调用方向见 StatusBar.ts 转调四处与装配一处）。
 *   后端菜单三件（place/show/closeStatusBackendMenu）当前渲染未直接调用，随旅程整体搬入保持行为一致。
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
// 悬浮菜单兜底延时（构建从 config/intervals.yaml 注入的时间常量，拼进闭包时由另一片提供）。
declare const STATUS_MENU_FALLBACK_DELAY_MS: any;

export const placeStatusOverlay = function (el: any, align: any) {
  if (!el || typeof window === 'undefined') return null
  const r = el.getBoundingClientRect()
  if (!r || (!r.width && !r.height)) return null
  const p: any = { bottom: Math.max(0, Math.round(window.innerHeight - r.top)) }
  if (align === 'right') p.right = Math.max(0, Math.round(window.innerWidth - r.right))
  else p.left = Math.max(0, Math.round(r.left))
  return p
}
export const placeStatusBugMenu = function(s: any, bugAnchorRef: any){
  const p = placeStatusOverlay(bugAnchorRef.current, 'left')
  if (!p) return false
  const old = s.bugMenuPos
  if (old && old.left === p.left && old.bottom === p.bottom) return false
  s.bugMenuPos = p
  return true
}
export const clearStatusClose = function (ref: any) {
  if (ref.current !== null) { clearTimeout(ref.current); ref.current = null }
}
export const closeStatusBugMenu = function(s: any, bugCloseRef: any){
  clearStatusClose(bugCloseRef)
  if (!s.bugMenuOpen && !s.bugMenuPos && !s.bugMenuHover) return
  s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; emit(s)
}
export const scheduleStatusClose = function (ref: any, fn: any) {
  clearStatusClose(ref)
  // 兜底延时：鼠标离开后先等这么久再关菜单；宿主若在这段时间里回话（把菜单留住）就不关，
  // 等不到回话才由这里关门，免得菜单一直挂在那儿。
  // 数值写在 config/intervals.yaml 的 statusMenuFallbackDelayMs，构建时由生成器变成常量拼进界面闭包。
  ref.current = setTimeout(function () { ref.current = null; fn() }, STATUS_MENU_FALLBACK_DELAY_MS)
}
export const showStatusBugMenu = function(s: any, bugAnchorRef: any, bugCloseRef: any){
  clearStatusClose(bugCloseRef)
  let changed = false
  if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
  if (s.takeMenuOpen || s.takeMenuPos || s.takeMenuHover || s.takeMenuSpecHover) { s.takeMenuOpen = false; s.takeMenuHover = false; s.takeMenuSpecHover = false; s.takeMenuPos = null; changed = true }
  if (!s.bugMenuOpen) { s.bugMenuOpen = true; changed = true }
  if (placeStatusBugMenu(s, bugAnchorRef)) changed = true
  if (changed) emit(s)
}
export const placeStatusTakeMenu = function(s: any, takeAnchorRef: any){
  const p = placeStatusOverlay(takeAnchorRef.current, 'left')
  if (!p) return false
  const old = s.takeMenuPos
  if (old && old.left === p.left && old.bottom === p.bottom) return false
  s.takeMenuPos = p
  return true
}
export const closeStatusTakeMenu = function(s: any, takeCloseRef: any){
  clearStatusClose(takeCloseRef)
  if (!s.takeMenuOpen && !s.takeMenuPos && !s.takeMenuHover && !s.takeMenuSpecHover) return
  s.takeMenuOpen = false; s.takeMenuHover = false; s.takeMenuSpecHover = false; s.takeMenuPos = null; emit(s)
}
export const showStatusTakeMenu = function(s: any, takeAnchorRef: any, takeCloseRef: any){
  clearStatusClose(takeCloseRef)
  let changed = false
  if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
  if (s.bugMenuOpen || s.bugMenuPos || s.bugMenuHover) { s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; changed = true }
  if (s.backendMenuOpen || s.backendMenuPos) { s.backendMenuOpen = false; s.backendMenuPos = null; changed = true }
  if (!s.takeMenuOpen) { s.takeMenuOpen = true; changed = true }
  if (placeStatusTakeMenu(s, takeAnchorRef)) changed = true
  if (changed) emit(s)
}
export const placeStatusBackendMenu = function(s: any, backendAnchorRef: any){
  const p = placeStatusOverlay(backendAnchorRef.current, 'left')
  if (!p) return false
  const old = s.backendMenuPos
  if (old && old.left === p.left && old.bottom === p.bottom) return false
  s.backendMenuPos = p
  return true
}
export const closeStatusBackendMenu = function(s: any, backendCloseRef: any){
  clearStatusClose(backendCloseRef)
  if (!s.backendMenuOpen && !s.backendMenuPos) return
  s.backendMenuOpen = false; s.backendMenuPos = null; emit(s)
}
export const showStatusBackendMenu = function(s: any, backendAnchorRef: any, backendCloseRef: any, bugCloseRef: any){
  clearStatusClose(backendCloseRef); clearStatusClose(bugCloseRef)
  let changed = false
  if (s.bugMenuOpen || s.bugMenuPos || s.bugMenuHover) { s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; changed = true }
  if (s.takeMenuOpen || s.takeMenuPos || s.takeMenuHover || s.takeMenuSpecHover) { s.takeMenuOpen = false; s.takeMenuHover = false; s.takeMenuSpecHover = false; s.takeMenuPos = null; changed = true }
  if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
  if (!s.backendMenuOpen) { s.backendMenuOpen = true; changed = true }
  if (placeStatusBackendMenu(s, backendAnchorRef)) changed = true
  if (changed) emit(s)
}
export const useStatusMenus = function(s: any, refs: any){
  const bugAnchorRef = refs.bugAnchorRef
  const backendAnchorRef = refs.backendAnchorRef
  const bugCloseRef = refs.bugCloseRef
  const backendCloseRef = refs.backendCloseRef
  const takeAnchorRef = refs.takeAnchorRef
  const takeCloseRef = refs.takeCloseRef
  React.useEffect(function () {
    if (!s.bugMenuOpen && !s.backendMenuOpen && !s.takeMenuOpen) return undefined
    let raf: any = null
    let disposed = false
    const reposition = function () {
      if (disposed || raf !== null) return
      const run = function () {
        raf = null
        if (disposed) return
        let changed = false
        if (s.bugMenuOpen && placeStatusBugMenu(s, bugAnchorRef)) changed = true
        if (s.backendMenuOpen && placeStatusBackendMenu(s, backendAnchorRef)) changed = true
        if (s.takeMenuOpen && takeAnchorRef && placeStatusTakeMenu(s, takeAnchorRef)) changed = true
        if (changed) emit(s)
      }
      if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(run)
      else raf = setTimeout(run, 0)
    }
    document.addEventListener('scroll', reposition, { capture: true, passive: true })
    window.addEventListener('resize', reposition)
    const ro = new ResizeObserver(reposition)
    if (bugAnchorRef.current) ro.observe(bugAnchorRef.current)
    if (backendAnchorRef.current) ro.observe(backendAnchorRef.current)
    if (takeAnchorRef && takeAnchorRef.current) ro.observe(takeAnchorRef.current)
    reposition()
    return function () {
      disposed = true
      ro.disconnect()
      if (raf !== null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
        else clearTimeout(raf)
      }
      document.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      clearStatusClose(bugCloseRef); clearStatusClose(backendCloseRef)
      if (takeCloseRef) clearStatusClose(takeCloseRef)
    }
  }, [s.bugMenuOpen, s.backendMenuOpen, s.takeMenuOpen])
}
