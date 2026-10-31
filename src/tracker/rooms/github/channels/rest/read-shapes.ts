/**
 * src/tracker/rooms/github/channels/rest/read-shapes.ts —— REST 回包的形状还原与完整度判定（票 #1685）
 *
 * ── 这个文件回答的问题 ──────────────────────────────────────────────────────────
 * 「这一串 REST 返回的数组能不能用？翻页停下来的理由说明取全了没有？」规格 1681 第 5 节对 REST
 * 侧的完整度判据与 GraphQL 不同：REST 没有 `pageInfo`，只能靠「翻到空页」「尾页不满一页」
 * 「是否触到页数上限」「尾页是否失败」这几个事实推断。这里把推断写成纯函数：
 * 不发请求、不拼 URL、不碰业务规则，路由层拿它的事实去组装 `ReadProvenance`。
 *
 * ── 为什么放在 channels/rest ───────────────────────────────────────────────────
 * 规格 1681 第 3 节：两套协议形状只在各自通道里解析，互不引用。这里读的全是 REST 事实
 * （数组、每页条数、空页），不认识 `pageInfo`；`channels/graphql/read-shapes.ts` 也不认识
 * REST。分层门禁与来源门禁都盯着这条。
 *
 * ── 三条不能改的约定 ───────────────────────────────────────────────────────────
 * 1. 恰好整数页不算完整：每页都满、又没做空页探测（也没触明确页数上限）时，只能说明
 *    「可能还有下一页」，记 `truncated`。今天的 REST 兜底路径本来就会多要一页去探空页
 *    （`pageSize + 1` 页），探测到空页才算完整。
 * 2. 触上限一律记 `truncated`：整仓列表最多 10 页、子票至多 1000 张、标签一次最多 1000 条，
 *    到顶时无法证明取全，记 `truncated` 而不是 `complete`。
 * 3. `unexpressed` 只用于「这次压根没取这一组」或「回包里根本没有这一组的字段」，
 *    不能拿来当「取到了但不确定」的垃圾桶——后者是 `truncated`。
 */
import { PAGINATION } from '../../../../contract/pagination.js'
import type { FieldGroupCompleteness } from '../../../../contract/read-provenance.js'
import type { FieldGroup } from '../../../../contract/operations-encyclopedia.js'

/**
 * 整仓 REST 列表翻页结束时的事实，由发起翻页的那段代码逐页累计。
 *
 * 为什么把这些事实单独建模而不是直接给个布尔：阶段 2 的合并层与排查日志都要能回答
 * 「为什么这趟记了截断」——是撞了 10 页上限、尾页失败，还是只满页没有空页探测。
 */
export interface RestListPagingFacts {
  /** 一共成功取回多少页（含空页探测那一页）。 */
  readonly pagesFetched: number
  /** 每页向远端要多少条（今天 GitHub REST 是 100，接口上限）。 */
  readonly pageSize: number
  /** 最后一页实际回来多少条；空页探测命中时为 0。 */
  readonly lastPageRows: number
  /** 是否翻到过空页（空页是「到底了」的唯一协议证据）。 */
  readonly sawEmptyPage: boolean
  /** 是否触到页数上限（`restMaxPages` = 10）而停。 */
  readonly hitPageCap: boolean
  /** 是否有一页（含尾页）请求或解析失败、只拿到前面几页就停。 */
  readonly pageFailure: boolean
  /**
   * 是否发过「第 11 页空页探测」（#1681 复审修复）：只有恰好翻满 10 页且每页都满时才会发。
   * 老调用方/老夹具没有这一格时按「没探测过」处理。
   */
  readonly probeAttempted?: boolean
  /**
   * 空页探测这一页是否请求或解析失败。失败同样只能记截断，不能当完整——
   * 它与 `pageFailure` 分开，是因为前者不是数据页失败（前十页照常回成功），不该混成「双路皆挂」。
   */
  readonly probeFailed?: boolean
}

/**
 * REST 数组形状还原：不是数组就返回 `null`（调用方据此判「形状不认」），是数组原样交回。
 *
 * 为什么放在渠道层：`Array.isArray` 看着简单，但它是「这算不算 REST 列表形状」的判定，
 * 属于协议知识；散在旧文件的 if 里会让同一判定各写一遍、迟早漂移。
 */
export function restRowsOf(json: unknown): unknown[] | null {
  return Array.isArray(json) ? json : null
}

/**
 * 整仓 REST 列表「行级字段」的完整度。
 *
 * 规则就是文件头第 1、2 条：
 * - 撞 10 页上限或有一页失败 → `truncated`；
 * - 翻到空页（含第 11 页空页探测）→ `complete`；尾页不满一页 → `complete`（尾页少了条数就是到底的证据）；
 * - 空页探测请求/解析失败 → `truncated`（探测没做成，就不能证明到底）；
 * - 每页都满、又没翻到空页 → `truncated`（「可能还有下一页」不能算完整）。
 *
 * 为什么尾页不满也算完整：REST 没有 `hasNextPage`，尾页不满条数是客户端唯一能相信的「到底」信号，
 * 与「空页探测」是同一件事的两种出现方式。
 */
export function restListCompleteness(facts: RestListPagingFacts): FieldGroupCompleteness {
  if (facts.hitPageCap || facts.pageFailure || facts.probeFailed === true) return 'truncated'
  if (facts.sawEmptyPage) return 'complete'
  if (facts.lastPageRows < facts.pageSize) return 'complete'
  return 'truncated'
}

