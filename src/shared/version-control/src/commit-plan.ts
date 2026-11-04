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
 *   mode       staged=2.1 提交已暂存内容；amend=2.3 修订上一条提交；
 *              fixup / squash=2.4 生成吸收进上一条提交的提交。
 *   all        2.2 把已跟踪文件的未暂存改动也一起提交（git commit -a）。它是「这次提交收哪些内容」，
 *              与 mode「这次提交以什么形态记下来」是两件事：#1877 起界面把两者分开画（内容来源一组开关、
 *              提交形态一组按钮），所以计划里也必须是两个字段，不能再用「mode=all」冒充一种形态。
 *              旧客户端仍可能发 mode:'all'，commitPlanOf 会把它归一成「staged + all=true」。
 *   target     2.4 的吸收目标提交（只有 fixup / squash 用；界面按原型固定为「上一条提交」）。
 *   skipHooks  2.5 本次提交跳过 pre-commit / commit-msg 钩子（--no-verify），不设全局默认。
 *   sign       2.6 用本机签名配置给这次提交签名（-S）。
 *   signoff    2.6 只往提交说明尾部追加一行 Signed-off-by（-s）。它与 sign 是两件事，可各自单独勾。
 *
 * 约定（改这里之前先读）：
 *   1. 提交说明（含多行、含模板套用后的原文）只作为 -m 的**一个**参数元素，换行原样保留。
 *   2. 修订上一条提交而没写新说明时用 --no-edit：允许只改内容 / 作者信息，不逼人重写说明。
 *   3. fixup 的说明由 git 从目标提交抄，不拼 -m；squash 必须由人写一句，用 -m 传（执行层把
 *      GIT_EDITOR 钉成必定失败的 false，git 不会开编辑器等人输入）。
 *   4. 参数次序固定：-a → 形态开关 → -S → -s → --no-verify → 说明。次序本身有断言（门禁逐元素比对
 *      argv），改次序要同步改 tests/verify-1586-commit-page.ts。
 */
export type CommitMode = 'staged' | 'amend' | 'fixup' | 'squash'

/** 一次提交要做成什么样子：八条提交能力都归到这六个字段上（2.7 的多行说明就是 message 本身）。 */
export interface CommitPlan {
  mode: CommitMode
  all: boolean
  target: string
  skipHooks: boolean
  sign: boolean
  signoff: boolean
}

/** 四种提交形态的固定名单；顺序即界面单选的次序。2.2 不在这里：它是 all 开关，不是形态。 */
export const VC_COMMIT_MODES: string[] = ['staged', 'amend', 'fixup', 'squash']

/** 形态 → 界面词条键：形态名全部走这一份，界面里不另写字符串。 */
export const VC_COMMIT_MODE_KEYS: Record<string, string> = {
  staged: 'vc.commit.mode.staged',
  amend: 'vc.commit.mode.amend',
  fixup: 'vc.commit.mode.fixup',
  squash: 'vc.commit.mode.squash',
}

/** 形态 → 能力账本 id（2.3 / 2.4）：界面每颗形态按钮用 data-cap-control 指向它服务的那一条能力。
 *  2.1 的主入口是提交按钮本身（它不属于任何一种形态），2.2 是内容来源开关，2.7 是说明输入，
 *  2.8 是模板链接，各自带自己的编号，都不在这张表里。 */
export const VC_COMMIT_MODE_CAPS: Record<string, string> = {
  amend: '2.3',
  fixup: '2.4',
  squash: '2.4',
}

/** 目标提交的允许形状：仓库里的引用写法（HEAD~1、abc1234、main^ 这类），不许以短横线开头。
 *  这是**外部输入**（客户端原样回传），形状不对当场拒，不起任何进程去问 git。 */
export const COMMIT_TARGET_PATTERN = /^[A-Za-z0-9._/@^~-]{1,120}$/

/** 什么都不勾、只提交暂存区内容：最常用也最安全的那一档。 */
export function commitPlanDefault(): CommitPlan {
  return { mode: 'staged', all: false, target: '', skipHooks: false, sign: false, signoff: false }
}

/** 把外部输入归一成计划：名单外的形态回落 staged，布尔只认 true（'true' / 1 都不算）。
 *  归一而不是报错是有意的——形状不对的那部分由 commitPlanProblem 给一句人能读的理由，
 *  这样拼参数的人不必到处判空。
 *  兼容一条历史口径：mode:'all' 曾是「提交全部已跟踪改动」这一种形态；它是 2.2 的旧说法，
 *  现在等价于「staged 形态 + all 开关打开」，避免旧客户端发来的计划在界面上丢了这一项。 */
