/**
 * views/pixel/PixelBanner.ts — 像素风横幅的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建直接读这份 .ts 真源、用 esbuild 当场转译，再剥行首 export
 * 拼回 src/client/index.ts 的 `// ==== leaf:pixelBanner (spliced by build) ====` 标记处。
 * 用法：PxBanner({kind, text, onRetry, onClose})，kind ∈ 'error'（红条）| 'warn'（黄条，缺文用）。
 * 失败必须留痕：横幅不自动消失，只有人点关闭或打开别篇才走（886 v3 定版）。
 */
import type { PixelBannerProps, PixelBtnProps } from '../pixelProps';
declare const PixelBtn: (props?: PixelBtnProps) => any;
export const PixelBanner = function (props?: PixelBannerProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const warn = p.kind === 'warn'
  return h('div', { className: 'pixel-banner' + (warn ? ' warn' : ''), role: 'alert' }, [
    h('b', { key: 'mark' }, warn ? '!' : '✕'),
    h('span', { key: 'text', className: 'grow' }, p.text),
    // 两颗按钮各给一个定位名：同样的横幅会出现在好几处面板上，光看"重试"认不出是哪块横幅的重试。
    // 按压形状写明是 button 档（这两颗带字）；像素风自带悬停反馈，不叠通用悬停样式。
    p.onRetry ? h(PixelBtn, { key: 'retry', 'data-press': 'button', 'data-log': 'banner.retry', onClick: p.onRetry }, tr('sd.retry')) : null,
    p.onClose ? h(PixelBtn, { key: 'close', 'data-press': 'button', 'data-log': 'banner.dismiss', onClick: p.onClose }, tr('sd.dismiss')) : null,
  ])
}
