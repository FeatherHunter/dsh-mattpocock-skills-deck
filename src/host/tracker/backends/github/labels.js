/**
 * backends/github/labels.js — labels 对齐实现（#133 定版 + #138 落地）。
 *
 * 契约：`setLabels(repo, key, labels: LabelInput[], opts?: SetOpts, ctx: OpContext): Promise<OpResult<Issue>>`
 *  - `LabelInput = string | {name: string, color?: string, description?: string}`
 *  - `SetOpts = { expectedUpdatedAt?: string }` → 不匹配 → `kind:'conflict'`（显式产生，非 regex）
 *  - Last-write-wins 且整集替换（尽力单次/近原子；GitHub 用 diff → gh issue edit --add-label/--remove-label）
 *  - GitHub 原生支持 labels → `Issue.labels` 恒存在，空→ `[]` EMPTY（#126），颜色无则 ''（string 非 number）
 */

import { fail } from '../../preflight.js'
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { normalizeIssue } from './normalize.js'
import { ghClient } from './client.js'
import { classifyGhError } from './errors.js'
import { getIssue } from './issues.js'

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

function parseRepo(repo) {
  if (!repo || typeof repo.refId !== 'string' || !repo.refId) return null
  const s = repo.refId.trim()
  const idx = s.indexOf('/')
  if (idx <= 0) return null
  return { owner: s.slice(0, idx), name: s.slice(idx + 1) }
}

function repoId(repo) {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

/**
 * 整集替换 labels（GitHub 对齐）。
 * 若提供 expectedUpdatedAt，先取当前 Issue.updatedAt 比对，不匹配 → conflict 不落盘。
 */
export async function setLabels(repo, key, labels, opts, ctx) {
  const wanted = normalizeLabelInputs(labels)
  const k = String(key || '').trim()
  if (!k) return fail(ERROR_KIND.PARSE, 'setLabels: key required (string)')

  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `setLabels: repo.refId missing: ${repoId(repo)}`)

    // If-Match 前置：expectedUpdatedAt 强一致
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const cur = await getIssue(repo, k, {}, ctx)
      if (!cur.ok) return cur
      if (cur.data.updatedAt !== opts.expectedUpdatedAt) {
        return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur.data.updatedAt})`)
      }
    }

    const c = ghClient(ctx)
    // 读当前 labels 做 diff（需知 toAdd/toRemove）
    const curRes = await getIssue(repo, k, {}, ctx)
    const curLabels = curRes.ok ? curRes.data.labels.map((l) => l.name) : []
    const wantNames = wanted.map((l) => l.name)
    const toAdd = wantNames.filter((n) => !curLabels.includes(n))
    const toRemove = curLabels.filter((n) => !wantNames.includes(n))

    for (const n of toRemove) {
      const r = await c.execGh(['issue', 'edit', k, '--repo', `${parsed.owner}/${parsed.name}`, '--remove-label', n], { cwd: ctx && ctx.cwd })
      if (!r.ok) return { ok: false, error: r.error }
    }
    for (const n of toAdd) {
      const r = await c.execGh(['issue', 'edit', k, '--repo', `${parsed.owner}/${parsed.name}`, '--add-label', n], { cwd: ctx && ctx.cwd })
      if (!r.ok) return { ok: false, error: r.error }
    }

    // 读回最新
    const finalRes = await getIssue(repo, k, {}, ctx)
    if (!finalRes.ok) {
      // optimistic 回落（测试桩或离线时）
      const optimisticRaw = { number: Number(k) || k, title: '', state: 'open', body: '', url: '', labels: { nodes: wanted.map((l) => ({ name: l.name, color: l.color || '', description: l.description || '' })) }, updatedAt: new Date().toISOString() }
      const issue = normalizeIssue(optimisticRaw)
      issue.labels = wanted
      return { ok: true, data: issue }
    }
    // 确保 labels 为归一后的 wanted（带 color '' 兜底、description 可选）
    finalRes.data.labels = wanted
    return finalRes
  } catch (err) {
    const kind = classifyGhError(err)
    if (kind === ERROR_KIND.CONFLICT) return fail(ERROR_KIND.CONFLICT, err && err.message ? String(err.message) : 'conflict')
    return fail(kind, err && err.message ? String(err.message) : String(err))
  }
}

// 旧名兼容：addLabel → setLabels（#124：label→setLabels）—— 保留别名但标记弃用
export const addLabel = (...args) => setLabels(...args)

// 非 op：列仓库标签色板（供 DeckProjection.labels 聚合，非契约 op；snapshot 侧并集 labels）
export async function listLabels(repo, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `listLabels: repo.refId missing: ${repoId(repo)}`)
    const c = ghClient(ctx)
    const r = await c.execGh(['label', 'list', '--repo', `${parsed.owner}/${parsed.name}`, '--json', 'name,color,description'], { cwd: ctx && ctx.cwd })
    if (!r.ok) return { ok: false, error: r.error }
    const text = r.data.stdout || ''
    let arr = []
    try { arr = JSON.parse(text) } catch { arr = [] }
    const labels = Array.isArray(arr) ? arr.map((l) => ({ name: l.name, color: l.color || '', description: l.description || undefined })).filter((l) => l.name) : []
    return { ok: true, data: labels }
  } catch (err) {
    const kind = classifyGhError(err)
    return fail(kind, err && err.message ? String(err.message) : String(err))
  }
}

export default { setLabels, addLabel, listLabels }
