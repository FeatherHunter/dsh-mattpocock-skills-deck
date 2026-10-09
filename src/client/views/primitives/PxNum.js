/**
 * views/primitives/PxNum.js — 像素风序号牌（887 原型 verdict 落地）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:pxNum (spliced by build) ====` 标记处（一源两物）。
 * 用法：PxNum({n})，序号从 1 起，个位数前面补 0（01、02……）。深底是“顺序结构件”，
 * 与浅底的行内代码徽章（PxCode 另起——本票只定序号牌，行内代码随 PxDoc 的 code 画法）不重样。
 */
export const PxNum = function (props) {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const n = Number((p || {}).n) || 0
  return h('span', { className: 'px-num', 'aria-hidden': true }, n < 10 ? '0' + n : String(n))
}
