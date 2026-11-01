// 长任务运行器（#1740）：开始、查询、取消、重启中断对账。
//
// 它不自己起进程，也不自己拼命令：命令拼装来自 task-protocol，真正起进程的闭包由宿主
// 执行层在 versionControl.ts 里注入（固定前缀、GIT_EDITOR、-C 钉仓库、stdout 截断、
// 报闸都在那一层）。这样拆的好处是门禁可以用假进程把取消、重启中断、EPIPE 这些分支跑全，
// 不用真的等某个命令跑上几分钟。
//
// 四条结论的口径写死在这里，改之前先读票面：
//   succeeded  进程退出码为 0；
//   failed     非零退出、进程起不来、输出通道被提前关闭（EPIPE）或超时，带 git 原话首行；
//   cancelled  调用方取消；先给进程发终止信号，宽限期内没退再补一次强杀，残留说明如实写；
//   interrupted 宿主进程重启后，上一实例留下的在途记录由 resumeInterrupted 标成中断。
//
// 任务不占 120 秒写票据通道：票据只管写命令的预检新鲜度，长任务执行时长另算。

import {
  TASK_CONCLUSIONS, isTaskOp, taskOpMetaOf, taskArgsFor, taskDedupeKey, parseTaskProgress,
  stdinSpecProblem, summaryOf,
} from '../shared/version-control/src/task-protocol.js'
// 软取消宽限与强杀等待住中央 YAML（config/timeouts.yaml 的 vcTaskCancelGraceMs / vcTaskHardKillGraceMs），
// 这里只引用生成常量：调用方没给值时的兜底同样取中央那一份，不写第二份数字。
import { VC_TASK_CANCEL_GRACE_MS, VC_TASK_HARD_KILL_MS } from '../shared/time-config/src/values.js'

const VIA = 'version-control-task'

/**
 * 长任务通道的失败信封固定为 {ok:false, error:{kind,reason,message,hint}}。
 * 与写命令共用同一套字段口径：调用方按 reason 做分支，按 hint 给人话提示，
 * 不允许只回一句「失败了」而没有分类。
 */
function taskFail(kind: any, message: any, extra?: any): any {
  const more: any = extra || {}
  return { ok: false, error: { kind, message, reason: more.reason || null, hint: more.hint || null } }
}
const FAILURE_LINE_LIMIT = 160

/** 取失败输出里第一行非空文字：给人看的失败原因只留这一行，整段输出太吵。 */
function firstLine(text: any): string {
  if (typeof text !== 'string') return ''
  const line: string = text.split(/\r?\n/).find((item: any) => String(item).trim().length > 0) || ''
  return line.trim().slice(0, FAILURE_LINE_LIMIT)
}

