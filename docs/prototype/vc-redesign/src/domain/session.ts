/**
 * domain/session.ts —— 原型的状态机，纯函数。
 *
 * 为什么单独一层：真实页面把「读数、忙态、结果、确认」散在宿主回包与 DOM 事件里，
 * 原型若跟着散写，展示的就只是另一份随手拼的界面，而不是一套可评审的状态设计。
 * 这里把界面要回答的五件事集中成一份状态：
 *   ① 现在能不能点（用真实 rules.ts 的 judge 算，不在原型里复述规则）；
 *   ② 点了以后忙什么（busy）；
 *   ③ 做完说了什么、说在哪里（result.source 决定结果出现的位置，这是本次重构的重点之一）；
 *   ④ 「已加入这次提交」的清单改过之后，计数与可点性怎么跟着变；
 *   ⑤ 提交历史里打开的是哪一条、展开的是哪个文件。
 *
 * 不真实执行 git：commit/pull/push/fetch 由 ui 层起一个定时器，模拟宿主往返。
 * 所有对外可见的行为差异（计数、落后清零、结果文案）在 reducer 里显式发生，
 * 后续接回宿主时替换的只是「谁去执行」，状态变化原样保留。
 */

/** 结果出现的位置：这是「结果不能堆在页面底部」的具体落点。 */
export type ResultSource = 'sync' | 'reload' | 'commit' | 'copy' | 'ai' | 'branch' | 'worktree' | 'changes' | 'stash' | 'history'
/** 结果与「下一步」提示的四种语气；muted 表示没有紧迫性，不改变颜色语义。 */
export type Tone = 'ok' | 'warn' | 'error' | 'info' | 'muted'
export type ViewId = 'changes' | 'commits' | 'worktrees' | 'stash'
export type OpName = 'commit' | 'pull' | 'push' | 'fetch'
export type ChangesFilter = 'all' | 'conflict' | 'staged' | 'unstaged'

/** 原型模拟出来的本地提交：字段与真实 CommitInfo 对齐，差异只在 files 也带增删行数。 */
export interface LocalCommit {
  oid: string
  short: string
  subject: string
  author: string
  authorDateMs: number
  parents: string[]
  files: Array<{ path: string; added: number; deleted: number }>
}

export interface ResultMessage {
  tone: Tone
  text: string
  detail: string | null
  source: ResultSource
}

export interface ConfirmPull {
  dirtyCount: number
  files: string[]
}

/** 分支在原型里的状态：与真实 refs 读到的字段一一对应，外加「是否已并入当前分支」。 */
export interface BranchRow {
  name: string
  upstream: string | null
  ahead: number
  behind: number
  oidShort: string
  lastCommitMs: number
  subject: string
  mergedIntoCurrent: boolean
  current: boolean
}

/** 分支页的三种二级形态：列表、单条详情、新建与重命名共用的输入表单。 */
export type BranchSub = 'list' | 'detail' | 'create' | 'rename'

/** 需要二次确认的分支动作：删除、变基，以及「工作区有改动时仍要切换」。 */
export interface BranchPending {
  kind: 'delete' | 'switch' | 'rebase'
  name: string
}

/** 工作树动作的二次确认：三个动作都直接改状态，不再走复制命令。 */
export interface WorktreePending {
  kind: 'unlock' | 'prune' | 'remove'
  path: string
  name: string
}

/**
 * 一条收起记录：git stash 会把「工作区与『已加入这次提交』清单此刻的样子」打包成一条记录。
 * paths 存的是被打包的文件路径，放回工作区时原样恢复；原型不保存文件内容。
 */
export interface StashEntry {
  id: string
  message: string
  whenMs: number
  paths: string[]
}

/** 收起动作里唯一需要二次确认的是丢弃记录：两种放回方式都不删内容，丢弃记录之后找不回来。 */
export interface StashPending {
  kind: 'drop'
  id: string
}

/**
 * 改动行上需要二次确认的动作。
 * 为什么放在状态里而不是视图里：确认卡开着的时候，列表的其它操作应当不可点，
 * 这条判定必须和「点击会不会生效」用同一份状态，不能视图自己记一个变量。
 */
export type ChangesPendingKind = 'discard' | 'discard-all' | 'ignore' | 'delete-untracked' | 'resolve-ours' | 'resolve-theirs'

export interface ChangesPending {
  kind: ChangesPendingKind
  /** 单文件动作记路径；批量动作（丢弃全部）为 null。 */
  path: string | null
}

