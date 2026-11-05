/**
 * src/tracker/rooms/gitlab/requests.ts —— GitLab REST 请求边界：每个远端端点一个具名函数。
 *
 * 为什么住在房间根目录、为什么不给一个通用的 request(method, path, fields)：决定写在
 * docs/adr/20261105-gitlab-room-request-boundary.md。对调用方要紧的只有三条约定：
 *
 *   1. 参数只收领域值：这次问哪个仓库、哪张票、第几页、查询串是什么、这次允许多久（timeoutMs）。
 *      不接收已经拼好的路径字符串 —— 路径必须由本文件用 queries.ts 的拼路径函数从 refId 与票号拼出来。
 *      房外的端点采样门禁只扫房间根目录的直接子文件、不递归子目录；请求形状写在这里它才看得见，
 *      交给调用方拼它就看不见了。
 *   2. 超时是调用方的领域值，不写死在请求边界里：每个函数的最后一个参数是 timeoutMs，原样交给客户端。
 *      同一个端点形状在不同操作里可能用不同超时（例如票列表用 GITLAB_SLOW_READ_TIMEOUT_MS、子票翻页用
 *      GITLAB_READ_TIMEOUT_MS），写死会让下一族为了换超时再造一个重复的请求函数；由调用方传，端点仍然只有一个出处。
 *   3. 返回值就是客户端那三件套 {stdout, stderr, code}，原样交回。本文件不解析 JSON、不判错误档位、
 *      不写失败话术、不记日志：每个调用点的容错与说法都不一样，这些留在调用方。
 *
 * 今天收的是票的读端点（列票、读单票、评论单次与翻页、读链接）、评论写入，以及仓库身份的两条单点读
 * （当前登录人、仓库写权限）与项目本体的一条读（#1918）；其余写端点与操作族按票逐步搬进来，
 * 命名与返回约定照本文件：request 加领域动作，返回原始进程结果。
 */

import type { BackendContext, OpContext } from '../../contract/contexts.js'
import { glabClient } from './client.js'
import type { GlabRunResult } from './client.js'
import { issuesPath, issuePath, notesPath, linksPath, projectPath } from './queries.js'

// 上下文只取平台与执行器两样，而且允许缺：缺了客户端会按 127 如实回，不抛。
// 写成与 client.ts 的 GlabCtx 同款的两形交叉，读半边与写半边都能把各自的 effective 原样传进来。
type CtxLike = Partial<OpContext> & Partial<BackendContext>
// 调用方可能一个上下文都没给（opCtx 与 ctx 都缺），客户端能处理这种情形，这里如实收下。
type MaybeCtx = CtxLike | null | undefined

/** 拿这次调用要用的 glab 客户端；每次调用现取一份，与改动前各处的写法一致。 */
function clientOf(opCtx: MaybeCtx) {
  return glabClient(opCtx as CtxLike)
}

/**
 * 列一页票：GET projects/{仓库}/issues?{查询串}。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识（例如 group/sub/project；拼路径时统一编码）
 * @param query 已经拼好的查询串（例如 per_page=100&with_labels_details=true）；空串表示不接查询参数
 * @param timeoutMs 这次请求的时限（毫秒），由调用方按操作选档
 */
export function requestIssueList(
  opCtx: MaybeCtx,
  refId: string,
  query: string,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(['api', issuesPath(refId, query)], { timeout: timeoutMs })
}

/**
 * 读一张票：GET projects/{仓库}/issues/{票号}?with_labels_details=true。
 *
 * with_labels_details 必须带上：不带这个参数，远端回来的标签只有名字，没有颜色与描述。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param iid 票号（远端认字符串或数字，拼路径前统一转成字符串）
 * @param timeoutMs 这次请求的时限（毫秒），由调用方按操作选档
 */
export function requestIssueGet(
  opCtx: MaybeCtx,
  refId: string,
  iid: string | number,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(['api', `${issuePath(refId, iid)}?with_labels_details=true`], { timeout: timeoutMs })
}

/**
 * 读一张票的评论，只取远端默认的那一页：GET projects/{仓库}/issues/{票号}/notes。
 *
 * 调用方没有指定条数时走这条（老行为：一页 20 条，请求不带分页参数）；要更多评论用 requestIssueNotesPage。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param iid 票号
 * @param timeoutMs 这次请求的时限（毫秒），由调用方按操作选档
 */
export function requestIssueNotes(
  opCtx: MaybeCtx,
  refId: string,
  iid: string | number,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(['api', notesPath(refId, iid)], { timeout: timeoutMs })
}

