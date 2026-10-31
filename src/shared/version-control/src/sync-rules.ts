// 版本管理「同步」动作的现场判定与确认文案（#1755 T19，域 8 的 8.5–8.14）。
//
// 这个文件和 sync-actions.ts 一样故意零 import：共享层同层互相 import 会被依赖门禁拦下。
// 判定只吃宿主归一好的现场（scene），不自己去读仓库 —— 读现场与起进程是宿主的事。
// 判定结论只有三种：allow（可以直接执行）、warn（要用户确认，确认卡四段由 syncConfirmOf 给出）、
// block（禁用；原因写进 reasons，界面常驻展示，不许点得动）。
//
// 改之前先读：
// - 所有同步动作都是写动作，所以默认 needsConfirm 为真；fetch 也走确认，因为它在本地对象库落东西。
// - 强推没有租约基准一律 block（baseline-missing / force-lease-required），这是 ADR 与票面写死的红线。
// - delete-current 与 dirty-tree 只是提醒，不拦人；其余原因都是硬拦。

export const SYNC_RULES_SOURCE = 'src/shared/version-control/src/sync-rules.ts'

// 稳定的原因短名 → 给人看的一句中文。界面与宿主都用同一份，不许各处自己编。
export const SYNC_REASONS: any = {
  ok: '现场允许执行',
  'unknown-action': '不认识的同步动作，界面没有登记它',
  'bare-repo': '当前目录是裸仓库，没有工作区，同步动作无处落地',
  'detached-head': '当前不在任何分支上（分离头指针），先切回分支再同步',
  'mid-operation': '仓库停在未完成的合并、变基、拣选或回滚里，先处理完再同步',
  'no-remote': '仓库里没有这个远端，先在远端与同步页登记它',
  'conflicts-unresolved': '工作区还有未解决的冲突，先解决冲突再拉取',
  'upstream-gone': '上游分支在远端已经不存在，先重新设置上游',
  'baseline-missing': '远端分支现在读不到，强推没有可用的租约基准',
  'baseline-bad': 'ls-remote 读回来的提交号不能作为租约基准',
  'force-lease-required': '强推必须带显式租约，不接受没有基准的强推',
  'delete-current': '这个分支正是当前检出分支，删除远端同名分支前先确认',
  'dirty-tree': '工作区有未提交的改动，拉取变基前先处理',
  'bad-plan': '这个动作的计划不完整，缺了必填的目标'
}

const BLOCKING: any = {
  'unknown-action': true,
  'bare-repo': true,
  'detached-head': true,
  'mid-operation': true,
  'no-remote': true,
  'conflicts-unresolved': true,
  'upstream-gone': true,
  'baseline-missing': true,
  'baseline-bad': true,
  'force-lease-required': true,
  'bad-plan': true
}

export function syncReasonTextOf(reason: any): string {
  const id = String(reason === undefined || reason === null ? '' : reason)
  const text = SYNC_REASONS[id]
  return typeof text === 'string' ? text : '未知原因：' + id
}

function pushReason(list: string[], reason: string): void {
  if (list.indexOf(reason) < 0) list.push(reason)
}

// scene 由宿主归一：{ bare, detached, currentBranch, midOperation, conflicts, dirty, remotes, upstreamGone }
export function judgeSync(scene: any, plan: any): any {
  const s = scene === undefined || scene === null ? {} : scene
  const reasons: string[] = []
  if (!plan || typeof plan.action !== 'string') {
    pushReason(reasons, 'bad-plan')
    return { decision: 'block', reasons: reasons, blockingReasons: reasons.slice(), warningReasons: [], confirmRequired: false }
  }
  const action = plan.action
  const isFetch = action === 'fetch'
  if (s.bare === true) pushReason(reasons, 'bare-repo')
  if (!isFetch && s.detached === true) pushReason(reasons, 'detached-head')
  if (!isFetch && s.midOperation === true) pushReason(reasons, 'mid-operation')
  // 远端清单有两种状态必须分开：remotesKnown===false 表示「这次没读到」；读到空数组表示「一个远端都没有」。
  // 后者照样要 block——空清单上 push 注定失败，不能拿空数组兼表「没读」而放过。
  const remotes = Array.isArray(s.remotes) ? s.remotes : []
  if (s.remotesKnown !== false && plan.remote && remotes.indexOf(plan.remote) < 0) pushReason(reasons, 'no-remote')
  if (action === 'pull-merge' || action === 'pull-rebase' || action === 'pull-ff-only') {
    if (s.conflicts === true) pushReason(reasons, 'conflicts-unresolved')
    if (s.upstreamGone === true) pushReason(reasons, 'upstream-gone')
  }
  if (action === 'force-push') {
    if (typeof plan.leaseOid !== 'string' || plan.leaseOid === '') pushReason(reasons, 'force-lease-required')
    else if (!/^[0-9a-fA-F]{7,64}$/.test(plan.leaseOid)) pushReason(reasons, 'baseline-bad')
  }
  const blocking: string[] = []
  const warning: string[] = []
  for (let i = 0; i < reasons.length; i = i + 1) {
    if (BLOCKING[reasons[i]] === true) blocking.push(reasons[i])
    else warning.push(reasons[i])
  }
  if (action === 'delete-remote-ref' && s.currentBranch && plan.branch && plan.branch === s.currentBranch) pushReason(warning, 'delete-current')
  if ((action === 'pull-merge' || action === 'pull-rebase') && s.dirty === true) pushReason(warning, 'dirty-tree')
  const decision = blocking.length > 0 ? 'block' : warning.length > 0 ? 'warn' : plan.needsConfirm === true ? 'warn' : 'allow'
  // confirmRequired 只表示「界面要不要弹确认卡」：block 不弹（只显示理由），warn 弹，allow 不弹。
  return { decision: decision, reasons: blocking.concat(warning), blockingReasons: blocking, warningReasons: warning, confirmRequired: decision === 'warn' }
}

