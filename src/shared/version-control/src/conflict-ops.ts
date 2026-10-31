/**
 * src/shared/version-control/src/conflict-ops.ts —— 冲突向导（#1747 T12，规格域 6 十五条）的共享协议（零依赖）
 *
 * 这个文件同时被三方读：界面（冲突向导页每一行按它画、按它发电话）、宿主预检（判定这一动作此刻能不能做）、
 * 宿主执行（按它拼 argv）。三方读同一张表，界面就不会出现「按钮在、宿主永远拦」的错位。
 *
 * 本文件没有 import：它要被构建拼进界面闭包（scripts/build.mts 的 SHARED_SPLICE），也要被宿主直接 import。
 * 三条约定不能改：
 *   1. argv 一律是「子命令 + 独立参数」的数组，元素里不许拼空格，也不许出现 git 可执行名——
 *      固定前缀与可执行文件路径由宿主执行层拼（规格 §8 宿主执行纪律）。
 *   2. 这里只给动作与判定，不起进程、不读文件、不写文件：真执行归宿主叶子，文件读写归宿主叶子。
 *   3. 危险动作只有跳过与中止两条（规格 §3.3/§3.5：它们会丢掉正在进行的操作里的中间状态），
 *      其余动作哪怕会改写工作区文件也不弹四段确认卡，因为都能由 git 重做。
 */

/** 十条写动作：规格 6.1–6.4 四种合并、6.6 选边、6.7 面板内整份编辑、6.8 标记已解决、6.11–6.13 继续/跳过/中止。 */
export const CONFLICT_WRITE_OPS: any[] = [
  { id: 'merge', capId: '6.1', kind: 'write', dangerous: false, confirm: false, reversible: true, needs: 'target', fs: false, labelKey: 'vc.conflicts.op.merge', command: 'git merge <target>' },
  { id: 'merge-ff-only', capId: '6.2', kind: 'write', dangerous: false, confirm: false, reversible: true, needs: 'target', fs: false, labelKey: 'vc.conflicts.op.mergeFfOnly', command: 'git merge --ff-only <target>' },
  { id: 'merge-no-ff', capId: '6.3', kind: 'write', dangerous: false, confirm: false, reversible: true, needs: 'target', fs: false, labelKey: 'vc.conflicts.op.mergeNoFf', command: 'git merge --no-ff <target>' },
  { id: 'merge-squash', capId: '6.4', kind: 'write', dangerous: false, confirm: false, reversible: true, needs: 'target', fs: false, labelKey: 'vc.conflicts.op.mergeSquash', command: 'git merge --squash <target>' },
  { id: 'take-side', capId: '6.6', kind: 'write', dangerous: false, confirm: false, reversible: false, needs: 'path-side', fs: false, labelKey: 'vc.conflicts.op.takeSide', command: 'git checkout --ours / --theirs -- <path>（保留删除用 git rm -- <path>）' },
  { id: 'save-file', capId: '6.7', kind: 'write', dangerous: false, confirm: false, reversible: false, needs: 'path-text', fs: true, labelKey: 'vc.conflicts.op.saveFile', command: '面板内整份编辑（保存前 git diff --check；不推外部编辑器）' },
  { id: 'mark-resolved', capId: '6.8', kind: 'write', dangerous: false, confirm: false, reversible: true, needs: 'path', fs: false, labelKey: 'vc.conflicts.op.markResolved', command: 'git add -- <path>' },
  { id: 'op-continue', capId: '6.11', kind: 'write', dangerous: false, confirm: false, reversible: true, needs: 'none', fs: false, labelKey: 'vc.conflicts.op.opContinue', command: 'git <operation> --continue' },
  { id: 'op-skip', capId: '6.12', kind: 'write', dangerous: true, confirm: true, reversible: false, needs: 'none', fs: false, labelKey: 'vc.conflicts.op.opSkip', command: 'git <operation> --skip' },
  { id: 'op-abort', capId: '6.13', kind: 'write', dangerous: true, confirm: true, reversible: false, needs: 'none', fs: false, labelKey: 'vc.conflicts.op.opAbort', command: 'git <operation> --abort' }
]

