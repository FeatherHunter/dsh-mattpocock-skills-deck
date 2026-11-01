/**
 * src/deck/shell/receipt-reason.ts —— 非 ok 回执的 reason 只从这一处来（#1799）
 *
 * 第一性原理：回执里的 reason 不是「这个错误叫什么」（那是错误分类该回答的），
 * 而是「拿到这张回执的人下一步该做什么」。同一种错误，下一步可能完全相反：
 * 读票读到一半网络断了，重试一次大概率就好了；写票写下去之后网络断了，
 * 票可能已经建了，盲目重试会建出第二张 —— 所以这里先分读/写，再分错误档位。
 *
 * 输入只有四样，都是调用点已经知道的：
 *   - kind   后端或执行层给的错误分类（契约八档，另有传输层的 timeout / aborted / over-budget /
 *            backend-threw；可能缺席、可能是表外值）；
 *   - stage  房间在失败结果上标注的「失败发生在链路哪一段」（见 TRACKER_ERROR_STAGE）；
 *   - phase  这次调用是读还是写；
 *   - local  失败发生在 deck 本地哪一环（超时、锁、写后被并发打赢、参数校验……）。
 * 输出只有八个原因码之一（外加 worstReason 允许的空串），不新增码、不改 status。
 *
 * 优先级（后来者别调换，测试逐条钉着）：
 *   1. local 最贴近事实：它就是这次失败的那一环；
 *   2. stage=input-refused：房间在动手前拒了输入，改输入才能重试，归 bad-args；
 *   3. stage=anchor-lookup：失败只说明「票没建、重试安全」，那是读侧的安全说明，
 *      不改变「下一步做什么」的判断，所以按读阶段查表；
 *   4. kind 表：读、写各一张；
 *   5. 不知道 kind 或表外值：停（backend-unsupported），别发明「重试就好」。
 */
import { REFUSAL_REASONS } from './call-shell.js'
import type { RefusalReason } from './call-shell.js'
import { TRACKER_ERROR_STAGE } from '../../tracker/contract/results.js'

/** 这次调用读后端还是写后端。写操作失败时多一种可能：请求已经生效、只是没等到回执。 */
export type ReceiptPhase = 'read' | 'write'

/**
 * deck 本地这一环的失败来源。名字按「失败发生在哪」取，不按「错误叫什么」取 ——
 * 同一个来源可能对应不同档位，档位由 local 直接决定，调用点不必先判档再映射。
 */
export type LocalFailureCause =
  | 'budget'
  | 'lock'
  | 'stale'
  | 'unconfirmed'
  | 'input'
  | 'surface'
  | 'verify'

/** 本地失败来源 → 原因码。顺序按「调用方该先做什么」排：重试 → 读回 → 改输入 → 停。 */
const LOCAL_REASON: Readonly<Record<LocalFailureCause, RefusalReason>> = Object.freeze({
  budget: REFUSAL_REASONS.BACKEND_THREW,
  lock: REFUSAL_REASONS.BACKEND_THREW,
  stale: REFUSAL_REASONS.BACKEND_THREW,
  unconfirmed: REFUSAL_REASONS.BACKEND_TIMEOUT,
  input: REFUSAL_REASONS.BAD_ARGS,
  surface: REFUSAL_REASONS.OVER_CAP,
  verify: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
})

/**
 * 读阶段：读不到就是读不到，重试多半无副作用，所以网络/解析/竞争/中止都归 backend-threw；
 * 「票根本没被建/不存在」「环境与权限不够」「后端明说做不到」才让人换路或停。
 * timeout 单列：等满了还没回来，下一步是等一会儿重试，不是「后端已经坏了」。
 */
const READ_KIND: Readonly<Record<string, RefusalReason>> = Object.freeze({
  env: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
  auth: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
  unsupported: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
  'rate-limit': REFUSAL_REASONS.OVER_CAP,
  'not-found': REFUSAL_REASONS.BAD_ARGS,
  conflict: REFUSAL_REASONS.BACKEND_THREW,
  network: REFUSAL_REASONS.BACKEND_THREW,
  parse: REFUSAL_REASONS.BACKEND_THREW,
  timeout: REFUSAL_REASONS.BACKEND_TIMEOUT,
  aborted: REFUSAL_REASONS.BACKEND_THREW,
  'over-budget': REFUSAL_REASONS.BACKEND_THREW,
  'backend-threw': REFUSAL_REASONS.BACKEND_THREW,
})

