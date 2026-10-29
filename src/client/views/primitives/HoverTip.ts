/**
 * views/primitives/HoverTip.ts — 统一悬浮提示原子控件（G2 契约首轮定版，T2 首批落地 #381）
 * 契约：HoverTip(props) 工厂，局部 state 闭环，经 DswsCtx 取 h，消费 kernel/portal 的 portalTop。
 * props { content|children, mode anchor|mouse, offset, maxWidth 220, flip true, delay 0/160,
 *  visible受控, onVisibleChange/onShow/onHide, zIndex 2147483000 } 包裹式用法。placement：'below'（默认，提示落在指针下方）| 'above'（提示整块压在指针上方，上方放不下就翻到下面）。
 * 样式单真源 STYLE_TEXT，挂顶经 portalTop，小三角随翻转同步，失败不抛。
 * 本文件由同名 .js 转成 TypeScript（#1253）：只加类型标注与环境声明，逻辑、字符串、数字、默认值
 * 与导出名一字未动（本文件另有总行数上限 200 行的门禁，所以这里的说明写得很短）。
 */
// React / DswsCtx / portalTop 由构建按 build.mjs 次序与别的片段拼进同一个函数作用域（真机有值），
// 这里只声明形状、不参与转译：拼进闭包的片段里写 import 会在运行时成为语法错。
declare const React: any;declare const DswsCtx: any;declare const portalTop: any;declare const computeTipPlace: any;
let __hoverTipGlobalActive: any = null,__hoverTipGlobalSeq = 0,__hoverTipGlobalPending: any = null

