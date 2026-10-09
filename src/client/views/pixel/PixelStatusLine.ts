/**
 * views/primitives/PxStatusLine.ts — 像素风状态行的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pxStatusLine (spliced by build) ====` 标记处。
 * 用法：PxStatusLine({icon, text})，icon 透传给 PxStateIcon 的 kind。
 * 阶段话搬进弹窗里（886 v3 定版）：加载时三句推进，内容到了收成一句，平时不占地方。
 */
import type { PxStatusLineProps, PxStateIconProps } from '../px-props';
declare const PxStateIcon: (props?: PxStateIconProps) => any;
export const PxStatusLine = function (props?: PxStatusLineProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  return h('div', { className: 'px-statusline' }, [
    h(PxStateIcon, { key: 'ic', kind: p.icon }),
    h('span', { key: 'tx' }, p.text),
  ])
}
