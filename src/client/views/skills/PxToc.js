/**
 * views/skills/PxToc.js — 像素风目录盒（887 原型 verdict 落地，中组件）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:pxToc (spliced by build) ====` 标记处（一源两物）。
 * 用法：PxToc({items, onJump})，items 是标题字符串数组；无标题就不画（条件出现）。
 * 深底标题条加整行可按的行，悬停整行瞬间反色（无平滑过渡）；行首序号牌复用 PxNum。
 */
export const PxToc = function (props) {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const items = p.items || []
  if (!items.length) return null
  const rows = items.map(function (label, i) {
    return h('a', {
      key: i,
      onClick: function () { if (typeof p.onJump === 'function') p.onJump(i) },
    }, [
      h(PxNum, { key: 'n', n: i + 1 }),
      h('span', { key: 't' }, label),
    ])
  })
  return h('div', { className: 'px-toc' }, [h('b', { key: 'h' }, tr('sd.toc'))].concat(rows))
}
