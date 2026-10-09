/**
 * views/primitives/PxBanner.js — 像素风横幅（887 原型 verdict 落地）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:pxBanner (spliced by build) ====` 标记处（一源两物）。
 * 用法：PxBanner({kind, text, onRetry, onClose})，kind ∈ 'error'（红条）| 'warn'（黄条，缺文用）。
 * 失败必须留痕：横幅不自动消失，只有人点关闭或打开别篇才走（886 v3 定版）。
 */
export const PxBanner = function (props) {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const warn = p.kind === 'warn'
  return h('div', { className: 'px-banner' + (warn ? ' warn' : ''), role: 'alert' }, [
    h('b', { key: 'mark' }, warn ? '!' : '✕'),
    h('span', { key: 'text', className: 'grow' }, p.text),
    p.onRetry ? h(PxBtn, { key: 'retry', onClick: p.onRetry }, tr('sd.retry')) : null,
    p.onClose ? h(PxBtn, { key: 'close', onClick: p.onClose }, tr('sd.dismiss')) : null,
  ])
}
