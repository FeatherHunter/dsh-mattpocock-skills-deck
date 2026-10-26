/**
 * src/tracker/rooms/github/queries.ts — GraphQL 查询/片段。
 *
 * 定版依据：#127（单 key/无 subIssues）+#126（Label {name,color,description?}）+#137（queries 差距清单）+#138 一页纸方案
 *
 * 文件头原写 `backends/github/queries.js`，是 #1019 目录归位前的旧路径；#1052 把读路径这一片的文件头
 * 逐个改成今天的真名（本文件也在这一片里）。改名不动一行查询文本：这里只有一个字符串常量与一个默认对象。
 *
 * 不变量：
 *  - `number` 仅作 `key=String(number)` 的来源，不作为契约字段产出（harness 断言 no number）。
 *  - `subIssues` 不进入 Issue 形状，仅用于 `parentKey` 反查校验（已删 Issue.subIssues），但查询仍保留 parent 边。
 *  - `labels` 抓 `name color description` 全量（color 无则 ''，description 可空 → shape 归一）。
 *  - 能力字段来源全覆盖：author/assignees/milestone/comments/parent/blockedBy。
 */

import { PAGINATION } from '../../contract/pagination.js'

// 评论节点的字段清单：列表与单票共用一份，改这里两处一起变，不会一处多取、一处少取。
// 这个形状与 normalizeComments 读的字段一一对应（src/tracker/rooms/github/normalize.ts 的 normalizeComments）。
const COMMENT_NODE_FIELDS = 'id author{login avatarUrl __typename ... on User{name} ... on Organization{name}} authorAssociation body createdAt updatedAt lastEditedAt'

/**
 * 一条评论连接（comments 字段）。
 *
 * 为什么按参数拼：单票详情默认只要 50 条（与列表同一份字段清单），而评论「加载更多」要按调用方
 * 这一趟要的条数取、还要带着游标一页页翻（#1444）。默认不带 after、不带 pageInfo，拼出来的文本
 * 与迁移前逐字相同，列表查询因此一行不变。
 */
function commentsField(first: number, opts?: { after?: boolean; pageInfo?: boolean }): string {
  const after = opts && opts.after ? ', after:$after' : ''
  const pageInfo = opts && opts.pageInfo ? ' pageInfo{hasNextPage endCursor}' : ''
  return `comments(first:${first}${after}){nodes{${COMMENT_NODE_FIELDS}}${pageInfo}}`
}

/** 单票字段清单：core 与能力字段来源固定，评论那一栏由调用方给（单票给条数、没有分页信息）。 */
function issueFragmentFields(comments: string): string[] {
  return [
    'number', // keySource only → normalize String(number) → Issue.key（不产 number 字段）
    'title',
    'state',
    'body',
    'url',
    'createdAt',
    'updatedAt',
    'closedAt',
    'author{login avatarUrl __typename ... on User{name} ... on Organization{name}}',
    'assignees(first:50){nodes{login name avatarUrl __typename}}',
    'labels(first:50){nodes{name color description}}',
    'milestone{title description state dueOn}',
    comments,
    'parent{number}',
    'blockedBy(first:50){nodes{number title state}}',
  ]
}

// 单票必需字段（core + 能力字段来源）。`number` 作 keySource 注释明确不外泄。
// 评论条数从共享分页表取默认值（50）：单票详情默认 50 条，默认路径的查询文本保持不变。
export const ISSUE_FRAGMENT = issueFragmentFields(commentsField(PAGINATION.github.limitDefault)).join(' ')

// 列表专用片段：与 ISSUE_FRAGMENT 同源、唯独不带 comments。
// 为什么单列：列表一行画不到评论（点开单票详情走 GET_QUERY 另取；REST 降级回包里本来就没有评论体），
// 而「页 100 × 每票 50 条评论」的单查询会被对端约 3 秒掐断（真机实测：全字段 100 页三次全灭 EOF，
// 全字段 50 页约 2.7 秒贴线，去评论 50 页 1.43 秒）。页大小一并压到 50（PAGINATION.github.listPageSize），
// 把单查询耗时压回 1.5 秒线以内。GET_QUERY 与 SUB_ISSUES_QUERY 不动（单票便宜、地图子票按需取）。
export const LIST_ISSUE_FRAGMENT = issueFragmentFields('').filter(function (f) { return f !== '' }).join(' ')

// 每条查询在 Query 根都带 rateLimit{ cost }（#1482）：回包里这一格是本趟真实点数，记账按它记，
// 不再把每条 GraphQL 都当成 1 点。mutation 拿不到这一格（RateLimit 只挂在 Query 根），写操作仍按 1 点估。

