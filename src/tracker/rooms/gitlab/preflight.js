/**
 * backends/gitlab/preflight.js — 探测/登录/API 可达（三判据，capability-by-fill）。
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
import { fail } from '../../preflight.js'

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
    // 原文给空串：这条结论来自「本机平台对象缺能力」，没有外部来源的原文可取。
    return fail(ERROR_KIND.ENV, 'platform unavailable', '')
  }
  const exe = await platform.resolveExecutable('glab')
  if (!exe) {
    // 原文给空串：`resolveExecutable` 回答的是「没有」，没有一个原文可以抄给它。
    return fail(ERROR_KIND.ENV, 'glab not found', '')
  }

  // 2) glab auth status → AUTH
  if (!exec || typeof exec !== 'function') {
    // 原文给空串：本机没有可用的执行器，这条失败没有任何命令跑过。
    return fail(ERROR_KIND.ENV, 'exec unavailable', '')
  }
  try {
    const authRes = await exec('glab', ['auth', 'status'], { cwd, signal, timeout: 5000 })
    const out = (authRes.stdout || '') + '\n' + (authRes.stderr || '')
    const s = out.toLowerCase()
    if (authRes.code !== 0 || /not logged in|no token|unauthenticated|401|403/i.test(s)) {
      // 原文 = auth status 这一趟的完整输出（stdout+stderr），人据此看出远端到底说了什么。
      return fail(ERROR_KIND.AUTH, out.trim().slice(0, 500) || 'glab auth failed', out)
    }
  } catch (e) {
    // 原文 = 抛上来的那个 Error（glab 进程的 stdout/stderr 挂在它身上）。
    // 档位仍是本步语义（问的是「登录了没有」），所以给 AUTH 而不是按原文再猜一遍。
    return fail(ERROR_KIND.AUTH, String(e.message || e), e)
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
        // 探活这一步问的是「连不连得上」，所以档位按本条支路原本的口径展开：
        // 认证类回包→AUTH、找不到→NOTFOUND、其余可达性失败→NETWORK，原文都带给出去。
        const probeKind = /401|403|unauthorized|forbidden|no token|not logged in/i.test(out) ? ERROR_KIND.AUTH
          : /404|not found/i.test(out) ? ERROR_KIND.NOTFOUND
          : ERROR_KIND.NETWORK
        return fail(probeKind, out.trim().slice(0, 500) || 'probe failed', out)
      }
    } catch (e) {
      // 原文 = 抛上来的那个 Error。
      return fail(ERROR_KIND.NETWORK, String(e.message || e).slice(0, 500), e)
    }
  }

  return { ok: true }
}

export default glabPreflight
