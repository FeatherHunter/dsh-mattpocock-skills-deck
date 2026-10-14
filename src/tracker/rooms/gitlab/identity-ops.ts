/**
 * src/tracker/rooms/gitlab/identity-ops.ts —— GitLab 房的两条单点读：当前登录人、仓库写权限。
 *
 * ── 这两条为什么住在同一份文件里 ────────────────────────────────────────────────
 * 它们都是「问一句、拿一个短结论」的只读操作，都不写任何东西，共用两样东西：
 *   1）仓库坐标（`repo.refId`，形如 `group/sub/project`）的入口检查；
 *   2）「这一趟没读成」要在 `fail(...)` 之前落一行 `read.degraded` 的纪律（`./read-log.ts`）。
 * 契约把它们分列为两条能力（`getCurrentUser` / `getRepoPermissions`），这里也导出两个函数，
 * 只是把上面那两样共用的东西写在一处，免得日后两处各改一半。
 *
 * ── 远端问法与回包形状（GitLab 官方文档，2026-10-14 查）─────────────────────────
 *   · 当前登录人：`GET /user` → `{id, username, name, avatar_url, bot, ...}`，本房用 `glab api user`。
 *   · 仓库权限：`GET /projects/:id` 的回包里 `"permissions"` 形如
 *     `{"project_access": {"access_level": 10, "notification_level": 3},
 *       "group_access":   {"access_level": 50, "notification_level": 3}}`；
 *     两格分别表示「直接加在这个项目上的成员档位」与「从上层分组继承来的档位」，
 *     用户没有那一侧的关系时那一格是 `null`（不是 0，也不是缺这一格）。
 *
 * ── 档位数字与含义：核实到什么程度，写清楚 ──────────────────────────────────────
 * 已核实（官方文档原文）：
 *   · 档位数字：`10 Guest / 20 Reporter / 30 Developer / 40 Maintainer / 50 Owner`
 *     （`doc/api/group_members.md`）。同一份文档还写明今天另有 `15 Planner`、`25 Security Manager`
 *     两档，以及 Premium 及以上才有效、且只对顶级分组有效的 `5 Minimal access`。
 *   · 各档能做什么（官方「默认角色」权限表）：Guest 能看议题、写评论，**不能推代码、看不到仓库代码**；
 *     Reporter 能看代码、建议题、出报告，**不能推代码、不能管保护分支**；
 *     Developer 能**往非保护分支推代码**、开合并请求、跑流水线；Maintainer / Owner 是更高的全集。
 *     项目计划那张表里「编辑议题（含元数据与锁定）」从 Planner 起有、Guest 那一行是空的。
 * 未核实（别把它当已核实用）：
 *   · 没有在真仓库上实测过任何一种角色的回包；上面每个数字、每句话都来自官方文档与 GitLab 源码，不是实测。
 *   · `?simple=true` 这一格：源码级已核实（本机没真发过这个请求）。`optional :simple` 在
 *     `lib/api/projects.rb` 里只声明在 `params :collection_params` 里，只有「列项目」那一族接口
 *     `use :collection_params`；真正读它的地方是列表呈现器 `present_projects`
 *     （`options[:with] = Entities::BasicProjectDetails if params[:simple]`）。单项目接口呈现的是
 *     `Entities::Project` + `current_user`，所以 `permissions` 在单项目回包里照常出现；
 *     把 `simple` 挂在单项目接口上是一个没人认领的参数，GitLab 那边对未声明的参数不做拒绝。
 *     本房按票面仍旧带着它问，真正的判据只有一个：回包里有没有那两格 access_level。
 *     万一哪天单项目接口也认了 simple 并因此不回 permissions，本函数会如实失败（no-fields），
 *     不会退化成「猜一个 false」。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { Actor, ErrorKind } from '../../contract/identity.js'
import type { OpContext } from '../../contract/contexts.js'
import type { RepositoryRef } from '../../contract/entities.js'
import type { OpResult, RepoPermissions } from '../../contract/results.js'
import { fail } from '../../preflight.js'
import { glabClient } from './client.js'
import { failGlab } from './errors.js'
import { emitReadDegraded } from './read-log.js'
import { projectPath } from './queries.js'

/**
 * 能推代码的最低档位：Developer(30)。
 * 依据是官方权限表里项目仓库那一行 —— 「推送到非保护分支」只有 Developer / Maintainer / Owner 有，
 * Guest 与 Reporter 是空的（Reporter 那一条明文写着「不能推代码、不能管保护分支」）。
 */
