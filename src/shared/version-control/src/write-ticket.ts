/**
 * src/shared/version-control/src/write-ticket.ts —— 写操作票据与索引指纹（#841，纯函数）
 *
 * 票据的语义照仓库既有先例（src/host/updatePkg/service.js 的 receipt）：**checkId + 过期时刻**，
 * 重放保护靠 requestId 去重（同一个 requestId 回到同一份结果），**不采用「用一次就烧掉」那套自创语义**
 * （总工 2026-10-04 订正 4）。真正挡住重复执行的是「票里记的仓库状态与此刻不一致」这件事本身：
 * 提交成功后 HEAD 变了、索引变了，同一张票自然判 stale-head / stale-index。
 *
 * 指纹输入（总工裁决 2）：git ls-files --stage -z 的原始 stdout，**不用 git write-tree**（不往用户对象库写东西）。
 * 两次取指纹必须逐字节同一口径（同一固定前缀、同一 -z、同一上限、不截断）——任何一处不同都会让
 * 「不一致」变成永远不一致。哈希本身在宿主做（node:crypto），本文件只管「取哪一份字节」与「比不相等」。
 */
import type { WriteOp, WritePlan, WriteTicket, WriteBindings, WritePreconditions, WriteCounters } from './ports.js'
import { TICKET_TTL_MS } from '../../time-config/values.js'

/** 票据有效期：预检到点击通常几秒；过期不自动续期（#1215：真源见 config/ttl.yaml 的 ticketTtlMs）。
 * 调用方要这个值请直接从 time-config 引（本文件不做二传：二传会让 esbuild 起别名，域转译过不去）。 */

/** 索引指纹的次级校验与诊断：NUL 记录条数（不含末尾空字段）。 */
export function indexRecordCount(lsFilesText: string): number {
  const parts = String(lsFilesText === undefined || lsFilesText === null ? '' : lsFilesText).split('\u0000')
  let n = 0
  for (const p of parts) if (p !== '') n += 1
  return n
}

/**
 * 待哈希的那一份字节：**原样**（不做换行归一化——路径里真的可以有 CR/LF，归一化会把「换了文件」当成没换）。
 * 这个函数存在的意义是把「取哪一份字节」写成一处可测的口径，宿主照它取。
 */
export function fingerprintInputOf(lsFilesText: string): string {
  return String(lsFilesText === undefined || lsFilesText === null ? '' : lsFilesText)
}

/**
 * 绑定表的规范化与比对（#1741）。
 *
 * 为什么要有这一层：预检和动手之间隔着用户点「确认」的那几秒，这几秒里仓库仍然可以被终端里的命令改动。
 * 光比 HEAD 与索引指纹挡不住「改上游配置」「远端分支被删」「工作树里冒出 MERGE_HEAD」这几类变化，
 * 所以把它们也量成值记进票里，动手前逐格对一遍。这里全是纯函数，哈希与读进程都在宿主做。
 */

/** 空绑定表的一个拷贝（每次返回新对象，调用方改它不会污染别人）。 */
export function makeBindings(partial?: any): WriteBindings {
  const p: any = (partial && partial.preconditions) || {}
  const c: any = (partial && partial.counters) || {}
  const preconditions: WritePreconditions = {
    planDigest: strOrNull(p.planDigest),
    worktreeDigest: strOrNull(p.worktreeDigest),
    configOldValue: strOrNull(p.configOldValue),
    remoteOid: strOrNull(p.remoteOid),
    unreachableDigest: strOrNull(p.unreachableDigest),
    pathAbsent: Array.isArray(p.pathAbsent) ? p.pathAbsent.map(function (x: any) { return String(x) }) : [],
  }
  const counters: WriteCounters = {
    indexEntries: (typeof c.indexEntries === 'number' && isFinite(c.indexEntries)) ? c.indexEntries : null,
  }
  return { preconditions: preconditions, counters: counters }
}

/** 票里没有这个字段时的空绑定表（每处要用空表都复制一份，别共享同一个对象）。 */
export const EMPTY_BINDINGS: WriteBindings = { preconditions: { planDigest: null, worktreeDigest: null, configOldValue: null, remoteOid: null, unreachableDigest: null, pathAbsent: [] }, counters: { indexEntries: null } }

function strOrNull(v: any): string | null {
  return (v === null || v === undefined) ? null : String(v)
}

/**
 * 规范化 JSON：对象键递归排序、数组保序、数值与布尔按字面量、undefined 当 null。
 * 两处（预检与执行）各自算一遍，只有同一口径才能比相等；直接 JSON.stringify 会因为键顺序不同判成不一致。
 */
export function canonicalJson(value: any): string {
  if (value === null || value === undefined) return 'null'
  const t = typeof value
  if (t === 'number') return isFinite(value) ? String(value) : 'null'
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (t === 'object') {
    const keys: string[] = Object.keys(value).filter(function (k: string) { return value[k] !== undefined }).sort()
    return '{' + keys.map(function (k: string) { return JSON.stringify(k) + ':' + canonicalJson(value[k]) }).join(',') + '}'
  }
  return 'null'
}

