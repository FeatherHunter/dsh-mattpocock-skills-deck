/**
 * backends/markdown/issues.js — issue 操作（list/get/create/close）。
 *
 * ⌈ 骨架占位 ⌉ #115 实现：枚举/读取 `.scratch/<slug>/issues/` 目录、create 新票、close 写 Status。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

const PENDING = () => fail(ERROR_KIND.UNSUPPORTED, 'markdown issues pending #115')

export const listIssues = (ctx, repo, opts) => PENDING()
export const getIssue = (ctx, repo, key) => PENDING()
export const createIssue = (ctx, repo, input) => PENDING()
export const closeIssue = (ctx, repo, key) => PENDING()
export default { listIssues, getIssue, createIssue, closeIssue }
