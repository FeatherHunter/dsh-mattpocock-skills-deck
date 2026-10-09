/**
 * views/primitives/PxStatusLine.js — 像素风状态行（887 原型 verdict 落地）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:pxStatusLine (spliced by build) ====` 标记处（一源两物）。
 * 用法：PxStatusLine({icon, text})，icon 透传给 PxStateIcon 的 kind。
 * 阶段话搬进弹窗里（886 v3 定版）：加载时三句推进，内容到了收成一句，平时不占地方。
 */
export const PxStatusLine = function (props) {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  return h('div', { className: 'px-statusline' }, [
    h(PxStateIcon, { key: 'ic', kind: p.icon }),
    h('span', { key: 'tx' }, p.text),
  ])
}