/** 计划这一格要哈希的字节：推送计划 / 拉取目标 / 更新远方记录的远端选择，规范化后的 JSON。 */
export function planBindingInput(plan: any): string {
  return canonicalJson(plan || null)
}

/** 工作树这一格要哈希的字节：暂存与未暂存两份路径清单（含各自的状态位），规范化后的 JSON。 */
export function worktreeBindingInput(screen: any): string {
  const s: any = screen || {}
  return canonicalJson({ staged: s.staged || [], unstaged: s.unstaged || [] })
}

/**
 * 运行中操作标记文件：哪些在预检时确认「不存在」。
 * 顺序固定（MERGE_HEAD、CHERRY_PICK_HEAD、REVERT_HEAD、rebase-merge、rebase-apply），执行前按同一顺序重算再比，
 * 任何一项从「不在」变成「在」都会让两份名单不等，从而按 target-changed 拒掉这次写操作。
 */
export function pathAbsentFromScreen(screen: any): string[] {
  const repo: any = (screen && screen.repo) || {}
  const out: string[] = []
  if (!repo.merging) out.push('MERGE_HEAD')
  if (!repo.cherryPicking) out.push('CHERRY_PICK_HEAD')
  if (!repo.reverting) out.push('REVERT_HEAD')
  if (!repo.rebasing) { out.push('rebase-merge'); out.push('rebase-apply') }
  return out
}

/** 决定这次写操作往哪去的旧配置原值：上游远端名 + 上游分支引用，用 NUL 分开（两个值都可能为空，不能用空格拼）。 */
export function configOldValueOf(remote: any, merge: any): string {
  return String(remote === undefined || remote === null ? '' : remote) + '\u0000' + String(merge === undefined || merge === null ? '' : merge)
}

/**
 * 绑定表比对：票里记了值的格子逐格与此刻重算的值比，一致回 null，不一致回写层理由标识符。
 * 顺序照「索引条数 → 目标类格子」：索引条数失配沿用 stale-index，其余一律 target-changed。
 * 票里没有 bindings（旧票）一律放行——字段扩张不许让存量票据全判死。
 */
export function bindingsVerdict(ticket: any, current: any): string | null {
  const tb: any = ticket && ticket.bindings
  if (!tb) return null
  const want: WriteBindings = makeBindings(tb)
  const got: WriteBindings = makeBindings(current)
  if (want.counters.indexEntries !== null && got.counters.indexEntries !== want.counters.indexEntries) return 'stale-index'
  const wp: WritePreconditions = want.preconditions
  const gp: WritePreconditions = got.preconditions
  if (wp.planDigest !== null && gp.planDigest !== wp.planDigest) return 'target-changed'
  if (wp.worktreeDigest !== null && gp.worktreeDigest !== wp.worktreeDigest) return 'target-changed'
  if (wp.configOldValue !== null && gp.configOldValue !== wp.configOldValue) return 'target-changed'
  if (wp.remoteOid !== null && gp.remoteOid !== wp.remoteOid) return 'target-changed'
  if (wp.unreachableDigest !== null && gp.unreachableDigest !== wp.unreachableDigest) return 'target-changed'
  if (wp.pathAbsent.join('\u0000') !== gp.pathAbsent.join('\u0000')) return 'target-changed'
  return null
}

/** 造一张票。 */
export function makeTicket(input: {
  id: string
  op: WriteOp
  nowMs: number
  headOid: string
  indexFingerprint: string | null
  indexEntries: number | null
  target: WritePlan | null
  repoRoot: string
  /** 绑定表：预检那一刻量下来的「执行前必须还没变」的状态；不传就当空表（只有票里记了值才比对）。 */
  bindings?: any
}): WriteTicket {
  return {
    id: String(input.id || ''),
    op: input.op,
    repoRoot: String(input.repoRoot || ''),
    checkedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + TICKET_TTL_MS,
    headOid: String(input.headOid || ''),
    indexFingerprint: input.indexFingerprint === null || input.indexFingerprint === undefined ? null : String(input.indexFingerprint),
    indexEntries: (typeof input.indexEntries === 'number' && isFinite(input.indexEntries)) ? input.indexEntries : null,
    target: input.target || null,
    bindings: makeBindings(input.bindings),
  }
}

/** 此刻的仓库状态：由宿主在执行前重新量一次，交给本函数比对。 */
export interface WriteCurrent {
  op: WriteOp
  headOid: string
  indexFingerprint: string | null
  indexAvailable: boolean
  target: WritePlan | null
  /** 此刻这个工作树的根（执行前重量一次；票是给哪个仓库发的就只许在哪个仓库执行）。 */
  repoRoot: string
  /** 此刻重量的绑定值（#1741）：交给 bindingsVerdict 与票里那张表逐格比对。 */
  bindings?: WriteBindings
}

