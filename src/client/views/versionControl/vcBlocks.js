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
/** 差异最多就地画多少行；更多的先给「哪几段行区间变了」，再给头一段，并如实说只显示了前多少行。 */
export const VC_DIFF_LINES_SHOWN = 200
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
/** 差异那几种「没有内容」的原因 → 词条键（宿主 reason 字段的原样取值）。 */
export const VC_DIFF_REASON_KEY = {
  'untracked-no-diff': 'vc.diff.untracked',
  'no-commit-baseline': 'vc.diff.noBaseline',
  'no-diff': 'vc.diff.empty',
  'binary-diff': 'vc.diff.binary',
  'truncated': 'vc.diff.tooBig',
  // 合并提交：git show -p 默认不展开组合差异，所以这一处本来就没有内容 —— 这不是「读不到」，
  //   是 git 不展开合并提交（宿主用 reason:'merge-commit' 与「空提交」的 'no-diff' 分开说）。
  'merge-commit': 'vc.diff.mergeCommit',
}
/** 一个文件条目该怎么分组：冲突单独一组（排在已暂存之后、未暂存之前，照核心与规格的风险次序）。 */
export const vcGroupOfRow = function (row) {
  if (row.conflict) return 'conflict'
  if (row.staged) return 'staged'
  return 'unstaged'
}
/**
 * 未提交改动 → 一个文件一行的清单。解析层对同一路径给两条记录（x 与 y 各一条）不去重，这里合并：
 * 暂存与未暂存两个标记取或、冲突标记取或、变化类型优先取带冲突那条的、行数取先拿到的非空值。
 */
export const vcFileRowsOf = function (screen) {
  const all = []
  const staged = (screen && Array.isArray(screen.staged)) ? screen.staged : []
  const unstaged = (screen && Array.isArray(screen.unstaged)) ? screen.unstaged : []
  staged.forEach(function (f) { if (f) all.push(f) })
  unstaged.forEach(function (f) { if (f) all.push(f) })
  const byPath = {}
  const order = []
  all.forEach(function (f) {
    const path = String(f.path || '')
    if (!path) return
    let hit = byPath[path]
    if (!hit) {
      hit = { path: path, origPath: f.origPath || null, staged: false, unstaged: false, conflict: false, change: f.change, addedLines: f.addedLines, deletedLines: f.deletedLines }
      byPath[path] = hit
      order.push(path)
    }
    hit.staged = hit.staged || f.staged === true
    hit.unstaged = hit.unstaged || f.unstaged === true || f.change === 'untracked'
    if (f.conflict === true) hit.conflict = true
    if (f.conflict === true || !hit.change) hit.change = f.change
    if (hit.origPath === null && f.origPath) hit.origPath = f.origPath
    if ((hit.addedLines === null || hit.addedLines === undefined) && f.addedLines !== null && f.addedLines !== undefined) hit.addedLines = f.addedLines
    if ((hit.deletedLines === null || hit.deletedLines === undefined) && f.deletedLines !== null && f.deletedLines !== undefined) hit.deletedLines = f.deletedLines
  })
  const rows = order.map(function (p) { return byPath[p] })
  const rank = function (r) { return r.conflict ? 1 : (r.staged ? 0 : 2) }
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
    countsTip: (row.addedLines === null || row.addedLines === undefined) ? t('vc.row.binaryTip') : t('vc.row.diffTip'),
    conflict: row.conflict === true,
    conflictText: row.conflict ? t('vc.row.conflict') : '',
    untracked: row.change === 'untracked',
    // 提交那一层判不出变化类型时，悬停里第一行如实说「只回了路径与增删行数」——
    //   拿不到的不装作没有，也不让用户以为 git 没给。
    rowTip: (row.typeTip ? String(row.typeTip) + '\n' : '') + (row.conflict ? t('vc.row.conflictTip') : (row.change === 'untracked' ? t('vc.row.untrackedTip') : t('vc.row.diffTip'))),
    diff: diffBlock || null,
  }
}
/** 一处差异该画什么：行、要截断时先说「哪几段行区间变了」、以及一句「只显示了前 N 行」。 */
export const vcDiffViewOf = function (entry, t) {
  const e = entry || { state: 'idle' }
  if (e.state === 'idle' || (e.state === 'loading' && !e.lines)) return { state: 'loading', text: t('vc.diff.loading') }
  if (e.state === 'err' && !e.lines) return { state: 'err', text: t('vc.diff.fail'), retry: t('vc.retry') }
  const raw = Array.isArray(e.lines) ? e.lines : []
  const reason = String(e.reason || 'ok')
  if (reason !== 'ok') {
    const key = VC_DIFF_REASON_KEY[reason]
    return { state: 'note', text: key ? t(key) : t('vc.diff.empty'), stale: e.state === 'err', retry: e.state === 'err' ? t('vc.retry') : '' }
  }
  const hunkLines = []
  raw.forEach(function (l) { if (l && l.kind === 'hunk') hunkLines.push(String(l.text || '')) })
  const long = raw.length > VC_DIFF_LINES_SHOWN
  return {
    state: 'ok',
    lines: raw.slice(0, VC_DIFF_LINES_SHOWN),
    total: raw.length,
    hunks: long ? hunkLines : [],
    hunksTitle: t('vc.diff.hunksTitle'),
    shownNote: long ? t('vc.diff.shownHead', { n: String(VC_DIFF_LINES_SHOWN) }) : '',
    stale: e.state === 'err',
    retry: e.state === 'err' ? t('vc.retry') : '',
  }
}
/**
 * 身份行那一条「同步状态」（核心的五值枚举）：有推进目标且依据新 / 依据读不到 / 推进目标没了 /
 * 还没设推进目标 / 游离头指针。合并成一个布尔就会对用户说错话，所以这里一支一支分开写。
 */
