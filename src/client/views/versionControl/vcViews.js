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
// 块按视图分区（854 布局 C 原型：异常带只在改动视图里，常驻的只有刷新提示与身份行）。
//   例外：点开某一笔提交时，changes 块画的是那笔提交的文件清单 —— 它属于「提交历史」视图。
export const vcViewBlocksOf = function (blocks) {
  const out = { always: [], changes: [], commits: [], worktrees: [] }
  ;(blocks || []).forEach(function (b) {
    if (!b) return
    if (b.kind === 'band') { out.changes.push(b); return }
    if (b.kind === 'changes' && b.commitMode) { out.commits.push(b); return }
    if (b.kind === 'changes') { out.changes.push(b); return }
    if (b.kind === 'commits') { out.commits.push(b); return }
    if (b.kind === 'other' || b.kind === 'terminal') { out.worktrees.push(b); return }
    out.always.push(b)
  })
  return out
}
// 视图页签那一行（o: { view, counts, t, onPick }；文案按 854 布局 C 原型：改动／提交历史／工作树，数字空格相隔，不加括号）。
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
    tab('changes', t('vc.views.changes') + ' ' + String(counts.changes), null),
    tab('commits', t('vc.commits.title') + ' ' + String(counts.commits), null),
    tab('worktrees', t('vc.views.worktrees') + ' ' + String(counts.worktrees), null),
  ])
}
// 数字条的数据（854 布局 C 原型 changes 视图里的三个数字块：卡在冲突里／已暂存／未暂存）。
export const vcStatsOf = function (screen) {
  const s = screen || {}
  return [
    { key: 'conflict', n: Math.max(0, Number(s.conflictCount) || 0), tone: 'conflict' },
    { key: 'staged', n: Math.max(0, Number(s.stagedCount) || 0), tone: 'staged' },
    { key: 'unstaged', n: Math.max(0, Number(s.unstagedCount) || 0), tone: 'unstaged' },
  ]
}
// 数字条那一行（o: { stats, t }；文案走 vc.stats.*，深浅两套由皮肤令牌换肤）。
export const vcStatsNode = function (h, o) {
  const t = o.t
  const name = { conflict: t('vc.stats.conflict'), staged: t('vc.stats.staged'), unstaged: t('vc.stats.unstaged') }
  return h('div', { key: 'stats', className: 'dsws-vc-stats', 'data-vc-stats': 1 }, (o.stats || []).map(function (s) {
    return h('div', { key: s.key, className: 'dsws-vc-stat', 'data-vc-stat': s.key }, [
      h('div', { key: 'n', className: 'dsws-vc-stat-n' }, String(s.n)),
      h('div', { key: 't', className: 'dsws-vc-stat-t' }, name[s.key] || s.key),
    ])
  }))
}
// 某视图首屏未拿到数据时的骨架（o: { view }；结构与该视图一致：改动画数字条加视图条加文件行，其余两视图画行）。
export const vcViewSkelNode = function (h, o) {
  const bar = function (key, style) { return h('div', { key: key, className: 'dsws-vc-skel', 'data-vc-skel': 1, style: style }) }
  // 门禁 G5 要求首屏骨架不少于 10 条且一个字不写：三格都按 10 条画，结构仍与各视图一致。
  if (o.view === 'commits' || o.view === 'worktrees') {
    return h('div', { key: 'skel', 'data-vc-skel-root': 1, style: { display: 'flex', flexDirection: 'column', padding: '2px 0' } }, [
      bar('h1', { height: 13 }), bar('h2', { height: 13 }), bar('h3', { height: 13 }), bar('h4', { height: 13 }), bar('h5', { height: 13 }),
      bar('h6', { height: 13 }), bar('h7', { height: 13 }), bar('h8', { height: 13 }), bar('h9', { height: 13 }), bar('h10', { height: 13 }),
    ])
  }
  return h('div', { key: 'skel', 'data-vc-skel-root': 1, style: { display: 'flex', flexDirection: 'column', padding: '2px 0' } }, [
    h('div', { key: 'stats', style: { display: 'flex', gap: 6 } }, [bar('c1', { width: 64, height: 34 }), bar('c2', { width: 64, height: 34 }), bar('c3', { width: 64, height: 34 })]),
    bar('v1', { height: 30 }), bar('r1', { height: 13 }), bar('r2', { height: 13 }), bar('r3', { height: 13 }), bar('r4', { height: 13 }), bar('r5', { height: 13 }), bar('r6', { height: 13 }),
  ])
}
