/**
 * src/tracker/rooms/gitea/labels/colors.ts —— gitea 房的标签改色（契约 setLabelColors，票 #14）。
 *
 * tea 的改色命令只认标签的数字 id、不认名字，所以这里先照 listLabels 的口径把仓库标签翻页拉一遍
 * 建「名字→id」对照，再逐条发 `tea labels update --id <id> --color <色>`。
 *
 * 契约口径：每一条改动必须恰好落在 applied 或 failed 之一——颜色不合法落 parse、标签不存在落
 * not-found、远端写失败按错误判档落对应档位，都不拦别的条；applied.color 记的是写下去的目标值
 * （归一后的六位小写十六进制），不回读。前置的标签清单拉不全时整条失败——对照表残缺时改色
 * 就是在猜，契约不许猜。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { LabelColorChange, RepositoryRef } from '../../../contract/entities.js'
import type { LabelColorBatchResult, OpResult, TrackerError } from '../../../contract/results.js'
import { PAGINATION } from '../../../contract/pagination.js'
import { fail } from '../../../kernel/preflight.js'
import { failGitea } from '../errors.js'
import { normalizeColor } from '../../../../shared/label-color/src/colors.js'
import { type CtxLike, argsLabelUpdate, argsLabelsPage, errMsg, parseReadRows, refIdOf, runRead, runWrite, writeFailureError, writeFailureTexts } from '../support/tea-run.js'

/**
 * 改一批标签的颜色（契约 setLabelColors）。
 *
 * @param repo 目标仓库（只取 refId）
 * @param changes 逐条改动（名字 + 颜色，颜色收六位十六进制、大小写与井号都容忍）
 * @param ctx 调用上下文（opCtx 缺时顶上）
 */
export async function setLabelColors(
  repo: Partial<RepositoryRef> | null | undefined,
  changes: readonly LabelColorChange[] | null | undefined,
  ctx: OpContext | null | undefined,
  opCtx?: BackendContext,
): Promise<OpResult<LabelColorBatchResult>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const refId = refIdOf(repo)
  if (!refId) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'setLabelColors: repo.refId 缺失，无法向 Gitea 改标签颜色', '')
  if (!Array.isArray(changes)) {
    return fail(ERROR_KIND.PARSE as ErrorKind, 'setLabelColors: changes 必须是数组，收到的不是', '')
  }
  // 前置：翻页拉仓库标签，建「名字→id」对照（判据与 listLabels 同一套：短页即末页、到顶还是满页就失败）。
  const perPage = PAGINATION.gitea.labelListPerPage
  const maxPages = PAGINATION.gitea.labelListMaxPages
  const idByName = new Map<string, unknown>()
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await runRead(effective, argsLabelsPage(refId, perPage, page))
      if (res.code !== 0) {
        // 读失败的收法与 issues/read.ts 同一条：stderr 原话优先，判档交给 failGitea。
        return failGitea(new Error(res.stderr || res.stdout || 'setLabelColors: 读标签命令失败'), '改标签颜色失败：先读仓库标签没读成。请稍后重试。', res, effective)
      }
      const text = typeof res.stdout === 'string' ? res.stdout : ''
      const batch = parseReadRows(text)
      if (!batch) return fail(ERROR_KIND.PARSE as ErrorKind, 'setLabelColors: 读标签时回包不是预期的数组形状', text)
      for (const raw of batch) {
        const bag = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
        const name = bag && typeof bag['name'] === 'string' ? bag['name'] : ''
        if (!name.trim()) {
          return fail(ERROR_KIND.PARSE as ErrorKind, 'setLabelColors: 读标签时有一行缺名字，无法建立名字→id 对照', text)
        }
        idByName.set(name, bag ? bag['id'] : undefined)
      }
      if (batch.length < perPage) break
      if (page === maxPages) {
        return fail(ERROR_KIND.ENV as ErrorKind, 'setLabelColors: 标签数超出一次能取的上限（' + String(maxPages * perPage) + ' 个），无法建立完整对照', '')
      }
    }
  } catch (err: unknown) {
    return failGitea(err, errMsg(err), err, effective)
  }
  // 逐条改：每条恰好落 applied 或 failed 之一。
  const applied: { name: string; color: string }[] = []
  const failed: { name: string; reason: TrackerError }[] = []
  for (const change of changes) {
    const bag = change !== null && typeof change === 'object' ? (change as Record<string, unknown>) : null
    const name = bag && typeof bag['name'] === 'string' ? bag['name'] : ''
    if (!name) {
      failed.push({ name: '', reason: fail(ERROR_KIND.PARSE as ErrorKind, 'setLabelColors: 有一条改动缺名字', JSON.stringify(change) ).error })
      continue
    }
    const color = normalizeColor(bag && typeof bag['color'] === 'string' ? bag['color'] : '')
    if (!color) {
      failed.push({ name, reason: fail(ERROR_KIND.PARSE as ErrorKind, 'setLabelColors: 「' + name + '」的颜色不是六位十六进制，这一条不动', String(bag && bag['color'])).error })
      continue
    }
    if (!idByName.has(name)) {
      failed.push({ name, reason: fail(ERROR_KIND.NOTFOUND as ErrorKind, 'setLabelColors: 仓库里没有叫「' + name + '」的标签', '').error })
      continue
    }
    try {
      const res = await runWrite(effective, argsLabelUpdate(refId, idByName.get(name) as number | string, color))
      if (res.code !== 0) {
        const t = writeFailureTexts('setLabelColors')
        const verdict = failGitea(writeFailureError(res, effective, t.fallback), t.human, res, effective)
        failed.push({ name, reason: verdict.error })
        continue
      }
      applied.push({ name, color })
    } catch (err: unknown) {
      failed.push({ name, reason: failGitea(err, errMsg(err), err, effective).error })
    }
  }
  return { ok: true, data: { applied, failed } }
}
