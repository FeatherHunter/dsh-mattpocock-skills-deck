// views/versionControl/vcViews.js — 布局 C：三个视图（改动 / 提交历史 / 工作树）（#853 第三步）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js。
//
// 为什么是三个视图：原设计把功能从上到下顺排，要用一个功能就得往下翻（人验收原话）。
//   布局 C 把改动、提交历史、工作树拆成三个视图，页签上带数量，一眼知道东西在哪个视图里；
//   每个视图只放它自己的动作（改动页的暂存与提交本来就在 changes 块里；历史页放加载更多；工作树页放列表）。
// 与 #821 的偏离（人定的，记在这里）：规格把「其他工作树 → 提交历史」定在首屏顺序里，
//   布局 C 把它们收到页签后面；内容、顺序、文案的其余部分一个字不动。
// 页签文字不造新词：直接复用三个段标题的既有词条（未提交改动 / 提交历史 / 其他工作树），
//   数字是纯数字（与词条里「已暂存（3）」同一套全角括号语法）。
export const VC_VIEWS = ['changes', 'commits', 'worktrees']
// 跨挂载记住上次选的视图（面板每次切进页签都重挂载；同一会话内记住，换工作区由调用方复位）。
let vcViewMemory = 'changes'
export const vcRememberedView = function () { return VC_VIEWS.indexOf(vcViewMemory) >= 0 ? vcViewMemory : 'changes' }
export const vcRememberView = function (v) { if (VC_VIEWS.indexOf(v) >= 0) vcViewMemory = v; return vcRememberedView() }
export const vcResetViewMemory = function () { vcViewMemory = 'changes'; return vcViewMemory }
export const vcViewOf = function (ui) { const v = ui && ui.view; return VC_VIEWS.indexOf(v) >= 0 ? v : 'changes' }
// 页签上那三个数字：改动按文件数（冲突 + 已暂存 + 未暂存），历史按已读到的提交数，工作树按棵数。
export const vcViewCountsOf = function (screen, reads) {
  const s = screen || {}
  const files = Math.max(0, (Number(s.conflictCount) || 0) + (Number(s.stagedCount) || 0) + (Number(s.unstagedCount) || 0))
  const first = Array.isArray(s.commits) ? s.commits.length : 0
  const more = (reads && reads.log && Array.isArray(reads.log.commits)) ? reads.log.commits.length : 0
  const trees = Array.isArray(s.otherWorktrees) ? s.otherWorktrees.length : 0
  return { changes: files, commits: first + more, worktrees: trees }
}
// 块按视图分区。常驻的是全局信息（刷新提示、异常带、身份行）；其余各归其视图。
//   例外：点开某一笔提交时，changes 块画的是那笔提交的文件清单 —— 它属于「提交历史」视图。
export const vcViewBlocksOf = function (blocks) {
  const out = { always: [], changes: [], commits: [], worktrees: [] }
  ;(blocks || []).forEach(function (b) {
    if (!b) return
    if (b.kind === 'changes' && b.commitMode) { out.commits.push(b); return }
    if (b.kind === 'changes') { out.changes.push(b); return }
    if (b.kind === 'commits') { out.commits.push(b); return }
    if (b.kind === 'other' || b.kind === 'terminal') { out.worktrees.push(b); return }
    out.always.push(b)
  })
  return out
}
// 视图页签那一行（o: { view, counts, t, onPick }；工作树那一档直接复用带数的既有词条）。
export const vcViewTabsNode = function (h, o) {
  const view = vcViewOf({ view: o.view })
  const counts = o.counts || { changes: 0, commits: 0, worktrees: 0 }
  const t = o.t
  const tab = function (key, label, n) {
    const on = view === key
    const kids = [h('span', { key: 'label' }, label)]
    if (n !== null && n !== undefined) kids.push(h('span', { key: 'n', className: 'dsws-vc-mono' }, '\uFF08' + String(n) + '\uFF09'))
    return h('button', { key: key, type: 'button', role: 'tab', 'data-vc-view': key, 'aria-selected': on ? 'true' : 'false', className: 'dsws-vc-view' + (on ? ' is-on' : ''), onClick: function () { o.onPick(key) } }, kids)
  }
  return h('div', { key: 'views', className: 'dsws-vc-views', 'data-vc-views': 1, role: 'tablist' }, [
    tab('changes', t('vc.changes.title'), counts.changes),
    tab('commits', t('vc.commits.title'), counts.commits),
    tab('worktrees', t('vc.other.title', { n: String(counts.worktrees) }), null),
  ])
}