/**
 * 写阶段：与读阶段唯一的实质差别是 network / parse —— 请求可能已经发到后端并生效，
 * 只是回执没回来或读不懂。这种时候下一步必须是「先读回确认」，归 backend-timeout；
 * 直接说 backend-threw 会诱导调用方再写一次，可能写出第二张票。
 * timeout 同理；conflict 说明这次写没赢，是本地状态过期，重读再改即可。
 */
const WRITE_KIND: Readonly<Record<string, RefusalReason>> = Object.freeze({
  env: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
  auth: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
  unsupported: REFUSAL_REASONS.BACKEND_UNSUPPORTED,
  'rate-limit': REFUSAL_REASONS.OVER_CAP,
  'not-found': REFUSAL_REASONS.BAD_ARGS,
  conflict: REFUSAL_REASONS.BACKEND_THREW,
  network: REFUSAL_REASONS.BACKEND_TIMEOUT,
  parse: REFUSAL_REASONS.BACKEND_TIMEOUT,
  timeout: REFUSAL_REASONS.BACKEND_TIMEOUT,
  aborted: REFUSAL_REASONS.BACKEND_THREW,
  'over-budget': REFUSAL_REASONS.BACKEND_THREW,
  'backend-threw': REFUSAL_REASONS.BACKEND_THREW,
})

/** 不知道 kind、或给了表外值时的答案：停。宁可让人来问一句，也别把人送进重试循环。 */
const UNKNOWN: RefusalReason = REFUSAL_REASONS.BACKEND_UNSUPPORTED

/** 映射函数的入参。四个字段都来自调用点已知的事实，不需要再查任何东西。 */
export interface FailureFacts {
  /** 后端或执行层给的错误档位（契约八档，另有传输层四档 timeout / aborted / over-budget /
   *  backend-threw；可能缺席或表外）。 */
  kind?: string
  /** 房间标注的失败阶段（TRACKER_ERROR_STAGE 的取值之一；可能缺席）。 */
  stage?: string
  /** 这次调用读还是写。 */
  phase: ReceiptPhase
  /** 失败发生在 deck 本地哪一环；有它时优先于 kind/stage。 */
  local?: LocalFailureCause
}

/** 把四样事实映射成八个原因码之一。纯函数、无状态，任何工具任何失败都走它。 */
export function reasonForFailure(facts: FailureFacts): RefusalReason {
  if (facts.local) return LOCAL_REASON[facts.local] || UNKNOWN
  if (facts.stage === TRACKER_ERROR_STAGE.INPUT_REFUSED) return REFUSAL_REASONS.BAD_ARGS
  const phase = facts.stage === TRACKER_ERROR_STAGE.ANCHOR_LOOKUP ? 'read' : facts.phase
  const table = phase === 'read' ? READ_KIND : WRITE_KIND
  return table[facts.kind || ''] || UNKNOWN
}

/**
 * 回执里失败证据的规范形状：码 + 原始 kind / stage + 本地失败来源。
 *
 * 为什么原始几格也要留在 items 里：码是给「下一步」用的结论，调试时人还想看原始事实，
 * 两者都留下才追得回「为什么这个失败被判成了这个码」（#1799 验收）。
 */
