/**
 * backends/markdown/graph.js — 图关系（blockedBy）。
 *
 * ⌈ 骨架占位 ⌉ #115 实现：读 `Blocked by:` 行内字段 → IssueRef[]；父子靠 `.scratch/<effort>/` 目录层级。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

const PENDING = () => fail(ERROR_KIND.UNSUPPORTED, 'markdown graph pending #115')

export const readBlockedBy = (ctx, repo, childKey) => PENDING()
export default { readBlockedBy }
