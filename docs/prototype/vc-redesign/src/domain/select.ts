/**
 * domain/select.ts —— 把状态机状态翻成「界面只负责画」的视图模型。
 *
 * 为什么要这一层：真实页面在渲染函数里就地算计数、就地拼文案、就地判断按钮可点性，
 * 结果是同一件事（比如「推送能不能点」）在按钮、提示与 aria 里各写一遍，容易互相矛盾。
 * 这里每个结论只算一次，界面对着模型画；原型评审时也能指着模型字段说清楚
 * 「这个结论是从哪条真实规则来的」。
 *
 * 可点性全部请求 src/shared/version-control/src/rules.ts 的 judge()，
 * 原型不复制规则；只有两条界面补充规则由这里承担：
 *   ① 推送：超前为 0 时按钮禁用（真实 rules.ts 允许推送，因为「点下去什么都不会发生」）；
 *   ② 提交：说明为空时禁用（真实写路径的校验在宿主，界面提前告知）。
 */
import { judge } from '../data/core'
import type { CommitInfo, FileChange, FileEntry, FirstScreen, Operation, PatchLine, WorktreeInfo } from '../data/core'
import { COPY } from '../data/copy'
import { changeBadge, lineDelta, shortOid, splitPath, syncModel } from '../data/format'
import type { ChangeTone, SyncModel } from '../data/format'
import { samplePatch } from '../data/patches'
import type { BranchPending, BranchRow, BranchSub, ChangesFilter, ChangesPendingKind, LocalCommit, OpName, SessionState, Tone, ViewId, WorktreePending } from './session'
import { metadataOf } from './session'
import type { SessionBase } from './session'

export type BadgeTone = ChangeTone | 'warn' | 'error' | 'ok' | 'info' | 'muted'

/** 页签：每个页签的数字都带单位，三个页签的计数口径不再混在一起。 */
export interface TabModel {
  id: ViewId
  label: string
  count: number
  unit: string
  /** 这个页签装的是什么，用平实的一句话写。只给需要解释的页签填，悬停时接在「收起的改动：0 条」后面。 */
  explain?: string
}

export interface SyncChipModel {
  kind: 'ahead' | 'behind'
  label: string
  value: number
  muted: boolean
}

export interface ActionModel {
  id: OpName
  label: string
  disabled: boolean
  reason: string | null
  warn: boolean
  primary: boolean
  busy: boolean
}

export interface RailModel {
  worktreeDisplay: string
  worktreePath: string
  branch: string | null
  detached: boolean
  oidShort: string | null
  sync: SyncModel
  syncChips: SyncChipModel[]
  readAtText: string
  /** 跟踪的远端名（例如 origin）；没有上游时为 null，标签退回「远端依据」。 */
  remoteName: string | null
  basisText: string
  next: string
  nextTone: Tone
  pull: ActionModel
  fetch: ActionModel
  push: ActionModel
  busy: OpName | null
  busyLabel: string | null
  reloading: boolean
  copiedPath: string | null
}

export interface FileRowModel {
  path: string
  dir: string
  name: string
  fullPath: string
  badge: { letter: string; tone: BadgeTone }
  changeLabel: string | null
  extraBadges: string[]
  delta: { added: string | null; deleted: string | null } | null
  conflict: boolean
  staged: boolean
  expanded: boolean
  patch: PatchLine[] | null
  patchNote: string | null
  canStage: boolean
  canUnstage: boolean
  /** 未跟踪文件：决定行上写不写「未跟踪」，也决定「加入 .gitignore」「删除这个文件」出不出来。 */
  untracked: boolean
  /** 行尾「更多」按钮：未加入与冲突行有，已加入行只保留移出。 */
  showMenu: boolean
  canDiscard: boolean
  canIgnore: boolean
  canDeleteUntracked: boolean
  /** 冲突行：可以按当前分支或对方的版本就地解决。 */
  resolvable: boolean
}

export interface GroupModel {
  id: ChangesFilter
  label: string
  emptyText: string
  rows: FileRowModel[]
}

export interface ComposerModel {
  stagedCount: number
  message: string
  placeholder: string
  hint: string
  disabled: boolean
  disabledReason: string | null
  busy: boolean
}

/** 危险动作的确认卡：标题、后果、涉及范围与按钮文案都在这里一次算好，视图不再自己拼。 */
export interface ChangesPendingModel {
  kind: ChangesPendingKind
  path: string | null
  title: string
  body: string
  meta: string | null
  confirmLabel: string
  danger: boolean
}

