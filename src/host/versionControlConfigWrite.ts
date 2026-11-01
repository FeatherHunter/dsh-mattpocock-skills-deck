// host/versionControlConfigWrite.ts —— 域 12（配置与钩子）的凭票执行电话 wf.gitConfigWrite（#1760 T24）
//
// 这一层只做一件事：凭预检签的票执行一次写命令。收进来的只有 ticketId、requestId、op 与 confirmed；
//   真正拼 argv 的是票里保存的计划——客户端再送一遍 key/value/scope/name 也不采信，改参数改不动要执行什么。
//
// 校验顺序（任何一步不过都零进程拒绝，spawns 不增加）：
//   ① requestId 重放：同一个 requestId 再回来，回同一份结果，不再起进程；
//   ② 票号 / requestId 形状；③ 票不存在 → ticket-missing；④ 动作不符 → ticket-op-mismatch；
//   ⑤ 过期 → ticket-expired；⑥ 动作不在本域三个写动作里 → bad-target；
//   ⑦ 需要确认的动作（删配置、手动跑钩子）没带 confirmed:true → need-confirm；
//   ⑧ 按预检同一口径重算现场，仓库、HEAD、旧值/钩子文件摘要逐格比对 → stale-repo / target-changed；
//      删配置时现场已经没有这个值 → config-missing（不猜、不空跑一次 git config --unset）；
//   ⑨ 唯一一次写命令。
//
// 手动跑钩子（12.6）与两条配置写动作的失败语义不同，这里刻意分开：
//   · 配置写动作非零退出 = 写入失败，走失败信封（git 原话、环节、期望、实际都照实回）；
//   · 手动跑钩子非零退出 = 钩子自己报告失败，这是运行结论而不是这次电话失败：照样回 ok:true，
//     带 hookFailed:true 与退出码、输出，界面照实显示「钩子跑了，退出码非零」。起不了进程、超时、
//     读不全才是真失败。
import { configSetArgs, configUnsetArgs, hookRunArgs } from '../shared/version-control/src/commands.js'
import { ticketPureVerdict, bindingsVerdict, requestIdProblem } from '../shared/version-control/src/write-ticket.js'
import { idShapeProblem } from '../shared/version-control/src/write-reasons.js'
import { CONFIG_WRITE_OPS } from '../shared/version-control/src/config-rules.js'
import { VC_CONFIG_WRITE_TIMEOUT_MS as WRITE_TIMEOUT_MS, VC_HOOK_RUN_TIMEOUT_MS as HOOK_TIMEOUT_MS } from '../shared/time-config/src/values.js'

/** 写失败信封：error 里放环节与固定理由，git 原话/环节/期望/实际平铺在顶层（与分支域写层同一口径）。 */
function wfail(kind: string, reason: string, message: string, extra?: any): any {
  return Object.assign({ ok: false, error: { kind: kind, reason: reason, message: message }, reason: reason }, extra || {})
}
function firstLineOf(text: any): string {
  const s: string = String(text === undefined || text === null ? '' : text)
  const i: number = s.indexOf('\n')
  return (i < 0 ? s : s.slice(0, i)).trim()
}