/** 五条只读动作：6.5 冲突清单、6.9 面板冲突视图、6.10 merge-tree 预演、6.14 rerere、6.15 残留标记检查。 */
export const CONFLICT_READ_OPS: any[] = [
  { id: 'conflict-list', capId: '6.5', kind: 'read', dangerous: false, confirm: false, reversible: true, needs: 'none', fs: false, labelKey: 'vc.conflicts.op.conflictList', command: 'git status --porcelain=v2 --branch -z + git ls-files --stage -z' },
  { id: 'conflict-view', capId: '6.9', kind: 'read', dangerous: false, confirm: false, reversible: true, needs: 'path', fs: false, labelKey: 'vc.conflicts.op.conflictView', command: '面板冲突视图（不调用 git mergetool）' },
  { id: 'merge-preview', capId: '6.10', kind: 'read', dangerous: false, confirm: false, reversible: true, needs: 'target', fs: false, labelKey: 'vc.conflicts.op.mergePreview', command: 'git merge-tree --write-tree --name-only <target>' },
  { id: 'rerere-view', capId: '6.14', kind: 'read', dangerous: false, confirm: false, reversible: true, needs: 'none', fs: false, labelKey: 'vc.conflicts.op.rerereView', command: 'git rerere status / git config rerere.enabled' },
  { id: 'marker-check', capId: '6.15', kind: 'read', dangerous: false, confirm: false, reversible: true, needs: 'none', fs: false, labelKey: 'vc.conflicts.op.markerCheck', command: 'git diff --check / git diff --cached --check' }
]

/** 十五条能力一张表：界面按它逐行画，门禁按它对账能力账本。 */
export const CONFLICT_OPS: any[] = CONFLICT_WRITE_OPS.concat(CONFLICT_READ_OPS)

/** 按动作标识找表项；认不出回 null（不要兜底成某个动作，否则界面会替用户选动作）。 */
export function conflictOpMetaOf(op: any): any {
  const id = String(op === undefined || op === null ? '' : op)
  for (let i = 0; i < CONFLICT_OPS.length; i += 1) {
    if (CONFLICT_OPS[i].id === id) return CONFLICT_OPS[i]
  }
  return null
}

/** 进行中操作的四种状态，顺序固定：界面状态条、continue/skip/abort 的 argv 都按它取。 */
export const CONFLICT_STATES: string[] = ['merge', 'rebase', 'cherry-pick', 'revert']

/** 状态文案键：cherry-pick 在词条里写成驼峰 cherryPick。 */
export function conflictStateLabelKeyOf(state: any): string {
  const s = String(state === undefined || state === null ? '' : state)
  if (s === 'cherry-pick') return 'vc.conflicts.state.cherryPick'
  if (s === 'merge' || s === 'rebase' || s === 'revert') return 'vc.conflicts.state.' + s
  return ''
}

/**
 * 票据里的冲突计划：七格固定形状，未给的格子落 null。
 * 执行层与门禁按同一份形状读（不要按动作删键），否则摘要会随动作变长变短。
 */
export function conflictPlanOf(partial: any): any {
  const p = partial || {}
  const pick = function (key: string): any {
    return p[key] === undefined || p[key] === null ? null : p[key]
  }
  return { op: pick('op'), state: pick('state'), target: pick('target'), path: pick('path'), side: pick('side'), textDigest: pick('textDigest'), oldDigest: pick('oldDigest') }
}

/**
 * 计划 → 要依次执行的 argv 清单（不含可执行文件与固定前缀）。
 * 返回数组而不是单条命令：选边要先 checkout 再 add，两步之间不留半途状态。
 */