export interface ChangesModel {
  stats: Array<{ id: ChangesFilter; label: string; count: number; tone: BadgeTone }>
  filter: ChangesFilter
  groups: GroupModel[]
  composer: ComposerModel
  empty: boolean
  stagedCount: number
  unstagedCount: number
  conflictCount: number
  busy: boolean
  canStageAll: boolean
  canUnstageAll: boolean
  canDiscardAll: boolean
  /** 收起入口：工作区有改动、且没有冲突文件时才可用。 */
  canStash: boolean
  stashReason: string | null
  /** 哪一行的「更多」菜单开着：菜单紧贴这一行画。 */
  openMenuPath: string | null
  pending: ChangesPendingModel | null
  /** 加入 .gitignore 之后的一行说明：文件还在磁盘上，只是 git 不再跟踪。 */
  ignoredNote: string | null
}

export interface CommitRowModel {
  oid: string
  short: string
  subject: string
  author: string
  when: string
  merge: boolean
  filesCount: number
  group: string | null
  selected: boolean
}

export interface HistoryFileRowModel {
  path: string
  dir: string
  name: string
  delta: { added: string | null; deleted: string | null }
  expanded: boolean
  patch: PatchLine[] | null
  binary: boolean
}

export interface CommitDetailModel {
  oid: string
  short: string
  subject: string
  author: string
  when: string
  parents: string[]
  files: HistoryFileRowModel[]
  filesNote: string | null
  loading: boolean
}

export interface HistoryModel {
  detail: CommitDetailModel | null
  rows: CommitRowModel[]
  loaded: number
  total: number
  query: string
  mergeOnly: boolean
  empty: boolean
  scopeText: string
  mergeOnlyText: string
}

export interface WorktreeRowModel {
  path: string
  dir: string
  name: string
  branch: string | null
  detached: boolean
  oidShort: string
  states: Array<{ label: string; tone: BadgeTone; detail: string | null }>
  abnormal: boolean
  copied: boolean
  /** 三个动作按钮各自是否应该出现；由行状态决定，不在视图里再判一遍。 */
  locked: boolean
  prunable: boolean
}

export interface WorktreesModel {
  current: WorktreeRowModel | null
  others: WorktreeRowModel[]
  othersCount: number
  /** 需要人工确认的工作树数量：筛选标签与摘要行都用它，不在视图层重新数一遍。 */
  abnormalCount: number
  empty: boolean
  /** 面板边界说明：一句话说清「这里有什么、面板能做什么」，由视图放进可关闭的提示条里。 */
  notice: string
  aiLabel: string
  aiEnabled: boolean
  pending: WorktreePending | null
}

/** 一条分支在列表里的样子：名字与当前标记之外只留判断要用的数字。 */
export interface BranchRowModel {
  name: string
  current: boolean
  upstream: string | null
  ahead: number
  behind: number
  oidShort: string
  when: string
  subject: string
  merged: boolean
}

/** 分支详情：一条分支能做什么、为什么不能做，全部在这里算好。 */
export interface BranchDetailModel {
  row: BranchRowModel
  canSwitch: boolean
  canMerge: boolean
  canDelete: boolean
  /** 变基会把当前分支的提交挪到目标分支后面：只允许对「别的分支」发起，不可能变基到自己。 */
  canRebase: boolean
  switchReason: string | null
  mergeReason: string | null
  deleteReason: string | null
  rebaseReason: string | null
  pending: BranchPending | null
}

/** 一条收起记录的展示形态：时间已翻成人话，文件路径原样给出，便于确认「这是不是我那条」。 */
export interface StashRowModel {
  id: string
  message: string
  when: string
  paths: string[]
  filesCount: number
}

/** 收起改动视图：没有需要二次确认的动作，只有丢弃记录要问一句。 */
export interface StashModel {
  rows: StashRowModel[]
  total: number
  empty: boolean
  /** 正在等用户确认丢弃的那一条：确认卡出现在它的行下面。 */
  pending: { id: string; title: string; body: string } | null
  busy: boolean
}

export interface BranchesModel {
  rows: BranchRowModel[]
  total: number
  currentName: string | null
  selected: BranchDetailModel | null
  sub: BranchSub
  draft: string
  query: string
  pending: BranchPending | null
  empty: boolean
  dirty: boolean
}

export interface PanelModel {
  rail: RailModel
  tabs: TabModel[]
  changes: ChangesModel
  history: HistoryModel
  worktrees: WorktreesModel
  branches: BranchesModel
  stash: StashModel
  result: SessionState['result']
  confirm: {
    title: string
    lead: string
    points: ReadonlyArray<{ tone: 'ok' | 'warn'; label: string; text: string }>
    files: string[]
    continueLabel: string
    cancelLabel: string
  } | null
  busy: OpName | null
  nowMs: number
}

