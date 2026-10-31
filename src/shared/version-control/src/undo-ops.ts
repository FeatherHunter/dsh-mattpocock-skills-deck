/**
 * src/shared/version-control/src/undo-ops.ts —— 域 5「历史改写」五条动作的判定、参数与命令计划（#1748 T13，规格 #1586 域 5）
 *
 * 为什么单独一叶：三条重置（软、混合、硬）、还原提交、拣选提交的参数校验与 git argv 生成必须是
 * 纯函数：宿主预检、宿主执行、界面本地预检三处吃同一份规则，任何一处另写一遍都会让
 * 「界面说能做」与「宿主真去做」悄悄分叉。
 *
 * 约定（改这里之前先读）：
 *   1. 执行时 argv 里的目标一律用提交号（预检阶段解析好的全号），不把用户写的引用原样交给写命令：
 *      用户在确认卡上停留的几秒里引用可能被移动，那就成了「确认的是这条、执行的是那条」。
 *   2. 还原提交固定两步（先 revert --no-commit 再自己 commit -m）：单命令 revert 会开编辑器，
 *      而宿主把 GIT_EDITOR 钉成必失败，编辑器一起整条就失败；-m 对 revert 是主线参数，不能用。
 *   3. 拣选提交一条命令带全部提交号，git 按给出次序逐个做、冲突即停；次序就是用户写的次序，
 *      本文件绝不排序——「按我选的顺序来」是这个动作的承诺。
 *   4. 本文件不读屏幕、不读配置、不起进程：能判的全判，判不了的（目标提交在不在）留给宿主预检。
 */

export type UndoOpName = 'reset-soft' | 'reset-mixed' | 'reset-hard' | 'revert' | 'cherry-pick'

export interface UndoOpDef {
  /** 能力账本上的条目号，界面按它挂能力行，门禁按它断言十条里的五条。 */
  id: string
  /** 宿主与界面共用的动作名（电话入参的 op 字段）。 */
  op: UndoOpName
  /** 词表键：动作名称（config/copy/vcundo.yaml）。 */
  nameKey: string
  /** 危险动作：界面必须走确认卡，预检必须带恢复点。 */
  danger: boolean
  /** 账本上的落点（直 = 一步可见；折 = 收在展开区里），界面按它分组。 */
  placement: '直' | '折'
  needsTarget: boolean
  targetDefault: string
  needsMessage: boolean
  needsCommits: boolean
  resetMode: '' | 'soft' | 'mixed' | 'hard'
  needsRecovery: boolean
}

export const UNDO_OPS: UndoOpDef[] = [
  { id: '5.1', op: 'reset-soft', nameKey: 'vc.undo.op.resetSoft', danger: false, placement: '直', needsTarget: true, targetDefault: 'HEAD~1', needsMessage: false, needsCommits: false, resetMode: 'soft', needsRecovery: false },
  { id: '5.2', op: 'reset-mixed', nameKey: 'vc.undo.op.resetMixed', danger: false, placement: '折', needsTarget: true, targetDefault: 'HEAD~1', needsMessage: false, needsCommits: false, resetMode: 'mixed', needsRecovery: false },
  { id: '5.3', op: 'reset-hard', nameKey: 'vc.undo.op.resetHard', danger: true, placement: '折', needsTarget: true, targetDefault: '', needsMessage: false, needsCommits: false, resetMode: 'hard', needsRecovery: true },
  { id: '5.4', op: 'revert', nameKey: 'vc.undo.op.revert', danger: false, placement: '直', needsTarget: true, targetDefault: '', needsMessage: true, needsCommits: false, resetMode: '', needsRecovery: false },
  { id: '5.5', op: 'cherry-pick', nameKey: 'vc.undo.op.cherryPick', danger: false, placement: '直', needsTarget: false, targetDefault: '', needsMessage: false, needsCommits: true, resetMode: '', needsRecovery: false },
]

/** 五条动作名（宿主写电话与门禁按这张表穷举，漏一条就会少一处校验）。 */
export const UNDO_OP_NAMES: string[] = UNDO_OPS.map(function (one: UndoOpDef) { return one.op })

/** 三条重置（共用「目标提交」这一个输入，但影响面不同）。 */
export const UNDO_RESET_OPS: string[] = ['reset-soft', 'reset-mixed', 'reset-hard']

/** 一次最多拣选多少条提交：单条命令的 argv 不宜无限长，界面也画不下更多勾选。 */
export const UNDO_COMMIT_MAX: number = 50
/** 还原说明最长多少个字符：长到超出确认卡一屏就没有人读了。 */
export const UNDO_MESSAGE_MAX: number = 200
/** 引用最长多少个字符：与历史查询那边同口径（200），超长的引用按坏输入拒。 */
export const UNDO_REV_MAX: number = 200

