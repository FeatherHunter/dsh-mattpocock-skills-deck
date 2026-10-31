/**
 * src/host/versionControlDiagnosticsWrite.ts —— 诊断域与替换对象的凭票执行叶子（#1761 T25）
 *
 * 为什么要票：二分五步与替换对象两条都会改仓库状态（.git/BISECT_* 与 refs/replace/*）。
 * 预检签一张票记下「动作计划 + 现场摘要 + HEAD」，这里拿同一张票表，执行前重算现场逐格比对：
 * 票不在、动作换过、票过期、仓库换了、HEAD 漂了、二分状态或替换清单变了——一律零进程拒绝。
 * 同一 requestId 重放回同一份结果，不再起第二次进程（网络与终端都可能让界面重发一次）。
 *
 * argv 只按票里的计划重拼（diagnosticsWriteArgvOf），客户端再送一遍参数也不采信；
 * 每个元素独立、不经 shell、不加固定前缀（前缀与 -C 钉仓库在注入的 runPinned 里）。
 */
import { diagnosticsWriteArgvOf, DIAGNOSTICS_WRITE_OPS } from '../shared/version-control/src/diagnostics-commands.js'
import { ticketPureVerdict, requestIdProblem, bindingsVerdict } from '../shared/version-control/src/write-ticket.js'
import { writeHintFor, idShapeProblem } from '../shared/version-control/src/write-reasons.js'
import { VC_DIAGNOSTICS_WRITE_TIMEOUT_MS as WRITE_TIMEOUT_MS } from '../shared/time-config/src/values.js'

/** 写命令的输出上限：bisect 与 replace 都只回一行状态，给 1 MB 足够。 */
const WRITE_LIMIT: number = 1024 * 1024

/** 执行失败时按动作给一句人话，说明这一步在做什么。 */
const STEP_TEXT: Record<string, string> = {
  'bisect-start': '开始二分', 'bisect-bad': '标记坏提交', 'bisect-good': '标记好提交',
  'bisect-skip': '跳过这个提交', 'bisect-reset': '结束二分', 'replace-create': '建立替换', 'replace-delete': '撤销替换',
}
function stepOf(op: string): string { return STEP_TEXT[op] || '这次诊断动作' }

/** 失败原因标识符 → 给人看的原因句（与界面词表分开：这里是执行层的排查说明）。 */
const CAUSE_TEXT: Record<string, string> = {
  'already-bisecting': '仓库里已经有一趟二分在跑',
  'not-bisecting': '仓库当前不在二分中',
  'not-a-commit': '提交号或对象名解析不成提交',
  'already-replaced': '这个对象已经有替换记录',
  'no-replace': '这个对象没有可撤销的替换',
  'no-permission': '文件权限不允许写 .git 里的记录',
  'not-a-repo': '这个目录不在任何 git 仓库里',
  'unknown-write-failure': 'git 原话没有落进已知的失败类别',
}
function causeOf(reason: string): string { return CAUSE_TEXT[reason] || '未归类的失败' }

/** 失败话术：票据那几类理由与共享层同一份写法（writeHintFor），诊断自己的理由给一句本地说明。 */
const DIAG_HINTS: Record<string, string> = {
  'already-bisecting': '先结束这趟二分，再开始新的二分',
  'not-bisecting': '先开始二分，再标好提交与坏提交',
  'not-a-commit': '检查提交号或对象名是不是写错了',
  'already-replaced': '先撤销旧的替换，再建新的',
  'no-replace': '先列出替换清单，确认要撤销哪个对象',
  'unknown-write-failure': '重试一次；仍然失败就看后台日志里那条 git.exec 的退出码与错误类',
}
function hintOf(reason: string): string { return DIAG_HINTS[reason] || writeHintFor(reason) }

/** 把 git 原话归进固定的失败类别；归类只认明确的说法，猜不到就如实记 unknown-write-failure。 */
function classifyFailure(argv0: string, exitCode: number, stderrText: string): string {
  const s: string = String(stderrText || '')
  if (/already a bisect|already in a bisect|a bisect session is already/i.test(s)) return 'already-bisecting'
  if (/We are not bisecting|You need to start by|not currently bisecting/i.test(s)) return 'not-bisecting'
  if (/could not lookup|bad revision|unknown revision|not a valid object|bad object|not a valid commit|fatal: ambiguous/i.test(s)) return 'not-a-commit'
  if (/not a git repository/i.test(s)) return 'not-a-repo'
  if (/permission denied|unable to create|unable to write|could not open/i.test(s)) return 'no-permission'
  return 'unknown-write-failure'
}

function firstLineOf(text: any): string { const t: string = String(text === undefined || text === null ? '' : text).replace(/\r/g, '').trim(); if (!t) return 'git 没有给出说明'; const i: number = t.indexOf('\n'); return (i >= 0 ? t.slice(0, i) : t).slice(0, 300) }