/** 首屏读数按状态机里「已加入这次提交」的清单改写：judge() 只认 FirstScreen 的计数与身份字段。 */
function judgeScreen(base: SessionBase, state: SessionState): FirstScreen {
  const screen = base.screen
  return {
    ...screen,
    stagedCount: state.staged.length,
    unstagedCount: state.unstaged.length,
    conflictCount: state.conflicts.length,
    identity: {
      ...screen.identity,
      ahead: state.ahead,
      behind: state.behind,
      basisMs: state.basisMs,
    },
  }
}

function verdictOf(screen: FirstScreen, op: Operation): { disabled: boolean; warn: boolean; reason: string | null } {
  const decision = judge(screen, op)
  if (decision.verdict === 'block') {
    return { disabled: true, warn: false, reason: COPY.block[decision.reasons[0]] ?? COPY.block['unknown-operation'] }
  }
  if (decision.verdict === 'warn') {
    return { disabled: false, warn: true, reason: COPY.warn[decision.reasons[0]] ?? null }
  }
  return { disabled: false, warn: false, reason: null }
}

function actionOf(
  screen: FirstScreen,
  op: OpName,
  label: string,
  state: SessionState,
  override: { disabled?: boolean; reason?: string | null; primary?: boolean; busyLabel?: string | null } = {},
): ActionModel {
  const verdict = verdictOf(screen, op)
  const disabled = override.disabled === true || verdict.disabled || state.busy !== null || state.reloading
  const busy = state.busy === op || (op === 'fetch' && state.reloading)
  return {
    id: op,
    label,
    disabled,
    reason: override.reason ?? verdict.reason,
    warn: verdict.warn,
    primary: override.primary === true && !disabled,
    busy,
  }
}

/** 页签计数：改动按文件数、提交按条数、工作树按棵数、收起的改动按条数，单位随数字一起画。 */
export function tabsOf(base: SessionBase, state: SessionState): TabModel[] {
  const changes = state.staged.length + state.unstaged.length + state.conflicts.length
  return [
    { id: 'changes', label: COPY.views.changes, count: changes, unit: COPY.units.change },
    { id: 'commits', label: COPY.views.commits, count: base.totalCommits, unit: COPY.units.commit },
    { id: 'worktrees', label: COPY.views.worktrees, count: base.screen.otherWorktrees.filter((item) => !item.current).length + (state.demoWorktrees ? DEMO_WORKTREE_COUNT : 0), unit: COPY.units.worktree },
    { id: 'stash', label: COPY.views.stash, count: state.stashes.length, unit: COPY.units.stash, explain: '把暂时不想提交的改动打包收起来，之后能放回工作区' },
  ]
}

function nextStepOf(state: SessionState): { text: string; tone: Tone } {
  if (state.conflicts.length > 0) return { text: '先解决冲突文件，再提交', tone: 'error' }
  if (state.behind > 0) return { text: '先拉取远端的新提交', tone: 'warn' }
  if (state.staged.length > 0 && state.message.trim() === '') return { text: '写一句提交说明，再提交', tone: 'info' }
  if (state.staged.length > 0) return { text: '提交已加入这次提交的文件', tone: 'ok' }
  if (state.unstaged.length > 0) return { text: '先加入要提交的文件', tone: 'muted' }
  if (state.ahead > 0) return { text: '推送本地提交到远端', tone: 'ok' }
  return { text: '工作区与远端都已同步', tone: 'muted' }
}

export function railOf(base: SessionBase, state: SessionState, nowMs: number): RailModel {
  const identity = base.screen.identity
  // 分支名以状态机为准：切换分支之后，顶部身份行要立刻显示新分支，而不是首屏读数里的旧名字。
  const currentBranch = state.branches.find((row) => row.current)
  const screen = judgeScreen(base, state)
  const sync = syncModel(identity.sync, state.ahead, state.behind)
  const syncChips: SyncChipModel[] = []
  if (sync.kind === 'counts') {
    syncChips.push({ kind: 'ahead', label: COPY.rail.syncAhead, value: sync.ahead, muted: sync.ahead === 0 })
    syncChips.push({ kind: 'behind', label: COPY.rail.syncBehind, value: sync.behind, muted: sync.behind === 0 })
  }

  const next = nextStepOf(state)
  const pullVerdict = verdictOf(screen, 'pull')
  const pushAheadMissing = state.ahead === 0

  const pull = actionOf(screen, 'pull', COPY.actions.pull, state, {
    primary: state.behind > 0,
    busyLabel: COPY.busy.pull,
  })
  const fetch = actionOf(screen, 'fetch', COPY.actions.fetch, state, { busyLabel: COPY.busy.fetch })
  const push = actionOf(screen, 'push', COPY.actions.push, state, {
    disabled: pushAheadMissing,
    reason: pushAheadMissing ? COPY.block['nothing-to-push'] : null,
    primary: !pushAheadMissing && state.behind === 0,
    busyLabel: COPY.busy.push,
  })

  return {
    worktreeDisplay: identity.worktreeDisplay,
    worktreePath: identity.worktreePath,
    branch: currentBranch === undefined ? identity.branch : currentBranch.name,
    detached: identity.detached,
    oidShort: identity.oid === null ? null : shortOid(identity.oid),
    sync,
    syncChips,
    readAtText: timeText(nowMs, state.readAtMs),
    // 上游写的是 <远端>/<分支>；只取第一段做标签，读者看到的是「远端 origin 12 分钟前」。
    remoteName: currentBranch === undefined || currentBranch.upstream === null ? null : currentBranch.upstream.split('/')[0],
    basisText: state.basisMs === null ? COPY.rail.basisUnknown : timeText(nowMs, state.basisMs),
    next: next.text,
    nextTone: next.tone,
    pull: { ...pull, disabled: pullVerdict.disabled || pull.disabled },
    fetch,
    push,
    busy: state.busy,
    busyLabel: state.busy === null ? null : COPY.busy[state.busy],
    reloading: state.reloading,
    copiedPath: state.copiedPath,
  }
}

