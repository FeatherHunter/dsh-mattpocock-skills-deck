/**
 * src/tracker/kernel/preflight.ts — preflight 环境门禁共享辅助 + 失败结果的统一构造
 *
 * 这里是「前置检查」的通用骨架：约定错误分类与统一错误形状，供各后端 preflight 复用。
 * 第一性原理（#124 定版）：错误分类必须把「环境问题（缺工具/缺文件）」与「资源不存在（404）」
 * 分开 —— 缺工具是环境问题（ENV），不是资源不存在（NOTFOUND），二者不可混。
 *
 * ⚠️ 判据不在这里（地图 #1042 落地票 #1111 收口）：失败归哪一档只有一处真源，
 * 就是 `src/tracker/kernel/error-rules.ts` 里那张有序规则表（决策见
 * `docs/adr/20261014-error-classification-single-source.md`）。本文件只做两件事：
 *   1）`classifyError`：把「已经是规范档位的失败」原样透传，其余交给规则表判；
 *   2）`fail`：统一构造失败结果 `{ok:false, error:{kind, message, raw}}`，原文必填。
 * 各后端的专有错误码名与句式写成自己的**前置扩展表**挂上去（例：`rooms/github/support/errors.ts`），
 * 不许在这里或自己家里再抄一份通用词表 —— 抄了就会漂移，实测漂移过一次。
 *
 * ⚠️ detect 已删（#124/#125 定版）：身份识别 = `matches`(boolean) + `select`(仲裁) +
 * `describe`(出 ref)，不再有 detect op；本文件只保留 preflight 门禁的共享分类与结果构造。
 * `kind:'conflict'` 由后端显式产生（If-Match 不匹配 / setBlockedBy 自环成环），经下方透传分支放行，不做 regex 派生。
 */

import { ERROR_KIND } from '../contract/vocabulary.js'
import type { ErrorKind } from '../contract/identity.js'
import type { TrackerError } from '../contract/results.js'
import {
  HINT_UNRECOGNIZED,
  HINT_UNSUPPORTED,
  emitPassthrough,
  factsFromError,
  judgeFacts,
  judgeFactsDetailed,
  maskSecrets,
  rawText,
} from './error-rules.js'
import type { ClassifyCtx, Judged } from './error-rules.js'

export {
  COMMON_RULES,
  HINT_UNRECOGNIZED,
  HINT_UNSUPPORTED,
  RULE_LAYERS,
  matchRule,
  rawText,
  maskSecrets,
  factsFromError,
  judgeFacts,
  judgeFactsDetailed,
} from './error-rules.js'
export type { ErrorFacts, ErrorRule, Judged, RuleLayer, ClassifyCtx } from './error-rules.js'

/** ERROR_KIND 的取值集合（注意：常量键是枚举名 ENV/AUTH/…，值才是 'env'/'auth'/…，必须按值判断）。 */
const KIND_VALUES = new Set(Object.values(ERROR_KIND))

/** 判档上下文：只在调用方给得出 `logEvent` / `isEnabled` 时才会留 `error.normalize` 轨迹。 */
export type PreflightCtx = ClassifyCtx

/** 错误值里已经写好的规范档位：顶层 `kind` 优先，其次包裹里的 `error.kind`；都没有就是 null。 */
function carriedKind(err: unknown): ErrorKind | null {
  const e = (err && typeof err === 'object') ? err as Record<string, unknown> : null
  if (!e) return null
  if (KIND_VALUES.has(e.kind as ErrorKind)) return e.kind as ErrorKind
  const inner = e.error
  if (inner && typeof inner === 'object' && KIND_VALUES.has((inner as Record<string, unknown>).kind as ErrorKind)) {
    return (inner as Record<string, unknown>).kind as ErrorKind
  }
  return null
}

/**
 * 把原始错误分类成 ERROR_KIND（八档）。
 *
 * 两条路：已经是规范的 TrackerError（顶层 `kind` 或 `error.kind`）就原样透传、不重复判
 * （覆盖 `conflict` / `unsupported` 这两档 —— 它们由后端显式产生，不是从文本猜出来的）；
 * 其余一律交给 `error-rules.ts` 的规则表，用事实对象判。
 *
 * @param err 任意错误值：Error / 进程结果 / OpResult / 字符串
 * @param ctx 有它才可能留一条 `error.normalize`（调试开关在外层判）
 */
export function classifyError(err: unknown, ctx?: PreflightCtx): ErrorKind {
  const carried = carriedKind(err)
  if (carried) {
    emitPassthrough(ctx, carried)
    return carried
  }
  return judgeFacts(factsFromError(err), [], ctx)
}

/**
 * 与 `classifyError` 同一趟判定，但把「这条档位是谁给的」也交出来。
 *
 * 需要它的场合只有一处：调用方要按票面实现决定第 11 条挑 message —— 走到兜底层
 * （规则表一条都没认出来）时必须改用 `HINT_UNRECOGNIZED`，不能拿本家的上下文话术
 * 假装判出来了；`unsupported` 那一档用 `HINT_UNSUPPORTED`。其余情况 `fallback` 为 false，
 * 用本家自己的话术即可。
 */
export function verdictOf(err: unknown, ctx?: PreflightCtx): Judged {
  const carried = carriedKind(err)
  if (carried) {
    emitPassthrough(ctx, carried)
    return { kind: carried, layer: 'passthrough', fallback: false }
  }
  return judgeFactsDetailed(factsFromError(err), [], ctx)
}

/**
 * 构造一次统一失败结果（**返回**，不 throw）。
 *
 * 三段式的第三段是**原文**，必填：分类是启发式的、可能猜错，原文让人自己判断
 * （决策见 ADR 第 2 节第 4、5 条）。确实没有原文时给空串，但参数不能省 ——
 * TypeScript 侧靠编译器把漏填的地方全找出来。
 *
 * 第三段可以直接给「出了错的那个东西」（Error / 进程结果 / OpResult / 一段文本），
 * 本函数会按统一口径取原文：多路合并（stderr、message、stdout 都要）→ 遮蔽凭据 → 头尾截断。
 *
 * @param kind 八档之一
 * @param message 给人看的一句话（允许直接展示；不要把原文塞进来）
 * @param raw 原文，或任何含原文的错误值
 */
export function fail(kind: ErrorKind, message: string, raw: unknown): { ok: false; error: TrackerError } {
  return { ok: false, error: { kind, message, raw: rawText(raw) } }
}

export const PREFLIGHT = Object.freeze({ version: 1 })
