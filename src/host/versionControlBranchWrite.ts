// host/versionControlBranchWrite.ts —— 域 4（分支与标签）的凭票执行电话 wf.gitBranchWrite（#1746 T11 返工）
//
// 这一层只做一件事：凭预检签的票执行一次写命令。收进来的只有 ticketId、requestId 与动作参数；
//   动作参数只用来识别「这是哪件事」（op 与票对得上就行），真正拼 argv 的是票里保存的计划——客户端
//   再送一遍参数也不采信，改参数改不动要执行什么。
//
// 校验顺序（任何一步不过都零进程拒绝，spawns 不增加）：
//   ① requestId 重放：同一个 requestId 再回来，回同一份结果，不再起进程；
//   ② 票号/requestId 形状；③ 票不存在 → ticket-missing；④ 动作不符 → ticket-op-mismatch；
//   ⑤ 过期 → ticket-expired；⑥ 仓库不一致 → stale-repo；
//   ⑦ 按预检同一口径重算现场，绑定表逐格比对 → stale-index / target-changed（HEAD 漂、目标 oid 变、
//      上游或说明旧值变、工作区变脏、中途操作标记出现，都在这一步被拒）；
//   ⑧ 需要确认的动作（warn 与删分支/删标签）没带 confirmed:true → need-confirm；
//   ⑨ 唯一一次写命令；成功回结果并记住 requestId，重复请求回同一份。
//
// 失败一律用失败信封：kind 是环节，reason 是固定理由标识符，git 原话与环节/期望/实际放 extra 顶层；
//   写失败说清动没动（git 自己失败就什么都没动，原话照实回，不假装成功）。
import { tagDeleteArgs, tagCreateArgs, branchCreateArgs, branchCreateCheckoutArgs, branchSwitchArgs,
  branchSwitchCheckoutArgs, branchDetachArgs, branchDetachCheckoutArgs, branchRenameArgs, branchDeleteArgs,
  setUpstreamArgs, unsetUpstreamArgs, branchDescriptionSetArgs, branchDescriptionUnsetArgs } from '../shared/version-control/src/commands.js'
import { ticketPureVerdict, bindingsVerdict, requestIdProblem } from '../shared/version-control/src/write-ticket.js'
import { idShapeProblem } from '../shared/version-control/src/write-reasons.js'
import { BRANCH_TICKET_OPS } from '../shared/version-control/src/branch-ticket.js'
import { VC_BRANCH_WRITE_TIMEOUT_MS as WRITE_TIMEOUT_MS } from '../shared/time-config/src/values.js'

/** 写失败信封：error 里放环节与固定理由，git 原话/环节/期望/实际平铺在顶层（与改动页写层同一口径）。 */
function wfail(kind: string, reason: string, message: string, extra?: any): any {
  return Object.assign({ ok: false, error: { kind: kind, reason: reason, message: message }, reason: reason }, extra || {})
}
function firstLineOf(text: any): string {
  const s: string = String(text === undefined || text === null ? '' : text)
  const i: number = s.indexOf('\n')
  return (i < 0 ? s : s.slice(0, i)).trim()
}
/** 写失败按固定理由表归类（与改动页同一套：超时 / 冲突 / 钩子 / 权限 / 其它）。 */
function classifyFailure(sub: string, exitCode: any, stderr: any): string {
  const text: string = String(stderr || '').toLowerCase()
  if (text.indexOf('timed out') >= 0 || text.indexOf('timeout') >= 0) return 'unknown-write-failure'
  if (text.indexOf('conflict') >= 0) return 'conflicts-unresolved'
  if (text.indexOf('hook') >= 0) return 'hook-failed'
  if (text.indexOf('permission denied') >= 0 || text.indexOf('access denied') >= 0) return 'no-permission'
  if (text.indexOf('not a git repository') >= 0) return 'not-a-repo'
  void sub
  void exitCode
  return 'unknown-write-failure'
}

