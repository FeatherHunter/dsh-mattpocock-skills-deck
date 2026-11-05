/**
 * backends/gitlab/preflight.ts — 探测/登录/API 可达（三判据，capability-by-fill）。
 *
 * 契约：preflight只判环境（工具在/登录/可达），不预判能力；能力由操作/字段零推断（G5）。
 * 按 #144 §四：resolveExecutable→ENV / glab api user→按原文判档 / 探活→按原文判档；JH/self-hosted复用 GL_HOST。
 *
 * 失败形状（#1111 收口）：预检也是「失败」，一样要带原文三段式 `{kind, message, raw}` ——
 * `raw` 或许为空串（本地就知道原因的，例如平台没给 `resolveExecutable`），但字段必须在，
 * 界面/日志才有统一的兜底可展开。有外部原文的那几条（api user、探活）原文一律带上。
 *
 * 判档口径（#1793 改准）：第一关问的是「工具在不在」，这一步的失败没有外部原文可看，档位按步骤语义
 * 给 ENV。第二关问「登录了没有」，但一次 api user 失败可能是凭据真的失效，也可能是网络断了、glab
 * 根本没起来，所以失败与抛错都按原文判档 —— 走房间唯一的判档出口 classifyGlabError，不再一律给
 * AUTH（那样一次网络抖动会被界面说成「登录状态已失效」，还叫用户重新登录，方向是错的）。第三关
 * （探活）的失败判档是本次改动之前就有的本地写法，本票边界只到登录判据，没有动它；它与「判据一源」
 * 的收口另属一张票。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { RepositoryRef } from '../../contract/entities.js'
import type { PreflightResult } from '../../contract/results.js'
import { fail, HINT_UNRECOGNIZED } from '../../kernel/preflight.js'
import { classifyGlabError } from './errors.js'
// 仓库标识的取法与优先级只在 model/repo-identity.ts 一处（#1910）。
import { repoRefId } from './model/repo-identity.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GITLAB_PROBE_TIMEOUT_MS } from '../../../shared/time-config/src/values.js'

// 预检入参两形都收，是因为调用方有时拿仓库身份、有时拿句柄，直接收窄会把另一路挡在门外。
type PreflightHandle = Partial<OpContext> & Partial<BackendContext> & {
  refId?: string
  cwd?: string
  repository?: { refId?: string }
} & Partial<RepositoryRef>

// 上下文缺字段就按本地失败回，是因为预检问的正是环境通不通，抛异常反而让调用方无原文可看。
type PreflightCtx = Partial<OpContext> & Partial<BackendContext>

/** 取抛上来的错误里那句可读的话：glab 进程的 stdout/stderr 挂在错误值身上，没有 message 就整段转字符串。 */
function messageOf(e: unknown): string {
  return e !== null && typeof e === 'object' && 'message' in (e as Record<string, unknown>)
    ? String((e as Record<string, unknown>)['message'] || e)
    : String(e)
}

/**
 * 第二关（登录探针）交出去的档位：按原文判出来，但 not-found 收敛成 env。
 *
 * 为什么不能原样交 not-found：链上按档位反推「停在哪一关」（chain-env-map.ts 的 CHAIN_ENV_STAGE_OF），
 * not-found 只对应第三关（仓库不存在）。glab api user 回 404 并不代表仓库不存在 —— 它说明这台主机
 * 没按 GitLab 接口回答（GITLAB_HOST 指错、反代路径不对），登录态问不出来。原样交出去，链上会让
 * 登录行显示「已登录（仓库可达性由下一项判断）」、仓库行判红「访问不到该仓库」，两行都说反。
 * 收敛成 env 后链上如实 pending「环境检查没通过」，原文照旧带在 raw 里给人自己判断。
 */
function loginProbeKind(kind: ErrorKind): ErrorKind {
  return kind === (ERROR_KIND.NOTFOUND as ErrorKind) ? (ERROR_KIND.ENV as ErrorKind) : kind
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

  // 2) glab api user → 按原文判档（真没登录是 auth，问不出去是 network / env）
  //
  // 为什么不用 `glab auth status`：它回答的是「所有已配置主机都健康吗」，不是「当前仓库这台主机
  // 登录了吗」。多主机配置下任何一台无关主机失败都会让它非零退出（#1779：glab 1.68 与 1.123 实测），
  // 于是当前仓库被误判成没登录。`glab api user` 走 glab 对当前目录的主机解析（git remote →
  // GITLAB_HOST → 配置 host → gitlab.com），拿当前主机上「我是谁」回答登录问题，作用域与房间后续
  // 的 api 调用一致。#916 在 GitHub 房也是用 `gh api user` 做交叉核对（那边仍以 `gh auth status`
  // 为主判据，只在它判失败后核对一次）；GitLab 这边把核对直接提成主判据，省掉会骗人的那一步。
  if (!exec || typeof exec !== 'function') {
    // 原文给空串：本机没有可用的执行器，这条失败没有任何命令跑过。
    return fail(ERROR_KIND.ENV as ErrorKind, 'exec unavailable', '')
  }
  try {
    const authRes = await exec('glab', ['api', 'user'], { cwd, signal, timeout: GITLAB_PROBE_TIMEOUT_MS })
    if (authRes.code !== 0) {
      // 原文 = api user 这一趟的完整输出（stdout+stderr），人据此看出远端到底说了什么。
      const out = String(authRes.stdout || '') + '\n' + String(authRes.stderr || '')
      // 档位按原文判（#1793）：401 / unauthorized / no token 这类才是真未登录；EOF、超时、连不上归
      // NETWORK。以前这里一律给 AUTH，网络抖一下就被界面说成「登录状态已失效」，还让人重新登录。
      // 判档上下文传进去：调试开关打开时它会留一条 error.normalize（ADR 20261014 §2.8）。
      const verdict = classifyGlabError(authRes, ctx || undefined)
      // 规则表一条都没认出来时用全仓统一的那句「没认出来」，不拿原文假装判出来了（与 errors.ts 的 hintFor 同一口径）。
      const message = verdict.fallback ? HINT_UNRECOGNIZED : (out.trim().slice(0, 500) || 'glab api user failed')
      return fail(loginProbeKind(verdict.kind), message, out)
    }
  } catch (e: unknown) {
    // 原文 = 抛上来的那个 Error（glab 进程的 stdout/stderr 挂在它身上）。
    // 档位同样按原文判（#1793）：起进程失败带 ENOENT 归 ENV、本地超时归 NETWORK，其余才可能落到 AUTH。
    const verdict = classifyGlabError(e, ctx || undefined)
    const message = verdict.fallback ? HINT_UNRECOGNIZED : messageOf(e)
    return fail(loginProbeKind(verdict.kind), message, e)
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
      const probe = await exec('glab', ['api', `projects/${encoded}`], { cwd, signal, timeout: GITLAB_PROBE_TIMEOUT_MS })
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
      // 原文 = 抛上来的那个 Error。
      return fail(ERROR_KIND.NETWORK as ErrorKind, messageOf(e).slice(0, 500), e)
    }
  }

  return { ok: true }
}

function asBag(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

export default glabPreflight
