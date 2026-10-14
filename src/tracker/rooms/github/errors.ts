/**
 * backends/github/errors.ts — gh/API 错误 → 契约 ERROR_KIND。
 *
 * 判档本身不在这里：唯一一份有序规则表住在 `src/tracker/error-rules.ts`，判档入口是
 * `src/tracker/preflight.ts` 的 `classifyError` / `verdictOf` / `judgeFactsDetailed`
 * （同一份表的几种用法）。本文件原来自己抄了一份通用词表（env / auth / rate-limit /
 * not-found / network 一路 if 下来），那份词表已经删掉 —— 两处各判一次实测漂移出两条给出
 * **相反建议**的错判，决策见 `docs/adr/20261014-error-classification-single-source.md`。
 *
 * 本文件现在只做 GitHub 这一家专有的四件事：
 *   1）`GH_ERROR_RULES`：本家的前置扩展表，只写通用表认不出、或通用表会判反的 GitHub 专有
 *      情形（gh 的退出码约定、gh 自己的报错句式），通用项一条不抄（抄了就会漂移）。
 *      它是**导出**的：门禁要拿它逐条自证 —— 每条规则用它自带的样本单独跑一遍，
 *      命中的必须正好是它自己，否则两条同档位的规则会互相掩盖；
 *   2）`ghVerdictOf`：本家的判档出口，交回 `{kind, layer, fallback}` 三样 ——
 *      调用方要按「判没判出来」挑 message，只拿档位是不够的；
 *   3）`classifyGhError`：只要档位的简写版（多数调用方够用）；
 *   4）`ghFailureMessage`：按票面实现决定第 11 条挑 message（见函数上的说明）。
 *
 * `toOpResultError` 把任意错误值折成一次失败结果，原文一路带着。
 *
 * 归一埋点（`error.normalize`）由跟踪器层发：透传那一路由 `verdictOf` 发、判档那一路由
 * `judgeFactsDetailed` 发，本文件不再自己发一条（同一件事记两遍是噪音）。调用方要把本房的
 * `logEvent` / `isEnabled` 作为 `ctx` 传下来，这条轨迹才不会断。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import {
  HINT_UNRECOGNIZED,
  HINT_UNSUPPORTED,
  classifyError,
  fail,
  factsFromError,
  judgeFactsDetailed,
  verdictOf,
} from '../../preflight.js'
import type { ErrorRule, Judged, PreflightCtx } from '../../preflight.js'

/** ERROR_KIND 的取值集合（注意：常量键是枚举名 ENV/AUTH/…，值才是 'env'/'auth'/…，必须按值判断）。 */
const KIND_VALUES = new Set(Object.values(ERROR_KIND))

/** 这个错误值是不是「已经是规范档位的失败」：顶层有 kind，或包在 error 里的 kind 都算。 */
function isTrackerError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  // 为什么转成 Record 再读：错误值形状开放（Error/进程结果/OpResult），契约只认 kind 字段，直接读会报缺成员。
  const bag = err as Record<string, unknown>;
  if (KIND_VALUES.has(bag.kind as import('../../contract/identity.js').ErrorKind)) return true
  const inner = bag.error;
  if (inner && typeof inner === 'object' && KIND_VALUES.has((inner as Record<string, unknown>).kind as import('../../contract/identity.js').ErrorKind)) return true
  return false
}

/**
 * GitHub 家的前置扩展表：只写通用表认不出、或通用表会判反的 GitHub 专有情形。
 *
 * 为什么这几条必须住在本家而不是通用表里：通用表对所有后端一视同仁，而下面几条只在 GitHub
 * 这一家成立（退出码 4 是 gh 自己的约定、报错文案里带本家的变更名、找不到仓库用的是 resolve
 * 句式）。反过来，通用表里已经有的说法（`command not found`、`ENOENT`、「403 加限流文案」这一类）
 * 这里一条都不抄 —— 通用表里已经有一条「403 加限流文案归限流」排在通用 403 之前，
 * 各家再抄一份就会被门禁按「扩展项与通用项同档位同模式」打回。
 *
 * 每条自带一条最小样本（`example`）：门禁把它单独喂进判档，结果必须正好是这条声明的档位。
 * 数组顺序就是判档顺序，层次只许按 `fact` → `errcode` → `phrase` → `vague` → `fallback` 往前走。
 */
