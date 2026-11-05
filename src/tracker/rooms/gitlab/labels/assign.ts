/**
 * src/tracker/rooms/gitlab/labels/assign.ts —— 给一张票整集替换标签（契约操作 setLabels）。
 *
 * 为什么住在 labels/ 子树（#1916）：标签是一个概念，赋值、清单、配色三条操作都落在这个目录里。
 * 搬进子树之前这条路在房间根目录的 labels.ts；搬完根目录不再留标签实现。
 *
 * 契约：`setLabels(repo, key, labels: LabelInput[], opts?: SetOpts, ctx: OpContext): Promise<OpResult<Issue>>`
 *  - LabelInput = string | {name,color?,description?}
 *  - SetOpts = { expectedUpdatedAt?:string } → 不匹配 → kind:'conflict'
 *  - GitLab: PUT /projects/:id/issues/:iid {labels: names}（整集替换，逗号分隔）
 *  - 颜色由项目色板决定，不由调用方持久化；读侧的颜色来自仓库标签清单（见 list.ts 的 listLabels）
 *
 * 请求形状不在这里：先按 expectedUpdatedAt 读一次票、再写标签，分别走房间根目录 requests.ts 的
 * requestIssueGet 与 requestLabelAssign。本文件只做请求前后属于操作上下文的事：判仓库与票号、
 * expectedUpdatedAt 的前置读与比对、回包归一、失败判档与话术。行为与搬进子树之前逐字一致，
 * 包括失败话术、conflict 时交给用户的原文、以及 GITLAB_READ_TIMEOUT_MS 这一档超时。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { Issue, Label, RepositoryRef } from '../../../contract/entities.js'
import type { LabelInput, SetOpts } from '../../../contract/inputs.js'
import { TRACKER_ERROR_STAGE, type OpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { normalizeIssue } from '../model/normalize.js'
import { failGlab } from '../errors.js'
// 仓库标识的取法与优先级只在 model/repo-identity.ts 一处（#1910）。
import { repoRefId } from '../model/repo-identity.js'
// 请求的形状住在房间根目录的 requests.ts（#1916）：读票前置与写标签各一个具名函数。
import { requestIssueGet, requestLabelAssign } from '../requests.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml；请求函数收领域值 timeoutMs，档位由这里按操作选。
import { GITLAB_READ_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'

// 仓库身份只取 refId/name，是因为标签读写只认这两样，拿全量会把 effortId 搅进来。
type RepoLike = Partial<RepositoryRef> | null | undefined
// 上下文两形都收，是因为调用方有时把执行器放在 ctx、有时放在 opCtx，缺了就让请求函数里的 glabClient 按 127 回。
type CtxLike = Partial<OpContext> & Partial<BackendContext>

function normalizeLabelInput(li: unknown): Label | null {
  if (typeof li === 'string') {
    const name = li.trim()
    if (!name) return null
    return { name, color: '' }
  }
  if (!li || typeof li !== 'object') return null
  const bag = li as Record<string, unknown>
  const name = typeof bag['name'] === 'string' ? String(bag['name']).trim() : ''
  if (!name) return null
  const color = typeof bag['color'] === 'string' ? String(bag['color']) : ''
  const out: Label = { name, color }
  if (typeof bag['description'] === 'string' && String(bag['description']).trim() !== '') {
    out.description = String(bag['description'])
  }
  return out
}

function normalizeLabelInputs(labels: unknown): Label[] {
  if (!Array.isArray(labels)) return []
  const out: Label[] = []
  const seen = new Set<string>()
  for (const li of labels as unknown[]) {
    const l = normalizeLabelInput(li)
    if (!l) continue
    if (seen.has(l.name)) continue
    seen.add(l.name)
    out.push(l)
  }
  return out
}

function errMsg(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'message' in (err as Record<string, unknown>)) {
    const m = (err as Record<string, unknown>)['message']
    if (typeof m === 'string' && m) return m
  }
  return String(err)
}

/**
 * 整集替换一张票的标签：先按 expectedUpdatedAt 做前置读，再 PUT labels，归一后把调用方要的形状补回去。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param key 票号（iid 字符串）
 * @param labels 要换成的整集（裸串与对象两形都收，重名去重）
 * @param opts 乐观并发选项（对不上就回 conflict，不写）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function setLabels(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  labels: LabelInput[],
  opts: SetOpts | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoRefId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'setLabels: repo.refId missing', '')
  const k = String(key)
  if (!k) return fail(ERROR_KIND.PARSE as ErrorKind, 'setLabels: key required', '', TRACKER_ERROR_STAGE.INPUT_REFUSED)
  const wanted = normalizeLabelInputs(labels)

  try {
    // If-Match 前置：expectedUpdatedAt
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const res = await requestIssueGet(effective, id, k, GITLAB_READ_TIMEOUT_MS)
      if (res.code !== 0) {
        // 原文 = 改色前置那一次 GET 的进程结果；判档走同一趟归一（带上下文，日志里留得下轨迹）。
        return failGlab(res, res.stderr || res.stdout || 'setLabels preflight get failed', res, effective)
      }
      let cur: unknown = null
      try {
        cur = JSON.parse(res.stdout) as unknown
      } catch {
        cur = null
      }
      const cb = cur !== null && typeof cur === 'object' ? (cur as Record<string, unknown>) : null
      const curUpdated =
        (cb && typeof cb['updated_at'] === 'string'
          ? String(cb['updated_at'])
          : cb && typeof cb['updatedAt'] === 'string'
            ? String(cb['updatedAt'])
            : '') || ''
      if (curUpdated !== opts.expectedUpdatedAt) {
        // 原文 = 回读到的票面（人据此自己核对「远端现在是什么版本」），不是给人看的那句冲突话。
        return fail(ERROR_KIND.CONFLICT as ErrorKind, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${curUpdated})`, res.stdout)
      }
    }

    const labelNames = wanted.map((l) => l.name).join(',')
    // PUT labels（空串→清空）
    const res = await requestLabelAssign(effective, id, k, labelNames, GITLAB_READ_TIMEOUT_MS)
    if (res.code !== 0) {
      // 原文 = 写标签那一次 PUT 的进程结果。
      return failGlab(res, res.stderr || res.stdout || 'setLabels failed', res, effective)
    }
    let raw: unknown = null
    try {
      raw = JSON.parse(res.stdout) as unknown
    } catch {
      raw = null
    }
    if (!raw || typeof raw !== 'object') raw = { iid: k, labels: wanted.map((l) => l.name) }
    // 确保归一后 labels 为 wanted（带 color 兜底）
    const issue = normalizeIssue(raw)
    issue.labels = wanted
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身。kind 为 conflict 时 classifyGlabError 走透传，
    // 本家那句话原样留着（不换成通用提示）。
    return failGlab(err, errMsg(err), err, effective)
  }
}

export default { setLabels }
