// error-fail.ts —— 本地 Markdown 房「判档 + 构造失败结果」的唯一一处。
//
// 为什么单独一个文件：这个房间的失败来路很多（入参不合规、被自己的判据主动拒绝、文件读到一半
// 发现内容不合法、文件服务直接报错……），但不管哪一条，给出去的失败都必须是同一个三段式
// `{kind, message, raw}`（形状见 src/tracker/contract/results.ts）。让每个操作各拼一份的话，
// 早晚会有人漏掉 `raw`，或者自己另写一套「哪句话归哪一档」的判据——那正是本票要收掉的东西。
//
// 本文件只做三件事：
//   1）`kindFromError(err, ctx)`：判一次档，把「档位」和「这条档位是谁给的」一起交出来。
//      **只判一次**是硬要求：判档会在诊断日志里留一条 `error.normalize`，判两遍就会重复记账。
//      `err.kind` 已经写着规范档位时不再判（那是本房读写辅助件贴上的，或上层透传下来的）。
//   2）`messageForKind`：按票面实现决定第 11 条挑给用户看的那句话 —— 走到兜底层换
//      `HINT_UNRECOGNIZED`、`unsupported` 档换 `HINT_UNSUPPORTED`，其余情形本家那句话更贴切。
//   3）`failWithHint` / `failFromError` / `failAs` / `rawJson`：统一拼失败结果、统一取原文。
//
// 与 GitLab 房的关系：GitLab 房有专有词表（`rooms/gitlab/errors.js` 的 GLAB_ERROR_RULES），
// 本地 Markdown 房没有（它的失败几乎都是环境与文件系统问题），所以直接走跟踪器层的通用表 ——
// 这正合「例外只在房内合法、通用词表不许抄」的口径。这个房间里**不许**再出现第二份判据。
import { HINT_UNRECOGNIZED, HINT_UNSUPPORTED, fail, rawText, verdictOf } from '../../kernel/preflight.js'
import type { Judged, PreflightCtx } from '../../kernel/preflight.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'

/**
 * 判一个错误该归哪一档，并说清这条档位是谁给的。
 *
 * 两件事都在跟踪器层那一个出口里（`verdictOf`）：`err.kind` 已经是规范档位就原样透传
 * （本房读写辅助件贴上的，或上层已经判过的），并且照常留一条 `error.normalize` 轨迹；
 * 其余交给跟踪器层唯一那份规则表。这里不再自己抄一遍「哪些值算规范档位」——
 * 那会变成第二份判据，还会漏掉透传那一路的日志。
 *
 * 找不到判档上下文时（`ctx` 缺失，或它身上没有 `logEvent`）判定照常做、只是留不下日志轨迹 ——
 * 这与跟踪器层的水位一致：没有上下文不算错，不该因此少判一档。
 */
export function kindFromError(err: unknown, ctx?: PreflightCtx): { kind: string; verdict: Judged } {
  const verdict = verdictOf(err, ctx)
  return { kind: verdict.kind, verdict }
}

/**
 * 按票面实现决定第 11 条挑 message。
 *
 * 兜底层（规则表一条都没认出来）换 `HINT_UNRECOGNIZED`、`unsupported` 档换
 * `HINT_UNSUPPORTED`；其余情形本家那句带上下文的话更贴切，原样用。
 */
export function messageForKind(verdict: Judged, nativeMessage: string): string {
  if (verdict && verdict.fallback) return HINT_UNRECOGNIZED
  if (verdict && verdict.kind === ERROR_KIND.UNSUPPORTED) return HINT_UNSUPPORTED
  return nativeMessage
}

/**
 * 从抛出来的那个东西里取原文。
 *
 * 优先取 `cause`：本房的读写辅助件（read.ts / write.ts）在包装错误时把原始错误挂在 `cause` 上，
 * 而根因（文件服务真正吐出的 `code` / `message`）在那一层；只看包装层那一句，人看不出所以然。
 * 没有 `cause`（例如抛的是一个字符串）就给那个值本身，`fail()` 按统一口径取文本。
 */
export function rawFromError(err: unknown): unknown {
  const e = (err && typeof err === 'object') ? err as { cause?: unknown } : null
  if (e && e.cause !== undefined && e.cause !== null) return e.cause
  return err
}

/** 由「已经判好的结果 + 本家那句话 + 原文」拼出失败结果。 */
export function failWithHint(verdict: Judged, nativeMessage: string, raw: unknown): { ok: false; error: { kind: string; message: string; raw: string } } {
  return fail(verdict.kind, messageForKind(verdict, nativeMessage), raw)
}

/**
 * 一步到位的失败构造：原始错误 → 判档（带上下文）→ 挑话术 → 取原文。
 *
 * 用法：`catch (e) { return failFromError(e, ctx, '读这张票时出错') }`。
 * 第三段是本家要说的那句话；它只在判定确实命中规则表时才会原样出现在用户眼前，
 * 兜底时会换成通用提示（原文仍然完整地放在 `raw` 里给人自己看）。
 */
export function failFromError(err: unknown, ctx: PreflightCtx | undefined, nativeMessage: string): { ok: false; error: { kind: string; message: string; raw: string } } {
  const got = kindFromError(err, ctx)
  const msg = nativeMessage || (err && (err as { message?: string }).message ? String((err as { message?: string }).message) : String(err))
  return failWithHint(got.verdict, msg, rawFromError(err))
}

/** 本家自己就能定档的失败（入参不合规、被自己的判据拒绝）：档位照写，原文照给。 */
export function failAs(kind: string, message: string, raw: unknown): { ok: false; error: { kind: string; message: string; raw: string } } {
  return fail(kind as Parameters<typeof fail>[0], message, raw)
}

/** 一条本家判据的原文快照（JSON 化的入参/中间结果）。给不出就返回空串，但字段照给。 */
export function rawJson(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    const s = JSON.stringify(value)
    return s === undefined ? '' : s
  } catch (e) {
    return String(value)
  }
}

/**
 * 把一个错误值翻成「原文」那一段文本（与 `fail()` 内部同一套取法：多路合并 + 头尾截断）。
 *
 * 什么时候需要它：错误要作为**数据**往上传时（例如枚举票行时把「哪张票读不动」记成一串清单，
 * 由调用方决定整条操作怎么失败），那一段进不了 `raw` 字段，但原文一样不能丢，就在这里先取成文本。
 */
export function rawTextOf(value: unknown): string {
  return rawText(value)
}

export default { kindFromError, messageForKind, rawFromError, rawTextOf, failWithHint, failFromError, failAs, rawJson }