function timeText(nowMs: number, ms: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - ms) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const date = new Date(ms)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

function fileRowOf(
  base: SessionBase,
  state: SessionState,
  path: string,
  options: { staged: boolean; conflict: boolean },
): FileRowModel {
  const meta = metadataOf(base, path)
  const change: FileChange = meta?.change ?? 'modified'
  const badge = changeBadge(change)
  const { dir, name } = splitPath(path)
  const isUntracked = change === 'untracked'
  const expanded = state.openFile === path
  const patch = expanded && !isUntracked && !options.conflict ? samplePatch(path) : null
  let patchNote: string | null = null
  if (expanded) {
    if (options.conflict) patchNote = '冲突文件在合并完成前没有单一基线，原型不展示差异。'
    else if (isUntracked) patchNote = '未跟踪文件还没有基线版本，原型不展示差异。'
    else if (patch === null) patchNote = '这个扩展名没有可展示的示例补丁。'
  }
  const extraBadges: string[] = []
  if (options.conflict) extraBadges.push('冲突')
  else if (options.staged) extraBadges.push(COPY.changes.stagedBadge)
  if (isUntracked) extraBadges.push(COPY.changes.untracked)
  const busy = state.busy !== null || state.reloading
  return {
    path,
    dir,
    name,
    fullPath: path,
    badge,
    changeLabel: null,
    extraBadges,
    delta: isUntracked ? null : lineDelta(meta?.addedLines ?? null, meta?.deletedLines ?? null),
    conflict: options.conflict,
    staged: options.staged,
    expanded,
    patch,
    patchNote,
    canStage: !busy && !options.conflict && !options.staged,
    canUnstage: !busy && !options.conflict && options.staged,
    untracked: isUntracked,
    showMenu: !busy && !options.staged,
    canDiscard: !busy && !options.conflict && !options.staged && !isUntracked,
    canIgnore: !busy && !options.conflict && !options.staged && isUntracked,
    canDeleteUntracked: !busy && !options.conflict && !options.staged && isUntracked,
    resolvable: !busy && options.conflict,
  }
}

/**
 * 把「正在等确认的改动动作」翻成一张确认卡。
 * 三件事必须一次说清，否则危险动作就只能靠用户猜：会动什么、丢什么、能不能撤回。
 * 文案按动作类型分开写；范围（涉及几个文件、丢多少行）用面板已有的读数算，不另读磁盘。
 */