// GraphQL list 查询（批量取；filter 在内存完成）
export const LIST_QUERY = `query($owner:String!,$name:String!,$first:Int!,$after:String){
  rateLimit{ cost }
  repository(owner:$owner,name:$name){
    issues(first:$first, after:$after, states:[OPEN,CLOSED], orderBy:{field:UPDATED_AT, direction:DESC}){
      nodes{ ${LIST_ISSUE_FRAGMENT} }
      pageInfo{ hasNextPage endCursor }
    }
  }
}`

// 单票查询
export const GET_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  rateLimit{ cost }
  repository(owner:$owner,name:$name){
    issue(number:$number){ ${ISSUE_FRAGMENT} }
  }
}`

/**
 * 单票查询，评论按这一趟要的条数取（#1444 评论「加载更多」）。
 *
 * 为什么单开一个拼查询的出口：GetOpts.comments.first 是调用方这一次要的条数，房间不能把
 * comments(first:50) 写死再在内存里截（那样要 100 条也只有 50 条）。这里只改 comments 一栏，
 * 其余字段与 GET_QUERY 完全同源；带 pageInfo 是为了让房间知道还有没有下一页。
 * withAfter 为 true 时声明 $after 变量并用游标接着翻，false 时查询文本里不出现 after。
 */
export function getIssueQuery(commentsFirst: number, withAfter: boolean): string {
  const vars = withAfter ? ',$after:String' : ''
  const comments = commentsField(commentsFirst, { after: withAfter, pageInfo: true })
  return `query($owner:String!,$name:String!,$number:Int!${vars}){
  rateLimit{ cost }
  repository(owner:$owner,name:$name){
    issue(number:$number){ ${issueFragmentFields(comments).join(' ')} }
  }
}`
}

// 依赖投影查询（#1304）：一次取齐正向与反向阻塞边，标题与状态随行回来，不再逐张再读。
// 为什么不并进 ISSUE_FRAGMENT：列表查询不需要反向边（每行多付一整条连接的钱），
// 而且契约不允许把 blocking 塞进 Issue 实体；它只是 getDependencies 的投影。
// 两条连接都带 pageInfo：到了后端一次能给的条数上限时，调用方要能如实说「可能不全」。
// 条数从共享分页表取（src/tracker/contract/pagination.ts 的 github.depsMax）：查询串与「到没到上限」的判定用同一个常量，不会两处漂移。
export const DEPS_MAX = PAGINATION.github.depsMax

export const DEPS_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  rateLimit{ cost }
  repository(owner:$owner,name:$name){
    issue(number:$number){
      number
      blockedBy(first:${DEPS_MAX}){ pageInfo{ hasNextPage } nodes{ number title state labels(first:20){ nodes{ name } } } }
      blocking(first:${DEPS_MAX}){ pageInfo{ hasNextPage } nodes{ number title state labels(first:20){ nodes{ name } } } }
    }
  }
}`

// 计数查询（#689 的 counts op）。一次往返拿两个数：不翻页、不带任何行，所以只花 1 点额度（2026-09-22 实测）。
// 为什么用 issues 连接：它天然不含拉取请求（契约要求「只数工单」），而 REST 的 open_issues_count 把拉取
//   请求也算在内，不能用。
// 带标签筛的那一版单独一份查询：filterBy 只在真有标签要筛时才出现 —— 无标签时传 filterBy:{labels:[]}
//   在各版本上的行为不一致（空数组是「不筛」还是「全都要有」，没有把握），所以不让它出现。
// 两个别名（openIssues / closedIssues）对应契约里的 open 与 closed，total 由调用方相加（一次查询里
//   两个数同源同时刻，相加不会出现「两个时刻凑出来的总数」）。
export const COUNTS_QUERY = `query($owner:String!,$name:String!){
  rateLimit{ cost }
  repository(owner:$owner,name:$name){
    openIssues: issues(states:[OPEN]){ totalCount }
    closedIssues: issues(states:[CLOSED]){ totalCount }
  }
}`

// 同上，多了「必须同时带上这些标签」这一层筛（GraphQL 的 filterBy.labels 是 AND 语义）。
export const COUNTS_QUERY_WITH_LABELS = `query($owner:String!,$name:String!,$labels:[String!]!){
  rateLimit{ cost }
  repository(owner:$owner,name:$name){
    openIssues: issues(states:[OPEN], filterBy:{labels:$labels}){ totalCount }
    closedIssues: issues(states:[CLOSED], filterBy:{labels:$labels}){ totalCount }
  }
}`

