/**
 * src/host/versionControlNote.ts —— 提交备注的写路径（#1903，规格 #1586 能力 3.12）
 *
 * 两条电话：预检签票（wf.gitNoteCheck）与凭票执行（wf.gitNoteWrite）。
 * 为什么备注也要票据门：docs/adr/20261004-version-control-write-path.md「任何写命令之前必须先过票据门」。
 * 备注不碰 HEAD 与索引，但它确实会改仓库里的东西（refs/notes 那份引用）；更要紧的是
 * 「用户看到的那条备注」与「真正被覆盖的那条备注」之间隔着几秒，别人的话可能已经写进去了。
 * 所以票里绑的是「提交号 + 预检那一刻这条提交的备注原文的摘要」，执行前重算一遍，对不上就整笔拒绝。
 *
 * 三条如实交代的边界：
 *   1. 票只留在宿主进程内存里，客户端只拿得到 id 与有效期；
 *   2. 同一个 requestId 重放回第一次的结果，不重复执行（连点两下不能写两次）；
 *   3. 备注文本原样写进 git，不写「删除」这类占位话术；空文本就是删除。
 */
import { failPhone, firstLine, failureFromExec } from '../shared/version-control/exec-envelope.js'
import { hash16, requestIdProblem } from '../shared/version-control/src/write-ticket.js'
import { noteArgvOf, notePlanInputOf, noteRemovingOf, noteRevProblem, noteTextProblem, NOTE_TEXT_MAX } from '../shared/version-control/src/note-ops.js'
import { TICKET_TTL_MS } from '../shared/time-config/src/values.js'

/** 备注原文的读取上限：一段注解远小于它，超了就是不正常，按「读不到」处理，不拿半份原文当现状。 */
const NOTE_LIMIT: number = 1024 * 1024
/** git rev-parse 只回一行，给足 4KB。 */
const REV_LIMIT: number = 4096

/** 失败信封：在通用信封上补一个稳定理由标识符，界面照它查词表。 */
function fail(kind: any, reason: any, message: any): any {
  const env: any = failPhone(kind, message)
  env.error.reason = String(reason || '')
  return env
}

/**
 * 造备注的预检层与执行层。依赖全部由装配壳传入：本文件不自取仓库、不拿时钟、不读环境，
 * 所以门禁里可以用假实现整套跑一遍，不会碰真实仓库。
 */
