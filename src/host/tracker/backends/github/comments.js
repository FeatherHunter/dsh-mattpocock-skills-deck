/**
 * backends/github/comments.js — comment 操作（list/create）。
 *
 * ⌈ 骨架占位 ⌉ #114 实现：`gh api repos/.../issues/<n>/comments` + `gh issue comment`。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

const PENDING = () => fail(ERROR_KIND.UNSUPPORTED, 'github comments pending #114')

export const listComments = (ctx, repo, key) => PENDING()
export const addComment = (ctx, repo, key, body) => PENDING()
export default { listComments, addComment }
