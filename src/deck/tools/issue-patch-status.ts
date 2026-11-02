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
import { DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { must, timeoutMessage } from '../shell/backend-transport.js'
import type { TransportResult } from '../shell/backend-transport.js'
import { withKeyLock } from '../shell/write-mutex.js'
import type { KeyLockOpts } from '../shell/write-mutex.js'
import { isTriageStatus, normalizeStatus, statusInBody } from '../../tracker/rooms/markdown/status.js'
import type { StatusConflict } from '../../tracker/contract/entities.js'

/** 尚未建模的后端回包：逐格验，不猜。 */
type UnknownRecord = Record<string, unknown>

/** 冲突时优先采用哪一侧：可见 Status 行（visible）或隐藏 DSH-LABELS 里的 triage 标签（hidden）。 */
export type StatusChoice = 'visible' | 'hidden'

/** 读现状的结果：读到冲突与否；读失败时区分超时（可重试）与其它错误（先能读回再改）。 */
export type StatusRead =
  | { ok: true; conflict: StatusConflict | null; status: string; labels: string[]; body: string }
  | { ok: false; kind: 'timeout' | 'error'; message: string }

/** 只读轨迹：issue-patch.ts 里 t 是运行时真值，这里按实际用到的两个方法收窄。 */
interface TrackerRead {
  get(repo: unknown, key: string, opts: unknown, opCtx: unknown): Promise<unknown>
}

/** 解析 resolveStatus：只接受 visible / hidden；没给时 choice 为 null（照常执行，不做归一）。 */
export function parseStatusChoice(args: UnknownRecord): { ok: true; choice: StatusChoice | null } | { ok: false; problem: string } {
  const raw = args.resolveStatus
  if (raw === undefined || raw === null) return { ok: true, choice: null }
  const value = String(raw).trim().toLowerCase()
  if (value === 'visible' || value === 'hidden') return { ok: true, choice: value }
  return { ok: false, problem: 'resolveStatus 只接受 visible 或 hidden（告诉这次按可见 Status 行还是按隐藏 triage 标签归一）：这次给的是「' + String(raw) + '」。' }
}

/** 从一组标签名里挑出五枚 triage 状态标签（已归一、去重、保持顺序）。 */
export function triageNamesOf(list: unknown): string[] {
  const out: string[] = []
  if (!Array.isArray(list)) return out
  for (const item of list) {
    const name = String(typeof item === 'string' ? item : (item && (item as UnknownRecord).name) || '').trim()
    const norm = normalizeStatus(name)
    if (norm !== null && isTriageStatus(norm) && out.indexOf(norm) < 0) out.push(norm)
  }
  return out
}

/** 从当前标签清单里滤掉合成出来的 triage 标签：只剩真正存在 DSH-LABELS 里的非 triage 标签。 */
export function nonTriageLabelsOf(list: unknown): string[] {
  const out: string[] = []
  if (!Array.isArray(list)) return out
  for (const item of list) {
    const name = String(typeof item === 'string' ? item : (item && (item as UnknownRecord).name) || '').trim()
    if (!name) continue
    if (isTriageStatus(normalizeStatus(name) || '')) continue
    if (out.indexOf(name) < 0) out.push(name)
  }
  return out
}

/**
 * 同一次调用里显式点名的状态：addLabels 里的 triage 标签与正文片段里的 Status 行。
 * 两处都点名且不一致、或 addLabels 一次给多枚 triage 时直接拒绝——它们会让「这次到底要哪个状态」说不清。
 */
export function explicitStatusOf(args: UnknownRecord): { triage: string[]; bodyStatus: string | null; problem: string | null } {
  const triage = triageNamesOf(args.addLabels)
  const bodyStatus = typeof args.body === 'string' ? statusInBody(args.body) : null
  if (triage.length > 1) {
    return { triage: triage, bodyStatus: bodyStatus, problem: '这次给了多枚 triage 状态标签（' + triage.join('、') + '）：可见 Status 行只能写一个状态，请只留一枚。' }
  }
  if (triage.length === 1 && bodyStatus !== null && bodyStatus !== triage[0]) {
    return { triage: triage, bodyStatus: bodyStatus, problem: '正文里的 Status 行写的是「' + bodyStatus + '」，addLabels 里的 triage 是「' + triage[0] + '」：两处不一致，请只留一处。' }
  }
  return { triage: triage, bodyStatus: bodyStatus, problem: null }
}

/** 读一次票，把状态冲突与当前标签带回来。读失败不猜：超时与其它错误分开报。 */
export async function readStatusConflict(t: unknown, repo: unknown, key: string, opCtx: unknown): Promise<StatusRead> {
  // t 是运行时真值（TrackerSession），这里只按 get 的形状收窄，避免把整份会话类型搬进本文件。
  const tracker = t as unknown as TrackerRead
  const raw = await tracker.get(repo, key, {}, opCtx)
  const timeout = timeoutMessage(raw as unknown as TransportResult)
  if (timeout) return { ok: false, kind: 'timeout', message: timeout }
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
    body: typeof ticket.body === 'string' ? ticket.body : '',
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
 * 显式点名的状态与这次选择是否一致：resolveStatus 做了选择，同一次调用里却给了另一个状态，
 * 说明调用方自己没想清要哪个，整次拒绝最安全（不写、不归一）。
 */
export function choiceMismatchProblem(explicit: { triage: string[]; bodyStatus: string | null }, chosen: string): string | null {
  if (explicit.triage.length === 1 && explicit.triage[0] !== chosen) {
    return '这次 resolveStatus 选的是「' + chosen + '」，但 addLabels 里的 triage 是「' + explicit.triage[0] + '」：两处不一致，请只留一处。'
  }
  if (explicit.bodyStatus !== null && explicit.bodyStatus !== chosen) {
    return '这次 resolveStatus 选的是「' + chosen + '」，但正文里的 Status 行写的是「' + explicit.bodyStatus + '」：两处不一致，请只留一处。'
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
    // 预检只要读过一张票，就把这次读记进 claimed（与 specCloseGuard 的记账口径一致）。
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

/** 写标签这一路的最小形状：只为在归一那一步调用 setLabels，不把整份会话类型搬进来。 */
interface TrackerLabels {
  setLabels(repo: unknown, key: string, labels: string[], opts: Record<string, unknown>, opCtx: unknown): Promise<unknown>
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
}

/** 同一次调用里显式点名的状态（addLabels 的 triage 与正文 Status 行），归一后交给后面的标签步骤复用。 */
export interface StatusGuardExplicit {
  triage: string[]
  bodyStatus: string | null
}

/** 预检结局：ok 继续执行调用方点名的步骤；不 ok 时 reply 就是整笔回执（一个字都没写）。 */
export type StatusGuardResult = { ok: true; explicit: StatusGuardExplicit } | { ok: false; reply: unknown }

/**
 * #1790 缺陷 A 的写前闸：读一次当前票，遇到「可见 Status 行与隐藏 triage 标签各说各话」时，
 * 没有 resolveStatus 就整次拒绝（回执带 data.retry）；给了就先按选择归一，再放后面步骤走。
 *
 * 为什么归一要先于其它写动作：标签、关闭、评论都会改变这张票的可见内容，
 * 先归一能让后面每一步看到的都是同一份状态；归一自己没成时也不往下走，避免半写。
 */
export async function guardStatus(input: StatusGuardInput): Promise<StatusGuardResult> {
  const choiceParse = parseStatusChoice(input.args)
  if (!choiceParse.ok) {
    return { ok: false, reply: refusalReply(input.key, REFUSAL_REASONS.BAD_ARGS, choiceParse.problem + '这次一个字都没动。', {}, [{ key: input.key, step: 'status', status: 'failed', reason: choiceParse.problem }], input.estimate) }
  }
  const explicit = explicitStatusOf(input.args)
  if (explicit.problem !== null) {
    return { ok: false, reply: refusalReply(input.key, REFUSAL_REASONS.BAD_ARGS, explicit.problem + '这次一个字都没动。', {}, [{ key: input.key, step: 'status', status: 'failed', reason: explicit.problem }], input.estimate) }
  }
  const read = await readStatusConflict(input.tracker, input.repo, input.key, input.opCtx)
  if (!read.ok) {
    if (read.kind === 'timeout') return { ok: false, reply: input.timeoutReply(read.message) }
    return { ok: false, reply: refusalReply(input.key, REFUSAL_REASONS.BACKEND_UNSUPPORTED, '读这张票的当前状态时后端没回 ok：这次一个字都没动，等能读回再改。', { error: { kind: 'read', message: read.message } }, [{ key: input.key, step: 'status', status: 'failed', reason: read.message }], input.estimate) }
  }
  if (read.conflict === null) return { ok: true, explicit: explicit }
  if (choiceParse.choice === null) return { ok: false, reply: conflictRefusal(input.key, read.conflict, input.args, input.estimate) }
  const chosen = chosenStatusOf(read.conflict, choiceParse.choice)
  const mismatch = choiceMismatchProblem(explicit, chosen)
  if (mismatch !== null) {
    return { ok: false, reply: refusalReply(input.key, REFUSAL_REASONS.BAD_ARGS, mismatch + '这次一个字都没动。', { statusConflict: read.conflict }, [{ key: input.key, step: 'status', status: 'failed', reason: mismatch }], input.estimate, 1) }
  }
  const tracker = input.tracker as unknown as TrackerRead & TrackerLabels
  const kept = nonTriageLabelsOf(read.labels)
  let lockTimeout: string | null = null
  const held = await withKeyLock(input.repo, input.key, async () => {
    if (input.outOfBudget()) { input.over('status'); return }
    const rawNormalize = await tracker.setLabels(input.repo, input.key, kept, { status: chosen }, input.opCtx)
    const normalizeTimeout = timeoutMessage(rawNormalize as unknown as TransportResult)
    if (normalizeTimeout) { lockTimeout = normalizeTimeout; return }
    const normalized = must(rawNormalize) as UnknownRecord | null
    if (normalized && normalized.ok === true) input.items.push({ key: input.key, step: 'status', status: 'ok', adopted: chosen })
    else input.fail('status', normalized)
  }, input.lockOpts)
  if (lockTimeout !== null) return { ok: false, reply: input.timeoutReply(lockTimeout) }
  if (held && held.ok === false && held.timedOut) input.lockedOut('status')
  if (input.items.some((item) => item.step === 'status' && item.status === 'failed')) {
    return { ok: false, reply: refusalReply(input.key, REFUSAL_REASONS.BACKEND_UNSUPPORTED, '先把状态归一时没成（原因在上面）：这一步没成就不往下写，避免半写。', {}, input.items, input.estimate, 1) }
  }
  return { ok: true, explicit: explicit }
}
