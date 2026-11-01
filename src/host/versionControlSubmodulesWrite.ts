// host/versionControlSubmodulesWrite.ts —— 域 10（子模块）的执行电话 wf.gitSubmoduleWrite（#1757 T21）
//
// 三段式的第三段（规格第 4、8 节）：客户端拿着预检电话签出来的票号回来，这一叶先按票据门逐格核对，
// 全过才起一次 git 进程。票据门与仓库现场比对用的都是预检叶子那套 measure，不另读一遍（两套读法迟早对不上）。
//
// 核对顺序（照 #841 的先例，任何写命令之前必须先过票据门）：
//   1) requestId 形状与重放：同一个请求号回到同一份结果，不重复执行；
//   2) 票号形状 → 票在不在内存里 → 动作对不对 → 过期没有（ticketPureVerdict）；
//   3) 需要确认的动作必须收到 confirmed === true（界面确认卡点过确认）；
//   4) 重量现场：仓库根、HEAD、绑定表（计划摘要 / 目标旧配置 / 预检时确认不存在的路径）逐格比。
// 任何一格不符就回失败信封、零进程，理由标识符复用共享层 write-reasons 的那套（界面按族取词条）。
//
// 约定（改了会坏的地方）：
//   1) 除了这一条电话，子模块域没有第二条起写进程的路；argv 只从共享层 submoduleWriteArgsOf 取。
//   2) 不放宽成强制开关：票不新鲜就请用户重新看一眼，不替用户强推。
//   3) 吸收 .git 失败时不如实说「什么都没动」——git 可能已经移动了一部分目录，回执里把 git 原话带上，
//      并说明面板不会假装回滚（规格 2026-10-31 裁决）。
import { submoduleWriteArgsOf, SUBMODULE_WRITE_OPS } from '../shared/version-control/src/submodule-ops.js'
import { bindingsVerdict, requestIdProblem, ticketPureVerdict } from '../shared/version-control/src/write-ticket.js'
import { idShapeProblem, writeHintFor } from '../shared/version-control/src/write-reasons.js'
import { VC_SUBMODULE_WRITE_TIMEOUT_MS as WRITE_TIMEOUT_MS } from '../shared/time-config/src/values.js'

const STDOUT_LIMIT: number = 8 * 1024 * 1024

/** 回执里只放 git 的一句话原话：多行 stderr 整段倒进界面会让结果块没法读。 */
function firstLineOf(text: any): string {
  const s: string = String(text === undefined || text === null ? '' : text)
  const at: number = s.indexOf('\n')
  return (at >= 0 ? s.slice(0, at) : s).trim()
}

/** 子模块域自己的失败归类：只认这几条命令固定会说的话，认不出就如实回兜底（带 git 原话）。 */
function classifyFailure(op: string, exitCode: any, stderrText: any): string {
  const t: string = String(stderrText || '').toLowerCase()
  if (op === 'deinit' || op === 'sync' || op === 'absorb') {
    if (/not initialized|not yet initialized|has not been initialized/.test(t)) return 'submodule-not-initialized'
    if (/no such file or directory|not a git directory|does not exist/.test(t)) return 'submodule-not-found'
  }
  if (op === 'set-url' || op === 'set-branch') {
    if (/no such file or directory|not found|does not exist/.test(t)) return 'submodule-not-found'
  }
  if (/permission denied|read-only file system/.test(t)) return 'no-permission'
  return 'unknown-write-failure'
}

/** 造执行电话：返回 { handleGitSubmoduleWrite, tickets, results }。
 *  tickets/results 必须是预检叶子造的那两张（由装配壳传进来），本层不另造。 */
