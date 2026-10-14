/**
 * backends/gitlab/preflight.ts — 探测/登录/API 可达（三判据，capability-by-fill）。
 *
 * 契约：preflight只判环境（工具在/登录/可达），不预判能力；能力由操作/字段零推断（G5）。
 * 按 #144 §四：resolveExecutable→ENV / glab auth status→AUTH / 探活→NETWORK；JH/self-hosted复用 GL_HOST。
 *
 * 失败形状（#1111 收口）：预检也是「失败」，一样要带原文三段式 `{kind, message, raw}` ——
 * `raw` 或许为空串（本地就知道原因的，例如平台没给 `resolveExecutable`），但字段必须在，
 * 界面/日志才有统一的兜底可展开。有外部原文的那几条（auth status、探活）原文一律带上。
 *
 * 判档口径（与「一处真源」不冲突，写在这里免得后人以为漏改）：预检这三步的档位是**步骤语义**
 * 定的，不是从文本猜的 —— 第一步问的是「工具在不在」（ENV），第二步问的是「登录了没有」（AUTH），
 * 第三步问的是「连不连得上」（可达性）。所以本文件直接用常量档位 + 原文，而不走「按原文判档」：
 * 那会把「auth status 因为网络抖了一下没跑成」判成网络、把「探活撞上权限不足」判成认证，
 * 反而比按步骤判更不准。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { RepositoryRef } from '../../contract/entities.js'
import type { PreflightResult } from '../../contract/results.js'
import { fail } from '../../kernel/preflight.js'

// 预检入参两形都收，是因为调用方有时拿仓库身份、有时拿句柄，直接收窄会把另一路挡在门外。
type PreflightHandle = Partial<OpContext> & Partial<BackendContext> & {
  refId?: string
  cwd?: string
  repository?: { refId?: string }
} & Partial<RepositoryRef>

// 上下文缺字段就按本地失败回，是因为预检问的正是环境通不通，抛异常反而让调用方无原文可看。
type PreflightCtx = Partial<OpContext> & Partial<BackendContext>

function repoRefId(repo: { refId?: unknown; name?: unknown } | null | undefined): string {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

/**
 * 三步探活：工具在不在、登录了没有、连不连得上，每步失败都带原文回以便界面展开。
 *
 * @param handle 仓库身份或句柄（两种形状都收，只取其中的 refId 与 cwd）
 * @param opCtx 本次调用的上下文（平台与执行器从这里取）
 */
export async function glabPreflight(
  handle: PreflightHandle | null | undefined,
  opCtx: PreflightCtx | null | undefined,
): Promise<PreflightResult> {
  const ctx = (opCtx || handle) as PreflightCtx | null | undefined
  const platform = ctx && ctx.platform
  const exec = ctx && ctx.exec
  const cwd =
    (handle && typeof handle.cwd === 'string' ? (handle.cwd as string) : undefined) ||
    (ctx && typeof ctx.cwd === 'string' ? (ctx.cwd as string) : undefined) ||
    undefined
  // 空信号统一成 undefined，是因为执行器只收 undefined，null 会被当成非法值拦掉。
  const signal = ctx?.signal || undefined

  // 1) resolveExecutable('glab') → ENV
  if (!platform || typeof platform.resolveExecutable !== 'function') {
    // 原文给空串：这条结论来自「本机平台对象缺能力」，没有外部来源的原文可取。
    return fail(ERROR_KIND.ENV as ErrorKind, 'platform unavailable', '')
  }
  const exe = await platform.resolveExecutable('glab')
  if (!exe) {
    // 原文给空串：`resolveExecutable` 回答的是「没有」，没有一个原文可以抄给它。
    return fail(ERROR_KIND.ENV as ErrorKind, 'glab not found', '')
  }

  // 2) glab auth status → AUTH
  if (!exec || typeof exec !== 'function') {
    // 原文给空串：本机没有可用的执行器，这条失败没有任何命令跑过。
    return fail(ERROR_KIND.ENV as ErrorKind, 'exec unavailable', '')
  }
  try {
    const authRes = await exec('glab', ['auth', 'status'], { cwd, signal, timeout: 5000 })
    const out = String(authRes.stdout || '') + '\n' + String(authRes.stderr || '')
    const s = out.toLowerCase()
    if (authRes.code !== 0 || /not logged in|no token|unauthenticated|401|403/i.test(s)) {
      // 原文 = auth status 这一趟的完整输出（stdout+stderr），人据此看出远端到底说了什么。
      return fail(ERROR_KIND.AUTH as ErrorKind, out.trim().slice(0, 500) || 'glab auth failed', out)
    }
  } catch (e: unknown) {
    const msg = e !== null && typeof e === 'object' && 'message' in (e as Record<string, unknown>)
      ? String((e as Record<string, unknown>)['message'] || e)
      : String(e)
    // 原文 = 抛上来的那个 Error（glab 进程的 stdout/stderr 挂在它身上）。
    // 档位仍是本步语义（问的是「登录了没有」），所以给 AUTH 而不是按原文再猜一遍。
    return fail(ERROR_KIND.AUTH as ErrorKind, msg, e)
  }

  // 3) 探活：glab api projects/:id（若有 refId），否则仅前两项即算 ok
  const refId = repoRefId(
    handle && typeof (handle as Record<string, unknown>)['refId'] !== 'undefined'
      ? (handle as unknown as { refId?: unknown; name?: unknown })
      : ((handle || {}) as { refId?: unknown; name?: unknown }),
  )
  // handle 可能是 RepoHandle {refId} 或 RepositoryRef
  const hbag = (handle || {}) as Record<string, unknown>
  const repoBag = asBag(hbag['repository'])
  const probeId =
    handle && ((handle as Record<string, unknown>)['refId'] || (repoBag && repoBag['refId']))
      ? String((handle as Record<string, unknown>)['refId'] || (repoBag as Record<string, unknown>)['refId'])
      : refId
  if (probeId) {
    const encoded = encodeURIComponent(probeId)
    try {
      const probe = await exec('glab', ['api', `projects/${encoded}`], { cwd, signal, timeout: 5000 })
      const out = String(probe.stdout || '') + '\n' + String(probe.stderr || '')
      if (probe.code !== 0) {
        // 探活这一步问的是「连不连得上」，所以档位按本条支路原本的口径展开：
        // 认证类回包→AUTH、找不到→NOTFOUND、其余可达性失败→NETWORK，原文都带给出去。
        const probeKind = /401|403|unauthorized|forbidden|no token|not logged in/i.test(out)
          ? (ERROR_KIND.AUTH as ErrorKind)
          : /404|not found/i.test(out)
            ? (ERROR_KIND.NOTFOUND as ErrorKind)
            : (ERROR_KIND.NETWORK as ErrorKind)
        return fail(probeKind, out.trim().slice(0, 500) || 'probe failed', out)
      }
    } catch (e: unknown) {
      const msg = e !== null && typeof e === 'object' && 'message' in (e as Record<string, unknown>)
        ? String((e as Record<string, unknown>)['message'] || e)
        : String(e)
      // 原文 = 抛上来的那个 Error。
      return fail(ERROR_KIND.NETWORK as ErrorKind, msg.slice(0, 500), e)
    }
  }

  return { ok: true }
}

function asBag(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

export default glabPreflight
