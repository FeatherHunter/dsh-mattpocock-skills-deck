// src/deck/tools/issue-patch-status.ts —— deck_issue_patch 的状态冲突预检与归一（#1790 缺陷 A）
//
// 为什么单独一份：issue-patch.ts 的有效行贴着每文件 350 行的上限（tests/verify-file-granularity.ts），
// 这里只放「冲突怎么看、归一怎么写、拒绝怎么回」这一组判断；写动作的顺序仍留在 issue-patch.ts 里。
//
// 口径（与本地 Markdown 后端同一条）：
//   1. 可见 Status 行是本地票的状态真源；隐藏 DSH-LABELS 只放非 triage 标签。
//   2. 读侧发现两者各说各话（真冲突）时不会自己挑一个静默改掉，而在 statusConflict 里把两边都带出来。
//   3. deck_issue_patch 遇到真冲突时整次不写：要么调用方显式给 resolveStatus（visible / hidden），
//      要么回执带 data.retry.args 让调用方按它重试。半写（先发评论、再把状态改坏）比不写更糟。
//   4. 给了 resolveStatus 时先按选择把两处归一（写一次 setLabels），再执行调用方点名的步骤。
//
// 这里不 import 跟踪器房间的源码（依赖图不许 deck 直接摸 rooms）：状态词表的唯一真源在本地 Markdown 后端，
// deck 只做两件不需要词表的事 —— 把后端读出来的 statusConflict 两侧原样比字符串，
// 以及把归一这件事交回后端的 setLabels（它自己会把 triage 写进可见 Status 行、并记历史）。
import { DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { must, timeoutMessage } from '../shell/backend-transport.js'
import type { TransportResult } from '../shell/backend-transport.js'
import { withKeyLock } from '../shell/write-mutex.js'
import type { KeyLockOpts } from '../shell/write-mutex.js'
import { rosterDirty } from '../shell/call-memo.js'
import type { CallMemo } from '../shell/call-memo.js'
import type { StatusConflict } from '../../tracker/contract/entities.js'

/** 尚未建模的后端回包：逐格验，不猜。 */
type UnknownRecord = Record<string, unknown>

/** 冲突时优先采用哪一侧：可见 Status 行（visible）或隐藏 DSH-LABELS 里的 triage 标签（hidden）。 */
export type StatusChoice = 'visible' | 'hidden'

/** 读一次票的结果：读到冲突与否、当前有效状态与标签；读失败时区分超时（可重试）与其它错误。 */
export type StatusConflictRead =
  | { ok: true; conflict: StatusConflict | null; status: string; labels: string[]; statusModel: boolean }
  | { ok: false; kind: 'timeout' | 'error'; message: string }

/** 只读轨迹：issue-patch.ts 里 t 是运行时真值，这里按实际用到的两个方法收窄。 */
interface TrackerStatus {
  get(repo: unknown, key: string, opts: unknown, opCtx: unknown): Promise<unknown>
  setLabels(repo: unknown, key: string, labels: string[], opts: Record<string, unknown>, opCtx: unknown): Promise<unknown>
}

/** 从一批名字里收干净的字符串（字符串直接用，对象取 name，空串丢掉）。 */
export function namesOf(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const item of list) {
    const name = String(typeof item === 'string' ? item : (item && (item as UnknownRecord).name) || '').trim()
    if (name) out.push(name)
  }
  return out
}

/** 从这次要写的正文里取 Status 行：只认第一个一级标题之前的行（与后端取正文 Status 行的语法同一段）。
 *  这里只做「同一次调用显式点的状态与 resolveStatus 是否一致」的字符串比较，不做词表校验：
 *  哪些词算状态由后端决定，deck 不另存一份词表。 */
