/**
 * panel/RepoChipSkeleton.js — 快照还没回来时，面板头部那条灰色占位骨架
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 `// ==== leaf:repoChipSkeleton (spliced by build) ====` 标记处（一源两物）。
 *
 * 这块灰条是搬出来的，不是新画的：2026-09-24 从 panel/Dock.js 拆到这里（Dock.js 当时 358 行，
 * 贴着 350 行上限）。画出来的东西一字未改，只有画它的那段代码换了住处。
 *
 * 它为什么存在（快照没回来之前不许说「未识别仓库」/「没有后端」—— 那是把「还没拿到」说成了结论，
 * 与全屏门控只认快照落地同口径）：2026-09-24 维护者按截图指出「加载中，某些条件下这一栏整块看不见」——
 *   什么都不画会让整行看着像没了，所以改成画一条**灰色占位骨架**：它只说「这里在等数据」，
 *   不声称任何仓库身份。
 *
 * 骨架有三条硬约束，改它的人请照旧守住：
 *   ① 不带 data-repo-text —— 头部折叠机（panel/Dock.js）的入口就是 querySelector('[data-repo-text]')，
 *      取不到它就整台停手，所以骨架的宽度不会被折叠机改写；
 *   ② 定宽 96 —— 折叠机判「放不放得下」量的是整行 scrollWidth，fit-content 的占位会让这一行的宽度
 *      随字体/语言抖动；
 *   ③ 与真芯片同高（20px），真芯片到了这一行不跳行。
 */
export const RepoChipSkeleton = ({ label }) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  return h('span', { 'data-repo-chip-skeleton': 1, 'aria-busy': 'true', 'aria-label': label, style: { display: 'inline-flex', width: 96, height: 20, borderRadius: 6, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.06)', flex: 'none' } })
}
