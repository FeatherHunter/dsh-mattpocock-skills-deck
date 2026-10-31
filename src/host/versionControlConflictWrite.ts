// host/versionControlConflictWrite.ts —— 冲突向导（#1747 T12，规格域 6）的凭票执行电话 wf.gitConflictWrite
//
// 这一层只做一件事：凭预检签的票执行一次动作。收进来的只有 ticketId、requestId 与动作参数；
// 真正拼 argv 的是票里保存的计划（conflictPlanOf 的七格），客户端再送一遍参数也不采信——改参数改不动要执行什么。
//
// 校验顺序（任何一步不过都零进程拒绝）：
//   ① requestId 重放：同一个 requestId 再回来，回同一份结果，不再起进程也不重复写文件；
//   ② 票号/requestId 形状；③ 票不存在 → ticket-missing；④ 动作不符 → ticket-op-mismatch；
//   ⑤ 过期 → ticket-expired；⑥ 需要确认的动作没带 confirmed:true → need-confirm；
//   ⑦ 按预检同一口径重算现场（measure），仓库/HEAD/绑定表逐格比对 → stale-repo / target-changed；
//   ⑧ 按票里的计划执行；⑨ 记住 requestId，重复请求回同一份。
//
// 两个非 git 命令的动作各有自己的纪律：
//   · save-file（6.7 面板内整份编辑）：写文件前后都用票里的摘要核对（内容没换、旧文件没变），
//     写完立刻跑 6.15 的残留标记检查；不干净就把旧文本写回去并拒绝——绝不把带标记的内容留在工作区。
//   · take-side 选「保留删除」用 git rm -- <path>：未合并路径上它会连工作区一起删，这正是「删除」的语义。
import { CONFLICT_WRITE_OPS, conflictOpMetaOf, conflictStepsOf } from '../shared/version-control/src/conflict-ops.js'
import { ticketPureVerdict, bindingsVerdict, requestIdProblem } from '../shared/version-control/src/write-ticket.js'
import { idShapeProblem, writeHintFor, classifyWriteFailure } from '../shared/version-control/src/write-reasons.js'
import { VC_CONFLICT_WRITE_TIMEOUT_MS as WRITE_TIMEOUT_MS } from '../shared/time-config/src/values.js'

/** 写失败信封：error 里放环节与固定理由，git 原话/环节/期望/实际平铺在顶层（与改动页、分支域同一口径）。 */
function wfail(kind: string, reason: string, message: string, extra?: any): any {
  return Object.assign({ ok: false, error: { kind: kind, reason: reason, message: message }, reason: reason }, extra || {})
}
function firstLineOf(text: any): string {
  const s: string = String(text === undefined || text === null ? '' : text)
  const i: number = s.indexOf('\n')
  return (i < 0 ? s : s.slice(0, i)).trim()
}

