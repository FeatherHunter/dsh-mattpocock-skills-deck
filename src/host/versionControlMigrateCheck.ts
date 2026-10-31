/**
 * src/host/versionControlMigrate.ts —— 迁移与备份域的宿主取数层（#1759 T23）。
 *
 * 三个入口：
 *   · createMigrateCheck(deps)  —— 预检：读现场、跑参数守卫、签 120 秒票据；只读动作在这一步就把结果读出来。
 *   · createMigrateWrite(deps)  —— 凭票执行：逐格重验绑定后只做一次写动作（init 直接起 git，其余交给长任务通道）。
 *   · createMigrateMount(deps)  —— 两个入口的懒加载、日志包装与失败兜底（装配壳）。
 *
 * 为什么把预检与执行分成两个文件级入口（与分支、改动、同步三域同一套口径，见 versionControlBranchCheck.ts）：
 *   1. 预检只跑只读命令，读到的现场与计划摘要落进票据；用户看到确认卡之后，执行层拿票号重算一遍，
 *      现场任何一格变了就零进程拒绝，不许「先跑起来再说」。
 *   2. 执行层不重新判断动作语义：argv、任务参数与路径都在票据的 plan 里，执行层只核对绑定。
 *
 * fast-import 是本域唯一碰标准输入的动作（规格第 8 节唯一窄例外）：预检核对输入文件的路径、大小与 sha256，
 * 执行时先建新目录、git init，再把同一份文件交给长任务通道的 stdinFile；目标目录必须不存在（票据用
 * pathAbsent 绑定），绝不覆盖或复用现有仓库。
 */
