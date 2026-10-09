/**
 * views/primitives/PxDot.js — 像素风状态方点（887 原型 verdict 落地）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:pxDot (spliced by build) ====` 标记处（一源两物）。
 * 用法：PxDot({level})，level ∈ 'ok' | 'warn' | 'bad'；或 PxDot({color}) 直接给颜色；
 * 都不给就跟行上的 --dc 变量走（行悬停描边与方点同色就靠它，见 SkillRow）。
 */
export const PxDot = function (props) {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const bg = p.color || (p.level === 'warn' ? '#f59e0b' : p.level === 'bad' ? '#a3231a' : p.level === 'ok' ? '#0e8a16' : 'var(--dc,#0e8a16)')
  return h('span', { className: 'px-dot', style: { background: bg }, 'aria-hidden': true })
}
