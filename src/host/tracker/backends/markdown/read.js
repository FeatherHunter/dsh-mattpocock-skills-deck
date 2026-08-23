/**
 * backends/markdown/read.js — 读 `.scratch/` 文件（经 platform/fs）。
 *
 * ⌈ 骨架占位 ⌉ #115 实现：用 platform/fs 读取 spec.md/map.md/issues/<NN>-<slug>.md。
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'

export async function readFile(ctx, path) {
  void ctx; void path
  return fail(ERROR_KIND.UNSUPPORTED, 'markdown read pending #115')
}
export default readFile
