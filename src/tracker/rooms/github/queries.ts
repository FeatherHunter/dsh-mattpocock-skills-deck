/**
 * backends/github/queries.js — GraphQL 查询/片段。
 *
 * 定版依据：#127（单 key/无 subIssues）+#126（Label {name,color,description?}）+#137（queries 差距清单）+#138 一页纸方案
 *
 * 不变量：
 *  - `number` 仅作 `key=String(number)` 的来源，不作为契约字段产出（harness 断言 no number）。
 *  - `subIssues` 不进入 Issue 形状，仅用于 `parentKey` 反查校验（已删 Issue.subIssues），但查询仍保留 parent 边。
 *  - `labels` 抓 `name color description` 全量（color 无则 ''，description 可空 → shape 归一）。
 *  - 能力字段来源全覆盖：author/assignees/milestone/comments/parent/blockedBy。
 */

// 单票必需字段（core + 能力字段来源）。`number` 作 keySource 注释明确不外泄。
export const ISSUE_FRAGMENT = [
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
  'comments(first:50){nodes{id author{login avatarUrl __typename ... on User{name} ... on Organization{name}} authorAssociation body createdAt updatedAt lastEditedAt}}',
  'parent{number}',
  'blockedBy(first:50){nodes{number title state}}',
].join(' ')

// GraphQL list 查询（批量取；filter 在内存完成）
export const LIST_QUERY = `query($owner:String!,$name:String!,$first:Int!,$after:String){
  repository(owner:$owner,name:$name){
    issues(first:$first, after:$after, states:[OPEN,CLOSED], orderBy:{field:UPDATED_AT, direction:DESC}){
      nodes{ ${ISSUE_FRAGMENT} }
      pageInfo{ hasNextPage endCursor }
    }
  }
}`

// 单票查询
export const GET_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    issue(number:$number){ ${ISSUE_FRAGMENT} }
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
  repository(owner:$owner,name:$name){
    openIssues: issues(states:[OPEN]){ totalCount }
    closedIssues: issues(states:[CLOSED]){ totalCount }
  }
}`

// 同上，多了「必须同时带上这些标签」这一层筛（GraphQL 的 filterBy.labels 是 AND 语义）。
export const COUNTS_QUERY_WITH_LABELS = `query($owner:String!,$name:String!,$labels:[String!]!){
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
export const LIST_PAGE_QUERY = `query($owner:String!,$name:String!,$first:Int!,$after:String,$states:[IssueState!]!){
  repository(owner:$owner,name:$name){
    issues(first:$first, after:$after, states:$states, orderBy:{field:CREATED_AT, direction:DESC}){
      totalCount
      nodes{ ${PAGE_ISSUE_FRAGMENT} }
      pageInfo{ hasNextPage endCursor }
    }
  }
}`

// 同上，多了「必须同时带上这些标签」这一层筛（GraphQL 的 filterBy.labels 是 AND 语义）。
export const LIST_PAGE_QUERY_WITH_LABELS = `query($owner:String!,$name:String!,$first:Int!,$after:String,$states:[IssueState!]!,$labels:[String!]!){
  repository(owner:$owner,name:$name){
    issues(first:$first, after:$after, states:$states, orderBy:{field:CREATED_AT, direction:DESC}, filterBy:{labels:$labels}){
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
  repository(owner:$owner,name:$name){
    pullRequests(first:$first, after:$after, states:[OPEN,CLOSED,MERGED], orderBy:{field:UPDATED_AT, direction:DESC}){
      nodes{ ${PULL_REQUEST_FRAGMENT} }
      pageInfo{ hasNextPage endCursor }
    }
  }
}`

// 拉取请求单票查询（get 按号先查 issue、再查此查询，见 issues.js）
export const GET_PR_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){ ${PULL_REQUEST_FRAGMENT} }
  }
}`

// 兼容旧命名（#132 登记旧片段迁移）：保留但指向新 fragment
export const GITHUB_ISSUE_FIELDS = ISSUE_FRAGMENT
export default { ISSUE_FRAGMENT, GITHUB_ISSUE_FIELDS, LIST_QUERY, GET_QUERY, COUNTS_QUERY, COUNTS_QUERY_WITH_LABELS, PULL_REQUEST_FRAGMENT, LIST_PR_QUERY, GET_PR_QUERY }
