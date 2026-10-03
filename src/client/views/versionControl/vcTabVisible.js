// views/versionControl/vcTabVisible.js — 「版本管理」页签什么时候显示（#818 · 总工程师 2026-10-04 裁定）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。views/shared/Tabs.js 按
//   (typeof vcTabVisible === 'function') ? vcTabVisible(s) : false 调用它，所以名字与入参不许改。
//
// 结论：**一律显示**，这个谓词直接回 true。
//
// 为什么不是「不是 git 仓库就藏起来」（把这条裁定自己的理由也留在这儿，免得下一轮重新讨论）：
//   1. 藏的条件必须**便宜且正确**。客户端的显隐谓词必须同步、不打任何电话、不许 await。
//   2. 客户端手上确实有一个「往仓库那边看」的事实：面板快照里的 repoRoot
//      （src/host/snapshotEnvelope.js 第 19 行把宿主算出的仓库根放进每一份 ok 快照；
//       宿主侧 src/host/repoKeys.js 的 getRepoRoot 只在 git rev-parse --show-toplevel 真拿到根时才给非空值）。
//      「非空字符串 ⇒ 这个目录确实在 git 仓库里」这一半是可靠的；但反过来**不成立**：
//      repoRoot 为 null 既可能是「这里不是仓库」，也可能是「这台机器上没有 git」「那一次命令没跑成」，
//      三件事在客户端分不开。拿它去藏，会把「本地是 git 仓库、只是这一趟没问出来」这种真能用的情况一起藏掉。
//   3. 快照还没回来、或快照失败了的时候，这个值根本不存在，判据只能退化成「先藏起来」——
//      那正是用户抱怨过的「我以为这个功能没做」。
//   4. 票面第 5 条的本意是「别让用户看到一个死页签」。一个会说真话的空态不是死页签：
//      这个目录真不是 git 仓库时，视图在拿到 wf.gitStatus 的 not-repo 之后会如实说出来
//      （那句话在词条 vc.fail.notRepo 里），而且不给重试按钮——它不是读取失败，是这个目录本来就不是仓库。
// 这条偏离由总工程师裁定并会写进 #818 正文与地图记录，验收时由独立验收者专门攻它。
export const vcTabVisible = function (st) {
  void st
  return true
}