export interface SessionState {
  view: ViewId
  busy: OpName | null
  reloading: boolean
  result: ResultMessage | null
  confirmPull: ConfirmPull | null
  staged: string[]
  unstaged: string[]
  conflicts: string[]
  ahead: number
  behind: number
  basisMs: number | null
  readAtMs: number
  changesFilter: ChangesFilter
  openFile: string | null
  message: string
  historyQuery: string
  historyMergeOnly: boolean
  historyOpenOid: string | null
  historyOpenFile: string | null
  localCommits: LocalCommit[]
  copiedPath: string | null
  demoWorktrees: boolean
  /** 分支页是否覆盖在当前视图上；分支属于顶部身份，不是第四个页签。 */
  branchOpen: boolean
  branchSub: BranchSub
  branchSelected: string | null
  branchDraft: string
  branchQuery: string
  branchPending: BranchPending | null
  branches: BranchRow[]
  /** 工作树动作的确认与结果：三个动作都在面板里执行，状态改在这里。 */
  worktreePending: WorktreePending | null
  hiddenWorktrees: string[]
  unlockedWorktrees: string[]
  prunedWorktrees: string[]
  /** 改动行的危险动作确认：丢弃、加入忽略、删除未跟踪文件、解决冲突。 */
  changesPending: ChangesPending | null
  /** 哪一行的「更多」菜单被点开了：菜单紧贴这一行画，不再另开一层页面。 */
  openMenuPath: string | null
  /** 原型里「已经加入 .gitignore」的文件：接回宿主后它们会在下一次读取时从列表消失。 */
  ignored: string[]
  /** 收起清单：按 git stash 的顺序，最近一条在最前面。 */
  stashes: StashEntry[]
  stashPending: StashPending | null
  /** 被「撤销这次提交」撤掉的那条提交：从历史里暂时隐去，改动回到「已加入这次提交」。 */
  undoneOid: string | null
}

/**
 * 原型数据基线：来自 data/screen.ts 的真实组装结果。
 * 不把 PrototypeData 整个塞进状态，是因为状态要可比较、可快照；只借三样：
 * 首屏读数、提交总数、提交文件清单。
 */
export interface SessionBase {
  screen: import('../data/core').FirstScreen
  commitFiles: Map<string, Array<{ path: string; added: number; deleted: number }>>
  totalCommits: number
  branch: string | null
  branches: BranchRow[]
}

export type Action =
  | { type: 'view'; view: ViewId }
  | { type: 'tick' }
  | { type: 'stage'; path: string }
  | { type: 'unstage'; path: string }
  | { type: 'stage-all' }
  | { type: 'unstage-all' }
  | { type: 'filter'; filter: ChangesFilter }
  | { type: 'toggle-file'; path: string }
  | { type: 'message'; value: string }
  | { type: 'commit-start' }
  | { type: 'commit-finish' }
  | { type: 'op-start'; op: OpName }
  | { type: 'op-finish'; op: OpName; nowMs: number }
  | { type: 'reload-start' }
  | { type: 'reload-finish'; readAtMs: number; basisMs: number }
  | { type: 'pull-confirm-open'; files: string[]; dirtyCount: number }
  | { type: 'pull-confirm-close' }
  | { type: 'history-query'; value: string }
  | { type: 'history-merge-only' }
  | { type: 'history-open'; oid: string }
  | { type: 'history-open-file'; path: string }
  | { type: 'history-back' }
  | { type: 'result-clear' }
  | { type: 'copy'; path: string }
  | { type: 'ai-worktrees' }
  | { type: 'demo-worktrees' }
  | { type: 'branch-open' }
  | { type: 'branch-close' }
  | { type: 'branch-select'; name: string }
  | { type: 'branch-sub'; sub: BranchSub }
  | { type: 'branch-draft'; value: string }
  | { type: 'branch-query'; value: string }
  | { type: 'branch-pending'; pending: BranchPending | null }
  | { type: 'branch-create' }
  | { type: 'branch-rename'; name: string }
  | { type: 'branch-switch'; name: string }
  | { type: 'branch-merge'; name: string }
  | { type: 'branch-delete'; name: string }
  | { type: 'wt-pending'; pending: WorktreePending | null }
  | { type: 'wt-apply' }
  | { type: 'changes-pending'; pending: ChangesPending | null }
  | { type: 'changes-apply' }
  | { type: 'changes-open-menu'; path: string | null }
  | { type: 'demo-conflicts' }
  | { type: 'stash-create' }
  | { type: 'stash-apply'; id: string }
  | { type: 'stash-pop'; id: string }
  | { type: 'stash-pending'; pending: StashPending | null }
  | { type: 'stash-drop'; id: string }
  | { type: 'commit-undo'; oid: string }
  | { type: 'commit-revert'; oid: string }
  | { type: 'commit-cherry-pick'; oid: string }
  | { type: 'branch-rebase'; name: string }

