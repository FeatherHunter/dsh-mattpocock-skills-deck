/**
 * views/primitives/PxBtn.js — 像素风按钮（887 原型 verdict 落地）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:pxBtn (spliced by build) ====` 标记处（一源两物）。
 * 用法：PxBtn({children, onClick, hot, mini, loading, disabled, title})
 * 按下只转圈不换字（886 v3 定版）；动效全部跳跃式步进；样式见 pxSkillStyles。
 */
export const PxBtn = function (props) {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const cls = 'px-btn' + (p.hot ? ' hot' : '') + (p.mini ? ' mini' : '') + (p.loading ? ' loading' : '')
  return h('button', {
    type: 'button',
    className: cls,
    disabled: p.disabled || p.loading || undefined,
    title: p.title || undefined,
    onClick: p.loading ? undefined : p.onClick,
  }, [
    h('span', { key: 'spin', className: 'px-spin', 'aria-hidden': true }),
    h('span', { key: 'label' }, p.children),
  ])
}