/**
 * 按页读一张票的评论：GET projects/{仓库}/issues/{票号}/notes?per_page={每页条数}&page={页码}。
 *
 * 调用方要的条数超过远端默认一页时走这条；逐页取到够数为止的循环留在调用方，这里只发一页。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param iid 票号
 * @param perPage 这一页请求几条（由调用方按远端每页上限夹好）
 * @param page 页码，从 1 开始
 * @param timeoutMs 这次请求的时限（毫秒），由调用方按操作选档
 */
export function requestIssueNotesPage(
  opCtx: MaybeCtx,
  refId: string,
  iid: string | number,
  perPage: number,
  page: number,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(
    ['api', `${notesPath(refId, iid)}?per_page=${perPage}&page=${page}`],
    { timeout: timeoutMs },
  )
}

/**
 * 读一张票的关联链接：GET projects/{仓库}/issues/{票号}/links。
 *
 * 阻塞关系就住在这些链接行的 link_type 上；父子归属不走这里，走票文件头的隐藏标记。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param iid 票号
 * @param timeoutMs 这次请求的时限（毫秒），由调用方按操作选档
 */
export function requestIssueLinks(
  opCtx: MaybeCtx,
  refId: string,
  iid: string | number,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(['api', linksPath(refId, iid)], { timeout: timeoutMs })
}

/**
 * 写一条评论：POST projects/{仓库}/issues/{票号}/notes，表单字段 body。
 *
 * 这是本文件收下的第一个写端点。method、路径与表单字段从前由 comments.ts 自己拼；搬进这里之后，
 * 评论 endpoints 的形状与本房其它端点一样只有一个出处。调用方（comments/write.ts 的 addComment）
 * 仍负责判断仓库与正文是否齐全、解析回包、按失败档位挑话术 —— 那些都是操作上下文，不住在请求边界里。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param iid 票号（远端认字符串或数字，拼路径前统一转成字符串）
 * @param body 评论正文（调用方已确认非空）
 * @param timeoutMs 这次请求的时限（毫秒）；当前调用方传的是 GITLAB_READ_TIMEOUT_MS，与搬来之前逐字相同
 */
export function requestCommentCreate(
  opCtx: MaybeCtx,
  refId: string,
  iid: string | number,
  body: string,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(
    ['api', notesPath(refId, iid), '--method', 'POST', '-f', `body=${body}`],
    { timeout: timeoutMs },
  )
}

/**
 * 读当前登录人：GET user。
 *
 * 这条请求不依赖具体项目，所以参数里没有仓库标识；调用方（repo/current-user.ts）仍会先做自己的
 * 入口检查（refId 不像「分组/项目」就失败），那是本房的入口纪律，不是远端的形状要求 ——
 * 请求边界只负责把这一条端点原样发出去。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param timeoutMs 这次请求的时限（毫秒）；当前调用方传的是 GITLAB_READ_TIMEOUT_MS，与搬来之前逐字相同
 */
export function requestCurrentUser(opCtx: MaybeCtx, timeoutMs: number): Promise<GlabRunResult> {
  return clientOf(opCtx).run(['api', 'user'], { timeout: timeoutMs })
}

/**
 * 读一个项目本身：GET projects/{仓库}。
 *
 * 用在需要「这个工作区指向的仓库还在不在、读不读得到」的调用点。路径里的仓库标识由 projectPath
 * 统一做百分号编码（斜杠是仓库名的一部分，不编码远端会认错仓库），这里只把领域值交给它。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识（例如 group/sub/project）
 * @param timeoutMs 这次请求的时限（毫秒）
 */
export function requestProject(opCtx: MaybeCtx, refId: string, timeoutMs: number): Promise<GlabRunResult> {
  return clientOf(opCtx).run(['api', projectPath(refId)], { timeout: timeoutMs })
}

/**
 * 读一个项目的权限格：GET projects/{仓库}?simple=true。
 *
 * `simple=true` 是票面带上的参数（来龙去脉写在 repo/permissions.ts 的文件头：源码级已核实，
 * 单项目接口并不认它，但也不拒绝）。真正的判据只有一个：回包里有没有 permissions 那两格 access_level ——
 * 那是调用方的判断，不在请求边界里。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识（例如 group/sub/project）
 * @param timeoutMs 这次请求的时限（毫秒）；当前调用方传的是 GITLAB_READ_TIMEOUT_MS，与搬来之前逐字相同
 */
export function requestProjectPermissions(opCtx: MaybeCtx, refId: string, timeoutMs: number): Promise<GlabRunResult> {
  return clientOf(opCtx).run(['api', `${projectPath(refId)}?simple=true`], { timeout: timeoutMs })
}

