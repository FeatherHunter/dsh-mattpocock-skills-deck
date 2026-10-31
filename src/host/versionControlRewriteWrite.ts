/**
 * src/host/versionControlRewriteWrite.ts —— 全库重写的凭票执行：先备份、再起长任务（#1750 T15，规格 #1586 域 5.11）
 *
 * 这个电话只做三件事：核对票（票号、动作、时限、确认）、重新量现场（票后任何一格变化都零进程拒绝）、
 * 先做整仓备份再交给长任务通道。filter-repo 本身耗时不可控，按规格第 5 节走任务通道，
 * 所以这里不直接跑 filter-repo，也不占票据的 120 秒时限；票据只证明「预检结论还新鲜」。
 *
 * 铁律（改之前先读）：
 *   1. 备份没成功就绝不调 taskStart：重写是不可逆动作，宁可不做也不能让人在无备份的情况下开始。
 *   2. 备份失败要回明确原因（磁盘、路径、权限都归环境类失败），不吞成 unknown。
 *   3. 本文件不自己起进程，全部走注入的 runPinned 与 taskStart。
 */
import { failPhone, firstLine } from '../shared/version-control/exec-envelope.js'
import { bindingsVerdict, ticketPureVerdict, requestIdProblem } from '../shared/version-control/src/write-ticket.js'
import { idShapeProblem } from '../shared/version-control/src/write-reasons.js'
import { rewriteFormOf, rewriteTaskTokensOf, rewriteMailmapTextOf, rewriteReplaceTextOf, rewriteGuardProblem } from '../shared/version-control/src/rewrite-ops.js'
import { backupPointOf, backupSummaryOf, backupRestoreStepsOf } from '../shared/version-control/src/recovery-point.js'
import { VC_REWRITE_WRITE_TIMEOUT_MS } from '../shared/time-config/src/values.js'
// 本域 tsconfig 有意不加载 Node 类型包（types 为空），运行时一定是 Node，这些内建模块必然存在。
// @ts-expect-error
import { writeFile, stat, unlink, readdir } from 'node:fs/promises'
// @ts-expect-error
import { tmpdir } from 'node:os'

/** 起一条写命令的输出上限：备份命令的输出只需要读到最后一行结论。 */
const WRITE_LIMIT: number = 1024 * 1024

