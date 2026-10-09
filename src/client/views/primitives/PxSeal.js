/**
 * views/primitives/PxSeal.js — 像素风印章（887 原型 verdict 落地，纯装饰）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:pxSeal (spliced by build) ====` 标记处（一源两物）。
 * 用法：PxSeal()，直接画在弹窗顶边正中的那枚小红章。
 */
export const PxSeal = function () {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  return h('span', { className: 'px-seal', 'aria-hidden': true })
}
