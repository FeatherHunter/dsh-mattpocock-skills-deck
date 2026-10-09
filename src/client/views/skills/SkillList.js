/**
 * views/skills/SkillList.js — 技能列表（887 原型 verdict 落地，上层组件）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:skillList (spliced by build) ====` 标记处（一源两物）。
 * 用法：SkillList({items, onDetail})，items = [{name, level, use, recommended}]，
 * 列表只管摆样子，数据全由外层传入（动态列表）；点详情把名字交出去，取数是外层的事。
 */
export const SkillList = function (props) {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const items = p.items || []
  return h('div', null, [
    h('div', { key: 't', className: 'dsws-grp', style: { marginBottom: 6 } }, tr('sd.listTitle')),
    h('div', { key: 'rows' }, items.map(function (it) {
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
