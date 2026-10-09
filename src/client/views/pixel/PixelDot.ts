/**
 * views/primitives/PxDot.ts — 像素风状态方点的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pxDot (spliced by build) ====` 标记处。
 * 用法：PxDot({level})，level ∈ 'ok' | 'warn' | 'bad'；或 PxDot({color}) 直接给颜色；
 * 都不给就跟行上的 --dc 变量走（行悬停描边与方点同色就靠它，见 SkillRow）。
 */
import type { PxDotProps } from '../px-props';
export const PxDot = function (props?: PxDotProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const bg = p.color || (p.level === 'warn' ? '#f59e0b' : p.level === 'bad' ? '#a3231a' : p.level === 'ok' ? '#0e8a16' : 'var(--dc,#0e8a16)')
  return h('span', { className: 'px-dot', style: { background: bg }, 'aria-hidden': true })
}
