/**
 * backends/gitlab/queries.js — GitLab GraphQL/REST 查询。
 *
 * ⌈ 骨架占位 ⌉ #116 实现：`glab api` 查询 issue/labels/comments/依赖。
 */

export const ISSUE_QUERY = 'issues(subgraph { labels { nodes { name color } } assignees { nodes { login } } })'
export default { ISSUE_QUERY }