export function conflictStepsOf(plan: any): string[][] {
  const p = plan || {}
  const op = String(p.op === undefined || p.op === null ? '' : p.op)
  const target = String(p.target === undefined || p.target === null ? '' : p.target)
  const path = String(p.path === undefined || p.path === null ? '' : p.path)
  const state = String(p.state === undefined || p.state === null ? '' : p.state)
  const side = String(p.side === undefined || p.side === null ? '' : p.side)
  if (op === 'merge') return [['merge', target]]
  if (op === 'merge-ff-only') return [['merge', '--ff-only', target]]
  if (op === 'merge-no-ff') return [['merge', '--no-ff', target]]
  if (op === 'merge-squash') return [['merge', '--squash', target]]
  if (op === 'take-side') {
    if (side === 'delete') return [['rm', '--', path]]
    return [['checkout', side === 'theirs' ? '--theirs' : '--ours', '--', path], ['add', '--', path]]
  }
  if (op === 'save-file') return []
  if (op === 'mark-resolved') return [['add', '--', path]]
  if (op === 'op-continue') return [[state, '--continue']]
  if (op === 'op-skip') return [[state, '--skip']]
  if (op === 'op-abort') return [[state, '--abort']]
  if (op === 'conflict-list') return [['status', '--porcelain=v2', '--branch', '-z']]
  if (op === 'conflict-view') return [['diff', '--diff-filter=U', '--name-only', '-z']]
  if (op === 'merge-preview') return [['merge-tree', '--write-tree', '--name-only', target]]
  if (op === 'rerere-view') return [['rerere', 'status']]
  // 6.15 要查两半：git diff --check 只看「工作区 vs 索引」，已解决并 git add 过的文件在工作区与索引之间
  // 没有差异，单查前半会漏掉「已暂存但内容里还留着冲突标记」的情形；而后半 --cached 正好查「索引 vs HEAD」。
  // 两条都要在提交前跑，缺哪一条都会放出带残留标记的提交。
  if (op === 'marker-check') return [['diff', '--check'], ['diff', '--cached', '--check']]
  return []
}

/**
 * 合并目标守卫：分支名、远端分支名、或完整/缩写提交号。
 * 拒绝前导短横线（否则会被当成选项）、空白、..（会被当成范围）、冒号（refspec）、反斜杠与不可见字符。
 */
export function conflictTargetProblem(target: any): any {
  if (typeof target !== 'string' || target === '') return 'bad-target'
  if (/[\u0000-\u001f\u007f\s]/.test(target)) return 'bad-target'
  if (target.charAt(0) === '-') return 'bad-target'
  if (target.indexOf('..') >= 0 || target.indexOf(':') >= 0 || target.indexOf('\\') >= 0) return 'bad-target'
  if (target.indexOf('~') >= 0 || target.indexOf('^') >= 0 || target.indexOf('*') >= 0 || target.indexOf('?') >= 0 || target.indexOf('[') >= 0) return 'bad-target'
  if (target.charAt(target.length - 1) === '/') return 'bad-target'
  if (!/^[A-Za-z0-9._\/-]+$/.test(target)) return 'bad-target'
  if (target.indexOf('//') >= 0 || target.indexOf('/.') >= 0) return 'bad-target'
  return null
}

/**
 * 仓库内路径守卫：与改动页同一口径（拒绝绝对路径、盘符、反斜杠、上跳、空段、选项样与 .git 内部路径）。
 * 冲突路径最终要作为独立参数交给 git，前导短横线会被当成选项。
 */
export function conflictPathProblem(path: any): any {
  if (typeof path !== 'string' || path === '') return 'bad-path'
  if (/[\u0000-\u001f\u007f]/.test(path)) return 'bad-path'
  if (path.indexOf('\\') >= 0) return 'bad-path'
  if (path.charAt(0) === '/' || /^[A-Za-z]:/.test(path)) return 'bad-path'
  if (path.charAt(0) === '-' || path.charAt(0) === ':') return 'bad-path'
  if (path.charAt(path.length - 1) === '/') return 'bad-path'
  const segments = path.split('/')
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]
    if (seg === '' || seg === '.' || seg === '..') return 'bad-path'
  }
  if (path === '.git' || path.indexOf('.git/') === 0) return 'bad-path'
  return null
}

/** 选边只认三档：当前边、对方边、保留删除。 */
export function conflictSideProblem(side: any): any {
  const s = String(side === undefined || side === null ? '' : side)
  if (s === 'ours' || s === 'theirs' || s === 'delete') return null
  return 'bad-side'
}

/** 当前进行中操作：四种状态谁在就报谁；都没有回 null（界面据此决定显不显示继续/跳过/中止）。 */
export function conflictStateOfScreen(screen: any): any {
  const repo = (screen && screen.repo) ? screen.repo : {}
  if (repo.merging) return 'merge'
  if (repo.rebasing) return 'rebase'
  if (repo.cherryPicking) return 'cherry-pick'
  if (repo.reverting) return 'revert'
  return null
}

/**
 * 这一动作此刻能不能做：回理由标识符或 null。
 * 理由都写成标识符（不是句子），句子在 config/copy 的词条里——界面与宿主说的是同一句。
 */
