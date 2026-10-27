/**
 * src/tracker/rooms/github/comment-paging.ts —— #1444 从 issues.ts 按接缝搬出，纯结构、行为零变化。
 *
 * 这里住的是「一张票的评论怎么取够」：调用方要多少条（夹在契约上限里）、第一页问多少条、
 * 远端还有下一页时按页码游标接着翻、各页节点拼回第一页的回包、最后截到要的条数。
 * 单票读路径的其余部分（查工单、改查拉取请求、REST 降级）仍留在 issues.ts。
 *
 * 为什么拆：文件粒度门禁要求单文件不超过 350 有效行（口径见 scripts/lib/effective-lines.mts）；
 * 翻页这一段本来就是「给一页、要一页」，留在读路径中间只会把主干切碎。
 *
 * 约定（改之前先读这三条）：
 *   1. 这里只翻页与拼接，不写日志、不判错误档位：翻页没取全时由调用方传进来的 onLost 落那一行
 *      read.degraded —— 事件名与字段留在 issues.ts，改事件时只改一处。
 *      反例：在这里自己 fire 一条 get:degraded —— 同一件事两处各说一遍，导出包里就对不上。
 *   2. gh 客户端由调用方递进来（不在本文件再开一只）：一次读操作只认一个客户端，
 *      否则同一趟里两套账各记各的。
 *   3. 翻页只对工单这条路生效（拉取请求那条连接一页最多 20 条，本轮不动）；翻页失败保留已取到的评论，
 *      绝不把整张票读失败。
 */

import type { GetOpts } from '../../contract/inputs.js'
import { PAGINATION } from '../../contract/pagination.js'
import type { ghClient } from './client.js'
import { getIssueQuery } from './queries.js'

/**
 * 评论一页最多多少条：取共享分页表里的评论格（commentPageSize），不与整仓列表共用一格。
 * 为什么分开：评论翻页是「一张票 × 一页评论」的小查询，不受列表「一页票 × 每票评论」
 * 交叉放大的三秒掐线影响；列表保命压到 50 时评论仍保持连接上限 100。
 */
export const COMMENTS_PAGE_MAX = PAGINATION.github.commentPageSize

/**
 * 这一趟要多少条评论：没带 comments.first 回 null（沿用旧查询 GET_QUERY，评论 first:50）；
 * 带了就夹在 0..limitMax（200）——上限来自契约（GetOpts.comments.first 的约定），不在房间里私自放宽。
 */
export function commentsWantOf(opts: GetOpts | undefined): number | null {
  return opts && opts.comments && typeof opts.comments.first === 'number'
    ? Math.max(0, Math.min(PAGINATION.github.limitMax, Math.floor(opts.comments.first)))
    : null
}

/** 第一页问多少条：没指定就不问（0，走旧查询）；要 0 条问 1 条（只为拿总数，节点随后截掉）；否则按要的条数、不超过一页上限。 */
export function firstPageSizeOf(want: number | null): number {
  if (want === null) return 0
  if (want === 0) return 1
  return Math.max(1, Math.min(want, COMMENTS_PAGE_MAX))
}

/** 翻页要的输入：客户端、工作目录、仓库坐标、票号、第一页回包、要多少条、没取全时落日志的回调。 */
interface CommentPagesInput {
  client: ReturnType<typeof ghClient>
  cwd?: string
  parsed: { owner: string; name: string }
  num: number
  /** 第一页回包里的那张票（只读 comments 连接，翻完把拼好的节点写回去）。 */
  issue: any
  want: number
  /** 翻页没取全（下一页空、没节点、JSON 坏了）时调一次；调用方用它落 read.degraded。 */
  onLost(): void
}

/**
 * 把评论翻到要的条数，并把各页节点拼回第一页的回包（原地改写 issue.comments）。
 *
 * 只改这一份回包、不返回新对象：调用方随后照旧 normalizeIssue 一次，拼好再归一不会走形
 * （normalizeIssue 只认 comments.nodes）。翻页失败时保留已经取到的评论，调一次 onLost 就收手。
 */
export async function appendCommentPages(input: CommentPagesInput): Promise<void> {
  const { client, cwd, parsed, num, issue, want, onLost } = input
  const bag: any = (issue as any).comments
  const collected: any[] = bag && Array.isArray(bag.nodes) ? bag.nodes.slice() : []
  let pageInfo: any = bag && bag.pageInfo ? bag.pageInfo : null
  while (collected.length < want && pageInfo && pageInfo.hasNextPage === true) {
    const cursor = pageInfo.endCursor != null ? String(pageInfo.endCursor) : ''
    // 没有游标却声称还有下一页，是回包形状对不上：再发一次同样的请求只会拿到同一页，直接收手。
    if (!cursor) break
    const pageSize = Math.max(1, Math.min(want - collected.length, COMMENTS_PAGE_MAX))
    const pageArgs = ['api', 'graphql', '-f', `query=${getIssueQuery(pageSize, true)}`, '-F', `owner=${parsed.owner}`, '-F', `name=${parsed.name}`, '-F', `number=${num}`, '-F', `after=${cursor}`]
    const pageR = await client.execGh(pageArgs, { cwd: cwd, via: 'get.gql' })
    let nextIssue: any = null
    if (pageR.ok) {
      try {
        const pj = JSON.parse(pageR.data.stdout || 'null')
        if (pj && !pj.errors && pj.data && pj.data.repository) nextIssue = pj.data.repository.issue
      } catch (ePage: unknown) {
        // 下一页的 JSON 坏了：保留已取到的，按「没取全」记一行，不在读路径上抛。
        nextIssue = null
      }
    }
    const nextBag: any = nextIssue && nextIssue.comments
    // 空页也当作翻到头：不回节点却还说 hasNextPage，会在这里无限转下去。
    if (!nextBag || !Array.isArray(nextBag.nodes) || nextBag.nodes.length === 0) {
      onLost()
      break
    }
    for (const node of nextBag.nodes) collected.push(node)
    pageInfo = nextBag.pageInfo || null
  }
  if (bag && typeof bag === 'object') {
    bag.nodes = collected
    if (pageInfo) bag.pageInfo = pageInfo
  } else {
    ;(issue as any).comments = { nodes: collected, pageInfo: pageInfo }
  }
}

/** 截到调用方要的条数：最后一页是整页取回的，可能比要的多，契约说 first 是多少就交多少。总数不碰：归一时写在 commentCount 里的总数是全量，截评论只截数组。 */
export function trimCommentsToWant(issue: any, want: number | null): void {
  if (want !== null && issue && Array.isArray(issue.comments) && issue.comments.length > want) {
    issue.comments = issue.comments.slice(0, want)
  }
}
