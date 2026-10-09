/**
 * views/primitives/PxNum.ts — 像素风序号牌的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pxNum (spliced by build) ====` 标记处。
 * 用法：PxNum({n})，序号从 1 起，个位数前面补 0（01、02……）。深底是“顺序结构件”，
 * 与浅底的行内代码徽章（PxDoc 的 code 画法）不重样。
 */
import type { PxNumProps } from '../px-props';
export const PxNum = function (props?: PxNumProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const n = Number(p.n) || 0
  return h('span', { className: 'px-num', 'aria-hidden': true }, n < 10 ? '0' + n : String(n))
}
