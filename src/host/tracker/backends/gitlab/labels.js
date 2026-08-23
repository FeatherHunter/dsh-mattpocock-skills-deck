/**
 * backends/gitlab/labels.js — label 操作。
 *
 * ⌈ 骨架占位 ⌉ #116 实现：`glab label list` / 给 issue 打标签。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

const PENDING = () => fail(ERROR_KIND.UNSUPPORTED, 'gitlab labels pending #116')

export const listLabels = (ctx, repo) => PENDING()
export const addLabel = (ctx, repo, key, labels) => PENDING()
export default { listLabels, addLabel }
