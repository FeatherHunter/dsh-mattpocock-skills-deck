// views/versionControl/vcFold.js — 版本管理页签「随宽度逐格让位」的纯规则（#818）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。本文件不画界面、不量宽度、不打电话：阶梯怎么排、第几档每一处
//   画什么，只有判据。画（VersionControlTab.js 的渲染）与量（同一个组件的折叠机）都读这里，
//   两边不会各说各话。形状照 panel/headFold.js 那条先例：一次让位最多少一个字符，完整内容留在
//   悬停提示里一个字都不丢。
// 依赖说明（不是自包含的）：本文件裸引用同一闭包内更早拼接的 vcText.js 里的 vcTail / vcMiddle /
//   VC_MIDDLE_MIN（与 views/shared/Tabs.js 引用 vcTabVisible 是同一个既有形态，运行时没有问题）。
//   离线单独 import 这个文件会在调用时 ReferenceError；要离线核对，先把这三个名字注入进去
//   （tests/verify-818-version-control-view.js 就是这么做的：按拼接顺序把七个叶子拼成闭包再跑）。
//
// ── 宽度依据（动手前先查了一遍，结论与出处写在这里，别再猜）────────────────────────────
// ① 「面板宽 300-520 像素」：**仓库里没有约束代码**，只有 src/client/panel/Dock.js 自己的两处
//    记录值注释（第 8 行「宽度 300-520px 可拖拽」、第 36 行「列宽感知：details 列 300-520px」）。
//    那一条列的宽度由 DSH 外壳拖着走，本插件只在自己根元素上量。另有一份较早的原型页
//    docs/prototype/293-pr-tab-dynamic.html 第 83 行记的是 280-640、默认 460（窄屏分界 380 与
//    Dock.js 第 57 行一致）。所以：**300-520 属记录值，不是可核对的约束**，本次未找到更硬的出处。
// ② 「正文可用宽 = 面板宽 − 24」：**有出处**。Dock.js 第 332 行内容区那一层写死
//    padding: '10px 12px'（左右各 12 像素），本页签就画在那一层里面；docs/prototype/
//    p1-map-row-responsive.html 第 293 行也把这条写成「面板 360/480（含 body 12*2 …）40px 内边距」。
// ③ 由 ①② 推出来的正文可用宽记录区间是 276-496。下面的三档阈值就落在这个区间里；真机若量到
//    别的宽度，让位照样按同一张表走（第 0 档是最宽的样子，量不到宽度也按第 0 档画）。
//    规格要求的那次「动手前在真机量一次」没有条件做（本次改动只碰源码、不开真机面板），
//    所以这一条按 ① 的记录值 + ② 的出处实现，并在本注释里标明 ① 是无出处的假设。
//
// ── 让位次序（规格写死的那张表，就是下面 steps 的先后）──────────────────────────────
//   ① 工作树位置（身份行里那一条路径）最先让：逐字砍、砍的是中段，文件名/末级目录那一头留着；
//   ② 然后「其他工作树」列表：宽度再窄下去先收成一行摘要（band 1），不减内容只换形状；
//   ③ 提交历史最后让：先逐字砍每条提交的说明（本文件），更窄才整块收起（band 3）。
//   永不让位（不进阶梯）：身份行本身（工作树显示名与分支名）、异常带、未提交改动的计数与汇总句。
// 「其他工作树收成一行摘要」与「提交历史整块收起」两件事只按可用宽度分档（下面 vcFoldBandAt），
//   其余逐字让位由组件那台折叠机摸着真实宽度一档一档推进来（照 panel/Dock.js 头部那台先例）。
export const VC_FOLD_BANDS = [420, 360, 300]
/**
 * 可用宽度 → 粗档（band）。量不到有效宽度（0、负数、非数字）一律回第 0 档：
 * 没量到就画最全的样子，绝不因为「没量到」把内容让掉（与 panel/headFold.js、statusbar/capFold.js 同一条纪律）。
 */
export const vcFoldBandAt = function (availWidthPx) {
  const w = Number(availWidthPx)
  if (!isFinite(w) || w <= 0) return 0
  if (w >= VC_FOLD_BANDS[0]) return 0
  if (w >= VC_FOLD_BANDS[1]) return 1
  if (w >= VC_FOLD_BANDS[2]) return 2
  return 3
}
/**
 * 阶梯要用的三串东西（元素清单）：身份行那条路径、其他工作树的显示名、每条提交的说明。
 * 显示名直接用状态模型里已经算好的那个（核心按「能互相区分的最短后缀」算过），不再派生第二份。
 */
