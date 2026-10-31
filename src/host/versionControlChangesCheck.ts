/**
 * src/host/versionControlChangesCheck.ts —— 改动页（规格域 1）的预检与发票（#1742）
 *
 * 只做四件事，一条写命令都不在这里发：
 *   1. 读一次首屏（与首屏聚合同一个读数口），拿到工作区形状、仓库状态与当前提交；
 *   2. 按动作检查输入，并读只读命令把「要动的那一块/那一批路径/那几行忽略规则」量清楚；
 *   3. 把这次动作的计划规范化、算摘要，写进票据的绑定表；
 *   4. 回一张票（id / checkedAtMs / expiresAtMs / op）与计划，界面拿它画确认卡。
 *
 * 为什么有这一层：能力 1.2「逐块暂存」必须把「第几块、这块补丁长什么样」钉在票里，
 * 否则用户点确认之前文件又被改过，apply --cached 会把另一块内容写进索引。其余动作同理，
 * 票据绑定的是「同一批路径 / 同一份干净清单 / 同一份旧 .gitignore」，不是模糊的「同一个文件」。
 *
 * 为什么 stdin 不参与：规格 §8 规定宿主起 git 时 stdin 除 fast-import 外一律 ignore。
 * 逐块暂存要交给 git apply 一个补丁，补丁由执行层（versionControlChangesWrite）写成普通临时文件，
 * 本文件只负责「补丁内容是什么」与「它的摘要是多少」。
 *
 * 本文件不直接碰 node:fs 与 node:crypto：文件读写、摘要与时钟都由装配处（versionControl.ts）显式传入，
 * 这样预检在门禁里可以完全用假实现跑，不会碰真实文件。
 */
