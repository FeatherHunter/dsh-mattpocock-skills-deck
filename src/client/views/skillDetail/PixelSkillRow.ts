/**
 * views/skillDetail/PixelSkillRow.ts — 技能行的 TS 真源（887 TS 化，中组件）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:pixelSkillRow (spliced by build) ====` 标记处。
 * 用法：SkillRow({name, level, use, recommended, onDetail})，纯展示，数据全由外层给。
 * level ∈ 'ok' | 'warn' | 'bad'；行写 --px-dc 变量，方点与悬停描边同色；
 * 整行浮起只在悬停与框内聚焦时出现（键盘 Tab 到按钮上整行也亮）。
 */
import type { PixelSkillRowProps, PixelDotProps, PixelBtnProps } from '../pixelProps';
declare const PixelDot: (props?: PixelDotProps) => any;
declare const PixelBtn: (props?: PixelBtnProps) => any;
export const PixelSkillRow = function (props?: PixelSkillRowProps): any {
  const p = props || ({} as PixelSkillRowProps)
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const level = p.level === 'warn' ? 'warn' : p.level === 'bad' ? 'bad' : 'ok'
  const dc = level === 'bad' ? '#a3231a' : level === 'warn' ? '#f59e0b' : '#0e8a16'
  return h('div', { className: 'pixel-skillrow' + (p.recommended ? ' rec' : ''), style: { '--pixel-dc': dc } }, [
    h(PixelDot, { key: 'd', level: level }),
    h('div', { key: 'n', className: 'pixel-sname' }, [
      '/' + p.name,
      p.recommended ? h('span', { key: 's', className: 'pixel-star' }, ' ★') : null,
    ]),
    h('div', { key: 'u', className: 'pixel-suse' }, p.use),
    h(PixelBtn, {
      key: 'b',
      onClick: function () { if (typeof p.onDetail === 'function') p.onDetail(p.name as string) },
    }, tr('sd.detailBtn')),
  ])
}