export const HoverTip = function (props: any) {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const __hoverTipIdRef=React.useRef(null);if(__hoverTipIdRef.current===null)__hoverTipIdRef.current=++__hoverTipGlobalSeq;const __hoverTipId=__hoverTipIdRef.current
  const rawContent = (props.content !== undefined && props.content !== null) ? props.content : props.children
  let trigger = null
  let tipContent = rawContent
  if (props.content !== undefined && props.content !== null && props.children && typeof props.children === 'object' && props.children.type !== undefined) {
    trigger = props.children
    tipContent = props.content
  }
  const resolveContent = function (c: any) { if (typeof c === 'function') { try { return c() } catch (e) { return null } } return c }
  tipContent = resolveContent(tipContent)
  const hasTip = tipContent !== null && tipContent !== undefined && tipContent !== ''
  const mode = props.mode === 'mouse' ? 'mouse' : 'anchor'
  const placement = props.placement === 'above' ? 'above' : 'below'  // 提示落在指针上方还是下方：默认下方，'above' 整块压在指针上方。
  const maxWidth = typeof props.maxWidth === 'number' ? props.maxWidth : 220
  const zIndex = typeof props.zIndex === 'number' ? props.zIndex : 2147483000
  const flip = props.flip !== false
  const offset = props.offset || (mode === 'mouse' ? { x: 14, y: 12 } : { x: 8, y: 0 })
  const delayShow = props.delay && typeof props.delay.show === 'number' ? props.delay.show : 0
  const delayHide = props.delay && typeof props.delay.hide === 'number' ? props.delay.hide : 160
  const isControlled = props.visible !== undefined
  const [visibleInner, setVisibleInner] = React.useState(false)
  const visible = isControlled ? !!props.visible : visibleInner
  const setVisible = function (next: any) {
    if (!isControlled) setVisibleInner(next)
    if (typeof props.onVisibleChange === 'function') { try { props.onVisibleChange(next) } catch (e) {} }
    if (next && typeof props.onShow === 'function') { try { props.onShow() } catch (e) {} }
    if (!next && typeof props.onHide === 'function') { try { props.onHide() } catch (e) {} }
  }
  const anchorRefInternal = React.useRef(null)
  const anchorRef = props.targetRef || anchorRefInternal
  const tipRef = React.useRef(null)  // 提示本体的 ref：量出它的真实宽高，用来定位（估算宽会让宽提示在屏幕右缘翻到离指针很远的地方）。
  const [mousePos, setMousePos] = React.useState(null)
  const [pos, setPos] = React.useState({ left: 0, top: 0 })
  const hideTimerRef = React.useRef(null)
  const clearTimer = function () {
    if (hideTimerRef.current !== null) { try { clearTimeout(hideTimerRef.current) } catch (e) {} hideTimerRef.current = null }
  }
  const scheduleShow=function(){clearTimer();try{ if(__hoverTipGlobalPending && __hoverTipGlobalPending.id!==__hoverTipId){ try{ clearTimeout(__hoverTipGlobalPending.timer);}catch(e){} try{ __hoverTipGlobalPending.clear();}catch(e){} __hoverTipGlobalPending=null; } }catch(e){} if(__hoverTipGlobalActive&&__hoverTipGlobalActive.id!==__hoverTipId){try{__hoverTipGlobalActive.hide()}catch(e){}__hoverTipGlobalActive=null}const doShow=function(){setVisible(true);__hoverTipGlobalActive={id:__hoverTipId,hide:function(){try{clearTimer();setVisible(false)}catch(e){}}}; __hoverTipGlobalPending=null;};if(delayShow<=0)doShow();else { const t=setTimeout(function(){hideTimerRef.current=null; doShow();},delayShow); hideTimerRef.current=t; __hoverTipGlobalPending={id:__hoverTipId, timer:t, clear:function(){ try{ clearTimeout(t);}catch(e){} try{ setVisible(false);}catch(e){} }}; }}
  const scheduleHide=function(){clearTimer();const doHide=function(){setVisible(false);if(__hoverTipGlobalActive&&__hoverTipGlobalActive.id===__hoverTipId)__hoverTipGlobalActive=null};if(delayHide<=0)doHide();else hideTimerRef.current=setTimeout(function(){hideTimerRef.current=null;doHide()},delayHide)}
  const computePos: any = function (mp: any) {
    if (typeof window === 'undefined') return null
    const vpW = window.innerWidth
    const vpH = window.innerHeight
    let estW = maxWidth + 16 + 2
    // T3修复：短文本按字符估宽，避免 238 固定值对“新会话”等小气泡过度 flip 导致远左
    try{ if(typeof tipContent==='string' && tipContent){ const dyn = String(tipContent).length * 7 + 32; estW = Math.min(estW, Math.max(56, dyn)); } }catch(e){}
    let estH = 40
    // 量得着就用量出来的（提示挂在 body 上，offsetWidth/offsetHeight 就是它的真身尺寸）。
    try { if (tipRef.current && tipRef.current.offsetWidth) estW = tipRef.current.offsetWidth; if (tipRef.current && tipRef.current.offsetHeight) estH = tipRef.current.offsetHeight } catch (e) {}
    if (mode === 'mouse') {
      const mp2 = mp || mousePos
      if (!mp2) return null
      let x = mp2.x + offset.x
      let y = mp2.y + offset.y
      if (flip) {
        if (x + estW > vpW) x = mp2.x - offset.x - estW
        if (y + estH > vpH) y = mp2.y - offset.y - estH
      }
      // placement='above'：提示整块压在指针上方 —— 横向以指针为中心，纵向底边离指针 offset.y；上方放不下就翻到指针下方。
      if (placement === 'above') {
        const above = mp2.y - offset.y - estH / 2
        y = (flip && above - estH / 2 < 4) ? mp2.y + offset.y + estH / 2 : above
        x = mp2.x - estW / 2 + offset.x
      }
      x = Math.max(4, Math.min(x, vpW - estW - 4))
      y = Math.max(4, Math.min(y, vpH - estH - 4))
      return { left: x, top: y }
    }
    let rect = null
    try { if (anchorRef && anchorRef.current && typeof anchorRef.current.getBoundingClientRect === 'function') rect = anchorRef.current.getBoundingClientRect() } catch (e) {}
    if (!rect || (!rect.width && !rect.height)) return null
    // 锚定分支的位置统一交给方位纯函数算：传触发控件矩形、量出的提示尺寸、屏幕尺寸与宽度上限，
    // 拿回来的就是提示左上角坐标。这里不再自己算落点，offset 与 flip 只留给跟随鼠标分支用。
    const placed: any = computeTipPlace(rect, { width: estW, height: estH }, { width: vpW, height: vpH }, maxWidth)
    if (placed && typeof placed.x === 'number' && typeof placed.y === 'number') return { left: placed.x, top: placed.y }
    return null
  }
  React.useEffect(function () {
    if (!visible || !hasTip) return undefined
    let disposed = false
    const update = function () { if (disposed) return; const p = computePos(); if (p) setPos(p) }
    update()
    const onScroll = function () { update() }
    const onResize = function () { update() }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onResize)
    let ro = null
    try { if (typeof ResizeObserver !== 'undefined' && anchorRef && anchorRef.current) { ro = new ResizeObserver(update); ro.observe(anchorRef.current) } } catch (e) {}
    return function () {
      disposed = true
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      if (ro) try { ro.disconnect() } catch (e) {}
      clearTimer()
    }
  }, [visible, hasTip, mousePos, mode, maxWidth, flip, placement, offset.x, offset.y])
  React.useEffect(function () { return function () { clearTimer() } }, [])
  const handleEnter = function (e: any) {
    try{ if(anchorRefInternal.current && e.target && e.target!==anchorRefInternal.current && e.target.closest){ const inner=e.target.closest('button, a'); if(inner && anchorRefInternal.current.contains(inner) && inner!==anchorRefInternal.current) return; } }catch(_){}
    if (mode === 'mouse') setMousePos({ x: e.clientX, y: e.clientY })
    clearTimer()
    scheduleShow()
  }
  const handleMove = function (e: any) { if (mode === 'mouse') setMousePos({ x: e.clientX, y: e.clientY }) }
  const handleLeave: any = function () { scheduleHide() }
  let triggerNode = null
  if (trigger) {
    const origProps = trigger.props || {}
    const origRef = trigger.ref
    const mergedRef = function (el: any) {
      anchorRefInternal.current = el
      if (typeof origRef === 'function') try { origRef(el) } catch (e) {}
      else if (origRef && typeof origRef === 'object') try { origRef.current = el } catch (e) {}
    }
    const cloneProps: any = {
      ref: mergedRef,
      onMouseEnter: function (e: any) { if (origProps.onMouseEnter) try { origProps.onMouseEnter(e) } catch (e2) {} handleEnter(e) },
      onMouseMove: function (e: any) { if (origProps.onMouseMove) try { origProps.onMouseMove(e) } catch (e2) {} handleMove(e) },
      onMouseLeave: function (e: any) { if (origProps.onMouseLeave) try { origProps.onMouseLeave(e) } catch (e2) {} handleLeave(e) },
    }
    // T2 a11y：若提示为字符串且触发元素无 aria-label，自动补（不覆盖显式值）
    try { if (typeof tipContent === 'string' && tipContent && origProps && !origProps['aria-label'] && !origProps['aria-labelledby']) cloneProps['aria-label'] = tipContent } catch (e) {}
    if (typeof React.cloneElement === 'function') triggerNode = React.cloneElement(trigger, cloneProps)
    else triggerNode = h('span', { ref: mergedRef, onMouseEnter: handleEnter, onMouseMove: handleMove, onMouseLeave: handleLeave, style: { display: 'inline-flex' } }, trigger)
  }
  if (props.targetRef && !trigger) {
    React.useEffect(function () {
      if (isControlled || !props.targetRef || !props.targetRef.current) return undefined
      const el = props.targetRef.current
      if (!el || typeof el.addEventListener !== 'function') return undefined
      const onEnter = function (e: any) { handleEnter(e) }
      const onMove = function (e: any) { handleMove(e) }
      const onLeave = function () { handleLeave() }
      el.addEventListener('mouseenter', onEnter)
      el.addEventListener('mousemove', onMove)
      el.addEventListener('mouseleave', onLeave)
      return function () { try { el.removeEventListener('mouseenter', onEnter) } catch (e) {}; try { el.removeEventListener('mousemove', onMove) } catch (e) {}; try { el.removeEventListener('mouseleave', onLeave) } catch (e) {} }
    }, [isControlled, mode])
  }
  const _pad = props.padding !== undefined ? props.padding : '7px 12px'
  // 提示位置一律按左上角坐标画，方位纯函数给什么就画在哪里，不再按中心点向上平移半个提示高度。
  const tooltipStyle = { position: 'fixed', left: pos.left, top: pos.top, maxWidth: maxWidth, zIndex: zIndex, padding: _pad, borderRadius: 10, background: props.background || 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: props.border || '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.45)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
  if (props.style && typeof props.style === 'object') Object.assign(tooltipStyle, props.style)
  let tipPortal = null
  if (visible && hasTip) {
    const live = computePos(mousePos) || pos
    const style = Object.assign({}, tooltipStyle, { left: live.left, top: live.top })
    let flippedX = false
    try {
      if (mode === 'mouse' && mousePos) flippedX = live.left < mousePos.x
      else if (mode === 'anchor' && anchorRef && anchorRef.current && anchorRef.current.getBoundingClientRect) {
        const r = anchorRef.current.getBoundingClientRect()
        if (r) flippedX = live.left < r.left
      }
    } catch (e) {}
    const showCaret = props.caret === true
    const caretStyle = {
      position: 'absolute',
      width: 6, height: 6,
      background: 'var(--dsw-alias-bg-layer-3,#0c0e12)',
      borderLeft: flippedX ? 'none' : '1px solid var(--dsw-alias-border-l2,#3a3f4a)',
      borderTop: flippedX ? 'none' : '1px solid var(--dsw-alias-border-l2,#3a3f4a)',
      borderRight: flippedX ? '1px solid var(--dsw-alias-border-l2,#3a3f4a)' : 'none',
      borderBottom: flippedX ? '1px solid var(--dsw-alias-border-l2,#3a3f4a)' : 'none',
      top: '50%',
      left: flippedX ? 'auto' : '-3px',
      right: flippedX ? '-3px' : 'auto',
      borderRadius: 1,
      transform: flippedX ? 'translateY(-50%) rotate(225deg)' : 'translateY(-50%) rotate(45deg)',
    }
    const caret = showCaret ? h('div', { style: caretStyle }) : null
    const _tipProps: any = { style: style, ref: tipRef }
    if (props.className) _tipProps.className = props.className
    tipPortal = portalTop(h('div', _tipProps, showCaret ? [caret, tipContent] : [tipContent]))
  }
  if (triggerNode) return h(React.Fragment, null, triggerNode, tipPortal)
  return tipPortal
}
