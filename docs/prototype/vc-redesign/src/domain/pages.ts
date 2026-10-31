/**
 * domain/pages.ts —— 「管理」下二级页与命令面板的状态机。
 *
 * 为什么单独一层而不塞进 domain/session.ts：页签状态机管的是「改动/提交/工作树/收起的改动」这四件事
 * 和它们的写操作；管理页只是查看与演示 162 条能力的入口，二者生命周期不同——
 * 切页签要收起管理页，但从管理页返回不该动任何请求状态。两条状态机各自 reduce，
 * 互不依赖，原型里「点了什么 → 界面变什么」仍然是一步一算。
 *
 * 这里只管页面栈、折叠区、演示进度与命令面板的查询；具体界面长什么样在 ui/views 里。
 * 所有演示动作只改这里的状态，不碰 git。
 */
import { CAPABILITIES } from '../data/capabilities.generated'
import type { Capability } from '../data/capabilities.generated'

/** 二级页编号。前十个是「管理」索引下的九个分区加索引本身；后四个是整页流程。 */
export type PageId =
  | 'manage'
  | 'branch-tags'
  | 'remote'
  | 'submodules'
  | 'maintenance'
  | 'migrate'
  | 'config'
  | 'hooks'
  | 'diagnostics'
  | 'platform'
  | 'rebase'
  | 'conflicts'
  | 'task'
  | 'search'

/** 哪些页属于「管理」索引，哪些是从别处直接打开的整页流程。 */
export const MANAGE_PAGES: PageId[] = ['branch-tags', 'remote', 'submodules', 'maintenance', 'migrate', 'config', 'hooks', 'diagnostics', 'platform']

/** 危险动作的二级确认：确认页只用来逐条核对，不再弹第二个模态。 */
export interface CapabilityResult {
  id: string
  text: string
}

/** 一条能力的演示进行到哪一步：0 未打开、1 第一段确认卡、2 二级确认页（只有整仓不可逆动作才走）。 */
export type CapStage = 0 | 1 | 2

export interface PageState {
  /** 页面栈：最后一项是当前页。返回时弹出一层；只有一层时返回就回到原来的页签。 */
  stack: PageId[]
  /** 命令面板是否打开。它盖在整个面板上，不改变页面栈。 */
  paletteOpen: boolean
  paletteQuery: string
  /** 页内搜索：分支与标签、钩子、配置、诊断、全库搜索共用一格。 */
  query: string
  /** 页内筛选：不同页各用各的含义，值是短标识，界面上显示对应的中文按钮。 */
  filter: string
  /** 折叠区展开的键：配置分组、钩子清单、诊断项、reflog 等。 */
  expanded: string[]
  /** 单字段表单草稿：新建分支名、新远端名、钩子文件名、全库搜索补充词。 */
  draft: string
  /** 正在演示的能力编号（0 表示没有）。 */
  capOpen: string
  capStage: CapStage
  /** 演示走完之后贴在那一行下面的结果：能力编号与一句结果。 */
  capResult: CapabilityResult | null
  /** 整仓不可逆动作打开的二级确认页（存能力的演示编号）。 */
  dangerId: string | null
  /** 二级确认页里让读者照着敲的确认字，敲对才允许点最后一下。 */
  confirmText: string
  /** 变基待办页的演示状态：是否进入演示、走到第几步。 */
  rebaseDemo: boolean
  rebaseStep: number
  /** 冲突向导页的演示状态：是否进入演示、选过哪边、已标记解决的文件。 */
  conflictDemo: boolean
  conflictChoice: 'ours' | 'theirs' | null
  conflictResolved: string[]
  /** 任务进度页的演示状态：是否进入演示、进度百分比。 */
  taskDemo: boolean
  taskProgress: number
  /** 从命令面板跳过来时要高亮的能力编号；下一次交互后清掉。 */
  highlight: string | null
  /** 页面级结果条：动作执行完贴在本页顶部。 */
  result: string | null
}

