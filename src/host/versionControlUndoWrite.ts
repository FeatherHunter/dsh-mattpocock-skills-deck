/**
 * src/host/versionControlUndoWrite.ts —— 历史改写五条动作的凭票执行（#1748 T13，规格 #1586 域 5）
 *
 * 三条硬规矩，任何一条放松都会让「用户确认过的东西」与「真正执行的东西」脱钩：
 * 1. 任何写命令之前先过票据门：票在不在、动作对不对、过期没有、仓库是不是同一个、HEAD 漂没漂、
 *    工作区形状变没变、目标提交还指不指着原来那条。任何一格对不上就零命令拒绝。
 * 2. 同一个 requestId 重放一律回第一次的结果，不重复执行（界面上「连点两下确认」不能真的执行两次）。
 * 3. 中途失败要诚实：还原提交第二步没提交成，要明说「反向改动已经进了索引但没提交」；
 *    拣选撞冲突要把冲突文件清单交回去，不替用户自动解决。
 */
import { failPhone, firstLine, failureFromExec } from '../shared/version-control/exec-envelope.js'
import { ticketPureVerdict, requestIdProblem } from '../shared/version-control/src/write-ticket.js'
import { idShapeProblem, classifyWriteFailure } from '../shared/version-control/src/write-reasons.js'
import { undoOpOf, undoPlanOf, undoArgvOf } from '../shared/version-control/src/undo-ops.js'
import { undoPlanDigestOf, undoWorktreeDigestOf } from '../shared/version-control/src/undo-ticket.js'
import { VC_UNDO_WRITE_TIMEOUT_MS } from '../shared/time-config/src/values.js'

/** 冲突文件清单是一个小命令，128KB 足够。 */
const CONFLICT_LIMIT: number = 128 * 1024

/**
 * 造执行层：只认票据，逐格重验，一步一步跑。
 * 依赖由装配壳传入：check 是预检层实例（用它量现场、取票），其余是宿主能力。
 */
