/**
 * views/shared/Tabs.js — 共享 tabs 行（阶段 2 叶子迁移 · #97 T4 去重）
 * Dock/Overlay 原各实现一遍的 tabsTip/tabsTipOff/tabBtn + 动作按钮行（wayfinder/bug/刷新 + tooltip + 版本号）
 * 合成此处；消费：`const tabs = useTabsRow(s, tabsRef)`，渲染 `tabs.items`（容器由调用方自备，样式各异）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 */
export const useTabsRow = function (s, tabsRef) {
  const [tabTip, setTabTip] = React.useState(null)
  const tabsTip = function (e, text, priority) {
    const t = tabsRef && tabsRef.current
    setTabTip(null)
    if (!t || !text || typeof e === 'undefined') return
    // 门控：仅当该 priority 的按钮自身已折叠时才显示 tooltip（文字被藏、需悬浮提示）
    const btn = t.querySelector('[data-priority="' + priority + '"]')
    if (!btn || !btn.classList.contains('collapsed')) return
    if (typeof window === 'undefined') return
    const W = 238
    let x = e.clientX + 12, y = e.clientY + 12
    if (x + W > window.innerWidth) x = e.clientX - 12 - W
    setTabTip({ x: x, y: y, text: text })
  }
  const tabsTipOff = function () { setTabTip(null) }
  const tabBtn = (id, icon, label, priority) => h('button', { className: 'dsws-tab' + (s.tab === id ? ' on' : ''), 'data-priority': priority, onMouseMove: function (e) { tabsTip(e, label, priority) }, onMouseLeave: tabsTipOff, onClick: function () { s.tab = id; emit(s); if (!snapFresh(s)) loadSnapshot(s, false) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
    Ic({ n: icon, size: 12 }),
    h('span', null, label),
  ])
  const items = [
    tabBtn('list', 'list', tr('panel.tabList'), 4),
    tabBtn('skills', 'compass', tr('panel.tabSkills'), 5),
    tabBtn('checks', 'gear', tr('panel.tabChecks'), 6),
    h('span', { style: { flex: 1 } }),
    // v1.5 T6 修订（V2 描边紫 · 刷新左侧）：新增 wayfinder —— 注入 /wayfinder + 仓库信息 + 需求引导
    // issue #4：新增 BUG 单 —— 同构按钮（新会话预填 /wayfinder 新增 BUG 单 prompt）
    h('button', { className: 'dsws-btn', 'data-priority': 2, onMouseMove: function (e) { tabsTip(e, tr('panel.newWayfinderTitle'), 2) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newWayfinderText(s), newSessionTitleNew('requirement')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #c084fc', color: '#c084fc', fontWeight: 600 } }, [
      Ic({ n: 'map', size: 11 }),
      h('span', null, tr('panel.newWayfinder')),
    ]),
    h('button', { className: 'dsws-btn', 'data-priority': 1, onMouseMove: function (e) { tabsTip(e, tr('panel.newBugTitle'), 1) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newBugWayfinderText(s), newSessionTitleNew('bug')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #f87171', color: '#f87171', fontWeight: 600 } }, [
      Ic({ n: 'bug', size: 11 }),
      h('span', null, tr('panel.newBug')),
    ]),
    // T2 #2：刷新按钮上移至 tabs 行 · 紧贴环境检查右边（用户需求：列表 / 技能 / 环境检查 / 刷新）
    h('button', { className: 'dsws-btn', 'data-priority': 3, onMouseMove: function (e) { tabsTip(e, tr('list.refresh'), 3) }, onMouseLeave: tabsTipOff, onClick: function () { refreshAll(s) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none' } }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', null, tr('list.refresh'))]),
    (tabTip && portalTop) ? portalTop(h('div', { style: { position: 'fixed', left: tabTip.x, top: tabTip.y, zIndex: 2147483000, padding: '4px 8px', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.4)', maxWidth: 220 } }, tabTip.text)) : null,
    // #repo-link：版本号可点——新窗打开插件仓库主页（DSW_REPO_URL 构建期注入，见 index.js；hover 样式在 styles.js .dsws-ver）
    h(Tip, { content: DSW_REPO_URL }, h('a', { className: 'dsws-ver', href: DSW_REPO_URL, target: '_blank', rel: 'noreferrer', style: { fontSize: 9, flex: 'none', fontVariantNumeric: 'tabular-nums' } }, DSW_VERSION)),
  ]
  return { tabsRef: tabsRef, items: items }
}
