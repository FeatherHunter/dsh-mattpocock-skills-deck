// views/versionControl/vcRows.js —— 文件行与其他工作树那一层（#842 从 vcBlocks.js 原样搬出）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js 的 leaf 标记处（一源两物）。
//
// 为什么单独一份：vcBlocks.js 已经贴着 350 行上限（tests/verify-file-granularity.js），写操作（#842）还要往块模型里
//   加字段，所以把「行怎么分组、行怎么画、其他工作树怎么画、某个路径的差异读数怎么取」这一层原样搬到这里。
//   搬动只动文件边界，一个字符的逻辑都没改；两份文件在同一个闭包里拼接（vcRows 排在 vcBlocks 之前）。
/** 一个文件条目该怎么分组：冲突单独一组（排在已暂存之后、未暂存之前，照核心与规格的风险次序）。
 *  分组取的是「这条记录来自哪条清单」（row.group），不是记录上的 staged/unstaged 两个标记 ——
 *  同一个 x=M、y=M 的文件在两条清单里是同一个对象，两个标记都是真，拿标记分组会把两条都算进已暂存。 */
export const vcGroupOfRow = function (row) {
  if (row.conflict) return 'conflict'
  return row.group === 'unstaged' ? 'unstaged' : 'staged'
}
/**
 * 未提交改动 → 文件行清单。合并只发生在**冲突**那一种上（规格第 26 条：卡在冲突里的文件只占一行）：
 * 同一路径解析层给两条记录（x 与 y 各一条），这里合成一行并挂冲突标记。
 * 其余同路径的两条记录**不合并** —— x=M、y=M 的文件在 git 眼里就是「两段改动」，git status 自己在
 * 「已暂存」「未暂存」两个小节里各列一次；照它来，汇总句也就能与宿主的 stagedCount / unstagedCount 对上，
 * 用户还能分别看到「我准备好要提交的那部分」与「还没暂存的那部分」（规格故事 15、16）。
 */
export const vcFileRowsOf = function (screen) {
  const staged = (screen && Array.isArray(screen.staged)) ? screen.staged : []
  const unstaged = (screen && Array.isArray(screen.unstaged)) ? screen.unstaged : []
  const all = []
  staged.forEach(function (f) { if (f) all.push({ f: f, group: 'staged' }) })
  unstaged.forEach(function (f) { if (f) all.push({ f: f, group: 'unstaged' }) })
  const pathCount = {}
  all.forEach(function (x) { const p = String(x.f.path || ''); if (p) pathCount[p] = (pathCount[p] || 0) + 1 })
  const rows = []
  const conflictSeen = {}
  all.forEach(function (x) {
    const f = x.f
    const path = String(f.path || '')
    if (!path) return
    if (f.conflict === true) {
      if (conflictSeen[path]) return
      conflictSeen[path] = true
      rows.push({ path: path, origPath: f.origPath || null, group: 'conflict', conflict: true, change: 'modified', addedLines: f.addedLines, deletedLines: f.deletedLines, dual: true })
      return
    }
    rows.push({
      path: path, origPath: f.origPath || null, group: x.group, conflict: false, change: f.change,
      addedLines: f.addedLines, deletedLines: f.deletedLines,
      // 同一个文件在两条清单里都出现（x=M、y=M）：两条行各画一次，并在悬停里说清各自是哪一部分。
      dual: pathCount[path] > 1,
    })
  })
  const rank = function (r) { return r.conflict ? 1 : (r.group === 'staged' ? 0 : 2) }
  rows.sort(function (a, b) { return rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) })
  return rows
}
/** 一行的变化语义（冲突行按核心的口径就是「修改」，但界面上单挂一枚冲突标记，不算第七种类型）。 */
export const vcRowViewOf = function (row, t, diffBlock) {
  return {
    key: row.path,
    path: row.path,
    pathText: vcMiddle(row.path, 46),
    pathTip: row.path,
    origPath: row.origPath || '',
    changeKey: vcChangeKeyOf(row.change),
    // changeProven === false 的那一行（提交那一层判不出类型）就不画变化类型的字：宁可少说一句，不说错一句。
    changeText: row.changeProven === false ? '' : t(vcChangeKeyOf(row.change)),
    changeTone: row.conflict ? 'warning' : vcChangeToneOf(row.change),
    countsText: vcPlusMinus(row.addedLines, row.deletedLines),
    countsTip: (row.addedLines === null || row.addedLines === undefined)
      ? t('vc.row.binaryTip')
      : (row.dual === true ? t('vc.row.countsDual') : t('vc.row.diffTip')),
    conflict: row.conflict === true,
    conflictText: row.conflict ? t('vc.row.conflict') : '',
    // 这一行属于哪一组（staged / conflict / unstaged）：展开键要用它，门禁也按它判分组。
    group: row.group || '',
    untracked: row.change === 'untracked',
    // 悬停里第一行按最该先说的来：提交那一层判不出类型 → 说清来由；同一文件两段改动 → 说清这一行是哪一段；
    //   其余按冲突 / 未跟踪 / 点开看差异。拿不到的不装作没有，也不让用户以为 git 没给。
    rowTip: (row.typeTip ? String(row.typeTip) + '\n' : '')
      + (row.dual === true && row.conflict !== true ? (row.group === 'staged' ? t('vc.row.partStaged') : t('vc.row.partUnstaged')) + '\n' : '')
      + (row.conflict ? t('vc.row.conflictTip') : (row.change === 'untracked' ? t('vc.row.untrackedTip') : t('vc.row.diffTip'))),
    diff: diffBlock || null,
  }
}

