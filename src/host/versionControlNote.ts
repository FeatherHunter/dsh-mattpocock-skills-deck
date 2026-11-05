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
import { noteArgvOf, notePlanInputOf, noteRemovingOf, noteRevProblem, noteTextProblem } from '../shared/version-control/src/note-ops.js'
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

  /** 跑一条只读命令：起不来 / 超时都当「读不到」，不外抛。 */
  async function read(exe: any, root: any, argv: string[], limit: number): Promise<any> {
    try { return await deps.runPinned(exe, root, argv, { stdoutLimit: limit }) } catch (e) { return { kind: 'spawn-failed', message: String((e && (e as any).message) || e) } }
  }

  /** 把用户写的引用解析成完整提交号；解析不出来回 null（界面照原话告诉用户「找不到这个提交」）。 */
  async function resolveCommit(exe: any, root: any, rev: string): Promise<string | null> {
    const res: any = await read(exe, root, ['rev-parse', '--verify', '--quiet', rev + '^{commit}'], REV_LIMIT)
    if (!res || res.kind !== 'ok') return null
    const oid: string = String(res.stdout || '').trim()
    return /^[0-9a-f]{40}$/.test(oid) || /^[0-9a-f]{64}$/.test(oid) ? oid : null
  }

  /** 这条提交此刻的备注原文；没有备注回空串（git notes show 在没备注时退出码是 1，不是错误）。 */
  async function currentNoteOf(exe: any, root: any, oid: string): Promise<string> {
    const res: any = await read(exe, root, ['notes', 'show', oid], NOTE_LIMIT)
    if (!res) return ''
    if (res.kind === 'ok') return String(res.stdout === undefined || res.stdout === null ? '' : res.stdout).replace(/\r?\n$/, '')
    return ''
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
    if (textProblem === 'too-long') return fail('args', textProblem, '备注太长了，请写到 2000 字以内')
    if (textProblem) return fail('args', textProblem, '备注里有不能保存的字符')
    const exe: any = await deps.resolveGitExecutable()
    if (!exe) return fail('env', 'no-git', '找不到 git 命令，备注写不了')
    const base: any = await deps.resolveRepoRoot(exe, deps.cwdOf(a))
    if (base.ok !== true) return base
    const oid: string | null = await resolveCommit(exe, base.root, revText)
    if (oid === null) return fail('args', 'unknown-rev', '找不到「' + revText + '」这个提交')
    const noteNow: string = await currentNoteOf(exe, base.root, oid)
    if (noteRemovingOf(text) && noteNow === '') return fail('args', 'note-empty', '这条提交还没有备注，没有可删除的内容')
    const id: string = 'note-' + String(typeof deps.randomId === 'function' ? deps.randomId() : Math.random().toString(36).slice(2))
    const nowMs: number = now()
    const ticket: any = {
      id: id, op: 'note', repoRoot: String(base.root || ''),
      checkedAtMs: nowMs, expiresAtMs: nowMs + Number(TICKET_TTL_MS),
      oid: oid, text: text, oldDigest: hash16(notePlanInputOf(oid, noteNow)),
    }
    tickets.set(id, ticket)
    return {
      ok: true,
      ticket: { id: id, op: 'note', checkedAtMs: nowMs, expiresAtMs: ticket.expiresAtMs },
      plan: { rev: oid, text: text, removing: noteRemovingOf(text), hadNote: noteNow !== '' },
    }
  }

  /** 一条票的纯判定：票在不在、动作对不对、过期没有、是不是同一个仓库。一格不对就一条写命令都不起。 */
  function ticketProblem(ticket: any, nowMs: number, root: any): string | null {
    if (!ticket || !ticket.id) return 'ticket-missing'
    if (ticket.op !== 'note') return 'ticket-op-mismatch'
    if (!(nowMs < ticket.expiresAtMs)) return 'ticket-expired'
    if (String(root || '') !== String(ticket.repoRoot || '')) return 'stale-repo'
    return null
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
    const exe: any = await deps.resolveGitExecutable()
    if (!exe) return fail('env', 'no-git', '找不到 git 命令，备注写不了')
    const base: any = await deps.resolveRepoRoot(exe, deps.cwdOf(a))
    if (base.ok !== true) return base
    // 票据门：任何一格对不上都在这里结束，下面一条 git 写命令都不会起。
    const problem: string | null = ticketProblem(ticket, nowMs, base.root)
    if (problem) return fail('args', problem, '这张票已经不能用了，请重新点一次保存')
    const noteNow: string = await currentNoteOf(exe, base.root, ticket.oid)
    if (hash16(notePlanInputOf(ticket.oid, noteNow)) !== ticket.oldDigest) return fail('args', 'note-changed', '这条提交的备注在确认之后被改过了，请重新写一次')
    const res: any = await read(exe, base.root, noteArgvOf(ticket.oid, ticket.text), NOTE_LIMIT)
    const bad: any = failureFromExec(res, '写提交备注')
    if (bad) {
      tickets.delete(ticketId)
      const env: any = fail('exit', String((bad.error && bad.error.kind) || 'exit'), String((bad.error && bad.error.message) || '写备注这一步没有成功结束'))
      results.set(requestId, env)
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
    return out
  }

  return { check: check, write: write, tickets: tickets, results: results }
}

export const NOTE_PHONE_SOURCE = 'src/host/versionControlNote.ts'