/** 按动作名取定义；不认识的回 null（调用方回 unknown-op，不猜一条出来）。 */
export function undoOpOf(op: any): UndoOpDef | null {
  const name: string = String(op === undefined || op === null ? '' : op)
  for (let i = 0; i < UNDO_OPS.length; i += 1) if (UNDO_OPS[i].op === name) return UNDO_OPS[i]
  return null
}

/** 按能力条目号取定义（界面上按 5.1–5.5 挂能力行时用）。 */
export function undoOpById(id: any): UndoOpDef | null {
  const key: string = String(id === undefined || id === null ? '' : id)
  for (let i = 0; i < UNDO_OPS.length; i += 1) if (UNDO_OPS[i].id === key) return UNDO_OPS[i]
  return null
}

/** 这个动作要不要走凭票写：五条全是写动作，都要（表留在这里，将来加只读对照时只改一处）。 */
export function undoNeedsTicketOf(op: any): boolean {
  return undoOpOf(op) !== null
}

export function undoDangerOf(op: any): boolean {
  const def: UndoOpDef | null = undoOpOf(op)
  return !!(def && def.danger)
}

export function undoNeedsRecoveryOf(op: any): boolean {
  const def: UndoOpDef | null = undoOpOf(op)
  return !!(def && def.needsRecovery)
}

export function undoResetModeOf(op: any): string {
  const def: UndoOpDef | null = undoOpOf(op)
  return def ? String(def.resetMode) : ''
}

export function undoPlacementOf(op: any): string {
  const def: UndoOpDef | null = undoOpOf(op)
  return def ? String(def.placement) : ''
}

/**
 * 引用形状校验：只挡得住「一眼就不对」的输入（空白、控制符、超长、以横杠开头、含范围表达式、
 * 含冒号）。分支名与提交号到底存不存在、是不是提交，只有 git 知道，留给宿主预检。
 * 返回 null 表示形状可以，否则回一个稳定原因词（required / too-long / bad-shape）。
 */
export function undoRevProblem(rev: any): string | null {
  const text: string = String(rev === undefined || rev === null ? '' : rev).trim()
  if (text === '') return 'required'
  if (text.length > UNDO_REV_MAX) return 'too-long'
  if (/[\s\u0000]/.test(text)) return 'bad-shape'
  if (text.charAt(0) === '-' || text.indexOf('..') >= 0 || text.indexOf(':') >= 0 || text.indexOf('\\') >= 0) return 'bad-shape'
  return null
}

/** 还原说明的形状校验：空串合法（表示用预检算出来的默认说明）；控制符与非空以外的要求同引用。 */
export function undoMessageProblem(message: any): string | null {
  const text: string = String(message === undefined || message === null ? '' : message)
  if (text === '') return null
  if (text.length > UNDO_MESSAGE_MAX) return 'too-long'
  if (/[\u0000-\u0008\u000a-\u001f]/.test(text)) return 'bad-shape'
  return null
}

/**
 * 拣选的提交清单归一：界面送来的是多行文本（一行一个），也可以直接给数组。
 * 空行跳过，其余按原次序保留；重复项判非法（同一条提交做两遍不是用户想要的，也容易误点）。
 */
export function undoCommitsOf(input: any): any {
  let list: string[] = []
  if (Array.isArray(input)) {
    list = input.map(function (one: any) { return String(one === undefined || one === null ? '' : one).trim() }).filter(function (one: string) { return one !== '' })
  } else {
    list = String(input === undefined || input === null ? '' : input).split('\n').map(function (one: string) { return one.trim() }).filter(function (one: string) { return one !== '' })
  }
  if (list.length === 0) return { ok: false, reason: 'commits-empty', index: 0, message: '还没有填要拣选的提交。' }
  if (list.length > UNDO_COMMIT_MAX) return { ok: false, reason: 'commits-too-many', index: 0, message: '一次最多拣选 ' + String(UNDO_COMMIT_MAX) + ' 条提交。' }
  const seen: Record<string, boolean> = {}
  for (let i = 0; i < list.length; i += 1) {
    const problem: string | null = undoRevProblem(list[i])
    if (problem) return { ok: false, reason: 'commits-invalid', index: i + 1, message: '第 ' + String(i + 1) + ' 条提交写的不像一个引用：' + list[i] }
    if (seen[list[i]]) return { ok: false, reason: 'commits-duplicate', index: i + 1, message: '第 ' + String(i + 1) + ' 条与前面重复了：' + list[i] }
    seen[list[i]] = true
  }
  return { ok: true, commits: list }
}

/** 还原提交的默认说明：git 自己会写的那一句，预检算出来让用户看着能改。 */
export function undoDefaultMessageOf(subject: any): string {
  const text: string = String(subject === undefined || subject === null ? '' : subject).trim()
  return 'Revert "' + text + '"'
}

/**
 * 把界面/电话入参翻成稳定计划：这一步只做形状校验，不解析提交号。
 * 计划里不留界面原文（多行文本等），只留能决定「执行什么」的字段，预检与执行靠它算摘要。
 */