/** 造执行电话：返回 { handleConflictWrite, tickets, results }。票表与结果表由预检叶子注入，两边共用同一份。 */
export function createConflictWrite(deps: any): any {
  const d: any = deps || {}
  const runPinned: any = d.runPinned
  const resolveGitExecutable: any = d.resolveGitExecutable
  const measure: any = d.measure
  const scene: any = d.scene
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now
  const tickets: Map<string, any> = (d.tickets instanceof Map) ? d.tickets : new Map()
  const results: Map<string, any> = (d.results instanceof Map) ? d.results : new Map()

  function remember(requestId: any, out: any): void {
    if (!requestId) return
    results.set(String(requestId), out)
    while (results.size > 500) { const k: any = results.keys().next().value; results.delete(k) }
  }
  /** 执行成功之后重读一次现场：界面要立刻知道「还有几个冲突、进行中操作还在不在」。读不到不算执行失败。 */
  async function afterScene(cwd: string): Promise<any> {
    const s: any = await scene.sceneOf(cwd)
    if (!s || s.ok !== true) return { state: null, conflictCount: null, conflicts: null, headOid: null }
    return { state: s.state, conflictCount: s.conflictCount, conflicts: s.conflicts, headOid: s.headOid }
  }
  function stepOf(op: string): string {
    if (op === 'merge' || op === 'merge-ff-only' || op === 'merge-no-ff' || op === 'merge-squash') return '合并这一步'
    if (op === 'take-side') return '为冲突文件选边这一步'
    if (op === 'save-file') return '把整份编辑写回这一步'
    if (op === 'mark-resolved') return '标记已解决这一步'
    if (op === 'op-continue') return '继续进行中的操作这一步'
    if (op === 'op-skip') return '跳过这一步'
    return '中止进行中的操作这一步'
  }
  function expectedOf(op: string, plan: any): string {
    const target: string = String(plan.target || '')
    const path: string = String(plan.path || '')
    if (op === 'merge' || op === 'merge-ff-only' || op === 'merge-no-ff' || op === 'merge-squash') return '把 ' + target + ' 合并进来'
    if (op === 'take-side') return '把 ' + path + ' 处理成选中的那一边并登记进暂存区'
    if (op === 'save-file') return '把 ' + path + ' 的整份编辑写回工作区且不留冲突标记'
    if (op === 'mark-resolved') return '把 ' + path + ' 标记为已解决'
    if (op === 'op-continue') return '把进行中的操作继续下去'
    if (op === 'op-skip') return '跳过进行中操作的这一步'
    return '中止进行中的操作并回到操作前'
  }
  /** 跑一条 argv；需要默认提交说明的动作（继续）把编辑器换成必定成功的 true，避免 GIT_EDITOR=必失败命令把它拦下。
   *  其余动作保持默认的必失败编辑器（规格第 7 节）：真需要编辑时要显式失败，绝不弹编辑器卡住。 */
  async function runStep(exe: any, root: string, argv: string[], op: string): Promise<any> {
    const opts: any = { stdoutLimit: 8 * 1024 * 1024, timeoutMs: WRITE_TIMEOUT_MS }
    if (op === 'op-continue') opts.gitEditor = 'true'
    return runPinned(exe, root, argv, opts)
  }
  /** 一条命令的结果算不算「合并留下了冲突」：退出码 1 且 stderr 说合并有冲突。
   *  有冲突不是失败——工作区里留下冲突等用户处理，回包里要说清有几个冲突文件。 */
  function mergeConflicted(res: any): boolean {
    if (!res || res.kind !== 'non-zero') return false
    if (Number(res.exitCode) !== 1) return false
    return /CONFLICT|Automatic merge failed|fix conflicts/i.test(String(res.stderr || ''))
  }
  /** 按票里的计划跑一条或几条命令；take-side 是「先 checkout 再 add」两步，两步之间不留半途状态。 */
  async function executeSteps(exe: any, root: string, plan: any): Promise<any> {
    const steps: string[][] = conflictStepsOf(plan)
    const op: string = String(plan.op || '')
    const ran: string[][] = []
    for (let i = 0; i < steps.length; i += 1) {
      const argv: string[] = steps[i]
      const res: any = await runStep(exe, root, argv, op)
      if (res && res.kind === 'ok') { ran.push(argv); continue }
      // 合并类的「有冲突」不是失败：照样算这一步跑完了，把冲突留给后面的选边/整份编辑。
      if (i === 0 && (op === 'merge' || op === 'merge-ff-only' || op === 'merge-no-ff' || op === 'merge-squash') && mergeConflicted(res)) {
        ran.push(argv)
        return { ok: true, conflicted: true, argv: argv, ran: ran }
      }
      const says: string = firstLineOf(String((res && res.stderr) || '').trim() !== '' ? res.stderr : (res && res.stdout))
      return {
        ok: false,
        argv: argv,
        ran: ran,
        failure: wfail('git-failed', classifyWriteFailure(plan.op, res && res.exitCode, says), stepOf(op) + '失败：git 原话「' + says.slice(0, 400) + '」', {
          git: says.slice(0, 400),
          step: stepOf(op),
          expected: expectedOf(op, plan),
          actual: '退出码 ' + String(res && res.exitCode),
          cause: (res && res.kind) || '',
          exitCode: (res && typeof res.exitCode === 'number') ? res.exitCode : null,
          argv: argv,
          decision: null,
        }),
      }
    }
    return { ok: true, conflicted: false, argv: ran[ran.length - 1] || [], ran: ran }
  }
  /** 6.7 整份编辑：摘要核对 → 写文件 → 立刻查残留标记 → 不干净就写回旧文本再拒。 */
  async function saveFile(cur: any, ticket: any, a: any): Promise<any> {
    const plan: any = ticket.plan || {}
    const cwd: string = String(a.cwd)
    const path: string = String(plan.path || '')
    const text: any = a.text
    if (typeof text !== 'string') return wfail('args', 'bad-text', '缺少要写回的整份内容：text 必须是字符串')
    if (scene.digest16(String(text)) !== String(plan.textDigest || '')) {
      return wfail('blocked', 'target-changed', '要写回的内容和确认时不是同一份（可能在预检之后又改过）：请重新看一眼再点', { decision: ticket.decision || null })
    }
    const old: any = await scene.readTextFile(cur.repoRoot, path)
    if (!old || old.ok !== true) return wfail('blocked', 'path-not-conflicted', writeHintFor('path-not-conflicted'), { decision: ticket.decision || null })
    if (scene.digest16(old.text) !== String(plan.oldDigest || '')) {
      return wfail('blocked', 'target-changed', '这个文件在预检之后又变过：这次不写，重新看一眼再点', { decision: ticket.decision || null })
    }
    const w: any = await scene.writeTextFile(cur.repoRoot, path, String(text))
    if (!w || w.ok !== true) return wfail('env', 'unknown-write-failure', '写文件失败：' + String((w && w.message) || '不知道原因'), { decision: ticket.decision || null })
    const mc: any = await scene.markerCheckPathOf(cwd, path)
    if (!mc || mc.ok !== true || mc.clean !== true) {
      // 写回旧文本，把工作区恢复成交给用户时的样子：宁可不保存，也不留一份带冲突标记的文件。
      await scene.writeTextFile(cur.repoRoot, path, old.text)
      const line: any = (mc && mc.markers && mc.markers[0]) ? mc.markers[0].line : null
      return wfail('blocked', 'conflict-markers', writeHintFor('conflict-markers'), { path: path, line: line, decision: ticket.decision || null })
    }
    return { ok: true, op: 'save-file', kind: 'save-file', saved: true, path: path, markerClean: true, ticketId: String(a.ticketId || ''), atMs: nowFn(), decision: ticket.decision || null }
  }

  /** 执行入口：顺序见文件头。 */
  async function handleConflictWrite(args: any): Promise<any> {
    const a: any = args || {}
    const requestId: string = String(a.requestId || '')
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
    const meta: any = conflictOpMetaOf(op)
    if (meta === null || CONFLICT_WRITE_OPS.indexOf(meta) < 0) return wfail('args', 'bad-target', '这个动作不需要凭票执行：' + op)
    const pure: any = ticketPureVerdict(ticket, ticket.op, nowFn())
    if (!pure || pure.ok !== true) return wfail('blocked', String((pure && pure.reason) || 'ticket-expired'), '这张票已经过期或不能用：重新预检')
    if (ticket.confirmRequired === true && a.confirmed !== true) return wfail('need-confirm', 'need-confirm', '这个动作要先确认（确认卡上写清后果），确认后带 confirmed:true 再发一次', { decision: ticket.decision || null })
    const cwd: string = typeof a.cwd === 'string' && a.cwd.trim() !== '' ? a.cwd : ''
    if (!cwd) return wfail('args', 'bad-target', '缺少工作目录：执行必须说清在哪个仓库做')
    const cur: any = await measure(cwd, ticket.plan)
    if (!cur || cur.ok !== true) return cur && cur.envelope ? cur.envelope : wfail('blocked', 'target-changed', '执行前读不回现场：这次不执行，先刷新')
    if (String(cur.repoRoot || '') !== String(ticket.repoRoot || '')) return wfail('blocked', 'stale-repo', '这张票不是给这个仓库签的：重新预检')
    if (String(cur.headOid || '') !== String(ticket.headOid || '')) return wfail('blocked', 'target-changed', '预检之后 HEAD 变了：这次不执行，重新预检')
    const bind: any = bindingsVerdict(ticket, cur.bindings)
    if (bind) return wfail('blocked', String(bind === 'stale-index' ? 'target-changed' : bind), '预检之后要动的东西变了（进行中状态、冲突清单或工作区）：这次不执行，重新预检', { decision: ticket.decision || null })
    const plan: any = ticket.plan || {}
    // save-file 与 mark-resolved 先做「不干净不写」的前置检查：真正动文件之前拦住。
    if (op === 'save-file') { const out = await saveFile(cur, ticket, a); remember(requestId, out); return out }
    if (op === 'mark-resolved') {
      const mc: any = await scene.markerCheckPathOf(cwd, String(plan.path || ''))
      if (!mc || mc.ok !== true || mc.clean !== true) {
        const line: any = (mc && mc.markers && mc.markers[0]) ? mc.markers[0].line : null
        const out: any = wfail('blocked', 'conflict-markers', writeHintFor('conflict-markers'), { path: String(plan.path || ''), line: line, decision: ticket.decision || null })
        remember(requestId, out)
        return out
      }
    }
    const exe: any = await resolveGitExecutable()
    if (!exe) return wfail('env', 'env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    const ran: any = await executeSteps(exe, cur.repoRoot, plan)
    if (ran.ok !== true) { remember(requestId, ran.failure); return ran.failure }
    const after: any = await afterScene(cwd)
    const out: any = {
      ok: true,
      op: op,
      kind: op,
      command: (ran.argv || []).slice(0, 3).join(' '),
      argv: ran.argv,
      steps: ran.ran,
      conflicted: ran.conflicted === true,
      state: after.state,
      conflictCount: after.conflictCount,
      conflicts: after.conflicts,
      ticketId: ticketId,
      atMs: nowFn(),
      decision: ticket.decision || null,
    }
    remember(requestId, out)
    return out
  }

  return { handleConflictWrite: handleConflictWrite, tickets: tickets, results: results }
}

export const CONFLICT_WRITE_SOURCE = 'src/host/versionControlConflictWrite.ts'
