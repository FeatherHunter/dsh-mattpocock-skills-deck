/**
 * views/issueDetailFold.js — ISSUE 详情页顶栏那一行的逐字折叠阶梯（#763）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物）。
 *
 * 维护者要求（#763 第三轮）：折叠不放省略号，字看不见就直接裁掉；
 * 返回列表四个字优先折叠，先掉“列表”剩“返回”，再收到只剩返回图标；
 * 一次只折一个控件的文字，直至只剩图标，再折下一个控件或按钮。
 * 图标（返回、新会话、主动作、复制、外链）永不在阶梯里，谁也收不走它们。
 *
 * 让位顺序（就是下面 steps 的先后）：
 *   ① 返回按钮上的字（返回列表 → 返回 → 空，只剩图标）；
 *   ② 面包屑（那串编号字，尾部逐字减）；
 *   ③ 快照提示（快照 / 加载中那几个字）；
 *   ④ 主动作按钮上的字（修复 / 诊断 / 讨论 / 执行等，收到只剩图标）；
 *   ⑤ 新会话按钮上的字（收到只剩图标）。
 * 复制与外链是纯图标按钮，无字可折，不进阶梯。
 *
 * 这里只有判据（纯函数，不画界面也不量宽度）：阶梯怎么排、第几档每个元素画什么。
 * 画与量（IssueDetail.js 那台折叠机）都读这两个函数，两边不会各说各话。
 */
/** 排一条阶梯。data = { back, crumb, snapshot, primary, newSession }：五串字。 */
export const issueDetailFoldLadderOf = function (data) {
  const d = data || {}
  const ladder = {
    back: String(d.back || ''),
    crumb: String(d.crumb || ''),
    snapshot: String(d.snapshot || ''),
    primary: String(d.primary || ''),
    newSession: String(d.newSession || ''),
    steps: [],
  }
  const push = function (el, n) { for (let i = 1; i <= n; i++) ladder.steps.push({ el: el, n: i }) }
  push('back', ladder.back.length)
  push('crumb', ladder.crumb.length)
  push('snapshot', ladder.snapshot.length)
  push('primary', ladder.primary.length)
  push('newSession', ladder.newSession.length)
  return ladder
}
/** 第 tier 档每个元素画什么（tier = 已经走了几步，相邻两档之间只差一个字，不补省略号）。 */
export const issueDetailFoldStateAt = function (ladder, tier) {
  const l = ladder || { back: '', crumb: '', snapshot: '', primary: '', newSession: '', steps: [] }
  const steps = Array.isArray(l.steps) ? l.steps : []
  const n = Math.max(0, Math.min(Math.floor(Number(tier) || 0), steps.length))
  const dropped = { back: 0, crumb: 0, snapshot: 0, primary: 0, newSession: 0 }
  for (let i = 0; i < n; i++) {
    const s = steps[i]
    if (s.el === 'back' || s.el === 'crumb' || s.el === 'snapshot' || s.el === 'primary' || s.el === 'newSession') dropped[s.el] = s.n
  }
  const cut = function (text, drop) { return String(text || '').slice(0, Math.max(0, String(text || '').length - drop)) }
  return {
    tier: n,
    back: cut(l.back, dropped.back),
    crumb: cut(l.crumb, dropped.crumb),
    snapshot: cut(l.snapshot, dropped.snapshot),
    primary: cut(l.primary, dropped.primary),
    newSession: cut(l.newSession, dropped.newSession),
  }
}
