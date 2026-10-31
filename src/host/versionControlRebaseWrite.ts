// 变基待办页的执行层：凭预检签出的 120 秒票据真正跑 git 命令。
// 为什么单独一层：预检（versionControlRebaseCheck.ts）只签票不动手，执行在这里统一做——
//   票据现场逐格重验、requestId 去重、临时文件（待办与改说明的正文）在这里创建与清理。
// 三条不能改的约定：
//   1) 执行前必须用同一把尺子重算现场（measure），仓库换了、HEAD 动了、进行中状态或
//      rebase.updateRefs 变了，一律零进程拒绝；只信票据里记下的事实，不信调用方。
//   2) 规格第 7 节的编辑器交接在这里落实：把面板生成好的待办写成普通临时文件，用
//      GIT_SEQUENCE_EDITOR 指向 cp 把它覆盖到 git 传进来的待办路径上；GIT_EDITOR 默认仍是
//      必失败命令，只有确实需要 git 自己写提交说明（压缩/自动吸收）时才显式改成 true，
//      否则「面板没覆盖成功」会直接失败而不是弹编辑器卡住。
//   3) 变基撞冲突不是执行失败：退出码非零但 git 说留下了冲突，就算这一步跑完，
//      回包如实说 conflicted 与进行中状态，让冲突向导接着处理；绝不伪造成功。

import {
  REBASE_WRITE_OPS,
  rebaseOpMetaOf,
  rebaseStepsOf,
  rebaseTodoLinesOf,
} from '../shared/version-control/src/rebase-ops.js'
import { bindingsVerdict, requestIdProblem, ticketPureVerdict } from '../shared/version-control/src/write-ticket.js'
import { classifyWriteFailure, idShapeProblem, writeHintFor } from '../shared/version-control/src/write-reasons.js'
import { VC_REBASE_WRITE_TIMEOUT_MS as WRITE_TIMEOUT_MS } from '../shared/time-config/src/values.js'

const STDOUT_LIMIT = 8 * 1024 * 1024
/** git 在变基失败或撞冲突时的原话特征：有这些词就是「停下来等处理」，不是命令本身坏了。 */
const CONFLICT_RE = /CONFLICT|could not apply|Resolve all conflicts|fix conflicts|rebase is in progress/i

/** 固定失败信封：kind/reason/message 三件套，reason 给界面映射词条，message 给 git 原话。 */
function wfail(kind: string, reason: string, message: string, extra?: any): any {
  return Object.assign({ ok: false, error: { kind: kind, reason: reason, message: message }, reason: reason }, extra || {})
}
function firstLineOf(text: any): string {
  return String(text == null ? '' : text).split(/\r?\n/)[0].trim()
}

/**
 * deps 全部由装配壳注入：runPinned 与 resolveGitExecutable 是唯一能起进程的入口；
 * measure 与 check 叶子共用同一把尺子；tmp 提供建/读/删临时文件（待办与说明正文）。
 */
