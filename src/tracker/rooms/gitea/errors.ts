/**
 * src/tracker/rooms/gitea/errors.ts — tea/API 错误 → 契约 ERROR_KIND（本房间的判档出口）。
 *
 * ── 判据不在这里，这里只有「tea 这一家专有的条目」─────────────────────────────
 * 判「失败该归哪一档」的真源是全仓唯一那张有序规则表：`src/tracker/kernel/error-rules.ts`
 * （决策见 `docs/adr/20261014-error-classification-single-source.md`）。本文件仿 GitLab 房的
 * `errors.ts`：只做「透传 → 本家扩展表 → 通用表」这一趟判定；扩展表里放的是 tea 这一家专有、
 * 通用表认不出的条目，每条自带 `example` 自证（门禁 `tests/verify-error-rule-samples.ts`
 * 逐条把样本喂回去验证档位）。
 *
 * 结构与 GitLab 房逐格对应（classifyGiteaError / hintFor / failGitea），接手的人两份对照着读即可。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { TrackerError } from '../../contract/results.js'
import { HINT_UNRECOGNIZED, HINT_UNSUPPORTED, fail } from '../../kernel/preflight.js'
import type { ClassifyCtx } from '../../kernel/preflight.js'
import { emitPassthrough, factsFromError, judgeFactsDetailed } from '../../kernel/error-rules.js'
import type { ErrorRule } from '../../kernel/error-rules.js'

const KIND_VALUES: ReadonlySet<string> = new Set(Object.values(ERROR_KIND))

/** 判档结果只交档位与是否兜底，是因为调用方挑话只看这两格，层信息留给日志不进返回。 */
export interface GiteaVerdict {
  kind: ErrorKind
  fallback: boolean
}

/**
 * tea 这一家的前置扩展表（判档时先试它，再试通用表）。
 *
 * 三条要守的规矩（与 GitLab 房同一套）：
 *   · 只放通用表认不出的东西。已收进通用表的**不许再抄一份** —— `tea: command not found` 这类
 *     「命令没装」句式、`ENOTFOUND` 这类网络错误码名、`not found` 的词边界写法、401/403 这类
 *     事实层状态码，通用表都已经认了（`src/tracker/kernel/error-rules.ts` 的
 *     ①事实/②错误码名/③句式三层）；
 *   · 每条自带 `example`：把这条样本单独喂进判档，结果必须正好是它声明的档位（门禁逐条自证）；
 *   · 不许与通用项同层同模式（那会长出第二份判据，门禁拦着）。
 *
 * 留下的三条把 tea 用户最常撞上的三档失败都接住了：
 *   · 未登录（两条 AUTH）：tea 找不到凭据时说的是 `no token` / `please log in` 这类原话，
 *     通用表的认证句式认不出（那条要求 `not … in` 连写或 auth/credential 这些词）；
 *   · 无仓库（一条 NOT-FOUND）：tea 对不存在的仓库给 `repository does not exist` 原话
 *     （常与 404 一起出现，扩展层先试，所以带状态码的原文也命中这一条，不会掉进兜底的「网络」）。
 */