export function createNotePhones(deps: any): any {
  const now = function (): number { try { return typeof deps.nowMs === 'function' ? Number(deps.nowMs()) : Date.now() } catch (e) { return Date.now() } }
  const tickets: Map<string, any> = deps.tickets || new Map()
  const results: Map<string, any> = deps.results || new Map()

  /** 跑一条只读命令：起不来 / 超时 / 非零退出都原样交回，由调用方分清楚「没有」与「读不到」。 */
  async function read(exe: any, root: any, argv: string[], limit: number): Promise<any> {
    try { return await deps.runPinned(exe, root, argv, { stdoutLimit: limit }) } catch (e) { return { kind: 'spawn-failed', message: String((e && (e as any).message) || e) } }
  }

  /**
   * 把用户写的引用解析成完整提交号。
   * 三种结果分开回，不合并成 null：找到（ok:true）、认不出（reason:'unknown-rev'）、读失败（reason:'read-failed'）。
   * 「读失败」与「没有这个提交」是两件事——前者要如实说「读不到」，不能替 git 说「没有」。
   */
  async function resolveCommit(exe: any, root: any, rev: string): Promise<any> {
    const res: any = await read(exe, root, ['rev-parse', '--verify', '--quiet', rev + '^{commit}'], REV_LIMIT)
    if (!res || res.kind === 'spawn-failed' || res.kind === 'timeout') return { ok: false, reason: 'read-failed' }
    if (res.kind !== 'ok') return { ok: false, reason: 'unknown-rev' }
    const oid: string = String(res.stdout || '').trim()
    if (!/^[0-9a-f]{40}$/.test(oid) && !/^[0-9a-f]{64}$/.test(oid)) return { ok: false, reason: 'read-failed' }
    return { ok: true, oid: oid }
  }

  /**
   * 这条提交此刻的备注原文。
   * 「没有备注」是 git 的退出码 1（不是错误，回空串）；起不来 / 超时 / 别的非零退出都是「读不到」，要如实报，
   * 否则票里会拿一份读失败得来的空底稿去比摘要，把「读不到」当成「原来是空的」。
   */
  async function currentNoteOf(exe: any, root: any, oid: string): Promise<any> {
    const res: any = await read(exe, root, ['notes', 'show', oid], NOTE_LIMIT)
    if (!res) return { ok: false, reason: 'read-failed' }
    if (res.kind === 'spawn-failed' || res.kind === 'timeout') return { ok: false, reason: 'read-failed' }
    if (res.kind === 'non-zero') return res.exitCode === 1 ? { ok: true, text: '' } : { ok: false, reason: 'read-failed' }
    if (res.kind !== 'ok') return { ok: false, reason: 'read-failed' }
    return { ok: true, text: String(res.stdout === undefined || res.stdout === null ? '' : res.stdout).replace(/\r?\n$/, '') }
  }


  /** 一次预检：判输入、解析提交号、量下此刻的备注原文、签票。 */
  async function check(args: any): Promise<any> {
    const a: any = args || {}
    const revText: string = String(a.rev === undefined || a.rev === null ? '' : a.rev).trim()
    const revProblem: string | null = noteRevProblem(revText)
    if (revProblem === 'required') return fail('args', revProblem, '还没有指定要给哪一条提交写备注')
    if (revProblem) return fail('args', revProblem, '提交号写的不像一个提交：' + revText)
    const text: string = String(a.text === undefined || a.text === null ? '' : a.text)
    const textProblem: string | null = noteTextProblem(text)
    if (textProblem === 'too-long') return fail('args', textProblem, '备注太长了，请写到 ' + String(NOTE_TEXT_MAX) + ' 字以内')
    if (textProblem) return fail('args', textProblem, '备注里有不能保存的字符')
    const exe: any = await deps.resolveGitExecutable()
    if (!exe) return fail('env', 'no-git', '找不到 git 命令，备注写不了')
    const base: any = await deps.resolveRepoRoot(exe, deps.cwdOf(a))
    if (base.ok !== true) return base
    const resolved: any = await resolveCommit(exe, base.root, revText)
    if (resolved.ok !== true) {
      if (String(resolved.reason) === 'unknown-rev') return fail('args', 'unknown-rev', '找不到「' + revText + '」这个提交')
      return fail('env', 'read-failed', '认不出这条提交的时候 git 读不动了，先不写')
    }
    const oid: string = String(resolved.oid)
    const noteNowRes: any = await currentNoteOf(exe, base.root, oid)
    if (noteNowRes.ok !== true) return fail('env', 'read-failed', '读不到这条提交现在的备注，先不写')
    const noteNow: string = String(noteNowRes.text)
    if (noteRemovingOf(text) && noteNow === '') return fail('args', 'note-empty', '这条提交还没有备注，没有可删除的内容')
    const id: string = 'note-' + String(typeof deps.randomId === 'function' ? deps.randomId() : Math.random().toString(36).slice(2))
    const nowMs: number = now()
    const ticket: any = {
      id: id, op: 'note', repoRoot: String(base.root || ''),
      checkedAtMs: nowMs, expiresAtMs: nowMs + Number(TICKET_TTL_MS),
      oid: oid, text: text, oldDigest: hash16(notePlanInputOf(oid, noteNow)),
    }
    tickets.set(id, ticket)
    keepBounded(tickets)
    return {
      ok: true,
      ticket: { id: id, op: 'note', checkedAtMs: nowMs, expiresAtMs: ticket.expiresAtMs },
      plan: { rev: oid, text: text, removing: noteRemovingOf(text), hadNote: noteNow !== '' },
    }
  }

  /**
   * 票据门的第一段：纯判定——票在不在、动作对不对、过期没有。
   * 这一段必须在起任何进程之前跑完（ADR 20261004 第 5 条：票据失效时一个进程都不许起），
   * 所以它不碰仓库根、不读现场；「是不是同一个仓库」那一格要等 root 解析出来才能判，放在第二段。
   */
  function ticketPureProblem(ticket: any, nowMs: number): string | null {
    if (!ticket || !ticket.id) return 'ticket-missing'
    if (ticket.op !== 'note') return 'ticket-op-mismatch'
    if (!(nowMs < ticket.expiresAtMs)) return 'ticket-expired'
    return null
  }

  /** 票据门的第二段：票是给哪个工作树发的，就只许在哪个工作树里执行（这一格要拿到解析后的 root 才判得了）。 */
  function ticketRepoProblem(ticket: any, root: any): string | null {
    return String(root || '') !== String(ticket.repoRoot || '') ? 'stale-repo' : null
  }

  /** 票表与结果表的条数上限：只留最近 200 条，超了删最旧（与 #1741 / #1742 那几张表同一条口径）。 */
  const TABLE_MAX: number = 200
  function keepBounded(map: Map<string, any>): void {
    while (map.size > TABLE_MAX) { const oldest: any = map.keys().next().value; map.delete(oldest) }
  }

  /** 凭票执行：复核票 → 重算此刻的备注原文 → 一条写命令 → 如实包回结局。 */
  async function write(args: any): Promise<any> {
    const a: any = args || {}
    const ticketId: string = String(a.ticketId === undefined || a.ticketId === null ? '' : a.ticketId)
    const requestId: string = String(a.requestId === undefined || a.requestId === null ? '' : a.requestId)
    const idProblem: string | null = requestIdProblem(requestId)
    if (idProblem) return fail('args', idProblem, '这次请求的编号不合规，没有执行')
    if (ticketId === '') return fail('args', 'ticket-missing', '这张票不见了，请重新点一次保存')
    const seen: any = results.get(requestId)
    if (seen) return seen
    const ticket: any = tickets.get(ticketId) || null
    const nowMs: number = now()
    // 第一段：纯判定先行。票不在、动作不对、过期了都在这里结束，下面一条 git 命令（连只读的）都不会起。
    const pure: string | null = ticketPureProblem(ticket, nowMs)
    if (pure) return fail('args', pure, '这张票已经不能用了，请重新点一次保存')
    const exe: any = await deps.resolveGitExecutable()
    if (!exe) return fail('env', 'no-git', '找不到 git 命令，备注写不了')
    const base: any = await deps.resolveRepoRoot(exe, deps.cwdOf(a))
    if (base.ok !== true) return base
    // 第二段：票是给哪个工作树发的，就只许在哪个工作树里执行。
    const problem: string | null = ticketRepoProblem(ticket, base.root)
    if (problem) return fail('args', problem, '这张票已经不能用了，请重新点一次保存')
    const noteNowRes: any = await currentNoteOf(exe, base.root, ticket.oid)
    if (noteNowRes.ok !== true) return fail('env', 'read-failed', '读不到这条提交现在的备注，先不写')
    if (hash16(notePlanInputOf(ticket.oid, String(noteNowRes.text))) !== ticket.oldDigest) return fail('args', 'note-changed', '这条提交的备注在确认之后被改过了，请重新写一次')
    const res: any = await read(exe, base.root, noteArgvOf(ticket.oid, ticket.text), NOTE_LIMIT)
    const bad: any = failureFromExec(res, '写提交备注')
    if (bad) {
      tickets.delete(ticketId)
      const env: any = fail('exit', String((bad.error && bad.error.kind) || 'exit'), String((bad.error && bad.error.message) || '写备注这一步没有成功结束'))
      results.set(requestId, env)
      keepBounded(results)
      return env
    }
    tickets.delete(ticketId)
    const out: any = {
      ok: true,
      cmd: noteRemovingOf(ticket.text) ? 'git notes remove' : 'git notes add',
      rev: ticket.oid,
      removing: noteRemovingOf(ticket.text),
      note: ticket.text,
      message: firstLine(res && res.stdout),
    }
    results.set(requestId, out)
    keepBounded(results)
    return out
  }

  return { check: check, write: write, tickets: tickets, results: results }
}

export const NOTE_PHONE_SOURCE = 'src/host/versionControlNote.ts'
