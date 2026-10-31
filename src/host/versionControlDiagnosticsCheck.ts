/**
 * src/host/versionControlDiagnosticsCheck.ts —— 诊断域与替换对象的预检（发票）叶子（#1761 T25，域 13 / 5.12）
 *
 * 为什么单独一份：预检要读现场（二分日志、现有替换清单、几个对象的 oid），这些读取与判定不能塞进
 * 已经贴着有效行上限的父文件。本叶子只做预检：签一张 120 秒的票、把判定与确认口径原样写进票里，
 * 一个字节都不改仓库；真正动手在 versionControlDiagnosticsWrite.ts（拿同一张票表）。
 *
 * 现场摘要（worktreeDigest）用二分日志与替换清单算：这两样是「凭这张票还能不能动」的凭据。
 * 预检之后有人先在终端里重置了二分、撤了替换，执行前重算就与票里记的不一致，按 target-changed 零进程拒绝。
 * 计划摘要（planDigest）绑住动作与两个对象：预检开始二分、执行换成替换对象会被 this 挡住。
 */
// @ts-expect-error 本域 tsconfig 有意不加载 Node 类型包（types 为空）；运行时一定是 Node，createHash 必然存在。
import { createHash as cryptoCreateHash } from 'node:crypto'
import { diagnosticsWritePlanOf, diagnosticsDecisionOf, diagnosticsConfirmRequiredOf, diagnosticsConfirmOf, diagnosticsPlanDigestInput, diagnosticsSceneDigestInput, diagnosticsBisectStateOf, diagnosticsReplaceListOf, DIAGNOSTICS_CHECK_CONTRACT, DIAGNOSTICS_CHECK_VERSION } from '../shared/version-control/src/diagnostics-commands.js'
import { makeTicket, makeBindings } from '../shared/version-control/src/write-ticket.js'
import { VC_DIAGNOSTICS_READ_TIMEOUT_MS as READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'

/** 预检里单条只读命令的输出上限：二分日志与替换清单都很小，给 256 KB 足够。 */
const READ_LIMIT: number = 256 * 1024

/** 挡住时给用户的那句话：理由标识符固定，句子给人读。 */
const REASON_TEXT: Record<string, string> = {
  'not-a-commit': '有一端解析不成提交：检查两个提交号是不是写错了，或者对象已经被删掉',
  'already-bisecting': '当前已经在二分中：先结束这趟二分，再开始新的',
  'same-object': '两个对象是同一个：二分或替换都没有意义',
  'not-bisecting': '当前不在二分中：先开始二分，再标记好提交与坏提交',
  'already-replaced': '这个对象已经有替换：先撤销旧的替换，再建新的',
  'no-replace': '这个对象没有替换记录：没有可撤销的替换',
  'bad-target': '这次动作的参数不合法：检查提交号或对象名是不是写错了',
}
function reasonTextOf(reason: string): string { return REASON_TEXT[reason] || '这次动作现在不能做（理由：' + reason + '）' }

/** 票据绑定用的 16 位摘要。
 *  这八份的算法体由 tests/verify-1586-write-contracts.ts 的 C 组逐字节比对：改一处必须八处一起改。 */
function digest16Of(text: any): string { try { return cryptoCreateHash('sha256').update(String(text === undefined || text === null ? '' : text), 'utf8').digest('hex').slice(0, 16) } catch (e) { return '0000000000000000' } }

function firstLineOf(text: any): string { const t: string = String(text === undefined || text === null ? '' : text).replace(/\r/g, '').trim(); if (!t) return 'git 没有给出说明'; const i: number = t.indexOf('\n'); return (i >= 0 ? t.slice(0, i) : t).slice(0, 300) }

/** 造诊断域预检电话。装配处递进进程出口与日志口径；这里不自己起进程。 */
export function createDiagnosticsCheck(deps: any): any {
  const d: any = deps || {}
  const failPhone: any = d.failPhone
  const firstLine: any = d.firstLine
  const failureFromExec: any = d.failureFromExec
  const runPinned: any = d.runPinned
  const resolveGitExecutable: any = d.resolveGitExecutable
  const resolveRepoRoot: any = d.resolveRepoRoot
  const cwdOf: any = d.cwdOf
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now

  const tickets: Map<string, any> = new Map()
  const results: Map<string, any> = new Map()

  async function baseOf(cwd: any): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return { ok: false, fail: failPhone('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）') }
    const root: any = await resolveRepoRoot(exe, cwd)
    if (!root || root.ok !== true) return { ok: false, fail: root }
    return { ok: true, exe: exe, root: String(root.root) }
  }

  /** 跑一条只读命令：允许非零的动作按结论处理（不在二分中、解析不出引用都不算执行失败）。 */
  async function readOut(exe: any, root: any, what: string, args: string[], allowNonZero: boolean): Promise<any> {
    const res: any = await runPinned(exe, root, args, { stdoutLimit: READ_LIMIT, timeoutMs: READ_TIMEOUT_MS })
    if (res && res.kind === 'non-zero' && allowNonZero) return { ok: true, stdout: String(res.stdout || ''), exitCode: Number(res.exitCode) }
    const bad: any = failureFromExec(res, what)
    if (bad) return { ok: false, fail: bad }
    if (res.truncated) return { ok: false, fail: failPhone('truncated', what + '的输出超过上限被截断，结论不可信') }
    return { ok: true, stdout: String(res.stdout || ''), exitCode: 0 }
  }

  /** 解析一个版本名到 oid：解析不出回 null（这是结论，不是执行失败）。 */
  async function revOid(exe: any, root: any, rev: string): Promise<any> {
    const r: any = await readOut(exe, root, '解析提交 ' + rev + ' 这一步', ['rev-parse', '-q', '--verify', rev], true)
    if (r.ok !== true) return r
    if (r.exitCode !== 0) return { ok: true, oid: null }
    const oid: string = String(r.stdout).trim()
    return { ok: true, oid: oid === '' ? null : oid }
  }

  /** 现场：二分日志（不在二分时为空串）、现有替换清单。这两样一起构成票据的现场摘要。 */
  async function sceneOf(exe: any, root: any): Promise<any> {
    const logRes: any = await readOut(exe, root, '读二分日志这一步', ['bisect', 'log'], true)
    if (logRes.ok !== true) return logRes
    const logText: string = logRes.exitCode === 0 ? String(logRes.stdout) : ''
    const replRes: any = await readOut(exe, root, '读替换清单这一步', ['replace', '-l'], false)
    if (replRes.ok !== true) return replRes
    const state: any = diagnosticsBisectStateOf(logText)
    return { ok: true, log: logText, state: state, replaces: diagnosticsReplaceListOf(replRes.stdout) }
  }

  /** 判定要的现场 oid：开始二分要坏与好两个提交，替换对象要两端，撤销要一个。 */
  async function factsOf(exe: any, root: any, plan: any, scene: any): Promise<any> {
    const facts: any = { active: scene.state.active === true, replaces: scene.replaces.slice(), badOid: null, goodOid: null, fromOid: null, toOid: null, objectOid: null, targetOid: null }
    const reads: any[] = []
    if (plan.op === 'bisect-start') { reads.push(await revOid(exe, root, String(plan.bad))); reads.push(await revOid(exe, root, String(plan.good))) ; if (reads[0].ok !== true) return reads[0]; if (reads[1].ok !== true) return reads[1]; facts.badOid = reads[0].oid; facts.goodOid = reads[1].oid }
    if (plan.op === 'replace-create') { reads.push(await revOid(exe, root, String(plan.from))); reads.push(await revOid(exe, root, String(plan.to))); if (reads[0].ok !== true) return reads[0]; if (reads[1].ok !== true) return reads[1]; facts.fromOid = reads[0].oid; facts.toOid = reads[1].oid }
    if (plan.op === 'replace-delete') { reads.push(await revOid(exe, root, String(plan.object))); if (reads[0].ok !== true) return reads[0]; facts.objectOid = reads[0].oid }
    return { ok: true, facts: facts }
  }

  /** 票据的绑定表：计划摘要绑动作与对象，现场摘要绑二分状态与替换清单。 */
  function bindingsOf(plan: any, scene: any): any {
    return makeBindings({ preconditions: {
      planDigest: digest16Of(diagnosticsPlanDigestInput(plan)),
      worktreeDigest: digest16Of(diagnosticsSceneDigestInput({ active: scene.state.active === true, log: scene.log, replaces: scene.replaces })),
      configOldValue: null,
      remoteOid: null,
      pathAbsent: [],
    }, counters: { indexEntries: null } })
  }

  function sceneSummaryOf(scene: any, facts: any): any {
    return { active: scene.state.active === true, replaces: scene.replaces.slice(), badOid: facts.badOid, goodOid: facts.goodOid, fromOid: facts.fromOid, toOid: facts.toOid, objectOid: facts.objectOid }
  }

  /** 预检：读现场 → 纯函数判定 → block 直接回（零进程写） → 放行则签票。 */
  async function handleGitDiagnosticsCheck(args: any): Promise<any> {
    const a: any = args || {}
    const op: string = String(a.op || '')
    const planRes: any = diagnosticsWritePlanOf(op, a)
    if (!planRes || planRes.ok !== true) return failPhone('args', '这条诊断写动作的参数不合法：' + String((planRes && planRes.message) || '未知原因'))
    const plan: any = planRes.plan
    const base: any = await baseOf(cwdOf(a))
    if (!base.ok) return base.fail
    const scene: any = await sceneOf(base.exe, base.root)
    if (!scene || scene.ok !== true) return scene.fail
    const factsRes: any = await factsOf(base.exe, base.root, plan, scene)
    if (!factsRes || factsRes.ok !== true) return factsRes.fail
    const facts: any = factsRes.facts
    const decision: any = diagnosticsDecisionOf(op, plan, facts)
    const reasons: string[] = Array.isArray(decision.reasons) ? decision.reasons.map(String) : []
    const badReason: string = reasons.filter(function (r: string) { return r !== 'ok' })[0] || ''
    const confirm: any = diagnosticsConfirmOf(op, plan, facts)
    if (decision.verdict === 'block') {
      return failPhone('blocked', reasonTextOf(badReason), { reason: badReason, contract: DIAGNOSTICS_CHECK_CONTRACT, version: DIAGNOSTICS_CHECK_VERSION, op: op, decision: decision, reasons: reasons, confirm: confirm, scene: sceneSummaryOf(scene, facts), readAtMs: nowFn() })
    }
    const confirmRequired: boolean = diagnosticsConfirmRequiredOf(op) === true
    const headRes: any = await revOid(base.exe, base.root, 'HEAD')
    if (headRes.ok !== true) return headRes
    const ticket: any = makeTicket({ id: Math.random().toString(36).slice(2) + Date.now().toString(36), op: op as any, nowMs: nowFn(), headOid: headRes.oid, indexFingerprint: null, indexEntries: null, target: plan, repoRoot: String(base.root), bindings: bindingsOf(plan, scene) })
    ticket.plan = plan
    ticket.decision = decision
    ticket.confirmRequired = confirmRequired
    ticket.confirm = confirm
    tickets.set(ticket.id, ticket)
    while (tickets.size > 200) { const oldest: any = tickets.keys().next(); if (oldest.done) break; tickets.delete(oldest.value) }
    return {
      ok: true, contract: DIAGNOSTICS_CHECK_CONTRACT, version: DIAGNOSTICS_CHECK_VERSION, op: op,
      decision: decision.verdict, reasons: reasons, confirmRequired: confirmRequired, confirm: confirm,
      ticket: { id: ticket.id, op: ticket.op, checkedAtMs: ticket.checkedAtMs, expiresAtMs: ticket.expiresAtMs },
      scene: sceneSummaryOf(scene, facts), readAtMs: nowFn(),
    }
  }

  /** 执行前复核用：按同一口径重算现场与绑定表；执行叶子据它逐格比对票里记的值。 */
  async function measure(cwd: any, plan: any): Promise<any> {
    const base: any = await baseOf(cwd)
    if (!base.ok) return base.fail
    const scene: any = await sceneOf(base.exe, base.root)
    if (!scene || scene.ok !== true) return scene.fail
    const headRes: any = await revOid(base.exe, base.root, 'HEAD')
    if (headRes.ok !== true) return headRes
    return { ok: true, repoRoot: String(base.root), headOid: headRes.oid, bindings: bindingsOf(plan, scene), scene: { active: scene.state.active === true, replaces: scene.replaces.slice() } }
  }

  return { handleGitDiagnosticsCheck: handleGitDiagnosticsCheck, tickets: tickets, results: results, measure: measure, firstLineOf: firstLineOf }
}
