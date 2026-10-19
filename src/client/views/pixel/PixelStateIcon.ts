/**
 * views/pixel/PixelStateIcon.ts — 像素风状态图标的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建直接读这份 .ts 真源、用 esbuild 当场转译，再剥行首 export
 * 拼回 src/client/index.ts 的 `// ==== leaf:pixelStateIcon (spliced by build) ====` 标记处。
 * 用法：PxStateIcon({kind})，kind ∈ 'ok' ✓ | 'err' ✕ | 'warn' ! | 'idle' ○ | 'loading' …。
 * 五套同尺寸，成功淡绿底、失败淡红底、提醒淡黄底（886 v3 定版）。
 */
import type { PixelStateIconProps } from '../pixelProps';
export const PixelStateIcon = function (props?: PixelStateIconProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const mark = p.kind === 'ok' ? '✓' : p.kind === 'err' ? '✕' : p.kind === 'warn' ? '!' : p.kind === 'loading' ? '…' : '○'
  return h('span', { className: 'pixel-ic pixel-ic-' + (p.kind || 'idle'), 'aria-hidden': true }, mark)
}