export function createRebaseWrite(deps: any): any {
  const d: any = deps || {}
  const failPhone: any = d.failPhone
  const runPinned: any = d.runPinned
  const resolveGitExecutable: any = d.resolveGitExecutable
  const measure: any = d.measure
  const scene: any = d.scene
  const nowFn: any = typeof d.now === 'function' ? d.now : function () { return Date.now() }
  const tmp: any = d.tmp
  const tickets: any = d.tickets instanceof Map ? d.tickets : new Map()
  const results: any = d.results instanceof Map ? d.results : new Map()

  function remember(requestId: string, out: any): void {
    if (!requestId) return
    results.set(requestId, out)
    while (results.size > 500) {
      const first: any = results.keys().next().value
      results.delete(first)
    }
  }

  /** 执行后重新读现场：变基完了或者停在冲突里，都要把真实状态回给界面。 */
  async function afterScene(cwd: string): Promise<any> {
    const s: any = await scene.sceneOf(cwd)
    if (!s || s.ok !== true) return { state: null, headOid: null, branch: null, updateRefs: null, gitVersion: null }
    return { state: s.state, headOid: s.headOid, branch: s.branch, updateRefs: s.updateRefs, gitVersion: s.gitVersion }
  }

  /** 环节名与期望句都是给失败信封用的，写清「哪一步、本该怎样」，不写内部变量名。 */
  function stepOf(op: string): string {
    if (op === 'rebase-todo') return '按面板待办重放这一步'
    if (op === 'rebase-onto') return '换基座这一步'
    if (op === 'rebase-autosquash') return '自动吸收变基这一步'
    return '带合并结构的变基这一步'
  }
  function expectedOf(op: string, plan: any): string {
    if (op === 'rebase-onto') return '把旧基座 ' + String(plan.oldBase || '') + ' 之后的提交搬到新基座 ' + String(plan.newBase || '') + ' 上'
    if (op === 'rebase-autosquash') return '把 fixup/squash 提交吸收进对应的 pick 提交'
    if (op === 'rebase-merges') return '保留合并结构重放 ' + String(plan.base || '') + ' 之后的提交'
    return '按面板待办重放 ' + String(plan.base || '') + ' 之后的提交'
  }

  async function runStep(exe: any, root: string, argv: string[], env: any, gitEditor: any): Promise<any> {
    const opts: any = { stdoutLimit: STDOUT_LIMIT, timeoutMs: WRITE_TIMEOUT_MS }
    if (env) opts.env = env
    if (gitEditor) opts.gitEditor = gitEditor
    return runPinned(exe, root, argv, opts)
  }

  /** 「命令非零退出但变基停在冲突里」：这是预期分支，不是失败。 */
  function conflictedOf(res: any): boolean {
    if (!res || res.kind !== 'non-zero') return false
    const said: string = String(res.stderr || '') + '\n' + String(res.stdout || '')
    return CONFLICT_RE.test(said)
  }

  function tmpReady(): boolean {
    return !!tmp && typeof tmp.write === 'function' && typeof tmp.read === 'function' && typeof tmp.remove === 'function'
  }

  /**
   * 跑票里的命令。rebase-todo 先落两份临时文件（逐条改说明的正文、整份待办），
   * 用 GIT_SEQUENCE_EDITOR 把它们覆盖到 git 自己的待办路径上；跑完无论成败都删临时文件。
   */
  async function execute(exe: any, root: string, cwd: string, plan: any): Promise<any> {
    const op: string = String(plan.op || '')
    const steps: string[][] = rebaseStepsOf(plan)
    if (steps.length === 0) return { ok: false, failure: wfail('args', 'bad-target', '这张票里没有可执行的命令：重新预检', { decision: null }) }
    const made: string[] = []
    try {
      let env: any = null
      let gitEditor: any = null
      if (op === 'rebase-todo') {
        if (!tmpReady()) return { ok: false, failure: wfail('env', 'env', '临时文件服务不可用：没法把面板里的待办交给 git', { decision: null }) }
        const rows: any[] = Array.isArray(plan.rows) ? plan.rows : []
        const messagePaths: any = {}
        for (let i = 0; i < rows.length; i += 1) {
          if (String(rows[i].action || '') !== 'reword') continue
          const w: any = await tmp.write(String(rows[i].message || ''))
          if (!w || w.ok !== true) return { ok: false, failure: wfail('env', 'unknown-write-failure', '写改说明的正文失败：' + String((w && w.message) || ''), { decision: null }) }
          made.push(String(w.path))
          messagePaths[String(rows[i].oid || '')] = String(w.path)
        }
        const lines: any = rebaseTodoLinesOf(plan, function (oid: string) { return messagePaths[String(oid)] })
        if (!lines || lines.ok !== true) return { ok: false, failure: wfail('args', 'missing-message', '有要改说明的提交没填新说明：面板里逐条填好再点', { decision: null }) }
        const todo: any = await tmp.write(String(lines.lines.join('\n')) + '\n')
        if (!todo || todo.ok !== true) return { ok: false, failure: wfail('env', 'unknown-write-failure', '写变基待办文件失败：' + String((todo && todo.message) || ''), { decision: null }) }
        made.push(String(todo.path))
        env = { GIT_SEQUENCE_EDITOR: 'cp "' + String(todo.path) + '"' }
        // 有压缩行时 git 要写合并后的提交说明：改用 true 接受它给的默认说明，不弹外部编辑器。
        const hasSquash: boolean = rows.some(function (r: any) { return String(r.action || '') === 'squash' })
        if (hasSquash) gitEditor = 'true'
      } else if (op === 'rebase-autosquash' || op === 'rebase-merges') {
        // -i 的待办由 git 自己按 --autosquash / --rebase-merges 生成：接受它给的待办；
        // 自动吸收里的 squash! 提交同样要写合并说明，所以编辑器也给 true（默认说明）。
        env = { GIT_SEQUENCE_EDITOR: 'true' }
        gitEditor = 'true'
      }
      const ran: string[][] = []
      for (let i = 0; i < steps.length; i += 1) {
        const argv: string[] = steps[i]
        const res: any = await runStep(exe, root, argv, env, gitEditor)
        if (res && res.kind === 'ok') { ran.push(argv); continue }
        if (i === 0 && conflictedOf(res)) {
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
    } finally {
      for (let i = 0; i < made.length; i += 1) {
        try { await tmp.remove(made[i]) } catch (e) { /* 临时文件删不掉不影响结论，下一轮清理会扫到 */ }
      }
    }
  }

  /** 执行入口：顺序见文件头。任何一条不满足都零进程拒绝。 */
  async function handleRebaseWrite(args: any): Promise<any> {
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
    const meta: any = rebaseOpMetaOf(op)
    if (meta === null || REBASE_WRITE_OPS.indexOf(meta) < 0) return wfail('args', 'bad-target', '这个动作不需要凭票执行：' + op)
    const pure: any = ticketPureVerdict(ticket, ticket.op, nowFn())
    if (!pure || pure.ok !== true) return wfail('blocked', String((pure && pure.reason) || 'ticket-expired'), '这张票已经过期或不能用：重新预检')
    if (ticket.confirmRequired === true && a.confirmed !== true) return wfail('need-confirm', 'need-confirm', '这个动作要先确认（确认卡上写清后果），确认后带 confirmed:true 再发一次', { decision: ticket.decision || null })
    const cwd: string = typeof a.cwd === 'string' && a.cwd.trim() !== '' ? a.cwd : ''
    if (!cwd) return wfail('args', 'bad-target', '缺少工作目录：执行必须说清在哪个仓库做')
    const cur: any = await measure(cwd, ticket.plan)
    if (!cur || cur.ok !== true) return cur && cur.envelope ? cur.envelope : wfail('blocked', 'target-changed', '执行前读不回现场：这次不执行，先刷新')
    if (String(cur.repoRoot || '') !== String(ticket.repoRoot || '')) return wfail('blocked', 'stale-repo', '这张票不是给这个仓库签的：重新预检')
    if (String(cur.headOid || '') !== String(ticket.headOid || '')) return wfail('blocked', 'target-changed', '预检之后 HEAD 变了：这次不执行，重新预检')
    if (cur.updateRefs === true || ticket.bindingValue === 'update-refs-on') return wfail('blocked', 'update-refs-on', writeHintFor('update-refs-on'), { setting: 'rebase.updateRefs', decision: ticket.decision || null })
    if (cur.state !== null) return wfail('blocked', 'operation-in-progress', '仓库正在进行别的操作（' + String(cur.state) + '）：先把当前操作处理完', { state: cur.state, decision: ticket.decision || null })
    const bind: any = bindingsVerdict(ticket, cur.bindings)
    if (bind) return wfail('blocked', String(bind === 'stale-index' ? 'target-changed' : bind), '预检之后要动的东西变了（待办窗口、配置或工作区）：这次不执行，重新预检', { decision: ticket.decision || null })
    const plan: any = ticket.plan || {}
    const exe: any = await resolveGitExecutable()
    if (!exe) return wfail('env', 'env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    const ran: any = await execute(exe, cur.repoRoot, cwd, plan)
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
      branch: after.branch,
      headOid: after.headOid,
      updateRefs: after.updateRefs,
      ticketId: ticketId,
      atMs: nowFn(),
      decision: ticket.decision || null,
    }
    remember(requestId, out)
    return out
  }

  return { handleRebaseWrite: handleRebaseWrite, tickets: tickets, results: results }
}

export const REBASE_WRITE_SOURCE = 'src/host/versionControlRebaseWrite.ts'
