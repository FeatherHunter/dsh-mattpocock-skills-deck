/**
 * views/pixel/PixelDot.ts — 像素风状态方点的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建直接读这份 .ts 真源、用 esbuild 当场转译，再剥行首 export
 * 拼回 src/client/index.ts 的 `// ==== leaf:pixelDot (spliced by build) ====` 标记处。
 * 用法：PxDot({level})，level ∈ 'ok' | 'warn' | 'bad'；或 PxDot({color}) 直接给颜色；
 * 都不给就跟行上的 --dc 变量走（行悬停描边与方点同色就靠它，见 SkillRow）。
 */
import type { PixelDotProps } from '../pixelProps';
export const PixelDot = function (props?: PixelDotProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const bg = p.color || (p.level === 'warn' ? '#f59e0b' : p.level === 'bad' ? '#a3231a' : p.level === 'ok' ? '#0e8a16' : 'var(--pixel-dc,#0e8a16)')
  return h('span', { className: 'pixel-dot', style: { background: bg }, 'aria-hidden': true })
}
