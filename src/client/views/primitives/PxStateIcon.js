/**
 * views/primitives/PxStateIcon.js — 像素风状态图标（887 原型 verdict 落地）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:pxStateIcon (spliced by build) ====` 标记处（一源两物）。
 * 用法：PxStateIcon({kind})，kind ∈ 'ok' ✓ | 'err' ✕ | 'warn' ! | 'idle' ○ | 'loading' …。
 * 五套同尺寸，成功淡绿底、失败淡红底、提醒淡黄底（886 v3 定版）。
 */
export const PxStateIcon = function (props) {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const mark = p.kind === 'ok' ? '✓' : p.kind === 'err' ? '✕' : p.kind === 'warn' ? '!' : p.kind === 'loading' ? '…' : '○'
  return h('span', { className: 'px-ic px-ic-' + (p.kind || 'idle'), 'aria-hidden': true }, mark)
}