export type PageAction =
  | { type: 'page-open'; page: PageId }
  | { type: 'page-back' }
  | { type: 'page-close-all' }
  | { type: 'page-query'; value: string }
  | { type: 'page-filter'; filter: string }
  | { type: 'page-fold'; key: string }
  | { type: 'page-draft'; value: string }
  | { type: 'page-result'; text: string }
  | { type: 'page-result-clear' }
  | { type: 'cap-open'; id: string }
  | { type: 'cap-close' }
  | { type: 'cap-run' }
  | { type: 'cap-next' }
  | { type: 'danger-open'; id: string }
  | { type: 'danger-close' }
  | { type: 'danger-run' }
  | { type: 'confirm-text'; value: string }
  | { type: 'rebase-demo' }
  | { type: 'rebase-step' }
  | { type: 'rebase-abort' }
  | { type: 'conflict-demo' }
  | { type: 'conflict-choice'; choice: 'ours' | 'theirs' }
  | { type: 'conflict-resolve'; path: string }
  | { type: 'conflict-abort' }
  | { type: 'task-demo' }
  | { type: 'task-tick' }
  | { type: 'palette-open' }
  | { type: 'palette-close' }
  | { type: 'palette-query'; value: string }
  | { type: 'palette-highlight'; id: string }
  | { type: 'highlight-clear' }

export function createPageState(): PageState {
  return {
    stack: [],
    paletteOpen: false,
    paletteQuery: '',
    query: '',
    filter: 'all',
    expanded: ['identity'],
    draft: '',
    capOpen: '',
    capStage: 0,
    capResult: null,
    dangerId: null,
    confirmText: '',
    rebaseDemo: false,
    rebaseStep: 0,
    conflictDemo: false,
    conflictChoice: null,
    conflictResolved: [],
    taskDemo: false,
    taskProgress: 62,
    highlight: null,
    result: null,
  }
}

/** 当前页：没有打开任何页面时返回 null，界面对着 null 画原来的四页签内容。 */
export function activePage(state: PageState): PageId | null {
  return state.stack.length === 0 ? null : state.stack[state.stack.length - 1]
}

/** 打开一个页面：同一页不重复压栈；从管理索引进分页时保留索引，返回能回到索引。 */
function pushPage(stack: PageId[], page: PageId): PageId[] {
  if (stack[stack.length - 1] === page) return stack
  // 更深一层打开时保留已有栈；页签换页时由调用方先清空，避免「历史 › 远端 › 分支」这种无意义的长栈。
  if (page === 'manage') return ['manage']
  return [...stack, page]
}

function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((item) => item !== key) : [...list, key]
}

/** 一条能力是不是整仓不可逆动作：级别为「毁」且落点在维护页/迁移页的，走二级确认页。 */
export function needsSecondConfirm(cap: Capability): boolean {
  return cap.level === '毁' && (cap.target === 'maintenance' || cap.target === 'migrate')
}

/** 演示走完时写在行下面的那句结果：读与只读不假装写过仓库。 */
export function demoResultText(cap: Capability): string {
  if (cap.readOnly) return `只读能力：原型只展示 ${cap.name} 读到的形状，不写仓库。`
  if (cap.level === '读') return `${cap.name} 读完了（原型模拟）。${cap.result}`
  if (cap.level === '毁') return `${cap.name} 已完成（原型模拟，无法恢复）。${cap.result}`
  return `${cap.name} 已完成（原型模拟）。${cap.result}`
}

/** 一个页面负责的能力：命令面板按落点跳转、页面底部「本页负责的能力」都靠它。 */
export function capabilitiesOf(target: PageId): Capability[] {
  return CAPABILITIES.filter((cap) => cap.target === target)
}

/** 按域列能力：管理索引要说明每个分区覆盖了哪几个 git 域。 */
export function capabilitiesOfDomain(domain: string): Capability[] {
  return CAPABILITIES.filter((cap) => cap.domain === domain)
}

