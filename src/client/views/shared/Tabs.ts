/**
 * views/shared/Tabs.ts — 共享 tabs 行（阶段 2 叶子迁移 · #97 T4 去重）
 * Dock/Overlay 原各实现一遍的 tabsTip/tabsTipOff/tabBtn + 动作按钮行（wayfinder/bug/刷新 + tooltip + 版本号）
 * 合成此处；消费：`const tabs = useTabsRow(s, tabsRef)`，渲染 `tabs.items`（容器由调用方自备，样式各异）。
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:... (spliced by build) ====` 标记处（一源两物）。
 *
 * 本文件由同名 .js 转成 TypeScript（#1253）：只加类型标注与下面这些说明，逻辑、字符串、数字、
 * 对象键与次序、函数名与导出名一字未动。契约照旧不能改：本文件是模块真源（ESM 导出），
 * scripts/build.mjs 构建时剥掉行首 export 后把声明体拼进 src/client/index.js 的客户端闭包
 * （一源两物）；模块说明符保持 .js 后缀，由 scripts/ts-hook.mjs 改指同名 .ts。
 * 另外两条不许改：items 数组里的先后次序是 #1198 定的显示顺序，折叠优先级那几个数字是 #818 定的
 * 让位顺序，两者互相独立；能力门控一律「有就用、没有就当这个能力不存在」，不在这里自己定义判据。
 */
/**
 * 闭包环境声明（类型检查时才看，转译时整段抹掉，真机上有值）：
 * 下面这些名字不在本文件里定义，是客户端闭包里更早拼进来的环境与叶子（React 与 h / Ic / tr、
 * emit 与快照那几个口、页签能力判据、会话动作、Tip 与 portalTop、构建期注入的版本与仓库地址），
 * 由构建按 build.mjs 的次序拼进同一个函数作用域带进来，这里只声明形状、不参与转译。为什么不写
 * import：拼进闭包的片段里留着运行时 import，运行时就是语法错。声明成 any / (...args: any[]): any
 * 而不是精确签名，是为了保证「只加类型、不加约束」——转译后一字不差。
 */
