/**
 * src/tracker/rooms/gitea/issues/sub-issues.ts —— gitea 房的子票清单读（契约 listSubIssues）。
 *
 * Gitea 没有原生父子结构：父子关系写在票正文标记里（票 #3 的口径，归一层已解析成
 * parentKey）。所以「某张地图的子票」没有一条专用命令可查——只能翻页扫整仓，逐张
 * 归一后按 parentKey === mapKey 挑出来。这是 gitea 房读侧最贵的一条操作，页数与条数
 * 都封顶（共享分页表 subIssuesPageSize / subIssuesMax）。
 *
 * 契约口径：capped 时如实置位并停；单张读不成计入 dropped——dropped>0 且一张没捞到
 * 时整条失败（只报错不给半份清单）；读成但捞到零条是合法结果（空地图）。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { RepositoryRef } from '../../../contract/entities.js'
import type { Issue } from '../../../contract/entities.js'
import type { OpResult, SubIssueList, SubIssueListResult } from '../../../contract/results.js'
import { PAGINATION } from '../../../contract/pagination.js'
import { fail } from '../../../kernel/preflight.js'
import { failGitea } from '../errors.js'
import { normalizeIssue } from '../model/normalize.js'
import { type CtxLike, argsIssueListPage, errMsg, parseReadRows, readListCommandLabel, refIdOf, runRead } from '../support/tea-run.js'
// 读降级的登记出口在 support/read-log.ts 一处（op / reason 只取登记清单里的值，票 #14）。
import { emitReadDegraded } from '../support/read-log.js'

/**
 * 列某张地图下的子票（契约 listSubIssues）：翻页扫仓 + parentKey 匹配。
 *
 * @param repo 目标仓库（只取 refId）
 * @param mapKey 地图的票号（字符串）
 * @param opts 契约未给这条操作留选项，收 Record<string, never>
 * @param ctx 调用上下文（opCtx 缺时顶上）
 */
export async function listSubIssues(
  repo: Partial<RepositoryRef> | null | undefined,
  mapKey: unknown,
  opts: Record<string, never> | null | undefined,
  ctx: OpContext | null | undefined,
  opCtx?: BackendContext,
): Promise<SubIssueListResult> {
  void opts
  const effective = (opCtx || ctx) as CtxLike | undefined
  const startedAt = Date.now()
  const refId = refIdOf(repo)
  const key = typeof mapKey === 'string' || typeof mapKey === 'number' ? String(mapKey).trim() : ''
  if (!refId || !key) {
    // 票号或仓库缺一：这张地图根本定位不了，按「查无此物」归档。
    return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'listSubIssues: 仓库引用或地图票号缺失，无法定位这张地图', '')
  }
  const perPage = PAGINATION.gitea.subIssuesPageSize
  const max = PAGINATION.gitea.subIssuesMax
  const items: Issue[] = []
  let fetched = 0
  let dropped = 0
  let capped = false
  try {
    for (let page = 1; !capped; page += 1) {
      // 扫仓显式要 all：子票开着关着都算子票（与地图清单同一口径）。
      const res = await runRead(effective, argsIssueListPage(refId, 'all', [], perPage, page))
      if (res.code !== 0) {
        return failGitea(new Error(res.stderr || res.stdout || `listSubIssues: ${readListCommandLabel()} 失败`), `列子票失败：${readListCommandLabel()} 没有跑成。请稍后重试。`, res, effective)
      }
      const text = typeof res.stdout === 'string' ? res.stdout : ''
      const rows = parseReadRows(text)
      // 原文 = 远端回的那一段。
      if (!rows) return fail(ERROR_KIND.PARSE as ErrorKind, 'listSubIssues: tea 回包不是插件预期的数组形状', text)
      for (let i = 0; i < rows.length; i += 1) {
        const raw = rows[i] as Record<string, unknown> | null
        if (!raw || typeof raw !== 'object') {
          // 连编号都没有的行没法在结果里交代：计入 dropped（contract 点名的口径）。
          dropped += 1
          continue
        }
        let issue
        try {
          issue = normalizeIssue(raw)
        } catch (err: unknown) {
          // 单张归一失败不拦整趟：记 dropped，继续扫。
          void err
          dropped += 1
          continue
        }
        fetched += 1
        if (issue.parentKey === key) {
          if (items.length >= max) {
            capped = true
            break
          }
          items.push(issue)
        }
      }
      // 短页即最后一页；或本页命中满上限也停。
      if (rows.length < perPage || capped) break
      if (items.length >= max) capped = true
    }
  } catch (err: unknown) {
    return failGitea(err, errMsg(err), err, effective)
  }
  // 捞到零条但有读不成的行：整体失败，不给一份「看起来完整其实是缺的」清单。
  if (dropped > 0 && items.length === 0) {
    return fail(ERROR_KIND.PARSE as ErrorKind, 'listSubIssues: 扫描中有 ' + String(dropped) + ' 张票读不成，无法确认子票清单是完整的', '')
  }
  if (capped) {
    // 登记清单里的取值（票 #14 收编）：撞 subIssuesMax 硬上限，按「截断」如实交代。
    emitReadDegraded(effective, 'listSubIssues', 'listSubIssues:truncated', Date.now() - startedAt)
  }
  const data: SubIssueList = { items, total: fetched, fetched, capped, missing: 0, dropped }
  return { ok: true, data }
}