/**
 * REST 列表行里「标签」这一组的完整度：每一行的 `labels` 都必须是数组。
 *
 * REST 的 issue 资源会把这张票的标签一次全带上（没有「一行标签分页」这回事），所以只要每行都有
 * 标签数组，这一组就是完整的；行里缺 `labels` 字段（老版本 GitHub 企业版或残缺回包）记
 * `unexpressed`——这次没表达，不是完整。
 */
export function restRowLabelsCompleteness(rows: readonly unknown[]): FieldGroupCompleteness {
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) return 'unexpressed'
    if (!Array.isArray((row as { labels?: unknown }).labels)) return 'unexpressed'
  }
  return 'complete'
}

/** 一个计数是不是「这个端点表达出来的数」：非负整数才算，坏值不算表达。 */
function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** 子票计数这一组有没有被回包表达：sub_issues_summary 的 total 与 completed 都是非负整数才算。 */
function subIssuesExpressed(summary: unknown): boolean {
  if (!summary || typeof summary !== 'object') return false
  const bag = summary as Record<string, unknown>
  return isCount(bag.total) && isCount(bag.completed)
}

/** 合并时间这一组有没有被回包表达：字符串或 null 都算表达（null 就是「还没合并」）。 */
function mergeInfoExpressed(bag: Record<string, unknown>): boolean {
  if (typeof bag.merged_at === 'string' || bag.merged_at === null) return true
  if (typeof bag.mergedAt === 'string' || bag.mergedAt === null) return true
  const pull = bag.pull_request
  if (pull && typeof pull === 'object' && 'merged_at' in (pull as Record<string, unknown>)) return true
  return false
}

/**
 * REST 单票回包的八组表态（票 #1688）。
 *
 * 为什么按回包算而不是写成固定常量：REST 单票端点只有「行与正文」是每次恒定表达的；
 * 子票计数（GitHub 的 issue 回包会带 `sub_issues_summary`）、评审数组（单票富化会补
 * `/reviews` 一页）、合并时间（`/pulls` 的 `merged_at`，或 `/issues` 里
 * `pull_request.merged_at`）这三组有没有表达，要看这一次回包。评论正文、父子边、依赖边
 * 这一版端点压根不取，恒记 `unexpressed`。
 *
 * 判定口径：
 * - 子票计数：`sub_issues_summary` 的 total 与 completed 都是非负整数才算表达，坏值不算；
 * - 评审：单票富化只补一页 `/reviews`（每页 100 条、不翻页），满 100 条记 `truncated`，
 *   不满记 `complete`；回包里没有评审数组记 `unexpressed`；
 * - 合并时间：`merged_at` / `mergedAt` 是字符串或 null、或 `pull_request` 对象里有
 *   `merged_at` 键，才算表达；坏值不算表达。
 */
export function restDetailFieldGroups(raw: unknown): Readonly<Partial<Record<FieldGroup, FieldGroupCompleteness>>> {
  const bag = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const reviews = Array.isArray(bag.reviews) ? bag.reviews as readonly unknown[] : null
  return {
    row: 'complete',
    body: 'complete',
    comments: 'unexpressed',
    parents: 'unexpressed',
    dependencies: 'unexpressed',
    subIssues: subIssuesExpressed(bag.sub_issues_summary) ? 'complete' : 'unexpressed',
    review: reviews === null
      ? 'unexpressed'
      : (reviews.length >= PAGINATION.github.restPageSize ? 'truncated' : 'complete'),
    mergeInfo: mergeInfoExpressed(bag) ? 'complete' : 'unexpressed',
  }
}

/** REST 子票清单翻页结束时的事实：每页 100 张、至多 1000 张。 */
export interface RestSubIssuesPagingFacts {
  /** 一共取回多少张子票（不是页数）。 */
  readonly fetched: number
  /** 每页向远端要多少张（今天 GitHub REST 是 100）。 */
  readonly pageSize: number
  /** 最后一页实际回来多少张；空页探测命中时为 0。 */
  readonly lastPageRows: number
  /** 是否翻到过空页。 */
  readonly sawEmptyPage: boolean
  /** 是否因为触到 1000 张上限而停。 */
  readonly hitCap: boolean
  /** 是否有一页失败、只拿到前面几页就停。 */
  readonly pageFailure: boolean
}

/**
 * REST 子票清单的完整度：每页 100 张、翻到空页为完整、触 1000 上限为截断。
 *
 * 恰好整数页同样不算完整（文件头第 1 条）：每页都满且没翻到空页、也没触上限时，
 * 记 `truncated`——「可能有下一页」不能报成完整。
 */
export function restSubIssuesCompleteness(facts: RestSubIssuesPagingFacts): FieldGroupCompleteness {
  if (facts.hitCap) return 'truncated'
  if (facts.fetched >= PAGINATION.github.subIssuesMax) return 'truncated'
  if (facts.pageFailure) return 'truncated'
  if (facts.sawEmptyPage) return 'complete'
  if (facts.lastPageRows < facts.pageSize) return 'complete'
  return 'truncated'
}

/**
 * REST 标签清单的完整度：一次最多要 1000 条。
 *
 * 收到满 1000 条就记 `truncated`（规格第 5 节：标签清单触 1000 上限为截断）；少于 1000 条
 * 说明这个仓库的标签已经全在这一份回包里。
 */
export function restLabelListCompleteness(fetched: number): FieldGroupCompleteness {
  if (fetched >= PAGINATION.github.labelListLimit) return 'truncated'
  return 'complete'
}