/** 造执行层；依赖全部由装配壳显式传入。 */
export function createRewriteWrite(deps: any): any {
  const tickets: Map<string, any> = deps.tickets || new Map()
  const results: Map<string, any> = deps.results || new Map()
  const writeTimeoutMs: number = Number(deps.writeTimeoutMs) || VC_REWRITE_WRITE_TIMEOUT_MS
  const now = function (): number { try { return typeof deps.now === 'function' ? Number(deps.now()) : Date.now() } catch (e) { return Date.now() } }

  /** 失败信封：与预检层同一形状，reason 同时写进 error 与顶层。 */
  function wfail(kind: any, reason: any, message: any, extra?: any): any {
    const base: any = failPhone(kind, message)
    base.error.reason = String(reason || '')
    base.reason = String(reason || '')
    if (extra) Object.assign(base, extra)
    return base
  }

  /** 记下这次的请求号 → 结果：同一请求号重放时原样回上一次结果，绝不重复执行。 */
  function remember(requestId: any, out: any): void {
    if (!requestId) return
    results.set(String(requestId), out)
    if (results.size > 500) { const keys: any[] = Array.from(results.keys()); results.delete(keys[0]) }
  }

  /** 写一个临时说明文件（邮件映射或替换说明）：只用系统临时目录，权限收窄，结束就删。 */
  async function writeTemp(tag: string, text: string): Promise<any> {
    const name: string = tag + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.txt'
    const path: string = String(tmpdir()).replace(/\\/g, '/') + '/' + name
    try { await writeFile(path, text, { mode: 0o600, encoding: 'utf8' }) } catch (e) { return wfail('env', 'temp-unavailable', '写不了临时说明文件：' + firstLine(String((e && (e as any).message) || e))) }
    return { ok: true, path: path }
  }

  /** 尽力删临时文件：删不掉也不影响结论（它只是这次执行的材料，不是仓库内容）。 */
  async function dropTemp(path: any): Promise<void> {
    if (!path) return
    try { await unlink(String(path)) } catch (e) { /* 临时文件删不掉就算了 */ }
  }

  /** 递归数一个目录的字节数：镜像备份的对象大小按 KiB 取整会得到 0，所以用实际文件大小兜底。 */
  async function dirBytesOf(dir: string): Promise<number> {
    let total: number = 0
    let names: any[] = []
    try { names = await readdir(dir, { recursive: true, withFileTypes: true }) } catch (e) { return 0 }
    for (let i = 0; i < names.length; i += 1) {
      const item: any = names[i]
      const isFile: boolean = (typeof item.isFile === 'function') ? item.isFile() : item.isFile === true
      if (!item || isFile !== true) continue
      try { const st: any = await stat(String(item.parentPath || item.path || dir) + '/' + String(item.name)); total += Number(st.size) || 0 } catch (e) { /* 数不到的文件跳过，结论里还有 count-objects 兜底 */ }
    }
    return total
  }

  /** 备份镜像目录的实际字节数：与仓库大小口径一致（松散对象 + 打包对象，KiB 相加）。 */
  async function mirrorBytesOf(exe: string, path: string): Promise<any> {
    let res: any
    try { res = await deps.runPinned(exe, path, ['count-objects', '-v'], { timeoutMs: writeTimeoutMs, stdoutLimit: 256 * 1024 }) } catch (e) { return { ok: false } }
    if (!res || res.kind !== 'ok') return { ok: false }
    let loose: number = 0
    let packed: number = 0
    const lines: string[] = String(res.stdout || '').replace(/\r/g, '').split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const m: any = /^size(?:-pack)?:\s*(\d+)/.exec(lines[i])
      if (!m) continue
      if (lines[i].indexOf('size-pack:') === 0) packed = Number(m[1]); else loose = Number(m[1])
    }
    return { ok: true, bytes: (loose + packed) * 1024 }
  }

  /**
   * 做整仓备份：镜像克隆（默认）或整仓打包（磁盘不够时）。成功回 {ok:true,point}；
   * 失败回信封，调用方据此中止——绝不在备份失败后继续重写。
   */
  async function runBackup(cur: any, plan: any, backupPlan: any): Promise<any> {
    const exe: string = cur.exe
    const root: string = cur.repoRoot
    const kind: string = backupPlan && backupPlan.kind === 'bundle' ? 'bundle' : 'mirror'
    const path: string = String((backupPlan && backupPlan.path) || '')
    if (path === '') return { ok: false, out: wfail('blocked', 'backup-failed', '备份路径是空的，不知道该往哪里备份，已中止。') }
    const parent: string = path.replace(/[\\/][^\\/]+$/, '')
    const started: number = Date.now()
    let res: any
    try {
      res = (kind === 'bundle')
        ? await deps.runPinned(exe, root, ['bundle', 'create', path, '--all'], { timeoutMs: writeTimeoutMs, stdoutLimit: WRITE_LIMIT })
        : await deps.runPinned(exe, parent, ['clone', '--mirror', root, path], { timeoutMs: writeTimeoutMs, stdoutLimit: WRITE_LIMIT })
    } catch (e) {
      return { ok: false, out: wfail('env', 'backup-failed', '备份命令没有起进程：' + firstLine(String((e && (e as any).message) || e))) }
    }
    if (!res || res.kind !== 'ok') {
      const said: string = firstLine((res && (res.stderr || res.message)) || '') || '备份命令没有正常结束'
      return { ok: false, out: wfail('env', 'backup-failed', '整仓备份失败，已中止重写（这次没有起 filter-repo）：' + said) }
    }
    const elapsedMs: number = Math.max(0, Date.now() - started)
    let bytes: number = 0
    if (kind === 'bundle') {
      try { const st: any = await stat(path); bytes = Number(st.size) || 0 } catch (e) { bytes = 0 }
    } else {
      const mb: any = await mirrorBytesOf(exe, path)
      // count-objects 的 size 是 KiB 取整，小仓库会给出 0；这时用实际文件大小兜底，别把备份说成 0 字节。
      const walked: number = await dirBytesOf(path)
      bytes = Math.max(mb.ok ? Number(mb.bytes) || 0 : 0, walked)
    }
    const point: any = backupPointOf({ kind: kind, path: path, bytes: bytes, elapsedMs: elapsedMs, atMs: now() })
    if (point.ok !== true) return { ok: false, out: wfail('blocked', 'backup-unreadable', '备份做完了但读不出它的大小，按约定不能拿半份信息继续：' + String(point.message || '')) }
    return { ok: true, point: point.point }
  }

  /** 建临时说明文件（按表单需要），回 {ok:true,mailmapPath,replacePath} 或失败信封。 */
  async function makeMaterials(plan: any): Promise<any> {
    const form: string = String(plan.form || '')
    const out: any = { ok: true, mailmapPath: '', replacePath: '' }
    if (form === 'rewrite-authors') {
      const temp: any = await writeTemp('dsh-rewrite-mailmap', rewriteMailmapTextOf(plan.authors))
      if (temp.ok !== true) return temp
      out.mailmapPath = temp.path
    } else if (form === 'replace-text') {
      const temp: any = await writeTemp('dsh-rewrite-replace', rewriteReplaceTextOf(plan.replacements))
      if (temp.ok !== true) return temp
      out.replacePath = temp.path
    }
    return out
  }

  /**
   * 执行电话：票 → 确认 → 现场重验 → 临时材料 → 备份 → 起长任务。
   * 任何一步拒绝都在起进程之前返回；备份失败则中止且不调 taskStart。
   */
  async function handleRewriteRun(args: any): Promise<any> {
    const a: any = args || {}
    const requestId: any = a.requestId
    if (requestId && results.has(String(requestId))) return { ok: true, reused: true, result: results.get(String(requestId)) }
    const idBad: any = idShapeProblem(a.ticketId)
    if (idBad) return wfail('args', idBad, '票号形状不对：' + String(idBad))
    const rid: any = requestIdProblem(a.requestId)
    if (rid) return wfail('args', rid, '请求号形状不对：' + String(rid))
    const ticket: any = tickets.get(String(a.ticketId))
    if (!ticket) return wfail('args', 'ticket-missing', '找不到这张票：可能已经过期，请重新预检。')
    if (String(ticket.op) !== 'rewrite') return wfail('args', 'ticket-op-mismatch', '这张票不是整仓重写的票。')
    const pure: any = ticketPureVerdict(ticket, 'rewrite' as any, now())
    if (pure && pure.ok !== true) return wfail('blocked', String(pure.reason || 'ticket-expired'), '票不能用了：' + String(pure.reason || ''))
    if (ticket.confirmRequired === true && a.confirmed !== true) return wfail('need-confirm', 'need-confirm', '整仓重写不可逆，要先看过确认卡并明确确认。')
    if (!a.cwd || typeof a.cwd !== 'string') return wfail('args', 'bad-target', '缺少仓库目录。')
    const plan: any = ticket.rewrite || ticket.plan || {}
    const form: any = rewriteFormOf(plan.form)
    if (!form) return wfail('args', 'bad-form', '票里的重写表单认不出来：' + String(plan.form || ''))
    const cur: any = await deps.scene.measure(a.cwd, plan)
    if (cur.ok !== true) return cur
    if (String(cur.repoRoot) !== String(ticket.repoRoot)) return wfail('blocked', 'stale-repo', '预检之后仓库换了目录，请重新预检。')
    if (String(cur.headOid) !== String(ticket.headOid)) return wfail('blocked', 'target-changed', '预检之后 HEAD 变了（有新提交或切换了分支），请重新预检。')
    const bv: any = bindingsVerdict(ticket, cur.bindings)
    if (bv) return wfail('blocked', bv === 'stale-index' ? 'target-changed' : String(bv), '预检之后现场变了（' + String(bv) + '），已零进程拒绝，请重新预检。')
    const guard: any = rewriteGuardProblem(cur.scene, plan)
    if (guard) return wfail('blocked', String(guard), '现场又不满足重写条件了：' + String(guard))
    const backupPlan: any = ticket.backup || deps.scene.backupPlanOf(cur.scene)
    const materials: any = await makeMaterials(plan)
    if (materials.ok !== true) return materials
    const cleanup = function (): void { dropTemp(materials.mailmapPath); dropTemp(materials.replacePath) }
    const backup: any = await runBackup(cur, plan, backupPlan)
    if (backup.ok !== true) { cleanup(); remember(requestId, backup.out); return backup.out }
    const tokensRes: any = rewriteTaskTokensOf(plan.form, plan, { mailmapPath: materials.mailmapPath, replacePath: materials.replacePath })
    if (tokensRes.ok !== true) { cleanup(); const out: any = wfail('args', String(tokensRes.reason || 'bad-form'), '拼不出 filter-repo 的参数：' + String(tokensRes.reason || '')); remember(requestId, out); return out }
    const point: any = backup.point
    let task: any = null
    try {
      task = await deps.taskStart({ cwd: String(cur.repoRoot), op: 'filter-repo', args: tokensRes.tokens, confirm: true, requestId: String(requestId || '') })
    } catch (e) {
      task = wfail('env', 'task-start-failed', '备份已成功，但起长任务失败：' + firstLine(String((e && (e as any).message) || e)), { backup: point, backupSummary: backupSummaryOf(point) })
    }
    if (!task || task.ok !== true) {
      const said: string = firstLine(String((task && task.error && task.error.message) || (task && task.message) || '')) || '长任务通道没有接受这次请求'
      const out: any = wfail('env', 'task-start-failed', '备份已成功，但 filter-repo 任务没有起来：' + said, {
        backup: point,
        backupSummary: backupSummaryOf(point),
        backupHuman: backupSummaryOf(point),
        backupRestoreSteps: backupRestoreStepsOf(point),
      })
      cleanup(); remember(requestId, out); return out
    }
    const out: any = {
      ok: true,
      op: 'rewrite',
      form: String(plan.form),
      ticketId: String(ticket.id),
      backup: point,
      backupSummary: backupSummaryOf(point),
      backupRestoreSteps: backupRestoreStepsOf(point),
      task: task,
      steps: ['backup', 'task'],
      materials: { mailmap: materials.mailmapPath !== '', replace: materials.replacePath !== '' },
      atMs: now(),
    }
    cleanup()
    remember(requestId, out)
    return out
  }

  return { handleRewriteRun: handleRewriteRun, tickets: tickets, results: results }
}
