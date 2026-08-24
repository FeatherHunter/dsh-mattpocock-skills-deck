/**
 * backends/github/preflight.js — 探测/登录/API 可达（三项门禁，只判环境，不预判能力）。
 *
 * 定版依据：#138 §1.5 + contract.js preflight 签名 + #129 平台三底座
 * - 签名：(handle: RepoHandle, ctx: OpContext) => Promise<PreflightResult>
 *   handle: {cwd?, refId?}；ctx: BackendContext（含 platform/exec/timers/fs/log）+ cwd/signal/refId
 * - 三项检查顺序：1) gh 可执行 → env；2) 登录态 → auth；3) 仓库可达 → not-found/auth/network/rate-limit
 * - 不检查：labels/subIssue/depGraph 等能力；不返回 capabilities 布尔表（旧 BackendStatus 已删）
 * - 错误归一全经 classifyGhError
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { ghClient } from './client.js'
import { classifyGhError } from './errors.js'

function parseRepoRef(handle, ctx) {
  // 优先 handle.refId，其次 ctx.refId，再尝试从 cwd 的 git remote 解析（简化：若 refId 无则用 gh repo view）
  if (handle && typeof handle.refId === 'string' && handle.refId) return handle.refId
  if (ctx && typeof ctx.refId === 'string' && ctx.refId) return ctx.refId
  return null
}

function repoFromRefId(refId) {
  if (!refId || typeof refId !== 'string') return null
  const idx = refId.indexOf('/')
  if (idx <= 0) return null
  return { owner: refId.slice(0, idx), name: refId.slice(idx + 1) }
}

/**
 * @param {import('../../contract.js').RepoHandle} handle
 * @param {import('../../contract.js').OpContext} ctx
 * @returns {Promise<import('../../contract.js').PreflightResult>}
 */
export async function ghPreflight(handle, ctx) {
  const cwd = (handle && handle.cwd) || (ctx && ctx.cwd) || undefined
  const opCtx = Object.assign({}, ctx || {}, cwd ? { cwd } : {})

  // 1) gh 可执行
  try {
    const platform = opCtx.platform
    if (!platform || typeof platform.resolveExecutable !== 'function') {
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'gh not found: platform.resolveExecutable unavailable' } }
    }
    const ghPath = await platform.resolveExecutable('gh')
    if (!ghPath) {
      return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'gh not found: platform.resolveExecutable returned null (install https://cli.github.com/)' } }
    }
  } catch (e) {
    return { ok: false, error: { kind: ERROR_KIND.ENV, message: String((e && e.message) || e).slice(0, 400) } }
  }

  // 2) 登录态：gh auth status
  try {
    const c = ghClient(opCtx)
    const r = await c.execGh(['auth', 'status'], { cwd })
    if (!r.ok) {
      const kind = r.error && r.error.kind ? r.error.kind : classifyGhError(r.error)
      // auth status 非 0 → auth（若 classify 为 env 则仍按 env，不强行 auth）
      if (kind === ERROR_KIND.ENV) return { ok: false, error: r.error }
      // gh auth status 的 stderr 含 not logged in 文案时 classifyGhError 已归 auth
      if (kind === ERROR_KIND.AUTH) return { ok: false, error: r.error }
      // 其他错误按分类返回
      return { ok: false, error: r.error }
    }
  } catch (e) {
    const kind = classifyGhError(e)
    if (kind === ERROR_KIND.AUTH) return { ok: false, error: { kind, message: String((e && e.message) || e).slice(0, 400) } }
    return { ok: false, error: { kind, message: String((e && e.message) || e).slice(0, 400) } }
  }

  // 3) 仓库可达（含权限）：gh api repos/{owner}/{name}
  try {
    let refId = parseRepoRef(handle, opCtx)
    // 若无 refId，尝试 gh repo view 取当前仓库（与 host/index.js getRepoKey 同源）
    if (!refId) {
      const c = ghClient(opCtx)
      const rr = await c.execGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd })
      if (rr.ok) {
        const s = (rr.data.stdout || '').trim()
        if (s && s.includes('/')) refId = s
      }
    }
    if (!refId) {
      // 无仓库上下文→ 视为 not-found（无法判定仓库可达）
      return { ok: false, error: { kind: ERROR_KIND.NOTFOUND, message: 'repo not found: cannot resolve owner/name (no refId and gh repo view failed)' } }
    }
    const repo = repoFromRefId(refId)
    if (!repo) return { ok: false, error: { kind: ERROR_KIND.NOTFOUND, message: `repo refId malformed: ${refId}` } }
    const c = ghClient(opCtx)
    const r = await c.execGh(['api', `repos/${repo.owner}/${repo.name}`], { cwd })
    if (!r.ok) {
      // 分类已在 client 层归一，此处直接返回
      return { ok: false, error: r.error }
    }
    return { ok: true }
  } catch (e) {
    const kind = classifyGhError(e)
    return { ok: false, error: { kind, message: String((e && e.message) || e).slice(0, 400) } }
  }
}

export default ghPreflight
