/**
 * views/skills/SkillList.ts — 技能列表的 TS 真源（887 TS 化，上层组件）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:skillList (spliced by build) ====` 标记处。
 * 用法：SkillList({items, onDetail})，items = [{name, level, use, recommended}]，
 * 列表只管摆样子，数据全由外层传入（动态列表）；点详情把名字交出去，取数是外层的事。
 */
import type { SkillListProps, SkillRowProps, SkillItem } from '../px-props';
declare const SkillRow: (props?: SkillRowProps) => any;
export const SkillList = function (props?: SkillListProps): any {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const items = p.items || []
  return h('div', null, [
    h('div', { key: 't', className: 'dsws-grp', style: { marginBottom: 6 } }, tr('sd.listTitle')),
    h('div', { key: 'rows' }, items.map(function (it: SkillItem) {
      return h(SkillRow, {
        key: it.name,
        name: it.name,
        level: it.level,
        use: it.use,
        recommended: it.recommended,
        onDetail: p.onDetail,
      })
    })),
  ])
}
