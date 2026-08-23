/**
 * backends/gitlab/issues.js — issue 操作（list/get/create/close）。
 *
 * ⌈ 骨架占位 ⌉ #116 实现：`glab issue list/view/create/close`。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

const PENDING = () => fail(ERROR_KIND.UNSUPPORTED, 'gitlab issues pending #116')

export const listIssues = (ctx, repo, opts) => PENDING()
export const getIssue = (ctx, repo, key) => PENDING()
export const createIssue = (ctx, repo, input) => PENDING()
export const closeIssue = (ctx, repo, key) => PENDING()
export default { listIssues, getIssue, createIssue, closeIssue }
