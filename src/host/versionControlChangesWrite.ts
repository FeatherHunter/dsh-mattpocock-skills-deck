/**
 * src/host/versionControlChangesWrite.ts —— 改动页（规格域 1）的票据复核与执行（#1742）
 *
 * 顺序与 #1741 写层完全一致，只是比对的东西换成「计划里的那一块/那一批路径/那份旧 .gitignore」：
 *   requestId 重放 → 票号形状 → requestId 形状 → 票是否过期/动作是否对得上 →
 *   重算当前仓库（HEAD、索引指纹与条数、工作区摘要）→ 重算与计划绑定的内容摘要 →
 *   全部对得上才起一条 git 写命令 → 回读首屏 → 同一个 requestId 再问一次直接回上次结果。
 *
 * 逐块暂存要交给 git apply 一个补丁文件：规格 §8 规定宿主给 git 的标准输入除 fast-import 外一律 ignore，
 * 所以这里由宿主把「预检时看过的那一块」写成权限 0600 的普通临时文件，执行完立刻删掉；
 * 文件路径不进票据、不进日志，票据里只留补丁内容的摘要。
 */
import type { ChangesPlan } from '../shared/version-control/src/ports.js'
import {
  applyCachedArgs,
  cleanArgs,
  rmArgs,
  rmCachedArgs,
  mvArgs,
  discardFileArgs,
  discardAllArgs,
} from '../shared/version-control/src/commands.js'
import {
  ticketPureVerdict,
  ticketVerdict,
  requestIdProblem,
  fingerprintInputOf,
  indexRecordCount,
  worktreeBindingInput,
  pathAbsentFromScreen,
  bindingsVerdict,
  canonicalJson,
} from '../shared/version-control/src/write-ticket.js'
import {
  idShapeProblem,
  classifyWriteFailure,
  writeHintFor,
} from '../shared/version-control/src/write-reasons.js'
import {
  changesPlanInput,
  splitUnifiedDiff,
  patchForHunk,
  gitignoreAppendOf,
} from '../shared/version-control/src/changes-protocol.js'
import { lsFilesStageArgs } from '../shared/version-control/src/commands.js'
import { VC_CHANGES_WRITE_TIMEOUT_MS as WRITE_TIMEOUT_MS } from '../shared/time-config/src/values.js'

const STDOUT_LIMIT: number = 256 * 1024

/** 装配处注入的依赖：仓库读写、临时补丁文件、时钟与票据表都显式传入，本文件不自己开进程也不自己拼路径。 */
export interface ChangesWriteDeps {
  /** 首屏读数（同预检同一个口）。 */
  readScreenOf: any
  /** 跑一条 git 命令（固定前缀由装配处拼好），回 runGit 的几种 kind。 */
  runCommand: any
  /** 读仓库内一个相对路径的文本文件：回 {ok:true,text} 或 {ok:false,reason:'missing'|'unreadable'}。 */
  readTextFile: any
  /** 覆写仓库内一个相对路径的文本文件（本票只用于仓库根 .gitignore）。 */
  writeTextFile: any
  /** 把一段文本写成权限 0600 的临时补丁文件，回 {ok:true,path} 或失败信封。 */
  writeTempPatch: any
  /** 删掉临时补丁文件；删不掉也不影响已经执行完的写命令。 */
  deleteFile: any
  nowMs: any
  digest16: any
  tickets: Map<string, any>
  results: Map<string, any>
}

/** git 失败原文的第一行：失败信封只带这一句 git 原话，不把整段输出倒给界面。 */
function firstLine(text: any): string {
  const s: string = String(text === undefined || text === null ? '' : text).replace(/\r/g, '').trim()
  const at: number = s.indexOf('\n')
  return (at < 0 ? s : s.slice(0, at)).slice(0, 300)
}

