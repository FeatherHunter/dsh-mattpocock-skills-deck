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
 *      查询串（query）同样是领域值：规格第 1 条把它列进参数，列票、分页、地图与子票的筛选各不
 *      相同，所以 requestIssueList 继续收查询串，不为此硬造一个大而全的查询类型；路径与 method
 *      才由本文件唯一决定。
 *   2. 超时是调用方的领域值，不写死在请求边界里：每个函数的最后一个参数是 timeoutMs，原样交给客户端。
 *      同一个端点形状在不同操作里可能用不同超时（例如票列表用 GITLAB_SLOW_READ_TIMEOUT_MS、子票翻页用
 *      GITLAB_READ_TIMEOUT_MS），写死会让下一族为了换超时再造一个重复的请求函数；由调用方传，端点仍然只有一个出处。
 *   3. 返回值就是客户端那三件套 {stdout, stderr, code}，原样交回。本文件不解析 JSON、不判错误档位、
 *      不写失败话术、不记日志：每个调用点的容错与说法都不一样，这些留在调用方。
 *
 * 今天收的是票的读端点（列票、读单票、评论单次与翻页、读链接）、评论写入、票的写端点（建票、
 * 关票、重开、改正文、改认领人、改领域字段、按名字读里程碑）、标签的三条请求（整集赋值、列一页清单、
 * 改一条颜色）、仓库身份的两条单点读
 * （当前登录人、仓库写权限）、项目本体的一条读（#1918），以及关系（阻塞边）的写端点与按登录名查用户
 * （#1920：加一条原生阻塞边、删一条原生阻塞边、环检用的整页票快照、用户名换用户编号）；其余写端点
 * 与操作族按票逐步搬进来，命名与返回约定照本文件：request 加领域动作，返回原始进程结果。
 */

import type { BackendContext, OpContext } from '../../contract/contexts.js'
import { glabClient } from './client.js'
import type { GlabRunResult } from './client.js'
import { issuesPath, issuePath, notesPath, linksPath, projectPath, milestonesPath } from './queries.js'
// 分页额度只有共享表一处：环检快照那条固定 per_page 也必须从它取值，不能写裸数字（门禁 per-page-digits）。
import { PAGINATION } from '../../contract/pagination.js'

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
export function issueCreateArgs(
  refId: string,
  body: { title: string; description?: string; labels?: string },
): string[] {
  const args = ['api', `${projectPath(refId)}/issues`, '--method', 'POST', '-f', `title=${body.title}`]
  if (body.description) args.push('-f', `description=${body.description}`)
  if (body.labels) args.push('-f', `labels=${body.labels}`)
  return args
}

export function requestIssueCreate(
  opCtx: MaybeCtx,
  refId: string,
  body: { title: string; description?: string; labels?: string },
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(issueCreateArgs(refId, body), { timeout: timeoutMs })
}

/**
 * 关一张票：PUT projects/{仓库}/issues/{票号}，表单字段固定为 state_event=close。
 *
 * 关票、重开、改正文、改认领人与改领域字段打的是同一个端点；每个动作的字段形状各自固定，所以按
 * 领域动作各给一个函数，不把任意表单袋交回调用方。method 固定 PUT、路径固定走 issuePath，
 * 超时仍由调用方按操作选档。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param iid 票号
 * @param timeoutMs 这次请求的时限（毫秒），由调用方按操作选档
 */
export function requestIssueClose(
  opCtx: MaybeCtx,
  refId: string,
  iid: string | number,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(
    ['api', issuePath(refId, iid), '--method', 'PUT', '-f', 'state_event=close'],
    { timeout: timeoutMs },
  )
}

/**
 * 重开一张票：PUT projects/{仓库}/issues/{票号}，表单字段固定为 state_event=reopen。
 *
 * 与关票同一个端点、同一个方法，只有状态值不同；分成两个具名函数，是为了让调用方只说
 * 「重开这一张」，不需要知道远端把状态写在哪个表单字段里。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param iid 票号
 * @param timeoutMs 这次请求的时限（毫秒），由调用方按操作选档
 */
export function requestIssueReopen(
  opCtx: MaybeCtx,
  refId: string,
  iid: string | number,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(
    ['api', issuePath(refId, iid), '--method', 'PUT', '-f', 'state_event=reopen'],
    { timeout: timeoutMs },
  )
}

