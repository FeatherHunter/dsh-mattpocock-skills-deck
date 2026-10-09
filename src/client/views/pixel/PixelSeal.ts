/**
 * views/pixel/PixelSeal.ts — 像素风印章的 TS 真源（887 TS 化，纯装饰）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pixelSeal (spliced by build) ====` 标记处。
 * 用法：PxSeal()，直接画在弹窗顶边正中的那枚小红章。
 */
export const PixelSeal = function (): any {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  return h('span', { className: 'pixel-seal', 'aria-hidden': true })
}
