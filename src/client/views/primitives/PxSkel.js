/**
 * views/primitives/PxSkel.js — 像素风占位块（887 原型 verdict 落地）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:pxSkel (spliced by build) ====` 标记处（一源两物）。
 * 用法：PxSkel({lines})，默认 3 条等宽递减的闪块（跳跃式步进闪，不做平滑过渡）。
 * 什么时候画：详情等待超过 2 秒才铺（886 v3 定版），2 秒内只转按钮圈。
 */
export const PxSkel = function (props) {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const widths = ['100%', '82%', '64%']
  const n = Math.max(1, Math.min(3, Number(p.lines) || 3))
  const bars = []
  for (let i = 0; i < n; i++) bars.push(h('div', { key: i, className: 'px-skel', style: { width: widths[i] } }))
  return h('div', { 'aria-hidden': true }, bars)
}
