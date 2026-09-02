/**
 * views/primitives/Tip.js — title 迁移薄预设 Tip500（T1 定版 #403）
 * 契约：HoverTip 的锁定预设：mode mouse + delay {show:500,hide:160} + maxWidth 220 + flip auto + zIndex 2147483000
 * 用法：Tip({content, children}) 或 h(Tip, {content: '提示'}, triggerNode)
 * 形态：单文件单控件、零横向 import、样式复用 HoverTip 的 STYLE_TEXT/portalTop，行为与 HoverTip 完全一致
 * 真源经 scripts/build.mjs LEAF_MODULES -> src/client/index.js // ==== leaf:tip (spliced by build) ==== 一源两物
 */
export const Tip = function(props){
  const p = props || {}
  const content = p.content
  const children = p.children
  const preset = { mode: 'mouse', delay: { show: 500, hide: 160 }, maxWidth: 220, flip: true, zIndex: 2147483000, padding: '7px 12px' }
  const merged = {}
  merged.mode = p.mode !== undefined ? p.mode : preset.mode
  merged.delay = p.delay !== undefined ? p.delay : preset.delay
  merged.maxWidth = p.maxWidth !== undefined ? p.maxWidth : preset.maxWidth
  merged.flip = p.flip !== undefined ? p.flip : preset.flip
  merged.zIndex = p.zIndex !== undefined ? p.zIndex : preset.zIndex
  // T2 a11y：若 content 为字符串且触发元素无 aria-label，自动补 aria-label（不覆盖显式值）
  let effChildren = children
  if (typeof content === 'string' && content && children && typeof children === 'object' && children.props && !children.props['aria-label'] && !children.props['aria-labelledby']) {
    try { if (typeof React !== 'undefined' && typeof React.cloneElement === 'function') effChildren = React.cloneElement(children, { 'aria-label': content }); } catch (e) {}
  }
  if (content !== undefined) merged.content = content
  if (effChildren !== undefined) merged.children = effChildren
  else if (children !== undefined) merged.children = children
  if (p.targetRef !== undefined) merged.targetRef = p.targetRef
  if (p.visible !== undefined) merged.visible = p.visible
  if (p.onVisibleChange !== undefined) merged.onVisibleChange = p.onVisibleChange
  if (p.onShow !== undefined) merged.onShow = p.onShow
  if (p.onHide !== undefined) merged.onHide = p.onHide
  if (p.caret !== undefined) merged.caret = p.caret
  if (p.offset !== undefined) merged.offset = p.offset
  merged.padding = p.padding !== undefined ? p.padding : preset.padding
  if (p.style !== undefined) merged.style = p.style
  if (p.className !== undefined) merged.className = p.className
  if (p.background !== undefined) merged.background = p.background
  if (p.border !== undefined) merged.border = p.border
  return HoverTip(merged)
}
