// host/versionControlClone.ts —— 域 8 克隆向导的执行层（#1756 T20，能力 8.16）
//
// 三条电话里的两条（第三条是只读的 wf.gitBranches 之外的 wf.gitCloneCheck / wf.gitCloneWrite）：
//   · wf.gitCloneCheck：读一次现场（当前仓库的地址、目标路径的现状、选项形状），判定 allow / warn / block，
//     allow 或 warn 时签一张 120 秒的票；block 也回现场，界面才画得出「为什么不能点」。
//   · wf.gitCloneWrite：只认票，不认参数。凭票执行前把「计划 + 目标现场」按预检时的口径重算一遍，
//     对不上就是 target-changed，一个进程都不起。执行时把克隆交给 T05 长任务通道（wf.gitTaskStart），
//     进度、取消、残留说明都由那条通道负责；本文件不自己起 git 进程。
//   · cleanup 动作：删除取消后残留的目标目录。只删在本次会话里登记过的克隆目标（预检过一次就算登记），
//     并且先问一句「这个目录里已经有一个能解析出 HEAD 的仓库了吗」——有就拒绝，免得把一份克隆成功的仓库删掉。
//
// 为什么两个电话住在一个文件：票据表、残留登记表、requestId 去重表必须是同一份；
//   拆成两个文件就要靠装配层传三张表，票面要求「票与执行共享同一套出口」，同文件最省事也最不容易传错。
//   父文件只留两行注册（它贴着 350 有效行上限），装配与缓存收在文件末尾的 clonePhonesOf。

