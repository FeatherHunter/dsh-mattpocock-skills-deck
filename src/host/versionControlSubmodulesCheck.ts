// host/versionControlSubmodulesCheck.ts —— 域 10（子模块）的预检电话 wf.gitSubmoduleCheck（#1757 T21）
//
// 三段式的第一段（规格第 4、8 节）：读一次真实现场 → 共享层 submoduleJudge 判定 allow/warn/block →
// 签一张 120 秒的票并把「执行前必须还没变」的事实记进绑定表。界面拿票之后弹确认卡、点确认，
// 执行叶子凭票号重验再动手。
//
// 票据里记三件事：计划摘要（动作与参数）、目标子模块的旧配置摘要（地址/跟踪分支/能不能吸收）、
// 以及预检那一刻确认「不存在」的标记（运行中操作标记 + 新增动作的目标路径）。执行前逐格重算，
// 任何一格变了就按 target-changed 零进程拒绝，不自动重放。
//
// 约定（改了会坏的地方）：
//   1) 判定只调用共享层 submoduleJudge，本文件不另写一套「能不能点」的理由——界面上的禁用原因
//      与宿主真正执行的理由必须同源，这是规格第 4 节点名的一条。
//   2) 动作参数只从计划里取；票据里存的 plan 是执行层唯一信得过的那份。
//   3) 地址原文只留在票据内存里供执行用一次；回包与票据摘要只给抹过口令的版本。
import { submoduleJudge, submodulePlanOf, submodulePlanDigestInput, submoduleStableValue, submoduleDigestOf,
  submoduleActionOf, submoduleBatchMenuOf, submoduleTaskOf, submoduleSceneSummary, submoduleRedactUrl,
  SUBMODULE_CHECK_CONTRACT, SUBMODULE_CHECK_VERSION } from '../shared/version-control/src/submodule-ops.js'