const PUSH_MIN_LEVEL = 30

/**
 * 能整理别人的票的最低档位：Reporter(20)。
 * 依据是官方项目计划权限表里「编辑议题（含元数据与锁定）」从 Reporter 起有、Guest 没有；
 * 契约自己给 `triage` 的注释也是「Reporter 及以上」（`contract/results.ts` 的 `RepoPermissions`）。
 */
const TRIAGE_MIN_LEVEL = 20

// 只取 refId/name 两格，是因为这两条读只认仓库坐标，拿全量会把 effortId 之类搅进来。
type RepoLike = Partial<RepositoryRef> | null | undefined

function repoId(repo: RepoLike): string {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

/**
 * refId 是不是一个「像 GitLab 项目路径」的样子：至少两段、每段都不空、整串没有空白。
 *
 * 为什么要有这道检查：GitLab 上一个项目至少要「分组/项目」两段（`./repo.ts` 的 `parseGitlabRepo`
 * 是同一套口径），只给一段的字符串多半是目录名或显示名，把它当项目路径拼进 URL 会问错仓库，
 * 而远端对「问错仓库」的常见回答是 404 —— 那就从「入参没给全」变成了「仓库不存在」，归因是错的。
 */
function looksLikeProjectPath(id: string): boolean {
  if (!id || /\s/.test(id)) return false
  const segs = id.split('/')
  if (segs.length < 2) return false
  for (const seg of segs) {
    if (!seg) return false
  }
  return true
}

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
 * 从一格 `project_access` / `group_access` 里读档位数字。
 *
 * 只认数字，不做任何强转：远端哪天把 `access_level` 写成字符串 `"30"` 或换成别的形状时，
 * 强行转数字会悄悄给出一个看起来正常的结论，而那是猜的；这里按「这一格没有可用档位」处理。
 */
function accessLevelOf(entry: unknown): number | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const level = (entry as Record<string, unknown>)['access_level']
  if (typeof level === 'number' && Number.isFinite(level)) return level
  return null
}

/**
 * 取「这个人在这张仓库上的有效档位」：两格里取大的那个。
 *
 * 为什么取大：两格分别是「直接加在项目上」与「从上层分组继承」，GitLab 的权限判定本身是取两者中
 * 更高的那一个（继承来的 Maintainer 不会被一个更低的直接成员档位压下去）。两格都是 null（例如
 * 公开项目里的非成员，GitLab 就回两个 null）时回 null —— 那时「能做什么」是真不知道，交给调用方失败。
 */
