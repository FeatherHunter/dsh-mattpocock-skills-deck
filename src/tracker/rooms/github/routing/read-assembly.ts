/**
 * src/tracker/rooms/github/routing/read-assembly.ts —— 把渠道事实组装成读结果的来源信息（票 #1685）
 *
 * ── 这个文件回答的问题 ──────────────────────────────────────────────────────────
 * 各条读路径（整仓列表、单票、按页取票）已经知道「这次走的是哪条渠道、翻页停在什么状态」，
 * 但把协议事实翻译成 `ReadProvenance` 的活不该散在每个读函数里——散开写，一处口径改了别的路
 * 不会跟着改。这里按操作各收一个组装函数：调用方只交渠道层的事实，来源、字段组完整度、耗时
 * 与取数开始版本都在这里算好，再交给 `buildReadProvenance` 做统一校验。
 *
 * ── 为什么住在 routing ─────────────────────────────────────────────────────────
 * 路由层本来就是两条渠道汇合的地方（ADR 20261030-github-room-channel-layering 第 2 章）：
 * 它同时认识 GraphQL 与 REST 的完整度判据，而读路径只认识自己调用的那条渠道。
 * 让读路径直接 import 两条 channels 的判据，等于把「渠道汇合」的逻辑摊到每个读函数里。
 *
 * ── 三条不能改的约定 ───────────────────────────────────────────────────────────
 * 1. 来源用实际走通的那条渠道，不许按「本意想走哪条」写：降级时来源是 `rest`，并带上 `degradedFrom: 'graphql'`。
 * 2. 每个声明字段组都要表态：列表是行与标签，单票是行、正文、评论、依赖，按页取票是行与标签。
 *    没有取的那一组写 `unexpressed`，取到但可能不全写 `truncated`，不许拿总体布尔糊过去。
 * 3. 耗时与取数开始版本由调用方在入口调 `beginRead()` 收下、一路传到这里；这里只做减法，
 *    不自己取起点——起点晚了会把「翻页花了多久」算漏。
 */
import type { ReadProvenance } from '../../../contract/read-provenance.js'
import {
  graphqlCommentsCompleteness,
  graphqlDependenciesCompleteness,
  graphqlLabelsCompleteness,
  graphqlRowsCompleteness,
} from '../channels/graphql/read-shapes.js'
import {
  restListCompleteness,
  restRowLabelsCompleteness,
  restSingleRowFieldGroups,
} from '../channels/rest/read-shapes.js'
import type { RestListPagingFacts } from '../channels/rest/read-shapes.js'
import { buildReadProvenance } from './read-result.js'
import type { ReadClock } from './read-result.js'

/** 从入口收下的起点算到此刻的毫秒数（耗时只算这一段，不含调用方在外面等的时间）。 */
function elapsedOf(clock: ReadClock): number {
  return Math.max(0, Date.now() - clock.startedAt)
}

/**
 * GraphQL 连接的两格事实：这一页回来几个节点（读不到给 null）、总数是多少（读不到给 null）。
 * 只看 `nodes` 数组长度与 `totalCount` 数字，不解读节点内容——节点怎么归一化是 normalize 的事。
 */
interface ConnectionFacts {
  readonly nodes: number | null
  readonly totalCount: number | null
}

/** 从一个原始回包对象里取某个连接字段的事实；字段缺失、形状不认识都按「读不到」给 null。 */
function connectionFactsOf(raw: unknown, field: string): ConnectionFacts {
  if (!raw || typeof raw !== 'object') return { nodes: null, totalCount: null }
  const conn = (raw as Record<string, unknown>)[field]
  if (!conn || typeof conn !== 'object') return { nodes: null, totalCount: null }
  const bag = conn as { nodes?: unknown; totalCount?: unknown }
  const nodes = Array.isArray(bag.nodes) ? bag.nodes.length : null
  const totalCount = typeof bag.totalCount === 'number' && Number.isInteger(bag.totalCount) && bag.totalCount >= 0
    ? bag.totalCount
    : null
  return { nodes, totalCount }
}

/**
 * 整仓列表走了 GraphQL 主路时的来源信息。
 *
 * `labelsPerRow` 是每一行的标签数组（列表片段 labels(first:50) 没有 pageInfo，收到满 50 条即截断）；
 * `truncated` 是主路撞到 500 / 1000 安全上限；`dropped` 是逐节点归一化时丢掉的节点数。
 */
export function listProvenanceFromGraphql(clock: ReadClock, facts: {
  readonly truncated: boolean
  readonly dropped: number
  readonly labelsPerRow: readonly (readonly unknown[])[]
}): ReadProvenance {
  return buildReadProvenance('list', {
    source: 'graphql',
    fieldGroups: {
      row: graphqlRowsCompleteness({ truncated: facts.truncated, dropped: facts.dropped }),
      labels: graphqlLabelsCompleteness(facts.labelsPerRow),
    },
    durationMs: elapsedOf(clock),
    startVersion: clock.startVersion,
  })
}

