/**
 * src/shared/version-control/src/commit-plan.ts —— 提交能力（域 2）的参数口径与 git 参数拼装（纯函数，#1743）
 *
 * 为什么单独立这一份真源：
 *   · 八条提交能力（2.1–2.8）最后都落到同一条 git 命令的不同参数上；参数怎么拼只在这里定义。
 *     宿主预检（开票）、宿主执行（真正起进程）与界面（把计划显示给人看）读同一份，谁都不许再拼一遍。
 *   · argv 一律是字符串数组：每个开关、整段提交说明都是独立元素，绝不拼成一整行再交给 shell
 *     （规格第 8 节：argv 直传不经 shell）。
 *   · 危险动作（2.3 修订、2.4 fixup / squash）由 commitPlanDangerous 统一认出来；界面据此必须给
 *     确认卡与理由，不能因为某个开关没勾就放行。
 *
 * 字段含义：
 *   mode       staged=2.1 提交已暂存内容；all=2.2 连已跟踪改动一起提交；
 *              amend=2.3 修订上一条提交；fixup / squash=2.4 生成吸收进目标提交的提交。
 *   target     2.4 的目标提交（fixup / squash 必填；其余形态留空串，拼参数时忽略）。
 *   skipHooks  2.5 本次提交跳过 pre-commit / commit-msg 钩子（--no-verify），不设全局默认。
 *   sign       2.6 用本机签名配置给这次提交签名（-S）。
 *   signoff    2.6 只往提交说明尾部追加一行 Signed-off-by（-s）。它与 sign 是两件事，可各自单独勾。
 *
 * 约定（改这里之前先读）：
 *   1. 提交说明（含多行、含模板套用后的原文）只作为 -m 的**一个**参数元素，换行原样保留。
 *   2. 修订上一条提交而没写新说明时用 --no-edit：允许只改内容 / 作者信息，不逼人重写说明。
 *   3. fixup / squash 的说明由 git 自己写，不拼 -m。
 *   4. 参数次序固定：形态开关 → -S → -s → --no-verify → 说明。次序本身有断言（门禁逐元素比对
 *      argv），改次序要同步改 tests/verify-1586-commit-page.ts。
 */
export type CommitMode = 'staged' | 'all' | 'amend' | 'fixup' | 'squash'

/** 一次提交要做成什么样子：八条提交能力都归到这五个字段上（2.7 的多行说明就是 message 本身）。 */
export interface CommitPlan {
  mode: CommitMode
  target: string
  skipHooks: boolean
  sign: boolean
  signoff: boolean
}

/** 五种提交形态的固定名单；顺序即界面单选的次序。 */
export const VC_COMMIT_MODES: string[] = ['staged', 'all', 'amend', 'fixup', 'squash']

/** 形态 → 界面词条键：形态名全部走这一份，界面里不另写字符串。 */
export const VC_COMMIT_MODE_KEYS: Record<string, string> = {
  staged: 'vc.commit.mode.staged',
  all: 'vc.commit.mode.all',
  amend: 'vc.commit.mode.amend',
  fixup: 'vc.commit.mode.fixup',
  squash: 'vc.commit.mode.squash',
}

/** 形态 → 能力账本 id（2.1–2.4）：界面每颗控件用 data-cap-control 指向它服务的那一条能力。 */
export const VC_COMMIT_MODE_CAPS: Record<string, string> = {
  staged: '2.1',
  all: '2.2',
  amend: '2.3',
  fixup: '2.4',
  squash: '2.4',
}

/** 目标提交的允许形状：仓库里的引用写法（HEAD~1、abc1234、main^ 这类），不许以短横线开头。
 *  这是**外部输入**（客户端原样回传），形状不对当场拒，不起任何进程去问 git。 */
export const COMMIT_TARGET_PATTERN = /^[A-Za-z0-9._/@^~-]{1,120}$/

/** 什么都不勾、只提交暂存区内容：最常用也最安全的那一档。 */
export function commitPlanDefault(): CommitPlan {
  return { mode: 'staged', target: '', skipHooks: false, sign: false, signoff: false }
}

/** 把外部输入归一成计划：名单外的形态回落默认，布尔只认 true（'true' / 1 都不算）。
 *  归一而不是报错是有意的——形状不对的那部分由 commitPlanProblem 给一句人能读的理由，
 *  这样拼参数的人不必到处判空。 */
export function commitPlanOf(raw: any): CommitPlan {
  const r: any = raw && typeof raw === 'object' ? raw : {}
  const mode: string = String(r.mode === undefined || r.mode === null ? '' : r.mode)
  return {
    mode: (VC_COMMIT_MODES.indexOf(mode) >= 0 ? mode : 'staged') as CommitMode,
    target: String(r.target === undefined || r.target === null ? '' : r.target).trim(),
    skipHooks: r.skipHooks === true,
    sign: r.sign === true,
    signoff: r.signoff === true,
  }
}

/** 计划本身能不能执行：null 表示没问题，否则回一个写层理由（界面按同一个理由显示禁用原因）。 */
export function commitPlanProblem(raw: any): string | null {
  const p: CommitPlan = commitPlanOf(raw)
  if (p.target !== '' && (p.target.charAt(0) === '-' || !COMMIT_TARGET_PATTERN.test(p.target))) return 'bad-commit-target'
  if (p.mode === 'fixup' || p.mode === 'squash') {
    if (p.target === '') return 'need-commit-target'
  }
  return null
}

/** 这条计划是不是会改写历史的危险动作：修订上一条提交，或把本次改动吸收进别的提交。
 *  界面据此必须给确认卡（规格第 4 节），与开关勾没勾无关。 */
export function commitPlanDangerous(raw: any): boolean {
  const mode: string = commitPlanOf(raw).mode
  return mode === 'amend' || mode === 'fixup' || mode === 'squash'
}

/** 拼 git 参数（固定前缀之后的切片）：每个开关一个元素，提交说明也只占一个元素。 */
export function commitArgvOf(raw: any, message: any): string[] {
  const p: CommitPlan = commitPlanOf(raw)
  const msg: string = String(message === undefined || message === null ? '' : message)
  const argv: string[] = ['commit']
  if (p.mode === 'all') argv.push('-a')
  else if (p.mode === 'amend') argv.push('--amend')
  else if (p.mode === 'fixup') argv.push('--fixup=' + p.target)
  else if (p.mode === 'squash') argv.push('--squash=' + p.target)
  if (p.sign) argv.push('-S')
  if (p.signoff) argv.push('-s')
  if (p.skipHooks) argv.push('--no-verify')
  if (p.mode === 'fixup' || p.mode === 'squash') return argv
  if (p.mode === 'amend' && msg.trim() === '') {
    argv.push('--no-edit')
    return argv
  }
  argv.push('-m', msg)
  return argv
}

/** 追加签名行的原文（2.6 的 signoff 那一半）：确认卡要原样显示将写进说明末尾的这行字。
 *  身份缺失时回空串——界面据此说明「引用身份还没配置，这一行写不出来」。 */
export function commitTrailerOf(identity: any): string {
  const id: any = identity && typeof identity === 'object' ? identity : {}
  const name: string = String(id.name === undefined || id.name === null ? '' : id.name).trim()
  const email: string = String(id.email === undefined || id.email === null ? '' : id.email).trim()
  if (name === '' || email === '') return ''
  return 'Signed-off-by: ' + name + ' <' + email + '>'
}

export const COMMIT_PLAN_SOURCE = 'src/shared/version-control/src/commit-plan.ts'