function maxAccessLevel(permissions: unknown): number | null {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return null
  const bag = permissions as Record<string, unknown>
  let best: number | null = null
  for (const key of ['project_access', 'group_access']) {
    const level = accessLevelOf(bag[key])
    if (level === null) continue
    if (best === null || level > best) best = level
  }
  return best
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
 * @param ctx 单次调用上下文（glab 从这里取平台与执行器；日志也记在它上面）
 */
export async function getCurrentUser(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<Actor>> {
  // 这一笔的起点：下面每条降级日志带的是「从入口到这里花掉的毫秒数」。
  const t0 = Date.now()
  const id = repoId(repo)
  if (!looksLikeProjectPath(id)) {
    emitReadDegraded(ctx, 'currentUser', 'currentUser:repo-ref', Date.now() - t0)
    return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'getCurrentUser: repo.refId 缺失或不像是「分组/项目」', '')
  }

  try {
    const res = await glabClient(ctx).run(['api', 'user'], { timeout: 8000 })
    if (res.code !== 0) {
      // 按 read-log.ts 里 transport 的定义，非 0 退出（glab 不在、没登录、远端 401/403）都归这一格；
      // 具体档位仍由 failGlab 按原文判，这里只负责让「权限没问出来」在日志里是一条线。
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

/**
 * 问「当前账号在这张仓库上能不能推、能不能整理别人的票」（契约的 `getRepoPermissions`）。
 *
 * 两道门槛与依据写在文件头与两个常量上，这里只说清楚三件不许改的事：
 *   1）只回 `push` / `triage` 两个布尔，**问不出来就如实失败**，不许拿 `false` 顶上 ——
 *      契约对这两个字段的约定是「未知由调用方处理」，编一个 false 等于替远端说「你没有权限」。
 *   2）`permissions` 整格缺席、两格 access 都没有、回包是空串或字面 null，都是失败（见下面各条）。
 *   3）数字比较对 10/20/30/40/50 这五档是准的；对今天新增的 15（Planner）会偏保守：
 *      官方文档说 Planner 能编辑议题，而本规则按 `>= 20` 会判 `triage: false`。
 *      偏保守是**少报能力**（不会误报能写），今天按契约那句「Reporter 及以上」执行；
 *      要把它改成按档位穷尽列举，另立一票，别在这里就地改。
 *
 * @param repo 仓库身份（refId 缺失或不像项目路径就如实失败）
 * @param ctx 单次调用上下文（glab 从这里取平台与执行器；日志也记在它上面）
 */
export async function getRepoPermissions(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<RepoPermissions>> {
  const t0 = Date.now()
  const id = repoId(repo)
  if (!looksLikeProjectPath(id)) {
    // 与 getCurrentUser 同一道入口检查，理由见那条函数的注释；这一格的 reason 已登记。
    emitReadDegraded(ctx, 'permissions', 'permissions:repo-ref', Date.now() - t0)
    return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'getRepoPermissions: repo.refId 缺失或不像是「分组/项目」', '')
  }

  try {
    // 项目路径的编码只有 queries.ts 一处口径，这里照旧走它；`simple=true` 的来龙去脉见文件头。
    const res = await glabClient(ctx).run(['api', `${projectPath(id)}?simple=true`], { timeout: 8000 })
    if (res.code !== 0) {
      emitReadDegraded(ctx, 'permissions', 'permissions:transport', Date.now() - t0)
      // 原文 = 这一次 glab 调用的进程结果。
      return failGlab(res, res.stderr || res.stdout || 'getRepoPermissions 没问出来', res, ctx)
    }

    const text = String(res.stdout || '').trim()
    if (!text || text === 'null') {
      emitReadDegraded(ctx, 'permissions', 'permissions:empty', Date.now() - t0)
      return fail(ERROR_KIND.PARSE as ErrorKind, 'getRepoPermissions: 回包是空串或 null，权限问不出来', res.stdout)
    }

    const bag = parseJsonObject(text)
    if (!bag) {
      emitReadDegraded(ctx, 'permissions', 'permissions:json', Date.now() - t0)
      return fail(ERROR_KIND.PARSE as ErrorKind, 'getRepoPermissions: 回包不是 JSON 对象', res.stdout)
    }

    const level = maxAccessLevel(bag['permissions'])
    if (level === null) {
      // 这一条是整份实现里最要紧的那个「不猜」：公开项目里的非成员、或者远端改了字段形状，
      // 都会走到这里 —— 那时回答 push:false 是替远端断言「你没有写权限」，与事实可能正相反。
      emitReadDegraded(ctx, 'permissions', 'permissions:no-fields', Date.now() - t0)
      return fail(
        ERROR_KIND.PARSE as ErrorKind,
        'getRepoPermissions: 回包里 permissions.project_access 与 group_access 都没有可用的 access_level',
        text,
      )
    }

    return { ok: true, data: { push: level >= PUSH_MIN_LEVEL, triage: level >= TRIAGE_MIN_LEVEL } }
  } catch (err: unknown) {
    // 与 getCurrentUser 的 catch 同一口径：抛上来的也算 transport，先落日志再失败。
    emitReadDegraded(ctx, 'permissions', 'permissions:transport', Date.now() - t0)
    return failGlab(err, errMsg(err), err, ctx)
  }
}

export default { getCurrentUser, getRepoPermissions }
