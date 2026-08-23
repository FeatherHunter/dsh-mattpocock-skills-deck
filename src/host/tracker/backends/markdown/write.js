/**
 * backends/markdown/write.js — 写 `.scratch/` 文件（经 platform/fs，写受沙箱栅栏）。
 *
 * ⌈ 骨架占位 ⌉ #115 实现：创建/更新票文件与 map。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

export async function writeFile(ctx, path, content) {
  void ctx; void path; void content
  return fail(ERROR_KIND.UNSUPPORTED, 'markdown write pending #115')
}
export default writeFile