// 按页取票的薄片段（#690 的 listPage 那条操作用）：只抓「画成列表里一行」用得上的字段。
// 字段清单的出处是研究底稿 research/677-field-consumption.md 第 6 节：A 组「画像素直接用」9 项、
//   B 组「列表这条流水线要用」6 项，再减去后端自己就能推出来的三样（key 由 number 来、effortId 在
//   GitHub 上恒为空串、type 由 wayfair:map 标签推）与不需要向 GitHub 要的 number 之外的身份。
// 不带 body 与 comments：真机上整份快照 11.8 MB 里 body 2.94 MB、comments 1.80 MB（规格第 14 节实测），
//   而画一行一个字都用不到它们 —— 点开单票详情时另有它自己那一次取数。
// 不带 reviews / parent / milestone / reason / closedAt：底稿第 6.2 节列的「今天确定没有任何客户端
//   读者」清单里有它们（milestone 与 reason 只有检查页那张诊断卡「数在不在」这一种读者）。
// 不带 blockedBy：页数据目前只用来装**已关闭**的票，而「被阻塞」小标只对未关闭票有意义
//   （store-derived.js 的 applyStandaloneBlocks 本来就是跳过已关闭行）。哪天页数据要装未关闭票，这里一起改。
export const PAGE_ISSUE_FRAGMENT = [
  'number',
  'title',
  'state',
  'url',
  'createdAt',
  'updatedAt',
  'author{login avatarUrl __typename ... on User{name} ... on Organization{name}}',
  'assignees(first:20){nodes{login}}',
  'labels(first:50){nodes{name color}}',
].join(' ')

// 按页取票查询（#690 的 listPage 那条操作）。三条硬约束写死在查询里：
//   排序键固定「创建时间倒序」—— 翻页期间别的票被更新时，按更新时间排序会让票在页与页之间挪位置、
//   可能漏掉一张；创建时间写下来就不动（契约 contract-page.js 的「分页契约」）。
//   states 由调用方给，且必有值：已关闭票按需翻页走的就是 states:[CLOSED]。
//   totalCount 与 nodes 取自同一个连接，天然同时刻，供界面写「已加载 x / 共 N」。
// 带标签筛的这一版单独一份查询：filterBy 只在真有标签要筛时才出现 —— 空数组是「不筛」还是「全都要有」
//   在各版本上行为不一致，没有把握，所以不让它出现（与上面两条计数查询同一处置）。
// since（#1418）：刷新后台的增量索引窗口，服务端只回「更新时间不早于它」的票。变量可空——
// 不给（null）时与没有这一格之前完全一样；给了就少翻十几页，探测每拍的额度从「全仓」降到「窗口」。
export const LIST_PAGE_QUERY = `query($owner:String!,$name:String!,$first:Int!,$after:String,$states:[IssueState!]!,$since:DateTime){
  rateLimit{ cost }
  repository(owner:$owner,name:$name){
    issues(first:$first, after:$after, states:$states, orderBy:{field:CREATED_AT, direction:DESC}, filterBy:{since:$since}){
      totalCount
      nodes{ ${PAGE_ISSUE_FRAGMENT} }
      pageInfo{ hasNextPage endCursor }
    }
  }
}`

// 同上，多了「必须同时带上这些标签」这一层筛（GraphQL 的 filterBy.labels 是 AND 语义）。
export const LIST_PAGE_QUERY_WITH_LABELS = `query($owner:String!,$name:String!,$first:Int!,$after:String,$states:[IssueState!]!,$labels:[String!]!,$since:DateTime){
  rateLimit{ cost }
  repository(owner:$owner,name:$name){
    issues(first:$first, after:$after, states:$states, orderBy:{field:CREATED_AT, direction:DESC}, filterBy:{labels:$labels, since:$since}){
      totalCount
      nodes{ ${PAGE_ISSUE_FRAGMENT} }
      pageInfo{ hasNextPage endCursor }
    }
  }
}`

// 地图子票用的片段（#691 阶段 3）：画一行要的字段，外加正文。
// 与 ISSUE_FRAGMENT 的两处差别都是省额度、不是省信息：
//  - 不带 `comments`：地图详情与列表都只画一行，评论只在用户点开单票详情时按需取；
//  - 不带 `milestone`：画一行用不到它。
// `body` 必须带上 —— 子票的「进度」写在正文里的 `## 进度：N%`，由宿主解析成数字后把正文剥掉，
// 正文本身不随行数据发给界面（见 src/host/mapTickets.js）。
export const SUB_ISSUE_FRAGMENT = [
  'number', // 只作 key 的来源，不外泄成 Issue.number（与 ISSUE_FRAGMENT 同口径）
  'title',
  'state',
  'body',
  'url',
  'createdAt',
  'updatedAt',
  'closedAt',
  'author{login avatarUrl __typename ... on User{name} ... on Organization{name}}',
  'assignees(first:50){nodes{login name avatarUrl __typename}}',
  'labels(first:50){nodes{name color description}}',
  'parent{number}',
  'blockedBy(first:50){nodes{number title state}}',
].join(' ')

