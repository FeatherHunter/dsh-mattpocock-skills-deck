/**
 * backends/markdown/comments.js — comment 操作。
 *
 * ⌈ 骨架占位 ⌉ #115 实现：append `## Comments` 段。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

const PENDING = () => fail(ERROR_KIND.UNSUPPORTED, 'markdown comments pending #115')

export const listComments = (ctx, repo, key) => PENDING()
export const addComment = (ctx, repo, key, body) => PENDING()
export default { listComments, addComment }
