/**
 * src/tracker/rooms/github/channels/graphql/read-shapes.ts —— GraphQL 回包的完整度判定（票 #1685）
 *
 * ── 这个文件回答的问题 ──────────────────────────────────────────────────────────
 * 「同一条查询，回来的 JSON 说明这一组字段取全了没有？」规格 1681 第 5 节按字段组给完整度判据，
 * 其中 GraphQL 侧的判据几乎都能从连接自带的 `pageInfo` / `totalCount` / `nodes.length` 读出来。
 * 这里只做「读回包 + 判完整度」这一小步，是纯函数：不发请求、不拼查询、不碰业务规则，
 * 也不知道调用方为什么读。路由层拿它的事实去组装 `ReadProvenance`
 * （`src/tracker/rooms/github/routing/read-result.ts`），本目录不知道来源字段长什么样。
 *
 * ── 为什么放在 channels/graphql ────────────────────────────────────────────────
 * 规格 1681 第 3 节：两套协议形状只在各自通道里解析，互不引用。这里读的全是 GraphQL 连接形状
 * （`pageInfo.hasNextPage`、`totalCount`、`nodes`），一行 REST 形状都不该出现；
 * 反向也一样，`channels/rest/read-shapes.ts` 不认识 `pageInfo`。分层门禁
 * `tests/verify-room-layering.ts` 与来源门禁 `tests/verify-read-result-provenance.ts` 都盯着这条。
 *
 * ── 三条不能改的约定 ───────────────────────────────────────────────────────────
 * 1. 恰好整数页不算完整这件事在 GraphQL 侧不需要额外探测：连接自己带 `pageInfo.hasNextPage = false`
 *    就说明到底了。这里仍然写明它，是为了和 REST 侧（`channels/rest/read-shapes.ts`）的处理
 *    摆在一起看时口径一致：判据只认协议给的事实，不认「页数看起来刚好」。
 * 2. 触上限一律记 `truncated`，不许记 `complete`：`labels(first:50)` 收到 50 条、
 *    `blockedBy(first:50)` 收到 50 条、`labels(first:1000)` 收到 1000 条，都可能是「还有更多」。
 * 3. `unexpressed` 只用于「这次压根没取这一组」，不能拿来当「取到了但不确定」的垃圾桶——
 *    后者是 `truncated`。
 */
import { PAGINATION } from '../../../../contract/pagination.js'
import type { FieldGroupCompleteness } from '../../../../contract/read-provenance.js'

/**
 * 一行里标签一次要多少条：与 `channels/graphql/queries.ts` 各片段里的 `labels(first:50)` 是同一个数。
 *
 * 为什么单独提成常量：上限判定要用这个数，查询文本里却写在模板字符串里。两处漂移时，
 * 门禁 `tests/verify-read-result-provenance.ts` 会核对反引号片段里仍有 `labels(first:50))`，
 * 改一处忘另一处会当场红（该门禁的断言名会点出这个常量）。
 */
export const ROW_LABELS_MAX = 50

/**
 * 行级字段组的完整度。
 *
 * `truncated` 由调用方从翻页事实得出（GraphQL 主路撞 500 / 1000 的安全上限，或 PR 合并路失败）；
 * `dropped` 是逐节点归一化时被丢掉的节点数——丢一个也算这一组不全。
 */
export function graphqlRowsCompleteness(input: {
  readonly truncated: boolean
  readonly dropped: number
}): FieldGroupCompleteness {
  if (input.truncated || input.dropped > 0) return 'truncated'
  return 'complete'
}

/**
 * 每行标签的完整度：任一行标签数到 `ROW_LABELS_MAX`，这一组就可能不全。
 *
 * 传进来的是「每行的标签数组」而不是整个回包，因为列表与单票的行形状不同，
 * 但判据一样：片段里 `labels(first:50)` 没有 `pageInfo`，收到满 50 条时无法证明取全。
 */
export function graphqlLabelsCompleteness(
  rows: readonly (readonly unknown[])[],
): FieldGroupCompleteness {
  for (const labels of rows) {
    if (labels.length >= ROW_LABELS_MAX) return 'truncated'
  }
  return 'complete'
}

/**
 * 一次最多取多少条拉取请求评审：与 `channels/graphql/queries.ts` 的 `reviews(first:20)` 是同一个数。
 *
 * 为什么单独提成常量：片段里没有 `pageInfo`，收到满 20 条就无法证明取全，判定要用这个数；
 * 改查询上限时忘了改这里，门禁 `tests/verify-read-result-provenance.ts` 会核对片段文本并判红。
 */
