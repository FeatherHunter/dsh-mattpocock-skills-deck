/**
 * views/primitives/PxSkel.ts — 像素风占位块的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pxSkel (spliced by build) ====` 标记处。
 * 用法：PxSkel({lines})，默认 3 条等宽递减的闪块（跳跃式步进闪，不做平滑过渡）。
 * 什么时候画：详情等待超过 2 秒才铺（886 v3 定版），2 秒内只转按钮圈。
 */
import type { PxSkelProps } from '../px-props';
export const PxSkel = function (props?: PxSkelProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const widths = ['100%', '82%', '64%']
  const n = Math.max(1, Math.min(3, Number(p.lines) || 3))
  const bars: any[] = []
  for (let i = 0; i < n; i++) bars.push(h('div', { key: i, className: 'px-skel', style: { width: widths[i] } }))
  return h('div', { 'aria-hidden': true }, bars)
}
