/**
 * views/primitives/Tip.js — title 迁移薄预设 Tip500（T1 定版 #403）
 * 契约：HoverTip 的锁定预设：mode mouse + delay {show:500,hide:160} + maxWidth 220 + flip auto + zIndex 2147483000
 * 用法：Tip({content, children}) 或 h(Tip, {content: tr('...')}, triggerNode)
 * 形态：单文件单控件、零横向 import、样式复用 HoverTip 的 STYLE_TEXT/portalTop，行为与 HoverTip 完全一致
 * 真源经 scripts/build.mjs LEAF_MODULES -> src/client/index.js // ==== leaf:tip (spliced by build) ==== 一源两物
 */
export const Tip = function(props){
  const p = props || {}
  const content = p.content
  const children = p.children
  const preset = { mode: 'mouse', delay: { show: 500, hide: 160 }, maxWidth: 220, flip: true, zIndex: 2147483000 }
  const merged = {}
  merged.mode = p.mode !== undefined ? p.mode : preset.mode
  merged.delay = p.delay !== undefined ? p.delay : preset.delay
  merged.maxWidth = p.maxWidth !== undefined ? p.maxWidth : preset.maxWidth
  merged.flip = p.flip !== undefined ? p.flip : preset.flip
  merged.zIndex = p.zIndex !== undefined ? p.zIndex : preset.zIndex
  if (content !== undefined) merged.content = content
  if (children !== undefined) merged.children = children
  if (p.targetRef !== undefined) merged.targetRef = p.targetRef
  if (p.visible !== undefined) merged.visible = p.visible
  if (p.onVisibleChange !== undefined) merged.onVisibleChange = p.onVisibleChange
  if (p.onShow !== undefined) merged.onShow = p.onShow
  if (p.onHide !== undefined) merged.onHide = p.onHide
  if (p.caret !== undefined) merged.caret = p.caret
  if (p.offset !== undefined) merged.offset = p.offset
  return HoverTip(merged)
}