/**
 * 改一张票的正文：PUT projects/{仓库}/issues/{票号}，表单字段固定为 description。
 *
 * 阻塞关系回退到正文成对两行、亲缘挂载改文件头隐藏标记，两处都要整篇重写正文。调用方传已经拼好的
 * 正文原文；换行原样发，不转义（远端存什么读回就是什么，读回的解析才对得上）。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param iid 票号
 * @param description 这次要写回的整篇正文
 * @param timeoutMs 这次请求的时限（毫秒），由调用方按操作选档
 */
export function requestIssueSetBody(
  opCtx: MaybeCtx,
  refId: string,
  iid: string | number,
  description: string,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(
    ['api', issuePath(refId, iid), '--method', 'PUT', '-f', `description=${description}`],
    { timeout: timeoutMs },
  )
}

/**
 * 换一张票的认领人整集：PUT projects/{仓库}/issues/{票号}，表单字段固定为 assignee_ids。
 *
 * GitLab 的 assignee_ids 收的是逗号分隔的用户编号整集，不是登录名；调用方已经先把每个登录名换成
 * 编号并拼好这一串。这里原样发出，不再拆开或重新排序 —— 它是整集替换，少一个编号就会把那个人的
 * 认领删掉。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param iid 票号
 * @param assigneeIds 逗号分隔的用户编号整集（调用方已拼好）
 * @param timeoutMs 这次请求的时限（毫秒），由调用方按操作选档
 */
export function requestIssueSetAssignees(
  opCtx: MaybeCtx,
  refId: string,
  iid: string | number,
  assigneeIds: string,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(
    ['api', issuePath(refId, iid), '--method', 'PUT', '-f', `assignee_ids=${assigneeIds}`],
    { timeout: timeoutMs },
  )
}

/** 改票这条写路径能带的三个领域字段；别的键不读，也不会被写出去。 */
export interface IssueUpdateFields {
  /** 新标题；没给（undefined 或 null）就不发这一项。 */
  title?: string | null
  /** 新正文；没给（undefined 或 null）就不发这一项。 */
  description?: string | null
  /** 新里程碑编号；0 表示清除，没给（undefined 或 null）就不发这一项。 */
  milestoneId?: string | number | null
}

/**
 * 改一张票的领域字段：标题、正文、里程碑，一次 PUT 全都写出去。
 *
 * 只收三个领域字段，字段名与表单名的对应固定在这里：title → title、description → description、
 * milestoneId → milestone_id。拼装顺序固定为 title / description / milestone_id，与搬家前调用方
 * 对象里的插入顺序一致（网关、脱敏与日志按 argv 顺序核对）。null 与 undefined 跳过，不写成空串；
 * milestoneId 为 0 表示清除里程碑，0 不是空值，要如实发出去。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param iid 票号
 * @param fields 这次要写的领域字段（只认这三个，别的键不读）
 * @param timeoutMs 这次请求的时限（毫秒），由调用方按操作选档
 */
