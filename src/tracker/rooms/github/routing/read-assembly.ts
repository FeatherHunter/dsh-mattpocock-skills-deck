/**
 * src/tracker/rooms/github/routing/read-assembly.ts —— 把渠道事实组装成读结果的来源信息（票 #1685）
 *
 * ── 这个文件回答的问题 ──────────────────────────────────────────────────────────
 * 各条读路径（整仓列表、单票、按页取票，以及 #1686 接上的预检、计数、依赖、标签清单、
 * 仓库权限、子票、地图）已经知道「这次走的是哪条渠道、翻页停在什么状态」，
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
  graphqlSubIssuesCompleteness,
} from '../channels/graphql/read-shapes.js'
import {
  restLabelListCompleteness,
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

// ─────────────────────────────────────────────────────────────────────────────
// #1686：第二批七条读操作的组装函数（模型、读实现与共用支撑搬进职责目录时同批接来源）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 环境预检走了命令行这几笔时的来源信息（preflight）。
 *
 * 预检只回答「通不通」：三条门禁（gh 可执行、登录态、仓库可达）串行问完且都过，
 * 才说明权限这一组真的看过；中途任何一步失败，调用方拿到的是不带 provenance 的失败结果，
 * 不会出现「只问了一半却说完整」。来源记 rest：这几笔走的是 gh api / gh repo view，
 * 属于 REST 形状；GraphQL 那条渠道预检压根没用，所以不写降级来源（没发生降级）。
 */
export function preflightProvenance(clock: ReadClock): ReadProvenance {
  return buildReadProvenance('preflight', {
    source: 'rest',
    fieldGroups: { permissions: 'complete' },
    durationMs: elapsedOf(clock),
    startVersion: clock.startVersion,
  })
}

/**
 * 计数走了 GraphQL 时的来源信息（counts）。
 *
 * 计数只有一次 GraphQL 往返（issues 连接的 totalCount），没有 REST 兜底；两个数在同一份
 * 查询里取回，任何一个拿不到就整条失败，所以成功分支的 counts 组必为完整，不另判截断。
 */
export function countsProvenance(clock: ReadClock): ReadProvenance {
  return buildReadProvenance('counts', {
    source: 'graphql',
    fieldGroups: { counts: 'complete' },
    durationMs: elapsedOf(clock),
    startVersion: clock.startVersion,
  })
}

/** 依赖读取时交给组装函数的两侧条数：读不到的那一侧给 null（记未表达），不是给 0。 */
export interface DependencyCountFacts {
  readonly blockedByCount: number | null
  readonly blockingCount: number | null
}

/**
 * 依赖边走了后端原生字段时的来源信息（getDependencies）。
 *
 * 两侧条数都来自 GraphQL 连接：任一侧到每侧上限（契约数字表的 depsMax，50）就记截断，
 * 某一侧读不到时调用方给 null、这里记未表达——绝不把「没看到」写成「没有」。
 * 原生路两侧都表达；退回整仓列表反推时，列表没读全的那一侧由调用方决定给 null。
 */
export function dependenciesProvenanceFromGraphql(clock: ReadClock, facts: DependencyCountFacts): ReadProvenance {
  return buildReadProvenance('getDependencies', {
    source: 'graphql',
    fieldGroups: { dependencies: graphqlDependenciesCompleteness([facts.blockedByCount, facts.blockingCount]) },
    durationMs: elapsedOf(clock),
    startVersion: clock.startVersion,
  })
}

/**
 * 依赖边退回整仓列表、而那份列表走了 REST 通道时的来源信息。
 *
 * 来源记 rest、降级来源记 graphql：这一趟的数据是 REST 给的，GraphQL 主路没成——
 * 两格都如实写，排查时才分得清「REST 本来就不全」与「GraphQL 没成、退回 REST」。
 */
export function dependenciesProvenanceFromRest(clock: ReadClock, facts: DependencyCountFacts): ReadProvenance {
  return buildReadProvenance('getDependencies', {
    source: 'rest',
    degradedFrom: 'graphql',
    fieldGroups: { dependencies: graphqlDependenciesCompleteness([facts.blockedByCount, facts.blockingCount]) },
    durationMs: elapsedOf(clock),
    startVersion: clock.startVersion,
  })
}

/**
 * 标签清单走了 gh 命令行（REST 形状）时的来源信息（listLabels）。
 *
 * 标签清单取不全时整条操作失败（1000 条上限判定在 read/labels.ts），所以成功分支的标签组
 * 必为完整；这里仍按渠道判据算一次，口径与截断判定同源，不手写「complete」。
 */
export function labelsProvenanceFromRest(clock: ReadClock, facts: { readonly fetched: number }): ReadProvenance {
  return buildReadProvenance('listLabels', {
    source: 'rest',
    fieldGroups: { labels: restLabelListCompleteness(facts.fetched) },
    durationMs: elapsedOf(clock),
    startVersion: clock.startVersion,
  })
}

/**
 * 仓库写权限走了 gh api repos/<owner>/<name> 时的来源信息（getRepoPermissions）。
 *
 * 问到 push/triage 两个布尔才算读成，问不出来时调用方拿到 null、不挂 provenance；
 * 所以成功这一支权限组必为完整。来源记 rest（这一笔就是 REST 端点）。
 */
export function permissionsProvenance(clock: ReadClock): ReadProvenance {
  return buildReadProvenance('getRepoPermissions', {
    source: 'rest',
    fieldGroups: { permissions: 'complete' },
    durationMs: elapsedOf(clock),
    startVersion: clock.startVersion,
  })
}

/**
 * 子票清单走了 GraphQL 时的来源信息（listSubIssues）。
 *
 * 子票组按「撞 1000 张上限、还有下一页、拉到的张数到上限」判截断；行组按归一化时丢掉的
 * 条数判截断。两者分开报，是因为「没拉全」与「拉回来却丢掉」的排查方向完全不同。
 */
export function subIssuesProvenanceFromGraphql(clock: ReadClock, facts: {
  readonly fetched: number
  readonly capped: boolean
  readonly hasNextPage: boolean
  readonly dropped: number
}): ReadProvenance {
  return buildReadProvenance('listSubIssues', {
    source: 'graphql',
    fieldGroups: {
      subIssues: graphqlSubIssuesCompleteness({ fetched: facts.fetched, capped: facts.capped, hasNextPage: facts.hasNextPage }),
      row: graphqlRowsCompleteness({ truncated: false, dropped: facts.dropped }),
    },
    durationMs: elapsedOf(clock),
    startVersion: clock.startVersion,
  })
}

/**
 * 地图薄行走了 GraphQL 时的来源信息（listMaps）。
 *
 * 行组按封顶页数是否撞到来判截断（地图这条路没有 REST 兜底，单页失败整趟失败、不交半截）；
 * 标签组按每张地图行的标签数组是否满 50 判截断——标签来自列表片段 labels(first:50)，没有 pageInfo。
 */
export function mapsProvenanceFromGraphql(clock: ReadClock, facts: {
  readonly truncated: boolean
  readonly labelsPerRow: readonly (readonly unknown[])[]
}): ReadProvenance {
  return buildReadProvenance('listMaps', {
    source: 'graphql',
    fieldGroups: {
      row: graphqlRowsCompleteness({ truncated: facts.truncated, dropped: 0 }),
      labels: graphqlLabelsCompleteness(facts.labelsPerRow),
    },
    durationMs: elapsedOf(clock),
    startVersion: clock.startVersion,
  })
}
