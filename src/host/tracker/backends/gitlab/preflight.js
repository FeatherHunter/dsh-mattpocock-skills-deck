/**
 * backends/gitlab/preflight.js — 探测/登录/API 可达（三判据，capability-by-fill）。
 *
 * 契约：preflight只判环境（工具在/登录/可达），不预判能力；能力由操作/字段零推断（G5）。
 * 按 #144 §四：resolveExecutable→ENV / glab auth status→AUTH / 探活→NETWORK；JH/self-hosted复用 GL_HOST。
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { classifyGlabError } from './errors.js'

function repoRefId(repo) {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

export async function glabPreflight(handle, opCtx) {
  const ctx = opCtx || handle
  const platform = ctx && ctx.platform
  const exec = ctx && ctx.exec
  const cwd = (handle && handle.cwd) || (ctx && ctx.cwd) || undefined
  const signal = ctx && ctx.signal

  // 1) resolveExecutable('glab') → ENV
  if (!platform || typeof platform.resolveExecutable !== 'function') {
    return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'platform unavailable' } }
  }
  const exe = await platform.resolveExecutable('glab')
  if (!exe) {
    return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'glab not found' } }
  }

  // 2) glab auth status → AUTH
  if (!exec || typeof exec !== 'function') {
    return { ok: false, error: { kind: ERROR_KIND.ENV, message: 'exec unavailable' } }
  }
  try {
    const authRes = await exec('glab', ['auth', 'status'], { cwd, signal, timeout: 5000 })
    const out = (authRes.stdout || '') + '\n' + (authRes.stderr || '')
    const s = out.toLowerCase()
    if (authRes.code !== 0 || /not logged in|no token|unauthenticated|401|403/i.test(s)) {
      // 区分 host 不匹配：若含 host mismatch 文案仍为 AUTH
      return { ok: false, error: { kind: ERROR_KIND.AUTH, message: out.trim().slice(0, 500) || 'glab auth failed' } }
    }
  } catch (e) {
    const kind = classifyGlabError(e)
    if (kind === ERROR_KIND.AUTH) return { ok: false, error: { kind, message: String(e.message || e) } }
    return { ok: false, error: { kind, message: String(e.message || e) } }
  }

  // 3) 探活：glab api projects/:id（若有 refId），否则仅前两项即算 ok
  const refId = repoRefId(handle && handle.refId ? handle : (handle || {}))
  // handle 可能是 RepoHandle {refId} 或 RepositoryRef
  const probeId = handle && (handle.refId || (handle.repository && handle.repository.refId)) ? (handle.refId || handle.repository.refId) : refId
  if (probeId) {
    const encoded = encodeURIComponent(probeId)
    try {
      const probe = await exec('glab', ['api', `projects/${encoded}`], { cwd, signal, timeout: 5000 })
      const out = (probe.stdout || '') + '\n' + (probe.stderr || '')
      if (probe.code !== 0) {
        const kind = classifyGlabError({ message: out, stderr: probe.stderr, stdout: probe.stdout, code: probe.code })
        if (kind === ERROR_KIND.AUTH) return { ok: false, error: { kind, message: out.trim().slice(0, 500) } }
        if (kind === ERROR_KIND.NOTFOUND) return { ok: false, error: { kind, message: out.trim().slice(0, 500) } }
        if (kind === ERROR_KIND.NETWORK) return { ok: false, error: { kind, message: out.trim().slice(0, 500) } }
        return { ok: false, error: { kind, message: out.trim().slice(0, 500) } }
      }
    } catch (e) {
      const kind = classifyGlabError(e)
      return { ok: false, error: { kind, message: String(e.message || e).slice(0, 500) } }
    }
  }

  return { ok: true }
}

export default glabPreflight
