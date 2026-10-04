/**
 * version-control-core/src/write-ticket.ts —— 写操作票据与索引指纹（#841，纯函数）
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
import type { WriteOp, WritePlan, WriteTicket } from './ports.js'

/** 票据有效期：预检到点击通常几秒；过期不自动续期。 */
export const TICKET_TTL_MS = 120000

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

export const WRITE_TICKET_SOURCE = 'version-control-core/src/write-ticket.ts'
