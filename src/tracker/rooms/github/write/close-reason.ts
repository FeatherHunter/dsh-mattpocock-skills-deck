/**
 * src/tracker/rooms/github/write/close-reason.ts —— 关票原因怎么交给 GitHub 后端（#1532）。
 * #1687 阶段 1：从房间根迁入 write/，旧路径 src/tracker/rooms/github/close-reason.ts 保留纯转发，行为零变化。
 *
 * gh issue close --reason 只认三个固定值：completed、not planned、duplicate；而契约里的
 * 关闭原因是一段开放文本，调用方经常给的是一句中文原话。原话直接塞进 --reason 必失败，票就关不掉。
 * 所以这里分两条路：固定值（大小写、下划线写法都归一）直通；原话先按原文发一条评论留痕，
 * 再用 completed 关票。评论没发出去就不关票——宁可整次操作失败，也不让票关掉而原因丢了。
 *
 * 为什么单独一个文件：这段判断原来写在 issues-write.ts 里，把那个文件的有效行数推过了
 * 行数门禁的上限（350 行）。搬出来时行为一个字没改，好让这条规则有独立的地方可读、可测；
 * 门禁 tests/verify-1532-github-close-reason.ts 仍然从 closeIssue 这一路验证全部行为。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { OpContext } from '../../../contract/contexts.js'
import type { RepositoryRef } from '../../../contract/entities.js'
import type { CloseOpts } from '../../../contract/inputs.js'
import type { OpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { addComment } from './comments.js'

/**
 * 一条 gh issue close 命令要追加的关闭原因参数，以及要回填到返回票上的原因原话。
 *
 * 两者分开：args 是真正发给 gh 的东西（只能是固定值），raw 是调用方给的原话，
 * 返回票的 reason 字段要保留原话，不能被实际的固定值覆盖（#1532 的第一条验收）。
 */
export interface CloseReasonPlan {
  /** 追加到 gh issue close 后面的参数；没有关闭原因时是空数组。 */
  args: string[]
  /** 调用方给的关闭原因原话（去掉首尾空格）；没给时是空字符串。 */
  raw: string
}

/**
 * 决定这次关票的 --reason 怎么发。
 *
 * 三种结果：没有原因（args 为空）、固定值（归一后直通）、自由文本（先评论留痕，再用 completed 关）。
 * 自由文本那条路一旦评论发不出去，整次关票就返回失败，不继续关——原因不能无声丢掉。
 * 失败时第三段原文交的是评论那一步的失败结果，排查时能直接看到 gh 的原话。
 */
export async function planCloseReason(
  repo: RepositoryRef,
  key: string,
  opts: CloseOpts | undefined,
  ctx: OpContext,
): Promise<OpResult<CloseReasonPlan>> {
  // 契约把 reason 声明为开放字符串（ClosedReason = string），但调用方也可能交 undefined 或非字符串；
  // 非字符串按「没给原因」处理，与 #1532 之前的行为一致。
  const raw = opts && typeof opts.reason === 'string' ? opts.reason.trim() : ''
  const folded = raw.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  let enumReason: string | null = null
  if (folded === 'completed') enumReason = 'completed'
  else if (folded === 'duplicate') enumReason = 'duplicate'
  else if (folded === 'not planned') enumReason = 'not planned'
  if (enumReason) return { ok: true, data: { args: ['--reason', enumReason], raw } }
  if (!raw) return { ok: true, data: { args: [], raw } }
  const cr = await addComment(repo, key, raw, ctx)
  if (!cr.ok) {
    const kind = (cr.error && cr.error.kind) || ERROR_KIND.NETWORK
    const msg = String((cr.error && cr.error.message) || '没给出原因').slice(0, 300)
    return fail(kind, 'close: 关闭原因评论没发出去，这次没关票（原因没地方落，不敢静默丢掉）：' + msg, cr.error)
  }
  return { ok: true, data: { args: ['--reason', 'completed'], raw } }
}