/** 造执行电话：返回 { handleConfigWrite, tickets, results }。票表与结果表由预检叶子注入，两边共用同一份。 */
export function createConfigWrite(deps: any): any {
  const d: any = deps || {}
  const runPinned: any = d.runPinned
  const resolveGitExecutable: any = d.resolveGitExecutable
  const measure: any = d.measure
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now
  const tickets: Map<string, any> = (d.tickets instanceof Map) ? d.tickets : new Map()
  const results: Map<string, any> = (d.results instanceof Map) ? d.results : new Map()

  /** 按票里的计划拼 argv：只把已经规范化过的参数逐个放进数组元素，不判断业务语义。 */
  function argvOf(plan: any): string[] {
    const op: string = String(plan.op || '')
    if (op === 'config-set') return configSetArgs(plan.key, plan.value, plan.scope)
    if (op === 'config-unset') return configUnsetArgs(plan.key, plan.scope)
    return hookRunArgs(plan.name)
  }
  function stepOf(op: string): string {
    if (op === 'config-set') return '写配置这一步'
    if (op === 'config-unset') return '删配置这一步'
    return '手动跑钩子这一步'
  }
  function expectedOf(op: string, plan: any): string {
    if (op === 'config-set') return '配置项 ' + String(plan.key || '') + '（' + String(plan.scope || 'local') + '）变成新值'
    if (op === 'config-unset') return '配置项 ' + String(plan.key || '') + '（' + String(plan.scope || 'local') + '）被删掉'
    return '钩子 ' + String(plan.name || '') + ' 跑完并回退出码'
  }
  function remember(requestId: any, out: any): void {
    if (!requestId) return
    results.set(String(requestId), out)
    while (results.size > 500) { const k: any = results.keys().next().value; results.delete(k) }
  }
  /** 钩子输出：stdout 与 stderr 都照实带，界面按块显示；截断标记随之回，不假装完整。 */
  function hookOutputOf(res: any): any {
    const out: string = String((res && res.stdout) || '')
    const err: string = String((res && res.stderr) || '')
    const both: string = out + (out !== '' && err !== '' ? '\n' : '') + err
    return { output: both.length > 2 * 1024 * 1024 ? both.slice(0, 2 * 1024 * 1024) : both, truncated: res && res.truncated === true }
  }

  /** 执行入口：顺序见文件头。 */
  async function handleConfigWrite(args: any): Promise<any> {
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
    if (CONFIG_WRITE_OPS.indexOf(op) < 0) return wfail('args', 'bad-target', '这个动作不需要凭票执行：' + op)
    const pure: any = ticketPureVerdict(ticket, ticket.op, nowFn())
    if (!pure || pure.ok !== true) return wfail('blocked', String((pure && pure.reason) || 'ticket-expired'), '这张票已经过期或不能用：重新预检')
    if (ticket.confirmRequired === true && a.confirmed !== true) return wfail('need-confirm', 'need-confirm', '这个动作要先确认（确认卡上写清后果），确认后带 confirmed:true 再发一次', { decision: { verdict: 'allow', reasons: ['ok'] } })
    const cwd: string = typeof a.cwd === 'string' && a.cwd.trim() !== '' ? a.cwd : ''
    if (!cwd) return wfail('args', 'bad-target', '缺少工作目录：执行必须说清在哪个仓库做')
    // ⑧ 按预检同一口径重算现场，逐格比对绑定表（HEAD、旧值/钩子文件摘要、仓库）。
    const cur: any = await measure(cwd, ticket.plan || {})
    if (!cur || cur.ok !== true) return cur && cur.envelope ? cur.envelope : wfail('blocked', 'target-changed', '执行前读不回现场：这次不执行，先刷新')
    if (String(cur.repoRoot || '') !== String(ticket.repoRoot || '')) return wfail('blocked', 'stale-repo', '这张票不是给这个仓库签的：重新预检')
    if (String(cur.headOid || '') !== String(ticket.headOid || '')) return wfail('blocked', 'target-changed', '预检之后 HEAD 变了：这次不执行，重新预检')
    const bind: any = bindingsVerdict(ticket, cur.bindings)
    if (bind) return wfail('blocked', String(bind === 'stale-index' ? 'target-changed' : bind), '预检之后要动的东西变了（旧值或钩子文件）：这次不执行，重新预检')
    const e: any = (cur.facts || {})
    if (op === 'config-unset' && (e.oldValue === null || e.oldValue === undefined)) return wfail('blocked', 'config-missing', '预检之后这个值已经被删掉了：刷新配置页再操作')
    // ⑨ 唯一一次写命令。
    const exe: any = await resolveGitExecutable()
    if (!exe) return wfail('env', 'env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    const plan: any = ticket.plan || {}
    const argv: string[] = argvOf(plan)
    const timeoutMs: number = op === 'hook-run' ? HOOK_TIMEOUT_MS : WRITE_TIMEOUT_MS
    const res: any = await runPinned(exe, cur.repoRoot, argv, { stdoutLimit: 8 * 1024 * 1024, timeoutMs: timeoutMs })
    let out: any
    if (res.kind === 'ok' || (op === 'hook-run' && res.kind === 'non-zero')) {
      const hookFailed: boolean = op === 'hook-run' && res.kind === 'non-zero'
      const extra: any = op === 'hook-run'
        ? Object.assign({ hookFailed: hookFailed, exitCode: res && typeof res.exitCode === 'number' ? res.exitCode : (hookFailed ? -1 : 0) }, hookOutputOf(res))
        : { oldValue: e.oldValue === undefined ? null : e.oldValue, newValue: op === 'config-set' ? String(plan.value || '') : null }
      out = Object.assign({ ok: true, op: op, kind: hookFailed ? 'hook-failed' : 'done', command: argv.slice(0, 3).join(' '), argv: argv, ticketId: ticketId, atMs: nowFn(), scene: ticket.sceneSummary || null }, extra)
    } else {
      const says: string = firstLineOf(String((res && res.stderr) || '').trim() !== '' ? res.stderr : (res && res.stdout))
      out = wfail('git-failed', 'config-failed', stepOf(op) + '失败：git 原话「' + says.slice(0, 400) + '」，这次没有改动生效', {
        git: says.slice(0, 400), step: stepOf(op), expected: expectedOf(op, plan), actual: '退出码 ' + String(res && res.exitCode), cause: (res && res.kind) || '', exitCode: res && typeof res.exitCode === 'number' ? res.exitCode : null,
      })
    }
    remember(requestId, out)
    return out
  }

  return { handleConfigWrite: handleConfigWrite, tickets: tickets, results: results }
}

export const CONFIG_WRITE_SOURCE = 'src/host/versionControlConfigWrite.ts'