export const GH_ERROR_RULES: readonly ErrorRule[] = [
  {
    kind: ERROR_KIND.AUTH,
    layer: 'fact',
    // #620：gh 自己的约定是「需要登录 = 退出码 4」（见 gh help exit-codes）。只靠错误文案里的
    // 「not logged in / please run: gh auth login」去猜是巧合匹配 —— 文案换个版本、换个语言就认不出，
    // 而退出码是执行器原样交回来的机器事实。所以这条按事实判，排在本家扩展表的第一条。
    when: (f) => f.exitCode === 4,
    // 样本按「执行结果」的形状写：退出码在那一份结果里叫 `code`（`factsFromError` 只认这个键），
    // 另外把 `exitCode` 也写上，是为了让直接拿样本判档的门禁两种读法都能判出同一条规则。
    // 为什么这里断言成事实形状：运行时两种键都认（见 error-rules.ts 的退出码双读），契约类型只收 exitCode，多写的 code 键只为覆盖另一种读法，删掉会丢一条门禁覆盖。
    example: { code: 4, exitCode: 4, text: 'gh: To get started with GitHub CLI, please run: gh auth login' } as unknown as import('../../error-rules.js').ErrorFacts,
    note: '#620：gh 的「还没登录」用退出码 4 表达，退出码比文案可靠，归鉴权档',
  },
  {
    kind: ERROR_KIND.ENV,
    layer: 'fact',
    // #620/D2：这一次连退出码都没拿到（房内记 -1），手里也没有任何 stderr/stdout。
    // 这不是 GitHub 回绝了请求，而是本机这一侧没把命令跑起来（被中断，或者根本没起来）——
    // 归环境档，界面那句「插件运行环境的问题，不是你的操作有误」才对得上（标签配色的门禁盯着这条）。
    // 「等到本地超时」那一路由 client 层写成一句带 timeout 的事实，先落通用表的网络档，不会走到这里。
    when: (f) => f.exitCode === -1 && !f.text,
    // 为什么这里断言：同上，code 键覆盖执行结果的另一种读法，删掉会丢门禁覆盖，运行时无影响。
    example: { code: -1, exitCode: -1, text: '' } as unknown as import('../../error-rules.js').ErrorFacts,
    note: '#620：拿不到退出码（-1）且没有任何输出 → 环境档，责任在插件这边',
  },
  {
    kind: ERROR_KIND.ENV,
    layer: 'phrase',
    // 这几句说的都是「本机没有 gh 这个可执行程序」。通用表只认得通用句式（command not found 之类），
    // 而 `gh not found` 这种写法会被通用表的含糊短语 `not found` 吞成「资源不存在」，方向正好相反。
    pattern: /gh not found|platform\.resolveexecutable|which:.*gh|not found.*gh/i,
    example: { text: 'gh not found: platform.resolveExecutable returned null (install https://cli.github.com/)' },
    note: '本机缺 gh 可执行程序归环境档，不许被含糊短语吞成资源不存在',
  },
  {
    kind: ERROR_KIND.AUTH,
    layer: 'phrase',
    // #992：GraphQL 的权限句里带具体的变更名（AddLabelsToLabelable）。整句带
    // 「does not have the correct permissions」时通用表已经判得出；只回变更名的那种写法只有本家认得出。
    pattern: /addlabelstolabelable/i,
    example: { text: 'GraphQL: AddLabelsToLabelable is not permitted for this viewer' },
    note: 'GitHub 专有的打标变更名，整句不带权限词时也要归鉴权档（#992 实测那一句）',
  },
  {
    kind: ERROR_KIND.NOTFOUND,
    layer: 'phrase',
    // GitHub 报「找不到这个仓库/这张票」用的是 resolve 句式，通用表里没有这一句，
    // 落到兜底就会被说成网络问题（让人去查网络，而其实是名字写错了）。
    pattern: /could not resolve to a repositor|no such issue|issue not found/i,
    example: { text: "Could not resolve to a Repository with the name 'nope/nope'." },
    note: 'GitHub 的「解析不到仓库/票」句式归资源不存在，不被兜底吞成网络问题',
  },
  {
    kind: ERROR_KIND.PARSE,
    layer: 'phrase',
    // 改标签颜色时实测到的那种拒绝：HTTP 422 + Validation Failed（例如 Label.color is invalid）。
    // 通用表的解析档只认 parse / invalid json / syntax / unexpected token 这类写法，认不出 422；
    // 落不到解析档就会掉进兜底说成网络问题，而真正要做的是把颜色写法改对。
    pattern: /HTTP 422|validation failed/i,
    example: { text: 'HTTP 422: Validation Failed (Label.color is invalid)' },
    note: 'GitHub 用 422 + Validation Failed 拒绝不合法的入参值，归解析档',
  },
]