declare const React: any;
declare const portalTop: any;
declare const Tip: any;
declare const DSW_REPO_URL: any;
declare const DSW_VERSION: any;
declare const snapFresh: any;
declare const loadSnapshot: any;
declare const prTabVisible: any;
declare const vcTabVisible: any;
declare const openTextInNewSession: any;
declare const newWayfinderText: any;
declare const newSessionTitleNew: any;
declare const newBugWayfinderText: any;
declare const emit: any;
declare function Ic(...args: any[]): any;
declare function tr(...args: any[]): any;
declare function h(...args: any[]): any;
export const useTabsRow = function (s: any, tabsRef: any) {
  const [tabTip, setTabTip] = React.useState(null)
  const tabsTip = function (e: any, text: any, priority: any) {
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
  const tabBtn = (id: any, icon: any, label: any, priority: any) => h('button', { className: 'dsws-tab' + (s.tab === id ? ' on' : ''), 'data-priority': priority, onMouseMove: function (e: any) { tabsTip(e, label, priority) }, onMouseLeave: tabsTipOff, onClick: function () { s.tab = id; emit(s); if (!snapFresh(s)) loadSnapshot(s, false) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
    Ic({ n: icon, size: 12 }),
    h('span', null, label),
  ])
  // #506 拉取请求独立页签：能力门控显隐，只读能力位，不写后端名字。
  const showPr = (typeof prTabVisible === 'function') ? prTabVisible(s) : false
  // #818 版本管理页签（地图 #810）：照「拉取请求」这条先例做能力门控显隐。判据 vcTabVisible 由视图那一侧提供
  //   （会排在 tabs 之前拼接），这里只做「有就用、没有就当这个能力不存在」的兜底，不自己定义它。
  const showVc = (typeof vcTabVisible === 'function') ? vcTabVisible(s) : false
  // 折叠优先级随 #818 调整（原来依次是 列表4 / 拉取请求5 / 技能6 / 环境检查7）：折叠机按数值
  //   从大到小逐个收，数值越大越早让位。新页签插在列表之后、占 5，既有三项各加一档挪成 6/7/8，两个理由：
  //   1) 既有三项之间「拉取请求 → 技能 → 环境检查」的相对折叠次序一个字不动；
  //   2) 新页签紧随列表之后显示，在需要让位的页签里最晚被折叠（比列表先走，比既有三项都晚）。
  // #1198 显示顺序调整：技能页签放到第二位，其余页签的相对顺序不变。
  //   只改下面 items 数组的先后，不管折叠优先级的数字：技能仍用 7，版本管理仍用 5，
  //   拉取请求仍用 6，环境检查仍用 8。变窄时还是按数字从大到小收起，先收环境检查，
  //   再收技能，与改动前完全一样，这样改动最小，不会带出意外的折叠变化。
  const items = [
    tabBtn('list', 'list', tr('panel.tabList'), 4),
    tabBtn('skills', 'compass', tr('panel.tabSkills'), 7),
    showVc ? tabBtn('versionControl', 'branch', tr('panel.tabVersionControl'), 5) : null,
    showPr ? tabBtn('pr', 'swap', tr('panel.tabPr'), 6) : null,
    tabBtn('checks', 'gear', tr('panel.tabChecks'), 8),
    h('span', { style: { flex: 1 } }),
    // v1.5 T6 修订（V2 描边紫 · 刷新左侧）：新增 wayfinder —— 注入 /wayfinder + 仓库信息 + 需求引导
    // issue #4：新增 BUG 单 —— 同构按钮（新会话预填 /wayfinder 新增 BUG 单 prompt）
    h('button', { className: 'dsws-btn', 'data-priority': 2, onMouseMove: function (e: any) { tabsTip(e, tr('panel.newWayfinderTitle'), 2) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newWayfinderText(s), newSessionTitleNew('requirement')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #c084fc', color: '#c084fc', fontWeight: 600 } }, [
      Ic({ n: 'map', size: 11 }),
      h('span', null, tr('panel.newWayfinder')),
    ]),
    h('button', { className: 'dsws-btn', 'data-priority': 1, onMouseMove: function (e: any) { tabsTip(e, tr('panel.newBugTitle'), 1) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newBugWayfinderText(s), newSessionTitleNew('bug')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #f87171', color: '#f87171', fontWeight: 600 } }, [
      Ic({ n: 'bug', size: 11 }),
      h('span', null, tr('panel.newBug')),
    ]),
    // T2 #2 那颗「刷新」2026-09-22 挪出这一排了：维护者要求它离开面板的第二排，与「上次更新」的时间盒子
    //   并排放到面板头部第一行右侧（画在 panel/Dock.js 的头部那一行里）。所以这一排从此没有 priority=3
    //   的元素，版本号「什么时候让位」的判据也跟着换了口径 —— 见 Dock.js 折叠机第 3 步（按其真实处境判）。
    (tabTip && portalTop) ? portalTop(h('div', { style: { position: 'fixed', left: tabTip.x, top: tabTip.y, zIndex: 2147483000, padding: '4px 8px', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.4)', maxWidth: 220 } }, tabTip.text)) : null,
    // #repo-link：版本号可点——新窗打开插件仓库主页（DSW_REPO_URL 构建期注入，见 index.js；hover 样式在 styles.js .dsws-ver）
    h(Tip, { content: DSW_REPO_URL }, h('a', { className: 'dsws-ver', href: DSW_REPO_URL, target: '_blank', rel: 'noreferrer', style: { fontSize: 9, flex: 'none', fontVariantNumeric: 'tabular-nums' } }, DSW_VERSION)),
  ]
  return { tabsRef: tabsRef, items: items }
}
