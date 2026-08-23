/**
 * backends/github/queries.js — GraphQL 查询/片段。
 *
 * ⌈ 骨架占位 ⌉ #114 实现：把现有 src/host/index.js 的 QUERY / frag 迁移到这里，
 * 收拢 subIssues/labels/assignees/comments/blockedBy/blocking 字段选择。
 */

/** 单票查询片段（#114 据此移植现有 QUERY/frag，并补 full 字段集）。 */
export const ISSUE_FRAGMENT = 'number title state body url labels(first:20){nodes{name color}} assignees(first:10){nodes{login}} blockedBy(first:20){nodes{number title state}}'
export default { ISSUE_FRAGMENT }
