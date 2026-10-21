/**
 * views/pixel/PixelBtn.ts — 像素风按钮的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建直接读这份 .ts 真源、用 esbuild 当场转译，再剥行首 export
 * 拼回 src/client/index.ts 的 `// ==== leaf:pixelBtn (spliced by build) ====` 标记处。
 * 用法：PxBtn({children, onClick, hot, mini, loading, disabled, title})。
 * 按下只转圈不换字（886 v3 定版）；动效全部跳跃式步进；样式见 pxSkillStyles。
 */
import type { PixelBtnProps } from '../pixelProps';
export const PixelBtn = function (props?: PixelBtnProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const cls = 'pixel-btn' + (p.hot ? ' hot' : '') + (p.mini ? ' mini' : '') + (p.loading ? ' loading' : '')
  // 定位名由调用点用 'data-log' 传进来，这里统一补 'pixel.btn.' 前缀：像素按钮散在横幅、技能行、
  // 详情弹窗等多处，前缀让日志一眼看出是像素按钮，后半截由调用点区分是哪一颗（关闭、重试、加载…）。
  // 类型契约 pixelProps.d.ts 没列这一项，就地放宽读，不去动那份声明文件。
  const logId = String(((props as any) || {})['data-log'] || 'unnamed')
  // 按压形状也由调用点写明：纯图标按钮用 icon 档（小图标下沉会看着歪），带字的按钮用 button 档；
  // 调用点没写就按带字的按钮算。类型契约里没有这两项，就地放宽读，不去动那份声明文件。
  const press = String(((props as any) || {})['data-press'] || 'button')
  return h('button', {
    type: 'button',
    className: cls,
    'data-press': press,
    'data-log': 'pixel.btn.' + logId,
    disabled: p.disabled || p.loading || undefined,
    title: p.title || undefined,
    onClick: p.loading ? undefined : p.onClick,
  }, [
    h('span', { key: 'spin', className: 'pixel-spin', 'aria-hidden': true }),
    h('span', { key: 'label' }, p.children),
  ])
}