import { makeTicket, makeBindings, ticketPureVerdict, requestIdProblem } from '../shared/version-control/src/write-ticket.js'
import { failPhone, firstLine, failureFromExec } from '../shared/version-control/exec-envelope.js'
import { migrateActionOf, migratePlanOf, migratePlanDigestInput, migrateVersionAtLeast, MIGRATE_CHECK_CONTRACT, MIGRATE_CHECK_VERSION, MIGRATE_ACTIONS_SOURCE } from '../shared/version-control/src/migrate-actions.js'
import { taskArgsFor } from '../shared/version-control/src/task-protocol.js'
import { VC_BRANCH_READ_TIMEOUT_MS as READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'

export const MIGRATE_CHECK_SOURCE = 'src/host/versionControlMigrate.ts'
function failWith(failPhoneFn: any, kind: string, reason: string, message: string, extra?: any): any {
  return failPhoneFn(kind, message, Object.assign({ reason: reason }, extra || {}))
}

function textOfLine(res: any): string {
  if (!res || res.kind !== 'ok') return ''
  return firstLine(res.stdout)
}

// 票据里的「目录里有哪些东西」摘要：排序后拼起来再交给工作树绑定。目录从空变成非空、
// 或者原来列出的东西被换掉，摘要就变，执行层据此拒票。
function listingDigest(entries: string[]): string {
  const sorted = entries.slice().sort()
  return 'dir:' + sorted.length + ':' + sorted.join('|')
}

export function createMigrateCheck(deps: any): any {
  const failPhoneFn: any = deps.failPhone
  const failureFromExec: any = deps.failureFromExec
  const resolveGitExecutable: any = deps.resolveGitExecutable
  const resolveRepoRoot: any = deps.resolveRepoRoot
  const readScreenOf: any = deps.readScreenOf
  const runPinned: any = deps.runPinned
  const nowMs: any = (typeof deps.now === 'function') ? deps.now : Date.now
  const probe: any = deps.probe
  const tickets: Map<string, any> = new Map()
  const results: Map<string, any> = new Map()
  let seq = 0

  function fail(kind: string, reason: string, message: string, extra?: any): any {
    return failWith(failPhoneFn, kind, reason, message, extra)
  }

  function trimTickets(): void {
    if (tickets.size <= 200) return
    const rows: any[] = []
    tickets.forEach(function (t: any): void { rows.push(t) })
    rows.sort(function (a: any, b: any): number { return a.checkedAtMs - b.checkedAtMs })
    while (tickets.size > 200 && rows.length > 0) tickets.delete(rows.shift().id)
  }

  // 预检里要先知道本机 git 版本，才能决定 init 用 --initial-branch 还是建后改名。
  async function gitVersionOf(exe: any, cwd: any): Promise<any> {
    const dir: string = (typeof cwd === 'string' && cwd !== '') ? cwd : String(deps.defaultCwd || '')
    if (dir === '') return { ok: false }
    const res: any = await runPinned(exe, dir, ['--version'], { stdoutLimit: 4096, timeoutMs: READ_TIMEOUT_MS })
    if (!res || res.kind !== 'ok') return { ok: false }
    return { ok: true, version: textOfLine(res) }
  }

  // 只读动作在这里直接读结果：bundle verify 只读包，svn 探测只读本地配置，两者都不联网、不写文件。
  async function readOnlyResult(entry: any, exe: any, root: any, plan: any): Promise<any> {
    if (entry.action === 'bundle-verify') {
      const t0: number = nowMs()
      const res: any = await runPinned(exe, root, ['bundle', 'verify', plan.inputPath], { stdoutLimit: 256 * 1024, timeoutMs: READ_TIMEOUT_MS })
      const ms: number = nowMs() - t0
      if (res && res.kind === 'ok') {
        const lines = String(res.stdout || '').replace(/\r/g, '').split('\n').filter(function (x: string): boolean { return x !== '' })
        return { ok: true, command: 'git bundle verify', ms: ms, n: lines.length, lines: lines.slice(0, 40), truncated: res.truncated === true }
      }
      const says = firstLine(String((res && res.stderr) || ''))
      return { ok: false, git: 'git bundle verify', step: '校验离线包这一步', expected: '离线包能通过校验', actual: says || 'git 没有接受这个文件', cause: '包文件损坏、被截断，或者不是完整的离线包' }
    }
    // svn-probe：只读仓库本地的 svn 关联配置，不联网、不跑 git svn。
    const urlRes: any = await runPinned(exe, root, ['config', '--get', 'svn-remote.svn.url'], { stdoutLimit: 8192, timeoutMs: READ_TIMEOUT_MS })
    const fetchRes: any = await runPinned(exe, root, ['config', '--get', 'svn-remote.svn.fetch'], { stdoutLimit: 8192, timeoutMs: READ_TIMEOUT_MS })
    const url = urlRes && urlRes.kind === 'ok' ? firstLine(String(urlRes.stdout || '')) : ''
    const fetch = fetchRes && fetchRes.kind === 'ok' ? firstLine(String(fetchRes.stdout || '')) : ''
    return { ok: true, readOnly: true, linked: url !== '', url: url, fetch: fetch, command: 'git config --get svn-remote.svn.url', note: url === '' ? '这个仓库没有 svn 关联配置，不是从 svn 克隆来的仓库。' : '这个仓库登记了 svn 关联；抓取一次会走长任务通道，不做 dcommit。' }
  }

  async function checkInit(a: any): Promise<any> {
    const target = String(a.path || '').trim()
    const stat: any = await probe.stat(target)
    if (stat === null) return fail('env', 'path-unreadable', '读不了目标路径是否存在，初始化这一步先停下：再确认一次目录权限后重试')
    if (stat.exists && stat.isDirectory !== true) return fail('blocked', 'not-directory', '目标路径已经存在而且不是目录，不能在这里初始化仓库')
    let entries: string[] = []
    if (stat.exists) {
      const listed: any = await probe.list(target)
      if (listed === null) return fail('env', 'path-unreadable', '读不了目录里的内容，初始化这一步先停下：再确认一次目录权限后重试')
      entries = listed
    }
    // 已经在某个仓库里面时再 git init 会造出嵌套仓库，这一格直接拦下。
    const screen: any = await readScreenOf(target)
    if (screen && screen.ok === true) return fail('blocked', 'already-repo', '这个目录已经在一个 git 仓库里（仓库根：' + String((screen.screen && screen.screen.repo && screen.screen.repo.root) || '') + '），不能再套一个仓库')
    const exe: any = await resolveGitExecutable()
    if (!exe) return fail('env', 'no-git', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    const versionRes: any = await gitVersionOf(exe, a.cwd)
    const initMode: string = versionRes.ok === true ? (migrateVersionAtLeast(versionRes.version, 2, 28) ? 'initial-branch' : 'rename') : 'rename'
    const built: any = migratePlanOf('init', { path: target, branch: a.branch, bare: a.bare === true, initMode: initMode })
    if (built.ok !== true) return fail('blocked', built.reason, built.message)
    const plan: any = built.plan
    const empty = entries.length === 0
    const reasons: any[] = []
    if (stat.exists && !empty) reasons.push({ id: 'dir-not-empty', text: '目录里已经有 ' + entries.length + ' 项内容；初始化只会新增 .git，不会动这些内容', blocking: false })
    if (initMode === 'rename') reasons.push({ id: 'version-degraded', text: plan.versionNote, blocking: false })
    const decision = (stat.exists && !empty) ? 'warn' : 'allow'
    const confirmRequired = decision === 'warn'
    const t = nowMs()
    const ticket = makeTicket({
      id: 'migrate-' + t + '-' + (seq++),
      op: 'init' as any,
      nowMs: t,
      headOid: '',
      indexFingerprint: null,
      indexEntries: 0,
      target: plan,
      repoRoot: target,
      bindings: makeBindings({
        preconditions: { planDigest: migratePlanDigestInput(plan), worktreeDigest: stat.exists ? listingDigest(entries) : '', pathAbsent: stat.exists ? [] : [target] },
        counters: { indexEntries: 0 }
      })
    })
    tickets.set(ticket.id, ticket)
    trimTickets()
    return {
      ok: true,
      contract: MIGRATE_CHECK_CONTRACT,
      version: MIGRATE_CHECK_VERSION,
      action: plan.action,
      capabilityId: plan.id,
      op: plan.op,
      level: plan.level,
      command: plan.commandText,
      decision: decision,
      reasons: reasons,
      confirmRequired: confirmRequired,
      confirm: { verb: '初始化仓库', target: plan.targetText },
      plan: plan,
      ticket: ticket,
      readOnly: false,
      scene: { pathExists: stat.exists === true, dirEntries: entries.length, empty: empty, initMode: initMode, gitVersion: versionRes.ok === true ? versionRes.version : '' },
      readAtMs: t,
      versionPolicy: { need: plan.versionNeed, ok: initMode !== 'rename', degraded: initMode === 'rename', note: plan.versionNote }
    }
  }

  async function checkRepoAction(a: any, entry: any): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return fail('env', 'no-git', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    const screen: any = await readScreenOf(String(a.cwd || ''))
    if (screen.ok !== true) return screen
    const base: any = await resolveRepoRoot(exe, String(a.cwd || ''))
    if (base.ok !== true) return base
    // 取根与 measure(cwd) 只有一处口径：都用 rev-parse --show-toplevel 的结果（首屏里叫 identity.worktreePath），
    // 免得签票用一种写法、执行重算用另一种写法，同一个仓库被当成两个（#1759 调试时踩过）。
    const root = base.root
    const input: any = {}
    let plan: any = null
    if (entry.action === 'archive') { input.outputPath = a.outputPath; input.ref = a.ref }
    else if (entry.action === 'bundle-create') { input.outputPath = a.outputPath; input.ref = a.ref }
    else if (entry.action === 'bundle-verify' || entry.action === 'bundle-unbundle') input.filePath = a.filePath
    else if (entry.action === 'fast-export') input.outputPath = a.outputPath
    else if (entry.action === 'fast-import') { input.targetPath = a.targetPath; input.filePath = a.filePath; input.branch = a.branch }
    else if (entry.action === 'svn-fetch') input.url = a.url
    // 输入文件（离线包、fast-import 的导入流）先核存在与摘要，再把摘要写进票据；执行时不会重读同一份文件的旧内容。
    if (entry.action === 'bundle-verify' || entry.action === 'bundle-unbundle' || entry.action === 'fast-import') {
      const stat: any = await probe.stat(String(input.filePath || ''))
      if (stat === null) return fail('env', 'path-unreadable', '读不了输入文件的信息，这一步先停下：再确认一次文件权限后重试')
      if (!stat.exists) return fail('blocked', 'input-missing', '输入文件不存在：' + String(input.filePath || ''))
      if (stat.isFile !== true) return fail('blocked', 'input-not-file', '输入路径不是普通文件：' + String(input.filePath || ''))
      const digest: any = await probe.digest(String(input.filePath || ''))
      if (digest === null) return fail('env', 'path-unreadable', '读不了输入文件的摘要，这一步先停下：文件可能正被别的程序占用')
      input.fileSha256 = digest.sha256
      input.fileSizeBytes = digest.sizeBytes
    }
    if (entry.action === 'fast-import') {
      const targetStat: any = await probe.stat(String(input.targetPath || ''))
      if (targetStat === null) return fail('env', 'path-unreadable', '读不了目标路径是否存在，导入这一步先停下')
      if (targetStat.exists) return fail('blocked', 'target-exists', '导入目标必须不存在；现在这个路径已经有了东西：' + String(input.targetPath || ''))
    }
    if (entry.action === 'archive' || entry.action === 'bundle-create' || entry.action === 'fast-export') {
      const outStat: any = await probe.stat(String(input.outputPath || ''))
      if (outStat === null) return fail('env', 'path-unreadable', '读不了输出路径是否存在，这一步先停下')
      if (outStat.exists) return fail('blocked', 'output-exists', '输出文件已经存在，不覆盖：' + String(input.outputPath || ''))
    }
    const built: any = migratePlanOf(entry.action, input)
    if (built.ok !== true) return fail('blocked', built.reason, built.message)
    plan = built.plan
    if (plan.inputPath !== '') plan.input = { path: plan.inputPath, sizeBytes: input.fileSizeBytes, sha256: input.fileSha256 }
    if (plan.op === 'fast-import') plan.input = { path: plan.inputPath, sizeBytes: input.fileSizeBytes, sha256: input.fileSha256 }
    // 长任务参数先过一遍共享层守卫：守卫不过的动作在预检就拒绝，不签注定跑不起来的票。
    // 只读动作（离线包校验、svn 探测）不在长任务清单里，不能拿 taskArgsFor 去校验它们。
    if (entry.task === true) {
      const builtArgs: any = taskArgsFor(plan.op, plan.taskArgs)
      if (builtArgs.ok !== true) return fail('blocked', 'bad-task-args', '这个动作的参数拼不成受支持的命令：' + String(builtArgs.message || builtArgs.reason || ''))
    }
    const reasons: any[] = []
    const planNeedsConfirm = plan.needsConfirm === true
    if (entry.action === 'fast-import') reasons.push({ id: 'import-new-dir', text: '导入只会写进新的空目录 ' + plan.targetPath + '，不会覆盖或复用现有仓库', blocking: false })
    if (entry.action === 'svn-fetch') reasons.push({ id: 'svn-fetch-once', text: '只抓取一次，不做 dcommit；抓下来的提交留在本地，可以随时停', blocking: false })
    if (entry.action === 'fast-export') reasons.push({ id: 'export-readonly-source', text: '导出只读仓库历史，不改任何提交；产物是一份文本文件', blocking: false })
    const decision = planNeedsConfirm ? 'warn' : 'allow'
    const confirmRequired = planNeedsConfirm
    let readOnlyResult: any = null
    if (entry.readOnly === true) {
      readOnlyResult = await readOnlyResultOf(entry, exe, root, plan)
      const ro = nowMs()
      return {
        ok: true,
        contract: MIGRATE_CHECK_CONTRACT,
        version: MIGRATE_CHECK_VERSION,
        action: plan.action,
        capabilityId: plan.id,
        op: plan.op,
        level: plan.level,
        command: plan.commandText,
        decision: 'allow',
        reasons: reasons,
        confirmRequired: false,
        confirm: null,
        plan: plan,
        ticket: null,
        readOnly: true,
        result: readOnlyResult,
        scene: { root: root, gitVersion: String(screen.gitVersion || '') },
        readAtMs: ro,
        versionPolicy: { need: '', ok: true, degraded: false, note: '' }
      }
    }
    const t = nowMs()
    const ticket = makeTicket({
      id: 'migrate-' + t + '-' + (seq++),
      op: plan.op as any,
      nowMs: t,
      headOid: String((screen.screen && screen.screen.identity && screen.screen.identity.oid) || ''),
      indexFingerprint: null,
      indexEntries: Number((screen.screen && screen.screen.stagedCount) || 0),
      target: plan,
      repoRoot: root,
      bindings: makeBindings({
        preconditions: { planDigest: migratePlanDigestInput(plan), pathAbsent: plan.pathAbsent },
        counters: { indexEntries: Number((screen.screen && screen.screen.stagedCount) || 0) }
      })
    })
    tickets.set(ticket.id, ticket)
    trimTickets()
    return {
      ok: true,
      contract: MIGRATE_CHECK_CONTRACT,
      version: MIGRATE_CHECK_VERSION,
      action: plan.action,
      capabilityId: plan.id,
      op: plan.op,
      level: plan.level,
      command: plan.commandText,
      decision: decision,
      reasons: reasons,
      confirmRequired: confirmRequired,
      confirm: confirmRequired ? { verb: plan.action === 'svn-fetch' ? '抓取一次 svn 提交' : '导入历史到新仓库', target: plan.targetText } : { verb: '执行', target: plan.targetText },
      plan: plan,
      ticket: ticket,
      readOnly: false,
      scene: { root: root, gitVersion: String(screen.gitVersion || '') },
      readAtMs: t,
      versionPolicy: { need: '', ok: true, degraded: false, note: '' }
    }
  }

  async function readOnlyResultOf(entry: any, exe: any, root: any, plan: any): Promise<any> {
    return readOnlyResult(entry, exe, root, plan)
  }

  async function handleGitMigrateCheck(args: any): Promise<any> {
    const entry = migrateActionOf(args && args.action)
    if (entry === null) return fail('args', 'unknown-action', '不认识的迁移动作：' + String((args && args.action) || ''))
    const a = args || {}
    if (entry.action === 'init') {
      if (typeof a.path !== 'string' || a.path.trim() === '') return fail('args', 'path-required', '初始化仓库需要一个目标目录')
      return checkInit(a)
    }
    if (typeof a.cwd !== 'string' || a.cwd.trim() === '') return fail('args', 'cwd-required', '这个动作要绑定一个仓库目录')
    return checkRepoAction(a, entry)
  }

  /** 供执行层重算现场用（与同步域同形）：仓库根、HEAD 与首屏读数一起回，重算口径只有一处。 */
  async function measure(cwd: any): Promise<any> {
    const screen: any = await readScreenOf(cwd)
    if (screen.ok !== true) return { ok: false, envelope: screen }
    const root = String((screen.screen && screen.screen.identity && screen.screen.identity.worktreePath) || '')
    return { ok: true, root: root, headOid: String((screen.screen && screen.screen.identity && screen.screen.identity.oid) || ''), screen: screen.screen }
  }

  return { handleGitMigrateCheck: handleGitMigrateCheck, tickets: tickets, results: results, measure: measure, fail: fail, probe: probe, now: nowMs }
}

