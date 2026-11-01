/**
 * src/host/versionControlMaintenanceWrite.ts —— 维护动作的凭票执行（#1758 T22，规格 #1586 域 11）
 *
 * 这个电话做三件事：核对票（票号、动作、时限、确认）、重新量现场（票后任何一格变化都零进程拒绝）、
 * 按动作起事：垃圾回收 / 清除不可达对象 / 立即跑自动维护走长任务通道；开启与关闭自动维护走本地命令。
 * 清除不可达对象在起任务前必须先做整仓备份，备份失败就中止——这是本票最硬的一条铁律。
 *
 * 铁律（改之前先读）：
 *   1. 备份没成功就绝不调 taskStart；备份失败要回明确原因，不吞成 unknown。
 *   2. 本文件不自己起进程：读走 read 叶、命令走注入的 runPinned、长任务走注入的 taskStart。
 *   3. 同一请求号重放回上一次结果，绝不重复执行（重复点击不应该删两次对象）。
 */
import { failPhone, firstLine } from '../shared/version-control/exec-envelope.js'
import { bindingsVerdict, ticketPureVerdict, requestIdProblem } from '../shared/version-control/src/write-ticket.js'
import { idShapeProblem, classifyWriteFailure, writeHintFor } from '../shared/version-control/src/write-reasons.js'
import { backupSummaryOf, backupRestoreStepsOf } from '../shared/version-control/src/recovery-point.js'
import {
  maintenanceWriteOpOf,
  maintenanceTaskRequestOf,
  maintenanceLocalStepsOf,
  maintenanceSceneProblem,
  maintenanceVersionProblem,
  maintenanceRequiresBackupOf,
} from '../shared/version-control/src/maintenance-ops.js'
import { VC_MAINTENANCE_WRITE_TIMEOUT_MS } from '../shared/time-config/src/values.js'

/** 起一条写命令的输出上限：本地维护命令的输出只需要读到最后一行结论。 */
const WRITE_LIMIT: number = 1024 * 1024
/** 结果表上限：同一请求号重放要能命中，超过就删最旧的一条。 */
const RESULT_MAX: number = 500