export function createSubmoduleWrite(deps: any): any {
  const d: any = deps || {}
  const failPhone: any = d.failPhone
  const runPinned: any = d.runPinned
  const resolveGitExecutable: any = d.resolveGitExecutable
  const measure: any = d.measure
  const tickets: Map<string, any> = d.tickets
  const results: Map<string, any> = d.results
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now

  // 失败信封固定 {ok:false, error:{kind, reason, message, hint}}（规格第 8 节，照 #1741/#1742 写层的同一形状）：
  // 界面按 reason 取词条，git 原话与环节等附加字段原样并在顶层。
  function wfail(kind: string, reason: string, message: string, extra?: any): any {
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

  async function handleGitSubmoduleWrite(args: any): Promise<any> {
    const req: any = args && typeof args === 'object' ? args : {}
    const requestId: string = String(req.requestId === undefined || req.requestId === null ? '' : req.requestId)
    if (requestId && results.has(requestId)) return results.get(requestId)
    const ticketId: string = String(req.ticketId === undefined || req.ticketId === null ? '' : req.ticketId)
    const idProblem: any = idShapeProblem(ticketId)
    if (idProblem) return wfail('ticket-missing', idProblem, '票号形状不对（界面应该原样回传预检给的票号）。请重新预检一次。')
    const ridProblem: any = requestIdProblem(requestId)
    if (ridProblem) return wfail('invalid-request', ridProblem, '请求号形状不对（只允许字母数字与下划线短横线）。请重新点一次。')
    const ticket: any = tickets.get(ticketId)
    if (!ticket) return wfail('ticket-missing', 'ticket-missing', '这张票已经不在了（宿主可能重启过，或已经点过一次）。请重新看一眼再点。')
    const op: string = String(req.op === undefined || req.op === null ? '' : req.op)
    if (SUBMODULE_WRITE_OPS.indexOf(op) < 0) return wfail('unknown-action', 'unknown-action', '这个动作不走执行电话（只有改地址、同步、改跟踪分支、取消登记、吸收 .git 这五条是直接在本地改配置的写动作）。')
    const verdict: any = ticketPureVerdict(ticket, op as any, nowFn())
    if (verdict.ok !== true) return wfail(verdict.reason, verdict.reason, '这张确认不能用了（' + String(verdict.reason) + '）。请重新看一眼再点。')
    if (ticket.confirmRequired === true && req.confirmed !== true) return wfail('need-confirm', 'confirm-required', '这个动作会动仓库里的东西，要先看一眼确认卡再点确认。')
    const plan: any = ticket.plan || {}
    const cur: any = await measure(String(req.cwd === undefined || req.cwd === null ? '' : req.cwd), plan)
    if (cur.ok !== true) return cur.envelope
    if (String(ticket.repoRoot || '') !== String(cur.repoRoot || '')) return wfail('stale-repo', 'stale-repo', '这张确认不是给这个仓库发的（换过工作区或目录）。请重新看一眼再点。')
    if (String(ticket.headOid || '') !== String(cur.headOid || '')) return wfail('target-changed', 'stale-head', '仓库在你确认之后又变了（当前提交已经不是你看的那一个）。请重新看一眼再点。')
    const bindProblem: any = bindingsVerdict(ticket, cur.bindings)
    if (bindProblem) return wfail('target-changed', bindProblem, '现场在确认之后变了（子模块的地址、跟踪分支或目录状态跟你看的不一样了）。请重新看一眼再点。')
    const argvRes: any = submoduleWriteArgsOf(op, plan)
    if (argvRes.ok !== true) return wfail('invalid-plan', argvRes.reason, argvRes.message)
    const exe: any = await resolveGitExecutable()
    if (!exe) return wfail('env', 'env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    const startedAt: number = nowFn()
    const res: any = await runPinned(exe, cur.repoRoot, argvRes.args, { stdoutLimit: STDOUT_LIMIT, timeoutMs: WRITE_TIMEOUT_MS })
    const ms: number = nowFn() - startedAt
    if (res.kind !== 'ok') {
      const said: string = firstLineOf(res.stderr) || firstLineOf(res.stdout)
      const reason: string = classifyFailure(op, res.exitCode, res.stderr)
      return wfail('git-failed', reason, '子模块动作没有成功：git 原话「' + said + '」。面板没有替你回滚，也没有用强制开关重试。', { git: said, step: '执行 ' + argvRes.args.slice(0, 2).join(' ') + ' 这一步', expected: 'git 成功退出（退出码 0）', actual: res.kind === 'non-zero' ? '退出码 ' + String(res.exitCode) : String(res.kind), cause: String((res && res.error && res.error.message) || res.kind || 'git 命令没有成功'), exitCode: res.exitCode, decision: ticket.decision })
    }
    const out: any = { ok: true, op: op, kind: 'git-submodule-write', command: argvRes.args.slice(0, 3).join(' '), argv: argvRes.args, decision: ticket.decision, ticketId: ticket.id, requestId: requestId, atMs: nowFn(), ms: ms, n: 1, path: plan.path }
    if (op === 'absorb') out.moves = [{ from: plan.absorbFrom || '', to: plan.absorbTo || '' }]
    return remember(requestId, out)
  }
  return { handleGitSubmoduleWrite: handleGitSubmoduleWrite, tickets: tickets, results: results }
}

export const SUBMODULE_WRITE_SOURCE = 'src/host/versionControlSubmodulesWrite.ts'
