/**
 * backends/gitlab/graph.js — 图关系。
 *
 * ⌈ 骨架占位 ⌉ #116 实现：原生 blocking 仅 Premium/Ultimate，free/CE 回退 `Blocked by:` 行。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

const PENDING = () => fail(ERROR_KIND.UNSUPPORTED, 'gitlab graph pending #116')

export const addSubIssue = (ctx, repo, parentKey, childKey) => PENDING()
export const readBlockedBy = (ctx, repo, childKey) => PENDING()
export default { addSubIssue, readBlockedBy }