function pendingOf(base: SessionBase, state: SessionState): ChangesPendingModel | null {
  const pending = state.changesPending
  if (pending === null) return null
  if (state.busy !== null || state.reloading) return null
  if (pending.kind === 'discard-all') {
    return {
      kind: pending.kind,
      path: null,
      title: COPY.changes.confirmDiscardAllTitle(state.unstaged.length),
      body: COPY.changes.confirmDiscardAllBody,
      meta: COPY.changes.confirmDiscardAllMeta(state.unstaged.length),
      confirmLabel: COPY.changes.confirmDiscard,
      danger: true,
    }
  }
  const path = pending.path
  if (path === null) return null
  const meta = metadataOf(base, path)
  const name = splitPath(path).name
  const lines: string[] = []
  if (meta !== undefined) {
    if (meta.addedLines !== null && meta.addedLines > 0) lines.push(`新增 ${meta.addedLines} 行`)
    if (meta.deletedLines !== null && meta.deletedLines > 0) lines.push(`删除 ${meta.deletedLines} 行`)
  }
  const metaText = lines.length === 0 ? null : `这次会丢掉 ${lines.join('，')}`
  switch (pending.kind) {
    case 'discard':
      return { kind: pending.kind, path, title: COPY.changes.confirmDiscardTitle(name), body: COPY.changes.confirmDiscardBody, meta: metaText, confirmLabel: COPY.changes.confirmDiscard, danger: true }
    case 'ignore':
      return { kind: pending.kind, path, title: COPY.changes.confirmIgnoreTitle(name), body: COPY.changes.confirmIgnoreBody, meta: null, confirmLabel: COPY.changes.confirmIgnore, danger: false }
    case 'delete-untracked':
      return { kind: pending.kind, path, title: COPY.changes.confirmDeleteTitle(name), body: COPY.changes.confirmDeleteBody, meta: null, confirmLabel: COPY.changes.confirmDelete, danger: true }
    case 'resolve-ours':
      return { kind: pending.kind, path, title: COPY.changes.confirmResolveOursTitle(name), body: COPY.changes.confirmResolveOursBody, meta: null, confirmLabel: COPY.changes.confirmResolve, danger: true }
    case 'resolve-theirs':
      return { kind: pending.kind, path, title: COPY.changes.confirmResolveTheirsTitle(name), body: COPY.changes.confirmResolveTheirsBody, meta: null, confirmLabel: COPY.changes.confirmResolve, danger: true }
    default:
      return null
  }
}

export function changesOf(base: SessionBase, state: SessionState): ChangesModel {
  const screen = judgeScreen(base, state)
  const busy = state.busy !== null || state.reloading
  const stagedRows = state.staged.map((path) => fileRowOf(base, state, path, { staged: true, conflict: false }))
  const unstagedRows = state.unstaged.map((path) => fileRowOf(base, state, path, { staged: false, conflict: false }))
  const conflictRows = state.conflicts.map((path) => fileRowOf(base, state, path, { staged: false, conflict: true }))

  const groups: GroupModel[] = []
  if (state.changesFilter === 'all' || state.changesFilter === 'conflict') {
    groups.push({
      id: 'conflict',
      label: COPY.changes.groupConflict,
      emptyText: COPY.changes.groupEmptyConflict,
      rows: conflictRows,
    })
  }
  if (state.changesFilter === 'all' || state.changesFilter === 'staged') {
    groups.push({
      id: 'staged',
      label: COPY.changes.groupStaged,
      emptyText: COPY.changes.groupEmptyStaged,
      rows: stagedRows,
    })
  }
  if (state.changesFilter === 'all' || state.changesFilter === 'unstaged') {
    groups.push({
      id: 'unstaged',
      label: COPY.changes.groupUnstaged,
      emptyText: COPY.changes.groupEmptyUnstaged,
      rows: unstagedRows,
    })
  }
  const keepEmptyGroup = state.changesFilter !== 'all'
  // 全部分组时，空分组不再各占一整行：冲突分组没有文件就不画，未加入分组没有文件也不画；
  // 「已加入」分组保留一行，因为它是「这次提交还没有加入文件」这个结论本身（往下就是提交区）。
  const visibleGroups = groups.filter((group) => {
    if (keepEmptyGroup) return true
    if (group.id === 'staged') return true
    return group.rows.length > 0
  })

  const commitVerdict = verdictOf(screen, 'commit')
  let disabledReason: string | null = commitVerdict.reason
  if (state.staged.length === 0) disabledReason = COPY.changes.commitNoStaged
  else if (state.conflicts.length > 0) disabledReason = COPY.block['conflicts-unresolved']
  else if (state.message.trim() === '') disabledReason = COPY.changes.commitNoMessage

  const changeCount = state.staged.length + state.unstaged.length
  return {
    stats: [
      { id: 'conflict', label: COPY.changes.filterConflict, count: state.conflicts.length, tone: 'error' },
      { id: 'staged', label: COPY.changes.filterStaged, count: state.staged.length, tone: 'ok' },
      { id: 'unstaged', label: COPY.changes.filterUnstaged, count: state.unstaged.length, tone: 'mod' },
    ],
    filter: state.changesFilter,
    groups: visibleGroups,
    empty: state.staged.length === 0 && state.unstaged.length === 0 && state.conflicts.length === 0,
    stagedCount: state.staged.length,
    unstagedCount: state.unstaged.length,
    conflictCount: state.conflicts.length,
    busy,
    canStageAll: !busy && state.conflicts.length === 0 && state.unstaged.length > 0,
    canUnstageAll: !busy && state.staged.length > 0,
    canDiscardAll: !busy && state.conflicts.length === 0 && state.unstaged.length > 0,
    canStash: !busy && state.conflicts.length === 0 && changeCount > 0,
    stashReason: state.conflicts.length > 0 ? COPY.block['conflicts-unresolved'] : null,
    openMenuPath: state.openMenuPath,
    pending: pendingOf(base, state),
    ignoredNote: state.ignored.length === 0 ? null : COPY.changes.ignoredNote(state.ignored.length),
    composer: {
      stagedCount: state.staged.length,
      message: state.message,
      placeholder: COPY.changes.messagePlaceholder,
      hint: COPY.changes.messageHint,
      disabled: busy || disabledReason !== null,
      disabledReason,
      busy: state.busy === 'commit',
    },
  }
}

