/**
 * backends/gitlab/comments.js — comment 操作。
 *
 * ⌈ 骨架占位 ⌉ #116 实现：`glab issue note` / API 评论。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

const PENDING = () => fail(ERROR_KIND.UNSUPPORTED, 'gitlab comments pending #116')

export const listComments = (ctx, repo, key) => PENDING()
export const addComment = (ctx, repo, key, body) => PENDING()
export default { listComments, addComment }
