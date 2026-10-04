// views/versionControl/vcBlocks.js — 状态模型 → 该画哪些块、每块写什么字（#818 的主缝）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。本文件不画界面、不打电话、不碰 DOM：喂进一份状态模型（以及
//   「差异 / 历史」两份按需读数与界面自己的展开状态），回一份块清单，每个块里写的都是**用户
//   会读到的那些字**（词条从入参 t 取）。判定规则与界面画法分开这条，就是靠这个分工落的。
//
// 件件都按规格写死的那几条边界：
//   · 首屏一整块来自同一次读取（身份 / 未提交改动 / 其他工作树 / 仓库级状态），成败一起 ——
//     reads.screen 是错误态且没有旧数据时，这里只回一个失败块，不做「每块各自降级」。
//   · 面板刚打开、还没拿到数据（idle，或 loading 且没有旧数据）时回空数组：整块不画，不冒一句常驻道歉。
//   · 有旧数据时继续画旧数据，只在最上面加一条「刷新失败了」的提示（refreshFailed）。
//   · 拿不到的东西绝不装作没有：依据时间读不到就说读不到；git 版本答不出占用就写「无法显示」；
//     行数拿不到就不写 0。
//   · 冲突是叠加在文件条目上的状态，不是第七种变化类型；同一条路径解析层给两条，这里合成一行。
//   · 一句话里不出现「错误」两个字：冲突与变基进行中是待处理的状态，不是故障（tone 也取警告档，不取报错档）。
/** 未提交改动默认每组先列几个（规格第 23 条：默认只列 10 个）。 */
export const VC_FILE_ROWS_FIRST = 10
/** 展开一次多列几个（规格第 25 条：展开要分批出现）。 */
export const VC_FILE_ROWS_BATCH = 10
/** 窄面板「其他工作树」摘要那一行最多列几个名字（其余明说还有几棵；悬停给列出来这几个的完整路径）。 */
export const VC_OTHER_SUMMARY_NAMES = 20
/** 六个块的名字与顺序（门禁按这个顺序断言；也说明「异常带在最上、终端出路在最下」）。 */
export const VC_BLOCK_ORDER = ['hint', 'band', 'identity', 'changes', 'commits', 'other', 'terminal']
/** 宿主失败信封里的种类 → 词条键。宿主那一句 message 是中文原话，直接画到英文界面上会串语言，
 *  所以主句一律按种类走词条，宿主原文只作悬停里的诊断线索（vc.fail.raw）。 */
export const VC_FAIL_KEY = {
  'env': 'vc.fail.noGit',
  'not-repo': 'vc.fail.notRepo',
  'timeout': 'vc.fail.timeout',
  'spawn': 'vc.fail.spawn',
  'exit': 'vc.fail.exit',
  'truncated': 'vc.fail.truncated',
  'unsupported': 'vc.fail.oldGit',
  'parse': 'vc.fail.parse',
  'args': 'vc.fail.args',
  'shape': 'vc.fail.shape',
  'throw': 'vc.fail.throw',
}
export const vcFailKeyOf = function (kind) { return VC_FAIL_KEY[String(kind)] || 'vc.fail.unknown' }
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
/**
 * 身份行那一条「同步状态」（核心的五值枚举）：有推进目标且依据读得到 / 依据读不到 / 推进目标没了 /
 * 还没设推进目标 / 游离头指针。合并成一个布尔就会对用户说错话，所以这里一支一支分开写。
 * #819 收口：前两个标识符改成了 tracked-known / tracked-unknown（名字不再暗示「新 / 旧」；界面话术没动）。
 */
