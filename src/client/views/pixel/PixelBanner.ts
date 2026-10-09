/**
 * views/pixel/PixelBanner.ts — 像素风横幅的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pixelBanner (spliced by build) ====` 标记处。
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
    p.onRetry ? h(PixelBtn, { key: 'retry', onClick: p.onRetry }, tr('sd.retry')) : null,
    p.onClose ? h(PixelBtn, { key: 'close', onClick: p.onClose }, tr('sd.dismiss')) : null,
  ])
}