/** 初始状态：全部从真实首屏读数派生，不在原型里另编一套计数。 */
export function createSessionState(base: SessionBase, nowMs: number): SessionState {
  const conflicts: string[] = []
  const staged: string[] = []
  const unstaged: string[] = []
  const screen = base.screen
  for (const entry of screen.staged) {
    if (entry.conflict) conflicts.push(entry.path)
    else if (entry.staged) staged.push(entry.path)
  }
  for (const entry of screen.unstaged) {
    if (entry.conflict) {
      if (!conflicts.includes(entry.path)) conflicts.push(entry.path)
    } else if (!unstaged.includes(entry.path)) {
      unstaged.push(entry.path)
    }
  }
  return {
    view: 'changes',
    busy: null,
    reloading: false,
    result: null,
    confirmPull: null,
    staged,
    unstaged,
    conflicts,
    ahead: screen.identity.ahead,
    behind: screen.identity.behind,
    basisMs: screen.identity.basisMs,
    // 读取时刻就是页面打开、首屏到手的那一刻；远端依据是首屏数据里更早的基准。
    // 两个时钟必须分开：前者说明「这份界面什么时候读的盘」，后者说明「比较远端时用的是哪一刻的引用」。
    readAtMs: nowMs,
    changesFilter: 'all',
    openFile: null,
    message: '',
    historyQuery: '',
    historyMergeOnly: false,
    historyOpenOid: null,
    historyOpenFile: null,
    localCommits: [],
    copiedPath: null,
    demoWorktrees: false,
    branchOpen: false,
    branchSub: 'list',
    branchSelected: null,
    branchDraft: '',
    branchQuery: '',
    branchPending: null,
    branches: base.branches.map((row) => ({ ...row })),
    worktreePending: null,
    hiddenWorktrees: [],
    unlockedWorktrees: [],
    prunedWorktrees: [],
    changesPending: null,
    openMenuPath: null,
    ignored: [],
    stashes: [],
    stashPending: null,
    undoneOid: null,
  }
}

function unique(paths: string[]): string[] {
  return paths.filter((path, index) => paths.indexOf(path) === index)
}

function withResult(state: SessionState, result: ResultMessage): SessionState {
  return { ...state, result }
}

function enterBusy(state: SessionState, op: OpName): SessionState {
  if (state.busy !== null || state.reloading) return state
  return { ...state, busy: op, confirmPull: null, result: null }
}

function finishBusy(state: SessionState, op: OpName, nowMs: number): SessionState {
  switch (op) {
    case 'pull': {
      const fastForward = state.behind > 0
      const next: SessionState = {
        ...state,
        busy: null,
        behind: 0,
        basisMs: nowMs,
        readAtMs: nowMs,
      }
      return withResult(next, {
        tone: fastForward ? 'ok' : 'info',
        text: fastForward ? '已直接更新到远端最新。' : '已是最新状态。',
        detail: fastForward ? '本地提交没有被改写。远端新提交已经接到当前分支后面。' : '远端没有新的提交需要整合。',
        source: 'sync',
      })
    }
    case 'push': {
      const pushed = state.ahead
      const next: SessionState = { ...state, busy: null, ahead: 0 }
      if (pushed === 0) {
        return withResult(next, {
          tone: 'info',
          text: '远端已是最新，没有需要推送的提交。',
          detail: null,
          source: 'sync',
        })
      }
      return withResult(next, {
        tone: 'ok',
        text: `推送完成：${pushed} 笔提交已到达远端。`,
        detail: '推送成功后远端跟踪引用已经刷新，超前与落后都归零。',
        source: 'sync',
      })
    }
    case 'fetch': {
      return withResult({ ...state, busy: null, basisMs: nowMs, readAtMs: nowMs }, {
        tone: 'ok',
        text: '更新完成：远端依据已刷新。',
        detail: unique(['远端跟踪引用已更新。工作树与「已加入这次提交」的清单没有变化。']).join(''),
        source: 'sync',
      })
    }
    default:
      return { ...state, busy: null }
  }
}

function shortOid(): string {
  let out = ''
  for (let i = 0; i < 7; i += 1) out += '0123456789abcdef'[Math.floor(Math.random() * 16)]
  return out
}

