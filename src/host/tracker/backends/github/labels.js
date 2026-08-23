/**
 * backends/github/labels.js — label 操作（list/create）。
 *
 * ⌈ 骨架占位 ⌉ #114 实现：`gh label list` / `gh issue edit --add-label`。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

const PENDING = () => fail(ERROR_KIND.UNSUPPORTED, 'github labels pending #114')

export const listLabels = (ctx, repo) => PENDING()
export const addLabel = (ctx, repo, key, labels) => PENDING()
export default { listLabels, addLabel }