export const GITEA_ERROR_RULES: readonly ErrorRule[] = [
  {
    kind: ERROR_KIND.AUTH as ErrorKind,
    layer: 'phrase',
    pattern: /no token|token (?:is )?(?:required|invalid|expired|missing)|invalid or expired token/i,
    example: { text: 'tea: no token found for gitea.example.com; run tea login add' },
    note: 'tea 找不到凭据时的原话。通用表的认证句式认不出这句（里面没有 auth/credential 这些词，'
      + '也没有 not … in 连写）——判不出就会落到兜底的「网络」，界面于是让用户去查网络，'
      + '而该做的是 `tea login add` 重新登录',
  },
  {
    kind: ERROR_KIND.AUTH as ErrorKind,
    layer: 'phrase',
    pattern: /please (?:log|sign) in|not authenticated|login (?:is )?required|no login (?:configured|entry|found)|no available login/i,
    example: { text: 'tea: please log in before running this command' },
    note: 'tea 在没有可用登录项时的两句原话（服务端要求先认证、或本地一个登录项都没有时说的'
      + ' `no available login`，2026-11-11 在 gitea.vvmath.com 实测的原话）。通用表同样认不出它们，'
      + '归认证档并指向 `tea login add`，跟上一条「找不到令牌」是同一种病、同一个下一步；'
      + '认不出就会落到兜底的「网络」，面板于是只显示网络异常、不出登录指引按钮',
  },
  {
    kind: ERROR_KIND.NOTFOUND as ErrorKind,
    layer: 'phrase',
    pattern: /repository does not exist|repo does not exist|owner or repository (?:does not exist|not found)|not found or you do not have permission/i,
    example: { text: '404 repository does not exist [see: https://gitea.example/api/swagger]' },
    note: 'tea 对不存在的仓库（或没有权限看见的仓库）的原话，常与 404 一起出现。'
      + '扩展层先试，所以带状态码的原文也命中这一条而不是通用表的事实层，'
      + '提示能指到「核对 owner/repo 写法与实例地址」这个真正有用的下一步',
  },
]

/** `err` 已经是规范档位了吗（顶层 `kind` 或 `error.kind` 命中八档取值之一）。 */
function carriedKind(err: unknown): ErrorKind | null {
  if (!err || typeof err !== 'object') return null
  const bag = err as Record<string, unknown>
  const top = bag['kind']
  if (typeof top === 'string' && KIND_VALUES.has(top)) return top as ErrorKind
  const inner = bag['error']
  if (inner !== null && typeof inner === 'object') {
    const innerKind = (inner as Record<string, unknown>)['kind']
    if (typeof innerKind === 'string' && KIND_VALUES.has(innerKind)) return innerKind as ErrorKind
  }
  return null
}

/**
 * 把 tea/API 的任意错误值判成八档之一。
 *
 * 顺序与全仓一致：已经是规范档位的失败原样透传（覆盖后端显式产生的 `conflict` / `unsupported`），
 * 其余走「本家扩展表 → 通用表」。
 *
 * @param err 任意错误值：Error / tea 的 `{stdout,stderr,code}` 进程结果 / 一段文本 /
 *            已是 `{kind,message,raw}` 的 TrackerError
 * @param ctx 判档上下文；给了它才可能留一条 `error.normalize` 轨迹
 * @returns kind 是八档取值之一；fallback 为 true 表示「规则表一条都没认出来，按网络兜底」
 */
export function classifyGiteaError(err: unknown, ctx?: ClassifyCtx): GiteaVerdict {
  const carried = carriedKind(err)
  if (carried) {
    // 已经是规范档位（例如后端显式产生的 conflict/unsupported）：原样透传并留一趟归一轨迹。
    emitPassthrough(ctx, carried)
    return { kind: carried, fallback: false }
  }
  const judged = judgeFactsDetailed(factsFromError(err), GITEA_ERROR_RULES, ctx)
  return { kind: judged.kind, fallback: judged.fallback }
}

/**
 * 挑这次失败给用户看的那句话：兜底判出来的（没认出来）与「没有这项能力」两档用全仓统一的通用提示，
 * 其余用调用方自己那句有上下文的话。与 GitLab 房的 `hintFor` 同一口径。
 */
export function hintFor(verdict: GiteaVerdict | null | undefined, nativeMessage: string): string {
  if (verdict && verdict.fallback) return HINT_UNRECOGNIZED
  if (verdict && verdict.kind === (ERROR_KIND.UNSUPPORTED as ErrorKind)) return HINT_UNSUPPORTED
  return nativeMessage
}

/**
 * tea 这一家统一的失败构造：判档 + 挑话 + 带原文，三步一处做完，
 * 失败站点只要说清「原始错误值是什么」。
 */
export function failGitea(
  err: unknown,
  nativeMessage: string,
  raw?: unknown,
  ctx?: ClassifyCtx,
): { ok: false; error: TrackerError } {
  const verdict = classifyGiteaError(err, ctx)
  return fail(verdict.kind, hintFor(verdict, nativeMessage), arguments.length > 2 ? raw : err)
}

export default classifyGiteaError
