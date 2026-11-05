/**
 * src/tracker/rooms/gitlab/repo/current-user.ts —— GitLab 房的一条单点读：这个远端上「我是谁」。
 *
 * ── 为什么住在 repo/ 子树（#1918）──────────────────────────────────────────────
 * 这条读与「仓库写权限」（`repo/permissions.ts`）原来同住根目录的 `identity-ops.ts`。它们共用的
 * 是两样东西：仓库坐标的入口检查，以及「这一趟没读成」要在失败之前落一行 `read.degraded` 的纪律。
 * 按规格 #1907 的竖切口径，仓库身份与这两条读都属于「仓库」这个概念，一起搬进 `repo/`；
 * 两条读各占一个 module，入口检查的判据收在 `repo/identity.ts` 的 `looksLikeProjectPath`，
 * 于是它们仍然只是一处口径，不会各自演化出不一样的检查。
 *
 * ── 请求边界不在这个文件里 ─────────────────────────────────────────────────────
 * `GET /user` 的形状（方法、路径、超时怎么传）住在根目录 `requests.ts` 的 `requestCurrentUser`，
 * 那里是本房所有远端端点形状的唯一出处。本文件只做请求前后属于操作上下文的事：入口检查、解析回包、
 * 按失败档位挑话术、落降级日志。行为与搬进子树之前逐字一致：返回形状、失败档位、提示话术、
 * 日志事件的 op 与 reason、以及 `GITLAB_READ_TIMEOUT_MS` 这一档超时都没有变。
 *
 * ── 远端问法与回包形状（GitLab 官方文档，2026-10-14 查）─────────────────────────
 *   当前登录人：`GET /user` → `{id, username, name, avatar_url, bot, ...}`，本房用 `glab api user`。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { Actor, ErrorKind } from '../../../contract/identity.js'
import type { OpContext } from '../../../contract/contexts.js'
import type { RepositoryRef } from '../../../contract/entities.js'
import type { OpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { failGlab } from '../errors.js'
import { emitReadDegraded } from '../support/read-log.js'
// 仓库标识的取法与优先级只在 model/repo-identity.ts 一处（#1910）。
import { repoRefId } from '../model/repo-identity.js'
// 入口检查的判据与仓库坐标解析同一口径，住在仓库身份 module 一处（#1918）。
import { looksLikeProjectPath } from './identity.js'
// 请求的形状住在房间根目录的 requests.ts（#1918）：读当前登录人的端点在那里收口。
import { requestCurrentUser } from '../requests.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GITLAB_READ_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'

/** 取异常里那句话；取不到就把异常本身转成字符串（与房内其余文件的同一套写法）。 */
function errMsg(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'message' in (err as Record<string, unknown>)) {
    const m = (err as Record<string, unknown>)['message']
    if (typeof m === 'string' && m) return m
  }
  return String(err)
}

/** 把一段文本当 JSON 对象读；空串、数组、解析不了、字面 null 一律回 null。 */
function parseJsonObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string') return null
  const t = text.trim()
  if (!t) return null
  try {
    const v = JSON.parse(t) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

/**
 * 问「这个远端上我是谁」（契约的 `getCurrentUser`）。
 *
 * 成功回 `{login, name?, avatarUrl?, kind?}`：
 *   · `login` 取回包的 `username`（它才是 GitLab 里那个全局唯一的短名，`name` 是显示名）；
 *   · `kind` 只在回包明说 `bot: true` 时填 `'bot'`（GitLab 的机器人账号就是这个标记）；
 *     其余一律**省略**而不是填 `'user'` —— 契约对 `kind` 的约定是「认不出来就省略」。
 *
 * 关于入口那道 refId 检查（有一条要如实说清楚）：`GET /user` 本身**不需要**项目路径，
 * 这道检查不是远端的要求，而是本房的入口纪律 —— 本房其余读操作（`get` / `list`）在同一处缺失时
 * 也走同一个失败分支，且 `read-log.ts` 里登记了 `currentUser:repo-ref` 这一格。
 * 之所以不让它例外：refId 认不出来时调用方还没拿到一个可用的仓库坐标，此时给出「当前登录人」
 * 会让上层把一次没做完的准备当成做完的结论。
 *
 * @param repo 仓库身份（只取 refId/name；refId 缺失或不像项目路径就如实失败）
 * @param ctx 单次调用上下文（平台与执行器从这里取；日志也记在它上面）
 */
export async function getCurrentUser(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<Actor>> {
  // 这一笔的起点：下面每条降级日志带的是「从入口到这里花掉的毫秒数」。
  const t0 = Date.now()
  const id = repoRefId(repo)
  if (!looksLikeProjectPath(id)) {
    emitReadDegraded(ctx, 'currentUser', 'currentUser:repo-ref', Date.now() - t0)
    return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'getCurrentUser: repo.refId 缺失或不像是「分组/项目」', '')
  }

  try {
    const res = await requestCurrentUser(ctx, GITLAB_READ_TIMEOUT_MS)
    if (res.code !== 0) {
      // 按 read-log.ts 里 transport 的定义，非 0 退出（glab 不在、没登录、远端 401/403）都归这一格；
      // 具体档位仍由 failGlab 按原文判，这里只负责让「身份没问出来」在日志里是一条线。
      emitReadDegraded(ctx, 'currentUser', 'currentUser:transport', Date.now() - t0)
      // 原文 = 这一次 glab 调用的进程结果。
      return failGlab(res, res.stderr || res.stdout || 'getCurrentUser 没问出来', res, ctx)
    }

    const bag = parseJsonObject(res.stdout)
    if (!bag) {
      emitReadDegraded(ctx, 'currentUser', 'currentUser:json', Date.now() - t0)
      return fail(ERROR_KIND.PARSE as ErrorKind, 'getCurrentUser: 回包不是 JSON 对象', res.stdout)
    }

    const login = typeof bag['username'] === 'string' ? bag['username'].trim() : ''
    if (!login) {
      // 命令成功、JSON 也解析得动，缺的正是这一条读必须有的一格：这种「成功却没读到」最容易被
      // 当成「没有登录人」糊过去，所以单独落一行，再如实失败。
      emitReadDegraded(ctx, 'currentUser', 'currentUser:shape', Date.now() - t0)
      return fail(ERROR_KIND.PARSE as ErrorKind, 'getCurrentUser: 回包里没有 username', res.stdout)
    }

    const actor: Actor = { login }
    const name = typeof bag['name'] === 'string' ? bag['name'].trim() : ''
    if (name) actor.name = name
    const avatar = typeof bag['avatar_url'] === 'string' ? bag['avatar_url'].trim() : ''
    if (avatar) actor.avatarUrl = avatar
    if (bag['bot'] === true) actor.kind = 'bot'
    return { ok: true, data: actor }
  } catch (err: unknown) {
    // 走到这里说明这一趟调用是抛上来的而不是回一个进程结果 —— 按 read-log.ts 对 transport 的定义
    // （起不了进程、超时、非 0 退出这一族）它同样属于「没读成」，所以先落一行再失败。
    emitReadDegraded(ctx, 'currentUser', 'currentUser:transport', Date.now() - t0)
    // 原文 = 抛上来的那个 Error 对象本身。
    return failGlab(err, errMsg(err), err, ctx)
  }
}

export default { getCurrentUser }