/**
 * 整仓列表走了 REST 兜底通道时的来源信息。
 *
 * 来源记 `rest`、降级来源记 `graphql`：这一趟的实际数据是 REST 给的，主路 GraphQL 没成——
 * 两格都如实写，阶段 2 的合并层与排查日志才分得清「REST 本来就这么全」与「GraphQL 没成、退回 REST」。
 */
export function listProvenanceFromRest(clock: ReadClock, facts: {
  readonly paging: RestListPagingFacts
  readonly rows: readonly unknown[]
}): ReadProvenance {
  return buildReadProvenance('list', {
    source: 'rest',
    degradedFrom: 'graphql',
    fieldGroups: {
      row: restListCompleteness(facts.paging),
      labels: restRowLabelsCompleteness(facts.rows),
    },
    durationMs: elapsedOf(clock),
    startVersion: clock.startVersion,
  })
}

/**
 * 单票走了 GraphQL 工单查询时的来源信息。
 *
 * 工单查询带正文、labels(first:50)、comments(first:N)、blockedBy(first:50)；`blocking`（反向边）
 * 这一侧查询里没有，所以依赖组按「被阻塞一侧已表达、阻塞一侧未表达」判——只报实际查过的那一侧，
 * 不假装两侧都看过（规格第 9 节：缺失字段组要说清是哪个组）。
 */
export function detailProvenanceFromGraphql(clock: ReadClock, rawIssue: unknown, facts: {
  readonly dropped: number
  readonly want: number | null
  readonly commentsLost: boolean
}): ReadProvenance {
  const comments = connectionFactsOf(rawIssue, 'comments')
  const blockedBy = connectionFactsOf(rawIssue, 'blockedBy')
  const commentsValue = facts.commentsLost
    ? 'truncated'
    : graphqlCommentsCompleteness({
      nodesCount: comments.nodes ?? 0,
      totalCount: comments.totalCount,
      want: facts.want,
    })
  return buildReadProvenance('get', {
    source: 'graphql',
    fieldGroups: {
      row: graphqlRowsCompleteness({ truncated: false, dropped: facts.dropped }),
      body: 'complete',
      comments: commentsValue,
      dependencies: graphqlDependenciesCompleteness([blockedBy.nodes, null]),
    },
    durationMs: elapsedOf(clock),
    startVersion: clock.startVersion,
  })
}

/**
 * 单票走了 GraphQL 拉取请求查询时的来源信息。
 *
 * 拉取请求片段带正文与 comments(first:20)（无 pageInfo、不翻页），没有依赖边与反向边：
 * 依赖组记 `unexpressed`（这次压根没取），评论组按目标总数判断——拿到的比总数少就是截断。
 */
export function detailProvenanceFromPullRequest(clock: ReadClock, rawPullRequest: unknown, facts: {
  readonly dropped: number
}): ReadProvenance {
  const comments = connectionFactsOf(rawPullRequest, 'comments')
  return buildReadProvenance('get', {
    source: 'graphql',
    fieldGroups: {
      row: graphqlRowsCompleteness({ truncated: false, dropped: facts.dropped }),
      body: 'complete',
      comments: graphqlCommentsCompleteness({
        nodesCount: comments.nodes ?? 0,
        totalCount: comments.totalCount,
        want: null,
      }),
      dependencies: graphqlDependenciesCompleteness([]),
    },
    durationMs: elapsedOf(clock),
    startVersion: clock.startVersion,
  })
}

/**
 * 单票走了 REST 端点时的来源信息。
 *
 * REST 单票端点只能证明行字段与正文；评论正文、依赖边、子票都不在这份回包里，
 * 三组如实记 `unexpressed`——不能因为「没报错」就说完整（规格第 5 节：REST 单票不表达这三组）。
 */
export function detailProvenanceFromRest(clock: ReadClock): ReadProvenance {
  return buildReadProvenance('get', {
    source: 'rest',
    degradedFrom: 'graphql',
    fieldGroups: restSingleRowFieldGroups(),
    durationMs: elapsedOf(clock),
    startVersion: clock.startVersion,
  })
}

/**
 * 按页取票（listPage）走了 GraphQL 时的来源信息。
 *
 * 这一页的行与标签同列表判据：行靠 dropped 判断，标签靠每行是否满 50 判断。
 * 已关闭票的翻页只加来源与完整度，不把「按更新时间增量」扩到这里（规格第 5 节明确不做）。
 */
export function pageProvenanceFromGraphql(clock: ReadClock, facts: {
  readonly dropped: number
  readonly labelsPerRow: readonly (readonly unknown[])[]
}): ReadProvenance {
  return buildReadProvenance('listPage', {
    source: 'graphql',
    fieldGroups: {
      row: graphqlRowsCompleteness({ truncated: false, dropped: facts.dropped }),
      labels: graphqlLabelsCompleteness(facts.labelsPerRow),
    },
    durationMs: elapsedOf(clock),
    startVersion: clock.startVersion,
  })
}