export function conflictOpAllowedIn(op: any, state: any, hasConflicts: any): any {
  const meta = conflictOpMetaOf(op)
  if (meta === null) return 'bad-target'
  const id = meta.id
  const has = hasConflicts === true
  const st = (state === undefined || state === null || state === '') ? null : String(state)
  if (id === 'merge' || id === 'merge-ff-only' || id === 'merge-no-ff' || id === 'merge-squash') return st === null ? null : 'operation-in-progress'
  if (id === 'take-side' || id === 'save-file' || id === 'mark-resolved') return has ? null : 'nothing-to-do'
  if (id === 'op-continue') {
    if (st === null) return 'no-operation'
    if (has) return 'unmerged-files'
    return null
  }
  if (id === 'op-skip') {
    if (st === null) return 'no-operation'
    if (st === 'merge') return 'wrong-operation'
    return null
  }
  if (id === 'op-abort') return st === null ? 'no-operation' : null
  if (id === 'merge-preview') return st === null ? null : 'operation-in-progress'
  return null
}

/** 某个路径的索引阶段集合 → 三条边各有哪几条：ours 看阶段 2、theirs 看阶段 3、删除永远可选。 */
export function conflictSidesOf(stages: any): any {
  const list = Array.isArray(stages) ? stages : []
  let ours = false
  let theirs = false
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === 2) ours = true
    if (list[i] === 3) theirs = true
  }
  return { ours: ours, theirs: theirs, delete: true }
}

/**
 * 冲突按六类（规格 §3.5）：双方改、双方删、改/删、改名冲突、二进制、子模块、文件模式。
 * 输入 {stages, modes} 是同一路径的索引阶段与对应模式（两数组平行）。
 * 二进制不用阶段判断——调用方取阶段内容看到 NUL 再归到二进制那一类。
 */
export function conflictKindOf(input: any): string {
  const stages = Array.isArray(input && input.stages) ? input.stages : []
  const modes = Array.isArray(input && input.modes) ? input.modes : []
  for (let i = 0; i < modes.length; i += 1) {
    if (String(modes[i]) === '160000') return 'submodule'
  }
  let modeOurs: any = null
  let modeTheirs: any = null
  for (let i = 0; i < stages.length; i += 1) {
    if (stages[i] === 2) modeOurs = modes[i]
    if (stages[i] === 3) modeTheirs = modes[i]
  }
  if (modeOurs !== null && modeTheirs !== null && String(modeOurs) !== String(modeTheirs)) return 'mode'
  const set: number[] = []
  for (let i = 0; i < stages.length; i += 1) {
    if (set.indexOf(stages[i]) < 0) set.push(stages[i])
  }
  set.sort(function (a, b) { return a - b })
  const key = set.join(',')
  if (key === '1,2,3') return 'both-changed'
  if (key === '2,3') return 'both-changed'
  if (key === '1,2') return 'deleted-by-theirs'
  if (key === '1,3') return 'deleted-by-ours'
  if (key === '1') return 'both-deleted'
  if (key === '2' || key === '3') return 'renamed'
  return 'both-changed'
}

/** 冲突向导的电话名：界面只认这两条，宿主注册同名两条。 */
export const CONFLICT_PHONES: any = { check: 'wf.gitConflictCheck', write: 'wf.gitConflictWrite' }

export const CONFLICT_OPS_SOURCE = 'src/shared/version-control/src/conflict-ops.ts'

/**
 * 冲突写动作联合类型：写成自包含字面量，不 extends ports.ts 的 WriteOp。
 * 理由有两条：一是本文件要零 import（构建把它拼进界面闭包），同层 type import 会被引用方向门禁判红；
 * 二是这些动作**不并入** WriteOp —— 并入要连带改七登记点门禁与共享判定表（#1741 的 verify-1586-write-registration
 * 按精确记号断言 WriteOp），而冲突向导按 #1751/#1746 的先例用自己的动作表、自己的票据 op。
 * 界面与宿主的 action 字段仍是这十个字符串，argv 由 conflictStepsOf 拼，票据 op 原样保存这十个值之一。
 */
export type ConflictWriteOp = 'merge' | 'merge-ff-only' | 'merge-no-ff' | 'merge-squash' | 'take-side' | 'save-file' | 'mark-resolved' | 'op-continue' | 'op-skip' | 'op-abort'

/** 预检回包的协议名与版本：界面按它判「这份回包是不是我认识的形状」，不认识的整份不信。 */
export const CONFLICT_CHECK_CONTRACT = 'vc-conflicts-check'
export const CONFLICT_CHECK_VERSION = 1
