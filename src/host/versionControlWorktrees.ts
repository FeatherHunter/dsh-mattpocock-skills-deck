/**
 * src/host/versionControlWorktrees.ts —— 工作树八条能力的宿主电话（#1752 T17）。
 *
 * 两条电话，一条读、一条写：
 *   · `wf.gitWorktreeCheck`：先读真仓库的当前事实（工作树清单、git 版本、目标路径在不在、目标脏不脏、
 *     待清理的登记项、稀疏检出规则与目录候选），把事实交给共享纯函数 `worktreeJudge` 判 allow / warn / block，
 *     再给写动作开一张 120 秒的预检票据；判定 block 时照样把现场（清单、prune 清单、稀疏目录候选）回给界面，
 *     让界面能画「为什么不能点」和「可以怎么做」。
 *   · `wf.gitWorktreeRun`：拿票据执行。执行前逐条重验票据上的事实（清单摘要、目标状态、目的地空不空、
 *     待清理项、稀疏规则有没有变），任何一条变了都零进程拒绝，绝不把预检时的判断套到已经变了的现场上。
 *
 * 三条边界，改动前先读：
 *   1. **不提供 --force 与 -f -f 入口**：argv 由共享层拼装（那一份里没有 force 系开关），这里再跑一次
 *      `worktreeForbiddenFlagIn` 兜底，命中就零进程拒绝。删除脏工作树、锁定的工作树都走「先处理再重来」
 *      的正常路径（见 worktreeJudge 的理由），不靠强删。
 *   2. **同一出口**：所有 git 调用都走父文件注入的 runPinned（固定前缀、-C 钉仓库、GIT_EDITOR 失败即报、
 *      报闸、git.exec / git.exec.fail 日志），本文件不自己起进程、不碰 subprocess。
 *   3. **八条不在长任务清单里**：它们都是本地短写，走同步电话；长任务通道（wf.gitTask*）只服务克隆、获取、
 *      拉取、推送、gc 那一族（规格第 5 节）。
 *
 * 依赖全部由父文件显式传入（与 versionControlFiles.js / versionControlFirstScreen.js 同一先例）：
 * 失败信封三件套、进程出口、仓库根解析、入参工作目录、路径存在性探测、时间与随机数。
 */
import { parseWorktrees } from '../shared/version-control/src/parse-worktrees.js'
import { parseVersion, capabilityTierFor, capabilityAvailability } from '../shared/version-control/src/capabilities.js'
import { CAPABILITIES } from '../shared/version-control/src/capability-ledger.js'
import {
  WORKTREE_ACTIONS, worktreeArgsOf, worktreeCmdNameOf, worktreeJudge, worktreeRowsOf,
  worktreePruneEntriesOf, worktreeDigestOf, worktreeSamePathOf, worktreeSparseRulesOf,
  worktreeSparseCandidatesOf, worktreeSparseRulePathOf, worktreeForbiddenFlagIn, worktreeBranchProblem,
} from '../shared/version-control/src/worktree-ops.js'
import { TICKET_TTL_MS, VC_WORKTREE_OP_TIMEOUT_MS } from '../shared/time-config/src/values.js'

/** 两条电话的名字：父文件注册、界面电话表、门禁三处都从这一份读，避免各写各的字符串。 */
export const WORKTREE_PHONE_NAMES: { check: string; run: string } = {
  check: 'wf.gitWorktreeCheck',
  run: 'wf.gitWorktreeRun',
}

/** 工作树清单 -z 回包的上限：一屏十几棵工作树也远小于 1 MiB，超了按截断失败处理。 */
const LIST_LIMIT: number = 1048576
/** 单条工作树写命令的 stdout 上限：这些命令平时只有一两行提示。 */
const OP_STDOUT_LIMIT: number = 65536
/** 目标工作树里 `git status --porcelain -z` 的上限（脏计数只要条数，不需要完整差异）。 */
const DIRTY_LIMIT: number = 1048576
/** 预检票据表与请求号去重表的容量上限：界面上不会有这么多并发，超了按最旧淘汰。
 *  票据表 200 条与其它四套票表对齐（ADR 20261004 第 5 节写的就是 200）：这五套票走同一套「先预检、
 *  拿票、凭票执行」的流程，容量不该在这里忽然变成 64。请求号表按重放需要留 128 条。 */
const TICKET_MAX: number = 200
const REQUEST_MAX: number = 128

