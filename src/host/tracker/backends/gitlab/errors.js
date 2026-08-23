/**
 * backends/gitlab/errors.js — glab/API 错误 → 契约 ERROR_KIND。
 *
 * ⌈ 骨架占位 ⌉ #116 实现；目前复用通用 classifyError。
 */

import { classifyError } from '../../preflight.js'

export function classifyGlabError(err) {
  return classifyError(err)
}
export default classifyGlabError
