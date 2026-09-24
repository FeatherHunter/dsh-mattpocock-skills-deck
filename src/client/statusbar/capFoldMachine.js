// statusbar/capFoldMachine.js — 状态栏胶囊那条横条的阶梯机（#725，维护者 2026-09-24 定）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。
//
// 这一台做什么：照 statusbar/capFold.js 那条纯判据把胶囊推到某一档（第几档每一段画什么都是判据算的），
//   量一次放不放得下（scrollWidth 溢没溢出），放不下就再往下走一档，直到放得下、或者阶梯走完。
//   收起来的形状 = 给那一段字的 span 加 .dsws-folded（display:none）—— 数字与图标是它的兄弟节点，
//   不是这条阶梯里的东西，从头到尾不动它们（本文件只碰 [data-fold-priority] 那九段字：
//   数字在 .dsws-num 上、图标在 svg 上，两者都没有这个属性，所以「收到底 = 只剩图标与数字」是结构保证）。
//
// 2026-09-24 真机回归（维护者截图：整条只剩品牌图标与绿点）之后补上的第一条规矩：
//   **量不到有效可用宽的那一趟，不许下任何结论。** 从前是「量到多少就照多少判放不放得下」，
//   于是首帧还没布局时（列宽 0）它照样算出「每一档都放不下」，一路走到最后一档 —— 九个字全被收掉，
//   只剩图标与数字。这里要特别记一笔：那种时刻 cap.clientWidth 并不是 0，而是 12（胶囊自己的
//   3px 6px 内边距 + 1px 边框），所以「clientWidth <= 0 才叫没量到」这条守卫根本挡不住它；
//   真正能分出来的是**内容盒**（孩子能用的那点宽）与矩形宽高一起看，见 capFoldRoom。
//   量不到时不写 DOM、不改档号（保持上一档；首次挂载就保持 React 原样），只安排一次重算。
//
// keep 是调用方跨调用带着走的两张表（挂在组件的 ref 上，键都是 data-fold-priority 号码串）：
//   · keep.full —— 每一段**完整的那串字**。机器画上去的是收短后的样子，若下一趟照着 DOM 里那串收短的字
//     再收一次，就会越收越短、再也展不开；所以「完整的那串」必须记在机器外面。
//   · keep.written —— 机器上一次写进 DOM 的那一串。用来认出「这不是我写的」：React 重渲染时会把收短过的
//     那串换回完整的一串（时间串一直在变），那一次写入要当成新的事实，重新排一遍阶梯。
// 返回：最后定下来的档号（同时写进 cap.dataset.foldTier，供真机门禁等它稳定；cap.dataset.fold 记折叠段数）；
//   这一趟量不到可用宽时返回 null，且不写任何 dataset（门禁据此看得出「还没定档」）。
export const runCapFold = function (cap, keep) {
  const full = (keep && keep.full) || {}
  const written = (keep && keep.written) || {}
  const slots = Array.from(cap.querySelectorAll('[data-fold-priority]')).map(function (el) {
    return { el: el, p: String(el.getAttribute('data-fold-priority') || '') }
  })
  if (!slots.length) return 0
  slots.sort(function (a, b) { return a.p - b.p })
  const items = slots.map(function (s) {
    const now = String(s.el.textContent || '')
    const seen = written[s.p]
    if (seen === undefined || now !== seen) full[s.p] = now
    return { priority: Number(s.p), word: full[s.p] }
  })
  const ladder = capFoldLadderOf({ items: items })
  // 量不到有效可用宽：这一趟到此为止 —— 一个字都不写、档号也不动。
  //   保持上一档不动是有意的：量不到不等于放不下，写下去反而会把「未知」变成一条错结论（真机回归就是这么来的）。
  if (capFoldRoom(cap) === null) { capFoldRetryOnce(cap, keep); return null }
  // 把这一条推到第 tier 档：先把所有折叠类去掉、强制重排一次（拿到「基准」那一档的真实宽度），
  //   再按判据说的把每一段画上 —— 收成空串的那几段加 .dsws-folded，其余原样显示。
  const applyTier = function (tier) {
    const words = capFoldStateAt(ladder, tier).words || {}
    for (let i = 0; i < slots.length; i++) slots[i].el.classList.remove('dsws-folded')
    void cap.offsetWidth
    for (let i = 0; i < slots.length; i++) {
      const text = String(words[slots[i].p] || '')
      slots[i].el.textContent = text
      written[slots[i].p] = text
      if (text === '') slots[i].el.classList.add('dsws-folded')
    }
    void cap.offsetWidth
  }
  // 每一趟都从第 0 档重新走（不接着上次的档继续往下）：宽度变宽时才能回弹到更完整的档位。
  const last = Math.max(0, capFoldStepCount(ladder) - 1)
  let tier = 0
  applyTier(0)
  if (cap.scrollWidth > cap.clientWidth + 1) {
    tier = last
    for (let t = 1; t <= tier; t++) { applyTier(t); if (cap.scrollWidth <= cap.clientWidth + 1) { tier = t; break } }
  }
  cap.dataset.foldTier = String(tier)
  cap.dataset.fold = String(slots.filter(function (s) { return s.el.classList.contains('dsws-folded') }).length)
  return tier
}