import { makeBindings, makeTicket, requestIdProblem, ticketPureVerdict } from '../shared/version-control/src/write-ticket.js'
import { idShapeProblem } from '../shared/version-control/src/write-reasons.js'
import { CLONE_CHECK_CONTRACT, CLONE_CHECK_VERSION, cloneCleanupProblem, clonePlanDigestInput, clonePlanOf, cloneTargetProblem, cloneTargetStateOk, cloneTargetSummaryOf, cloneTaskArgsOf } from '../shared/version-control/src/clone-ticket.js'
import { cloneHardlinkNote, cloneMaskedUrl, cloneOfflineProblem, cloneOptionsOf, clonePathProblem, cloneUrlProblem } from '../shared/version-control/src/clone-options.js'
import { VC_CLONE_READ_TIMEOUT_MS as CLONE_READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'

/** 克隆域自己的理由表：标识符只在这一个文件里出现，界面按标识符翻词条，英文界面不会串出中文。 */
const CLONE_REASONS: any = {
  'target-not-empty': '目标目录里已经有东西了；克隆只往空目录或还不存在的目录里写，我不会替你清空它',
  'target-not-directory': '目标路径已经是一个文件，不能当克隆目录',
  'target-unreadable': '读不出目标路径的现状（可能是权限问题）；说不准能不能写，就不动手',
  'nothing-to-clean': '这个目录已经不存在了，没有什么可清理',
  'target-looks-complete': '这个目录里已经有一个能解析出 HEAD 的仓库，看着不像残留；为免误删，本面板不清理它',
  'cleanup-unregistered': '只清理本次会话里登记过的克隆目标目录；这个路径没有登记，可能是你别的目录，不动它',
  'bad-url': '地址形状不合法',
  'bad-path': '目标目录形状不合法',
  'bad-depth': '深度不合法',
  'bad-branch': '分支名不合法',
  'offline-remote': '离线模式连不了远端地址',
  'hardlink-source': '离线克隆本机仓库会与源仓库共享对象文件，源仓库删改后这份可能读不出来',
  'target-missing': '目标目录在这几秒里被删掉了，重新预检一次再动手',
  'ticket-missing': '这张票找不到（预检没签过，或缓存已经过期）；重新预检一次',
  'ticket-expired': '这张票已经过期（预检后超过 120 秒）；重新预检一次再动手',
  'ticket-op-mismatch': '这张票是给另一个动作签的，不能拿来做这个动作',
  'need-confirm': '这一步要你确认一下再动手',
  'stale-repo': '当前工作区的仓库根与预检时不一致（换了目录？）；重新预检一次',
  'target-changed': '预检之后目标目录或克隆选项变了（被别的程序建起来、删掉或改了）；重新预检一次',
  'remove-failed': '删除残留目录时失败',
  'task-refused': '长任务通道没有接下这次克隆',
}

/** 把理由标识符翻成一句人话；不认识的标识符原样回，绝不编一句可能误导人的话。 */
function cloneReasonText(id: any): string {
  const key = String(id === undefined || id === null ? '' : id)
  return CLONE_REASONS[key] || key || '预检没有通过'
}

function cloneIdOf(nowMs: number): string {
  return 'clone-' + String(nowMs) + '-' + Math.random().toString(36).slice(2, 10)
}

export function createClonePhones(deps: any): any {
  const failPhone: any = deps.failPhone
  const firstLine: any = deps.firstLine
  const runPinned: any = deps.runPinned
  const resolveGitExecutable: any = deps.resolveGitExecutable
  const resolveRepoRoot: any = deps.resolveRepoRoot
  const cwdOf: any = deps.cwdOf
  const fs: any = deps.fs
  const pathExists: any = deps.pathExists
  const nowFn: any = typeof deps.now === 'function' ? deps.now : Date.now
  const taskStart: any = deps.taskStart
  const removeTree: any = deps.removeTree
  const tickets: any = new Map()
  const results: any = new Map()
  const residuals: any = new Map()

  /** 目标路径现状：不存在 / 空目录 / 非空目录 / 文件 / 读不出来。每一步各自给结论，一条探测抛错不许否决别的。 */
  async function probeTarget(abs: string): Promise<any> {
    const base: any = { path: abs, state: 'unreadable', entryCount: 0, entries: [], sizeBytes: null, error: null }
    if (typeof pathExists === 'function') {
      try {
        const there: any = await pathExists(abs)
        if (there === false) return Object.assign({}, base, { state: 'absent' })
      } catch (e) { base.error = String((e && (e as any).message) || e) }
    }
    if (fs && typeof fs.resolve === 'function' && typeof fs.listDir === 'function') {
      try {
        const target: any = await fs.resolve(abs)
        const listed: any = await fs.listDir(target)
        const names: string[] = (Array.isArray(listed) ? listed : []).map(function (one: any): string {
          if (typeof one === 'string') return one
          return String((one && (one.name || one.path)) || '')
        })
        return Object.assign({}, base, { state: names.length ? 'non-empty-dir' : 'empty-dir', entryCount: names.length, entries: names })
      } catch (e) {
        // 目录列不出来时可能是文件，继续往下问 stat；最后都不成才算读不出来。
        base.error = String(((e as any) && ((e as any).code || (e as any).message)) || e)
      }
    }
    if (fs && typeof fs.resolve === 'function' && typeof fs.stat === 'function') {
      try {
        const target: any = await fs.resolve(abs)
        const st: any = await fs.stat(target)
        return Object.assign({}, base, { state: 'file', sizeBytes: st && typeof st.size === 'number' ? st.size : null })
      } catch (e) {
        base.error = String(((e as any) && ((e as any).code || (e as any).message)) || e)
      }
    }
    return base
  }

  /** 当前仓库这一侧：仓库根、当前仓库来自哪里（只作「要克隆到这里吗」的提示，读不出来不拦人）。 */
  async function baseOf(args: any): Promise<any> {
    const cwd: string = cwdOf(args)
    const exe: any = await resolveGitExecutable()
    if (!exe) return { ok: false, envelope: failPhone('env', '这台机器上找不到 git 命令，克隆跑不了') }
    const base: any = await resolveRepoRoot(exe, cwd)
    if (!base || base.ok !== true) return { ok: false, envelope: base }
    let origin: string | null = null
    try {
      const res: any = await runPinned(exe, base.root, ['config', '--get', 'remote.origin.url'], { stdoutLimit: 65536, timeoutMs: CLONE_READ_TIMEOUT_MS })
      if (res && res.kind === 'ok') {
        const text = String(res.stdout || '').replace(/\r/g, '').trim()
        origin = text ? cloneMaskedUrl(text) : null
      }
    } catch (e) { origin = null }
    return { ok: true, exe: exe, cwd: cwd, root: base.root, origin: origin, kind: base.kind }
  }

  /** 票里绑的计划摘要：哈希走 node:crypto，只在宿主做（共享层不带 Node 依赖）。 */
  async function digest16Of(text: string): Promise<string> {
    try {
      // @ts-expect-error 宿主类型检查不带 Node 类型（见 src/host/versionControlChanges.ts:17 先例），node: 模块只在运行期存在
      const crypto: any = await import('node:crypto')
      const hex: string = crypto.createHash('sha256').update(text, 'utf8').digest('hex')
      return hex.slice(0, 16)
    } catch (e) {
      return '0000000000000000'
    }
  }

  /** 预检的公共骨架：地址、目录、选项、离线四道形状关；再读目标现场与当前仓库。 */
  async function inspect(args: any, op: string): Promise<any> {
    const base: any = await baseOf(args)
    if (base.ok !== true) return { ok: false, envelope: base.envelope }
    let plan: any
    if (op === 'start') {
      const urlProblem = cloneUrlProblem(args && args.url)
      if (urlProblem) return { ok: false, envelope: failPhone('args', urlProblem, { reason: 'bad-url' }) }
      const pathProblem = clonePathProblem(args && args.dir)
      if (pathProblem) return { ok: false, envelope: failPhone('args', pathProblem, { reason: 'bad-path' }) }
      const options: any = cloneOptionsOf({
        depth: args && args.depth, branch: args && args.branch,
        recurseSubmodules: args && args.recurseSubmodules, shallowSubmodules: args && args.shallowSubmodules,
        offline: args && args.offline,
      })
      if (options.ok !== true) return { ok: false, envelope: failPhone('args', options.message, { reason: options.reason }) }
      const offlineProblem = args && args.offline === true ? cloneOfflineProblem(args.url) : null
      if (offlineProblem) return { ok: false, envelope: failPhone('args', offlineProblem, { reason: 'offline-remote' }) }
      const built = clonePlanOf('start', Object.assign({}, args, options.options))
      if (built.ok !== true) return { ok: false, envelope: failPhone('args', built.message, { reason: built.reason }) }
      plan = built.plan
    } else {
      const pathProblem = clonePathProblem(args && args.dir)
      if (pathProblem) return { ok: false, envelope: failPhone('args', pathProblem, { reason: 'bad-path' }) }
      const built = clonePlanOf('cleanup', args)
      if (built.ok !== true) return { ok: false, envelope: failPhone('args', built.message, { reason: built.reason }) }
      plan = built.plan
    }
    const rawTarget: any = await probeTarget(plan.dir)
    if (!cloneTargetStateOk(rawTarget)) return { ok: false, envelope: failPhone('parse', '读回来的目标现场形状不对（状态或条目清单缺失）') }
    return { ok: true, plan: plan, target: rawTarget, base: base }
  }

  async function handleCheck(args: any): Promise<any> {
    const op: string = String((args && args.op) || 'start')
    if (['start', 'cleanup'].indexOf(op) < 0) return failPhone('args', '不认识的克隆动作：' + op + '（允许：start / cleanup）', { reason: 'bad-op' })
    const inspected: any = await inspect(args || {}, op)
    if (inspected.ok !== true) return inspected.envelope
    const plan: any = inspected.plan
    const target: any = inspected.target
    const summary: any = cloneTargetSummaryOf(target)
    const scene: any = {
      current: { root: inspected.base.root, origin: inspected.base.origin },
      target: summary,
      options: op === 'start' ? plan : null,
      maskedUrl: op === 'start' ? cloneMaskedUrl(plan.url) : null,
      cleanup: op === 'cleanup' ? { registered: residuals.has(plan.dir) } : null,
    }
    let decision: any = { verdict: 'allow', reasons: ['ok'] }
    if (op === 'start') {
      const problem = cloneTargetProblem(target)
      if (problem) decision = { verdict: 'block', reasons: [problem] }
      else {
        const note = plan.offline === true ? cloneHardlinkNote(plan.url, plan) : null
        if (note) decision = { verdict: 'warn', reasons: ['hardlink-source'], notes: [note] }
      }
    } else {
      const problem = cloneCleanupProblem(target)
      if (problem) decision = { verdict: 'block', reasons: [problem] }
      else if (!residuals.has(plan.dir)) decision = { verdict: 'block', reasons: ['cleanup-unregistered'] }
      else {
        // 目录里已经有一个能解析出 HEAD 的仓库：那是克隆成功或用户自己的仓库，不能当残留删。
        const verify: any = await runPinned(inspected.base.exe, plan.dir, ['rev-parse', '-q', '--verify', 'HEAD'], { stdoutLimit: 8192, timeoutMs: CLONE_READ_TIMEOUT_MS })
        if (verify && verify.kind === 'ok') decision = { verdict: 'block', reasons: ['target-looks-complete'] }
      }
    }
    const readAtMs: number = nowFn()
    if (decision.verdict === 'block') {
      return {
        ok: false,
        error: { kind: 'blocked', message: cloneReasonText(decision.reasons[0]) },
        reason: decision.reasons[0],
        contract: CLONE_CHECK_CONTRACT, version: CLONE_CHECK_VERSION, op: op, readAtMs: readAtMs,
        decision: decision, confirmRequired: false, confirm: null, scene: scene,
      }
    }
    if (op === 'start') residuals.set(plan.dir, { dir: plan.dir, registeredAtMs: readAtMs })
    const digest: string = await digest16Of(clonePlanDigestInput(plan, target))
    const ticket: any = makeTicket({
      id: cloneIdOf(readAtMs),
      op: plan.op as any,
      nowMs: readAtMs,
      // 克隆票不绑定「执行前 HEAD 不变」那一格：目标目录还不存在，没有 HEAD 可记，按空串记。
      headOid: '',
      indexFingerprint: null,
      indexEntries: null,
      target: null,
      repoRoot: inspected.base.root,
      bindings: makeBindings({ preconditions: { planDigest: digest } }),
    })
    ticket.plan = plan
    ticket.decision = decision
    ticket.confirmRequired = decision.verdict === 'warn' || op === 'cleanup'
    const confirm = op === 'start'
      ? { kind: 'clone', target: summary.path, verb: decision.verdict === 'warn' ? '仍然克隆' : '开始克隆' }
      : { kind: 'cleanup', target: summary.path, verb: '删除残留目录' }
    tickets.set(ticket.id, ticket)
    while (tickets.size > 200) { const first: any = tickets.keys().next(); if (first && !first.done) tickets.delete(first.value); else break }
    return {
      ok: true, contract: CLONE_CHECK_CONTRACT, version: CLONE_CHECK_VERSION, op: op, readAtMs: readAtMs,
      decision: decision, reasons: decision.reasons, confirmRequired: ticket.confirmRequired, confirm: confirm,
      ticket: { id: ticket.id, op: ticket.op, checkedAtMs: ticket.checkedAtMs, expiresAtMs: ticket.expiresAtMs },
      scene: scene,
    }
  }

  /** 执行前的现场重算：目标现场与当前仓库根都照预检口径再读一遍，票里的摘要对不上就拒。 */
  async function measure(cwd: string, plan: any): Promise<any> {
    const inspected: any = await inspect(Object.assign({}, plan, { op: plan.op }), plan.op)
    if (inspected.ok !== true) return { ok: false, envelope: inspected.envelope }
    return {
      ok: true,
      repoRoot: inspected.base.root,
      planDigest: await digest16Of(clonePlanDigestInput(inspected.plan, inspected.target)),
      target: cloneTargetSummaryOf(inspected.target),
    }
  }

  function remember(requestId: string, out: any): void {
    if (!requestId) return
    results.set(requestId, out)
    while (results.size > 500) { const first: any = results.keys().next(); if (first && !first.done) results.delete(first.value); else break }
  }

  async function handleWrite(args: any): Promise<any> {
    const a: any = args || {}
    const requestId: string = String(a.requestId === undefined || a.requestId === null ? '' : a.requestId)
    const replay: any = requestId ? results.get(requestId) : null
    if (replay) return { ok: replay.ok === true, reused: true, result: replay }
    const ticketId: string = String(a.ticketId === undefined || a.ticketId === null ? '' : a.ticketId)
    const idProblem: string | null = idShapeProblem(ticketId)
    if (idProblem) return failPhone('args', idProblem, { reason: 'bad-ticket-id' })
    const requestProblem: string | null = requestIdProblem(requestId)
    if (requestProblem) return failPhone('args', requestProblem, { reason: 'bad-request-id' })
    const ticket: any = tickets.get(ticketId)
    if (!ticket) return failPhone('blocked', '这张票找不到（预检没签过，或缓存已经过期）；重新预检一次', { reason: 'ticket-missing' })
    const op: string = String((a.op === undefined || a.op === null ? ticket.op : a.op) || '')
    if (ticket.op !== op) return failPhone('args', '这张票是给「' + String(ticket.op) + '」签的，不能拿来做「' + op + '」', { reason: 'ticket-op-mismatch' })
    const pure: any = ticketPureVerdict(ticket, op as any, nowFn())
    if (pure && pure.ok !== true) return failPhone('blocked', cloneReasonText(pure.reason), { reason: pure.reason })
    const plan: any = ticket.plan
    if (!plan) return failPhone('blocked', '这张票里没有计划；重新预检一次', { reason: 'ticket-missing' })
    if (ticket.confirmRequired === true && a.confirmed !== true) {
      return failPhone('need-confirm', '这一步要你确认一下再动手', { reason: 'need-confirm', decision: ticket.decision, confirm: { kind: op, target: plan.dir, verb: op === 'start' ? '开始克隆' : '删除残留目录' } })
    }
    const cwd: string = String(a.cwd === undefined || a.cwd === null ? '' : a.cwd) || (ticket.repoRoot || '')
    if (!cwd) return failPhone('args', '没给工作区目录，也读不到票里记的仓库根', { reason: 'bad-cwd' })
    const current: any = await measure(cwd, plan)
    if (current.ok !== true) return current.envelope
    if (String(current.repoRoot) !== String(ticket.repoRoot)) return failPhone('blocked', '当前工作区的仓库根与预检时不一致（换了目录？）；重新预检一次', { reason: 'stale-repo' })
    const expected: string = String((ticket.bindings && ticket.bindings.preconditions && ticket.bindings.preconditions.planDigest) || '')
    if (expected && current.planDigest !== expected) return failPhone('blocked', '预检之后目标目录或克隆选项变了（被别的程序建起来、删掉或改了）；重新预检一次', { reason: 'target-changed' })
    const atMs: number = nowFn()
    if (op === 'cleanup') {
      const registered: boolean = residuals.has(plan.dir)
      let problem: string | null = cloneCleanupProblem(current.target)
      if (!problem && !registered) problem = 'cleanup-unregistered'
      if (problem) return failPhone('blocked', cloneReasonText(problem), { reason: problem })
      const cleanExe: any = await resolveGitExecutable()
      const complete: any = cleanExe ? await runPinned(cleanExe, plan.dir, ['rev-parse', '-q', '--verify', 'HEAD'], { stdoutLimit: 8192, timeoutMs: CLONE_READ_TIMEOUT_MS }) : null
      if (complete && complete.kind === 'ok') return failPhone('blocked', cloneReasonText('target-looks-complete'), { reason: 'target-looks-complete' })
      try {
        if (typeof removeTree === 'function') await removeTree(plan.dir)
        else {
          // @ts-expect-error 宿主类型检查不带 Node 类型；运行期才有 node:fs/promises（见 src/host/versionControlTask.ts 先例）
          const fsp: any = await import('node:fs/promises')
          await fsp.rm(plan.dir, { recursive: true, force: false })
        }
      } catch (e) {
        return failPhone('env', '删除残留目录时失败：' + firstLine(String((e && (e as any).message) || e)), { reason: 'remove-failed' })
      }
      residuals.delete(plan.dir)
      const out: any = { ok: true, op: 'cleanup', dir: plan.dir, removed: true, ticketId: ticketId, atMs: atMs }
      remember(requestId, out)
      return out
    }
    const taskArgs: any = cloneTaskArgsOf(plan)
    const started: any = await taskStart({ op: 'clone', args: taskArgs, cwd: ticket.repoRoot, requestId: requestId, confirm: true })
    if (!started || started.ok !== true) {
      const taskError: any = (started && started.error) || {}
      return failPhone('blocked', '长任务通道没有接下这次克隆：' + String(taskError.message || '原因不明'), { reason: 'task-refused', task: started })
    }
    const out: any = {
      ok: true, op: 'start', dir: plan.dir, maskedUrl: cloneMaskedUrl(plan.url), ticketId: ticketId, atMs: atMs,
      task: started.task || null, taskId: (started.task && started.task.taskId) || null, reused: started.reused === true,
    }
    remember(requestId, out)
    return out
  }

  return { handleCheck: handleCheck, handleWrite: handleWrite, tickets: tickets, results: results, residuals: residuals, measure: measure }
}

/** 装配与缓存收在模块里（父文件贴着 350 有效行上限，只留两行注册）：
 *  首次调用才把执行层与两条电话拼起来；票据表、残留登记表、requestId 去重表跨多次调用不丢。
 *  装配抛错时两条电话都回同一封 env 信封，界面照常打得开，动作会说原因，下一次调用再重试装配。 */
let _clonePhonesP: any = null
export function clonePhonesOf(deps: any): any {
  if (!_clonePhonesP) {
    _clonePhonesP = Promise.resolve().then(function (): any {
      const raw: any = createClonePhones(deps)
      return {
        check: deps.loggedPhone('wf.gitCloneCheck', 'git-clone-check', raw.handleCheck),
        write: deps.loggedPhone('wf.gitCloneWrite', 'git-clone-write', raw.handleWrite),
        tickets: raw.tickets,
        residuals: raw.residuals,
      }
    }).catch(function (e: any): any {
      _clonePhonesP = null
      const failed: any = function (): any { return deps.failPhone('env', '克隆向导的执行层装配失败：' + deps.firstLine(String((e && e.message) || e))) }
      return { check: failed, write: failed, tickets: new Map(), residuals: new Map() }
    })
  }
  return _clonePhonesP
}

export const CLONE_PHONES_SOURCE = 'src/host/versionControlClone.ts'