// 一张地图的全部子票（#691 阶段 3）。与列表那条路的关键差别：
//   列表（LIST_QUERY）取整个仓库的票，带 500 条安全上限 —— 子票超过 100 张的地图会被它截断；
//   这条查询从「父票 → 子票」的原生关系往下取，按页翻到底，不受那个上限影响。
//   连接上的 totalCount 用来核对「拉到的张数 == 总数」，对不上就把差额报出来，不许静默少几条。
// 代价是每 100 张一页，所以只在用户真的打开一张地图时才跑（唯一调用者：宿主电话 wf.mapTickets）。
export const SUB_ISSUES_QUERY = `query($owner:String!,$name:String!,$number:Int!,$first:Int!,$after:String){
  rateLimit{ cost }
  repository(owner:$owner,name:$name){
    issue(number:$number){
      number
      subIssues(first:$first, after:$after){
        totalCount
        nodes{ ${SUB_ISSUE_FRAGMENT} }
        pageInfo{ hasNextPage endCursor }
      }
    }
  }
}`

// 拉取请求片段（#504 落 #294 形状 A：只取契约三字段所需来源 + 复用工单核心字段）。
// 真仓结论（2026-09-06，真仓 FeatherHunter/dsh-mattpocock-skills-deck，用 gh 直查，令牌与地址已脱敏）：
// 工单口 /issues 全量 403 条（含拉取请求条目），拉取请求口 /pulls 全量 7 条；
// GraphQL pullRequests 前 5 条直出 mergedAt 与 reviews.nodes{state author{login} submittedAt}，
// body/url/createdAt 等核心字段与工单同名可用；REST 侧 /pulls 给 merged_at、/reviews 给评审。
// 另做一次合成降级只看日志链：强制 GraphQL 失败一次，依次落 graphql.fallback（scope=地图）
// 与 issues.fallback（from=graphql to=rest）与 fallback.chain（含 latencyMs），只记通道名与原因枚举，
// 不记令牌原文与仓库地址原文（地址只记散列，令牌只记有无，见 client.js 脱敏口径）。
// 取舍（列表评审与评论条数，为什么是 20 对 50）：
// 列表走 REST 时评审恒为空数组，因为列表只拉 /issues 与 /pulls 两页，不逐票拉 /reviews（省配额，见 pulls.js）；
// 列表走 GraphQL 时评审与评论各给 20 条（reviews first:20，comments first:20），工单评论给 50 条是历史配额，
// 拉取请求列表取 20 条是省配额的取舍：#506 前端房只做展示，不依赖明细条数，点开单票才拉真值（单票走 GET_PR_QUERY 或 /reviews 全量）。
// 缺边说明（首版不支持 parent 与 blockedBy，原因已用真仓探针确认）：
// 2026-09-06 用 gh 查 pullRequest(number:493){parent{number}} 与 blockedBy 边，
// 两次都返回 Field doesn't exist on type PullRequest（树边只有工单类型有，阻塞边是本仓任务扩展，
// GitHub 拉取请求类型原生没有这两条边），硬加进片段会导致整页查询失败，所以首版不取；
// 归一侧对缺来源给空值（parentKey 给 null，blockedBy 给空数组），REST 侧同口径只补合并时间不补树边；
// milestone 经同日验证在拉取请求类型可用（pullRequests 前 2 条带 milestone{title state} 正常返回），
// 所以本片段补上 milestone，与工单同形状，缺内容时归一给省略。
export const PULL_REQUEST_FRAGMENT = [
  'number',
  'title',
  'state',
  'body',
  'url',
  'createdAt',
  'updatedAt',
  'closedAt',
  'mergedAt',
  'author{login avatarUrl __typename ... on User{name} ... on Organization{name}}',
  'assignees(first:50){nodes{login name avatarUrl __typename}}',
  'labels(first:50){nodes{name color description}}',
  'milestone{title description state dueOn}',
  'comments(first:20){nodes{id author{login avatarUrl __typename ... on User{name} ... on Organization{name}} authorAssociation body createdAt updatedAt lastEditedAt}}',
  'reviews(first:20){nodes{state author{login} submittedAt}}',
].join(' ')