export function undoPlanOf(input: any): any {
  const a: any = input || {}
  const op: string = String(a.op === undefined || a.op === null ? '' : a.op)
  const def: UndoOpDef | null = undoOpOf(op)
  if (!def) return { ok: false, reason: 'unknown-op', field: 'op', message: '没有这条历史改写动作：' + op }
  const plan: any = { op: def.op, target: '', targetOid: '', message: '', commits: [], resetMode: String(def.resetMode) }
  if (def.needsTarget) {
    const rawTarget: string = String(a.target === undefined || a.target === null || a.target === '' ? def.targetDefault : a.target).trim()
    const problem: string | null = rawTarget === '' ? 'required' : undoRevProblem(rawTarget)
    if (problem === 'required') return { ok: false, reason: 'required-target', field: 'target', message: '这个动作要先填一个提交。' }
    if (problem) return { ok: false, reason: 'bad-target', field: 'target', message: '这个提交写的不是一个引用：' + rawTarget }
    plan.target = rawTarget
  }
  if (def.needsMessage) {
    const message: string = String(a.message === undefined || a.message === null ? '' : a.message)
    const problem: string | null = undoMessageProblem(message)
    if (problem === 'too-long') return { ok: false, reason: 'message-too-long', field: 'message', message: '还原说明最多 ' + String(UNDO_MESSAGE_MAX) + ' 个字符。' }
    if (problem) return { ok: false, reason: 'bad-message', field: 'message', message: '还原说明里有不能用的字符。' }
    plan.message = message
  }
  if (def.needsCommits) {
    const norm: any = undoCommitsOf(a.commits)
    if (norm.ok !== true) return { ok: false, reason: norm.reason, field: 'commits', index: norm.index, message: norm.message }
    plan.commits = norm.commits
  }
  return { ok: true, plan: plan }
}

/** 执行用的目标：预检解析出了提交号就用提交号，没解析到才回落到用户写的引用（单元测试直接造计划时用）。 */
export function undoTargetOf(plan: any): string {
  const p: any = plan || {}
  return String(p.targetOid || p.target || '')
}

/**
 * 计划翻成要跑的命令序列（一步或多步）。每步是一个 argv，由宿主用固定前缀拼上 -C 仓库后直传。
 * 本函数不校验「目标提交还在不在」——那是宿主预检的事；这里只管 argv 形状。
 */
export function undoArgvOf(plan: any): any {
  const p: any = plan || {}
  const def: UndoOpDef | null = undoOpOf(p.op)
  if (!def) return { ok: false, reason: 'unknown-op' }
  if (def.resetMode !== '') {
    const target: string = undoTargetOf(p)
    if (target === '') return { ok: false, reason: 'required-target' }
    return { ok: true, steps: [['reset', '--' + String(def.resetMode), target]] }
  }
  if (p.op === 'revert') {
    const target: string = undoTargetOf(p)
    if (target === '') return { ok: false, reason: 'required-target' }
    const message: string = String(p.message === undefined || p.message === null ? '' : p.message)
    if (message !== '') return { ok: true, steps: [['revert', '--no-commit', target], ['commit', '-m', message]] }
    return { ok: true, steps: [['revert', '--no-edit', target]] }
  }
  if (p.op === 'cherry-pick') {
    const list: any[] = Array.isArray(p.commits) ? p.commits : []
    const oids: string[] = []
    for (let i = 0; i < list.length; i += 1) {
      const one: any = list[i]
      const picked: string = typeof one === 'string' ? one : String((one && one.oid) || (one && one.rev) || '')
      if (picked === '') return { ok: false, reason: 'commits-empty' }
      oids.push(picked)
    }
    if (oids.length === 0) return { ok: false, reason: 'commits-empty' }
    return { ok: true, steps: [['cherry-pick'].concat(oids)] }
  }
  return { ok: false, reason: 'unknown-op' }
}

/** 计划要跑几步（界面在确认卡上写清「会起几条命令」，也让门禁断言 revert 固定两步）。 */
export function undoStepCountOf(plan: any): number {
  const built: any = undoArgvOf(plan)
  return built.ok === true && Array.isArray(built.steps) ? built.steps.length : 0
}

/** 计划的一句话摘要：只给界面/日志做摘要行用，不参与任何判定。 */
export function undoSummaryOf(plan: any): any {
  const p: any = plan || {}
  const def: UndoOpDef | null = undoOpOf(p.op)
  const commits: any[] = Array.isArray(p.commits) ? p.commits : []
  return {
    op: def ? def.op : String(p.op || ''),
    id: def ? def.id : '',
    target: undoTargetOf(p),
    message: String(p.message === undefined || p.message === null ? '' : p.message),
    commits: commits.length,
    steps: undoStepCountOf(p),
  }
}

/** 该计划是危险动作吗（宿主在回包里带出来，界面据此画红色标记与确认卡）。 */
export function undoPlanDangerOf(plan: any): boolean {
  return undoDangerOf((plan || {}).op)
}

export const UNDO_OPS_SOURCE = 'src/shared/version-control/src/undo-ops.ts'
