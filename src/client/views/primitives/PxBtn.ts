/**
 * views/primitives/PxBtn.ts — 像素风按钮的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pxBtn (spliced by build) ====` 标记处。
 * 用法：PxBtn({children, onClick, hot, mini, loading, disabled, title})。
 * 按下只转圈不换字（886 v3 定版）；动效全部跳跃式步进；样式见 pxSkillStyles。
 */
import type { PxBtnProps } from '../px-props';
export const PxBtn = function (props?: PxBtnProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const cls = 'px-btn' + (p.hot ? ' hot' : '') + (p.mini ? ' mini' : '') + (p.loading ? ' loading' : '')
  return h('button', {
    type: 'button',
    className: cls,
    disabled: p.disabled || p.loading || undefined,
    title: p.title || undefined,
    onClick: p.loading ? undefined : p.onClick,
  }, [
    h('span', { key: 'spin', className: 'px-spin', 'aria-hidden': true }),
    h('span', { key: 'label' }, p.children),
  ])
}
