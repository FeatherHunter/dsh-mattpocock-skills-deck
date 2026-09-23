// panel/headFold.js — 面板头部第一行的逐字折叠阶梯（#667，维护者 2026-09-22 第三轮定）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。
//
// 维护者这一轮的要求：这一行里凡是会随宽度变短的东西，**都不许整块一下子不见** ——
//   一次让步最多只能少一个字符（例外只有一个：刷新那颗齿轮图标永不让位，它是这个控件唯一还能点的入口）。
//   所以这里没有「显示 / 隐藏」两种状态，只有一条一条的阶梯：每个元素列出一串从全长到最短的样子，
//   相邻两步之间只差一个字符；那几颗本来就是单个字形的小图标没有字，就一颗一颗地撤（一步撤一颗）。
//
// 让位顺序（维护者定，就是下面 steps 的先后）：
//   ① 最右侧那两个控件先瘦身：刷新按钮上的字逐字变少（刷新 → 刷 → 一个字都不剩，只剩齿轮图标），
//      再轮到时间标签那句相对时间逐字变少（3 分钟前 → 3 分钟 → 3 分 → …）；
//   ② 然后仓库名尾部逐字变短，末尾补一个省略号记号说明「后面还有字」；完整名字在悬停提示里，一个字都不丢；
//   ③ 然后那几颗单字形小图标从最右一颗开始，一颗一颗撤；
//   ④ 刷新那颗齿轮图标不在阶梯里 —— 谁也收不走它。
//
// 这里只有判据（纯函数，不画界面也不量宽度）：阶梯怎么排、第几档每个元素画什么。
//   画（Dock.js 的渲染）与量（Dock.js 那台头部折叠机）都读这两个函数，两边不会各说各话。
//   判据的自动检查在 tests/verify-667-dock-header-no-brand.js 的 G 组：不开浏览器，直接喂数据逐档核对
//   「相邻两档之间每个元素最多少一个字符」这条，还有顺序。
/** 排一条阶梯。data = { name, refresh, time, icons }：那三串字，加小图标的撤走顺序（靠前的先撤）。 */
export const headFoldLadderOf = function (data) {
  const d = data || {}
  const ladder = { name: String(d.name || ''), refresh: String(d.refresh || ''), time: String(d.time || ''), steps: [] }
  const push = function (el, n) { for (let i = 1; i <= n; i++) ladder.steps.push({ el: el, n: i }) }
  push('refresh', ladder.refresh.length) // ① 刷新按钮上的字
  push('time', ladder.time.length)       // ① 时间标签那句相对时间
  push('name', ladder.name.length)       // ② 仓库名（尾部逐字减）
  const icons = Array.isArray(d.icons) ? d.icons : []
  for (let i = 0; i < icons.length; i++) ladder.steps.push({ el: 'icon', id: String(icons[i]) }) // ③ 小图标一颗一颗
  return ladder
}
/** 第 tier 档每个元素画什么（tier = 已经走了几步，所以相邻两档之间每个元素最多差一个字符）。 */
export const headFoldStateAt = function (ladder, tier) {
  const l = ladder || { name: '', refresh: '', time: '', steps: [] }
  const steps = Array.isArray(l.steps) ? l.steps : []
  const n = Math.max(0, Math.min(Math.floor(Number(tier) || 0), steps.length))
  const dropped = { refresh: 0, time: 0, name: 0 }
  const icons = {}
  for (let i = 0; i < n; i++) {
    const s = steps[i]
    if (s.el === 'icon') icons[String(s.id)] = false
    else if (s.el === 'refresh' || s.el === 'time' || s.el === 'name') dropped[s.el] = s.n
  }
  const cut = function (text, drop) { return text.slice(0, Math.max(0, text.length - drop)) }
  return {
    tier: n,
    refresh: cut(l.refresh, dropped.refresh),
    time: cut(l.time, dropped.time),
    // 仓库名一收短就带省略号记号；记号自己也算一个字符，于是最后一步恰好是「X…」→「…」。
    name: cut(l.name, dropped.name) + (dropped.name > 0 && l.name ? '…' : ''),
    icons: icons,
  }
}
