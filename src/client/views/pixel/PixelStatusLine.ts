/**
 * views/pixel/PixelStatusLine.ts — 像素风状态行的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建直接读这份 .ts 真源、用 esbuild 当场转译，再剥行首 export
 * 拼回 src/client/index.ts 的 `// ==== leaf:pixelStatusLine (spliced by build) ====` 标记处。
 * 用法：PixelStatusLine({icon, text}) 画一句；PixelStatusLine({icon, texts}) 画一串节奏话
 * （2026-10-10 人拍板：加载中三句按顺序 1 秒一句，纯 CSS 轮播，见 PixelStyles 的 pixel-seq）。
 * 内容到位后收成一句「内容已到」，再停一秒由弹窗把整行撤掉。
 */
import type { PixelStatusLineProps, PixelStateIconProps } from '../pixelProps';
declare const PixelStateIcon: (props?: PixelStateIconProps) => any;
declare const MOTION: any;
export const PixelStatusLine = function (props?: PixelStatusLineProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const seq = Array.isArray(p.texts) && p.texts.length ? p.texts : null
  const line = seq
    ? h('span', { key: 'seq', className: 'pixel-seq' }, seq.map(function (s: string, i: number) {
        // 每句往后错一秒（0 / 1000 / 2000 毫秒，步长取动效令牌 MOTION.pixelStatusStepMs）：
        // 第一句立刻出现，后两句在自己的时刻之前是隐藏的。
        return h('span', { key: i, style: { animationDelay: (i * MOTION.pixelStatusStepMs) + 'ms' } }, s)
      }))
    : h('span', { key: 'tx' }, p.text)
  return h('div', { className: 'pixel-statusline' }, [
    h(PixelStateIcon, { key: 'ic', kind: p.icon }),
    line,
  ])
}
