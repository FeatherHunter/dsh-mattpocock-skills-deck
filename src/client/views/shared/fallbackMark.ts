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
 *   ③ 可以关，但只关本次会话：用户点掉之后写 sessionStorage（键里带工作区，各开会话各记各的），
 *      不写 localStorage、不落盘、不加定时器 —— 关掉标签页就散，不会在某个工作区永久遮住降级；
 *      下一次降级的时刻（快照的 fallbackAt）比关闭时刻更晚，标识会重新出现。
 */
declare const React: any
declare const DswsCtx: any
declare const restFallbackView: any
declare const freshnessToneColor: any
declare const Ic: any
declare const tr: any
declare const Tip: any

/**
 * 这枚标识的关闭时刻记在哪：按工作区一把会话键（与通知中心的已读标记同一路做法），
 * 各工作区各记各的，跨刷新留着、关掉标签页就丢。
 */
export const fallbackDismissKeyOf = function (st: any) {
  const snap = st && st.snapshot
  const where = (st && st.cwd) || (snap && snap.repoRoot) || (snap && snap.repo) || ''
  return 'dsws.fallbackDismiss:' + where
}

/** 读回这一档的关闭时刻（毫秒）。没有值、坏 JSON、读不出来一律当「没关过」——宁可多提示一次，不可少提示。 */
export const fallbackDismissedAtOf = function (st: any) {
  if (typeof sessionStorage === 'undefined' || !sessionStorage) return 0
  try {
    const raw = sessionStorage.getItem(fallbackDismissKeyOf(st))
    if (!raw) return 0
    const box = JSON.parse(raw)
    const at = box && Number(box.at)
    return (at && isFinite(at)) ? at : 0
  } catch (e) { return 0 }
}

/** 记下「本次会话关掉了这一档」。只写会话存储、不落盘；返回有没有写成功（写不进去就当没关，标识继续画）。 */
export const fallbackDismissOf = function (st: any, nowMs: any) {
  if (typeof sessionStorage === 'undefined' || !sessionStorage) return false
  const at = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now()
  try { sessionStorage.setItem(fallbackDismissKeyOf(st), JSON.stringify({ at: at })); return true } catch (e) { return false }
}

export const FallbackMark = ({ st }: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  // 关闭时刻是会话呈现态：初值从 sessionStorage 读回，点关闭时写回并让这一格重画。
  const [dismissedAt, setDismissedAt] = React.useState(function () {
    return (typeof fallbackDismissedAtOf === 'function') ? fallbackDismissedAtOf(st) : 0
  })
  const view = (typeof restFallbackView === 'function') ? restFallbackView(st, Date.now(), dismissedAt) : null
  if (!view) return null
  const dismiss = function (e: any) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
    const at = Date.now()
    const ok = (typeof fallbackDismissOf === 'function') ? fallbackDismissOf(st, at) : false
    if (ok) setDismissedAt(at)
  }
  // 完整那句话给悬停提示与读屏标签；行上只留一个短标签，免得把 KPI 那一行挤换行。
  const full = tr(view.key, view.params)
  const tone = (typeof freshnessToneColor === 'function') ? freshnessToneColor('yellow') : ''
  const closeLabel = tr('list.fallbackMarkDismiss')
  return h(Tip, { content: full }, h('span', { 'data-fallback-mark': view.stale ? 'stale' : 'now', 'aria-label': full, style: { display: 'inline-flex', alignItems: 'center', gap: 3, flex: 'none', fontSize: 10, lineHeight: '14px', color: tone } }, [
    Ic({ n: 'alert', size: 10, key: 'icon' }),
    h('span', { key: 'label' }, tr('list.fallbackMark')),
    h('button', { key: 'dismiss', type: 'button', 'data-log': 'list.fallbackmarkdismiss', 'aria-label': closeLabel, title: closeLabel, onClick: dismiss, style: { cursor: 'pointer', background: 'transparent', border: 0, color: 'inherit', padding: '0 2px', margin: 0, fontSize: 11, lineHeight: '14px', font: 'inherit' } }, '×'),
  ]))
}