export const vcSyncViewOf = function (identity, t, nowMs) {
  const sync = String((identity && identity.sync) || 'no-upstream')
  const basis = vcBasisText(t, nowMs, identity ? identity.basisMs : null)
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
  const reason = w && w.lockReason ? String(w.lockReason) : ''
  let stateText = ''
  let stateTone = ''
  let stateTip = ''
  if (w && w.prunable === true) { stateText = t('vc.other.prunable'); stateTone = 'warning'; stateTip = t('vc.other.prunableTip') }
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
  })
  const rows = vcFileRowsOf(screen)
  const groups = []
  // 空组不画（一组都没有时由下面那句「没有未提交的改动」兜底）：计数在汇总句里照样有，不必空占一行。
  const pushGroup = function (key, titleKey, list) {
    if (list.length === 0) return
    const n = shownOf(key)
    groups.push({ key: key, title: t(titleKey, { n: String(list.length) }), count: list.length, rows: list.slice(0, n), moreCount: Math.max(0, list.length - n), moreLabel: t('vc.more', { n: String(Math.max(0, list.length - n)) }) })
  }
  const stagedRows = rows.filter(function (r) { return vcGroupOfRow(r) === 'staged' })
  const conflictRows = rows.filter(function (r) { return vcGroupOfRow(r) === 'conflict' })
  const unstagedRows = rows.filter(function (r) { return vcGroupOfRow(r) === 'unstaged' })
  // 提交行点开之后走这一层（规格故事 32）：同一套文件行、同一套就地差异，只是来路是按需读的。
  const commitMode = (typeof vcCommitModeOf === 'function') ? vcCommitModeOf(ui) : ''
  const openDiff = ui && ui.openDiff ? String(ui.openDiff) : ''
  const diffKeyOf = function (r) { return commitMode ? vcCommitKeyOf(commitMode, r.path) : String(r.path || '') }
  const rowViewOf = function (r) {
    const key = diffKeyOf(r)
    const entry = commitMode ? ((reads && reads.commitDiffs) || {})[key] : vcReadsOf(reads, r.path)
    const diff = openDiff === key ? vcDiffViewOf(entry, t) : null
    return vcRowViewOf(r, t, diff)
  }
  if (commitMode) {
    const cb = vcCommitBlockOf(screen, reads, ui, t, nowMs, shownOf, rowViewOf)
    if (cb) blocks.push(cb)
  } else {
    pushGroup('staged', 'vc.group.staged', stagedRows.map(rowViewOf))
    if (conflictRows.length) pushGroup('conflict', 'vc.group.conflict', conflictRows.map(rowViewOf))
    pushGroup('unstaged', 'vc.group.unstaged', unstagedRows.map(rowViewOf))
    blocks.push({
      kind: 'changes', key: 'changes', title: t('vc.changes.title'),
      summary: conflicts > 0
        ? t('vc.changes.summaryConflicts', { staged: String(stagedRows.length), unstaged: String(unstagedRows.length), conflicts: String(conflicts) })
        : t('vc.changes.summary', { staged: String(stagedRows.length), unstaged: String(unstagedRows.length) }),
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
  blocks.push({
    kind: 'other', key: 'other',
    title: t('vc.other.title', { n: String(others.length) }),
    tip: t('vc.other.tip'),
    mode: fold.otherMode,
    rows: fold.otherMode === 'summary' ? [] : otherViews,
    summaryText: t('vc.other.summary', { n: String(others.length), list: otherViews.map(function (v) { return v.displayText }).join(t('vc.other.join')) }),
    empty: others.length === 0,
    emptyText: t('vc.other.empty'),
  })
  blocks.push({ kind: 'terminal', key: 'terminal', text: t('vc.terminal'), tip: t('vc.terminalTip') })
  return blocks
}
