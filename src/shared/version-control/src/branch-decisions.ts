// shared/version-control/src/branch-decisions.ts —— 域 4（分支与标签）的判定与取名规则（#1746 T11）
//
// 这一片是纯函数：不读磁盘、不起进程、不 import 任何东西。零 import 是为了让门禁能拿这份源码单独求值；
//   shared 层内新增同层 import 会被依赖门禁的存量清单拦下（same-layer-import-shared 只许减不许增），
//   但「同层 import 一定会被拦」不是真话——changes-protocol.ts:14-15 就有存量 import。
//   宿主与界面都从这一份读判定，界面不自己另判一遍（规格第 4 节「写动作三段式」：
//   禁用原因与核心判定函数同源）。
//
// 与 #1737 T02 的 rules.ts 的关系：rules.ts 的 judge() 只覆盖 stage/commit/pull/push/fetch 五种写操作，
//   操作枚举与票据绑定都在那一族的类型里；分支与标签的十三个动作不走那套 120 秒票据（它们不是
//   commit/pull/push/fetch 四种写操作），所以判定放在这里，理由表也是一张独立的固定表。
//   以后若把域判定并进 rules.ts，迁移点就是这一份的 BRANCH_REASONS 与各个 decide* 函数。

/** 一条判定结论：允许 / 提醒（需要用户确认）/ 阻止（常驻禁用原因）。 */
export type BranchVerdict = 'allow' | 'warn' | 'block'

/** 判定给出的理由标识符只能从下面这张固定表里取，不另造临时字符串。 */
export const BRANCH_REASONS = {
  ok: '可以继续',
  'unsaved-changes': '工作区有未保存的改动：先确认这些改动不会丢，再动手',
  'mid-operation': '仓库正停在中途操作里（合并 / 变基 / 摘取 / 回退）：先收尾或中止，再切分支',
  'conflicts-unresolved': '还有未解决的冲突：先解决冲突再切分支',
  'branch-exists': '同名分支已经存在：换一个名字',
  'branch-missing': '这个分支不存在了：刷新分支列表再试',
  'bad-branch-name': '分支名不合法：git 的分支名规则更细（不许空格、冒号、反斜杠、结尾点号等）',
  'bad-tag-name': '标签名不合法：git 的标签名规则更细（不许空格、冒号、反斜杠、结尾点号等）',
  'cannot-delete-current': '不能删掉当前所在的分支：先切到别的分支',
  'branch-not-merged': '这个分支还有没并进当前分支的提交：直接删会丢提交，需要确认强制删除',
  'force-delete': '强制删除会丢掉没并进来的提交：确认卡上写清丢的是哪些提交',
  'tag-exists': '同名标签已经存在：换一个名字',
  'missing-tag-message': '附注标签与签名标签必须写说明：没有说明的附注标签和轻量标签没有区别',
  'tag-message-too-long': '标签说明超过 8192 个字符：拆短一点',
  'description-too-long': '分支说明超过 4096 个字符：面板自己的上限，git 本身不限',
  'bad-description': '分支说明里不能有 NUL 字符',
  'bad-upstream': '上游写法不合法：要写成「远端名/分支名」',
  'signing-needs-key': '签名要用本机的 GPG 密钥：密钥不可用时 git 会失败，失败原话照实显示',
  'rev-missing': '要切过去的提交号或引用是空的',
  'version-unsupported': '这台机器上的 git 版本太旧，做不了这个分支动作：升级 git 之后再试',
  'nothing-to-do': '没有需要改动的内容',
} as const

export type BranchReasonId = keyof typeof BRANCH_REASONS
export const BRANCH_REASON_IDS: BranchReasonId[] = Object.keys(BRANCH_REASONS) as BranchReasonId[]

/** 域 4 的十三个能力编号（与能力账本 4.1–4.13 一一对应）。 */
export const BRANCH_OP_IDS: string[] = ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7', '4.8', '4.9', '4.10', '4.11', '4.12', '4.13']

/** 写动作的参数形状（宿主电话里按这个校验，界面按它组装请求）。 */
export const BRANCH_WRITE_KINDS: string[] = ['create', 'switch', 'detach', 'rename', 'delete', 'upstream', 'tag-create', 'tag-delete', 'verify', 'describe']

export interface BranchDecision {
  verdict: BranchVerdict
  reasons: BranchReasonId[]
}

function decide(verdict: BranchVerdict, reasons: BranchReasonId[]): BranchDecision {
  return { verdict: verdict, reasons: reasons.slice() }
}

/** 分支名的字面检查（不碰仓库）。返回 null 表示形状可用；返回理由标识符表示当场拒绝。
 *  这里只挡「会破坏 argv / 会被当选项 / git 明确不接受」的形状；更细的合法性由 git check-ref-format 复核。 */
