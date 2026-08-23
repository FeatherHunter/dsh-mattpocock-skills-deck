/**
 * backends/github/graph.js — 图关系（subIssue / blockedBy / blocking）。
 *
 * ⌈ 骨架占位 ⌉ #114 实现：`gh api .../issues/<n>/sub_issues` + `.../dependencies/blocked_by`，
 * 归一化成 IssueRef[]；原生 blocked_by 用 GitHub 原生依赖。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

const PENDING = () => fail(ERROR_KIND.UNSUPPORTED, 'github graph pending #114')

export const addSubIssue = (ctx, repo, parentKey, childKey) => PENDING()
export const readBlockedBy = (ctx, repo, childKey) => PENDING()
export default { addSubIssue, readBlockedBy }
