/**
 * backends/gitlab/labels.js — label 操作（#135 定版：labels→labels[]恒EMPTY，milestone分流）。
 *
 * 契约：`setLabels(repo, key, labels: LabelInput[], opts?: SetOpts, ctx: OpContext): Promise<OpResult<Issue>>`
 *  - LabelInput = string | {name,color?,description?}
 *  - SetOpts = { expectedUpdatedAt?:string } → 不匹配 → kind:'conflict'
 *  - GitLab: PUT /projects/:id/issues/:iid {labels: names}（整集替换，comma sep）
 *  - 颜色由项目色板决定，不由调用方持久化；二次 GET /projects/:id/labels 补色板（normalize已处理读侧）
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import { fail } from '../../preflight.js'
import { glabClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { failGlab } from './errors.js'
import { issuePath } from './queries.js'

function repoId(repo) {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

function normalizeLabelInput(li) {
  if (typeof li === 'string') {
    const name = li.trim()
    if (!name) return null
    return { name, color: '' }
  }
  if (!li || typeof li !== 'object') return null
  const name = typeof li.name === 'string' ? li.name.trim() : ''
  if (!name) return null
  const color = typeof li.color === 'string' ? li.color : ''
  const out = { name, color }
  if (typeof li.description === 'string' && li.description.trim() !== '') out.description = li.description
  return out
}

function normalizeLabelInputs(labels) {
  if (!Array.isArray(labels)) return []
  const out = []
  const seen = new Set()
  for (const li of labels) {
    const l = normalizeLabelInput(li)
    if (!l) continue
    if (seen.has(l.name)) continue
    seen.add(l.name)
    out.push(l)
  }
  return out
}

export async function setLabels(ctx, repo, key, labels, opts, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'setLabels: repo.refId missing', '')
  const k = String(key)
  if (!k) return fail(ERROR_KIND.PARSE, 'setLabels: key required', '')
  const wanted = normalizeLabelInputs(labels)

  try {
    // If-Match 前置：expectedUpdatedAt
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const c = glabClient(effective)
      const res = await c.run(['api', `${issuePath(id, k)}?with_labels_details=true`], { timeout: 8000 })
      if (res.code !== 0) {
        // 原文 = 改色前置那一次 GET 的进程结果；判档走同一趟归一（带上下文，日志里留得下轨迹）。
        return failGlab(res, res.stderr || res.stdout || 'setLabels preflight get failed', res, effective)
      }
      let cur = null
      try { cur = JSON.parse(res.stdout) } catch {}
      const curUpdated = cur && (cur.updated_at || cur.updatedAt) || ''
      if (curUpdated !== opts.expectedUpdatedAt) {
        // 原文 = 回读到的票面（人据此自己核对「远端现在是什么版本」），不是给人看的那句冲突话。
        return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${curUpdated})`, res.stdout)
      }
    }

    const labelNames = wanted.map((l) => l.name).join(',')
    const c = glabClient(effective)
    // PUT labels（空串→清空）
    const res = await c.run(['api', issuePath(id, k), '--method', 'PUT', '-f', `labels=${labelNames}`], { timeout: 8000 })
    if (res.code !== 0) {
      // 原文 = 写标签那一次 PUT 的进程结果。
      return failGlab(res, res.stderr || res.stdout || 'setLabels failed', res, effective)
    }
    let raw = null
    try { raw = JSON.parse(res.stdout) } catch {}
    if (!raw || typeof raw !== 'object') raw = { iid: k, labels: wanted.map((l) => l.name) }
    // 确保归一后 labels 为 wanted（带 color 兜底）
    const issue = normalizeIssue(raw)
    issue.labels = wanted
    return { ok: true, data: issue }
  } catch (err) {
    // 原文 = 抛上来的那个 Error 对象本身。kind 为 conflict 时 classifyGlabError 走透传，
    // 本家那句话原样留着（不换成通用提示）。
    return failGlab(err, err && err.message ? String(err.message) : String(err), err, effective)
  }
}

// 旧名兼容：addLabel → setLabels
export const addLabel = (...args) => setLabels(...args)

// 非op：列仓库标签色板（供DeckProjection.labels并集，非契约op）
export async function listLabels(ctx, repo, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'listLabels: repo.refId missing', '')
  try {
    const c = glabClient(effective)
    const res = await c.run(['api', `projects/${encodeURIComponent(id)}/labels`], { timeout: 8000 })
    if (res.code !== 0) {
      // 原文 = 列色板那一次 glab 调用的进程结果。
      return failGlab(res, res.stderr || res.stdout || 'listLabels failed', res, effective)
    }
    let arr = []
    try { arr = JSON.parse(res.stdout) } catch {}
    if (!Array.isArray(arr)) arr = []
    const labels = arr.map((l) => ({ name: l.name, color: l.color || '' }))
    return { ok: true, data: labels }
  } catch (err) {
    // 原文 = 抛上来的那个 Error 对象本身。
    return failGlab(err, err && err.message ? String(err.message) : String(err), err, effective)
  }
}

export default { setLabels, addLabel, listLabels }