/** 其他工作树一条：占用三档（被占用 / 明确没被占用 / 这个 git 版本答不出）+ 目录已不存在。 */
export const vcOtherRowOf = function (w, t) {
  // 占用原因来自 git 的原文，可能带换行：悬停里只留第一行、截断到 80 个字符（多行会把提示撑乱）。
  const reason = w && w.lockReason ? vcOneLine(w.lockReason, 80) : ''
  let stateText = ''
  let stateTone = ''
  let stateTip = ''
  // 可清理那一档也有一档「这个 git 版本答不出来」（降级档 2.11-2.30；字段由核心给，判据只读字段真值，
  //   界面不自己算档位）。答不出来照 lockUnknown 的同一套做法处理：可见文字说「无法显示」，
  //   悬停说清是 git 答不出、且答不出不等于还在 —— 绝不留白、也绝不说「目录还在」。
  if (w && w.prunable === true) { stateText = t('vc.other.prunable'); stateTone = 'warning'; stateTip = t('vc.other.prunableTip') }
  else if (w && w.prunableUnknown === true) { stateText = t('vc.other.lockUnknown'); stateTone = 'caption'; stateTip = t('vc.other.prunableUnknownTip') }
  else if (w && w.locked === true) { stateText = t('vc.other.locked'); stateTone = 'warning'; stateTip = t('vc.other.lockedTip') + (reason ? ' ' + reason : '') }
  else if (w && w.lockUnknown === true) { stateText = t('vc.other.lockUnknown'); stateTone = 'caption'; stateTip = t('vc.other.lockUnknownTip') }
  return {
    key: String((w && w.path) || ''),
    path: String((w && w.path) || ''),
    displayText: String((w && w.display) || ''),
    displayTip: String((w && w.path) || ''),
    branchText: w && w.bare === true ? t('vc.other.bare') : (w && w.branch ? String(w.branch) : t('vc.other.noBranch')),
    stateText: stateText,
    stateTone: stateTone,
    stateTip: stateTip,
  }
}
/**
 * 展开某一行的键（#850）：未提交那一层是「分组 + \u0000 + 路径」，提交那一层是「rev + \u0000 + 路径」。
 *
 * 为什么键里必须有分组：同一个路径可以同时出现在「已暂存」和「未暂存」两组里（同一个文件两段改动），
 *   两行要各自能展开；只拿路径当键，两行会一起开，也说不清「点开的到底是哪一行」。
 * 为什么放在这里：界面侧（VersionControlTab 的 diffKeyOf）与块模型侧（vcBlocksOf 的 diffKeyOf）
 *   都调这一个函数 —— 只有一处定义，两边就不会再对不上（#850 的根因就是各写各的）。
 * 提交那一层沿用 vcCommitKeyOf（rev + \u0000 + 路径），行为与 #850 之前一致。
 */
export const vcDiffOpenKeyOf = function (row, commitMode) {
  const r = row || {}
  const rev = String(commitMode || '')
  if (rev) return vcCommitKeyOf(rev, r.path)
  return String(r.group || '') + '\u0000' + String(r.path || '')
}

/** 一个字都不用改的日常读数（门禁与界面都读它，保证两边看的是一份东西）。 */
export const vcReadsOf = function (reads, path) {
  const r = reads || {}
  const diffs = r.diffs || {}
  return diffs[String(path || '')] || { state: 'idle' }
}
