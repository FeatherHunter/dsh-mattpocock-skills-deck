/**
 * views/skillDetail/PixelSkillList.ts — 技能列表的 TS 真源（887 TS 化，上层组件）。
 * 契约：本文件为真源；构建直接读这份 .ts 真源、用 esbuild 当场转译，再剥行首 export
 * 拼回 src/client/index.ts 的 `// ==== leaf:pixelSkillList (spliced by build) ====` 标记处。
 * 用法：PixelSkillList({items, onDetail, onLoad, loadingName})，items = [{name, importance, use, recommended}]，
 * 列表只管摆样子，数据全由外层传入（动态列表）；点详情把名字交出去，取数是外层的事。
 * 标题行：左边是「■ 技能」，右边是重要程度图例（#1837）——三档色点与星标各带一句悬停定义。
 *   图例的颜色与形状全部查 shared/matt-skills.ts 的 SKILL_IMPORTANCE_STYLES，与每一行用的是同一张表，
 *   所以「图例说备用是空心」和「行里画的是空心」不会各说各的；两处不一致时源码门禁会红。
 *   图例文案走 locale 的 sd.imp.*；面板窄到一行放不下时图例整体换到下一行、仍然右对齐（见 PixelStyles）。
 */
import type { PixelSkillListProps, PixelSkillRowProps, PixelSkillItem, PixelDotProps, MattSkillImportance, PixelImportanceStyle } from '../pixelProps';
declare const PixelSkillRow: (props?: PixelSkillRowProps) => any;
declare const PixelDot: (props?: PixelDotProps) => any;
declare const Tip: (props?: any) => any;
// 外观表由 shared/matt-skills.ts 在客户端闭包里提供（构建按 SHARED_SPLICE 拼在同作用域），这里只声明形状。
declare const SKILL_IMPORTANCE_STYLES: Record<MattSkillImportance, PixelImportanceStyle>;
// 图例固定说这三档，顺序与判据从「核心」到「备用」一致：值键是 shared 数据表里的档位名，
// 文案键分名字与悬停定义两条（界面上的字只在 config/copy/skilldetail.yaml 写一遍）。
const LEGEND_ROWS: { key: MattSkillImportance; label: string; tip: string }[] = [
  { key: 'core', label: 'sd.imp.core', tip: 'sd.imp.coreTip' },
  { key: 'common', label: 'sd.imp.common', tip: 'sd.imp.commonTip' },
  { key: 'rare', label: 'sd.imp.rare', tip: 'sd.imp.rareTip' },
]
export const PixelSkillList = function (props?: PixelSkillListProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const items = p.items || []
  // 每一项：一个色点加一句名字，悬停给出这一档的定义（Tip 会把定义补成 aria-label，读屏也念得到）。
  const legend = LEGEND_ROWS.map(function (row) {
    const style = SKILL_IMPORTANCE_STYLES[row.key] || SKILL_IMPORTANCE_STYLES.common
    return h(Tip, { key: row.key, content: tr(row.tip) }, h('span', { className: 'pixel-legenditem' }, [
      h(PixelDot, { key: 'd', color: style.color, hollow: style.hollow }),
      h('span', { key: 't' }, tr(row.label)),
    ]))
  })
  // 星标不是重要程度的一档，是名称后面那颗 ★ 的说明；单独摆一颗，别让人以为第四档。
  legend.push(h(Tip, { key: 'star', content: tr('sd.imp.starTip') }, h('span', { className: 'pixel-legenditem' }, [
    h('span', { key: 's', className: 'pixel-legendstar' }, '★'),
    h('span', { key: 't' }, tr('sd.imp.star')),
  ])))
  return h('div', null, [
    h('div', { key: 't', className: 'dsws-grp pixel-skillhead', style: { marginBottom: 6 } }, [
      h('span', { key: 'title' }, tr('sd.listTitle')),
      h('div', { key: 'legend', className: 'pixel-skilllegend' }, legend),
    ]),
    h('div', { key: 'rows' }, items.map(function (it: PixelSkillItem) {
      return h(PixelSkillRow, {
        key: it.name,
        name: it.name,
        importance: it.importance,
        use: it.use,
        recommended: it.recommended,
        onDetail: p.onDetail,
        onLoad: p.onLoad,
        loading: p.loadingName === it.name,
      })
    })),
  ])
}