export const REVIEWS_MAX = 20

/**
 * 拉取请求评审组的完整度。
 *
 * 只用于「这次确实查了评审」的拉取请求查询：片段 `reviews(first:20)` 没有 `pageInfo`，
 * 收到满 `REVIEWS_MAX`（20）条就可能是「还有下一页」，记 `truncated`；少于 20 条说明
 * 这个拉取请求的评审已经全在这份回包里。工单查询不查评审，那一组由调用方记 `unexpressed`。
 */
export function graphqlReviewsCompleteness(nodesCount: number): FieldGroupCompleteness {
  if (nodesCount >= REVIEWS_MAX) return 'truncated'
  return 'complete'
}

/**
 * 依赖组的完整度：按「这条读路径实际查过的那几侧」各自计数判断。
 *
 * `counts` 是每侧节点数（例如单票查询只查 `blockedBy` 一侧就只传一个数；依赖投影查两侧就传两个）。
 * 规则：
 * - 任一侧到了 `PAGINATION.github.depsMax`（50）→ `truncated`（规格第 5 节：每侧前 50，触上限即截断）；
 * - 没有触上限但有某一侧读不到数（`null`）→ `unexpressed`（这一侧这次没表达）；
 * - 全部小于 50 → `complete`。
 *
 * 为什么不是「一侧不到 50 就算完整」：依赖投影有两侧，单侧完整不等于整组完整；
 * 调用方必须把它实际查过的侧都传进来，少传就是调用方的错。
 */
export function graphqlDependenciesCompleteness(
  counts: readonly (number | null)[],
): FieldGroupCompleteness {
  if (counts.length === 0) return 'unexpressed'
  for (const count of counts) {
    if (count !== null && count >= PAGINATION.github.depsMax) return 'truncated'
  }
  for (const count of counts) {
    if (count === null) return 'unexpressed'
  }
  return 'complete'
}

/**
 * 评论组的完整度。
 *
 * `want` 是调用方要的张数（`commentsWantOf()` 的结果）：`null` 表示没点名要评论，
 * 走的是默认单票查询里 `comments(first:50)`；`0` 表示明确不要评论，已满足；
 * 正数表示按需翻页，`appendCommentPages()` 会翻到够数或翻不动为止。
 *
 * 判定：目标张数 = `want === null ? totalCount : min(want, totalCount)`；
 * 拿到的评论数不到目标就是 `truncated`；`totalCount` 读不到（`null`）时无法证明取全，
 * 同样记 `truncated`。为什么不记 `unexpressed`：这条路径确实取了评论组，只是可能没取全，
 * 两词的区别在文件头第 3 条。
 */
export function graphqlCommentsCompleteness(input: {
  readonly nodesCount: number
  readonly totalCount: number | null
  readonly want: number | null
}): FieldGroupCompleteness {
  if (input.want === 0) return 'complete'
  if (input.totalCount === null) return 'truncated'
  const target = input.want === null ? input.totalCount : Math.min(input.want, input.totalCount)
  if (input.nodesCount >= target) return 'complete'
  return 'truncated'
}

/**
 * 子票清单组的完整度：每页 100 张、一张地图至多 1000 张（契约硬上限）。
 *
 * 触 1000 上限（`capped` 或 `fetched >= subIssuesMax`）→ `truncated`；
 * 连接自己说还有下一页 → `truncated`；到底了 → `complete`。
 * 恰好翻到整数页不碍事：`hasNextPage = false` 就是协议给的「到底了」证据。
 */
export function graphqlSubIssuesCompleteness(input: {
  readonly fetched: number
  readonly capped: boolean
  readonly hasNextPage: boolean
}): FieldGroupCompleteness {
  if (input.capped) return 'truncated'
  if (input.fetched >= PAGINATION.github.subIssuesMax) return 'truncated'
  if (input.hasNextPage) return 'truncated'
  return 'complete'
}

/**
 * 标签清单组的完整度：一次最多要 1000 条（`labels(first:1000)`）。
 *
 * 收到满 1000 条 → `truncated`（规格第 5 节：触 1000 上限为截断）；
 * `totalCount` 拿不到或比收到的多 → `truncated`；其余 → `complete`。
 */
export function graphqlLabelListCompleteness(input: {
  readonly fetched: number
  readonly totalCount: number | null
}): FieldGroupCompleteness {
  if (input.fetched >= PAGINATION.github.labelListLimit) return 'truncated'
  if (input.totalCount === null) return 'truncated'
  if (input.totalCount > input.fetched) return 'truncated'
  return 'complete'
}