/** 一份预检票据：预检时读到的现场全部记下来，执行时逐条重验。只在宿主进程内存里，不落盘、不进日志。 */
interface WorktreeTicket {
  id: string
  op: string
  path: string
  dest: string
  branch: string
  reason: string
  dirs: string[]
  repoRoot: string
  checkedAtMs: number
  expiresAtMs: number
  worktreesDigest: string
  prunePaths: string[]
  sparseOld: string[]
  dirtyCount: number | null
}

/**
 * 造工作树八条能力的宿主电话。返回 `{ handleGitWorktreeCheck, handleGitWorktreeRun }`，
 * 由父文件的 loggedPhone 包一层日志后注册成两条电话。
 */
export function createWorktreePhones(deps: any): any {
  const d: any = deps || {}
  const now: any = function (): number { return typeof d.nowMs === 'function' ? d.nowMs() : Date.now() }
  const fail: any = function (kind: any, message: any, extra?: any): any { return d.failPhone(kind, message, extra) }

  const capById: Record<string, any> = {}
  for (let i: number = 0; i < CAPABILITIES.length; i += 1) capById[CAPABILITIES[i].id] = CAPABILITIES[i]
  const actionById: Record<string, any> = {}
  for (let i: number = 0; i < WORKTREE_ACTIONS.length; i += 1) actionById[WORKTREE_ACTIONS[i].id] = WORKTREE_ACTIONS[i]

  const tickets: Record<string, WorktreeTicket> = {}
  const ticketOrder: string[] = []
  const results: Record<string, any> = {}
  const resultOrder: string[] = []

  const strOf: any = function (v: any): string { return (v === undefined || v === null) ? '' : String(v).trim() }
  const pathOf: any = function (r: any): string { return String((r && r.path) || '') }
  const dirsOf: any = function (v: any): string[] {
    if (!Array.isArray(v)) return []
    const out: string[] = []
    for (let i: number = 0; i < v.length; i += 1) { const s: string = strOf(v[i]); if (s !== '') out.push(s) }
    return out
  }

  /** 新票据 / 请求号的短标识：时间基 + 随机后缀，形状收在 [A-Za-z0-9_-]{1,64} 里。 */
  function idOf(): string {
    const salt: string = typeof d.randomId === 'function' ? String(d.randomId()) : Math.random().toString(36).slice(2)
    return ('t' + now().toString(36) + salt.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8)).slice(0, 64)
  }

  /** 清掉过期的票据与请求号回包；表超容量时从最旧的开始淘汰。 */
  function sweep(): void {
    const t: number = now()
    while (ticketOrder.length > 0) {
      const id: string = ticketOrder[0]
      const tk: any = tickets[id]
      // 过期判据与 write-ticket.ts 的 ticketPureVerdict 同一句：now < expiresAtMs 才算有效，
      // 恰好到期的这一刻已经过期。原来写成 expiresAtMs < t 会让票据多活一毫秒。
      if (!tk || !(t < tk.expiresAtMs)) { ticketOrder.shift(); delete tickets[id] } else break
    }
    while (resultOrder.length > 0) {
      const id: string = resultOrder[0]
      const r: any = results[id]
      if (!r || !(t < r.expiresAtMs)) { resultOrder.shift(); delete results[id] } else break
    }
    while (ticketOrder.length > TICKET_MAX) { const old: any = ticketOrder.shift(); if (old) delete tickets[old] }
    while (resultOrder.length > REQUEST_MAX) { const old: any = resultOrder.shift(); if (old) delete results[old] }
  }

  /** 能力账本里这一条在给定 git 版本下的可用性；账本里没有这个号时回 null（判定按「不知道」处理）。 */
  function availabilityOf(capId: any, gitVersion: any): any {
    const cap: any = capById[strOf(capId)]
    if (!cap) return null
    return capabilityAvailability(cap, gitVersion)
  }

  /** 清单里按路径找一行（路径先归一，Windows 的反斜杠与大小写盘符都按同一棵算）。 */
  function rowOf(rows: any, p: any): any {
    const list: any[] = Array.isArray(rows) ? rows : []
    for (let i: number = 0; i < list.length; i += 1) if (worktreeSamePathOf(list[i].path, p)) return list[i]
    return null
  }

  /** 相对路径按仓库根解释（git 的 add / move 都是相对当前目录解析的，宿主钉的是仓库根）。 */
  function absOf(root: any, p: any): string {
    const s: string = strOf(p)
    if (s === '') return ''
    if (/^[a-zA-Z]:/.test(s) || s.charAt(0) === '/') return s
    return String(root || '') + '/' + s
  }

  /** 路径在不在：true / false / null（null 表示查不了，判定不拿它当依据）。 */
  async function existsOf(abs: any): Promise<any> {
    if (!abs || typeof d.pathExists !== 'function') return null
    try { const r: any = await d.pathExists(abs); return r === true ? true : (r === false ? false : null) } catch (e) { return null }
  }

  /** 脏条目条数：status --porcelain -z 按 NUL 切，每条一个；空字符串不算。 */
  function dirtyCountOf(text: any): number {
    const parts: string[] = String(text === undefined || text === null ? '' : text).split('\u0000')
    let n: number = 0
    for (let i: number = 0; i < parts.length; i += 1) if (parts[i] !== '') n += 1
    return n
  }

  /**
   * 读一次现场：git 可执行文件、仓库根、git 版本与档位、完整工作树清单（当前这一棵排第一）。
   * 失败一律回失败信封，不给半份现场——判定拿残缺清单会给出看起来合理但错误的 allow。
   */
  async function readBase(cwd: any): Promise<any> {
    const exe: any = await d.resolveGitExecutable()
    if (!exe) return fail('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    const base: any = await d.resolveRepoRoot(exe, cwd)
    if (!base || base.ok !== true) return base
    if (base.kind === 'bare') return fail('bare-repo', '这是一个裸仓库：它没有工作树，工作树八条在这里没有可操作的对象')
    const ver: any = await d.runPinned(exe, base.root, ['--version'], { stdoutLimit: 4096 })
    const badVer: any = d.failureFromExec(ver, '读 git 版本这一步')
    if (badVer) return badVer
    const gitVersion: string = d.firstLine(ver.stdout)
    const tier: string = capabilityTierFor(parseVersion(gitVersion))
    if (tier === 'unsupported') return fail('version', 'git 版本太旧（' + (gitVersion || '读不出') + '），管理多份工作树至少需要 2.11', { gitVersion: gitVersion, tier: tier })
    let listing: any = await d.runPinned(exe, base.root, worktreeArgsOf('list', {}), { stdoutLimit: LIST_LIMIT, timeoutMs: VC_WORKTREE_OP_TIMEOUT_MS })
    let useNul: boolean = true
    if (listing && listing.kind === 'non-zero') {
      listing = await d.runPinned(exe, base.root, worktreeArgsOf('list-plain', {}), { stdoutLimit: LIST_LIMIT, timeoutMs: VC_WORKTREE_OP_TIMEOUT_MS })
      useNul = false
    }
    const badListing: any = d.failureFromExec(listing, '读工作树清单这一步')
    if (badListing) return badListing
    if (listing.truncated) return fail('truncated', '工作树清单超过了字节上限，读不全就不给半份列表')
    const parsed: any = parseWorktrees(listing.stdout, useNul)
    if (parsed.ok !== true) return fail('parse', '工作树清单解析失败：' + parsed.detail)
    return {
      ok: true, exe: exe, root: base.root, gitDir: base.gitDir, gitVersion: gitVersion, tier: tier,
      rows: worktreeRowsOf(parsed.worktrees, { worktreePath: base.root }),
    }
  }

  /**
   * 读目标工作树的稀疏检出事实：当前规则、规则文件将落在哪、仓库顶层目录候选。
   * 「这个工作树不是稀疏检出」时 git 的 list 子命令以退出码 1 结束，按空规则处理（不是失败）。
   */
  async function readSparse(base: any, targetPath: any, dirs: any): Promise<any> {
    const rulesRes: any = await d.runPinned(base.exe, targetPath, worktreeArgsOf('sparse-list', {}), { stdoutLimit: OP_STDOUT_LIMIT, timeoutMs: VC_WORKTREE_OP_TIMEOUT_MS })
    const rulesBad: any = d.failureFromExec(rulesRes, '读稀疏检出规则这一步')
    if (rulesBad && !(rulesRes && rulesRes.kind === 'non-zero' && rulesRes.exitCode === 1)) return rulesBad
    const gitDirRes: any = await d.runPinned(base.exe, targetPath, worktreeArgsOf('sparse-rule-dir', {}), { stdoutLimit: 4096 })
    const gitDirBad: any = d.failureFromExec(gitDirRes, '读稀疏检出规则文件位置这一步')
    if (gitDirBad) return gitDirBad
    const candRes: any = await d.runPinned(base.exe, targetPath, worktreeArgsOf('sparse-candidates', {}), { stdoutLimit: LIST_LIMIT })
    const candBad: any = d.failureFromExec(candRes, '读目录候选这一步')
    if (candBad) return candBad
    return {
      ok: true,
      sparse: {
        rules: rulesRes && rulesRes.kind === 'ok' ? worktreeSparseRulesOf(rulesRes.stdout) : [],
        candidates: worktreeSparseCandidatesOf(candRes.stdout),
        ruleFile: worktreeSparseRulePathOf(targetPath, d.firstLine(gitDirRes.stdout)),
        dirs: dirs,
      },
    }
  }

  /** 记一张预检票据；表满从最旧的开始淘汰。 */
  function rememberTicket(op: any, action: any, input: any, base: any, ctx: any, sparse: any): WorktreeTicket {
    const t: WorktreeTicket = {
      id: idOf(), op: String(op), path: input.path, dest: input.dest, branch: input.branch,
      reason: input.reason, dirs: input.dirs.slice(), repoRoot: String(base.root || ''),
      checkedAtMs: now(), expiresAtMs: now() + TICKET_TTL_MS,
      worktreesDigest: worktreeDigestOf(base.rows),
      prunePaths: worktreePruneEntriesOf(base.rows).map(pathOf),
      sparseOld: sparse ? sparse.rules.slice() : [], dirtyCount: ctx.dirtyCount,
    }
    tickets[t.id] = t
    ticketOrder.push(t.id)
    return t
  }

  /** 记一次执行回包，供同一个请求号重放（客户端重复点同一个按钮时不重复动工作树）。 */
  function rememberResult(requestId: any, reply: any): void {
    const id: string = String(requestId)
    results[id] = { reply: reply, expiresAtMs: now() + TICKET_TTL_MS }
    resultOrder.push(id)
  }

  /** 预检电话：读现场、判 allow/warn/block、给写动作开票据；block 时也回现场，界面照现场画禁用原因。 */
  async function handleGitWorktreeCheck(args: any): Promise<any> {
    sweep()
    const a: any = args || {}
    const op: string = strOf(a.op)
    const action: any = actionById[op] || null
    if (!action) return fail('bad-op', '不认识的工作树动作：' + (op || '（空）'))
    const input: any = { path: strOf(a.path), dest: strOf(a.dest), branch: strOf(a.branch), reason: strOf(a.reason), dirs: dirsOf(a.dirs) }
    const base: any = await readBase(d.cwdOf(a))
    if (base.ok !== true) return base
    const rows: any[] = base.rows
    const row: any = rowOf(rows, input.path)
    const ctx: any = {
      rows: rows, availability: availabilityOf(action.capId, base.gitVersion),
      targetPath: input.path, dest: input.dest, branch: input.branch, reason: input.reason, dirs: input.dirs,
      targetExists: null, destExists: null, branchMissing: null, dirtyCount: null, prunableCount: null,
    }
    if (op === 'add' || op === 'add-branch') ctx.targetExists = await existsOf(absOf(base.root, input.path))
    if (op === 'move') ctx.destExists = await existsOf(absOf(base.root, input.dest))
    if (op === 'add-branch' && worktreeBranchProblem(input.branch) === '') {
      const probe: any = await d.runPinned(base.exe, base.root, ['rev-parse', '--verify', '--quiet', 'refs/heads/' + input.branch], { stdoutLimit: 4096 })
      if (probe && probe.kind === 'ok') ctx.branchMissing = false
      else if (probe && probe.kind === 'non-zero' && probe.exitCode === 1) ctx.branchMissing = true
      else { const badProbe: any = d.failureFromExec(probe, '确认分支是否存在这一步'); if (badProbe) return badProbe }
    }
    if (op === 'remove' && row && row.current !== true && row.locked !== true) {
      const st: any = await d.runPinned(base.exe, row.path, ['status', '--porcelain', '-z'], { stdoutLimit: DIRTY_LIMIT, timeoutMs: VC_WORKTREE_OP_TIMEOUT_MS })
      if (st && st.kind === 'ok' && st.truncated !== true) ctx.dirtyCount = dirtyCountOf(st.stdout)
    }
    let pruneEntries: any[] = []
    if (op === 'prune') { pruneEntries = worktreePruneEntriesOf(rows); ctx.prunableCount = pruneEntries.length }
    let sparse: any = null
    if ((op === 'sparse-list' || op === 'sparse-set') && row) {
      const read: any = await readSparse(base, row.path, input.dirs)
      if (read.ok !== true) return read
      sparse = read.sparse
    }
    const decision: any = worktreeJudge(op, ctx)
    const ticket: any = (decision.decision !== 'block' && action.confirm === true) ? rememberTicket(op, action, input, base, ctx, sparse) : null
    return {
      ok: true, readAtMs: now(), decision: decision,
      plan: { op: op, cmd: worktreeCmdNameOf(op), argv: worktreeArgsOf(op, input), pruneEntries: pruneEntries, sparse: sparse, dirtyCount: ctx.dirtyCount, targetPath: input.path },
      ticket: ticket ? { id: ticket.id, op: ticket.op, expiresAtMs: ticket.expiresAtMs } : null,
    }
  }

  /** 执行前的逐条重验：返回失败信封表示现场变了（零进程拒绝），返回 null 表示可以执行。 */
  async function revalidate(ticket: any, base: any): Promise<any> {
    const rows: any[] = base.rows
    const row: any = rowOf(rows, ticket.path)
    if (ticket.op === 'add' || ticket.op === 'add-branch') {
      if (await existsOf(absOf(base.root, ticket.path)) === true) return fail('target-changed', '目标路径在预检之后被占用了：' + ticket.path + '，请重新预检')
      return null
    }
    if (ticket.op === 'prune') {
      const paths: string[] = worktreePruneEntriesOf(rows).map(pathOf)
      if (paths.join('\u0001') !== ticket.prunePaths.join('\u0001')) return fail('worktrees-changed', '待清理的登记项在预检之后变了：请重新预检，照新清单再清一次')
      return null
    }
    if (!row) return fail('target-changed', '目标工作树在预检之后从清单里消失了：' + ticket.path + '，请重新预检')
    if (ticket.op === 'remove') {
      if (row.current === true) return fail('target-changed', '目标变成了当前工作树，按边界不能移除它')
      if (row.locked === true) return fail('target-changed', '目标在预检之后被锁定了：按边界先解锁，再重新预检移除')
    }
    if (ticket.op === 'lock' && row.locked === true) return fail('target-changed', '目标在预检之后已经被锁定了，请重新预检')
    if (ticket.op === 'unlock' && row.locked !== true) return fail('target-changed', '目标在预检之后已经不是锁定状态了，请重新预检')
    if (ticket.op === 'move' && await existsOf(absOf(base.root, ticket.dest)) === true) return fail('target-changed', '移动目的地在预检之后被占用了：' + ticket.dest + '，请重新预检')
    if (ticket.op === 'sparse-set') {
      const read: any = await readSparse(base, ticket.path, ticket.dirs)
      if (read.ok !== true) return read
      if (read.sparse.rules.join('\u0001') !== ticket.sparseOld.join('\u0001')) return fail('target-changed', '稀疏检出规则在预检之后变了：请重新预检，照最新规则再写')
    }
    return null
  }

  /** 这次动作作用在几个对象上：单棵工作树一条记 1，prune 记待清理项条数，稀疏检出记勾选目录数。 */
  function countOf(ticket: any): number {
    if (ticket.op === 'prune') return ticket.prunePaths.length
    if (ticket.op === 'sparse-set') return ticket.dirs.length
    return 1
  }

  /** 成功时界面该说「本来期望什么」：每条动作一句话，失败卡拿它对照实际。 */
  function expectedOf(op: any): string {
    const o: string = String(op)
    if (o === 'add' || o === 'add-branch') return '清单里多出一棵在指定路径上的工作树'
    if (o === 'remove') return '这棵工作树从清单里消失，目录按 git 的规矩清掉'
    if (o === 'prune') return '清单里那些目录已经不在的登记项被清掉'
    if (o === 'lock') return '这棵工作树带上锁定标记与原因'
    if (o === 'unlock') return '锁定标记被摘掉'
    if (o === 'move') return '工作树目录搬到新路径，清单里跟着更新'
    if (o === 'sparse-set') return '勾选的目录出现在稀疏检出规则里，其它目录不落盘'
    return 'git 完成这条命令'
  }

  /** 把一次进程执行翻成界面结果卡要的五段事实（成功只报命令名、耗时与对象数）。 */
  function outcomeOf(ticket: any, res: any, ms: number): any {
    const cmd: string = worktreeCmdNameOf(ticket.op)
    const out: any = { op: ticket.op, cmd: cmd, ms: ms, n: countOf(ticket), exitCode: null, gitText: '', step: '执行 ' + cmd + ' 这一步', expected: expectedOf(ticket.op), actual: '', cause: '' }
    if (res && res.kind === 'ok') { out.state = 'done'; out.actual = '命令正常结束'; return out }
    out.state = 'failed'
    out.expected = expectedOf(ticket.op)
    if (res && res.kind === 'non-zero') {
      out.exitCode = res.exitCode
      out.gitText = d.firstLine(res.stderr)
      out.actual = out.gitText
      out.cause = 'git 拒绝了这条命令（退出码 ' + res.exitCode + '），原始说法见 git 原话'
      return out
    }
    out.actual = '没有拿到 git 的原话'
    out.cause = '这条命令' + (res && res.kind === 'timeout' ? '超时了（' + VC_WORKTREE_OP_TIMEOUT_MS + ' 毫秒没有回音）' : (res && res.kind === 'spawn-failed' ? '起不了 git 进程：' + res.message : '没有返回可识别的结果'))
    return out
  }

  /** 执行电话：请求号去重 → 票据校验 → 现场重验 → 禁旗兜底 → 起进程（同一出口）→ 回结果。 */
  async function handleGitWorktreeRun(args: any): Promise<any> {
    sweep()
    const a: any = args || {}
    const requestId: string = strOf(a.requestId)
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(requestId)) return fail('bad-request', '这次执行缺少可复用的请求号（1–64 位字母、数字、下划线或连字符），没法防止重复执行')
    const replay: any = results[requestId]
    if (replay && now() < replay.expiresAtMs) return replay.reply
    if (a.confirm !== true) return fail('confirm-required', '这是要真正动工作树的操作：先走预检，并在确认卡上确认后再执行')
    const ticketId: string = strOf(a.ticketId)
    const ticket: any = ticketId ? tickets[ticketId] : null
    if (!ticket) return fail('ticket-missing', '预检票据不在（可能已经执行过、刷新过或过期），请重新预检再确认')
    if (ticket.op !== strOf(a.op)) return fail('ticket-op-mismatch', '票据上的动作是 ' + ticket.op + '，与这次要执行的 ' + strOf(a.op) + ' 不一致：请重新预检')
    if (!(now() < ticket.expiresAtMs)) { delete tickets[ticketId]; return fail('ticket-expired', '预检票据已经过期（有效期 ' + Math.round(TICKET_TTL_MS / 1000) + ' 秒），过期不自动重放：请重新预检并确认') }
    const base: any = await readBase(d.cwdOf(a))
    if (base.ok !== true) return base
    if (!worktreeSamePathOf(base.root, ticket.repoRoot)) return fail('stale-repo', '预检时钉的仓库是 ' + ticket.repoRoot + '，现在读到的是 ' + base.root + '：换仓库了，请重新预检')
    if (worktreeDigestOf(base.rows) !== ticket.worktreesDigest) return fail('worktrees-changed', '工作树清单在预检之后变了（多了、少了或被锁了）：请重新预检后再确认')
    const changed: any = await revalidate(ticket, base)
    if (changed) return changed
    const argv: any = worktreeArgsOf(ticket.op, ticket)
    if (!Array.isArray(argv) || argv.length === 0) return fail('bad-op', '动作 ' + ticket.op + ' 没有对应的 git 命令，已拒绝执行')
    const forbidden: string = worktreeForbiddenFlagIn(argv)
    if (forbidden) return fail('forbidden-flag', '内部检查发现 argv 里带了 ' + forbidden + '：这条边界（不提供 --force 与 -f -f 入口）不允许，已拒绝执行')
    delete tickets[ticketId]
    const dir: any = ticket.op === 'sparse-set' ? ticket.path : base.root
    const t0: number = now()
    const res: any = await d.runPinned(base.exe, dir, argv, { timeoutMs: VC_WORKTREE_OP_TIMEOUT_MS, stdoutLimit: OP_STDOUT_LIMIT })
    const reply: any = { ok: true, requestId: requestId, readAtMs: now(), result: outcomeOf(ticket, res, now() - t0) }
    rememberResult(requestId, reply)
    return reply
  }

  return { handleGitWorktreeCheck: handleGitWorktreeCheck, handleGitWorktreeRun: handleGitWorktreeRun }
}

/** 这份电话的出处：排查时凭它找到这份文件。 */
export const WORKTREE_PHONES_SOURCE: string = 'src/host/versionControlWorktrees.ts'
