/**
 * backends/github/errors.js — gh/API 错误 → 契约 ERROR_KIND。
 *
 * ⌈ 骨架占位 ⌉ #114 实现：把 gh exit/stderr / GraphQL errors 归类；
 * 目前复用通用 classifyError。
 */

import { classifyError } from '../../preflight.js'

export function classifyGhError(err) {
  return classifyError(err)
}

export default classifyGhError
