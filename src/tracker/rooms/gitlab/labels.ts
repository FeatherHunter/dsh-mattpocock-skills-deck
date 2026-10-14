/**
 * backends/gitlab/labels.ts — label 操作（#135 定版：labels→labels[]恒EMPTY，milestone分流）。
 *
 * 契约：`setLabels(repo, key, labels: LabelInput[], opts?: SetOpts, ctx: OpContext): Promise<OpResult<Issue>>`
 *  - LabelInput = string | {name,color?,description?}
 *  - SetOpts = { expectedUpdatedAt?:string } → 不匹配 → kind:'conflict'
 *  - GitLab: PUT /projects/:id/issues/:iid {labels: names}（整集替换，comma sep）
 *  - 颜色由项目色板决定，不由调用方持久化；二次 GET /projects/:id/labels 补色板（normalize已处理读侧）
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { Issue, Label, RepositoryRef } from '../../contract/entities.js'
import type { LabelInput, SetOpts } from '../../contract/inputs.js'
import type { OpResult } from '../../contract/results.js'
import { fail } from '../../kernel/preflight.js'
import { glabClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { failGlab } from './errors.js'
import { issuePath } from './queries.js'

// 仓库身份只取 refId/name，是因为标签读写只认这两样，拿全量会把 effortId 搅进来。
type RepoLike = Partial<RepositoryRef> | null | undefined
// 上下文两形都收，是因为调用方有时把执行器放在 ctx、有时放在 opCtx，缺了就让 glabClient 按 127 回。
type CtxLike = Partial<OpContext> & Partial<BackendContext>

function repoId(repo: RepoLike): string {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

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
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'setLabels: repo.refId missing', '')
  const k = String(key)
  if (!k) return fail(ERROR_KIND.PARSE as ErrorKind, 'setLabels: key required', '')
  const wanted = normalizeLabelInputs(labels)

  try {
    // If-Match 前置：expectedUpdatedAt
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
      const res = await c.run(['api', `${issuePath(id, k)}?with_labels_details=true`], { timeout: 8000 })
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
    const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
    // PUT labels（空串→清空）
    const res = await c.run(['api', issuePath(id, k), '--method', 'PUT', '-f', `labels=${labelNames}`], { timeout: 8000 })
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

// 旧名兼容：addLabel → setLabels，参数与返回与 setLabels 完全一致，留着只为不断旧调用。
export const addLabel = (
  ...args: Parameters<typeof setLabels>
): Promise<OpResult<Issue>> => setLabels(...args)

// 非op：列仓库标签色板（供DeckProjection.labels并集，非契约op），只取 name/color 两格以便并集。
export async function listLabels(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Label[]>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'listLabels: repo.refId missing', '')
  try {
    const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
    const res = await c.run(['api', `projects/${encodeURIComponent(id)}/labels`], { timeout: 8000 })
    if (res.code !== 0) {
      // 原文 = 列色板那一次 glab 调用的进程结果。
      return failGlab(res, res.stderr || res.stdout || 'listLabels failed', res, effective)
    }
    let arr: unknown = []
    try {
      arr = JSON.parse(res.stdout) as unknown
    } catch {
      arr = []
    }
    if (!Array.isArray(arr)) arr = []
    const labels: Label[] = (arr as unknown[]).map((l) => {
      const lb = l !== null && typeof l === 'object' ? (l as Record<string, unknown>) : {}
      return {
        name: typeof lb['name'] === 'string' ? String(lb['name']) : '',
        color: typeof lb['color'] === 'string' ? String(lb['color']) : '',
      } as Label
    })
    return { ok: true, data: labels }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身。
    return failGlab(err, errMsg(err), err, effective)
  }
}

export default { setLabels, addLabel, listLabels }