export type FailureEvidence = {
  /** 给回执用的原因码。 */
  code: RefusalReason
  /** 后端或执行层原始 kind；本地失败（锁、额度、读回核对、参数）没有这一格。 */
  errorKind?: string
  /** 房间原始 stage；本地失败没有这一格。 */
  stage?: string
  /** deck 本地这一环的失败来源（锁、额度、写后没读回、核对……）；后端失败没有这一格。 */
  local?: LocalFailureCause
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 从「失败详情」取事实再映射。接受的形状：
 *   - 结果/回执 { ok:false, error:{ kind, stage } }；
 *   - 单个失败项 { kind, stage }（把最外层当错误本身）；
 *   - null / undefined（没有任何失败详情）。
 */
export function failureOf(failure: unknown, phase: ReceiptPhase, local?: LocalFailureCause): FailureEvidence {
  const outer = (failure && typeof failure === 'object') ? failure as { error?: unknown; kind?: unknown; stage?: unknown } : {}
  const inner = (outer.error && typeof outer.error === 'object') ? outer.error as { kind?: unknown; stage?: unknown } : outer
  const kind = textOf(inner.kind)
  const stage = textOf(inner.stage)
  const out: FailureEvidence = { code: reasonForFailure({ kind, stage, phase, local }) }
  // 空值不写进证据：本地失败没有后端 kind/stage，回执里不该出现空串格的噪音。
  if (kind) out.errorKind = kind
  if (stage) out.stage = stage
  if (local) out.local = local
  return out
}

/**
 * 把一份失败证据铺成回执里的字段：code 必有；后端原档位与阶段有才写。
 *
 * 为什么单独抽出来：data.error / items 这些格子的键名有 kind 与 errorKind 两种历史写法，
 * 但「本地失败没有后端两格、空值不写」这条口径必须一致（#1799 验收；undefined 写进回执还会被判成非法 JSON）。
 * kindKey 交给调用点指定它那一格叫 kind 还是 errorKind。
 */
export function evidenceFields(ev: FailureEvidence, kindKey: 'kind' | 'errorKind' = 'kind'): Record<string, string> {
  const out: Record<string, string> = { code: ev.code }
  if (ev.errorKind) out[kindKey] = ev.errorKind
  if (ev.stage) out.stage = ev.stage
  if (ev.local) out.local = ev.local
  return out
}

/** 只要码时的简写；形状与 failureOf 一样。 */
export function reasonForResult(result: unknown, phase: ReceiptPhase, local?: LocalFailureCause): RefusalReason {
  return failureOf(result, phase, local).code
}

/**
 * 一批失败项里最该先告诉人的那个码（空串 = 没有失败项）。
 *
 * 优先级按「下一步的紧迫性」排，不按错误严重性排：
 *   backend-timeout（可能已生效，先读回确认）> bad-args（改输入才能继续）
 *   > backend-unsupported（这条路走不通）> ai-tool-refused（这件事 AI 不许做）
 *   > gate-defer（等窗口）> backend-threw（重试）。
 * 表外码一律忽略：排序只服务于「下一步」，不认识的码没有下一步可言。
 */
const PRECEDENCE: readonly RefusalReason[] = Object.freeze([
  REFUSAL_REASONS.BACKEND_TIMEOUT,
  REFUSAL_REASONS.BAD_ARGS,
  REFUSAL_REASONS.BACKEND_UNSUPPORTED,
  REFUSAL_REASONS.OVER_CAP,
  REFUSAL_REASONS.GATE_DEFER,
  REFUSAL_REASONS.BACKEND_THREW,
])

export function worstReason(codes: ArrayLike<string | null | undefined>): RefusalReason | '' {
  const list = codes || []
  for (const wanted of PRECEDENCE) {
    for (let i = 0; i < list.length; i += 1) {
      if (list[i] === wanted) return wanted
    }
  }
  return ''
}

/**
 * 逐项回执里「最该先告诉人的那一个原因」：只看 status 不是 ok 的项，取它们各自映射码里优先级最高的一个。
 *
 * 为什么没有失败项就回空串：partial 有两种形状（见 #1799 的最终方案）——一种是有几项真失败，
 * 另一种只是这一片没做完（额度不够、还有剩余），后一种没有「失败原因」可说，续法要写在 text/notes 里。
 */
export function reasonForItems(items: ArrayLike<unknown>): RefusalReason | '' {
  const failed: unknown[] = []
  for (let i = 0; i < items.length; i += 1) {
    const one = items[i]
    if (one && (one as { status?: unknown }).status !== 'ok') failed.push(one)
  }
  if (!failed.length) return ''
  return worstReason(failed.map((one) => String((one as { code?: unknown }).code || '')))
}