export function reduce(state: SessionState, action: Action, base: SessionBase): SessionState {
  switch (action.type) {
    case 'demo-worktrees':
      return { ...state, demoWorktrees: true }
    case 'view':
      return { ...state, view: action.view }
    case 'tick':
      return { ...state }
    case 'stage': {
      if (state.busy !== null || state.reloading) return state
      if (state.conflicts.includes(action.path)) return state
      if (!state.unstaged.includes(action.path)) return state
      return {
        ...state,
        unstaged: state.unstaged.filter((path) => path !== action.path),
        staged: unique([...state.staged, action.path]),
      }
    }
    case 'unstage': {
      if (state.busy !== null || state.reloading) return state
      if (!state.staged.includes(action.path)) return state
      return {
        ...state,
        staged: state.staged.filter((path) => path !== action.path),
        unstaged: unique([...state.unstaged, action.path]),
      }
    }
    case 'stage-all': {
      if (state.busy !== null || state.reloading) return state
      if (state.conflicts.length > 0) return state
      return { ...state, staged: unique([...state.staged, ...state.unstaged]), unstaged: [] }
    }
    case 'unstage-all': {
      if (state.busy !== null || state.reloading) return state
      return { ...state, unstaged: unique([...state.unstaged, ...state.staged]), staged: [] }
    }
    case 'filter':
      return { ...state, changesFilter: action.filter }
    case 'toggle-file':
      return { ...state, openFile: state.openFile === action.path ? null : action.path }
    case 'message':
      return { ...state, message: action.value }
    case 'commit-start':
      return enterBusy(state, 'commit')
    case 'commit-finish': {
      const staged = state.staged
      const message = state.message.trim()
      if (staged.length === 0 || message === '') {
        return {
          ...state,
          busy: null,
          result: { tone: 'error', text: staged.length === 0 ? '还没有文件加入这次提交，先加入要提交的文件。' : '填写提交说明后即可提交。', detail: null, source: 'commit' },
        }
      }
      const files = staged.map((path) => {
        const meta = metadataOf(base, path)
        return { path, added: meta?.addedLines ?? 0, deleted: meta?.deletedLines ?? 0 }
      })
      const commit: LocalCommit = {
        oid: shortOid() + shortOid() + shortOid() + shortOid() + shortOid() + shortOid(),
        short: shortOid(),
        subject: message,
        author: '辰辰洋洋',
        authorDateMs: Date.now(),
        parents: [state.localCommits[0]?.oid ?? base.screen.commits[0]?.oid ?? ''],
        files,
      }
      return {
        ...state,
        busy: null,
        staged: [],
        message: '',
        ahead: state.ahead + 1,
        localCommits: [commit, ...state.localCommits],
        result: {
          tone: 'ok',
          text: `提交完成：${files.length} 个文件已进入历史。`,
          detail: '这次提交只包含已加入这次提交的文件。这份清单已经清空，可以接着加入下一批。',
          source: 'commit',
        },
      }
    }
    case 'op-start':
      return enterBusy(state, action.op)
    case 'op-finish':
      if (state.busy !== action.op) return state
      return finishBusy(state, action.op, action.nowMs)
    case 'reload-start':
      if (state.busy !== null || state.reloading) return state
      return { ...state, reloading: true, result: null }
    case 'reload-finish':
      return {
        ...state,
        reloading: false,
        readAtMs: action.readAtMs,
        basisMs: action.basisMs,
        result: { tone: 'info', text: '已重新读取。', detail: '首屏读数与远端依据都已刷新。远端引用有没有变化看「更新」。', source: 'reload' },
      }
    case 'pull-confirm-open':
      return { ...state, confirmPull: { dirtyCount: action.dirtyCount, files: action.files } }
    case 'pull-confirm-close':
      return { ...state, confirmPull: null }
    case 'history-query':
      return { ...state, historyQuery: action.value }
    case 'history-merge-only':
      return { ...state, historyMergeOnly: !state.historyMergeOnly }
    case 'history-open':
      return { ...state, historyOpenOid: action.oid, historyOpenFile: null }
    case 'history-open-file':
      return { ...state, historyOpenFile: state.historyOpenFile === action.path ? null : action.path }
    case 'history-back':
      return { ...state, historyOpenOid: null, historyOpenFile: null }
    case 'result-clear':
      return state.result === null ? state : { ...state, result: null }
    case 'copy':
      return withResult({ ...state, copiedPath: action.path }, {
        tone: 'ok',
        text: `已复制：${action.path}`,
        detail: '复制走的是浏览器的剪贴板。面板不会因此发起任何 git 操作。',
        source: 'copy',
      })
    case 'ai-worktrees':
      return withResult(state, {
        tone: 'info',
        text: '原型里 AI 交接只做提示。',
        detail: '真实页面会打开本机 DSH 会话，并在提示里带上异常工作树的路径与状态。',
        source: 'ai',
      })
    case 'wt-pending':
      return { ...state, worktreePending: action.pending }
    case 'wt-apply': {
      const pending = state.worktreePending
      if (pending === null) return state
      const hidden = state.hiddenWorktrees.includes(pending.path)
        ? state.hiddenWorktrees
        : [...state.hiddenWorktrees, pending.path]
      if (pending.kind === 'unlock') {
        return withResult({
          ...state,
          worktreePending: null,
          unlockedWorktrees: unique([...state.unlockedWorktrees, pending.path]),
        }, { tone: 'ok', text: `已解除占用：${pending.name}。`, detail: '工作目录与里面的改动都没有动，只是去掉了 git 的占用标记。', source: 'worktree' })
      }
      if (pending.kind === 'prune') {
        return withResult({
          ...state,
          worktreePending: null,
          hiddenWorktrees: hidden,
          prunedWorktrees: unique([...state.prunedWorktrees, pending.path]),
        }, { tone: 'ok', text: `已清理记录：${pending.name}。`, detail: '这条记录对应的目录本来就不存在，清理不会删除任何文件。', source: 'worktree' })
      }
      return withResult({
        ...state,
        worktreePending: null,
        hiddenWorktrees: hidden,
      }, { tone: 'ok', text: `已移除工作树：${pending.name}。`, detail: '分支与提交都还在仓库里。这一步只删掉了检出记录与工作目录。', source: 'worktree' })
    }
    case 'changes-pending':
      return { ...state, changesPending: action.pending, openMenuPath: null }
    case 'changes-open-menu':
      return { ...state, openMenuPath: action.path, changesPending: null }
    case 'changes-apply': {
      const pending = state.changesPending
      if (pending === null) return state
      const cleared: SessionState = { ...state, changesPending: null }
      const path = pending.path
      const name = path === null ? '' : nameOfPath(path)
      switch (pending.kind) {
        case 'discard': {
          if (path === null || !state.unstaged.includes(path)) return cleared
          const lines = changeSummary(base, path)
          return withResult({
            ...cleared,
            unstaged: state.unstaged.filter((item) => item !== path),
          }, {
            tone: 'warn',
            text: `已丢弃 ${name} 的未加入改动。`,
            detail: lines === '' ? '文件回到上一次提交时的内容。面板不能撤回这一步。' : `文件回到上一次提交时的内容，${lines} 一起丢掉了。面板不能撤回这一步。`,
            source: 'changes',
          })
        }
        case 'discard-all': {
          const count = state.unstaged.length
          if (count === 0) return cleared
          return withResult({ ...cleared, unstaged: [] }, {
            tone: 'warn',
            text: `已丢弃 ${count} 个文件的未加入改动。`,
            detail: '这些文件都回到上一次提交时的内容。面板不能撤回这一步。',
            source: 'changes',
          })
        }
        case 'ignore': {
          if (path === null || !state.unstaged.includes(path)) return cleared
          return withResult({
            ...cleared,
            unstaged: state.unstaged.filter((item) => item !== path),
            ignored: unique([...state.ignored, path]),
          }, {
            tone: 'info',
            text: `已把 ${name} 加入 .gitignore。`,
            detail: '文件仍然留在磁盘上，git 从下一次读取起不再跟踪它。已经提交进历史的内容不受影响。原型不会真的改 .gitignore。',
            source: 'changes',
          })
        }
        case 'delete-untracked': {
          if (path === null || !state.unstaged.includes(path)) return cleared
          return withResult({
            ...cleared,
            unstaged: state.unstaged.filter((item) => item !== path),
          }, {
            tone: 'warn',
            text: `已删除未跟踪文件 ${name}。`,
            detail: '它从来没有进过 git 历史，删除以后没有任何地方能找回。原型不会真的删磁盘上的文件。',
            source: 'changes',
          })
        }
        case 'resolve-ours':
        case 'resolve-theirs': {
          if (path === null || !state.conflicts.includes(path)) return cleared
          const conflicts = state.conflicts.filter((item) => item !== path)
          const side = pending.kind === 'resolve-ours' ? '当前分支' : '对方'
          return withResult({
            ...cleared,
            conflicts,
            staged: unique([...state.staged, path]),
          }, {
            tone: 'ok',
            text: `已按${side}的版本解决 ${name}，文件已加入这次提交。`,
            detail: conflicts.length === 0
              ? '冲突已经全部解决，现在可以提交这次合并的结果。'
              : `还有 ${conflicts.length} 个冲突文件没有解决。`,
            source: 'changes',
          })
        }
        default:
          return cleared
      }
    }
    case 'demo-conflicts':
      // 演示数据：真实仓库此刻没有冲突，评审要评「冲突怎么就地解决」时用它造两行。
      return { ...state, conflicts: unique([...state.conflicts, 'src/client/views/versionControl/vcWriteView.ts', 'src/shared/version-control/src/rules.ts']) }
    case 'branch-open':
      return { ...state, branchOpen: true, branchSub: 'list', branchSelected: null, branchDraft: '', branchPending: null }
    case 'branch-close':
      return { ...state, branchOpen: false, branchPending: null, branchDraft: '' }
    case 'branch-select':
      return { ...state, branchSelected: action.name, branchSub: 'detail', branchPending: null, branchDraft: '' }
    case 'branch-sub':
      return { ...state, branchSub: action.sub, branchDraft: '', branchPending: null }
    case 'branch-draft':
      return { ...state, branchDraft: action.value }
    case 'branch-query':
      return { ...state, branchQuery: action.value }
    case 'branch-pending':
      return { ...state, branchPending: action.pending }
    case 'branch-create': {
      if (state.busy !== null || state.reloading) return state
      const name = state.branchDraft.trim()
      if (name === '' || /\s/.test(name)) {
        return withResult(state, { tone: 'error', text: '分支名不能为空，也不能包含空格。', detail: null, source: 'branch' })
      }
      if (state.branches.some((row) => row.name === name)) {
        return withResult(state, { tone: 'error', text: `分支 ${name} 已经存在。`, detail: null, source: 'branch' })
      }
      const current = state.branches.find((row) => row.current)
      const created: BranchRow = {
        name,
        upstream: null,
        ahead: 0,
        behind: 0,
        oidShort: current === undefined ? state.branches[0]?.oidShort ?? '' : current.oidShort,
        lastCommitMs: Date.now(),
        subject: current === undefined ? '从当前提交创建' : `从 ${current.name} 的当前提交创建`,
        mergedIntoCurrent: true,
        current: false,
      }
      return withResult({
        ...state,
        branches: [...state.branches, created],
        branchSub: 'detail',
        branchSelected: name,
        branchDraft: '',
      }, { tone: 'ok', text: `已创建分支 ${name}，还没有切换过去。`, detail: '新分支指向当前分支的最新提交。切换过去之后才会在它上面提交。', source: 'branch' })
    }
    case 'branch-rename': {
      if (state.busy !== null || state.reloading) return state
      const name = state.branchDraft.trim()
      const from = action.name
      if (name === '' || /\s/.test(name)) {
        return withResult(state, { tone: 'error', text: '分支名不能为空，也不能包含空格。', detail: null, source: 'branch' })
      }
      if (name === from) return { ...state, branchSub: 'detail', branchDraft: '' }
      if (state.branches.some((row) => row.name === name)) {
        return withResult(state, { tone: 'error', text: `分支 ${name} 已经存在。`, detail: null, source: 'branch' })
      }
      return withResult({
        ...state,
        branches: state.branches.map((row) => (row.name === from ? { ...row, name } : row)),
        branchSub: 'detail',
        branchSelected: name,
        branchDraft: '',
      }, { tone: 'ok', text: `分支 ${from} 已改名为 ${name}。`, detail: '只改本地名字。上游跟踪引用与远端分支名都不受影响。', source: 'branch' })
    }
    case 'branch-switch': {
      if (state.busy !== null || state.reloading) return state
      const target = state.branches.find((row) => row.name === action.name)
      if (target === undefined || target.current) return { ...state, branchPending: null }
      return withResult({
        ...state,
        branches: state.branches.map((row) => ({ ...row, current: row.name === action.name })),
        branchPending: null,
        branchSub: 'detail',
        branchSelected: action.name,
        ahead: target.ahead,
        behind: target.behind,
      }, { tone: 'ok', text: `已切换到分支 ${action.name}。`, detail: '左侧工作区的未提交改动已经带过来了。读写与提交都发生在新分支上。', source: 'branch' })
    }
    case 'branch-merge': {
      if (state.busy !== null || state.reloading) return state
      const target = state.branches.find((row) => row.name === action.name)
      const current = state.branches.find((row) => row.current)
      if (target === undefined || current === undefined) return { ...state, branchPending: null }
      if (target.current) {
        return withResult(state, { tone: 'error', text: '不能把当前分支合并进它自己。', detail: null, source: 'branch' })
      }
      const commits = target.ahead + 1
      return withResult({
        ...state,
        branches: state.branches.map((row) => (row.name === target.name ? { ...row, mergedIntoCurrent: true } : row)),
        ahead: state.ahead + commits,
        branchPending: null,
      }, {
        tone: 'ok',
        text: `已把 ${target.name} 合并进 ${current.name}，接入 ${commits} 个提交。`,
        detail: '这次合并没有冲突。合并后的结果还在本地，推送之后远端才看得到。',
        source: 'branch',
      })
    }
    case 'branch-delete': {
      if (state.busy !== null || state.reloading) return state
      const target = state.branches.find((row) => row.name === action.name)
      if (target === undefined) return { ...state, branchPending: null }
      if (target.current) {
        return withResult(state, { tone: 'error', text: '不能删除当前分支，先切换到别的分支。', detail: null, source: 'branch' })
      }
      return withResult({
        ...state,
        branches: state.branches.filter((row) => row.name !== action.name),
        branchSub: 'list',
        branchSelected: null,
        branchPending: null,
      }, { tone: 'ok', text: `已删除分支 ${action.name}。`, detail: '只删了本地记录。如果远端还有这条分支，它不受影响。', source: 'branch' })
    }
    case 'branch-rebase': {
      if (state.busy !== null || state.reloading) return state
      const target = state.branches.find((row) => row.name === action.name)
      const current = state.branches.find((row) => row.current)
      if (target === undefined || current === undefined || target.current) {
        return withResult(state, { tone: 'error', text: '不能把当前分支变基到它自己。', detail: null, source: 'branch' })
      }
      return withResult({
        ...state,
        branches: state.branches.map((row) => (row.name === target.name ? { ...row, mergedIntoCurrent: true } : row)),
        branchSub: 'list',
        branchSelected: null,
      }, {
        tone: 'warn',
        text: `已把 ${current.name} 变基到 ${target.name} 上。`,
        detail: '本地历史被重写成「先放对方分支，再接上自己的提交」。提交号变了，如果这条分支已经推送过，远端需要强推才能对齐。原型只演示结果与状态变化，不改写真实历史。',
        source: 'branch',
      })
    }
    case 'stash-create': {
      if (state.busy !== null || state.reloading) return state
      if (state.conflicts.length > 0) {
        return withResult(state, { tone: 'error', text: '有冲突文件时不能收起改动。', detail: '收起改动会把工作树恢复成上次提交时的样子，冲突文件没有可以安全恢复的版本。先解决冲突，再收起剩下的改动。', source: 'changes' })
      }
      const paths = unique([...state.staged, ...state.unstaged])
      if (paths.length === 0) {
        return withResult(state, { tone: 'info', text: '工作区是干净的，没有可收起的改动。', detail: null, source: 'changes' })
      }
      const branchName = state.branches.find((row) => row.current)?.name ?? base.branch ?? 'detached'
      const message = state.message.trim() === '' ? `WIP on ${branchName}` : state.message.trim()
      const entry: StashEntry = {
        id: `stash@{${state.stashes.length}}`,
        message,
        whenMs: Date.now(),
        paths,
      }
      return withResult({
        ...state,
        stashes: [entry, ...state.stashes],
        staged: [],
        unstaged: [],
        message: '',
      }, {
        tone: 'ok',
        text: `已收起 ${paths.length} 个文件的改动。`,
        detail: `收起记录 ${entry.id} 里放着这些文件。工作区与「已加入这次提交」的清单都恢复成上次提交时的样子，放回工作区或放回并删掉记录都能把它拿回来。`,
        source: 'changes',
      })
    }
    case 'stash-apply':
    case 'stash-pop': {
      if (state.busy !== null || state.reloading) return state
      const entry = state.stashes.find((row) => row.id === action.id)
      if (entry === undefined) return state
      const restored = entry.paths.filter((path) => !state.conflicts.includes(path))
      const before = state.stashes.length
      const stashes = action.type === 'stash-pop' ? state.stashes.filter((row) => row.id !== action.id) : state.stashes
      return withResult({
        ...state,
        stashes,
        unstaged: unique([...state.unstaged, ...restored]),
        stashPending: null,
      }, {
        tone: 'ok',
        text: action.type === 'stash-pop' ? `已把 ${entry.id} 放回工作区并删掉记录，${restored.length} 个文件回到工作区。` : `已把 ${entry.id} 放回工作区，${restored.length} 个文件回到工作区。`,
        detail: action.type === 'stash-pop'
          ? `「放回并删掉记录」等于「放回 + 删除记录」：这条记录已经从清单里移除（原来 ${before} 条）。改动现在在「未加入这次提交」里，需要重新加入再提交。`
          : `「放回工作区」只把改动恢复出来，记录仍然保留在清单里（${before} 条），可以再放回一次，之后也可以丢弃记录。`,
        source: 'stash',
      })
    }
    case 'stash-pending':
      return { ...state, stashPending: action.pending }
    case 'stash-drop': {
      if (state.busy !== null || state.reloading) return state
      const entry = state.stashes.find((row) => row.id === action.id)
      if (entry === undefined) return { ...state, stashPending: null }
      return withResult({
        ...state,
        stashes: state.stashes.filter((row) => row.id !== action.id),
        stashPending: null,
      }, {
        tone: 'warn',
        text: `已丢弃记录 ${entry.id}。`,
        detail: `记录里那 ${entry.paths.length} 个文件当时的样子已经不存在。这一步不能撤回。`,
        source: 'stash',
      })
    }
    case 'commit-undo': {
      if (state.busy !== null || state.reloading) return state
      const localHead = state.localCommits[0] ?? null
      const capturedHead = base.screen.commits[0]
      const headOid = localHead !== null ? localHead.oid : capturedHead?.oid ?? null
      if (headOid === null || action.oid !== headOid) {
        return withResult(state, {
          tone: 'error',
          text: '只能撤销最新一条提交。',
          detail: '撤销会把提交里的改动放回「已加入这次提交」、并让分支退一步。选择更早的提交就得改写它后面的历史，原型不做这一步。',
          source: 'history',
        })
      }
      const files = localHead !== null
        ? localHead.files.map((file) => file.path)
        : (base.commitFiles.get(action.oid) ?? []).map((file) => file.path)
      const subject = localHead !== null ? localHead.subject : capturedHead?.subject ?? ''
      const pushed = state.ahead === 0
      return withResult({
        ...state,
        localCommits: localHead !== null ? state.localCommits.slice(1) : state.localCommits,
        undoneOid: localHead !== null ? state.undoneOid : action.oid,
        staged: unique([...state.staged, ...files]),
        message: state.message.trim() === '' ? subject : state.message,
        ahead: pushed ? state.ahead : Math.max(0, state.ahead - 1),
        behind: pushed ? state.behind + 1 : state.behind,
      }, {
        tone: 'warn',
        text: `已撤销提交 ${subject === '' ? action.oid.slice(0, 7) : subject}。`,
        detail: pushed
          ? `提交里的 ${files.length} 个文件回到「已加入这次提交」，提交说明留在输入框里。这条提交已经推送过，所以本地现在比远端各少一步，需要重新提交后再推送。`
          : `提交里的 ${files.length} 个文件回到「已加入这次提交」，提交说明留在输入框里。可以改完再重新提交。`,
        source: 'history',
      })
    }
    case 'commit-revert': {
      if (state.busy !== null || state.reloading) return state
      const entry = state.localCommits.find((row) => row.oid === action.oid)
        ?? base.screen.commits.find((row) => row.oid === action.oid)
      if (entry === undefined) return state
      return withResult({ ...state, ahead: state.ahead + 1 }, {
        tone: 'ok',
        text: `已生成一次反向提交，抵消「${entry.subject}」。`,
        detail: '回退不是删除历史：原提交还在，后面多了一笔把它的改动撤回去的新提交。这笔新提交还没有推送。如果和别的分支冲突，需要先解决冲突。原型不真的写历史。',
        source: 'history',
      })
    }
    case 'commit-cherry-pick': {
      if (state.busy !== null || state.reloading) return state
      const entry = state.localCommits.find((row) => row.oid === action.oid)
        ?? base.screen.commits.find((row) => row.oid === action.oid)
      if (entry === undefined) return state
      if (entry.parents.length > 1) {
        return withResult(state, { tone: 'error', text: '合并提交不能直接拣选。', detail: '合并提交有两个父提交，拣选时 git 不知道要带哪一边。先拣选它引入的那些普通提交。', source: 'history' })
      }
      return withResult({ ...state, ahead: state.ahead + 1 }, {
        tone: 'ok',
        text: `已把提交 ${entry.short} 拣选到当前分支。`,
        detail: '原来的提交留在它自己的分支上。当前分支多了一笔内容相同、提交号不同的新提交，还没有推送。原型不真的写历史。',
        source: 'history',
      })
    }
    default:
      return state
  }
}

/** 从真实首屏读数里取出某个路径的元数据（变更类型、增删行数、是否冲突）。 */
function metadataOf(base: SessionBase, path: string): import('../data/core').FileEntry | undefined {
  return [...base.screen.staged, ...base.screen.unstaged].find((entry) => entry.path === path)
}

/** 结果文案里只写文件名：完整路径在列表里已经可见，提示条不必再抄一遍目录。 */
function nameOfPath(path: string): string {
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 1] ?? path
}

/** 丢弃与确认卡共用的一句「这次会丢多少」：没有行数（未跟踪、二进制）时返回空串。 */
function changeSummary(base: SessionBase, path: string): string {
  const meta = metadataOf(base, path)
  if (meta === undefined) return ''
  const parts: string[] = []
  if (meta.addedLines !== null && meta.addedLines > 0) parts.push(`新增 ${meta.addedLines} 行`)
  if (meta.deletedLines !== null && meta.deletedLines > 0) parts.push(`删除 ${meta.deletedLines} 行`)
  return parts.join('，')
}

export { metadataOf, nameOfPath, changeSummary }
