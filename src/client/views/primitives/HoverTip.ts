/**
 * views/primitives/HoverTip.ts — 统一悬浮提示原子控件（规格 1651，第二张实施票 1653 起只锚定在触发控件上方）
 * 契约：HoverTip(props) 工厂，局部 state 闭环，经 DswsCtx 取 h，消费 kernel/portal 的 portalTop。
 * props 只收内容与触发节点：content|children、maxWidth 320、delay 0/160、visible 受控、onVisibleChange/onShow/onHide、zIndex 2147483000。
 * 方位一律锚定在触发控件上方，屏幕边缘由方位纯函数让位，调用方不再传方位参数。
 * 样式单真源挂顶经 portalTop，失败不抛。
 * 本文件由同名 .js 转成 TypeScript（#1253）：只加类型标注与环境声明，逻辑、字符串、数字、默认值
 * 与导出名按本票演进（本文件另有总行数上限 200 行的门禁，所以这里的说明写得很短）。
 */
// React / DswsCtx / portalTop / computeTipPlace 由构建按 build.mjs 次序与别的片段拼进同一个函数作用域（真机有值），
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
  const maxWidth = typeof props.maxWidth === 'number' ? props.maxWidth : 320
  const zIndex = typeof props.zIndex === 'number' ? props.zIndex : 2147483000
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
  // 最近一次鼠标进入事件命中的真实元素：自定义触发节点经克隆拿不到真实位置时，用它量矩形，引用只做兜底。
  const eventRef = React.useRef(null)
  const tipRef = React.useRef(null)  // 提示本体的 ref：先按宽度上限渲染，量出真实宽高再算落点。
  const [pos, setPos] = React.useState({ left: 0, top: 0, eff: maxWidth })
  const hideTimerRef = React.useRef(null)
  const clearTimer = function () {
    if (hideTimerRef.current !== null) { try { clearTimeout(hideTimerRef.current) } catch (e) {} hideTimerRef.current = null }
  }
  const scheduleShow=function(){clearTimer();try{ if(__hoverTipGlobalPending && __hoverTipGlobalPending.id!==__hoverTipId){ try{ clearTimeout(__hoverTipGlobalPending.timer);}catch(e){} try{ __hoverTipGlobalPending.clear();}catch(e){} __hoverTipGlobalPending=null; } }catch(e){} if(__hoverTipGlobalActive&&__hoverTipGlobalActive.id!==__hoverTipId){try{__hoverTipGlobalActive.hide()}catch(e){}__hoverTipGlobalActive=null}const doShow=function(){setVisible(true);__hoverTipGlobalActive={id:__hoverTipId,hide:function(){try{clearTimer();setVisible(false)}catch(e){}}}; __hoverTipGlobalPending=null;};if(delayShow<=0)doShow();else { const t=setTimeout(function(){hideTimerRef.current=null; doShow();},delayShow); hideTimerRef.current=t; __hoverTipGlobalPending={id:__hoverTipId, timer:t, clear:function(){ try{ clearTimeout(t);}catch(e){} try{ setVisible(false);}catch(e){} }}; }}
  const scheduleHide=function(){clearTimer();const doHide=function(){setVisible(false);if(__hoverTipGlobalActive&&__hoverTipGlobalActive.id===__hoverTipId)__hoverTipGlobalActive=null};if(delayHide<=0)doHide();else hideTimerRef.current=setTimeout(function(){hideTimerRef.current=null;doHide()},delayHide)}
  const computePos: any = function () {
    if (typeof window === 'undefined') return null
    const vpW = window.innerWidth
    const vpH = window.innerHeight
    // 触发控件矩形优先取鼠标进入事件的真实元素，引用只做兜底。
    let rect = null
    try { const evEl = eventRef.current; if (evEl && typeof evEl.getBoundingClientRect === 'function') rect = evEl.getBoundingClientRect() } catch (e) {}
    if (!rect) {
      try { if (anchorRef && anchorRef.current && typeof anchorRef.current.getBoundingClientRect === 'function') rect = anchorRef.current.getBoundingClientRect() } catch (e) {}
    }
    if (!rect || (!rect.width && !rect.height)) return null
    // 先按宽度上限渲染再量：量得着就用量出来的真实尺寸，量不到先按上限宽与一行高占位，挂上屏后下一帧重算。
    let tipW = 0
    let tipH = 0
    try { if (tipRef.current && tipRef.current.offsetWidth) tipW = tipRef.current.offsetWidth; if (tipRef.current && tipRef.current.offsetHeight) tipH = tipRef.current.offsetHeight } catch (e) {}
    if (!tipW) tipW = Math.min(maxWidth, Math.max(0, vpW - 8)) || maxWidth
    if (!tipH) tipH = 32
    // 锚定方位统一交给方位纯函数算：按触发控件矩形、量出的提示尺寸、屏幕尺寸与宽度上限的顺序传入，
    // 拿回来的就是提示左上角坐标与实际生效的宽度上限。这里不再自己算落点。
    const placed: any = computeTipPlace(rect, { width: tipW, height: tipH }, { width: vpW, height: vpH }, maxWidth)
    if (placed && typeof placed.x === 'number' && typeof placed.y === 'number') return { left: placed.x, top: placed.y, eff: placed.effectiveMaxWidth }
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
      if (ro) { try { ro.disconnect() } catch (e) {} }
      clearTimer()
    }
  }, [visible, hasTip, maxWidth])
  React.useEffect(function () { return function () { clearTimer() } }, [])
  const handleEnter = function (e: any) {
    try {
      const el = (e && (e.currentTarget || e.target)) || null
      if (el && typeof el.getBoundingClientRect === 'function') eventRef.current = el
    } catch (_) {}
    clearTimer()
    scheduleShow()
  }
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
      onMouseLeave: function (e: any) { if (origProps.onMouseLeave) try { origProps.onMouseLeave(e) } catch (e2) {} handleLeave(e) },
    }
    // T2 a11y：若提示为字符串且触发元素无 aria-label，自动补（不覆盖显式值）
    try { if (typeof tipContent === 'string' && tipContent && origProps && !origProps['aria-label'] && !origProps['aria-labelledby']) cloneProps['aria-label'] = tipContent } catch (e) {}
    if (typeof React.cloneElement === 'function') triggerNode = React.cloneElement(trigger, cloneProps)
    else triggerNode = h('span', { ref: mergedRef, onMouseEnter: handleEnter, onMouseLeave: handleLeave, style: { display: 'inline-flex' } }, trigger)
  }
  if (props.targetRef && !trigger) {
    React.useEffect(function () {
      if (isControlled || !props.targetRef || !props.targetRef.current) return undefined
      const el = props.targetRef.current
      if (!el || typeof el.addEventListener !== 'function') return undefined
      const onEnter = function (e: any) { handleEnter(e) }
      const onLeave = function () { handleLeave() }
      el.addEventListener('mouseenter', onEnter)
      el.addEventListener('mouseleave', onLeave)
      return function () { try { el.removeEventListener('mouseenter', onEnter) } catch (e) {}; try { el.removeEventListener('mouseleave', onLeave) } catch (e) {} }
    }, [isControlled])
  }
  const _pad = props.padding !== undefined ? props.padding : '7px 12px'
  // 提示位置一律按左上角坐标画，方位纯函数给什么就画在哪里；渲染宽度按实际生效的宽度上限收窄。
  const effWidth = (pos && typeof pos.eff === 'number' && pos.eff > 0) ? pos.eff : maxWidth
  const tooltipStyle = { position: 'fixed', left: pos.left, top: pos.top, maxWidth: effWidth, zIndex: zIndex, padding: _pad, borderRadius: 10, background: props.background || 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: props.border || '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.45)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
  if (props.style && typeof props.style === 'object') Object.assign(tooltipStyle, props.style)
  let tipPortal = null
  if (visible && hasTip) {
    const live = computePos() || pos
    const liveEff = (live && typeof live.eff === 'number' && live.eff > 0) ? live.eff : effWidth
    const style = Object.assign({}, tooltipStyle, { left: live.left, top: live.top, maxWidth: liveEff })
    const _tipProps: any = { style: style, ref: tipRef }
    if (props.className) _tipProps.className = props.className
    tipPortal = portalTop(h('div', _tipProps, [tipContent]))
  }
  if (triggerNode) return h(React.Fragment, null, triggerNode, tipPortal)
  return tipPortal
}