/** 纯判定（#841 第三批 ④）：只查「票在不在 / 动作对不对 / 过期没有」——**不起任何进程**。
 *  宿主必须先过这一关，再去做需要起进程的状态比对；口径是「任何写命令之前必须先过票据门」。 */
export function ticketPureVerdict(ticket: WriteTicket | null | undefined, op: WriteOp, nowMs: number): { ok: true } | { ok: false; reason: string } {
  if (!ticket || !ticket.id) return { ok: false, reason: 'ticket-missing' }
  if (ticket.op !== op) return { ok: false, reason: 'ticket-op-mismatch' }
  if (!(nowMs < ticket.expiresAtMs)) return { ok: false, reason: 'ticket-expired' }
  return { ok: true }
}

/** 票据 id 与 requestId 是外部输入：形状不合就拒（id 走 idShapeProblem，requestId 同规矩但可空）。 */
export function requestIdProblem(id: string): string | null {
  const s = String(id === undefined || id === null ? '' : id)
  if (s === '') return null
  if (s.length > 64 || !/^[A-Za-z0-9_-]+$/.test(s)) return 'bad-target'
  return null
}

/** 核对顺序照附录第 2 节：票据在不在 → 动作对不对 → 过期没有 → HEAD 漂没漂 → 指纹/目标变没变。 */
export function ticketVerdict(ticket: WriteTicket | null | undefined, nowMs: number, current: WriteCurrent): { ok: true } | { ok: false; reason: string } {
  if (!ticket || !ticket.id) return { ok: false, reason: 'ticket-missing' }
  if (ticket.op !== current.op) return { ok: false, reason: 'ticket-op-mismatch' }
  if (!(nowMs < ticket.expiresAtMs)) return { ok: false, reason: 'ticket-expired' }
  if (String(current.repoRoot || '') !== String(ticket.repoRoot || '')) return { ok: false, reason: 'stale-repo' }
  if (String(current.headOid || '') !== String(ticket.headOid || '')) return { ok: false, reason: 'stale-head' }
  if (ticket.op === 'commit') {
    if (current.indexAvailable !== true) return { ok: false, reason: 'fingerprint-unavailable' }
    if (String(current.indexFingerprint || '') !== String(ticket.indexFingerprint || '')) return { ok: false, reason: 'stale-index' }
  }
  if (ticket.op === 'pull') {
    // pull 也必须绑目标（#841 第三批 ②）：只比 HEAD 的话，预检之后改上游或切分支都能绕过。
    const a = ticket.target || { upstream: null, localBranch: '' }
    const b = current.target || { upstream: null, localBranch: '' }
    if (String(a.upstream || '') !== String(b.upstream || '') || String(a.localBranch || '') !== String(b.localBranch || '')) return { ok: false, reason: 'target-changed' }
  }
  if (ticket.op === 'push') {
    const a = ticket.target || { mode: '', remote: '', branch: '', localBranch: '' }
    const b = current.target || { mode: '', remote: '', branch: '', localBranch: '' }
    if (a.mode !== b.mode || a.remote !== b.remote || a.branch !== b.branch || a.localBranch !== b.localBranch) return { ok: false, reason: 'target-changed' }
  }
  return { ok: true }
}

/**
 * i-t-a（git add -N，intent-to-add）检测（总工 2026-10-04 订正 3）：这种条目在 ls-files --stage 里
 * 与「真暂存一个空文件」指纹完全相同，但提交进去的会是工作区此刻的内容 —— 面板不替用户赌，直接拒绝。
 * 判据（2026-10-04 第二段真机字节修正）：i-t-a 的 1 号记录长这样 ——
 *   `1 .A N... 000000 000000 100644 0000… 0000… n.txt`
 * 特征是 **XY = `.A`（索引里加了、工作区还没暂存）且 mI = `000000`（索引里没有 blob）**。
 * 曾经写错成「sub 字段 = N...」——那是「不是子模块」的意思，**每条普通记录都是 N...**，
 * 于是任何有暂存改动的仓库预检提交都会被误判成 i-t-a（接线冒烟当场抓到）。
 * 对照：普通暂存是 `1 M. N... 100644 100644 100644 <oid> <oid> a.txt`（mI 是 100644）。
 */
export function hasIntentToAdd(statusPorcelainV2Z: string): boolean {
  const text = String(statusPorcelainV2Z === undefined || statusPorcelainV2Z === null ? '' : statusPorcelainV2Z)
  if (text === '') return false
  for (const rec of text.split('\u0000')) {
    if (rec === '') continue
    if (rec[0] !== '1') continue
    const fields = rec.split(' ')
    // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
    if (fields.length >= 5 && fields[1] === '.A' && fields[4] === '000000') return true
  }
  return false
}

export const WRITE_TICKET_SOURCE = 'src/shared/version-control/src/write-ticket.ts'