export const vcFoldDataOf = function (screen, reads) {
  const s = screen || {}
  const identity = s.identity || {}
  const others = Array.isArray(s.otherWorktrees) ? s.otherWorktrees : []
  const commits = vcCommitListOf(s, reads)
  return {
    path: String(identity.worktreePath || ''),
    others: others.map(function (w) { return String((w && w.display) || '') }),
    commits: commits.map(function (c) { return String((c && c.subject) || '') }),
  }
}
/** 首屏那批提交加上按需续读回来的那批：按对象编号去重，先来的排前面（顺序就是提交时间倒序）。 */
export const vcCommitListOf = function (screen, reads) {
  const first = (screen && Array.isArray(screen.commits)) ? screen.commits : []
  const log = (reads && reads.log && Array.isArray(reads.log.commits)) ? reads.log.commits : []
  const out = []
  const seen = {}
  const push = function (c) {
    if (!c) return
    const k = String(c.oid || '') || String(c.short || '') + '|' + String(c.subject || '')
    if (seen[k]) return
    seen[k] = true
    out.push(c)
  }
  first.forEach(push)
  log.forEach(push)
  return out
}
/**
 * 排一条阶梯。data = { path, others, commits } 三串东西（见 vcFoldDataOf）。
 * 每一步只让一个字符（路径砍中段时，显示长度恰好每次少一个；名字与说明砍尾同理）。
 * 顺序就是文件头那张表：路径在前，其他工作树居中，提交说明在最后。
 */
export const vcFoldLadderOf = function (data) {
  const d = data || {}
  const ladder = {
    path: String(d.path || ''),
    others: (Array.isArray(d.others) ? d.others : []).map(function (x) { return String(x || '') }),
    commits: (Array.isArray(d.commits) ? d.commits : []).map(function (x) { return String(x || '') }),
    steps: [],
  }
  const push = function (el, i, n) { for (let k = 1; k <= n; k++) ladder.steps.push({ el: el, i: i, n: k }) }
  // 路径这一条按「砍中段」的规矩让位：核心那条规则短于 VC_MIDDLE_MIN 就不砍了，
  //   所以步数封顶在「长度 − VC_MIDDLE_MIN」；不留这个上限会在阶梯末尾一步弹回全长（真机反馈过）。
  push('path', -1, Math.max(0, ladder.path.length - VC_MIDDLE_MIN))
  for (let i = 0; i < ladder.others.length; i++) push('other', i, ladder.others[i].length)
  for (let i = 0; i < ladder.commits.length; i++) push('commit', i, ladder.commits[i].length)
  return ladder
}
/** 第 tier 档每一处画什么（tier = 已经走了几步，所以相邻两档之间每一处最多差一个字符）。 */
export const vcFoldStateAt = function (ladder, tier) {
  const l = ladder || { path: '', others: [], commits: [], steps: [] }
  const steps = Array.isArray(l.steps) ? l.steps : []
  const n = Math.max(0, Math.min(Math.floor(Number(tier) || 0), steps.length))
  let pathDrop = 0
  const otherDrop = {}
  const commitDrop = {}
  for (let i = 0; i < n; i++) {
    const s = steps[i]
    if (s.el === 'path') pathDrop = s.n
    else if (s.el === 'other') otherDrop[s.i] = s.n
    else if (s.el === 'commit') commitDrop[s.i] = s.n
  }
  // 砍到最后一个字符时收成空串：vcMiddle / vcTail 在「长度不够就不砍」那条兜底下会把整串原样还回来，
  //   直接拿它画会在阶梯的末尾弹回全长（真机反馈过的那条回弹）。空串只出现在阶梯最后一步，
  //   完整内容仍在悬停提示里，一个字都没丢。
  const tailAt = function (text, drop) { const keep = text.length - drop; return keep <= 0 ? '' : vcTail(text, keep) }
  const path = l.path ? (pathDrop >= l.path.length ? '' : vcMiddle(l.path, l.path.length - pathDrop)) : ''
  return {
    tier: n,
    path: path,
    others: l.others.map(function (text, i) { return tailAt(text, otherDrop[i] || 0) }),
    commits: l.commits.map(function (text, i) { return tailAt(text, commitDrop[i] || 0) }),
  }
}
/**
 * 规格要的那一个入口：可用宽度 + 元素清单 → 该画什么。
 * 回的是「粗档的两个决定 + 阶梯本体 + 第 0 档的样子」；逐字让位由组件摸着真实宽度推进档号，
 * 每推进一档就照 vcFoldStateAt 再算一次（画与量读同一份判据）。
 */
export const vcFoldOf = function (availWidthPx, data) {
  const band = vcFoldBandAt(availWidthPx)
  const ladder = vcFoldLadderOf(data)
  return {
    band: band,
    otherMode: band >= 1 ? 'summary' : 'list',
    commitsCollapsed: band >= 3,
    ladder: ladder,
    state: vcFoldStateAt(ladder, 0),
  }
}
