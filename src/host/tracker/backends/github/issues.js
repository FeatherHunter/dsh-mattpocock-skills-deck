/**
 * backends/github/issues.js — issue 操作（list/get/create/close）。
 *
 * ⌈ 骨架占位 ⌉ #114 实现：`gh issue list` / `gh issue view` / `gh issue create` /
 * `gh issue close --yes`，并归一化成契约形状（normalize.js）。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

const PENDING = () => fail(ERROR_KIND.UNSUPPORTED, 'github issues pending #114')

export const listIssues = (ctx, repo, opts) => PENDING()
export const getIssue = (ctx, repo, key) => PENDING()
export const createIssue = (ctx, repo, input) => PENDING()
export const closeIssue = (ctx, repo, key) => PENDING()
export default { listIssues, getIssue, createIssue, closeIssue }