export function reducePage(state: PageState, action: PageAction): PageState {
  switch (action.type) {
    case 'page-open': {
      const stack = pushPage(state.stack, action.page)
      if (stack === state.stack) return state
      return { ...state, stack, query: '', filter: 'all', draft: '', capOpen: '', capStage: 0, dangerId: null, confirmText: '', result: null }
    }
    case 'page-back': {
      if (state.dangerId !== null) return { ...state, dangerId: null, capOpen: '', capStage: 0, confirmText: '' }
      if (state.capOpen !== '') return { ...state, capOpen: '', capStage: 0, capResult: null }
      if (state.stack.length === 0) return state
      const stack = state.stack.slice(0, -1)
      return { ...state, stack, query: '', filter: 'all', capOpen: '', capStage: 0, dangerId: null, capResult: null, result: null }
    }
    case 'page-close-all':
      if (state.stack.length === 0 && !state.paletteOpen) return state
      return { ...state, stack: [], paletteOpen: false, capOpen: '', capStage: 0, dangerId: null, confirmText: '', capResult: null, result: null, highlight: null }
    case 'page-query':
      return { ...state, query: action.value, draft: action.value }
    case 'page-filter':
      return { ...state, filter: action.filter }
    case 'page-fold':
      return { ...state, expanded: toggle(state.expanded, action.key) }
    case 'page-draft':
      return { ...state, draft: action.value }
    case 'page-result':
      return { ...state, result: action.text }
    case 'page-result-clear':
      return state.result === null ? state : { ...state, result: null }
    case 'cap-open': {
      const cap = CAPABILITIES.find((item) => item.id === action.id)
      if (cap === undefined || cap.readOnly) return state
      return { ...state, capOpen: cap.id, capStage: 1, capResult: null }
    }
    case 'cap-next': {
      if (state.capOpen === '') return state
      return { ...state, capStage: 2 }
    }
    case 'cap-close':
      return { ...state, capOpen: '', capStage: 0, capResult: null }
    case 'cap-run': {
      const cap = CAPABILITIES.find((item) => item.id === state.capOpen)
      if (cap === undefined) return state
      return { ...state, capOpen: '', capStage: 0, capResult: { id: cap.id, text: demoResultText(cap) }, highlight: cap.id }
    }
    case 'danger-open': {
      const cap = CAPABILITIES.find((item) => item.id === action.id)
      if (cap === undefined || !needsSecondConfirm(cap)) return state
      return { ...state, dangerId: cap.id, capOpen: '', capStage: 0, confirmText: '' }
    }
    case 'danger-close':
      return { ...state, dangerId: null, confirmText: '' }
    case 'danger-run': {
      const cap = CAPABILITIES.find((item) => item.id === state.dangerId)
      if (cap === undefined || !needsSecondConfirm(cap)) return state
      return { ...state, dangerId: null, confirmText: '', capResult: { id: cap.id, text: demoResultText(cap) }, highlight: cap.id, result: '危险动作已在核对页确认（原型模拟）：真实执行不在原型里发生，界面只记录这一步走过。' }
    }
    case 'confirm-text':
      return { ...state, confirmText: action.value }
    case 'rebase-demo':
      return { ...state, rebaseDemo: true, rebaseStep: 0, result: null }
    case 'rebase-step':
      return { ...state, rebaseStep: Math.min(state.rebaseStep + 1, 6) }
    case 'rebase-abort':
      return { ...state, rebaseDemo: false, rebaseStep: 0, result: '已中止变基，分支回到演示开始前的提交（原型模拟）。' }
    case 'conflict-demo':
      return { ...state, conflictDemo: true, conflictChoice: null, conflictResolved: [], result: null }
    case 'conflict-choice':
      return { ...state, conflictChoice: action.choice }
    case 'conflict-resolve':
      if (!state.conflictResolved.includes(action.path)) return { ...state, conflictResolved: [...state.conflictResolved, action.path] }
      return { ...state, conflictResolved: state.conflictResolved.filter((path) => path !== action.path) }
    case 'conflict-abort':
      return { ...state, conflictDemo: false, conflictChoice: null, conflictResolved: [], result: '已中止合并，工作区回到合并开始前（原型模拟）。' }
    case 'task-demo':
      return { ...state, taskDemo: true, taskProgress: 62, result: null }
    case 'task-tick':
      return { ...state, taskProgress: Math.min(100, state.taskProgress + 19) }
    case 'palette-open':
      return { ...state, paletteOpen: true, paletteQuery: '' }
    case 'palette-close':
      return { ...state, paletteOpen: false, paletteQuery: '' }
    case 'palette-query':
      return { ...state, paletteQuery: action.value }
    case 'palette-highlight':
      return { ...state, highlight: action.id }
    case 'highlight-clear':
      return state.highlight === null ? state : { ...state, highlight: null }
    default:
      return state
  }
}

/**
 * 命令面板选中一条能力之后应该跳到哪：返回 'changes' 等四页签之一表示回到页签视图，
 * 返回 PageId 表示打开一个二级页，返回 null 表示这条能力没有面板落点（直接在当前页高亮）。
 */
export function targetOfCapability(cap: Capability): PageId | 'view' {
  switch (cap.target) {
    case 'changes': return 'view'
    case 'commits': return 'view'
    case 'worktrees': return 'view'
    case 'stash': return 'view'
    case 'manage': return 'manage'
    default: return cap.target as PageId
  }
}

/** 能力所属页签（target 为四页签时直接返回原名），命令面板要显示「历史 › 提交行菜单」这种位置。 */
export function viewIdOfCapability(cap: Capability): string {
  switch (cap.target) {
    case 'changes': return 'changes'
    case 'commits': return 'commits'
    case 'worktrees': return 'worktrees'
    case 'stash': return 'stash'
    default: return cap.target
  }
}
