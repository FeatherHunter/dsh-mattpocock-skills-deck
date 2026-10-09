/**
 * views/skills/SkillRow.js — 技能行（887 原型 verdict 落地，中组件）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:skillRow (spliced by build) ====` 标记处（一源两物）。
 * 用法：SkillRow({name, level, use, recommended, onDetail})，纯展示，数据全由外层给。
 * level ∈ 'ok' | 'warn' | 'bad'；行写 --px-dc 变量，方点与悬停描边同色；
 * 整行浮起只在悬停与框内聚焦时出现（键盘 Tab 到按钮上整行也亮）。
 */
export const SkillRow = function (props) {
  const p = props || {}
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const level = p.level === 'warn' ? 'warn' : p.level === 'bad' ? 'bad' : 'ok'
  const dc = level === 'bad' ? '#a3231a' : level === 'warn' ? '#f59e0b' : '#0e8a16'
  return h('div', { className: 'px-skillrow' + (p.recommended ? ' rec' : ''), style: { '--px-dc': dc } }, [
    h(PxDot, { key: 'd', level: level }),
    h('div', { key: 'n', className: 'px-sname' }, [
      '/' + p.name,
      p.recommended ? h('span', { key: 's', className: 'px-star' }, ' ★') : null,
    ]),
    h('div', { key: 'u', className: 'px-suse' }, p.use),
    h(PxBtn, {
      key: 'b',
      onClick: function () { if (typeof p.onDetail === 'function') p.onDetail(p.name) },
    }, tr('sd.detailBtn')),
  ])
}