export function requestIssueUpdate(
  opCtx: MaybeCtx,
  refId: string,
  iid: string | number,
  fields: IssueUpdateFields,
  timeoutMs: number,
): Promise<GlabRunResult> {
  const args = ['api', issuePath(refId, iid), '--method', 'PUT']
  if (fields.title !== null && fields.title !== undefined) args.push('-f', `title=${String(fields.title)}`)
  if (fields.description !== null && fields.description !== undefined) args.push('-f', `description=${String(fields.description)}`)
  if (fields.milestoneId !== null && fields.milestoneId !== undefined) args.push('-f', `milestone_id=${String(fields.milestoneId)}`)
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

/**
 * 数这个仓库里符合条件的票：GET projects/{仓库}/issues_statistics?{查询串}。
 *
 * 这是计数（counts）与分页读票（listPage）取总数的那条端点。查询串由调用方按筛选口径拼好
 * （至少带 scope=all：项目级 issues_statistics 的属性表没写这个参数的默认值，不赌它）；
 * 本函数只把路径与查询串接起来，不解析回包里的三个数，也不判档与写话术。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识（例如 group/sub/project；拼路径时统一编码）
 * @param query 已经拼好的查询串（例如 scope=all&labels=bug）
 * @param timeoutMs 这次请求的时限（毫秒），由调用方按操作选档
 */
export function requestIssueStatistics(
  opCtx: MaybeCtx,
  refId: string,
  query: string,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(['api', `${projectPath(refId)}/issues_statistics?${query}`], {
    timeout: timeoutMs,
  })
}

/**
 * 给一张票整体换标签：PUT projects/{仓库}/issues/{票号}，表单字段 labels。
 *
 * 这是整集替换：表单值由调用方拼成一串逗号分隔的标签名，空串表示清空这一张票的标签。
 * 方法、路径与字段从前由房间根目录的 labels.ts 自己拼（#1916 之后由 labels/assign.ts 调用本函数）。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param iid 票号（远端认字符串或数字，拼路径前统一转成字符串）
 * @param labelsCsv 逗号分隔的标签名整集（空串表示清空）
 * @param timeoutMs 这次请求的时限（毫秒）；当前调用方传的是 GITLAB_READ_TIMEOUT_MS，与搬来之前逐字相同
 */
export function requestLabelAssign(
  opCtx: MaybeCtx,
  refId: string,
  iid: string | number,
  labelsCsv: string,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(
    ['api', issuePath(refId, iid), '--method', 'PUT', '-f', `labels=${labelsCsv}`],
    { timeout: timeoutMs },
  )
}

/**
 * 列一页仓库标签：GET projects/{仓库}/labels?per_page={每页条数}&page={页码}&include_ancestor_groups=false。
 *
 * 路径与查询串逐字保持房间根目录 labels-ops.ts 的原有写法（#1916 搬进 labels/list.ts 时未改）：
 * 三个查询参数一个都不能少。include_ancestor_groups=false 为什么必须显式带上——GitLab 不写它
 * 默认会带上层分组的标签，而分组标签在改色接口上改不了（远端回 404）；列出来就是一份
 * 「界面上能看见、一按保存就失败」的假标签。翻页循环与「短页就是最后一页」的判据留在调用方
 * （labels/list.ts），这里只发一页。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识（拼路径时统一编码）
 * @param perPage 这一页请求几条（调用方按远端每页上限选好）
 * @param page 页码，从 1 开始
 * @param timeoutMs 这次请求的时限（毫秒）；当前调用方传的是 GITLAB_READ_TIMEOUT_MS，与搬来之前逐字相同
 */
export function requestLabelList(
  opCtx: MaybeCtx,
  refId: string,
  perPage: number,
  page: number,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(
    ['api', projectPath(refId) + '/labels?per_page=' + String(perPage) + '&page=' + String(page) + '&include_ancestor_groups=false'],
    { timeout: timeoutMs },
  )
}

/**
 * 改一个标签的颜色：PUT projects/{仓库}/labels/{标签名}，表单字段 color=#rrggbb。
 *
 * 标签名按路径参数整体做一次 URL 编码：名字里的冒号、空格都算标签名的一部分，不编码会被当成
 * 路径分隔符或查询串起点，请求会打到别的端点上去。颜色由调用方归一成不带井号的六位小写后
 * 补上井号再传进来——GitLab 官方文档要求带前导井号，不带会被远端拒绝。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识
 * @param labelName 标签名原文（本函数负责编码，不收已经编码好的路径片段）
 * @param colorWithHash 带前导井号的六位十六进制颜色（例如 #9d7cd8）
 * @param timeoutMs 这次请求的时限（毫秒）；当前调用方传的是 GITLAB_READ_TIMEOUT_MS，与搬来之前逐字相同
 */
export function requestLabelColor(
  opCtx: MaybeCtx,
  refId: string,
  labelName: string,
  colorWithHash: string,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(
    ['api', projectPath(refId) + '/labels/' + encodeURIComponent(labelName), '--method', 'PUT', '-f', 'color=' + colorWithHash],
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

/**
 * 列一页票，固定取满 100 条：GET projects/{仓库}/issues?per_page=100。
 *
 * 这是关系写路径的环检快照（graph/write.ts 的 buildBlockMap）：要判断「这次写入会不会把依赖连成环」，
 * 得先把全仓的阻塞关系拉一页回来。查询串在这里写死成字面量，不交给调用方拼：登记表里的
 * `issues-list-capped` 是一条形状固定的端点，门禁也按字面量 `?per_page=100` 认它。
 * 为什么不是复用 requestIssueList：后者的查询串是调用方领域值拼出来的，门禁看到的是 `?{}`，
 * 会把这条「整页快照」读成别的请求形状。
 *
 * 本函数只发请求，不解析回包、不判「取满是截断」：调用方（环检）在拉不全时按既有纪律不拦这次写。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识（例如 group/sub/project；拼路径时统一编码）
 * @param timeoutMs 这次请求的时限（毫秒）；当前调用方传的是 GITLAB_READ_TIMEOUT_MS，与搬来之前逐字相同
 */
export function requestIssueListCapped(opCtx: MaybeCtx, refId: string, timeoutMs: number): Promise<GlabRunResult> {
  // 走 projectPath 再拼固定查询串，而不是 issuesPath(refId, query)：端点采样门禁要把这一条认成
  // `projects/{}/issues?per_page=100`（issues-list-capped）；写成变量查询串它会读成 `?{}`。
  // per_page 的数值仍从共享分页表取，避免裸数字（verify-pagination-limits 的 per-page-digits）。
  return clientOf(opCtx).run(['api', projectPath(refId) + '/issues?per_page=' + PAGINATION.gitlab.maxPerPage], { timeout: timeoutMs })
}

/**
 * 加一条原生阻塞边：POST projects/{仓库}/issues/{票号}/links，表单三格
 * target_project_id / target_issue_iid / link_type。
 *
 * 原生阻塞（`link_type=is_blocked_by`）是远端付档能力；能不能加、加失败算不算「远端没能力」
 * 由调用方（graph/write.ts 的 writeNativeBlockedBy）判。这里只按原顺序把三格表单写出去：
 * 表单顺序就是搬迁前 argv 里的顺序，网关与脱敏日志按它核对，所以不能调换。
 *
 * targetProjectId 收的是**原样的仓库引用**（与 issuesPath 的编码那一份不同）：它是表单值，不经过
 * URL 解码，写成编码值远端会认成另一个仓库（#1181 踩过的那条）。调用方传 repoRefId(repo) 的原值。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识（拼路径时统一编码）
 * @param iid 被阻塞票的票号（这条边从它这一头发起）
 * @param targetProjectId 阻塞者所在的仓库引用原值（表单值，不编码）
 * @param targetIid 阻塞者的票号
 * @param linkType 关系类型；当前唯一的调用方传 'is_blocked_by'
 * @param timeoutMs 这次请求的时限（毫秒）；当前调用方传的是 GITLAB_READ_TIMEOUT_MS，与搬来之前逐字相同
 */
export function requestLinkCreate(
  opCtx: MaybeCtx,
  refId: string,
  iid: string | number,
  targetProjectId: string,
  targetIid: string,
  linkType: string,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(
    [
      'api',
      linksPath(refId, iid),
      '--method',
      'POST',
      '-f',
      `target_project_id=${targetProjectId}`,
      '-f',
      `target_issue_iid=${targetIid}`,
      '-f',
      `link_type=${linkType}`,
    ],
    { timeout: timeoutMs },
  )
}

/**
 * 删一条原生阻塞边：DELETE projects/{仓库}/issues/{票号}/links/{链接编号}。
 *
 * 链接编号是远端在加边时分配的 `issue_link_id`，不是任何一头的票号；删边时只能用它。
 * 路径按 `linksPath` 再拼一段编号，编号原样拼进去（搬迁前也不编码，数字编号两者等价，
 * 这里保持同一形状，不让请求边界多一层行为）。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param refId 仓库标识（拼路径时统一编码）
 * @param iid 被阻塞票的票号
 * @param linkId 远端分配的链接编号（调用方从 links 回包里的 issue_link_id 取出）
 * @param timeoutMs 这次请求的时限（毫秒）；当前调用方传的是 GITLAB_READ_TIMEOUT_MS，与搬来之前逐字相同
 */
export function requestLinkDelete(
  opCtx: MaybeCtx,
  refId: string,
  iid: string | number,
  linkId: string | number,
  timeoutMs: number,
): Promise<GlabRunResult> {
  return clientOf(opCtx).run(['api', `${linksPath(refId, iid)}/${String(linkId)}`, '--method', 'DELETE'], {
    timeout: timeoutMs,
  })
}

/**
 * 按登录名查一个人：GET users?username={登录名}。
 *
 * 指派票要的是数字用户编号（`assignee_ids` 不吃名字），所以写指派前先把每个登录名换成编号。
 * 查询串的键与第一个字面量段写死在这里，登录名只做一次 encodeURIComponent：名字里的空格、斜杠
 * 不能被当成查询串分隔符。回包是数组还是空数组、换不到编号算不算失败，都由调用方判。
 *
 * @param opCtx 调用上下文（平台与执行器从这里取）
 * @param username 登录名原文（本函数负责编码，不收已经编码好的查询串片段）
 * @param timeoutMs 这次请求的时限（毫秒）；当前调用方传的是 GITLAB_PROBE_TIMEOUT_MS，与搬来之前逐字相同
 */
export function requestUserByName(opCtx: MaybeCtx, username: string, timeoutMs: number): Promise<GlabRunResult> {
  return clientOf(opCtx).run(['api', 'users?username=' + encodeURIComponent(username)], { timeout: timeoutMs })
}