function dayGroupLabel(nowMs: number, ms: number): string {
  const date = new Date(ms)
  const now = new Date(nowMs)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  if (dayStart === startOfToday) return COPY.history.groupToday
  if (dayStart === startOfToday - 24 * 60 * 60 * 1000) return COPY.history.groupYesterday
  return COPY.history.groupDate(date.getMonth() + 1, date.getDate())
}

interface HistoryEntry {
  oid: string
  short: string
  subject: string
  author: string
  authorDateMs: number
  parents: string[]
  files: Array<{ path: string; added: number; deleted: number }>
  local: boolean
}

/**
 * 合并本地模拟提交与采集提交：总数固定为采集总数，本地新提交插到最前、末尾让出同一条数。
 * 「撤销这次提交」撤掉的那条采集提交暂时从历史里隐去，总数也跟着少一条。
 */
function historyEntries(base: SessionBase, state: SessionState): HistoryEntry[] {
  const local: HistoryEntry[] = state.localCommits.map((commit) => ({
    oid: commit.oid,
    short: commit.short,
    subject: commit.subject,
    author: commit.author,
    authorDateMs: commit.authorDateMs,
    parents: commit.parents,
    files: commit.files,
    local: true,
  }))
  const total = historyTotal(base, state)
  const keep = Math.max(0, total - local.length)
  const captured: HistoryEntry[] = base.screen.commits
    .filter((commit: CommitInfo) => commit.oid !== state.undoneOid)
    .slice(0, keep)
    .map((commit: CommitInfo) => ({
    oid: commit.oid,
    short: commit.short,
    subject: commit.subject,
    author: commit.author,
    authorDateMs: commit.authorDateMs,
    parents: commit.parents,
    files: base.commitFiles.get(commit.oid) ?? [],
    local: false,
  }))
  return [...local, ...captured]
}

/** 历史总数：撤销一条提交之后，列表里的条数立刻少一条，不跟顶部页签的旧数字打架。 */
function historyTotal(base: SessionBase, state: SessionState): number {
  return Math.max(0, base.totalCommits - (state.undoneOid === null ? 0 : 1))
}

function matchesQuery(entry: HistoryEntry, query: string): boolean {
  if (query === '') return true
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return entry.subject.toLowerCase().includes(needle)
    || entry.author.toLowerCase().includes(needle)
    || entry.short.toLowerCase().includes(needle)
}

export function historyOf(base: SessionBase, state: SessionState, nowMs: number): HistoryModel {
  const entries = historyEntries(base, state)
  const filtered = entries.filter((entry) => matchesQuery(entry, state.historyQuery) && (!state.historyMergeOnly || entry.parents.length > 1))
  let previousGroup = ''
  const rows: CommitRowModel[] = filtered.map((entry) => {
    const group = dayGroupLabel(nowMs, entry.authorDateMs)
    const groupLabel = group === previousGroup ? null : group
    previousGroup = group
    return {
      oid: entry.oid,
      short: entry.short,
      subject: entry.subject,
      author: entry.author,
      when: timeText(nowMs, entry.authorDateMs),
      merge: entry.parents.length > 1,
      filesCount: entry.files.length,
      group: groupLabel,
      selected: state.historyOpenOid === entry.oid,
    }
  })

  let detail: CommitDetailModel | null = null
  if (state.historyOpenOid !== null) {
    const entry = entries.find((item) => item.oid === state.historyOpenOid)
    if (entry !== undefined) {
      const merge = entry.parents.length > 1
      const files: HistoryFileRowModel[] = entry.files.map((file) => {
        const { dir, name } = splitPath(file.path)
        const patch = samplePatch(file.path)
        return {
          path: file.path,
          dir,
          name,
          // 和改动视图共用同一套行数差规则：0 不显示（见 data/format.ts 的 lineDelta 注释）。
          delta: lineDelta(file.added, file.deleted),
          expanded: state.historyOpenFile === file.path,
          patch,
          binary: patch !== null && patch.every((line) => line.kind === 'filehead' || line.kind === 'no-newline'),
        }
      })
      detail = {
        oid: entry.oid,
        short: entry.short,
        subject: entry.subject,
        author: entry.author,
        when: timeText(nowMs, entry.authorDateMs),
        parents: entry.parents.map(shortOid),
        files,
        filesNote: entry.files.length === 0 ? (merge ? COPY.history.filesEmptyMerge : COPY.history.filesEmpty) : null,
        loading: false,
      }
    }
  }

  return {
    detail,
    rows,
    loaded: rows.length,
    total: historyTotal(base, state),
    query: state.historyQuery,
    mergeOnly: state.historyMergeOnly,
    empty: rows.length === 0,
    scopeText: COPY.history.loadedCount(rows.length, historyTotal(base, state)),
    mergeOnlyText: COPY.history.mergeOnly,
  }
}

