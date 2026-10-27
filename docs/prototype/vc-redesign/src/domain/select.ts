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
import type { ChangesFilter, LocalCommit, OpName, SessionState, Tone, ViewId } from './session'
import { metadataOf } from './session'
import type { SessionBase } from './session'

export type BadgeTone = ChangeTone | 'warn' | 'error' | 'ok' | 'info' | 'muted'

/** 页签：每个页签的数字都带单位，三个页签的计数口径不再混在一起。 */
export interface TabModel {
  id: ViewId
  label: string
  count: number
  unit: string
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

export interface ChangesModel {
  stats: Array<{ id: ChangesFilter; label: string; count: number; tone: BadgeTone }>
  filter: ChangesFilter
  groups: GroupModel[]
  composer: ComposerModel
  empty: boolean
  stagedCount: number
  conflictCount: number
  busy: boolean
  canStageAll: boolean
  canUnstageAll: boolean
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
}

export interface WorktreesModel {
  current: WorktreeRowModel | null
  others: WorktreeRowModel[]
  othersCount: number
  empty: boolean
  boundaryText: string
  hint: string
  aiLabel: string
  aiEnabled: boolean
  hintNote: string | null
}

export interface PanelModel {
  rail: RailModel
  tabs: TabModel[]
  changes: ChangesModel
  history: HistoryModel
  worktrees: WorktreesModel
  result: SessionState['result']
  confirm: { title: string; body: string; files: string[]; continueLabel: string; cancelLabel: string } | null
  busy: OpName | null
  nowMs: number
}

/** 首屏读数按状态机里的暂存区改写：judge() 只认 FirstScreen 的计数与身份字段。 */
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

/** 页签计数：改动按文件数、提交按条数、工作树按棵数，单位随数字一起画。 */
export function tabsOf(base: SessionBase, state: SessionState): TabModel[] {
  const changes = state.staged.length + state.unstaged.length + state.conflicts.length
  return [
    { id: 'changes', label: COPY.views.changes, count: changes, unit: COPY.units.change },
    { id: 'commits', label: COPY.views.commits, count: base.totalCommits, unit: COPY.units.commit },
    { id: 'worktrees', label: COPY.views.worktrees, count: base.screen.otherWorktrees.filter((item) => !item.current).length + (state.demoWorktrees ? DEMO_WORKTREE_COUNT : 0), unit: COPY.units.worktree },
  ]
}

function nextStepOf(state: SessionState): { text: string; tone: Tone } {
  if (state.conflicts.length > 0) return { text: '先解决冲突文件，再提交', tone: 'error' }
  if (state.behind > 0) return { text: '先拉取远端的新提交', tone: 'warn' }
  if (state.staged.length > 0 && state.message.trim() === '') return { text: '写一句提交说明，再提交', tone: 'info' }
  if (state.staged.length > 0) return { text: '提交已暂存的文件', tone: 'ok' }
  if (state.unstaged.length > 0) return { text: '先暂存要提交的文件', tone: 'muted' }
  if (state.ahead > 0) return { text: '推送本地提交到远端', tone: 'ok' }
  return { text: '工作区与远端都已同步', tone: 'muted' }
}

export function railOf(base: SessionBase, state: SessionState, nowMs: number): RailModel {
  const identity = base.screen.identity
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
    branch: identity.branch,
    detached: identity.detached,
    oidShort: identity.oid === null ? null : shortOid(identity.oid),
    sync,
    syncChips,
    readAtText: timeText(nowMs, state.readAtMs),
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
  const visibleGroups = groups.filter((group) => keepEmptyGroup || group.id === 'conflict' || group.rows.length > 0 || group.id === 'staged')

  const commitVerdict = verdictOf(screen, 'commit')
  let disabledReason: string | null = commitVerdict.reason
  if (state.staged.length === 0) disabledReason = COPY.changes.commitNoStaged
  else if (state.conflicts.length > 0) disabledReason = COPY.block['conflicts-unresolved']
  else if (state.message.trim() === '') disabledReason = COPY.changes.commitNoMessage

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
    conflictCount: state.conflicts.length,
    busy,
    canStageAll: !busy && state.conflicts.length === 0 && state.unstaged.length > 0,
    canUnstageAll: !busy && state.staged.length > 0,
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

/** 合并本地模拟提交与采集提交：总数固定为采集总数，本地新提交插到最前、末尾让出同一条数。 */
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
  const keep = Math.max(0, base.totalCommits - local.length)
  const captured: HistoryEntry[] = base.screen.commits.slice(0, keep).map((commit: CommitInfo) => ({
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
    total: base.totalCommits,
    query: state.historyQuery,
    mergeOnly: state.historyMergeOnly,
    empty: rows.length === 0,
    scopeText: COPY.history.loadedCount(rows.length, base.totalCommits),
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
  // 需要人工处理的工作树排在最前，其余保持 git 记录顺序（sort 在 ES2019 起稳定）。
  const others = othersRaw
    .map((item) => worktreeRowOf(state, item))
    .sort((a, b) => Number(b.abnormal) - Number(a.abnormal))
  const abnormal = others.filter((row) => row.abnormal).length
  return {
    current,
    others,
    othersCount: others.length,
    empty: others.length === 0,
    boundaryText: COPY.worktrees.boundary,
    hint: COPY.worktrees.hint,
    aiLabel: COPY.worktrees.ai,
    aiEnabled: abnormal > 0,
    hintNote: abnormal > 0 ? `有 ${abnormal} 棵工作树需要人工确认，原因写在对应行的状态里。` : null,
  }
}

export function panelModelOf(base: SessionBase, state: SessionState, nowMs: number): PanelModel {
  const tabs = tabsOf(base, state)
  const confirm = state.confirmPull === null ? null : {
    title: COPY.rail.confirmTitle,
    body: COPY.rail.confirmBody,
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
    result: state.result,
    confirm,
    busy: state.busy,
    nowMs,
  }
}

export type { LocalCommit }