/** 造诊断域执行电话：票据表与结果表由装配处从预检叶子递进来，两边必须是同一张表。 */
export function createDiagnosticsWrite(deps: any): any {
  const d: any = deps || {}
  const failPhone: any = d.failPhone
  const failureFromExec: any = d.failureFromExec
  const runPinned: any = d.runPinned
  const resolveGitExecutable: any = d.resolveGitExecutable
  const measure: any = d.measure
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now
  const tickets: Map<string, any> = (d.tickets instanceof Map) ? d.tickets : new Map()
  const results: Map<string, any> = (d.results instanceof Map) ? d.results : new Map()

  function wfail(kind: string, reason: string, message: string, extra?: any): any {
    return Object.assign({ ok: false, error: { kind: kind, reason: reason, message: message, hint: hintOf(reason) }, reason: reason }, extra || {})
  }
  function remember(requestId: any, out: any): void {
    results.set(String(requestId), out)
    while (results.size > 500) { const oldest: any = results.keys().next(); if (oldest.done) break; results.delete(oldest.value) }
  }
  function fieldsOf(plan: any): any {
    if (plan.op === 'bisect-start') return { bad: plan.bad, good: plan.good }
    if (plan.op === 'replace-create') return { from: plan.from, to: plan.to }
    if (plan.op === 'replace-delete') return { object: plan.object }
    if (plan.op === 'bisect-reset') return { active: false }
    return { active: true }
  }

  /** 凭票执行：所有拒绝都发生在起进程之前；真正起进程只有最后那一次。 */
  async function handleGitDiagnosticsWrite(args: any): Promise<any> {
    const a: any = args || {}
    if (a.requestId !== undefined && results.has(String(a.requestId))) return { ok: true, reused: true, result: results.get(String(a.requestId)) }
    const idBad: any = idShapeProblem(a.ticketId)
    if (idBad) return wfail('args', idBad, '票据号形状不对：它只该由预检发出来')
    const ridBad: any = requestIdProblem(a.requestId)
    if (ridBad) return wfail('args', ridBad, '这次请求的编号不合法：只允许字母、数字、下划线与短横线')
    const ticket: any = tickets.get(String(a.ticketId)) || null
    if (!ticket) return wfail('blocked', 'ticket-missing', '这张票不在宿主内存里：重新点一次预检，再确认')
    const op: string = String(ticket.op || '')
    if (a.op !== undefined && String(a.op) !== op) return wfail('blocked', 'ticket-op-mismatch', '这张票不是给这个动作签的：重新预检')
    if (DIAGNOSTICS_WRITE_OPS.indexOf(op) < 0) return wfail('args', 'bad-target', '这张票里的动作不在诊断域清单里')
    const pure: any = ticketPureVerdict(ticket, op as any, nowFn())
    if (!pure || pure.ok !== true) return wfail('blocked', (pure && pure.reason) || 'ticket-missing', '这张票已经过期或对不上：重新预检')
    if (ticket.confirmRequired === true && a.confirmed !== true) return wfail('blocked', 'need-confirm', '这个动作会改仓库状态：先点确认卡上的确认')
    const cwd: any = a.cwd
    if (typeof cwd !== 'string' || cwd.trim() === '') return wfail('args', 'bad-target', '没说清在哪个仓库里执行：带上网关给的目录')
    const cur: any = await measure(cwd, ticket.plan)
    if (!cur || cur.ok !== true) return cur || failPhone('env', '执行前复核仓库现场失败，没有给出原因')
    if (String(cur.repoRoot) !== String(ticket.repoRoot)) return wfail('blocked', 'stale-repo', '票里记的仓库与此刻的不一致：重新预检')
    if (String(cur.headOid) !== String(ticket.headOid)) return wfail('blocked', 'target-changed', '预检之后 HEAD 变了：重新预检')
    const bindBad: any = bindingsVerdict(ticket, cur.bindings)
    if (bindBad) return wfail('blocked', bindBad, '预检之后仓库状态变了（二分记录或替换清单不一致）：重新预检')
    const argv: string[] = diagnosticsWriteArgvOf(ticket.plan)
    const exe: any = await resolveGitExecutable()
    if (!exe) return failPhone('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    const res: any = await runPinned(exe, cur.repoRoot, argv, { stdoutLimit: WRITE_LIMIT, timeoutMs: WRITE_TIMEOUT_MS })
    if (!res || res.kind !== 'ok') {
      if (res && res.kind === 'non-zero') {
        const reason: string = classifyFailure(argv[0], Number(res.exitCode), String(res.stderr || ''))
        const says: string = firstLineOf(res.stderr)
        return wfail('git-failed', reason, stepOf(op) + '失败：git 原话「' + says + '」', { git: says, step: stepOf(op), expected: 'git 按计划写下这次诊断记录', actual: 'git 拒绝了这次写（退出码 ' + String(res.exitCode) + '）', cause: causeOf(reason), exitCode: Number(res.exitCode), decision: ticket.decision, argv: argv })
      }
      const bad: any = failureFromExec(res, stepOf(op) + '这条命令')
      return bad || failPhone('env', stepOf(op) + '没有跑完，也没有给出原因')
    }
    const out: any = Object.assign({ ok: true, op: op, command: argv.slice(0, 2).join(' '), argv: argv, ticketId: ticket.id, decision: ticket.decision, atMs: nowFn() }, fieldsOf(ticket.plan))
    remember(a.requestId, out)
    return out
  }

  return { handleGitDiagnosticsWrite: handleGitDiagnosticsWrite, tickets: tickets, results: results }
}