const DEMO_WORKTREE_COUNT = 2

/**
 * 演示用的两棵异常工作树：真实采集的 14 棵都正常，只有 ?demo=1 时才注入，
 * 好让评审看到「被占用」「目录丢失」两种状态徽章与 AI 按钮的真实样子。
 */
function demoWorktreesOf(repoRoot: string): WorktreeInfo[] {
  const base = repoRoot.replace(/[\\\\/]+$/, '')
  return [
    {
      path: base + '/.worktrees/1600-locked-demo',
      display: '1600-locked-demo',
      head: '9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293',
      branch: 'ticket/1600-locked-demo',
      bare: false,
      current: false,
      locked: true,
      lockReason: '另一个终端正在这个目录里跑长测试，git 用 admin 锁挡住了占用',
      lockUnknown: false,
      prunable: false,
      prunableUnknown: false,
    },
    {
      path: base + '/.worktrees/1502-gone-demo',
      display: '1502-gone-demo',
      head: '4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6',
      branch: 'fix/1502-gone-demo',
      bare: false,
      current: false,
      locked: false,
      lockReason: null,
      lockUnknown: false,
      prunable: true,
      prunableUnknown: false,
    },
  ]
}

function stateChipsOf(worktree: WorktreeInfo): { states: WorktreeRowModel['states']; abnormal: boolean } {
  const states: WorktreeRowModel['states'] = []
  if (worktree.locked) states.push({ label: COPY.worktrees.locked, tone: 'warn', detail: worktree.lockReason })
  if (worktree.prunable) states.push({ label: COPY.worktrees.prunable, tone: 'error', detail: null })
  else if (worktree.prunableUnknown) states.push({ label: COPY.worktrees.prunableUnknown, tone: 'warn', detail: '这个 git 版本答不出目录还在不在。' })
  if (worktree.lockUnknown) states.push({ label: COPY.worktrees.lockUnknown, tone: 'warn', detail: '这个 git 版本答不出锁定状态。' })
  if (worktree.bare) states.push({ label: COPY.worktrees.bare, tone: 'info', detail: '裸仓库没有工作区。' })
  if (worktree.branch === null && !worktree.bare) states.push({ label: COPY.worktrees.noBranch, tone: 'muted', detail: null })
  const abnormal = states.some((state) => state.tone === 'warn' || state.tone === 'error')
  return { states, abnormal }
}

function worktreeRowOf(state: SessionState, worktree: WorktreeInfo): WorktreeRowModel {
  const { dir, name } = splitPath(worktree.path)
  const chips = stateChipsOf(worktree)
  return {
    path: worktree.path,
    dir,
    name,
    branch: worktree.branch,
    detached: worktree.branch === null,
    oidShort: shortOid(worktree.head),
    states: chips.states,
    abnormal: chips.abnormal,
    copied: state.copiedPath === worktree.path,
    locked: worktree.locked,
    prunable: worktree.prunable,
  }
}

/**
 * 把面板里已经做过的动作叠加到原始清单上：
 * 解锁过的行不再显示占用，清理与移除过的行直接从清单消失。
 * 真实实现里这些变化来自重新读取 git；原型把它们记在状态里，视图不用各自判断。
 */
function applyWorktreeActions(state: SessionState, item: WorktreeInfo): WorktreeInfo {
  const unlocked = state.unlockedWorktrees.includes(item.path)
  const pruned = state.prunedWorktrees.includes(item.path)
  if (!unlocked && !pruned) return item
  return {
    ...item,
    locked: unlocked ? false : item.locked,
    lockReason: unlocked ? null : item.lockReason,
    prunable: pruned ? false : item.prunable,
  }
}

