/**
 * domain/session.ts —— 原型的状态机，纯函数。
 *
 * 为什么单独一层：真实页面把「读数、忙态、结果、确认」散在宿主回包与 DOM 事件里，
 * 原型若跟着散写，展示的就只是另一份随手拼的界面，而不是一套可评审的状态设计。
 * 这里把界面要回答的五件事集中成一份状态：
 *   ① 现在能不能点（用真实 rules.ts 的 judge 算，不在原型里复述规则）；
 *   ② 点了以后忙什么（busy）；
 *   ③ 做完说了什么、说在哪里（result.source 决定结果出现的位置，这是本次重构的重点之一）；
 *   ④ 暂存区改过之后，计数与可点性怎么跟着变；
 *   ⑤ 提交历史里打开的是哪一条、展开的是哪个文件。
 *
 * 不真实执行 git：commit/pull/push/fetch 由 ui 层起一个定时器，模拟宿主往返。
 * 所有对外可见的行为差异（计数、落后清零、结果文案）在 reducer 里显式发生，
 * 后续接回宿主时替换的只是「谁去执行」，状态变化原样保留。
 */

/** 结果出现的位置：这是「结果不能堆在页面底部」的具体落点。 */
export type ResultSource = 'sync' | 'reload' | 'commit' | 'copy' | 'ai'
/** 结果与「下一步」提示的四种语气；muted 表示没有紧迫性，不改变颜色语义。 */
export type Tone = 'ok' | 'warn' | 'error' | 'info' | 'muted'
export type ViewId = 'changes' | 'commits' | 'worktrees'
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

/** 初始状态：全部从真实首屏读数派生，不在原型里另编一套计数。 */
export function createSessionState(screen: SessionBase['screen'], nowMs: number): SessionState {
  const conflicts: string[] = []
  const staged: string[] = []
  const unstaged: string[] = []
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
        text: fastForward ? '已快进至远端最新。' : '已是最新状态。',
        detail: fastForward ? '本地提交没有被改写；远端新提交已经接到当前分支后面。' : '远端没有新的提交需要整合。',
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
        detail: unique(['远端跟踪引用已更新；工作树与暂存区没有变化。']).join(''),
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
          result: { tone: 'error', text: staged.length === 0 ? '暂存区为空，先暂存要提交的文件。' : '填写提交说明后即可提交。', detail: null, source: 'commit' },
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
          detail: '这次提交只包含已暂存的文件；暂存区已经清空，可以接着暂存下一批。',
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
        result: { tone: 'info', text: '已重新读取。', detail: '首屏读数与远端依据都已刷新；远端引用有没有变化看「更新」。', source: 'reload' },
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
        detail: '复制走的是浏览器的剪贴板；面板不会因此发起任何 git 操作。',
        source: 'copy',
      })
    case 'ai-worktrees':
      return withResult(state, {
        tone: 'info',
        text: '原型里 AI 交接只做提示。',
        detail: '真实页面会打开本机 DSH 会话，并在提示里带上异常工作树的路径与状态。',
        source: 'ai',
      })
    default:
      return state
  }
}

/** 从真实首屏读数里取出某个路径的元数据（变更类型、增删行数、是否冲突）。 */
function metadataOf(base: SessionBase, path: string): import('../data/core').FileEntry | undefined {
  return [...base.screen.staged, ...base.screen.unstaged].find((entry) => entry.path === path)
}

export { metadataOf }
