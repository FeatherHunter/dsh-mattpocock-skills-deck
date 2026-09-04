/**
 * statusbar/StatusMenus.js — 状态栏悬浮菜单定位与开关（从 StatusBar.js 拆出，B1 #460，纯结构、行为零变化）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
 * 以后谁改它：改状态栏悬浮菜单跟随定位（锚点矩形测算）、BUG 菜单与后端菜单开关、滚动缩放重定位的人改它。
 * 接线：StatusBar.js 留四个转调包装（clearClose/scheduleClose/closeBugMenu/showBugMenu）与单调 useStatusMenus(s, refs) 供装配；
 *   本文件不引用 StatusBackend.js（同闭包拼回，调用方向见 StatusBar.js 转调四处与装配一处）。
 *   后端菜单三件（place/show/closeStatusBackendMenu）当前渲染未直接调用，随旅程整体搬入保持行为一致。
 */
export const placeStatusOverlay = function (el, align) {
  if (!el || typeof window === 'undefined') return null
  const r = el.getBoundingClientRect()
  if (!r || (!r.width && !r.height)) return null
  const p = { bottom: Math.max(0, Math.round(window.innerHeight - r.top)) }
  if (align === 'right') p.right = Math.max(0, Math.round(window.innerWidth - r.right))
  else p.left = Math.max(0, Math.round(r.left))
  return p
}
export const placeStatusBugMenu = function(s, bugAnchorRef){
  const p = placeStatusOverlay(bugAnchorRef.current, 'left')
  if (!p) return false
  const old = s.bugMenuPos
  if (old && old.left === p.left && old.bottom === p.bottom) return false
  s.bugMenuPos = p
  return true
}
export const clearStatusClose = function (ref) {
  if (ref.current !== null) { clearTimeout(ref.current); ref.current = null }
}
export const closeStatusBugMenu = function(s, bugCloseRef){
  clearStatusClose(bugCloseRef)
  if (!s.bugMenuOpen && !s.bugMenuPos && !s.bugMenuHover) return
  s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; emit(s)
}
export const scheduleStatusClose = function (ref, fn) {
  clearStatusClose(ref)
  ref.current = setTimeout(function () { ref.current = null; fn() }, 160)
}
export const showStatusBugMenu = function(s, bugAnchorRef, bugCloseRef){
  clearStatusClose(bugCloseRef)
  let changed = false
  if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
  if (!s.bugMenuOpen) { s.bugMenuOpen = true; changed = true }
  if (placeStatusBugMenu(s, bugAnchorRef)) changed = true
  if (changed) emit(s)
}
export const placeStatusBackendMenu = function(s, backendAnchorRef){
  const p = placeStatusOverlay(backendAnchorRef.current, 'left')
  if (!p) return false
  const old = s.backendMenuPos
  if (old && old.left === p.left && old.bottom === p.bottom) return false
  s.backendMenuPos = p
  return true
}
export const closeStatusBackendMenu = function(s, backendCloseRef){
  clearStatusClose(backendCloseRef)
  if (!s.backendMenuOpen && !s.backendMenuPos) return
  s.backendMenuOpen = false; s.backendMenuPos = null; emit(s)
}
export const showStatusBackendMenu = function(s, backendAnchorRef, backendCloseRef, bugCloseRef){
  clearStatusClose(backendCloseRef); clearStatusClose(bugCloseRef)
  let changed = false
  if (s.bugMenuOpen || s.bugMenuPos || s.bugMenuHover) { s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; changed = true }
  if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
  if (!s.backendMenuOpen) { s.backendMenuOpen = true; changed = true }
  if (placeStatusBackendMenu(s, backendAnchorRef)) changed = true
  if (changed) emit(s)
}
export const useStatusMenus = function(s, refs){
  const bugAnchorRef = refs.bugAnchorRef
  const backendAnchorRef = refs.backendAnchorRef
  const bugCloseRef = refs.bugCloseRef
  const backendCloseRef = refs.backendCloseRef
  React.useEffect(function () {
    if (!s.bugMenuOpen && !s.backendMenuOpen) return undefined
    let raf = null
    let disposed = false
    const reposition = function () {
      if (disposed || raf !== null) return
      const run = function () {
        raf = null
        if (disposed) return
        let changed = false
        if (s.bugMenuOpen && placeStatusBugMenu(s, bugAnchorRef)) changed = true
        if (s.backendMenuOpen && placeStatusBackendMenu(s, backendAnchorRef)) changed = true
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
    }
  }, [s.bugMenuOpen, s.backendMenuOpen])
}