export function createUndoWrite(deps: any): any {
  const now = function (): number { try { return typeof deps.nowMs === 'function' ? Number(deps.nowMs()) : Date.now() } catch (e) { return Date.now() } }
  const writeTimeoutMs: number = Number(deps.writeTimeoutMs) || VC_UNDO_WRITE_TIMEOUT_MS
  const tickets: Map<string, any> = deps.tickets || new Map()
  const results: Map<string, any> = deps.results || new Map()

  /** 失败信封：整族动作共用一套稳定 reason，界面照它查词表（写层理由标识符不外泄给用户看）。 */
  function fail(kind: any, reason: any, message: any, extra?: any): any {
    const base: any = failPhone(kind, message)
    base.error.reason = String(reason || '')
    if (extra) Object.assign(base, extra)
    return base
  }

  /** 把一次非零退出翻成带理由标识符的失败信封。 */
  function failedStep(res: any, reason: any, message: any, extra?: any): any {
    const env: any = failureFromExec(res, '执行') || failPhone('exit', message || '写命令没有成功结束')
    env.error.reason = String(reason || classifyWriteFailure('commit' as any, Number(res && res.exitCode) || 0, String((res && res.stderr) || '')))
    if (extra) Object.assign(env, extra)
    return env
  }

  /** 跑一步写命令；非零退出原样交回调用方判定（有的失败要读冲突清单，不能当场吞掉）。 */
  async function runStep(exe: string, root: string, argv: string[]): Promise<any> {
    try {
      return await deps.runPinned(exe, root, argv, { timeoutMs: writeTimeoutMs })
    } catch (e) {
      return { kind: 'spawn-failed', message: String((e && (e as any).message) || e) }
    }
  }

  /** 冲突文件清单：拣选/还原撞冲突时交回去让用户自己拿主意，不自动解决。 */
  async function conflictsOf(exe: string, root: string): Promise<string[]> {
    let res: any = null
    try { res = await deps.runPinned(exe, root, ['diff', '--name-only', '--diff-filter=U', '-z'], { timeoutMs: writeTimeoutMs, stdoutLimit: CONFLICT_LIMIT }) } catch (e) { return [] }
    if (!res || res.kind !== 'ok') return []
    const raw: string = String(res.stdout || '')
    const out: string[] = []
    const parts: string[] = raw.split('\u0000')
    for (let i = 0; i < parts.length; i += 1) if (parts[i] !== '') out.push(parts[i])
    return out
  }

  /** 读此刻 HEAD（执行后报告「从哪条到哪条」）。 */
  async function headOf(exe: string, root: string): Promise<string> {
    try {
      const res: any = await deps.runPinned(exe, root, ['rev-parse', 'HEAD'], { timeoutMs: writeTimeoutMs, stdoutLimit: 4096 })
      if (res && res.kind === 'ok') return String(res.stdout || '').trim()
    } catch (e) { /* 读不到就空串，如实报 */ }
    return ''
  }

  /** 引用此刻解析成提交全号；不存在回 null（目标漂移判定要用）。 */
  async function resolveNow(exe: string, root: string, rev: string): Promise<string | null> {
    try {
      const res: any = await deps.runPinned(exe, root, ['rev-parse', '--verify', '--quiet', rev + '^{commit}'], { timeoutMs: writeTimeoutMs, stdoutLimit: 4096 })
      if (res && res.kind === 'ok') {
        const oid: string = String(res.stdout || '').trim().toLowerCase()
        if (/^[0-9a-f]{40,64}$/.test(oid)) return oid
      }
    } catch (e) { /* 解析不了按目标漂移处理 */ }
    return null
  }

  /**
   * 执行前重验：票内绑定值与此刻现场逐格比。
   * 顺序照附录第 2 节：票据门（不起进程）→ 仓库同一个 → HEAD 同一条 → 工作区形状没变 →
   * 目标提交没漂。任一项变就返回零命令拒绝，绝不「先跑一半再说」。
   */
  async function revalidate(args: any, op: string, plan: any, ticket: any): Promise<any> {
    const cwd: string = String(args.cwd || deps.defaultCwd || '')
    const measure = deps.measure
    const m: any = await measure(cwd)
    if (m.ok !== true) return m
    if (String(m.root) !== String(ticket.repoRoot)) return fail('stale', 'stale-repo', '执行时的仓库和预检时的不是同一个，不执行。', { scene: m.scene })
    if (String(m.scene.head) !== String(ticket.headOid)) return fail('stale', 'stale-head', 'HEAD 在预检之后换到别的提交了，重新预检一次再确认。', { scene: m.scene })
    const pre: any = (ticket.bindings && ticket.bindings.preconditions) || {}
    const digestNow: string = String(undoWorktreeDigestOf(m.screen))
    if (pre.worktreeDigest !== null && pre.worktreeDigest !== undefined && String(pre.worktreeDigest) !== digestNow) return fail('stale', 'stale-index', '工作区在预检之后有变动（暂存/未暂存的改动变了），重新预检一次再确认。', { scene: m.scene })
    const wants = ticket.target || {}
    if (op === 'cherry-pick') {
      const got: string[] = []
      for (let i = 0; i < plan.commits.length; i += 1) {
        const rev: string = String(plan.commits[i])
        const oid: string | null = await resolveNow(m.exe, m.root, rev)
        if (oid === null) return fail('stale', 'target-changed', '第 ' + String(i + 1) + ' 条提交在预检之后解析不到了，重新预检一次。', { field: 'commits', index: i + 1 })
        got.push(oid)
      }
      plan.commits = got.map(function (oid: string, i: number) { return { rev: String(wants.commits && wants.commits[i] ? wants.commits[i].rev : plan.commits[i]), oid: oid } })
    } else if (String(wants.target || '') !== '' || String(wants.targetOid || '') !== '') {
      const oid: string | null = await resolveNow(m.exe, m.root, String(wants.target || wants.targetOid))
      if (oid === null || String(oid) !== String(wants.targetOid || '')) return fail('stale', 'target-changed', '目标提交在预检之后换了指向，重新预检一次再确认。', { field: 'target', scene: m.scene })
      plan.targetOid = String(oid)
    }
    const digestNowPlan: string = String(undoPlanDigestOf(plan))
    if (pre.planDigest !== null && pre.planDigest !== undefined && String(pre.planDigest) !== digestNowPlan) return fail('stale', 'target-changed', '这次要执行的内容和预检时确认的不一致，重新预检一次。')
    return { ok: true, exe: m.exe, root: m.root, scene: m.scene }
  }

  /** 按票据里的动作把步骤依次跑完；中途失败按动作分别诚实交代。 */
  async function execute(exe: string, root: string, op: string, steps: string[][]): Promise<any> {
    const done: string[][] = []
    for (let i = 0; i < steps.length; i += 1) {
      const argv: string[] = steps[i]
      const res: any = await runStep(exe, root, argv)
      if (res && res.kind === 'ok') { done.push(argv); continue }
      const conflicts: string[] = await conflictsOf(exe, root)
      if (conflicts.length > 0) {
        return fail('conflict', op === 'cherry-pick' ? 'cherry-pick-conflict' : 'revert-conflict',
          'git 报告有冲突文件，面板不自动解决：' + conflicts.join('、'), { conflicts: conflicts, stepsDone: done.length })
      }
      if (op === 'revert' && i > 0) {
        return fail('partial', 'revert-partial',
          '反向改动已经进了索引，但提交这一步没成功，仓库停在「还原进行中」。处理完再提交，或放弃这次还原。', { stepsDone: done.length })
      }
      return failedStep(res, '', firstLine(res && res.stderr), { stepsDone: done.length })
    }
    return { ok: true, stepsDone: done.length }
  }

  /**
   * 凭票执行。args 里必须有 op 与 ticketId；可选 requestId（重放用）、target/message/commits。
   * 成功回新 HEAD 与会丢东西的恢复点；失败回失败信封 + 稳定 reason。
   */
  async function handleWrite(args: any): Promise<any> {
    const a: any = args || {}
    const op: string = String(a.op === undefined || a.op === null ? '' : a.op)
    const requestId: string = String(a.requestId === undefined || a.requestId === null ? '' : a.requestId)
    const badRequest: string | null = requestIdProblem(requestId)
    if (badRequest !== null) return fail('usage', badRequest, 'requestId 形状不对：只允许字母、数字、下划线和短横线，最长 64 位。')
    if (requestId !== '' && results.has(requestId)) return Object.assign({}, results.get(requestId), { replayed: true })
    const def: any = undoOpOf(op)
    if (!def) return fail('usage', 'unknown-op', '没有这条历史改写动作：' + op)
    const ticketId: string = String(a.ticketId === undefined || a.ticketId === null ? '' : a.ticketId)
    const shape: string | null = idShapeProblem(ticketId)
    if (shape !== null) return fail('usage', 'ticket-missing', '票据编号形状不对，回预检重新拿一张票。')
    const ticket: any = tickets.get(ticketId) || null
    const pure: any = ticketPureVerdict(ticket, op as any, now())
    if (pure.ok !== true) {
      const why: string = String(pure.reason)
      if (why === 'ticket-expired') return fail('stale', why, '这张预检票已经过期（有效期 120 秒），回预检重新拿一张。')
      if (why === 'ticket-op-mismatch') return fail('stale', why, '票对应的动作和这次要执行的动作不一样，回预检重新拿一张。')
      return fail('usage', why, '找不到这张预检票，回预检重新拿一张。')
    }
    const planned: any = undoPlanOf(a)
    if (planned.ok !== true) return fail('usage', planned.reason, planned.message, { field: planned.field, index: planned.index })
    const plan: any = planned.plan
    // 还原提交的说明在预检时填了默认值并进了票据；执行时前端没带说明（或带空串）就照票据那一条走，
    // 否则重算出来的计划摘要和票里绑的对不上，会被误判成「这次要执行的内容和预检时确认的不一致」。
    if (String(plan.message) === '' && ticket.target && String(ticket.target.message || '') !== '') plan.message = String(ticket.target.message)
    const checked: any = await revalidate(a, op, plan, ticket)
    if (checked.ok !== true) return checked
    const built: any = undoArgvOf(plan)
    if (built.ok !== true) return fail('usage', built.reason || 'unknown', '这次动作的命令计划没拼出来，不执行。')
    const beforeHead: string = String(ticket.headOid || '')
    const executed: any = await execute(checked.exe, checked.root, op, built.steps)
    const afterHead: string = await headOf(checked.exe, checked.root)
    if (executed.ok !== true) {
      Object.assign(executed, { op: def.op, capId: def.id, atMs: now(), beforeHead: beforeHead, afterHead: afterHead })
      if (requestId !== '') { results.set(requestId, executed); if (results.size > 200) { const oldest: any = results.keys().next().value; results.delete(oldest) } }
      return executed
    }
    tickets.delete(ticketId)
    const recovery: any = (ticket.target && ticket.target.recovery) ? ticket.target.recovery : null
    const reply: any = {
      ok: true,
      op: def.op,
      capId: def.id,
      atMs: now(),
      before: { headOid: beforeHead, headShort: beforeHead.slice(0, 10) },
      after: { headOid: afterHead, headShort: afterHead.slice(0, 10) },
      stepsDone: executed.stepsDone,
      danger: def.danger === true,
      recovery: recovery,
    }
    if (requestId !== '') { results.set(requestId, reply); if (results.size > 200) { const oldest: any = results.keys().next().value; results.delete(oldest) } }
    return reply
  }

  return { handleWrite: handleWrite }
}
