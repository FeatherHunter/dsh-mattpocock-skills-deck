/**
 * backends/gitlab/errors.js — glab/API 错误 → 契约 ERROR_KIND（本房间的判档出口）。
 *
 * ── 判据不在这里，这里只有「glab 这一家专有的条目」─────────────────────────────
 * 判「失败该归哪一档」的真源是全仓唯一那张有序规则表：`src/tracker/error-rules.ts`
 * （决策见 `docs/adr/20261014-error-classification-single-source.md`）。本文件**不再自带词表** ——
 * 那正是实测漂移过一次的来路：同一个判断写在两处，改一处没改另一处，同一条原文在两间房里
 * 会给出相反的建议（403 加限流文案被说成「没登录」、DNS 的 `ENOTFOUND` 被说成「找不到」）。
 *
 * 本文件今天只做三件事：
 *   1）`GLAB_ERROR_RULES`：glab 专有的前置扩展表（**只放通用表认不出的**，每条自带 `example`）；
 *   2）`classifyGlabError(err, ctx)`：走「透传 → 本家扩展 → 通用表」这一趟判定，把档位交出去；
 *   3）`hintFor` / `failGlab`：按票面实现决定第 11 条挑给人看的那句话（兜底与「不支持」两档
 *      换成通用提示，不拿本家上下文假装判出来了），并统一用 `fail()` 构造带原文的失败结果。
 *
 * `KIND_VALUES` 按**值**判断，不是按键：`ERROR_KIND` 的常量键是枚举名（ENV/AUTH/…），
 * 值才是 'env'/'auth'/…（真源见 `contract/vocabulary.ts`）。写成按键判断会把所有档位判错。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import { HINT_UNRECOGNIZED, HINT_UNSUPPORTED, fail } from '../../preflight.js'
import { emitPassthrough, factsFromError, judgeFactsDetailed } from '../../error-rules.js'

const KIND_VALUES = new Set(Object.values(ERROR_KIND))

/**
 * glab 这一家的前置扩展表（判档时先试它，再试通用表）。
 *
 * 三条要守的规矩（与 GitHub 房同一套）：
 *   · 只放通用表认不出的东西。已收进通用表的**不许再抄一份** —— `glab: command not found` 这类
 *     「命令没装」句式、`ENOTFOUND` 这类网络错误码名、`not found` 的词边界写法、403 加限流文案，
 *     通用表都已经认了（`src/tracker/error-rules.ts` 的①事实/②错误码名/③句式三层）；
 *   · 每条自带 `example`：把这条样本单独喂进判档，结果必须正好是它声明的档位（门禁逐条自证）；
 *   · 不许与通用项同层同模式（那会长出第二份判据，门禁拦着）。
 *
 * 留下的两条都是「改了会改掉既有行为」的口径，所以原样留住并写明理由：
 *   · `host not found`：字面上像网络故障，但 glab 用它说的是「这个 host 上没有配过凭据」；
 *   · `no token`：glab 没找到凭据时的原话，通用表的认证句式认不出它
 *     （那条要求 `not … in` 连写，而这句里只有 `no token`）。
 */
export const GLAB_ERROR_RULES = [
  {
    kind: ERROR_KIND.AUTH,
    layer: 'phrase',
    pattern: /host not found/i,
    example: { text: 'glab: host not found for gitlab.example.com; run glab auth login' },
    note: 'glab 用这句话说的是「这个 host 上没有配过凭据」，不是 DNS 解析不到主机名 —— 归认证档，'
      + '让用户去 `glab auth login`。通用表的认证句式认不出这句（里面没有 auth/credential 这些词）',
  },
  {
    kind: ERROR_KIND.AUTH,
    layer: 'phrase',
    pattern: /no token/i,
    example: { text: 'no token found for gitlab.com' },
    note: 'glab 找不到凭据时的原话。通用表认不出它，而 `not logged in` 那条要求 `not … in` 连写 —— '
      + '判不出这句就会落到兜底的「网络」，界面于是让用户去查网络，而该做的是重新登录',
  },
]

