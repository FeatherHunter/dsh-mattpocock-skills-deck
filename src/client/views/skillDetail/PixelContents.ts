/**
 * views/skillDetail/PixelContents.ts — 像素风目录盒的 TS 真源（887 TS 化，中组件）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pixelContents (spliced by build) ====` 标记处。
 * 用法：PixelContents({items, onJump})，items 是标题字符串数组；无标题就不画（条件出现）。
 * 深底标题条加整行可按的行，悬停整行瞬间反色（无平滑过渡）；行首序号牌复用 PxNum。
 */
import type { PixelContentsProps, PixelNumProps } from '../pixelProps';
declare const PixelNum: (props?: PixelNumProps) => any;
export const PixelContents = function (props?: PixelContentsProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const items = p.items || []
  if (!items.length) return null
  const rows = items.map(function (label: string, i: number) {
    return h('a', {
      key: i,
      onClick: function () { if (typeof p.onJump === 'function') p.onJump(i) },
    }, [
      h(PixelNum, { key: 'n', n: i + 1 }),
      h('span', { key: 't' }, label),
    ])
  })
  return h('div', { className: 'pixel-toc' }, [h('b', { key: 'h' }, tr('sd.toc'))].concat(rows))
}
