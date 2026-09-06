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
export const LIST_PR_QUERY = `query($owner:String!,$name:String!,$first:Int!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequests(first:$first, after:$after, states:[OPEN,CLOSED], orderBy:{field:UPDATED_AT, direction:DESC}){
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
export default { ISSUE_FRAGMENT, GITHUB_ISSUE_FIELDS, LIST_QUERY, GET_QUERY, PULL_REQUEST_FRAGMENT, LIST_PR_QUERY, GET_PR_QUERY }