function verbOf(action: any): string {
  if (action === 'fetch') return '获取'
  if (action === 'pull-merge' || action === 'pull-rebase' || action === 'pull-ff-only') return '拉取'
  if (action === 'delete-remote-ref') return '删除远端引用'
  if (action === 'force-push') return '强推'
  if (action === 'atomic-push') return '原子推送'
  if (action === 'push-tags') return '推送标签'
  if (action === 'push-upstream') return '推送并设置上游'
  return '推送'
}

function shortOid(oid: any): string {
  const text = typeof oid === 'string' ? oid : ''
  return text.length > 12 ? text.slice(0, 12) : text
}

// 确认卡四段：会动什么 / 不会动什么 / 可逆性与恢复路径 / 动词写后果。
// extra 里带 oldOid（ls-remote 读到的远端当前位置）与 newOid（本地准备推上去的提交号），强推卡必须点名这两个号。
export function syncConfirmOf(plan: any, extra?: any): any {
  const e = extra === undefined || extra === null ? {} : extra
  const action = plan && typeof plan.action === 'string' ? plan.action : ''
  const verb = verbOf(action)
  let target = plan && typeof plan.targetText === 'string' ? plan.targetText : ''
  if (action === 'force-push') {
    const remote = plan && typeof plan.remote === 'string' ? plan.remote : 'origin'
    const branch = plan && typeof plan.branch === 'string' ? plan.branch : ''
    target = '远端分支 ' + remote + '/' + branch + '（远端现在是 ' + shortOid(e.oldOid) + '，准备推成 ' + shortOid(e.newOid) + '）'
  }
  let what = ''
  let wont = ''
  let reversible = ''
  if (action === 'fetch') {
    what = '会从远端 ' + (plan && plan.remote ? plan.remote : 'origin') + ' 取回新对象，并更新本地记录下来的远端跟踪引用。'
    wont = '不会合并进当前分支，也不会改动工作区文件。'
    reversible = '可取回的内容留在本地对象库里，重新获取不会重复下载全部内容。'
  } else if (action === 'pull-merge' || action === 'pull-rebase' || action === 'pull-ff-only') {
    const mode = action === 'pull-rebase' ? '变基' : action === 'pull-ff-only' ? '只快进' : '合并'
    what = '会先把远端更新取回来，再以' + mode + '方式并入当前分支' + (plan && plan.upstream ? '（上游 ' + plan.upstream + '）' : '') + '。'
    wont = '不会自动解决冲突；冲突会停下并如实报告，也不会丢弃你未提交的改动。'
    reversible = action === 'pull-rebase' ? '变基可用 reflog 找回原来的提交；冲突留在工作区等你手动处理。' : '合并结果可以用 git reset 回到合并前的提交；冲突留在工作区等你手动处理。'
  } else if (action === 'delete-remote-ref') {
    const kind = plan && plan.refKind === 'tag' ? '标签' : '分支'
    what = '会删除远端 ' + (plan ? plan.remote : 'origin') + ' 上的' + kind + ' ' + (plan && plan.ref ? plan.ref : '') + '。'
    wont = '不会删除本地同名' + kind + '，也不会改动工作区。'
    reversible = kind === '标签' ? '删掉后可以重新推送同一个标签指回原对象。' : '删掉后如果还记得原提交号，可以重新推送该引用指回原提交；否则只能等本地还有记录时恢复。'
  } else if (action === 'force-push') {
    what = '会把' + target + '，用租约确认远端没有在你预检之后被别人改动过。'
    wont = '不会在没有租约的情况下强推，也不会覆盖你预检之后才出现的远端新提交（租约对不上会直接失败）。'
    reversible = '远端原来的提交号写在确认卡里；推错时可以按这个号用同样的租约强推回去。'
  } else if (action === 'atomic-push') {
    what = '会把本地分支' + (plan && plan.localBranch ? ' ' + plan.localBranch : '') + ' 原子地推到' + target + '：所有引用要么全成，要么全不成。'
    wont = '不会只成功一半；任何一条引用被拒绝时，其余引用也不会落下去。'
    reversible = '远端没收到就什么也没变；收到后可以按远端新提交号回退。'
  } else if (action === 'push-tags') {
    what = '会把标签推到' + target + '。'
    wont = '不会改动分支，也不会删除远端已有标签。'
    reversible = '推错的标签可以删掉重推；远端指针记录会留在面板里。'
  } else if (action === 'push-upstream') {
    what = '会把本地分支推到' + target + '，并把本地分支的上游设为它。'
    wont = '不会改动其他分支，也不会强推覆盖远端已有提交。'
    reversible = '推送被拒时什么也不会变；成功后可随时用上游信息拉回。'
  } else {
    what = '会把本地分支推到' + target + '。'
    wont = '不会强推覆盖远端已有提交，也不会改动其他分支。'
    reversible = '推送被拒时什么也不会变；成功后可随时用上游信息拉回。'
  }
  return { verb: verb, target: target, what: what, wont: wont, reversible: reversible }
}
