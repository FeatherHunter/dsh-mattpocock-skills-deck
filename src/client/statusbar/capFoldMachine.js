// statusbar/capFoldMachine.js — 状态栏胶囊那条横条的阶梯机（#725，维护者 2026-09-24 定）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。
//
// 这一台做什么：照 statusbar/capFold.js 那条纯判据把胶囊推到某一档（第几档每一段画什么都是判据算的），
//   量一次放不放得下（scrollWidth 溢没溢出），放不下就再往下走一档，直到放得下、或者阶梯走完。
//   收起来的形状 = 给那一段字的 span 加 .dsws-folded（display:none）—— 数字与图标是它的兄弟节点，
//   不是这条阶梯里的东西，从头到尾不动它们。
//
// 为什么单独一个文件、而不是照 panel/Dock.js 那台头部折叠机住进组件里：读写这一小段 DOM 要四十行上下，
//   StatusBar.js 塞进去就顶破 350 行上限（那台住 Dock 里，是因为 Dock 还有地方）。所以这里沿用同一套做法，
//   只是把「判据（纯函数）/ 机器（碰 DOM）/ 接线（组件）」三件事分开住。
//
// keep 是调用方跨调用带着走的两张表（挂在组件的 ref 上，键都是 data-fold-priority 号码串）：
//   · keep.full —— 每一段**完整的那串字**。机器画上去的是收短后的样子，若下一趟照着 DOM 里那串收短的字
//     再收一次，就会越收越短、再也展不开；所以「完整的那串」必须记在机器外面。
//   · keep.written —— 机器上一次写进 DOM 的那一串。用来认出「这不是我写的」：React 重渲染时会把收短过的
//     那串换回完整的一串（时间串一直在变），那一次写入要当成新的事实，重新排一遍阶梯。
// 返回：最后定下来的档号（同时写进 cap.dataset.foldTier，供真机门禁等它稳定；cap.dataset.fold 记折叠段数）。
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