function bodyStatusLineOf(body: unknown): string | null {
  if (typeof body !== 'string' || !body) return null
  const firstHeading = body.search(/^#\s+/m)
  const head = firstHeading >= 0 ? body.slice(0, firstHeading) : body
  const match = /^\s*(?:\*\*)?Status(?:\*\*)?\s*[:：][ \t]*(?:\*\*)?[ \t]*([^\n]*)/im.exec(head)
  if (!match) return null
  const value = String(match[1] || '').replace(/\*\*/g, '').replace(/[`'"]/g, '').trim().toLowerCase()
  return value || null
}

/** 解析 resolveStatus：只接受 visible / hidden；没给时 choice 为 null（照常执行，不做归一）。 */
export function parseStatusChoice(args: UnknownRecord): { ok: true; choice: StatusChoice | null } | { ok: false; problem: string } {
  const raw = args.resolveStatus
  if (raw === undefined || raw === null) return { ok: true, choice: null }
  const value = String(raw).trim().toLowerCase()
  if (value === 'visible' || value === 'hidden') return { ok: true, choice: value }
  return { ok: false, problem: 'resolveStatus 只接受 visible 或 hidden（告诉这次按可见 Status 行还是按隐藏 triage 标签归一）：这次给的是「' + String(raw) + '」。' }
}

/** 读一次票，把状态冲突与当前标签带回来。读失败不猜：超时与其它错误分开报。 */
export async function readStatusConflict(t: unknown, repo: unknown, key: string, opCtx: unknown): Promise<StatusConflictRead> {
  const tracker = t as unknown as TrackerStatus
  const raw = await tracker.get(repo, key, {}, opCtx)
  const timeoutText = timeoutMessage(raw as unknown as TransportResult)
  if (timeoutText) return { ok: false, kind: 'timeout', message: timeoutText }
  const result = must(raw) as UnknownRecord | null
  if (!result || result.ok !== true) {
    const error = (result && result.error) as UnknownRecord | undefined
    return { ok: false, kind: 'error', message: String((error && error.message) || '后端没给出原因').slice(0, 300) }
  }
  const ticket = (result.data || {}) as UnknownRecord
  const conflict = ticket.statusConflict
  return {
    ok: true,
    conflict: conflict && typeof conflict === 'object' ? (conflict as StatusConflict) : null,
    status: typeof ticket.status === 'string' ? ticket.status : '',
    labels: Array.isArray(ticket.labels) ? ticket.labels : [],
    // 读回里带了「状态从哪来」才说明这个后端用可见状态行这套模型（本地 Markdown 的票）；
    // 别的后端没有这两格，回执里的状态说明就不该按可见状态行去解释。
    statusModel: ticket.statusSource !== undefined || ticket.statusVisible !== undefined,
  }
}

/** 按选择取归一时采用的状态值：visible 取可见行，hidden 取隐藏 triage 标签（真冲突保证恰好一枚）。 */
export function chosenStatusOf(conflict: StatusConflict, choice: StatusChoice): string {
  if (choice === 'visible') return String(conflict.visible || '')
  const hidden = Array.isArray(conflict.hidden) ? conflict.hidden : []
  return String(hidden[0] || '')
}

/** 冲突的人话摘要：把两边各写了什么说清，回执与日志都直接用这一句。 */
export function conflictNote(conflict: StatusConflict): string {
  const hidden = Array.isArray(conflict.hidden) ? conflict.hidden.join('、') : ''
  return '这张票的可见 Status 行写的是「' + String(conflict.visible || '') + '」，隐藏 DSH-LABELS 里的 triage 标签写的是「' + hidden + '」：两处冲突，读侧暂时按可见行回答。'
}

/**
 * 同一次调用里显式点的状态与这次选择是否一致：正文 Status 行或 addLabels 里点名了未被选择的那一侧，
 * 说明调用方自己没想清要哪个，整次拒绝最安全（不写、不归一）。
 * 只比较冲突两侧的字面值：状态词表的判定仍在后端，deck 不复制词表。
 */
export function explicitMismatchProblem(args: UnknownRecord, conflict: StatusConflict, chosen: string): string | null {
  const hidden = Array.isArray(conflict.hidden) ? conflict.hidden : []
  const other = chosen === String(conflict.visible || '') ? String(hidden[0] || '') : String(conflict.visible || '')
  const picked: string[] = namesOf(args.addLabels).map((name) => name.toLowerCase())
  if (other && picked.indexOf(other.toLowerCase()) >= 0) {
    return '这次 resolveStatus 选的是「' + chosen + '」，但 addLabels 里点名了另一侧的状态「' + other + '」：两处不一致，请只留一处。'
  }
  const bodyStatus = bodyStatusLineOf(args.body)
  if (bodyStatus !== null && bodyStatus !== chosen.toLowerCase()) {
    return '这次 resolveStatus 选的是「' + chosen + '」，但正文里的 Status 行写的是「' + bodyStatus + '」：两处不一致，请只留一处。'
  }
  return null
}

/** 原参数复制一份、把 resolveStatus 设成 visible，作为「按可见行归一后重试」的建议参数。 */
export function retryArgs(args: UnknownRecord): UnknownRecord {
  const out: UnknownRecord = {}
  for (const name of Object.keys(args)) {
    const value = args[name]
    if (value === undefined || value === null) continue
    out[name] = value
  }
  out.resolveStatus = 'visible'
  return out
}

/** 统一的不写回执：status unsupported + 机器可读原因 + 一条 step:'status' 的失败项（一步都没走）。 */
export function refusalReply(
  key: string,
  reason: string,
  text: string,
  data: UnknownRecord,
  items: UnknownRecord[],
  estimate: { requests?: unknown; points?: unknown },
  reads: number = 0,
): { value: UnknownRecord; claimed: { requests: number; points: number } } {
  const num = (v: unknown): number => (typeof v === 'number' && isFinite(v)) ? v : 0
  return {
    value: {
      status: DECK_STATUS.UNSUPPORTED,
      reason: reason,
      text: text,
      data: Object.assign({ key: key }, data),
      items: items,
      notes: [],
      touched: [key],
    },
    // 预检读了几次票就记几次读：一次预读记 1，没读过不记（与调用方自己对写动作的记账相加，不重复算）。
    claimed: { requests: num(estimate && estimate.requests) + reads, points: num(estimate && estimate.points) },
  }
}

/**
 * 真冲突且调用方没给 resolveStatus 时的整笔拒绝：一个字都不写，把冲突与重试参数带回去。
 * retry.args 是在原参数上加 resolveStatus:'visible'（读侧默认按可见行回答，重试顺着同一份数据走），
 * 不要求调用方自己拼参数；票在两次调用之间被改过时，调用方应按新回执重新取 retry。
 */
export function conflictRefusal(
  key: string,
  conflict: StatusConflict,
  args: UnknownRecord,
  estimate: { requests?: unknown; points?: unknown },
): { value: UnknownRecord; claimed: { requests: number; points: number } } {
  const note = conflictNote(conflict)
  const reason = note + '这一笔整次没写（没发评论、没改标签、没动状态）。要么先显式给 resolveStatus: visible 或 hidden 选一侧，要么直接按 data.retry.args 重试：它已把 resolveStatus 设成 visible。'
  return refusalReply(
    key,
    REFUSAL_REASONS.BAD_ARGS,
    reason,
    { statusConflict: conflict, retry: { tool: 'deck_issue_patch', args: retryArgs(args) } },
    [{ key: key, step: 'status', status: 'failed', reason: note }],
    estimate,
    1,
  )
}

/** issue-patch.ts 递进来的运行时袋子：预算、回执与失败记录都留在调用方，这里只管「看冲突、归一、拒绝」。 */
export interface StatusGuardInput {
  args: UnknownRecord
  key: string
  repo: unknown
  tracker: unknown
  opCtx: unknown
  estimate: { requests?: unknown; points?: unknown }
  items: UnknownRecord[]
  outOfBudget: () => boolean
  fail: (step: string, result: { error?: { message?: unknown } } | null | undefined) => void
  over: (step: string) => void
  timeoutReply: (message: string) => unknown
  lockedOut: (step: string) => void
  lockOpts: KeyLockOpts
  /** 这次还有标签步骤要点名改标签：归一与改标签合并到同一次 setLabels，少写一次盘。 */
  deferToLabels: boolean
}

/** 预检结局：ok 继续执行调用方点名的步骤；不 ok 时 reply 就是整笔回执（一个字都没写）。 */
export type StatusGuardResult =
  | { ok: true; chosen: string | null; conflict: StatusConflict | null; normalized: boolean; status: string; statusModel: boolean }
  | { ok: false; reply: unknown }

/** 一次调用里的读缓存：归一前必须先作废这张票的旧读，否则锁内读到的是预检时的快照（#1790 并发丢更新）。 */
function memoOf(opCtx: unknown): CallMemo | null {
  const ctx = (opCtx || {}) as UnknownRecord
  const memo = ctx.memo
  return memo && typeof memo === 'object' ? (memo as CallMemo) : null
}

/** 作废这张票的读缓存；失败只影响新鲜度，不影响正确性（最坏退回旧快照，与不带缓存时同）。 */
function forgetRead(memo: CallMemo | null, repo: unknown, key: string): void {
  if (!memo) return
  try { rosterDirty(memo, repo, [key]) } catch (e) { /* 缓存作废失败不该让写停下 */ }
}

/** 按已经选好的一侧把两处归一：锁内先读最新标签，再去掉冲突两侧的名字，最后把状态写回可见行。
 *  读与写在同一把锁里，且读之前作废缓存：不会再用锁外快照覆盖同票并发加上的标签。 */
async function normalizeConflict(input: StatusGuardInput, chosen: string, conflict: StatusConflict): Promise<{ ok: true } | { ok: false; reply: unknown }> {
  const tracker = input.tracker as unknown as TrackerStatus
  const memo = memoOf(input.opCtx)
  let lockTimeout: string | null = null
  let failed = false
  const held = await withKeyLock(input.repo, input.key, async () => {
    if (input.outOfBudget()) { input.over('status'); failed = true; return }
    forgetRead(memo, input.repo, input.key)
    const raw = await tracker.get(input.repo, input.key, {}, input.opCtx)
    const readTimeout = timeoutMessage(raw as unknown as TransportResult)
    if (readTimeout) { lockTimeout = readTimeout; return }
    const cur = must(raw) as UnknownRecord | null
    if (!cur || cur.ok !== true) { input.fail('status', cur); failed = true; return }
    const labels = namesOf(((cur.data || {}) as UnknownRecord).labels)
    // 冲突两侧的名字都从整批里去掉：选了 visible 就把隐藏那枚 triage 摘掉，反之亦然。
    const kept = labels.filter((name) => name !== conflict.visible && conflict.hidden.indexOf(name) < 0)
    const rawSet = await tracker.setLabels(input.repo, input.key, kept, { status: chosen }, input.opCtx)
    const setTimeout = timeoutMessage(rawSet as unknown as TransportResult)
    if (setTimeout) { lockTimeout = setTimeout; return }
    const done = must(rawSet) as UnknownRecord | null
    if (done && done.ok === true) {
      input.items.push({ key: input.key, step: 'status', status: 'ok', adopted: chosen })
      forgetRead(memo, input.repo, input.key)
    } else {
      input.fail('status', done)
      failed = true
    }
  }, input.lockOpts)
  if (lockTimeout !== null) return { ok: false, reply: input.timeoutReply(lockTimeout) }
  if (held && held.ok === false && held.timedOut) input.lockedOut('status')
  if (failed) {
    return {
      ok: false,
      reply: refusalReply(input.key, REFUSAL_REASONS.BACKEND_UNSUPPORTED, '先把状态归一时没成（原因在上面）：这一步没成就不往下写，避免半写。', {}, input.items, input.estimate, 1),
    }
  }
  return { ok: true }
}

/**
 * #1790 缺陷 A 的写前闸：读一次当前票，遇到「可见 Status 行与隐藏 triage 标签各说各话」时，
 * 没有 resolveStatus 就整次拒绝（回执带 data.retry）；给了就按选择归一，再放后面步骤走。
 *
 * 归一先于调用方点名的写动作：resolveStatus 是调用方显式授权的写，先归一能让后面每一步
 * 看到的都是同一份状态；它自己没成时也不往下走，避免半写。
 * 例外：这次还点了改标签时归一交给标签那一步合并写（deferToLabels），少写一次盘。
 */
export async function guardStatus(input: StatusGuardInput): Promise<StatusGuardResult> {
  const choiceParse = parseStatusChoice(input.args)
  if (!choiceParse.ok) {
    return { ok: false, reply: refusalReply(input.key, REFUSAL_REASONS.BAD_ARGS, choiceParse.problem + '这次一个字都没动。', {}, [{ key: input.key, step: 'status', status: 'failed', reason: choiceParse.problem }], input.estimate) }
  }
  // 先读一次现状：本地 Markdown 会在回包里带 statusConflict，别的后端没有这一格、读到空冲突就照常往下走。
  // 这里不按后端编号分岔（工具层不许自己判后端）：多出来的这一次读是写前看现状的代价，
  // 换来的是所有后端走同一条路，返修与新增后端都不用再动这里。
  const read = await readStatusConflict(input.tracker, input.repo, input.key, input.opCtx)
  if (!read.ok) {
    if (read.kind === 'timeout') return { ok: false, reply: input.timeoutReply(read.message) }
    return { ok: false, reply: refusalReply(input.key, REFUSAL_REASONS.BACKEND_UNSUPPORTED, '读这张票的当前状态时后端没回 ok：这次一个字都没动，等能读回再改。', { error: { kind: 'read', message: read.message } }, [{ key: input.key, step: 'status', status: 'failed', reason: read.message }], input.estimate) }
  }
  // 预检这一读留在调用缓存里会让后面的读改写拿到旧快照：读完立刻作废（#1790 verify-deck-parallel 丢更新）。
  forgetRead(memoOf(input.opCtx), input.repo, input.key)
  if (read.conflict === null) return { ok: true, chosen: null, conflict: null, normalized: false, status: read.status, statusModel: read.statusModel }
  if (choiceParse.choice === null) return { ok: false, reply: conflictRefusal(input.key, read.conflict, input.args, input.estimate) }
  const chosen = chosenStatusOf(read.conflict, choiceParse.choice)
  const mismatch = explicitMismatchProblem(input.args, read.conflict, chosen)
  if (mismatch !== null) {
    return { ok: false, reply: refusalReply(input.key, REFUSAL_REASONS.BAD_ARGS, mismatch + '这次一个字都没动。', { statusConflict: read.conflict }, [{ key: input.key, step: 'status', status: 'failed', reason: mismatch }], input.estimate, 1) }
  }
  if (input.deferToLabels) return { ok: true, chosen: chosen, conflict: read.conflict, normalized: false, status: read.status, statusModel: read.statusModel }
  // 顺序：归一排在评论/认领/正文之前，因为它最容易按调用方已选的一侧失败；先做它，失败时盘上只多了
  // 这次显式授权的状态归一。评论写上去就撤不回来，所以评论排在归一之后，不抢在它前面。
  const normalized = await normalizeConflict(input, chosen, read.conflict)
  if (!normalized.ok) return { ok: false, reply: normalized.reply }
  return { ok: true, chosen: chosen, conflict: read.conflict, normalized: true, status: chosen, statusModel: read.statusModel }
}
