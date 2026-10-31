/**
 * views/shared/fallbackMark.ts — 列表头部那枚「这次取数走了 REST 通道」的小标识（票 #1699）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 的 `// ==== leaf:fallbackMark (spliced by build) ====` 标记处（源码树里只有这一份真源）。
 *
 * 为什么要有它：通知中心就位后，列表里那条占一行的降级横幅退役 —— 历史进通知中心，
 *   而「现在是不是降级」仍要一眼看得见，所以改成列表头部 KPI 那一行里的一枚小标识（不占行）。
 * 三条口径不能改（改它的人请照旧守住）：
 *   ① 当前状态的唯一真源仍是快照：判据是 truthLines 的 restFallbackView（只读 st.snapshot 的 fallback 标记与时刻），
 *      不从通知事件库的历史反推现在；两边对不上时按快照说，历史只在通知中心里说明差异。
 *   ② 只说事实：超过一小时改口「上次…」、只有配额原因才提配额 —— 说哪一句由 restFallbackView 给键，
 *      这里只负责画，不另造一句，也不自己写色值（警告档取 freshnessToneColor('yellow')）。
 *   ③ 关闭能力随横幅一起退役：历史在通知中心，这枚标识不给关闭钮、不写 sessionStorage，
 *      免得又冒出一份「本会话不再提示」的会话态。
 */
declare const React: any
declare const DswsCtx: any
declare const restFallbackView: any
declare const freshnessToneColor: any
declare const Ic: any
declare const tr: any
declare const Tip: any

export const FallbackMark = ({ st }: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const view = (typeof restFallbackView === 'function') ? restFallbackView(st, Date.now(), 0) : null
  if (!view) return null
  // 完整那句话给悬停提示与读屏标签；行上只留一个短标签，免得把 KPI 那一行挤换行。
  const full = tr(view.key, view.params)
  const tone = (typeof freshnessToneColor === 'function') ? freshnessToneColor('yellow') : ''
  return h(Tip, { content: full }, h('span', { 'data-fallback-mark': view.stale ? 'stale' : 'now', 'aria-label': full, style: { display: 'inline-flex', alignItems: 'center', gap: 3, flex: 'none', fontSize: 10, lineHeight: '14px', color: tone } }, [Ic({ n: 'alert', size: 10 }), h('span', null, tr('list.fallbackMark'))]))
}