/** 造执行层；依赖全部由装配壳显式传入。 */
export function createMaintenanceWrite(deps: any): any {
  const read: any = deps.read
  const tickets: Map<string, any> = deps.tickets || new Map()
  const results: Map<string, any> = deps.results || new Map()
  const writeTimeoutMs: number = Number(deps.writeTimeoutMs) || VC_MAINTENANCE_WRITE_TIMEOUT_MS
  const now = function (): number { try { return typeof deps.now === 'function' ? Number(deps.now()) : Date.now() } catch (e) { return Date.now() } }

  /** 失败信封：与其它页同一形状，reason 同时写进 error 与顶层。 */
  function wfail(kind: any, reason: any, message: any, extra?: any): any {
    const base: any = failPhone(kind, message)
    base.error.reason = String(reason || '')
    base.reason = String(reason || '')
    if (extra) Object.assign(base, extra)
    return base
  }

  /** 记下请求号 → 结果：同一请求号重放时原样回上一次结果。 */
  function remember(requestId: any, out: any): void {
    if (!requestId) return
    results.set(String(requestId), out)
    if (results.size > RESULT_MAX) { const keys: any[] = Array.from(results.keys()); results.delete(keys[0]) }
  }

  /** 跑本地维护步骤（开启/关闭自动维护）：逐步执行，任一步失败就停并如实报出是哪一步。 */
  async function runSteps(exe: string, root: string, steps: string[][]): Promise<any> {
    const ran: string[][] = []
    for (let i = 0; i < steps.length; i += 1) {
      const argv: string[] = steps[i]
      let res: any
      try { res = await deps.runPinned(exe, root, argv, { timeoutMs: writeTimeoutMs, stdoutLimit: WRITE_LIMIT }) } catch (e) { return wfail('env', 'unknown', '维护命令没有起进程：' + firstLine(String((e && (e as any).message) || e))) }
      ran.push(argv)
      if (!res || res.kind !== 'ok') {
        const said: string = firstLine((res && (res.stderr || res.message)) || '') || '命令没有正常结束'
        const reason: string = classifyWriteFailure(argv[0] as any, res && res.exitCode, said)
        return wfail('git-failed', reason, '维护命令「git ' + argv.join(' ') + '」失败：' + said, { git: said, step: argv.join(' '), argv: argv, ran: ran })
      }
    }
    return { ok: true, argv: steps, ran: ran }
  }

  /**
   * 凭票执行：先核对再动手。拒绝路径一律零进程（不量完现场不动任何命令）；
   * 危险动作在起任务前先备份，备份失败回原因并中止。
   */
  async function handleMaintenanceWrite(args: any): Promise<any> {
    const a: any = args || {}
    const requestId: string = a.requestId ? String(a.requestId) : ''
    if (requestId !== '' && results.has(requestId)) return { ok: true, reused: true, result: results.get(requestId) }
    const ticketId: string = a.ticketId ? String(a.ticketId) : ''
    const idBad: string | null = idShapeProblem(ticketId)
    if (idBad) return wfail('args', idBad, idBad, { hint: writeHintFor(idBad) })
    const ridBad: string | null = requestIdProblem(requestId)
    if (ridBad) return wfail('args', ridBad, ridBad, { hint: writeHintFor(ridBad) })
    const ticket: any = tickets.get(ticketId)
    if (!ticket) return wfail('blocked', 'ticket-missing', '找不到这张预检票：可能已经过期或面板刷新过，请重新点一次。')
    const op: string = String(a.op || '')
    if (String(ticket.op || '') !== op) return wfail('blocked', 'ticket-op-mismatch', '这张票是给另一个动作签的，请按当前动作重新预检。')
    const meta: any = maintenanceWriteOpOf(op)
    if (meta === null) return wfail('args', 'bad-target', '维护页能执行的动作里没有：' + op)
    const pure: any = ticketPureVerdict(ticket, op as any, now())
    if (!pure.ok) return wfail(pure.reason === 'ticket-expired' ? 'blocked' : 'blocked', pure.reason, pure.reason === 'ticket-expired' ? '这张票已经超过 120 秒，现场可能变了，请重新确认一次。' : '这张票与当前动作对不上，请重新预检。')
    if (a.confirmed !== true) return wfail('need-confirm', 'need-confirm', '危险或会动对象库的动作必须先在确认卡里确认。')
    if (typeof a.cwd !== 'string' || a.cwd.trim() === '') return wfail('args', 'bad-target', '缺少仓库目录，不知道该维护哪个仓库。')
    const plan: any = ticket.plan || { op: op, mode: '' }
    const measured: any = await read.measure(a.cwd, plan)
    if (measured.ok !== true) return measured
    const scene: any = measured.scene
    if (measured.repoRoot !== ticket.repoRoot) return wfail('blocked', 'stale-repo', '票里的仓库目录和现在的不一致，请重新预检。')
    if (measured.headOid !== ticket.headOid) return wfail('blocked', 'target-changed', '预检之后 HEAD 动过了，现场变了，请重新确认。')
    const bindingsBad: string | null = bindingsVerdict(ticket, measured.bindings)
    if (bindingsBad !== null) return wfail('blocked', bindingsBad === 'stale-index' ? 'target-changed' : bindingsBad, bindingsBad === 'stale-index' ? '预检之后索引变过了，请重新确认。' : '预检之后现场变了，请重新确认。')
    const sceneProblem: string | null = maintenanceSceneProblem({ repoBare: false, operation: scene.operation })
    if (sceneProblem !== null) return wfail('blocked', sceneProblem, '这个仓库现在不能做维护动作（有合并或变基正在进行），请先收尾。')
    const versionProblem: string | null = maintenanceVersionProblem(meta, scene.gitVersion)
    if (versionProblem !== null) return wfail('blocked', versionProblem, '这个 git 版本（' + scene.gitVersion + '）已经不支持这个动作了，请刷新后再看。')

    let backup: any = null
    if (maintenanceRequiresBackupOf(op)) {
      backup = ticket.backup || read.backupPlanOf(scene)
      const backed: any = await deps.backup.runBackup(measured.exe || 'git', measured.repoRoot, backup)
      if (backed.ok !== true) return wfail(backed.reason === 'backup-unreadable' ? 'blocked' : 'env', backed.reason || 'backup-failed', backed.message, { backup: backup })
      backup = Object.assign({}, backup, backed.point)
    }

    const taskReq: any = maintenanceTaskRequestOf(op)
    if (taskReq !== null) {
      let launched: any = null
      try { launched = await deps.taskStart({ cwd: measured.repoRoot, op: taskReq.op, args: taskReq.args, confirm: true, requestId: requestId || undefined }) } catch (e) { launched = null }
      if (!launched || launched.ok !== true) {
        const said: string = firstLine(String((launched && launched.error && launched.error.message) || '任务通道没有接受这次请求'))
        const out: any = wfail('env', 'task-start-failed', '长任务没有起来：' + said, backup ? { backup: backup } : {})
        remember(requestId, out)
        return out
      }
      const out: any = {
        ok: true, op: op, capId: meta.capId, kind: 'task', ticketId: ticketId, command: meta.command,
        task: launched.task || null, steps: backup ? ['backup', 'task'] : ['task'], atMs: now(),
      }
      if (backup) { out.backup = backup; out.backupSummary = backupSummaryOf(backup); out.backupRestoreSteps = backupRestoreStepsOf(backup) }
      remember(requestId, out)
      return out
    }

    const steps: string[][] = maintenanceLocalStepsOf(op)
    const local: any = await runSteps(measured.exe || 'git', measured.repoRoot, steps)
    if (local.ok !== true) { remember(requestId, local); return local }
    const status: any = await read.maintenanceStatusOf(measured.exe || 'git', measured.repoRoot, scene.gitVersion)
    const out: any = {
      ok: true, op: op, capId: meta.capId, kind: 'local', ticketId: ticketId, command: meta.command,
      argv: steps, maintenance: status && status.ok === true ? { registered: status.registered, registeredLocal: status.registeredLocal, registeredGlobal: status.registeredGlobal, enabledTasks: status.enabledTasks, strategy: status.strategy } : null,
      atMs: now(),
    }
    remember(requestId, out)
    return out
  }

  return {
    handleMaintenanceWrite: handleMaintenanceWrite,
    tickets: tickets,
    results: results,
  }
}
