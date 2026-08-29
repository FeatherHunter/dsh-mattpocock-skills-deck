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

// 兼容旧命名（#132 登记旧片段迁移）：保留但指向新 fragment
export const GITHUB_ISSUE_FIELDS = ISSUE_FRAGMENT
export default { ISSUE_FRAGMENT, GITHUB_ISSUE_FIELDS, LIST_QUERY, GET_QUERY }
