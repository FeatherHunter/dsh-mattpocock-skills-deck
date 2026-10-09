/**
 * views/primitives/PxStateIcon.ts — 像素风状态图标的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pxStateIcon (spliced by build) ====` 标记处。
 * 用法：PxStateIcon({kind})，kind ∈ 'ok' ✓ | 'err' ✕ | 'warn' ! | 'idle' ○ | 'loading' …。
 * 五套同尺寸，成功淡绿底、失败淡红底、提醒淡黄底（886 v3 定版）。
 */
import type { PxStateIconProps } from '../px-props';
export const PxStateIcon = function (props?: PxStateIconProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const mark = p.kind === 'ok' ? '✓' : p.kind === 'err' ? '✕' : p.kind === 'warn' ? '!' : p.kind === 'loading' ? '…' : '○'
  return h('span', { className: 'px-ic px-ic-' + (p.kind || 'idle'), 'aria-hidden': true }, mark)
}