/** `err` 已经是规范档位了吗（顶层 `kind` 或 `error.kind` 命中八档取值之一）。 */
function carriedKind(err) {
  if (!err || typeof err !== 'object') return null
  if (KIND_VALUES.has(err.kind)) return err.kind
  const inner = err.error
  if (inner && typeof inner === 'object' && KIND_VALUES.has(inner.kind)) return inner.kind
  return null
}

/**
 * 把 glab/API 的任意错误值判成八档之一。
 *
 * 顺序与全仓一致：已经是规范档位的失败原样透传（覆盖后端显式产生的 `conflict` / `unsupported`），
 * 其余走「本家扩展表 → 通用表」。判定与 `verdictOf` 同一趟，只是这里多挂了 glab 的扩展表。
 *
 * @param {unknown} err 任意错误值：Error / glab 的 `{stdout,stderr,code}` 进程结果 / 一段文本 /
 *                      已是 `{kind,message,raw}` 的 TrackerError
 * @param {{logEvent?:Function,isEnabled?:Function}} [ctx] 本房间的调用上下文；给了它才可能留一条
 *        `error.normalize` 轨迹（开关由 `isEnabled('debug')` 判，关着时零组装零调用）
 * @returns {{kind:string, fallback:boolean}} kind 是八档取值之一；fallback 为 true 表示
 *          「规则表一条都没认出来，按网络兜底」——调用方据此换用通用提示，别假装判出来了
 */
export function classifyGlabError(err, ctx) {
  const carried = carriedKind(err)
  if (carried) {
    // 已经是规范档位（例如后端显式产生的 conflict/unsupported）：原样透传并留一趟归一轨迹。
    emitPassthrough(ctx, carried)
    return { kind: carried, fallback: false }
  }
  const judged = judgeFactsDetailed(factsFromError(err), GLAB_ERROR_RULES, ctx)
  return { kind: judged.kind, fallback: judged.fallback }
}

/**
 * 挑这次失败给用户看的那句话（票面实现决定第 11 条）。
 *
 * 规矩：兜底判出来的（`fallback` 为真）与「这个后端没有这项能力」两档，用全仓统一的那两句
 * 通用提示 —— 它们是**实话**：前者承认「没认出来」，后者让用户换路而不是重试。
 * 其余情况用调用方自己那句有上下文的话（例如「改标签没做成」）。
 *
 * @param {{kind:string, fallback:boolean}} verdict `classifyGlabError` 给的结果
 * @param {string} nativeMessage 本家那句话（判得出具体档位时用它）
 */
export function hintFor(verdict, nativeMessage) {
  if (verdict && verdict.fallback) return HINT_UNRECOGNIZED
  if (verdict && verdict.kind === ERROR_KIND.UNSUPPORTED) return HINT_UNSUPPORTED
  return nativeMessage
}

/**
 * glab 这一家统一的失败构造：判档 + 挑话 + 带原文，三步一处做完。
 *
 * 为什么要有它：房里有六十多处失败站点，若每处各写一遍「先判档、再挑话、再取原文」，
 * 迟早有哪一处漏掉第三段。收在这里之后，每个站点只要说清「原始错误值是什么」。
 *
 * @param {unknown} err 原始错误值（进程结果 / Error / 一段文本），判档与取原文都用它
 * @param {string} nativeMessage 本家那句话；兜底与 unsupported 两档会被换成通用提示
 * @param {unknown} [raw] 原文（默认就是 `err` 本身；不传等于传 err）
 * @param {{logEvent?:Function,isEnabled?:Function}} [ctx] 判档上下文（留 error.normalize 轨迹用）
 * @returns {{ok:false, error:{kind:string,message:string,raw:string}}}
 */
export function failGlab(err, nativeMessage, raw, ctx) {
  const verdict = classifyGlabError(err, ctx)
  return fail(verdict.kind, hintFor(verdict, nativeMessage), arguments.length > 2 ? raw : err)
}

export default classifyGlabError
