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
 * 今天收的是票的读端点（列票、读单票、评论单次与翻页、读链接）、评论写入，以及票的写端点（建票、
 * 改票、按名字读里程碑）；其余写端点与操作族按票逐步搬进来，
 * 命名与返回约定照本文件：request 加领域动作，返回原始进程结果。
 */

import type { BackendContext, OpContext } from '../../contract/contexts.js'
import { glabClient } from './client.js'
import type { GlabRunResult } from './client.js'
import { issuesPath, issuePath, notesPath, linksPath, projectPath, milestonesPath } from './queries.js'

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
 * 建一张票：POST projects/{仓库}/issues。
 *
 * 方法必须明写 `--method POST`：glab 默认 GET，省掉这一对就没有建票这回事。
 * 表单按 title、description、labels 的原顺序逐项 -f，空值不发：这是建票单写路径既有的形状，
 * 网关、脱敏与日志里看到的 argv 都按它核对，所以顺序与「空值不发」两条都不能改。
 * body 只收这三格：归属、里程碑等字段各有自己的写路径，不能从这里混进建票请求。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param body 建票要带的标题、正文与标签（正文与标签为空或省略时不发）
 * @param timeoutMs 这次请求的时限（毫秒），由调用方按操作选档
 */
export function requestIssueCreate(
  opCtx: MaybeCtx,
  refId: string,
  body: { title: string; description?: string; labels?: string },
  timeoutMs: number,
): Promise<GlabRunResult> {
  const args = ['api', `${projectPath(refId)}/issues`, '--method', 'POST', '-f', `title=${body.title}`]
  if (body.description) args.push('-f', `description=${body.description}`)
  if (body.labels) args.push('-f', `labels=${body.labels}`)
  return clientOf(opCtx).run(args, { timeout: timeoutMs })
}

/**
 * 改一张票：PUT projects/{仓库}/issues/{票号}。
 *
 * 表单字段由调用方按领域值给（例如 state_event、title、description、milestone_id），这里只负责
 * 把它们逐项翻成 -f：null 与 undefined 跳过（「没有这一项」不写成空字符串），数组按逗号连接
 * （GitLab 的多值字段认这个形状），其余按字符串写。参数的遍历顺序就是调用方对象的插入顺序，
 * 与搬家前 apiPut 的拼法逐字一致——远端收到的表单内容不变，变的只是这段拼装搬进了请求边界。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param iid 票号
 * @param fields 这次要写的字段（调用方已经决定要写哪些、值是什么）
 * @param timeoutMs 这次请求的时限（毫秒），由调用方按操作选档
 */
export function requestIssuePatch(
  opCtx: MaybeCtx,
  refId: string,
  iid: string | number,
  fields: Record<string, unknown>,
  timeoutMs: number,
): Promise<GlabRunResult> {
  const args = ['api', issuePath(refId, iid), '--method', 'PUT']
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === null || v === undefined) continue
    if (Array.isArray(v)) args.push('-f', `${k}=${(v as unknown[]).join(',')}`)
    else args.push('-f', `${k}=${String(v)}`)
  }
  return clientOf(opCtx).run(args, { timeout: timeoutMs })
}

/**
 * 读仓库的里程碑：GET projects/{仓库}/milestones?{查询串}。
 *
 * 改票要按名字找 milestone_id 时走这一条；查询串由调用方按领域值拼（例如 search=<名字>），
 * 与列票一样，请求边界不为某一种筛选方式另造接口。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param query 已经拼好的查询串；空串表示不接查询参数
 * @param timeoutMs 这次请求的时限（毫秒），由调用方按操作选档
 */
export function requestMilestones(
  opCtx: MaybeCtx,
  refId: string,
  query: string,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(['api', milestonesPath(refId, query)], { timeout: timeoutMs })
}