import type { ChangesPlan } from '../shared/version-control/src/ports.js'
import {
  fixedPrefix,
  lsFilesStageArgs,
  diffHunksArgs,
  cleanPreviewArgs,
  checkIgnoreArgs,
} from '../shared/version-control/src/commands.js'
import {
  makeTicket,
  pathAbsentFromScreen,
  worktreeBindingInput,
  indexRecordCount,
  fingerprintInputOf,
} from '../shared/version-control/src/write-ticket.js'
import { writeHintFor } from '../shared/version-control/src/write-reasons.js'
import {
  changesOpMetaOf,
  makeChangesPlan,
  pathArgProblem,
  twoPathProblem,
  ignoreLineOf,
  ignoreLineProblem,
  splitUnifiedDiff,
  patchForHunk,
  changesPlanInput,
  versionUsesRestore,
  gitignoreAppendOf,
} from '../shared/version-control/src/changes-protocol.js'
import { VC_CHANGES_READ_TIMEOUT_MS as READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'

const LSFILES_LIMIT: number = 8 * 1024 * 1024
const PATCH_LIMIT: number = 4 * 1024 * 1024
const SMALL_LIMIT: number = 256 * 1024

/** 装配处注入的依赖：本文件不自取仓库、不读文件、不拿时钟。 */
export interface ChangesCheckDeps {
  /** 首屏读数（与 #841 写预检同一个口）：回 {ok:true,screen,tier,gitVersion} 或失败信封。 */
  readScreenOf: any
  /** 跑一条只读 git 命令：回 {kind:'ok'|'non-zero'|'timeout'|'spawn-failed', stdout?, stderr?, exitCode?, truncated?}。 */
  runRead: any
  /** 读仓库内一个相对路径的文本文件：回 {ok:true,text} 或 {ok:false,reason:'missing'|'unreadable'}。 */
  readTextFile: any
  /** 查仓库内一个相对路径在不在：true / false / null（答不出）。 */
  pathExists: any
  /** 统一的失败信封构造：与本文件 fail 二选一，装配处传入的是首屏读数那一个。 */
  failPhone: any
  nowMs: any
  randomId: any
  digest16: any
  tickets: Map<string, any>
  results: Map<string, any>
}

/** git 结果里的错误原文第一行：给失败信封当 message 用，不把整段输出倒进界面。 */
function firstLine(text: any): string {
  const s: string = String(text === undefined || text === null ? '' : text).replace(/\r/g, '').trim()
  const at: number = s.indexOf('\n')
  return (at < 0 ? s : s.slice(0, at)).slice(0, 300)
}

export function createChangesCheck(deps: any): any {
  const d: ChangesCheckDeps = deps
  const tickets: Map<string, any> = d.tickets
  const results: Map<string, any> = d.results
  const now = function (): number { try { return typeof d.nowMs === 'function' ? d.nowMs() : Date.now() } catch (e) { return Date.now() } }
  const mkId = function (): string { try { return typeof d.randomId === 'function' ? String(d.randomId()) : String(now()) } catch (e) { return String(now()) } }
  const digest16 = function (text: any): string { return String(d.digest16(String(text === undefined || text === null ? '' : text))) }

  /** 失败信封：kind 是传输档、reason 是写层理由标识符、hint 取词表里那一句。 */
  function fail(kind: any, reason: any, message: any, extra?: any): any {
    const base: any = { ok: false, error: { kind: kind, reason: reason, message: message || '', hint: writeHintFor(reason) } }
    return Object.assign(base, extra || {})
  }

  /** 跑一条只读命令，并把非零退出/超时/起进程失败都翻成明确的失败信封（不猜、不当作成功）。 */
  async function readOut(cwd: any, args: any, limit: any): Promise<any> {
    let r: any
    try { r = await d.runRead(String(cwd || ''), args, { stdoutLimit: limit, timeoutMs: READ_TIMEOUT_MS }) } catch (e) { return { ok: false, error: { kind: 'env', reason: 'unknown-write-failure', message: String(((e as any) && (e as any).message) || (e as any)), hint: writeHintFor('unknown-write-failure') } } }
    if (r && r.kind === 'ok') return { ok: true, stdout: String(r.stdout || ''), truncated: r.truncated === true }
    if (r && r.kind === 'non-zero') return fail('other', 'unknown-write-failure', firstLine(r.stderr) || 'git 以非零退出码结束了这条只读命令')
    return fail((r && r.kind) || 'other', 'unknown-write-failure', firstLine(r && r.message) || '这条只读命令没有正常结束')
  }

  /** 读一条路径在索引里的记录（判断「是不是已跟踪」与「索引里有没有它」）。 */
  async function lsFilesOne(cwd: any, path: string): Promise<any> {
    const r: any = await readOut(cwd, ['ls-files', '--stage', '-z', '--', path], SMALL_LIMIT)
    if (r.ok !== true) return r
    return { ok: true, tracked: String(r.stdout || '') !== '', text: String(r.stdout || '') }
  }

  /** 首屏里的某条记录：已暂存 / 未暂存两份数组各查一次（冲突行在 unstaged 里）。 */
  function entryOf(screen: any, path: string, which: string): any {
    const list: any[] = (screen && Array.isArray(screen[which])) ? screen[which] : []
    for (const f of list) if (f && String(f.path) === path) return f
    return null
  }

  /** 这个路径当前是不是未跟踪（未跟踪文件不进索引，只能从首屏的 change 标记认得）。 */
  function isUntracked(screen: any, path: string): boolean {
    const e: any = entryOf(screen, path, 'unstaged')
    return !!(e && e.change === 'untracked')
  }

  /** 仓库在不在「正在合并/变基/拣选/回退」这种半截状态：有就整组改动页动作先不接。 */
  function busyOf(screen: any): boolean {
    const repo: any = (screen && screen.repo) || {}
    return !!(repo.merging || repo.rebasing || repo.cherryPicking || repo.reverting)
  }

  /** 把这次动作的计划摘要写进票据绑定：改动页所有动作都用 planDigest 这一格绑定「具体块/具体清单」。 */
  function bindingsOf(screen: any, plan: ChangesPlan, indexEntries: number): any {
    return {
      preconditions: {
        planDigest: digest16(changesPlanInput(plan)),
        worktreeDigest: digest16(worktreeBindingInput(screen)),
        pathAbsent: pathAbsentFromScreen(screen),
      },
      counters: { indexEntries: indexEntries },
    }
  }

  /** 一次预检：回票据与计划，或回一个明确拒绝（都带稳定理由，界面按理由词条显示）。 */
  async function handle(args: any, op: string): Promise<any> {
    const a: any = args || {}
    const cwd: string = String(a.cwd || '')
    if (cwd === '') return fail('args', 'bad-target', '这次请求没有给出工作目录')
    const meta: any = changesOpMetaOf(op)
    if (!meta) return fail('args', 'bad-target', '不认识的改动页动作：' + String(op))

    // ① 首屏：工作区形状、仓库状态、HEAD 都从这一份读数来，不另起一套读法。
    const sr: any = await d.readScreenOf(cwd)
    if (!sr || sr.ok !== true) return sr || fail('env', 'unknown-write-failure', '读不到这个仓库的首屏')
    const screen: any = sr.screen || {}
    const gitVersion: string = String(sr.gitVersion || '')
    const repo: any = screen.repo || {}
    if (repo.bare === true) return fail('env', 'repo-bare', writeHintFor('repo-bare'))
    if (busyOf(screen)) return fail('blocked', 'operation-in-progress', writeHintFor('operation-in-progress'))
    if (Number(screen.conflictCount) > 0) return fail('blocked', 'operation-in-progress', '还有冲突没有处理完，改动页的暂存与丢弃先不接；请先解决冲突')

    // ② 只读动作：查为什么被忽略不需要票，直接回判定链（与 1.12 追加忽略共用同一条命令）。
    if (op === 'explain-ignored') {
      const badPath: any = pathArgProblem(a.path)
      if (badPath) return fail('args', 'bad-path', writeHintFor('bad-path'), { pathProblem: badPath })
      const ci: any = await readOut(cwd, checkIgnoreArgs(String(a.path)), SMALL_LIMIT)
      // git check-ignore：命中时退出码 0 并把判定链写到 stdout；没命中时退出码 1 且 stdout 为空。
      if (ci.ok !== true) {
        if (ci.error && ci.error.kind === 'other' && /非零退出/.test(String(ci.error.message || ''))) {
          return { ok: true, ignored: false, lines: [], match: null, hint: '这条路径没有被任何忽略规则命中' }
        }
        return ci
      }
      const lines: string[] = String(ci.stdout || '').split(/\r?\n/).filter(function (x: string) { return x.trim() !== '' })
      const first: string = lines.length ? lines[0] : ''
      const tab: number = first.indexOf('\t')
      const left: string = tab < 0 ? first : first.slice(0, tab)
      const parts: string[] = left.split(':')
      const match: any = (lines.length > 0) ? { source: parts.length > 2 ? parts.slice(0, parts.length - 2).join(':') : '', line: parts.length > 1 ? Number(parts[parts.length - 2]) : null, pattern: parts.length > 0 ? parts[parts.length - 1] : '', path: tab < 0 ? '' : first.slice(tab + 1) } : null
      return { ok: true, ignored: lines.length > 0, lines: lines, match: match }
    }

    // ③ 写动作：逐条检查输入并组装计划。所有失败都发生在起任何写命令之前。
    let plan: ChangesPlan | null = null
    if (op === 'stage-file') {
      const badPath: any = pathArgProblem(a.path)
      if (badPath) return fail('args', 'bad-path', writeHintFor('bad-path'), { pathProblem: badPath })
      const entry: any = entryOf(screen, String(a.path), 'unstaged')
      if (!entry) return fail('args', 'nothing-to-do', '这个文件现在没有未暂存的改动')
      plan = makeChangesPlan({ op: 'stage-file', paths: [String(a.path)] })
    } else if (op === 'stage-all') {
      const n: number = Number(screen.stagedCount || 0) + Number(screen.unstagedCount || 0)
      if (n <= 0) return fail('args', 'nothing-to-do', '工作区已经干净，没有可暂存的改动')
      plan = makeChangesPlan({ op: 'stage-all' })
    } else if (op === 'unstage') {
      const badPath: any = pathArgProblem(a.path)
      if (badPath) return fail('args', 'bad-path', writeHintFor('bad-path'), { pathProblem: badPath })
      if (!entryOf(screen, String(a.path), 'staged')) return fail('args', 'nothing-to-do', '这个文件没有已暂存的改动；撤回暂存只撤回已暂存的那一份')
      plan = makeChangesPlan({ op: 'unstage', paths: [String(a.path)] })
    } else if (op === 'stage-hunks') {
      const badPath: any = pathArgProblem(a.path)
      if (badPath) return fail('args', 'bad-path', writeHintFor('bad-path'), { pathProblem: badPath })
      const path: string = String(a.path)
      const entry: any = entryOf(screen, path, 'unstaged')
      if (!entry) return fail('args', 'nothing-to-do', '这个文件现在没有未暂存的改动')
      if (entry.change === 'untracked') return fail('args', 'hunks-unavailable', '未跟踪文件没有可拆的块，请按整份文件暂存')
      if (entry.change === 'binary' || entry.change === 'renamed') return fail('args', 'hunks-unavailable', writeHintFor('hunks-unavailable'))
      const raw: any = await readOut(cwd, diffHunksArgs(path), PATCH_LIMIT)
      if (raw.ok !== true) return raw
      if (raw.truncated === true) return fail('other', 'hunks-unavailable', '这个文件的差异太大，读不全就拆不出块；请按整份文件处理')
      const parsed: any = splitUnifiedDiff(raw.stdout)
      if (parsed.ok !== true) {
        if (parsed.reason === 'binary' || parsed.reason === 'rename' || parsed.reason === 'no-diff') return fail('args', 'hunks-unavailable', writeHintFor('hunks-unavailable'))
        return fail('parse', 'hunks-unavailable', '这段差异读不懂，拆不出块；请按整份文件处理')
      }
      const idx: number = (typeof a.hunkIndex === 'number' && isFinite(a.hunkIndex)) ? Math.floor(a.hunkIndex) : -1
      const one: any = patchForHunk(raw.stdout, idx)
      if (one.ok !== true) {
        if (one.reason === 'hunk-out-of-range') return fail('args', 'hunk-out-of-range', writeHintFor('hunk-out-of-range'), { hunkCount: parsed.hunks.length })
        return fail('args', 'hunks-unavailable', writeHintFor('hunks-unavailable'))
      }
      plan = makeChangesPlan({ op: 'stage-hunks', paths: [path], hunkIndex: idx, patchDigest: digest16(one.text) })
    } else if (op === 'discard-file') {
      const badPath: any = pathArgProblem(a.path)
      if (badPath) return fail('args', 'bad-path', writeHintFor('bad-path'), { pathProblem: badPath })
      const path: string = String(a.path)
      const entry: any = entryOf(screen, path, 'unstaged')
      if (isUntracked(screen, path)) return fail('args', 'nothing-to-do', '未跟踪文件没有可丢弃的改动；要删掉它请走「删除未跟踪文件」')
      if (!entry) return fail('args', 'nothing-to-do', '这个文件现在没有未暂存的改动')
      plan = makeChangesPlan({ op: 'discard-file', paths: [path], mode: versionUsesRestore(gitVersion) ? 'restore' : 'checkout' })
    } else if (op === 'discard-all') {
      const tracked: any[] = Array.isArray(screen.unstaged) ? screen.unstaged.filter(function (f: any) { return f && f.change !== 'untracked' }) : []
      if (tracked.length === 0) return fail('args', 'nothing-to-do', '没有可丢弃的已跟踪改动（未跟踪文件不在这里处理）')
      plan = makeChangesPlan({ op: 'discard-all', mode: versionUsesRestore(gitVersion) ? 'restore' : 'checkout' })
    } else if (op === 'clean-untracked') {
      const badPath: any = pathArgProblem(a.path)
      if (badPath) return fail('args', 'bad-path', writeHintFor('bad-path'), { pathProblem: badPath })
      const path: string = String(a.path)
      if (!isUntracked(screen, path)) return fail('args', 'nothing-to-do', '这个路径不是未跟踪文件；删除未跟踪文件只处理未跟踪的路径')
      const pv: any = await readOut(cwd, cleanPreviewArgs([path]), SMALL_LIMIT)
      if (pv.ok !== true) return pv
      const removeList: string[] = String(pv.stdout || '').split(/\r?\n/).map(function (line: any) {
        const m: any = /^Would remove (.+)$/.exec(String(line).trim())
        return m ? String(m[1]) : ''
      }).filter(function (x: string) { return x !== '' }).sort()
      if (removeList.length === 0) return fail('args', 'nothing-to-do', '这条路径下没有可删除的未跟踪文件')
      plan = makeChangesPlan({ op: 'clean-untracked', paths: [path], removeList: removeList })
    } else if (op === 'rm-tracked') {
      const badPath: any = pathArgProblem(a.path)
      if (badPath) return fail('args', 'bad-path', writeHintFor('bad-path'), { pathProblem: badPath })
      const path: string = String(a.path)
      const one: any = await lsFilesOne(cwd, path)
      if (one.ok !== true) return one
      if (!one.tracked) return fail('args', 'nothing-to-do', '这个路径不在索引里；删除已跟踪文件只处理已跟踪的路径')
      const e: any = entryOf(screen, path, 'unstaged')
      const staged: any = entryOf(screen, path, 'staged')
      if (staged || e) return fail('args', 'path-modified', writeHintFor('path-modified'))
      plan = makeChangesPlan({ op: 'rm-tracked', paths: [path] })
    } else if (op === 'rm-cached') {
      const badPath: any = pathArgProblem(a.path)
      if (badPath) return fail('args', 'bad-path', writeHintFor('bad-path'), { pathProblem: badPath })
      const path: string = String(a.path)
      const one: any = await lsFilesOne(cwd, path)
      if (one.ok !== true) return one
      if (!one.tracked) return fail('args', 'nothing-to-do', '这个路径不在索引里；停止跟踪只处理已跟踪的路径')
      if (entryOf(screen, path, 'staged')) return fail('args', 'path-modified', '这个文件还有已暂存的改动，停止跟踪前请先撤回暂存')
      plan = makeChangesPlan({ op: 'rm-cached', paths: [path] })
    } else if (op === 'mv') {
      const from: string = String(a.path || '')
      const to: string = String(a.to || '')
      const two: any = twoPathProblem(from, to)
      if (two) return fail('args', 'bad-path', writeHintFor('bad-path'), { pathProblem: two })
      const one: any = await lsFilesOne(cwd, from)
      if (one.ok !== true) return one
      if (!one.tracked) return fail('args', 'nothing-to-do', '要移动的路径不在索引里；重命名只处理已跟踪的路径')
      if (entryOf(screen, from, 'staged')) return fail('args', 'path-modified', '这个文件还有已暂存的改动，移动前请先撤回暂存')
      let exists: any = null
      try { exists = await d.pathExists(cwd, to) } catch (e) { exists = null }
      if (exists === true) return fail('args', 'path-exists', writeHintFor('path-exists'))
      if (exists === null) return fail('env', 'unknown-write-failure', '查不出目标路径在不在，移动这一步做不了')
      plan = makeChangesPlan({ op: 'mv', paths: [from], to: to })
    } else if (op === 'ignore') {
      const badPath: any = pathArgProblem(a.path)
      if (badPath) return fail('args', 'bad-path', writeHintFor('bad-path'), { pathProblem: badPath })
      const path: string = String(a.path)
      const line: string = ignoreLineOf(path)
      const badLine: any = ignoreLineProblem(line)
      if (badLine) return fail('args', 'ignore-invalid', writeHintFor('ignore-invalid'))
      const old: any = await d.readTextFile(cwd, pathOfGitignore())
      const oldText: string = (old && old.ok === true) ? String(old.text || '') : ''
      if (old && old.ok !== true && old.reason !== 'missing') return fail('env', 'unknown-write-failure', '读不到仓库根 .gitignore，无法安全追加')
      const append: any = gitignoreAppendOf(oldText, [line])
      if (append.added.length === 0) return fail('args', 'nothing-to-do', '这一行已经在 .gitignore 里了，不需要重复追加')
      plan = makeChangesPlan({ op: 'ignore', paths: [path], ignoreLines: append.added, ignoreOldDigest: digest16(oldText) })
    }
    if (!plan) return fail('args', 'bad-target', '不认识的改动页动作：' + String(op))

    // ④ 索引指纹与条数：与执行前那次逐字节同一口径（同一固定前缀、同一 -z、不截断）。
    const lf: any = await readOut(cwd, lsFilesStageArgs(), LSFILES_LIMIT)
    if (lf.ok !== true) return lf
    if (lf.truncated === true) return fail('other', 'fingerprint-unavailable', '暂存区清单太大被截断了，这一步做不了')
    const indexFingerprint: string = digest16(fingerprintInputOf(lf.stdout))
    const indexEntries: number = indexRecordCount(lf.stdout)
    const headOid: string = String((screen.identity && screen.identity.oid) || '')
    const repoRoot: string = String((screen.identity && screen.identity.worktreePath) || '')
    const ticket: any = makeTicket({
      id: mkId(),
      op: op as any,
      nowMs: now(),
      headOid: headOid,
      indexFingerprint: indexFingerprint,
      indexEntries: indexEntries,
      target: null,
      repoRoot: repoRoot,
      changes: plan,
      bindings: bindingsOf(screen, plan, indexEntries),
    })
    tickets.set(ticket.id, ticket)
    if (tickets.size > 200) { const oldest: any = tickets.keys().next().value; tickets.delete(oldest) }
    return {
      ok: true,
      decision: { verdict: 'allow', reasons: [] },
      plan: plan,
      confirmRequired: meta.confirm === true,
      ticket: { id: ticket.id, checkedAtMs: ticket.checkedAtMs, expiresAtMs: ticket.expiresAtMs, op: ticket.op },
      readAtMs: now(),
    }
  }

  /** 仓库根 .gitignore 的相对路径：预检只认仓库根这一份（规格 3.1）。 */
  function pathOfGitignore(): string { return '.gitignore' }

  return {
    handleChangesCheck: async function (a: any): Promise<any> {
      const args: any = a || {}
      const op: string = String(args.op || '')
      // 只读动作 op 的名单与写动作分开登记：漏掉一条就会永远落到「不认识的动作」。
      if (op === 'explain-ignored') return handle(args, op)
      const meta: any = changesOpMetaOf(op)
      if (!meta || meta.write !== true) return fail('args', 'bad-target', '预检要知道是哪种改动页写操作（op）')
      return handle(args, op)
    },
    tickets: tickets,
    results: results,
    now: now,
  }
}