export function worktreesOf(base: SessionBase, state: SessionState): WorktreesModel {
  const identity = base.screen.identity
  const current = identity.worktreePath === ''
    ? null
    : worktreeRowOf(state, {
      path: identity.worktreePath,
      display: identity.worktreeDisplay,
      head: identity.oid ?? '',
      branch: identity.branch,
      bare: false,
      current: true,
      locked: false,
      lockReason: null,
      lockUnknown: false,
      prunable: false,
      prunableUnknown: false,
    })
  const demo = state.demoWorktrees ? demoWorktreesOf(identity.worktreePath) : []
  const othersRaw = [...base.screen.otherWorktrees.filter((item) => !item.current), ...demo]
    .filter((item) => !state.hiddenWorktrees.includes(item.path))
    .map((item) => applyWorktreeActions(state, item))
  // 需要人工处理的工作树排在最前，其余保持 git 记录顺序（sort 在 ES2019 起稳定）。
  const others = othersRaw
    .map((item) => worktreeRowOf(state, item))
    .sort((a, b) => Number(b.abnormal) - Number(a.abnormal))
  const abnormal = others.filter((row) => row.abnormal).length
  return {
    current,
    others,
    othersCount: others.length,
    abnormalCount: abnormal,
    empty: others.length === 0,
    notice: COPY.worktrees.scope,
    aiLabel: COPY.worktrees.ai,
    aiEnabled: abnormal > 0,
    pending: state.worktreePending,
  }
}

/** 一条分支的列表行与详情：可点性在这里判一次，按钮与原因共用同一个结论。 */
function branchRowOf(state: SessionState, row: BranchRow, nowMs: number): BranchRowModel {
  return {
    name: row.name,
    current: row.current,
    upstream: row.upstream,
    ahead: row.ahead,
    behind: row.behind,
    oidShort: row.oidShort,
    when: timeText(nowMs, row.lastCommitMs),
    subject: row.subject,
    merged: row.mergedIntoCurrent,
  }
}

export function branchesOf(base: SessionBase, state: SessionState, nowMs: number): BranchesModel {
  const query = state.branchQuery.trim().toLowerCase()
  const rows = state.branches
    .filter((row) => query === '' || row.name.toLowerCase().includes(query))
    .map((row) => branchRowOf(state, row, nowMs))
  const current = state.branches.find((row) => row.current) ?? null
  const selectedRaw = state.branchSelected === null
    ? null
    : state.branches.find((row) => row.name === state.branchSelected) ?? null
  let selected: BranchDetailModel | null = null
  if (selectedRaw !== null) {
    const row = branchRowOf(state, selectedRaw, nowMs)
    const isCurrent = selectedRaw.current
    selected = {
      row,
      canSwitch: !isCurrent,
      canMerge: !isCurrent,
      canDelete: !isCurrent,
      canRebase: !isCurrent,
      switchReason: isCurrent ? COPY.branches.switchCurrent : null,
      mergeReason: null,
      deleteReason: isCurrent ? COPY.branches.cannotDeleteCurrent : null,
      rebaseReason: isCurrent ? COPY.branches.rebaseCurrent : null,
      pending: state.branchPending,
    }
  }
  return {
    rows,
    total: state.branches.length,
    currentName: current === null ? base.branch : current.name,
    selected,
    sub: state.branchSub,
    draft: state.branchDraft,
    query: state.branchQuery,
    pending: state.branchPending,
    empty: rows.length === 0,
    dirty: state.staged.length > 0 || state.unstaged.length > 0 || state.conflicts.length > 0,
  }
}


/**
 * 收起改动列表：每条记录只回答三个问题——这是哪一条、什么时候存的、里面有哪些文件。
 * 「放回工作区会不会冲突」这类判断不在原型里模拟，所以只给一句枕边提醒，不假装能预判。
 */
export function stashOf(state: SessionState, nowMs: number): StashModel {
  const rows: StashRowModel[] = state.stashes.map((entry) => ({
    id: entry.id,
    message: entry.message,
    when: timeText(nowMs, entry.whenMs),
    paths: entry.paths,
    filesCount: entry.paths.length,
  }))
  const pending = state.stashPending === null ? null : {
    id: state.stashPending.id,
    title: COPY.stash.dropTitle(state.stashPending.id),
    body: COPY.stash.dropBody,
  }
  return {
    rows,
    total: rows.length,
    empty: rows.length === 0,
    pending,
    busy: state.busy !== null,
  }
}

export function panelModelOf(base: SessionBase, state: SessionState, nowMs: number): PanelModel {
  const tabs = tabsOf(base, state)
  const confirm = state.confirmPull === null ? null : {
    title: COPY.rail.confirmTitle,
    lead: COPY.rail.confirmLead,
    points: COPY.rail.confirmPoints,
    files: state.confirmPull.files,
    continueLabel: COPY.rail.confirmContinue,
    cancelLabel: COPY.rail.confirmCancel,
  }
  return {
    rail: railOf(base, state, nowMs),
    tabs,
    changes: changesOf(base, state),
    history: historyOf(base, state, nowMs),
    worktrees: worktreesOf(base, state),
    branches: branchesOf(base, state, nowMs),
    stash: stashOf(state, nowMs),
    result: state.result,
    confirm,
    busy: state.busy,
    nowMs,
  }
}

export type { LocalCommit }