export const VC_SYNC_VALUES = ['tracked-known', 'tracked-unknown', 'upstream-gone', 'no-upstream', 'detached']
export const vcSyncViewOf = function (identity, t, nowMs) {
  const sync = String((identity && identity.sync) || 'no-upstream')
  const basis = vcBasisText(t, nowMs, identity ? identity.basisMs : null)
  // 五值枚举以外的取值一律如实说「读到的这一档不认识」，绝不落到「领先 0 / 落后 0」——
  //   那等于替一个形状坏掉的模型说「一切正常，没多没少」。
  if (VC_SYNC_VALUES.indexOf(sync) < 0) {
    return { text: t('vc.sync.unknown'), tip: t('vc.sync.unknownTip', { kind: sync }), basis: '', basisTip: '' }
  }
  if (sync === 'detached') return { text: t('vc.sync.detached'), tip: t('vc.detachedTip'), basis: '', basisTip: '' }
  if (sync === 'no-upstream') return { text: t('vc.sync.noUpstream'), tip: t('vc.sync.noUpstreamTip'), basis: '', basisTip: '' }
  if (sync === 'upstream-gone') return { text: t('vc.sync.upstreamGone'), tip: t('vc.sync.upstreamGoneTip'), basis: '', basisTip: '' }
  return {
    text: t('vc.sync.aheadBehind', { ahead: String((identity && identity.ahead) || 0), behind: String((identity && identity.behind) || 0) }),
    tip: t('vc.basis.tip'),
    basis: basis,
    basisTip: t('vc.basis.tip'),
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
/** 一个字都不用改的日常读数（门禁与界面都读它，保证两边看的是一份东西）。 */
export const vcReadsOf = function (reads, path) {
  const r = reads || {}
  const diffs = r.diffs || {}
  return diffs[String(path || '')] || { state: 'idle' }
}
/**
 * 块清单的唯一入口。
 *   screen：首屏读数（reads.screen.data.screen），没有就传 null
 *   reads ：{ screen:{state,data,error}, diffs:{路径:...}, log:{state,commits,hasMore,error} }
 *   ui    ：界面自己的展开状态 { fileShown:{staged,conflict,unstaged}, openDiff:路径或null }
 *   env   ：{ t, nowMs, fold }（fold 是 vcFoldOf 的结果；分量宽度那一半由组件量）
 */
export const vcBlocksOf = function (screen, reads, ui, env) {
  const t = env.t
  const nowMs = env.nowMs
  const fold = env.fold || { band: 0, otherMode: 'list', commitsCollapsed: false, state: { path: '', others: [], commits: [] } }
  // 这个会话还没有工作区：一句如实的空态，一个电话都不发（宿主对空 cwd 会退回它自己的默认目录，
  //   那样画出来的是插件自己那个仓库的数据 —— 比不显示更糟）。
  if (env.cwdEmpty === true) return [{ kind: 'error', key: 'no-cwd', tone: 'caption', text: t('vc.noCwd'), rawTip: '', retry: '' }]
  const state = (reads && reads.screen && reads.screen.state) || 'idle'
  const err = reads && reads.screen ? reads.screen.error : null
  if (!screen) {
    if (state === 'err' && err) {
      const kind = String(err.kind || '')
      return [{
        kind: 'error', key: 'screen', tone: kind === 'not-repo' ? 'caption' : 'error',
        text: t(vcFailKeyOf(kind)),
        // 宿主失败信封里那句 message 是宿主侧拼的中文原话，直接画出来会让英文界面看到中文；
        //   所以可见文字只用按种类映射出来的词条句，原话挪进悬停提示里当诊断线索（一个字都不丢）。
        rawTip: err.message ? t('vc.fail.raw', { msg: String(err.message) }) : '',
        // 「这个目录不在任何 git 仓库里」不是读取失败，是这个目录本来就不是仓库：不给重试按钮。
        retry: kind === 'not-repo' ? '' : t('vc.retry'),
      }]
    }
    return []
  }
  const t0 = (ui && ui.fileShown) || {}
  const shownOf = function (g) { const n = Math.floor(Number(t0[g])); return isFinite(n) && n > 0 ? n : VC_FILE_ROWS_FIRST }
  const blocks = []
  if (state === 'err' && err) blocks.push({ kind: 'hint', key: 'stale', tone: 'warning', text: t('vc.staleHint'), retry: t('vc.retry') })
  const repo = screen.repo || {}
  const identity = screen.identity || {}
  const bandItems = []
  if (repo.merging === true) bandItems.push({ key: 'merge', tone: 'warning', text: t('vc.band.merge'), tip: t('vc.band.terminalTip') })
  if (repo.rebasing === true) bandItems.push({ key: 'rebase', tone: 'warning', text: t('vc.band.rebase'), tip: t('vc.band.terminalTip') })
  if (repo.cherryPicking === true) bandItems.push({ key: 'cherry', tone: 'warning', text: t('vc.band.cherryPick'), tip: t('vc.band.terminalTip') })
  if (repo.reverting === true) bandItems.push({ key: 'revert', tone: 'warning', text: t('vc.band.revert'), tip: t('vc.band.terminalTip') })
  const conflicts = Math.max(0, Number(screen.conflictCount) || 0)
  // 冲突这句是按仓库级标记说的（正在合并 → 你这边与要合进来那边；正在变基 → 已在分支上那些与正在重放的那一笔）。
  //   每条冲突各自的「两侧来源」模型里没有（宿主回包只给 conflictCount 与条目的 conflict 标记），
  //   要按文件说清谁对谁，得靠宿主回包把来源带上 —— 那是另一张票的事，这里不猜。
  if (conflicts > 0) bandItems.push({
    key: 'conflicts', tone: 'warning',
    text: t('vc.conflicts.count', { n: String(conflicts) }),
    tip: (repo.merging === true ? t('vc.conflicts.merge') : (repo.rebasing === true ? t('vc.conflicts.rebase') : t('vc.conflicts.other'))) + ' ' + t('vc.band.terminalTip'),
  })
  if (repo.hasCommits === false && repo.bare !== true) bandItems.push({ key: 'noc', tone: 'caption', text: t('vc.noCommits'), tip: t('vc.noCommitsTip') })
  if (bandItems.length) blocks.push({ kind: 'band', key: 'band', items: bandItems })
  blocks.push({
    kind: 'identity', key: 'identity',
    // 裸仓库没有工作树，核心给的显示名是空串：照实写「裸仓库（没有工作树）」，别让身份行开头空着。
    name: String(identity.worktreeDisplay || '') || (repo.bare === true ? t('vc.other.bare') : ''),
    nameTip: t('vc.identity.worktreeTip', { path: String(identity.worktreePath || '') }),
    detached: identity.detached === true,
    branchText: identity.detached === true ? t('vc.detached') : String(identity.branch || t('vc.other.noBranch')),
    branchTone: identity.detached === true ? 'caption' : 'accent',
    oidText: identity.detached === true ? t('vc.detachedAt', { oid: vcShortOid(identity.oid) }) : '',
    oidTip: String(identity.oid || ''),
    pathText: fold.state.path || '',
    pathTip: String(identity.worktreePath || ''),
    sync: vcSyncViewOf(identity, t, nowMs),
    // 这份首屏读数是什么时候取的（#819 发现 3）：存着不画，用户就不知道手上这几个数有多旧。
    readAtText: (reads && reads.screen && reads.screen.data && reads.screen.data.readAtMs)
      ? t('vc.readAt', { when: vcWhenText(t, nowMs, reads.screen.data.readAtMs) })
      : '',
  })
  const rows = vcFileRowsOf(screen)
  const groups = []
  // 空组不画（一组都没有时由下面那句「没有未提交的改动」兜底）：计数在汇总句里照样有，不必空占一行。
  const pushGroup = function (key, titleKey, list, tipKey) {
    if (list.length === 0) return
    const n = shownOf(key)
    groups.push({ key: key, title: t(titleKey, { n: String(list.length) }), tip: tipKey ? t(tipKey) : '', count: list.length, rows: list.slice(0, n), moreCount: Math.max(0, list.length - n), moreLabel: t('vc.more', { n: String(Math.max(0, list.length - n)) }) })
  }
  const stagedRows = rows.filter(function (r) { return vcGroupOfRow(r) === 'staged' })
  const conflictRows = rows.filter(function (r) { return vcGroupOfRow(r) === 'conflict' })
  const unstagedRows = rows.filter(function (r) { return vcGroupOfRow(r) === 'unstaged' })
  // 提交行点开之后走这一层（规格故事 32）：同一套文件行、同一套就地差异，只是来路是按需读的。
  const commitMode = (typeof vcCommitModeOf === 'function') ? vcCommitModeOf(ui) : ''
  const openDiff = ui && ui.openDiff ? String(ui.openDiff) : ''
  // 展开键：未提交那一层把「哪一组」也算进去 —— 同一个文件在已暂存与未暂存各有一行时，
  //   点开其中一行只展开那一行，不会两行一起开。差异数据本身仍按路径存一份（同一份补丁）。
  const diffKeyOf = function (r) { return commitMode ? vcCommitKeyOf(commitMode, r.path) : (String(r.group || '') + '\u0000' + String(r.path || '')) }
  const rowViewOf = function (r) {
    const key = diffKeyOf(r)
    const entry = commitMode ? ((reads && reads.commitDiffs) || {})[key] : vcReadsOf(reads, r.path)
    const diff = openDiff === key ? vcDiffViewOf(entry, t, commitMode ? '' : 'vc.diff.scopeHead') : null
    return vcRowViewOf(r, t, diff)
  }
  if (commitMode) {
    const cb = vcCommitBlockOf(screen, reads, ui, t, nowMs, shownOf, rowViewOf)
    if (cb) blocks.push(cb)
  } else {
    pushGroup('staged', 'vc.group.staged', stagedRows.map(rowViewOf))
    if (conflictRows.length) pushGroup('conflict', 'vc.group.conflict', conflictRows.map(rowViewOf), 'vc.group.conflictTip')
    pushGroup('unstaged', 'vc.group.unstaged', unstagedRows.map(rowViewOf))
    // 汇总句用宿主给的 stagedCount / unstagedCount：那两个数就是 git 自己的说法，
    //   界面拿合并后的行去数会把「同一个文件两段改动」的那一段漏掉（真机缺陷 #819 发现 4）。
    const hostStaged = Number(screen.stagedCount) || 0
    const hostUnstaged = Number(screen.unstagedCount) || 0
    blocks.push({
      kind: 'changes', key: 'changes', title: t('vc.changes.title'),
      summary: conflicts > 0
        ? t('vc.changes.summaryConflicts', { staged: String(hostStaged), unstaged: String(hostUnstaged), conflicts: String(conflicts) })
        : t('vc.changes.summary', { staged: String(hostStaged), unstaged: String(hostUnstaged) }),
      groups: groups,
      empty: rows.length === 0,
      // 只有真空的时候才带上那句话：块模型里不该留一句不会被画出来的字（门禁按模型判「有没有冒这句话」）。
      emptyText: rows.length === 0 ? t('vc.changes.none') : '',
    })
  }
  const logRead = (reads && reads.log) || {}
  const commitList = vcCommitListOf(screen, reads)
  const commitRows = commitList.map(function (c, i) {
    const subject = fold.state.commits[i] !== undefined ? fold.state.commits[i] : String(c.subject || '')
    return {
      key: String(c.oid || c.short || i),
      short: String(c.short || vcShortOid(c.oid)),
      subject: subject,
      subjectTip: String(c.subject || ''),
      author: String(c.author || ''),
      when: vcWhenText(t, nowMs, c.authorDateMs !== undefined && c.authorDateMs !== null ? c.authorDateMs : c.commitDateMs),
      // 悬停里第一行永远是完整的提交说明（说明被阶梯折短之后，完整内容在这儿一个字不丢），
      //   第二行才是作者、时间与完整编号。
      tip: String(c.subject || '') + '\n' + t('vc.commit.tip') + '\n' + t('vc.commits.tip', { author: String(c.author || ''), when: vcWhenText(t, nowMs, c.commitDateMs !== undefined && c.commitDateMs !== null ? c.commitDateMs : c.authorDateMs), oid: String(c.oid || '') }),
      open: commitMode !== '' && (String(c.oid || '') === commitMode || String(c.short || '') === commitMode),
      parents: Array.isArray(c.parents) ? c.parents.length : 0,
    }
  })
  blocks.push({
    kind: 'commits', key: 'commits', title: t('vc.commits.title'),
    collapsed: fold.commitsCollapsed === true,
    collapseText: t('vc.commits.expand', { n: String(commitRows.length) }),
    rows: fold.commitsCollapsed === true ? [] : commitRows,
    empty: commitRows.length === 0,
    emptyText: commitRows.length === 0 ? t('vc.noCommits') : '',
    more: {
      show: commitRows.length > 0 && fold.commitsCollapsed !== true,
      label: logRead.state === 'loading' ? t('vc.commits.loading') : t('vc.commits.more'),
      allLoaded: logRead.hasMore === false && logRead.commits && logRead.commits.length > 0 ? t('vc.commits.allLoaded') : '',
      failText: logRead.state === 'err' ? t('vc.commits.fail') : '',
      retry: logRead.state === 'err' ? t('vc.retry') : '',
    },
  })
  const others = (Array.isArray(screen.otherWorktrees) ? screen.otherWorktrees : [])
  const otherViews = others.map(function (w, i) {
    const v = vcOtherRowOf(w, t)
    v.displayText = fold.state.others[i] !== undefined ? fold.state.others[i] : v.displayText
    return v
  })
  // 其他工作树也按同一套规矩限量（默认 10 条 + 分批展开）：一千个工作树时不该一次画一千行。
  const otherShown = shownOf('other')
  const otherRows = fold.otherMode === 'summary' ? [] : otherViews.slice(0, otherShown)
  const otherMore = fold.otherMode === 'summary' ? 0 : Math.max(0, otherViews.length - otherShown)
  // 摘要档那一行：名字折短过，悬停必须给完整路径（规格第 5 条）；最多列 N 个，其余明说还有几棵。
  const summaryViews = fold.otherMode === 'summary' ? otherViews.slice(0, VC_OTHER_SUMMARY_NAMES) : []
  const summaryHidden = fold.otherMode === 'summary' ? Math.max(0, otherViews.length - summaryViews.length) : 0
  const summaryTip = summaryViews.map(function (v) { return v.path }).join('\n')
  blocks.push({
    kind: 'other', key: 'other',
    title: t('vc.other.title', { n: String(others.length) }),
    // 摘要档把完整路径并进这条悬停（标题与摘要那一行都挂它）；列表档每行自己带悬停，这条保持通用说明。
    tip: t('vc.other.tip') + (summaryTip ? '\n' + summaryTip : ''),
    mode: fold.otherMode,
    rows: otherRows,
    moreCount: otherMore,
    moreLabel: t('vc.other.more', { n: String(otherMore) }),
    summaryText: fold.otherMode === 'summary'
      ? t('vc.other.summary', { n: String(others.length), list: summaryViews.map(function (v) { return v.displayText }).join(t('vc.other.join')) }) + (summaryHidden > 0 ? ' ' + t('vc.other.summaryMore', { n: String(summaryHidden) }) : '')
      : '',
    empty: others.length === 0,
    emptyText: t('vc.other.empty'),
  })
  blocks.push({ kind: 'terminal', key: 'terminal', text: t('vc.terminal'), tip: t('vc.terminalTip') })
  return blocks
}