export function commitPlanOf(raw: any): CommitPlan {
  const r: any = raw && typeof raw === 'object' ? raw : {}
  const mode: string = String(r.mode === undefined || r.mode === null ? '' : r.mode)
  const legacyAll: boolean = mode === 'all'
  const form: string = VC_COMMIT_MODES.indexOf(mode) >= 0 ? mode : 'staged'
  return {
    mode: form as CommitMode,
    all: legacyAll || r.all === true,
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

/** 计划对预检判定的修正：规则层的 judgeCommit 只认「有没有暂存内容」，
 *  但 -a 与只改说明的修订并不要求先暂存——这里按形态与内容来源把判定调整成人能理解的样子。
 *  判定唯一真源仍是 rules.judge：这里只增删理由，不另写一套放行/拦截的规则。
 *  返回 { verdict, reasons }，界面据此显示禁用原因，宿主预检据此回 blocked / allow，
 *  两边读同一份结果，禁用理由与判定不会各说各话。 */
export function commitDecisionOf(decision: any, plan: any, screen: any): any {
  const verdict: string = (decision && decision.verdict) ? String(decision.verdict) : 'block'
  const reasons: any[] = Array.isArray(decision && decision.reasons) ? decision.reasons.slice() : []
  const hasHead: boolean = !(screen && screen.repo && screen.repo.hasCommits === false)
  const without = function (item: any): any[] { return reasons.filter(function (x: any): boolean { return x !== item }) }
  if (plan && plan.mode === 'amend') {
    // 只改说明的修订不需要暂存内容；分支还没有提交时换成更具体的 nothing-to-amend。
    const left: any[] = without('nothing-staged')
    if (!hasHead) return { verdict: 'block', reasons: left.concat(['nothing-to-amend']) }
    if (left.length === 0) return { verdict: 'allow', reasons: ['ok'] }
    return { verdict: (verdict === 'warn') ? 'warn' : (verdict === 'allow' ? 'allow' : 'block'), reasons: left }
  }
  if (plan && plan.all === true) {
    // 2.2 一起提交：-a 不要求暂存区有东西；工作区里一处改动都没有时仍然挡住。
    const changes: number = Number(screen && screen.stagedCount ? screen.stagedCount : 0) + Number(screen && screen.unstagedCount ? screen.unstagedCount : 0)
    const left: any[] = (changes > 0) ? without('nothing-staged') : reasons
    if (left.length === 0) return { verdict: 'allow', reasons: ['ok'] }
    return { verdict: (verdict === 'warn') ? 'warn' : (verdict === 'allow' ? 'allow' : 'block'), reasons: left }
  }
  return decision
}

/** 这条计划是不是会改写历史的危险动作：修订上一条提交，或把本次改动吸收进别的提交。
 *  界面据此必须给确认卡（规格第 4 节），与开关勾没勾无关。 */
export function commitPlanDangerous(raw: any): boolean {
  const mode: string = commitPlanOf(raw).mode
  return mode === 'amend' || mode === 'fixup' || mode === 'squash'
}

/** 拼 git 参数（固定前缀之后的切片）：每个开关一个元素，提交说明也只占一个元素。
 *  -a 排在最前（它是内容来源，不是形态）；形态开关其次；三个记录方式再按固定次序；
 *  fixup 的说明由 git 从目标提交抄（这里不带 -m）；squash 必须由人写一句（git 会开编辑器要说明，
 *  而执行层把编辑器钉成必定失败，所以说明只能走 -m 传进去）。 */
export function commitArgvOf(raw: any, message: any): string[] {
  const p: CommitPlan = commitPlanOf(raw)
  const msg: string = String(message === undefined || message === null ? '' : message)
  const argv: string[] = ['commit']
  if (p.all) argv.push('-a')
  if (p.mode === 'amend') argv.push('--amend')
  else if (p.mode === 'fixup') argv.push('--fixup=' + p.target)
  else if (p.mode === 'squash') argv.push('--squash=' + p.target)
  if (p.sign) argv.push('-S')
  if (p.signoff) argv.push('-s')
  if (p.skipHooks) argv.push('--no-verify')
  if (p.mode === 'fixup') return argv
  if (p.mode === 'amend' && msg.trim() === '') {
    argv.push('--no-edit')
    return argv
  }
  argv.push('-m', msg)
  return argv
}

/** 这条提交最终写进去的说明：fixup / squash 由面板按前缀自动写成（人不用手写，也不该改写），
 *  其余形态用调用方给的原文。界面（显示自动说明、判「说明填没填」）与动作层（发预检与执行电话）
 *  读同一份，避免两边各拼一遍前缀、迟早写得不一样。 */
export function commitAutoMessageOf(raw: any, head: any): string {
  const mode: string = commitPlanOf(raw).mode
  if (mode !== 'fixup' && mode !== 'squash') return ''
  const subject: string = String((head && head.subject) || '')
  if (subject === '') return ''
  return (mode === 'fixup' ? 'fixup!' : 'squash!') + ' ' + subject
}

/** 修订时预填进输入框的原文：上一条提交的完整说明（没有说明时退回主题）。
 *  同一个口径也用来判「说明与上一条完全一样」——两处若各写各的，多行说明就永远判不出「没改」。 */
export function commitAmendMessageOf(head: any): string {
  const h: any = head || {}
  return String(h.message || h.subject || '')
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