export function branchNameProblem(name: string): BranchReasonId | null {
  const s: string = typeof name === 'string' ? name : ''
  if (!s || s.length > 255) return 'bad-branch-name'
  if (s.charAt(0) === '-' || s.charAt(0) === '+') return 'bad-branch-name'
  if (/[\s\u0000:\\]/.test(s)) return 'bad-branch-name'
  if (s.indexOf('..') >= 0 || s.indexOf('@{') >= 0) return 'bad-branch-name'
  if (s === '@') return 'bad-branch-name'
  if (s.charAt(s.length - 1) === '.') return 'bad-branch-name'
  if (s.charAt(0) === '/' || s.charAt(s.length - 1) === '/') return 'bad-branch-name'
  if (s.indexOf('//') >= 0) return 'bad-branch-name'
  return null
}

/** 标签名走与分支名同一套字面规则（git 的 ref 取名规则一致，只是前缀不同）。 */
export function tagNameProblem(name: string): BranchReasonId | null {
  const problem: BranchReasonId | null = branchNameProblem(name)
  return problem === null ? null : 'bad-tag-name'
}

/** 上游写法：必须是「远端名/分支名」，不许以 - 开头、不许空白与 NUL。 */
export function upstreamNameProblem(upstream: string): BranchReasonId | null {
  const s: string = typeof upstream === 'string' ? upstream : ''
  if (!s || s.charAt(0) === '-' || /[\s\u0000]/.test(s) || s.indexOf('/') <= 0) return 'bad-upstream'
  return null
}

/** 标签说明：附注与签名标签必须写说明；空说明的附注标签与轻量标签没有区别（research 1592 §1.5）。 */
export function tagMessageProblem(mode: string, message: string): BranchReasonId | null {
  const text: string = typeof message === 'string' ? message : ''
  if ((mode === 'annotated' || mode === 'signed') && !text.trim()) return 'missing-tag-message'
  if (text.length > 8192) return 'tag-message-too-long'
  return null
}

/** 分支说明：面板自己的上限 4 KB；NUL 直接拒（research 1592 §1.4）。 */
export function descriptionTextProblem(text: string): BranchReasonId | null {
  const s: string = typeof text === 'string' ? text : ''
  if (s.indexOf('\u0000') >= 0) return 'bad-description'
  if (s.length > 4096) return 'description-too-long'
  return null
}

/** 切分支的未保存改动保护：中途操作与未解决冲突直接拦；有未提交改动先提醒（git 自己能带过去才放行）。 */
export function decideBranchSwitch(screen: any): BranchDecision {
  const s: any = screen || {}
  if (s.merging === true || s.rebasing === true || s.cherryPicking === true || s.reverting === true) return decide('block', ['mid-operation'])
  if (typeof s.conflictCount === 'number' && s.conflictCount > 0) return decide('block', ['conflicts-unresolved'])
  const staged: number = typeof s.stagedCount === 'number' ? s.stagedCount : 0
  const unstaged: number = typeof s.unstagedCount === 'number' ? s.unstagedCount : 0
  if (staged + unstaged > 0) return decide('warn', ['unsaved-changes'])
  return decide('allow', ['ok'])
}

/** 删分支的保护：当前分支不能删；没并进来的提交要先强制确认；有未提交改动再提醒一次。 */
export function decideBranchDelete(input: any): BranchDecision {
  const o: any = input || {}
  if (o.current === true) return decide('block', ['cannot-delete-current'])
  if (o.merged !== true && o.force !== true) return decide('block', ['branch-not-merged'])
  const reasons: BranchReasonId[] = []
  if (o.merged !== true && o.force === true) reasons.push('force-delete')
  if (o.dirty === true) reasons.push('unsaved-changes')
  return reasons.length ? decide('warn', reasons) : decide('allow', ['ok'])
}

/** 新建分支：同名已经存在就拦。 */
export function decideBranchCreate(input: any): BranchDecision {
  const o: any = input || {}
  if (o.nameExists === true) return decide('block', ['branch-exists'])
  return decide('allow', ['ok'])
}

/** 建标签：同名存在、附注/签名缺说明都拦；签名依赖本机密钥，只提醒不假装能成。 */
export function decideTagCreate(input: any): BranchDecision {
  const o: any = input || {}
  if (o.exists === true) return decide('block', ['tag-exists'])
  const problem: BranchReasonId | null = tagMessageProblem(String(o.mode || 'light'), o.message === undefined || o.message === null ? '' : o.message)
  if (problem !== null) return decide('block', [problem])
  if (o.mode === 'signed') return decide('warn', ['signing-needs-key'])
  return decide('allow', ['ok'])
}

/** 写分支说明：分支要存在、文本要过形状检查。 */
export function decideDescriptionWrite(input: any): BranchDecision {
  const o: any = input || {}
  if (o.branchExists !== true) return decide('block', ['branch-missing'])
  const problem: BranchReasonId | null = descriptionTextProblem(o.text === undefined || o.text === null ? '' : o.text)
  if (problem !== null) return decide('block', [problem])
  return decide('allow', ['ok'])
}

/** 判定理由的中文句子（界面的禁用原因与它同源，不另写一份文案）。 */
export function branchReasonText(id: BranchReasonId): string {
  return BRANCH_REASONS[id] === undefined ? BRANCH_REASONS.ok : BRANCH_REASONS[id]
}

export const BRANCH_DECISIONS_SOURCE = 'src/shared/version-control/src/branch-decisions.ts'