export function createChangesWrite(deps: any): any {
  const d: ChangesWriteDeps = deps
  const tickets: Map<string, any> = d.tickets
  const results: Map<string, any> = d.results
  const now = function (): number { try { return typeof d.nowMs === 'function' ? d.nowMs() : Date.now() } catch (e) { return Date.now() } }
  const digest16 = function (text: any): string { return String(d.digest16(String(text === undefined || text === null ? '' : text))) }

  /** 失败信封：固定 {ok:false,error:{kind,reason,message,hint}}，界面按 reason 取词条。 */
  function wfail(kind: any, reason: any, message: any, extra?: any): any {
    const base: any = { ok: false, error: { kind: kind, reason: reason, message: message || '', hint: writeHintFor(reason) } }
    return Object.assign(base, extra || {})
  }

  /** 跑一条写命令；非零退出按动作分类成理由，超时与起进程失败如实上报。 */
  async function runOne(cwd: string, argv: string[]): Promise<any> {
    let r: any
    try { r = await d.runCommand(cwd, argv, { stdoutLimit: STDOUT_LIMIT, timeoutMs: WRITE_TIMEOUT_MS }) } catch (e) { return wfail('env', 'unknown-write-failure', String(((e as any) && (e as any).message) || (e as any))) }
    if (r && r.kind === 'ok') return { ok: true, stdout: String(r.stdout || ''), truncated: r.truncated === true }
    if (r && r.kind === 'non-zero') {
      const reason: string = classifyWriteFailure(String(argv[0] || '') as any, Number(r.exitCode), String(r.stderr || ''))
      return wfail('other', reason, firstLine(r.stderr) || 'git 以非零退出码结束了这次写操作', { exitCode: Number(r.exitCode) })
    }
    if (r && r.kind === 'timeout') return wfail('timeout', 'unknown-write-failure', '这次写操作在 ' + String(WRITE_TIMEOUT_MS) + ' 毫秒内没有结束，已经让进程退出')
    return wfail('env', 'unknown-write-failure', firstLine(r && r.message) || '写命令没有正常起进程')
  }

  /** 读一次首屏并重算票面要复核的那几格；任何一格答不出来都整笔拒绝，不拿旧值凑。 */
  async function currentOf(cwd: string, plan: ChangesPlan): Promise<any> {
    const sr: any = await d.readScreenOf(cwd)
    if (!sr || sr.ok !== true) return { fail: sr || wfail('env', 'unknown-write-failure', '读不到这个仓库的首屏') }
    const screen: any = sr.screen || {}
    const lf: any = await d.runCommand(cwd, lsFilesStageArgs(), { stdoutLimit: 8 * 1024 * 1024, timeoutMs: WRITE_TIMEOUT_MS })
    if (!lf || lf.kind !== 'ok') return { fail: wfail('env', 'fingerprint-unavailable', '重读暂存区清单失败，这一步做不了') }
    if (lf.truncated === true) return { fail: wfail('other', 'fingerprint-unavailable', '暂存区清单太大被截断了，这一步做不了') }
    const indexEntries: number = indexRecordCount(String(lf.stdout || ''))
    const bindings: any = {
      preconditions: {
        planDigest: digest16(changesPlanInput(plan)),
        worktreeDigest: digest16(worktreeBindingInput(screen)),
        pathAbsent: pathAbsentFromScreen(screen),
      },
      counters: { indexEntries: indexEntries },
    }
    return {
      ok: true,
      screen: screen,
      current: {
        op: plan.op,
        headOid: String((screen.identity && screen.identity.oid) || ''),
        indexFingerprint: digest16(fingerprintInputOf(String(lf.stdout || ''))),
        indexAvailable: true,
        target: null,
        repoRoot: String((screen.identity && screen.identity.worktreePath) || ''),
        bindings: bindings,
      },
    }
  }

  /** 与票据绑定的内容摘要逐项复核：补丁内容、干净清单、旧 .gitignore 摘要，任何一项变了都拒绝执行。 */
  async function contentVerdict(cwd: string, plan: ChangesPlan): Promise<any> {
    if (plan.op === 'stage-hunks') {
      const raw: any = await d.runCommand(cwd, ['diff', '--no-color', '--no-ext-diff', '--find-renames', '--unified=3', '--', plan.paths[0]], { stdoutLimit: 4 * 1024 * 1024, timeoutMs: WRITE_TIMEOUT_MS })
      if (!raw || raw.kind !== 'ok') return { ok: false, reason: 'target-changed', detail: '重新读这个文件的差异失败' }
      const idx: number = (typeof plan.hunkIndex === 'number') ? plan.hunkIndex : -1
      const one: any = patchForHunk(String(raw.stdout || ''), idx)
      if (one.ok !== true || digest16(one.text) !== String(plan.patchDigest || '')) return { ok: false, reason: 'target-changed', detail: '选中的那一块和第几次预检时不一样了' }
      return { ok: true }
    }
    if (plan.op === 'clean-untracked') {
      const pv: any = await d.runCommand(cwd, ['clean', '-nd', '--'].concat(plan.paths), { stdoutLimit: STDOUT_LIMIT, timeoutMs: WRITE_TIMEOUT_MS })
      if (!pv || pv.kind !== 'ok') return { ok: false, reason: 'target-changed', detail: '重新列未跟踪清单失败' }
      const removeList: string[] = String(pv.stdout || '').split(/\r?\n/).map(function (line: any) {
        const m: any = /^Would remove (.+)$/.exec(String(line).trim())
        return m ? String(m[1]) : ''
      }).filter(function (x: string) { return x !== '' }).sort()
      if (canonicalJson(removeList) !== canonicalJson(plan.removeList)) return { ok: false, reason: 'target-changed', detail: '要删的未跟踪文件清单变了' }
      return { ok: true }
    }
    if (plan.op === 'ignore') {
      const old: any = await d.readTextFile(cwd, '.gitignore')
      const oldText: string = (old && old.ok === true) ? String(old.text || '') : ''
      if (old && old.ok !== true && old.reason !== 'missing') return { ok: false, reason: 'target-changed', detail: '读不到仓库根 .gitignore' }
      if (digest16(oldText) !== String(plan.ignoreOldDigest || '')) return { ok: false, reason: 'target-changed', detail: '.gitignore 在这一步之前被改过了' }
      return { ok: true }
    }
    return { ok: true }
  }

  /** 执行一条改动页写命令：逐块暂存先落临时补丁再 apply --cached，追加忽略走文件覆写，其余走 argv。 */
  async function execute(cwd: string, plan: ChangesPlan): Promise<any> {
    if (plan.op === 'ignore') {
      const old: any = await d.readTextFile(cwd, '.gitignore')
      const oldText: string = (old && old.ok === true) ? String(old.text || '') : ''
      const append: any = gitignoreAppendOf(oldText, Array.isArray(plan.ignoreLines) ? plan.ignoreLines : [])
      if (append.added.length === 0) return wfail('args', 'nothing-to-do', '这一行已经在 .gitignore 里了，不需要重复追加')
      let wrote: any
      try { wrote = await d.writeTextFile(cwd, '.gitignore', append.text) } catch (e) { return wfail('env', 'unknown-write-failure', String(((e as any) && (e as any).message) || (e as any))) }
      if (wrote && wrote.ok === false) return wfail('env', 'unknown-write-failure', String((wrote.error && wrote.error.message) || '写 .gitignore 失败'))
      return { ok: true, wrote: append.added }
    }
    let patchPath: string = ''
    const tempResult: any = { ok: true }
    try {
      if (plan.op === 'stage-hunks') {
        // 先按票据里绑定的那一块重新拼出补丁；拼不出来就绝不把别的块写给 git。
        const raw: any = await d.runCommand(cwd, ['diff', '--no-color', '--no-ext-diff', '--find-renames', '--unified=3', '--', plan.paths[0]], { stdoutLimit: 4 * 1024 * 1024, timeoutMs: WRITE_TIMEOUT_MS })
        if (!raw || raw.kind !== 'ok') return wfail('env', 'target-changed', '重新读这个文件的差异失败')
        const one: any = patchForHunk(String(raw.stdout || ''), (typeof plan.hunkIndex === 'number') ? plan.hunkIndex : -1)
        if (one.ok !== true) return wfail('args', 'hunk-out-of-range', writeHintFor('hunk-out-of-range'))
        let tmp: any
        try { tmp = await d.writeTempPatch(String(one.text)) } catch (e) { return wfail('env', 'unknown-write-failure', String(((e as any) && (e as any).message) || (e as any))) }
        if (!tmp || tmp.ok !== true || !tmp.path) return wfail('env', 'unknown-write-failure', '写临时补丁文件失败，逐块暂存没有执行')
        patchPath = String(tmp.path)
        return await runOne(cwd, applyCachedArgs(patchPath))
      }
      const argv: any = argvOf(plan)
      if (!argv) return wfail('args', 'bad-target', '这个动作没有对应的 git 命令')
      return await runOne(cwd, argv)
    } finally {
      if (patchPath !== '') { try { await d.deleteFile(patchPath) } catch (e) { /* 临时文件删不掉不影响已经执行完的写命令；下次预检会重新生成内容 */ } }
    }
  }

  /** 计划到 argv：每个参数都是独立数组元素，路径永远在 -- 之后（规格 §8 的 argv 直传纪律）。 */
  function argvOf(plan: ChangesPlan): any {
    const paths: string[] = Array.isArray(plan.paths) ? plan.paths : []
    if (plan.op === 'stage-file') return ['add', '--'].concat(paths)
    if (plan.op === 'stage-all') return ['add', '-A']
    if (plan.op === 'unstage') return ['reset', 'HEAD', '--'].concat(paths)
    if (plan.op === 'discard-file') return discardFileArgs(String(plan.mode || 'restore'), paths)
    if (plan.op === 'discard-all') return discardAllArgs(String(plan.mode || 'restore'))
    if (plan.op === 'clean-untracked') return cleanArgs(paths)
    if (plan.op === 'rm-tracked') return rmArgs(paths)
    if (plan.op === 'rm-cached') return rmCachedArgs(paths)
    if (plan.op === 'mv') return mvArgs(paths[0], String(plan.to || ''))
    return null
  }

  /** 同一个 requestId 问第二次：直接回上次那份结论，不再起第二条写命令（与 #1741 写层同一语义）。 */
  function remember(requestId: string, out: any): any {
    if (requestId !== '') {
      results.set(requestId, out)
      if (results.size > 500) { const oldest: any = results.keys().next().value; results.delete(oldest) }
    }
    return out
  }

  /** 写命令入口：复核票据 → 复核内容 → 执行 → 回读首屏。 */
  async function handle(args: any): Promise<any> {
    const a: any = args || {}
    const cwd: string = String(a.cwd || '')
    const op: string = String(a.op || '')
    const ticketId: string = String(a.ticketId || '')
    const requestId: string = String(a.requestId || '')

    // ① 重放：同一个请求号已经处理过就直接回上次结果，不重复执行。
    if (requestId !== '') {
      const prev: any = results.get(requestId)
      if (prev) return { ok: prev.ok === true, reused: true, result: prev }
    }
    // ② 请求号与票号形状：形状不对一律拒绝，且不碰票据表以外的任何东西。
    // 票号与请求号都是外部输入：票号走 idShapeProblem（与 #1741 写层同一道形状判据），请求号走 requestIdProblem（可空）。
    const idBad: any = idShapeProblem(ticketId)
    if (idBad) return wfail('args', idBad, writeHintFor(idBad))
    const rid: any = requestIdProblem(requestId)
    if (rid) return wfail('args', rid, writeHintFor(rid))

    // ③ 票面复核：票在不在、动作对不对、过没过期、仓库/HEAD/索引有没有变。
    const ticket: any = tickets.get(ticketId) || null
    if (!ticket) return wfail('blocked', 'ticket-missing', writeHintFor('ticket-missing'))
    if (!ticket.changes || String(ticket.changes.op || '') !== op) return wfail('args', 'ticket-op-mismatch', '这张票不是这次动作签发的')
    const pure: any = ticketPureVerdict(ticket, op as any, now())
    if (pure && pure.ok !== true) return wfail('blocked', pure.reason, writeHintFor(pure.reason))
    if (ticket.changes.op !== op) return wfail('args', 'ticket-op-mismatch', '这张票绑的动作与请求不一致')

    const cur: any = await currentOf(cwd, ticket.changes)
    if (!cur || cur.ok !== true) return cur && cur.fail ? cur.fail : wfail('env', 'unknown-write-failure', '重算当前仓库状态失败')
    const verdict: any = ticketVerdict(ticket, now(), cur.current)
    if (verdict && verdict.ok !== true) return wfail('blocked', verdict.reason, writeHintFor(verdict.reason))
    // bindingsVerdict 第二个参数是「此刻重量的绑定值」本身（与 #1741 写层同一调用口径），不是外层包装。
    const bv: any = bindingsVerdict(ticket, cur.current.bindings)
    if (bv) return wfail('blocked', bv, writeHintFor(bv))
    const cv: any = await contentVerdict(cwd, ticket.changes)
    if (!cv || cv.ok !== true) return wfail('blocked', cv && cv.reason ? cv.reason : 'target-changed', (cv && cv.detail) || writeHintFor('target-changed'))

    // ④ 执行：写命令只在这里起一次；失败按动作分类成理由，成功回读首屏证明结果落在哪里。
    const exec: any = await execute(cwd, ticket.changes)
    if (!exec || exec.ok !== true) return remember(requestId, exec || wfail('env', 'unknown-write-failure', '写命令没有返回结论'))
    const sr: any = await d.readScreenOf(cwd)
    const out: any = {
      ok: true,
      changed: {
        op: op,
        paths: Array.isArray(ticket.changes.paths) ? ticket.changes.paths : [],
        hunkIndex: (typeof ticket.changes.hunkIndex === 'number') ? ticket.changes.hunkIndex : null,
        wrote: exec.wrote || null,
      },
      ticketId: ticket.id,
      readAtMs: now(),
    }
    if (sr && sr.ok === true) out.screen = sr.screen
    return remember(requestId, out)
  }

  return { handleChangesWrite: handle, tickets: tickets, results: results }
}