/**
 * 这一条现在有多少**可用宽**：返回内容盒宽（孩子真正能摆下的那点宽）；量不到时返回 null（未知）。
 *
 * 为什么要专门一个函数、为什么不拿 clientWidth 直接比阈值：真机上「还没上屏」的那一帧里
 *   cap.clientWidth 是 12（＝左右内边距 6+6，加上边框 1+1 之外的那一圈），不是 0；
 *   而 cap.scrollWidth 是 417（九段字全展开时内容真的有那么宽）。12 与 417 一比，
 *   阶梯上每一档都判「放不下」，于是走到底档 —— 这正是 2026-09-24 那张真机截图的成因。
 *   所以三种「量不到」都要在这里认出来（任一命中就是未知）：
 *   ① 没上屏：不是文档里的节点、矩形宽或高为 0、display:none / visibility:hidden；
 *   ② 内容盒宽 ≤ 0：列宽还没定下来时胶囊只剩内边距那一圈，孩子一个都摆不下；
 *   ③ 拿不到计算样式（元素已摘下来）。
 * 放不放得下仍然用 scrollWidth 与 clientWidth 比（两者都是内边距盒口径，见上面那一句），
 *   本函数的返回值只用来判「这一趟的尺子有没有效」。
 */
const capFoldRoom = function (cap) {
  try {
    if (!cap || !cap.isConnected) return null
    const doc = cap.ownerDocument
    const win = doc && doc.defaultView
    if (!win || typeof win.getComputedStyle !== 'function') return null
    const cs = win.getComputedStyle(cap)
    if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return null
    const rect = cap.getBoundingClientRect()
    if (!(rect.width > 0) || !(rect.height > 0)) return null
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
    const room = cap.clientWidth - pad
    if (!(room > 0)) return null
    return room
  } catch (e) { return null }
}
/**
 * 量不到时安排**一次**重算：下一帧再看一眼就够（首帧没上屏这一种，下一帧通常就定下来了）。
 *   同一张 keep 上只挂一个待办（单飞），跑过一次就摘掉；跑完还是量不到就等外面那几条路来叫它
 *   （ResizeObserver 的两条 / 每次提交后重算 / 字体就绪）—— 这里不排第二次、也不自续
 *   （#709 那条纪律：库里的活不许自己给自己续命）。
 */
const capFoldRetryOnce = function (cap, keep) {
  if (!keep || keep.retryPending) return
  try {
    const win = (cap && cap.ownerDocument && cap.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null)
    if (!win || typeof win.requestAnimationFrame !== 'function') return
    keep.retryPending = true
    win.requestAnimationFrame(function () {
      keep.retryPending = false
      try { if (cap && cap.isConnected) runCapFold(cap, keep) } catch (e) {}
    })
  } catch (e) { keep.retryPending = false }
}
