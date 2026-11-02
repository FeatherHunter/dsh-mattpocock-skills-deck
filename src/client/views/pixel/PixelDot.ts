/**
 * views/pixel/PixelDot.ts — 像素风状态方点的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建直接读这份 .ts 真源、用 esbuild 当场转译，再剥行首 export
 * 拼回 src/client/index.ts 的 `// ==== leaf:pixelDot (spliced by build) ====` 标记处。
 * 用法：PxDot({color, hollow})：color 是 CSS 颜色（通常是皮肤令牌，如 var(--pixel-warn)），
 * hollow 为真时画空心方点（底色透明，只留 2px 描边）；两个都不给就跟行上的 --pixel-dc 变量走
 * （行悬停描边与方点同色就靠它，见 PixelSkillRow）。
 * 为什么本文件不再认「档位」字段：旧版把 ok/warn/bad 三档写成本文件的十六进制映射，
 * 调用方喂别的字面量（例如数据表里的 alert）就静默落到默认绿，颜色和告警含义对不上。
 * #1837 起「哪一档对应什么颜色」只在 shared/matt-skills.ts 的 SKILL_IMPORTANCE_STYLES 一处定义，
 * 行与图例查同一张表；本文件只负责画，不持有任何色值。
 */
import type { PixelDotProps } from '../pixelProps';
export const PixelDot = function (props?: PixelDotProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  // 空心档自己不带底色（rare 的外观表里 color 就是 transparent）；实心档没给颜色时跟行上的 --pixel-dc。
  const bg = p.hollow ? (p.color || 'transparent') : (p.color || 'var(--pixel-dc,var(--pixel-ok))')
  return h('span', { className: 'pixel-dot', style: { background: bg }, 'aria-hidden': true })
}