import { makeTicket, makeBindings, pathAbsentFromScreen } from '../shared/version-control/src/write-ticket.js'
import { VC_SUBMODULE_READ_TIMEOUT_MS as READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'
import { createSubmoduleBoardReader } from './versionControlSubmodules.js'
// @ts-expect-error 本域 tsconfig 有意不加载 Node 类型包（types 为空）；运行时一定是 Node，内建模块必然存在。
import { createHash as cryptoCreateHash } from 'node:crypto'
// @ts-expect-error 同上：真实文件系统只在宿主侧用，DSH 的 fs 服务没有列目录。
import { stat as fsStat, readdir as fsReaddir } from 'node:fs/promises'

const STDOUT_LIMIT: number = 8 * 1024 * 1024

/** 摘要：绑定表只用 16 位十六进制，够区分同一份计划/现场，也不把原文带进票据。 */
function digest16Of(text: any): string {
  try { return cryptoCreateHash('sha256').update(String(text === undefined || text === null ? '' : text), 'utf8').digest('hex').slice(0, 16) } catch (e) { return '0000000000000000' }
}
function joinPath(root: any, rel: any): string {
  const base: string = String(root === undefined || root === null ? '' : root).replace(/[\\/]+$/, '')
  const tail: string = String(rel === undefined || rel === null ? '' : rel).replace(/^[\\/]+/, '')
  return base + '/' + tail
}
function shownPlanOf(plan: any): any {
  return { action: plan.action, capId: plan.capId, kind: plan.kind, path: plan.path, urlDisplay: submoduleRedactUrl(plan.url), branch: plan.branch }
}

/** 造预检电话：返回 { handleGitSubmoduleCheck, tickets, results, measure }。
 *  tickets/results 是宿主进程内存里的两张表，执行叶子与任务叶子共用同一份；measure 供它们在
 *  动手前按同一口径重算现场（读法只有一份，不另写第二套）。 */
export function createSubmoduleCheck(deps: any): any {
  const d: any = deps || {}
  const failPhone: any = d.failPhone
  const firstLine: any = d.firstLine
  const failureFromExec: any = d.failureFromExec
  const runPinned: any = d.runPinned
  const resolveGitExecutable: any = d.resolveGitExecutable
  const resolveRepoRoot: any = d.resolveRepoRoot
  const readScreenOf: any = d.readScreenOf
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now
  const reader: any = createSubmoduleBoardReader(d)
  const tickets: Map<string, any> = new Map()
  const results: Map<string, any> = new Map()

  // 失败信封固定 {ok:false, error:{kind, reason, message, hint}}（规格第 8 节）：界面按 reason 取词条，
  // 附加字段（现场、计划、判定）原样并在顶层。理由标识符一律来自共享层的固定表。
  function fail(kind: string, reason: string, message: string, extra?: any): any {
    const base: any = failPhone(kind, message, Object.assign({ reason: reason }, extra || {}))
    base.error = { kind: kind, reason: reason, message: message, hint: '' }
    return base
  }
  async function readOut(exe: any, root: any, what: string, args: string[], allowNonZero?: boolean): Promise<any> {
    const res: any = await runPinned(exe, root, args, { stdoutLimit: STDOUT_LIMIT, timeoutMs: READ_TIMEOUT_MS })
    const bad: any = res.kind === 'ok' || (allowNonZero && res.kind === 'non-zero') ? null : failureFromExec(res, what)
    if (bad) return { ok: false, envelope: bad }
    if (res.truncated) return { ok: false, envelope: fail('truncated', 'truncated', what + '的输出超过了字节上限，读不全就不给现场') }
    return { ok: true, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode }
  }
  async function baseOf(cwd: any): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return { fail: fail('env', 'env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）') }
    const base: any = await resolveRepoRoot(exe, cwd)
    if (!base || base.ok !== true) return { fail: base }
    return { exe: exe, root: base.root, gitDir: base.gitDir }
  }
  /** 新增子模块前看目标路径：不存在可以；存在但空也算可以；存在且非空就不行。读不到按「已存在且非空」保守拒绝。 */
  async function targetFactsOf(abs: string): Promise<any> {
    try { await fsStat(abs) } catch (e: any) {
      const code: string = String((e && e.code) || '')
      if (code === 'ENOENT' || code === 'ENOTDIR') return { exists: false, empty: false }
      return { exists: true, empty: false }
    }
    try { const list: any[] = await fsReaddir(abs); return { exists: true, empty: list.length === 0 } } catch (e) { return { exists: true, empty: false } }
  }
  async function markersOf(cwd: any): Promise<string[]> {
    if (typeof readScreenOf !== 'function') return []
    try { const screen: any = await readScreenOf(cwd); return screen ? pathAbsentFromScreen(screen) : [] } catch (e) { return [] }
  }
  function rowOf(rows: any, path: any): any {
    const list: any[] = Array.isArray(rows) ? rows : []
    for (const r of list) if (r && r.path === path) return r
    return null
  }
  /** 绑定表：计划摘要 + 目标旧配置摘要（批量与吸收都按现场摘要算）+ 「预检时不存在」的路径名单。 */
  function bindingsFor(rows: any, plan: any, markers: string[], targetExists: any): any {
    const pre: any = { planDigest: digest16Of(submodulePlanDigestInput(plan)) }
    if (plan.batch === true) pre.configOldValue = digest16Of(submoduleDigestOf(rows))
    else {
      const row: any = rowOf(rows, plan.path)
      if (row) pre.configOldValue = digest16Of(submoduleStableValue({ url: row.urlDisplay, branch: row.branch, absorbable: row.absorbable === true, from: row.absorbFrom || '' }))
    }
    const absent: string[] = markers.slice()
    if (plan.action === 'add' && targetExists !== true) absent.push(plan.path)
    pre.pathAbsent = absent
    return makeBindings({ preconditions: pre })
  }
  /** 执行/任务叶子动手前重算现场：必须与签票时同一口径（同一个读数器、同一套绑定表）。 */
  async function measure(cwd: any, plan: any): Promise<any> {
    const base: any = await baseOf(cwd)
    if (base.fail) return { ok: false, envelope: base.fail }
    const board: any = await reader.boardOf(base.exe, base.root, base.gitDir)
    if (board.ok !== true) return { ok: false, envelope: board.envelope }
    let targetExists: any = undefined
    if (plan.action === 'add') { const facts: any = await targetFactsOf(joinPath(base.root, plan.path)); targetExists = facts.exists === true }
    const head: any = await readOut(base.exe, base.root, '读仓库当前位置这一步', ['rev-parse', 'HEAD'], true)
    const headOid: string = head.ok === true ? String(firstLine(head.stdout)).trim() : ''
    const markers: string[] = await markersOf(cwd)
    return { ok: true, exe: base.exe, repoRoot: base.root, headOid: headOid, bindings: bindingsFor(board.rows, plan, markers, targetExists), rows: board.rows, scene: submoduleSceneSummary(board.rows) }
  }

  async function handleGitSubmoduleCheck(args: any): Promise<any> {
    const req: any = args && typeof args === 'object' ? args : {}
    const cwd: string = String(req.cwd || '')
    const batch: boolean = req.batch === true
    let plan: any = null
    if (batch) {
      const menu: any = submoduleBatchMenuOf(req.op)
      if (!menu) return fail('invalid', 'unknown-action', '批量菜单里没有这一项：只认固定的四项菜单，不接受别的命令')
      if (!menu.taskOp) return fail('invalid', 'unknown-action', '「看状态」不签票：直接重读子模块面板即可')
      plan = { action: menu.id, capId: '10.4', kind: 'task', batch: true, path: '', url: '', branch: '' }
    } else {
      const planRes: any = submodulePlanOf(req.op, { path: req.path, url: req.url, branch: req.branch })
      if (planRes.ok !== true) return fail('invalid', planRes.reason, planRes.message)
      plan = planRes.plan
    }
    const base: any = await baseOf(cwd)
    if (base.fail) return base.fail
    const board: any = await reader.boardOf(base.exe, base.root, base.gitDir)
    if (board.ok !== true) return board.envelope
    const rows: any[] = board.rows
    let targetExists: any = undefined
    let targetEmpty: any = undefined
    if (plan.action === 'add') {
      const facts: any = await targetFactsOf(joinPath(base.root, plan.path))
      targetExists = facts.exists === true
      targetEmpty = facts.empty === true
    }
    const decision: any = batch ? { decision: 'allow', reasons: [] } : submoduleJudge(plan.action, { rows: rows, path: plan.path, url: plan.url, branch: plan.branch, targetExists: targetExists, targetEmpty: targetEmpty })
    const scene: string = submoduleSceneSummary(rows)
    if (decision.decision === 'block') {
      return fail('blocked', decision.reasons[0], '这个动作现在不能做（理由标识符 ' + String(decision.reasons[0]) + '，界面按 vc.sub.why.<理由> 取词条显示原因）', { contract: SUBMODULE_CHECK_CONTRACT, version: SUBMODULE_CHECK_VERSION, op: plan.action, decision: decision.decision, reasons: decision.reasons, scene: scene, plan: shownPlanOf(plan) })
    }
    const head: any = await readOut(base.exe, base.root, '读仓库当前位置这一步', ['rev-parse', 'HEAD'], true)
    const headOid: string = head.ok === true ? String(firstLine(head.stdout)).trim() : ''
    const markers: string[] = await markersOf(cwd)
    if (plan.action === 'absorb') { const row: any = rowOf(rows, plan.path); if (row) { plan.absorbFrom = row.absorbFrom || ''; plan.absorbTo = row.absorbTo || '' } }
    const ticket: any = makeTicket({ id: 's' + nowFn().toString(36) + digest16Of(plan.action + '|' + plan.path + '|' + nowFn()).slice(0, 6), op: plan.action, nowMs: nowFn(), headOid: headOid, indexFingerprint: null, indexEntries: null, target: null, repoRoot: base.root, bindings: bindingsFor(rows, plan, markers, targetExists) } as any)
    ticket.plan = plan
    ticket.decision = decision.decision
    ticket.reasons = decision.reasons
    const action: any = batch ? null : submoduleActionOf(plan.action)
    ticket.confirmRequired = batch ? true : (action ? action.confirm !== false : true)
    ticket.sceneSummary = scene
    tickets.set(ticket.id, ticket)
    while (tickets.size > 200) { const oldest: any = tickets.keys().next().value; tickets.delete(oldest) }
    let task: any = null
    if (plan.kind === 'task') {
      const taskRes: any = submoduleTaskOf(plan.action, plan)
      if (taskRes.ok !== true) return fail('invalid', taskRes.reason, taskRes.message)
      task = { op: taskRes.op }
    }
    return { ok: true, contract: SUBMODULE_CHECK_CONTRACT, version: SUBMODULE_CHECK_VERSION, readAtMs: nowFn(), op: plan.action, decision: decision.decision, reasons: decision.reasons, confirmRequired: ticket.confirmRequired, ticket: { id: ticket.id, op: ticket.op, checkedAtMs: ticket.checkedAtMs, expiresAtMs: ticket.expiresAtMs }, task: task, scene: scene, plan: shownPlanOf(plan), headOid: headOid }
  }
  return { handleGitSubmoduleCheck: handleGitSubmoduleCheck, tickets: tickets, results: results, measure: measure }
}

export const SUBMODULE_CHECK_SOURCE = 'src/host/versionControlSubmodulesCheck.ts'