export function createTaskRunner(deps: any): any {
  const store = deps.store
  const launch = deps.launch
  const prepareStdinFile = deps.prepareStdinFile
  const timer = deps.timer
  const now: any = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const hash8 = deps.hash8
  const instanceId: string = String(deps.instanceId || 'instance')
  const repoRoot: string = deps.repoRoot || ''
  const fire: any = typeof deps.fire === 'function' ? deps.fire : () => {}
  const graceMs: number = Number.isInteger(deps.graceMs) && deps.graceMs > 0 ? deps.graceMs : Math.max(1000, Number(VC_TASK_CANCEL_GRACE_MS) || 5000)
  const hardKillMs: number = Number.isInteger(deps.hardKillMs) && deps.hardKillMs > 0 ? deps.hardKillMs : Math.max(500, Number(VC_TASK_HARD_KILL_MS) || 2000)
  const inflight = new Map<any, any>()

  /** 每条 git.task 日志都从这里出：字段名固定，额外字段按白名单由调用方补。 */
  function emit(level: any, record: any, extra?: any): void {
    const fields: Record<string, any> = {
      taskId: record.taskId,
      op: record.op,
      cmd: record.op,
      cwdHash: record.cwdHash,
      phase: record.phase || 'started',
      conclusion: record.conclusion || null,
      via: VIA,
    }
    if (extra) for (const key of Object.keys(extra)) fields[key] = extra[key]
    fire(level, 'git.task', fields)
  }

  async function finalize(taskId: any, result: any, forcedResidual?: any): Promise<any> {
    const entry: any = inflight.get(taskId)
    if (!entry || entry.settled) return entry ? entry.summary : null
    entry.settled = true
    const rec: any = { ...entry.record }
    // 结束前把最后的进度行也解析一遍：进程可能在最后一行才打出真实百分比。
    const tail: string = String((result && result.stderr) || '') + '\n' + String((result && result.stdout) || '')
    for (const line of tail.split(/\r?\n/)) {
      const parsed: any = parseTaskProgress(line)
      if (parsed.phase) entry.snapshot.phase = parsed.phase
      if (parsed.percent !== null) entry.snapshot.percent = parsed.percent
      if (parsed.bytes !== null) entry.snapshot.receivedBytes = parsed.bytes
    }
    rec.phase = entry.snapshot.phase
    rec.percent = entry.snapshot.percent
    rec.receivedBytes = entry.snapshot.receivedBytes
    rec.endedAt = now()
    rec.elapsedMs = Math.max(0, rec.endedAt - (rec.startedAt || rec.endedAt))
    rec.exitCode = result && typeof result.exitCode === 'number' ? result.exitCode : null
    rec.truncated = !!(result && result.truncated)
    rec.state = 'done'
    rec.instanceId = instanceId
    const stdinError: any = result && result.stdinError
    if (rec.cancelRequested) {
      rec.conclusion = 'cancelled'
      rec.failureKind = 'cancelled'
      rec.residual = forcedResidual || entry.residual || '任务被取消，可能有未完成的产物留在工作区'
      rec.failureLine = null
    } else if (stdinError) {
      rec.conclusion = 'failed'
      rec.failureKind = 'stdin-failed'
      rec.failureLine = '输入文件在送入过程中被 git 提前关闭（EPIPE）'
      rec.residual = null
    } else if (result && result.timedOut) {
      rec.conclusion = 'failed'
      rec.failureKind = 'timeout'
      rec.failureLine = '进程超过允许时长没有结束，已终止'
      rec.residual = null
    } else if (rec.exitCode !== null && rec.exitCode !== 0) {
      rec.conclusion = 'failed'
      rec.failureKind = 'non-zero'
      rec.failureLine = firstLine(result && result.stderr) || 'git 退出码 ' + rec.exitCode
      rec.residual = null
    } else if (rec.exitCode === null && !(result && result.signalled)) {
      rec.conclusion = 'failed'
      rec.failureKind = 'spawn-failed'
      rec.failureLine = '进程没有正常结束，也没有给出退出码'
      rec.residual = null
    } else {
      rec.conclusion = 'succeeded'
      rec.failureKind = null
      rec.failureLine = null
      rec.residual = null
    }
    if (TASK_CONCLUSIONS.indexOf(rec.conclusion) < 0) rec.conclusion = 'failed'
    await store.put(rec)
    entry.record = rec
    emit(rec.conclusion === 'succeeded' ? 'info' : 'warn', rec, {
      percent: rec.percent,
      receivedBytes: rec.receivedBytes,
      elapsedMs: rec.elapsedMs,
      exitCode: rec.exitCode,
      truncated: rec.truncated,
      stdinBytes: rec.stdinBytes,
    })
    inflight.delete(taskId)
    entry.summary = summaryOf(rec)
    entry.settleResolve(entry.summary)
    return entry.summary
  }

  async function start(request: any): Promise<any> {
    const req: any = request && typeof request === 'object' ? request : {}
    const meta: any = taskOpMetaOf(req.op)
    if (!meta) {
      return taskFail('invalid-request', '长任务清单里没有这个动作', {
        reason: 'unknown-op',
        hint: '只接受票面点名的十七种动作',
      })
    }
    const built: any = taskArgsFor(req.op, req.args)
    if (!built.ok) {
      return taskFail('invalid-request', built.message, { reason: built.reason, hint: built.hint })
    }
    if (meta.requiresConfirm && req.confirm !== true) {
      return taskFail('invalid-request', '这个动作会改写仓库历史或清理对象，需要显式确认', {
        reason: 'confirm-required',
        hint: '确认风险后带 confirm: true 重新开始',
      })
    }
    let stdinBytes: any = null
    if (req.stdinFile !== undefined && req.stdinFile !== null) {
      if (!meta.stdinFile) {
        return taskFail('invalid-request', '只有 fast-import 允许从文件送输入', {
          reason: 'stdin-not-allowed',
          hint: '其它动作的输入一律走参数，标准输入保持忽略',
        })
      }
      const specProblem: string | null = stdinSpecProblem(req.stdinFile)
      if (specProblem) {
        return taskFail('invalid-request', specProblem, {
          reason: 'stdin-spec',
          hint: '输入文件要给出路径、非负整数大小与 64 位十六进制摘要',
        })
      }
      const prepared: any = await prepareStdinFile(req.stdinFile)
      if (!prepared || prepared.ok !== true) {
        const reason: any = (prepared && prepared.reason) || 'invalid'
        return taskFail('invalid-request', '输入文件没有通过校验：' + reason, {
          reason: 'stdin-' + reason,
          hint: '确认文件是普通文件、大小与摘要一致后重试',
        })
      }
      stdinBytes = prepared.bytes
    }
    // fast-import 靠标准输入吃饭：没给文件引用就不能空着管道跑，否则 git 会一直等输入、界面一直转圈。
    if (meta.stdinFile && (req.stdinFile === undefined || req.stdinFile === null)) {
      return taskFail('invalid-request', 'fast-import 必须给出输入文件引用，输入文件不能缺', {
        reason: 'stdin-required',
        hint: '给出普通文件的绝对路径、大小与摘要，文件内容由宿主自己打开并校验',
      })
    }
    const cwd: string = typeof req.cwd === 'string' && req.cwd.length > 0 ? req.cwd : repoRoot
    const cwdHash: string = hash8(cwd)
    if (typeof req.requestId === 'string' && req.requestId.length > 0) {
      const prior: any = await store.findByRequestId(req.requestId)
      if (prior) return { ok: true, task: summaryOf(prior), reused: true }
    }
    const reqKey: string = taskDedupeKey(req.op, cwdHash, req.args)
    for (const entry of inflight.values()) {
      if (entry.reqKey === reqKey && entry.record.state === 'running') {
        return { ok: true, task: summaryOf(entry.record), reused: true }
      }
    }
    const startedAt: number = now()
    const taskId: string = 'task-' + String(startedAt) + '-' + hash8(req.op + '|' + reqKey + '|' + String(startedAt)).slice(0, 8)
    const record: any = {
      taskId,
      requestId: typeof req.requestId === 'string' ? req.requestId : '',
      op: req.op,
      cwdHash,
      state: 'running',
      conclusion: null,
      phase: 'started',
      percent: null,
      receivedBytes: null,
      elapsedMs: null,
      startedAt,
      endedAt: null,
      exitCode: null,
      truncated: false,
      failureKind: null,
      failureLine: null,
      residual: null,
      cancelRequested: false,
      stdinBytes: stdinBytes ? stdinBytes.length : 0,
      instanceId,
    }
    const snapshot: any = { phase: 'started', percent: null, receivedBytes: null }
    const onLine: any = (line: any): void => {
      const parsed: any = parseTaskProgress(line)
      if (parsed.phase) snapshot.phase = parsed.phase
      if (parsed.percent !== null) snapshot.percent = parsed.percent
      if (parsed.bytes !== null) snapshot.receivedBytes = parsed.bytes
    }
    // 起进程闭包是异步的（宿主执行层要先解析 git 可执行文件、报闸、再 spawn），必须等它把进程句柄交回来。
    // 不 await 会把 Promise 当成「进程没有起来」：命令其实起了，任务却当场判失败。
    const launched: any = await launch({ op: req.op, args: built.args, cwd, stdinBytes, onLine, onStdoutLine: onLine })
    if (!launched || launched.ok !== true) {
      const failureKind: string = (launched && launched.kind) || 'spawn-failed'
      const failedRecord: any = {
        ...record,
        state: 'done',
        conclusion: 'failed',
        endedAt: now(),
        elapsedMs: Math.max(0, now() - startedAt),
        failureKind,
        failureLine: firstLine((launched && launched.message) || '进程没有起来'),
      }
      await store.put(failedRecord)
      emit('error', failedRecord, { elapsedMs: failedRecord.elapsedMs, exitCode: null, truncated: false })
      return { ok: true, task: summaryOf(failedRecord) }
    }
    const entry: any = { handle: launched.handle, reqKey, snapshot, record, settled: false, summary: null, settleResolve: null, residual: null }
    entry.donePromise = new Promise((resolve: any) => { entry.settleResolve = resolve })
    inflight.set(taskId, entry)
    emit('info', record)
    launched.handle.done.then((result: any) => finalize(taskId, result)).catch(() => {
      finalize(taskId, { exitCode: null, stdout: '', stderr: '', truncated: false })
    })
    if (launched.stdinError) {
      try { launched.handle.terminate() } catch {}
      await finalize(taskId, { exitCode: null, stdout: '', stderr: '', truncated: false, stdinError: launched.stdinError })
      return { ok: true, task: entry.summary }
    }
    return { ok: true, task: summaryOf(record) }
  }

  async function query(): Promise<any> {
    const records: any[] = await store.list()
    const tasks: any[] = records.map((record: any) => {
      const entry: any = inflight.get(record.taskId)
      if (entry && entry.record && entry.record.state === 'running') {
        return summaryOf({
          ...record,
          phase: entry.snapshot.phase,
          percent: entry.snapshot.percent,
          receivedBytes: entry.snapshot.receivedBytes,
          elapsedMs: Math.max(0, now() - (record.startedAt || now())),
        })
      }
      return summaryOf(record)
    })
    // 在途任务还没落盘（落盘发生在收尾那一刻），查询必须把内存里的在途记录并进来，
    // 否则任务刚开始时界面看到的是空清单——这是「查询」这条电话存在的意义。
    const seen: Record<string, boolean> = {}
    for (const task of tasks) seen[String(task.taskId)] = true
    for (const entry of inflight.values()) {
      const rec: any = entry && entry.record
      if (!rec || rec.state !== 'running' || seen[String(rec.taskId)]) continue
      tasks.unshift(summaryOf({
        ...rec,
        phase: entry.snapshot.phase,
        percent: entry.snapshot.percent,
        receivedBytes: entry.snapshot.receivedBytes,
        elapsedMs: Math.max(0, now() - (rec.startedAt || now())),
      }))
    }
    return { ok: true, tasks, running: tasks.filter((task: any) => task.state === 'running').length }
  }

  async function cancel(request: any): Promise<any> {
    const req: any = request && typeof request === 'object' ? request : {}
    const taskId: any = req.taskId
    if (typeof taskId !== 'string' || taskId.length === 0) {
      return taskFail('invalid-request', '取消任务要给出任务 id', { reason: 'bad-task-id' })
    }
    const entry: any = inflight.get(taskId)
    if (!entry) {
      const record: any = await store.get(taskId)
      if (!record) return taskFail('not-found', '任务库里没有这个任务', { reason: 'no-such-task' })
      return taskFail('conflict', '这个任务已经结束，不能再取消', { reason: 'task-ended' })
    }
    if (entry.record && entry.record.cancelRequested) {
      return { ok: true, task: entry.summary || summaryOf(entry.record) }
    }
    const meta: any = taskOpMetaOf(entry.record.op)
    entry.record = { ...entry.record, cancelRequested: true }
    entry.residual = meta ? meta.residual : '任务被取消，可能有未完成的产物留在工作区'
    try { entry.handle.terminate() } catch {}
    const outcome: string = await Promise.race([
      entry.donePromise.then(() => 'done'),
      timer.timeout(graceMs).then(() => 'grace'),
    ])
    if (outcome === 'done' && entry.summary) return { ok: true, task: entry.summary }
    // 宽限期内没退：补一次强杀，结论仍是被取消，但残留说明要写清楚。
    try { entry.handle.terminate() } catch {}
    const forcedResidual: string = entry.residual + '；进程没有在宽限期内响应终止信号，已强制结束，工作区可能仍有残留'
    // 强杀后再给一次很短的对账时间，仍不结束就按取消收尾，不让界面一直转圈。
    const settled: any = await Promise.race([
      entry.donePromise,
      timer.timeout(hardKillMs).then(() => null),
    ])
    if (settled && entry.summary) return { ok: true, task: entry.summary }
    const summary: any = await finalize(taskId, { exitCode: null, stdout: '', stderr: '', truncated: false, signalled: true }, forcedResidual)
    return { ok: true, task: summary }
  }

  /** 宿主每次启动调用一次：把上一实例留下的在途记录标成中断，并像其它结论一样记日志。 */
  async function resumeInterrupted(): Promise<any> {
    const records: any[] = await store.list()
    let interrupted: number = 0
    for (const record of records) {
      if (!record || record.state !== 'running') continue
      if (record.instanceId === instanceId) continue
      const endedAt: number = now()
      const patched: any = await store.patch(record.taskId, {
        state: 'done',
        conclusion: 'interrupted',
        interrupted: true,
        endedAt,
        elapsedMs: Math.max(0, endedAt - (record.startedAt || endedAt)),
        failureKind: 'interrupted',
        failureLine: '上一次任务已中断（宿主进程重启）',
        residual: '上一次任务在宿主进程重启时中断，无法确认最后停在哪一步，请按命令手册核对产物后再重试',
      })
      if (!patched) continue
      interrupted += 1
      emit('warn', patched, { elapsedMs: patched.elapsedMs, conclusion: 'interrupted' })
    }
    return { ok: true, interrupted }
  }

  return { start, query, cancel, resumeInterrupted }
}

/** 日志白名单里 git.task 允许出现的字段键，宿主执行层与门禁都从这里取同一份。 */
export const GIT_TASK_LOG_FIELDS = [
  'taskId', 'op', 'cmd', 'cwdHash', 'phase', 'conclusion', 'percent', 'receivedBytes',
  'elapsedMs', 'exitCode', 'truncated', 'stdinBytes', 'via',
]