/**
 * 判档并交回 `{kind, layer, fallback}`（本房的判档出口）。
 *
 * 两条路：
 *   1）已经是规范档位的失败（顶层 `kind` 或 `error.kind`）原样透传、不重新判 —— 它覆盖
 *      `conflict` / `unsupported` 这两档：它们由后端显式产生，不是从文本猜出来的。
 *      这一路直接交给跟踪器层的 `verdictOf`（它与本函数同一个返回形状，透传埋点也在那一趟里）；
 *   2）其余按「先本家的前置扩展表、再通用表」判。这一路用 `judgeFactsDetailed`：它与 `verdictOf`
 *      是同一趟判定，只多收一张扩展表 —— `verdictOf` 的扩展表位置写死为空，收不了本家
 *      那条「退出码 4」的约定。所以本房的出口在这里，而不是直接调 `verdictOf`。
 *
 * @param err 任意错误值：Error / 进程结果 / OpResult / 字符串 / 整理好的事实对象
 * @param ctx 有它才可能留一条 `error.normalize`（调试开关在外层判，关着时零组装）
 */
export function ghVerdictOf(err: unknown, ctx?: PreflightCtx): Judged {
  if (isTrackerError(err)) return verdictOf(err, ctx)
  return judgeFactsDetailed(factsFromError(err), GH_ERROR_RULES, ctx)
}

/**
 * 把任意错误值判成八档之一（只要档位时的简写版，多数调用方用它）。
 *
 * @param err 任意错误值：Error / 进程结果 / OpResult / 字符串
 * @param ctx 有它才可能留一条 `error.normalize`（调试开关在外层判，关着时零组装）
 */
export function classifyGhError(err: unknown, ctx?: PreflightCtx) {
  return ghVerdictOf(err, ctx).kind
}

/**
 * 按票面实现决定第 11 条挑给人的那句话。
 *
 * 规则表一条都没认出来时（`fallback` 为真）不能用本家的上下文话术假装判出来了 —— 那是猜的，
 * 必须挂上 `HINT_UNRECOGNIZED` 老实说自己没认出来；`unsupported` 那一档挂 `HINT_UNSUPPORTED`
 * （它要的是换条路，不是让人重试）。其余情况保持本家自己的上下文话术（例如「读第 3 张票的
 * 正文时出错」），那句话说明的是「哪一步出的问题」，与档位是两件事。
 *
 * 两句拼在一起而不是二选一：上下文告诉人卡在哪一步，后半句告诉人这次没认出原因、去展开原文。
 *
 * @param verdict 判档结果（`ghVerdictOf` 的返回）
 * @param own 本家自己的上下文话术（可以为空串，此时只给通用提示）
 */
export function ghFailureMessage(verdict: Judged, own: string): string {
  const context = String(own || '').trim()
  if (verdict.fallback) return context ? context + '；' + HINT_UNRECOGNIZED : HINT_UNRECOGNIZED
  if (verdict.kind === ERROR_KIND.UNSUPPORTED) return context ? context + '；' + HINT_UNSUPPORTED : HINT_UNSUPPORTED
  return context
}

/**
 * 把任意错误值折成一次失败结果：档位与话术经 `ghVerdictOf` + `ghFailureMessage`，
 * 原文原样交出去（第三段给的是出错的那个值本身，合并、遮蔽与截断由 `fail` 统一做）。
 */
export function toOpResultError(err: unknown, ctx?: PreflightCtx) {
  const verdict = ghVerdictOf(err, ctx)
  // 为什么先转成键值袋再读：错误值形状开放（Error/进程结果/OpResult/字符串），直接读 message 会报缺成员；用或链保持与原来一致的兜底顺序（空串继续往下找）。
  const bag = (err && typeof err === 'object' ? (err as Record<string, unknown>) : null) as Record<string, unknown> | null;
  const own = String((bag && (bag.message || bag.stderr || bag.stdout)) || err || 'unknown error').slice(0, 800)
  return fail(verdict.kind, ghFailureMessage(verdict, own), err)
}

export default classifyGhError
