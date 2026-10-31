// host/versionControlSubmodulesTask.ts —— 域 10（子模块）的长任务电话 wf.gitSubmoduleTask（#1757 T21）
//
// 为什么子模块还有一条单独的任务电话：规格第 5 节把「子模块初始化与更新」列进长任务通道，10.2 新增、
// 10.3 初始化并检出、逐行更新到记录的提交/远端最新、逐个抓取都走 wf.gitTaskStart 那一套（进度、取消、
// 残留说明）。但任务 API 不认票据（长任务不占 120 秒票据时限），而本票要求这四个动作先过与写动作同一套
// 预检：这一叶就是「票 → 任务」的转换层，负责核对票据与现场，再调宿主的 taskStart 真正起任务。
//
// 约定（改了会坏的地方）：
//   1) 任务参数只从票据里的计划算（submoduleTaskOf），客户端传来的参数一个都不采信；
//   2) 任务动作必须带 confirm: true —— 长任务运行器自己会拒，但这里先给出同一句话，免得用户看到两种口径；
//   3) 同一个 requestId 回到同一份回包（任务本身有 requestId 去重，这层再挡一次重复拨号）。
import { submoduleTaskOf, SUBMODULE_TASK_OPS } from '../shared/version-control/src/submodule-ops.js'
import { bindingsVerdict, requestIdProblem, ticketPureVerdict } from '../shared/version-control/src/write-ticket.js'
import { idShapeProblem, writeHintFor } from '../shared/version-control/src/write-reasons.js'

/** 造任务电话：返回 { handleGitSubmoduleTask, tickets, results }。taskStart 由宿主传进来（就是长任务通道的 start）。 */
export function createSubmoduleTask(deps: any): any {
  const d: any = deps || {}
  const failPhone: any = d.failPhone
  const measure: any = d.measure
  const taskStart: any = d.taskStart
  const tickets: Map<string, any> = d.tickets
  const results: Map<string, any> = d.results
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now

  // 失败信封与执行叶子同形（规格第 8 节）：reason 供界面取词条，附加字段并在顶层。
  function tfail(kind: string, reason: string, message: string, extra?: any): any {
    const base: any = failPhone(kind, message, Object.assign({ reason: reason }, extra || {}))
    base.error = { kind: kind, reason: reason, message: message, hint: writeHintFor(reason) }
    return base
  }
  function remember(requestId: string, out: any): any {
    if (!requestId) return out
    results.set(requestId, out)
    while (results.size > 500) { const oldest: any = results.keys().next().value; results.delete(oldest) }
    return out
  }

  async function handleGitSubmoduleTask(args: any): Promise<any> {
    const req: any = args && typeof args === 'object' ? args : {}
    const requestId: string = String(req.requestId === undefined || req.requestId === null ? '' : req.requestId)
    if (requestId && results.has(requestId)) return results.get(requestId)
    const ticketId: string = String(req.ticketId === undefined || req.ticketId === null ? '' : req.ticketId)
    const idProblem: any = idShapeProblem(ticketId)
    if (idProblem) return tfail('ticket-missing', idProblem, '票号形状不对（界面应该原样回传预检给的票号）。请重新预检一次。')
    const ridProblem: any = requestIdProblem(requestId)
    if (ridProblem) return tfail('invalid-request', ridProblem, '请求号形状不对（只允许字母数字与下划线短横线）。请重新点一次。')
    const ticket: any = tickets.get(ticketId)
    if (!ticket) return tfail('ticket-missing', 'ticket-missing', '这张票已经不在了（宿主可能重启过，或已经点过一次）。请重新看一眼再点。')
    const op: string = String(req.op === undefined || req.op === null ? '' : req.op)
    if (SUBMODULE_TASK_OPS.indexOf(op) < 0) return tfail('unknown-action', 'unknown-action', '这个动作不走任务通道（只有新增、初始化并检出、更新到记录的提交、更新到远端最新、逐个抓取这五条是长任务）。')
    const plan: any = ticket.plan || {}
    if (plan.kind !== 'task') return tfail('unknown-action', 'unknown-action', '这张票不是给长任务签的。请重新看一眼再点。')
    const verdict: any = ticketPureVerdict(ticket, op as any, nowFn())
    if (verdict.ok !== true) return tfail(verdict.reason, verdict.reason, '这张确认不能用了（' + String(verdict.reason) + '）。请重新看一眼再点。')
    if (req.confirmed !== true) return tfail('need-confirm', 'confirm-required', '这个动作会动子模块目录或联网获取，要先看一眼确认卡再点确认。')
    const cur: any = await measure(String(req.cwd === undefined || req.cwd === null ? '' : req.cwd), plan)
    if (cur.ok !== true) return cur.envelope
    if (String(ticket.repoRoot || '') !== String(cur.repoRoot || '')) return tfail('stale-repo', 'stale-repo', '这张确认不是给这个仓库发的（换过工作区或目录）。请重新看一眼再点。')
    if (String(ticket.headOid || '') !== String(cur.headOid || '')) return tfail('target-changed', 'stale-head', '仓库在你确认之后又变了（当前提交已经不是你看的那一个）。请重新看一眼再点。')
    const bindProblem: any = bindingsVerdict(ticket, cur.bindings)
    if (bindProblem) return tfail('target-changed', bindProblem, '现场在确认之后变了（子模块的地址、跟踪分支或目录状态跟你看的不一样了）。请重新看一眼再点。')
    const task: any = ticket.task || submoduleTaskOf(plan.action, plan)
    if (!task || task.ok !== true) return tfail('invalid-plan', (task && task.reason) || 'unknown-action', (task && task.message) || '这个动作算不出要跑的 git 参数')
    const start: any = await taskStart({ cwd: cur.repoRoot, op: task.op, args: task.args, confirm: true, requestId: requestId })
    const out: any = Object.assign({}, start || {}, { op: plan.action, ticketId: ticket.id, requestId: requestId })
    return remember(requestId, out)
  }
  return { handleGitSubmoduleTask: handleGitSubmoduleTask, tickets: tickets, results: results }
}

export const SUBMODULE_TASK_SOURCE = 'src/host/versionControlSubmodulesTask.ts'