// 拉取请求列表查询（与 LIST_QUERY 同构：分页取，按更新时间倒序）
// #599：`states` 必须含 MERGED。GitHub 的拉取请求有三种状态（OPEN / CLOSED / MERGED），
//   不是两种；只写 OPEN 与 CLOSED 时，已合并的会被 GitHub 整批排除，
//   面板上表现为「本仓 10 条 PR 只出现 5 条」（2026-09-11 真仓查证：写两种回来 5 条，写三种回来 10 条）。
//   取回来之后归一与显示的口径见 normalize.js 的 normalizeIssue 与 views/shared/stateKind.js。
export const LIST_PR_QUERY = `query($owner:String!,$name:String!,$first:Int!,$after:String){
  rateLimit{ cost }
  repository(owner:$owner,name:$name){
    pullRequests(first:$first, after:$after, states:[OPEN,CLOSED,MERGED], orderBy:{field:UPDATED_AT, direction:DESC}){
      nodes{ ${PULL_REQUEST_FRAGMENT} }
      pageInfo{ hasNextPage endCursor }
    }
  }
}`

// 拉取请求单票查询（get 按号先查 issue、再查此查询，见 issues.js）
export const GET_PR_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  rateLimit{ cost }
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){ ${PULL_REQUEST_FRAGMENT} }
  }
}`

// ── 阻塞边写入用的 statements（2026-10-20）：写边优先走 GraphQL mutation ──
//
// 为什么不用 REST 依赖接口当主路：
//   一、加/删阻塞边本来就是 GitHub GraphQL 的原生 mutation（addBlockedBy / removeBlockedBy），
//       入参是两张票的 node id（全局 ID，字符串），一次往返写一条；
//   二、REST 依赖接口与 GraphQL 分属两套配额账：REST 配额耗尽时 GraphQL 往往还能写。
//       写边是用户显式动作，不该因为读把 REST 配额吃光而写不下去；
//   三、REST 那条路要先用「查数据库编号」再 POST/DELETE，一次写边至少三次往返；
//       GraphQL 这边「一次批量取 id + 每条边一次 mutation」就够了。
// REST 依赖接口保留为兜底：GHES 老版本没有这两个 mutation 字段时仍走老路（见 blocked-by-write.ts）。
//
// 回包只要 clientMutationId：两种 payload 上都有这一格，不拉整个 Issue，
// 既省额度，也不会因为 Issue 字段改名连坐。
export const ADD_BLOCKED_BY_MUTATION = `mutation($issueId:ID!,$blockingIssueId:ID!){
  addBlockedBy(input:{issueId:$issueId, blockingIssueId:$blockingIssueId}){ clientMutationId }
}`

export const REMOVE_BLOCKED_BY_MUTATION = `mutation($issueId:ID!,$blockingIssueId:ID!){
  removeBlockedBy(input:{issueId:$issueId, blockingIssueId:$blockingIssueId}){ clientMutationId }
}`

/**
 * 一次查询取齐一组票的 node id（GraphQL 全局 ID）。
 *
 * 为什么用别名批量：写一条阻塞边要两张票的 id；逐票各查一次就是 N 次进程、N 点额度，
 * 而别名把 N 张票并进一次查询（额度按一次查询算，2026-10-20 真仓实测）。
 * 只接纯数字票号：非数字塞进 GraphQL 的 Int 位置会让整条查询报错，
 * 调用方据此回落 REST 更诚实（REST 那条路对怪票号本来就回 not-found）。
 */
export function issueNodeIdsQuery(keys: string[]): string {
  const parts: string[] = []
  for (let i = 0; i < keys.length; i++) parts.push('i' + i + ': issue(number:' + String(Number(keys[i])) + '){ id }')
  return 'query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ ' + parts.join(' ') + ' } }'
}

// 兼容旧命名（#132 登记旧片段迁移）：保留但指向新 fragment
export const GITHUB_ISSUE_FIELDS = ISSUE_FRAGMENT
export default { ISSUE_FRAGMENT, GITHUB_ISSUE_FIELDS, LIST_QUERY, GET_QUERY, getIssueQuery, COUNTS_QUERY, COUNTS_QUERY_WITH_LABELS, PULL_REQUEST_FRAGMENT, LIST_PR_QUERY, GET_PR_QUERY, ADD_BLOCKED_BY_MUTATION, REMOVE_BLOCKED_BY_MUTATION, issueNodeIdsQuery }