/** 造执行电话：返回 { handleBranchWrite, tickets, results }。票表与结果表由预检叶子注入，两边共用同一份。 */
export function createBranchWrite(deps: any): any {
  const d: any = deps || {}
  const runPinned: any = d.runPinned
  const resolveGitExecutable: any = d.resolveGitExecutable
  const measure: any = d.measure
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now
  const tickets: Map<string, any> = (d.tickets instanceof Map) ? d.tickets : new Map()
  const results: Map<string, any> = (d.results instanceof Map) ? d.results : new Map()

  /** 按票里的计划拼 argv：这里不判断业务语义，只把已经规范化过的参数逐个放进数组元素。 */
  function argvOf(plan: any): string[] {
    const tier: string = String(plan.tier || 'full')
    const op: string = String(plan.op || '')
    if (op === 'create') return tier === 'degraded' ? branchCreateCheckoutArgs(plan.name, plan.from || undefined) : branchCreateArgs(plan.name, plan.from || undefined)
    if (op === 'switch') return tier === 'degraded' ? branchSwitchCheckoutArgs(plan.name) : branchSwitchArgs(plan.name)
    if (op === 'detach') return tier === 'degraded' ? branchDetachCheckoutArgs(plan.rev) : branchDetachArgs(plan.rev)
    if (op === 'rename') return branchRenameArgs(plan.from, plan.to)
    if (op === 'delete') return branchDeleteArgs(plan.name, plan.force === true)
    if (op === 'upstream') return plan.unset === true ? unsetUpstreamArgs(plan.branch) : setUpstreamArgs(plan.upstream, plan.branch)
    if (op === 'tag-create') return tagCreateArgs(plan.name, plan.mode, plan.target || undefined, plan.message)
    if (op === 'tag-delete') return tagDeleteArgs(plan.name)
    return plan.text ? branchDescriptionSetArgs(plan.branch, plan.text) : branchDescriptionUnsetArgs(plan.branch)
  }
  function resultFields(op: string, plan: any, argv: string[]): any {
    if (op === 'create' || op === 'switch' || op === 'delete') return { branch: plan.name }
    if (op === 'detach') return { rev: plan.rev }
    if (op === 'rename') return { from: plan.from, to: plan.to }
    if (op === 'upstream') return { branch: plan.branch }
    if (op === 'tag-create' || op === 'tag-delete') return { tag: plan.name }
    return { branch: plan.branch, description: plan.text }
  }
  function remember(requestId: any, out: any): void {
    if (!requestId) return
    results.set(String(requestId), out)
    while (results.size > 500) { const k: any = results.keys().next().value; results.delete(k) }
  }

  /** 执行入口：顺序见文件头。 */
  async function handleBranchWrite(args: any): Promise<any> {
    const a: any = args || {}
    const requestId: string = String(a.requestId || '')
    // ① 重放：同一个 requestId 回同一份结果（成功与失败都重放，且不再起进程）。
    if (requestId && results.has(requestId)) {
      const prev: any = results.get(requestId)
      return { ok: prev && prev.ok === true, reused: true, result: prev }
    }
    const ticketId: string = String(a.ticketId || '')
    const op: string = String(a.op || '')
    const idProblem: any = idShapeProblem(ticketId)
    if (idProblem) return wfail('args', 'bad-target', '票号格式不合法：' + String(ticketId).slice(0, 80))
    const ridProblem: any = requestIdProblem(requestId)
    if (ridProblem) return wfail('args', ridProblem, 'requestId 格式不合法：只能用字母、数字、下划线与连字符，长度不超过 64')
    const ticket: any = tickets.get(ticketId)
    if (!ticket) return wfail('blocked', 'ticket-missing', '这张票不存在或已经被执行过：重新预检拿一张新票')
    if (String(ticket.op || '') !== op) return wfail('args', 'ticket-op-mismatch', '这张票不是为这个动作签的：重新预检')
    if (BRANCH_TICKET_OPS.indexOf(op) < 0) return wfail('args', 'bad-target', '这个动作不需要凭票执行：' + op)
    const pure: any = ticketPureVerdict(ticket, ticket.op, nowFn())
    if (!pure || pure.ok !== true) return wfail('blocked', String((pure && pure.reason) || 'ticket-expired'), '这张票已经过期或不能用：重新预检')
    if (ticket.confirmRequired === true && a.confirmed !== true) return wfail('need-confirm', 'need-confirm', '这个动作要先确认（确认卡上写清后果），确认后带 confirmed:true 再发一次', { decision: ticket.decision || null })
    const cwd: string = typeof a.cwd === 'string' && a.cwd.trim() !== '' ? a.cwd : ''
    if (!cwd) return wfail('args', 'bad-target', '缺少工作目录：执行必须说清在哪个仓库做')
    // ⑦ 按预检同一口径重算现场，逐格比对绑定表（HEAD、目标 oid、配置旧值、工作区脏不脏、中途操作标记）。
    const cur: any = await measure(cwd, ticket.plan)
    if (!cur || cur.ok !== true) return cur && cur.envelope ? cur.envelope : wfail('blocked', 'target-changed', '执行前读不回现场：这次不执行，先刷新')
    if (String(cur.repoRoot || '') !== String(ticket.repoRoot || '')) return wfail('blocked', 'stale-repo', '这张票不是给这个仓库签的：重新预检')
    if (String(cur.headOid || '') !== String(ticket.headOid || '')) return wfail('blocked', 'target-changed', '预检之后 HEAD 变了：这次不执行，重新预检')
    const bind: any = bindingsVerdict(ticket, cur.bindings)
    if (bind) return wfail('blocked', String(bind === 'stale-index' ? 'target-changed' : bind), '预检之后要动的东西变了（目标、旧值或工作区）：这次不执行，重新预检')
    // ⑨ 唯一一次写命令。
    const exe: any = await resolveGitExecutable()
    if (!exe) return wfail('env', 'env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    const plan: any = ticket.plan || {}
    const argv: string[] = argvOf(plan)
    const res: any = await runPinned(exe, cur.repoRoot, argv, { stdoutLimit: 8 * 1024 * 1024, timeoutMs: WRITE_TIMEOUT_MS })
    let out: any
    if (res.kind === 'ok') {
      out = Object.assign({ ok: true, op: op, kind: op, command: argv.slice(0, 3).join(' '), argv: argv, decision: ticket.decision || null, ticketId: ticketId, atMs: nowFn() }, resultFields(op, plan, argv))
    } else {
      const says: string = firstLineOf(String((res && res.stderr) || '').trim() !== '' ? res.stderr : (res && res.stdout))
      out = wfail('git-failed', classifyFailure(argv[0], res && res.exitCode, says), stepOf(op) + '失败：git 原话「' + says.slice(0, 400) + '」', {
        git: says.slice(0, 400), step: stepOf(op), expected: expectedOf(op, plan), actual: '退出码 ' + String(res && res.exitCode), cause: (res && res.kind) || '', exitCode: res && typeof res.exitCode === 'number' ? res.exitCode : null,
        decision: ticket.decision || null,
      })
    }
    remember(requestId, out)
    return out
  }
  function stepOf(op: string): string {
    if (op === 'create') return '新建并切换分支这一步'
    if (op === 'switch') return '切换分支这一步'
    if (op === 'detach') return '切到某个提交这一步'
    if (op === 'rename') return '重命名分支这一步'
    if (op === 'delete') return '删除分支这一步'
    if (op === 'upstream') return '设置上游这一步'
    if (op === 'tag-create') return '建标签这一步'
    if (op === 'tag-delete') return '删标签这一步'
    return '写分支说明这一步'
  }
  function expectedOf(op: string, plan: any): string {
    if (op === 'create') return '切到新分支 ' + String(plan.name || '')
    if (op === 'switch') return '当前分支变成 ' + String(plan.name || '')
    if (op === 'detach') return '头指针分离在 ' + String(plan.rev || '')
    if (op === 'delete') return '分支 ' + String(plan.name || '') + ' 被删除'
    if (op === 'tag-create') return '标签 ' + String(plan.name || '') + ' 建好'
    if (op === 'tag-delete') return '标签 ' + String(plan.name || '') + ' 被删除'
    return '这次写入生效'
  }

  return { handleBranchWrite: handleBranchWrite, tickets: tickets, results: results }
}

export const BRANCH_WRITE_SOURCE = 'src/host/versionControlBranchWrite.ts'
