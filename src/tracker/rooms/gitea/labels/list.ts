/**
 * src/tracker/rooms/gitea/labels/list.ts —— gitea 房的标签清单读（契约 listLabels）。
 *
 * 契约口径：标签清单必须取全，取不全整条失败——所以这里翻页拉到底，最多
 * labelListMaxPages 页；翻到顶还是满页就整条失败，不给半份清单。
 *
 * 每条只回契约的 name / color / description 三格：名字必须是非空字符串（不是就整条
 * 失败），颜色过共享的颜色规整（给不了就空串），说明文字非空才带上。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { LabelColor, RepositoryRef } from '../../../contract/entities.js'
import type { LabelListResult, OpResult } from '../../../contract/results.js'
import { PAGINATION } from '../../../contract/pagination.js'
import { fail } from '../../../kernel/preflight.js'
import { failGitea } from '../errors.js'
import { normalizeColor } from '../../../../shared/label-color/src/colors.js'
import { type CtxLike, argsLabelsPage, errMsg, parseReadRows, refIdOf, runRead } from '../support/tea-run.js'

/** 一行原始标签转契约三格：名字必须是非空字符串，否则整条失败（不猜名）。 */
function toLabelColor(raw: unknown): LabelColor | null {
  const bag = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!bag) return null
  const name = bag['name']
  if (typeof name !== 'string' || !name.trim()) return null
  const color = normalizeColor(typeof bag['color'] === 'string' ? bag['color'] : '')
  const out: LabelColor = { name, color: color ?? '' }
  const description = bag['description']
  if (typeof description === 'string' && description.trim()) out['description'] = description
  return out
}

/**
 * 列仓库全部标签（契约 listLabels）：翻页拉全量，取不全整条失败。
 *
 * @param repo 目标仓库（只取 refId）
 * @param ctx 调用上下文（opCtx 缺时顶上）
 */
export async function listLabels(
  repo: Partial<RepositoryRef> | null | undefined,
  ctx: OpContext | null | undefined,
  opCtx?: BackendContext,
): Promise<LabelListResult> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const refId = refIdOf(repo)
  if (!refId) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'listLabels: repo.refId 缺失，无法向 Gitea 列标签', '')
  const perPage = PAGINATION.gitea.labelListPerPage
  const maxPages = PAGINATION.gitea.labelListMaxPages
  const rows: LabelColor[] = []
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await runRead(effective, argsLabelsPage(refId, perPage, page))
      if (res.code !== 0) {
        // 读失败的收法与 issues/read.ts 同一条：stderr 原话优先，判档交给 failGitea。
        return failGitea(new Error(res.stderr || res.stdout || 'listLabels: 列标签命令失败'), '列标签失败：列标签命令没有跑成。请稍后重试。', res, effective)
      }
      const text = typeof res.stdout === 'string' ? res.stdout : ''
      const batch = parseReadRows(text)
      // 原文 = 远端回的那一段。
      if (!batch) return fail(ERROR_KIND.PARSE as ErrorKind, 'listLabels: 回包不是插件预期的数组形状', text)
      for (const raw of batch) {
        const label = toLabelColor(raw)
        if (!label) return fail(ERROR_KIND.PARSE as ErrorKind, 'listLabels: 有一行标签缺名字，无法按契约返回完整清单', text)
        rows.push(label)
      }
      // 短页即最后一页（tea 翻页统一判据）。
      if (batch.length < perPage) break
      // 到顶还是满页：取不全就是取不全，整条失败——契约不许半份清单。
      if (page === maxPages) {
        return fail(ERROR_KIND.ENV as ErrorKind, 'listLabels: 标签数超出一次能取的上限（' + String(maxPages * perPage) + ' 个），无法取全', '')
      }
    }
  } catch (err: unknown) {
    return failGitea(err, errMsg(err), err, effective)
  }
  return { ok: true, data: rows }
}
