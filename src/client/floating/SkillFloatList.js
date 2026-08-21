/**
 * floating/SkillFloatList.js — 技能悬浮列表（5.2 状态栏末段 · 2026-08-18 需求 2）
 * 自 StatusBar.js 拆出（#97 T4）：自持 skillAnchorRef/skillCloseRef 与 show/close/placement 状态机，
 * 互斥逻辑（关 bug 菜单 / issuePath 弹层）经 s 状态直接操作（与原实现同语义）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
export const SkillFloatList = function (props) {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const s = props.s
  const skillAnchorRef = React.useRef(null)
  const skillCloseRef = React.useRef(null)
  const placeOverlay = function (el, align) {
    if (!el || typeof window === 'undefined') return null
    const r = el.getBoundingClientRect()
    if (!r || (!r.width && !r.height)) return null
    const p = { bottom: Math.max(0, Math.round(window.innerHeight - r.top)) }
    if (align === 'right') p.right = Math.max(0, Math.round(window.innerWidth - r.right))
    else p.left = Math.max(0, Math.round(r.left))
    return p
  }
  const placeSkillPop = function () {
    const p = placeOverlay(skillAnchorRef.current, 'right')
    if (!p) return false
    const old = s.skillPopPos
    if (old && old.right === p.right && old.bottom === p.bottom) return false
    s.skillPopPos = p
    return true
  }
  const clearClose = function (ref) {
    if (ref.current !== null) { clearTimeout(ref.current); ref.current = null }
  }
  const closeSkillPop = function () {
    clearClose(skillCloseRef)
    if (!s.skillsOpen && !s.skillPopPos && !s.skillHover && !s.skillTip) return
    s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; emit(s)
  }
  const scheduleClose = function (ref, fn) {
    clearClose(ref)
    ref.current = setTimeout(function () { ref.current = null; fn() }, 160)
  }
  const showSkillPop = function () {
    clearClose(skillCloseRef)
    let changed = false
    if (s.bugMenuOpen || s.bugMenuPos || s.bugMenuHover) { s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; changed = true }
    if (s.issuePathHover || s.issuePathPos) { s.issuePathHover = false; s.issuePathPos = null; changed = true }
    if (!s.skillsOpen) { s.skillsOpen = true; changed = true }
    if (placeSkillPop()) changed = true
    if (changed) emit(s)
  }
  // 悬浮定位：scroll/resize 时重算（与 bug/issuePath 弹层同机制，各持各的监听）
  React.useEffect(function () {
    if (!s.skillsOpen) return undefined
    let raf = null
    let disposed = false
    const reposition = function () {
      if (disposed || raf !== null) return
      const run = function () {
        raf = null
        if (disposed) return
        let changed = false
        if (s.skillsOpen && placeSkillPop()) changed = true
        if (changed) emit(s)
      }
      if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(run)
      else raf = setTimeout(run, 0)
    }
    document.addEventListener('scroll', reposition, { capture: true, passive: true })
    window.addEventListener('resize', reposition)
    const ro = new ResizeObserver(reposition)
    if (skillAnchorRef.current) ro.observe(skillAnchorRef.current)
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
      clearClose(skillCloseRef)
    }
  }, [s.skillsOpen])
  return h('span', {
    style: { position: 'relative', display: 'inline-flex' },
    ref: skillAnchorRef, onMouseEnter: showSkillPop,
    onMouseLeave: function () { scheduleClose(skillCloseRef, closeSkillPop) },
  }, [
    h('span', { className: 'dsws-skillbtn' + (s.skillsOpen ? ' on' : ''), onClick: function (e) { e.stopPropagation(); if (s.skillsOpen) closeSkillPop(); else showSkillPop() }, title: tr('nav.skillsTitle'), style: { display: 'inline-flex', alignItems: 'center', padding: '1px 4px', borderRadius: 4, cursor: 'pointer', color: s.skillsOpen ? '#c084fc' : 'var(--dsw-alias-label-caption,#8b8b95)' } }, [Ic({ n: 'skills', size: 12 })]),
    s.skillsOpen ? PortalOverlay({ className: 'dsws-skillpop-bridge', onMouseEnter: function () { clearClose(skillCloseRef) }, onMouseLeave: function () { scheduleClose(skillCloseRef, closeSkillPop) }, style: { position: 'fixed', right: s.skillPopPos ? s.skillPopPos.right : 0, bottom: s.skillPopPos ? s.skillPopPos.bottom : 0, paddingTop: 4, paddingBottom: 4, zIndex: 2147483000 }, onClick: function (e) { e.stopPropagation() } }, [
      h('div', { className: 'dsws-skillpop', style: { minWidth: 150, maxHeight: 'min(300px, calc(100vh - 24px))', overflowY: 'auto', background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)', padding: 4 } }, [
        // 悬浮记忆：鼠标移到行上立即出现浮层（替代浏览器原生 title 的慢延迟）
        SKILLS.map(function (sk) {
          return h('div', {
            key: sk.name,
            onClick: function (e) { e.stopPropagation(); inject(s, '/' + sk.name); closeSkillPop() },
            onMouseEnter: function (e) {
              const r = e.currentTarget.getBoundingClientRect()
              // 浮层实宽 = maxWidth 220 + 左右内边距 16 + 边框 2 = 238（翻转阈值与实宽对齐，避免贴边）
              let tip = { x: r.right + 8, y: r.top + r.height / 2, name: sk.name }
              if (typeof window !== 'undefined' && tip.x + 238 > window.innerWidth) tip = { x: r.left - 8 - 238, y: r.top + r.height / 2, name: sk.name }
              s.skillHover = sk.name
              s.skillTip = tip
              emit(s)
            },
            onMouseLeave: function () { if (s.skillHover !== null) { s.skillHover = null; s.skillTip = null; emit(s) } },
            style: { padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: s.skillHover === sk.name ? 'var(--dsw-alias-label-primary,#e6edf3)' : 'var(--dsw-alias-label-secondary,#a1a1aa)', whiteSpace: 'nowrap', fontFamily: 'Consolas,Menlo,monospace', background: s.skillHover === sk.name ? 'var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))' : 'transparent', borderLeft: s.skillHover === sk.name ? '2px solid #c084fc' : '2px solid transparent' }
          }, sk.name)
        }),
        // 底部操作提示（替代被移除的列表标题位，保持顶部纯技能名）
        h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', padding: '5px 8px 2px', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', marginTop: 2, whiteSpace: 'nowrap' } }, tr('nav.skillHint')),
      ]),
    ]) : null,
    // 快速悬浮提示：portal 到 document.body（issue #3·D1）——脱离状态栏子树，position:fixed 的
    //   视口坐标与 z-index 全局生效，不再被宿主输入区容器裁剪或压层
    s.skillTip && s.skillHover ? portalTop(h('div', { style: { position: 'fixed', left: s.skillTip.x, top: s.skillTip.y, transform: 'translateY(-50%)', maxWidth: 220, zIndex: 2147483000, padding: '4px 8px', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.4)' } }, tr('skilldesc.' + s.skillTip.name))) : null,
  ])
}
