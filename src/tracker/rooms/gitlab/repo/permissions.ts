/**
 * src/tracker/rooms/gitlab/repo/permissions.ts —— GitLab 房的一条单点读：当前账号在这张仓库上能做什么。
 *
 * ── 为什么住在 repo/ 子树（#1918）──────────────────────────────────────────────
 * 这条读与「当前登录人」（`repo/current-user.ts`）原来同住根目录的 `identity-ops.ts`。它们共用的
 * 是两样东西：仓库坐标的入口检查，以及「这一趟没读成」要在失败之前落一行 `read.degraded` 的纪律。
 * 按规格 #1907 的竖切口径，仓库身份与这两条读都属于「仓库」这个概念，一起搬进 `repo/`；
 * 两条读各占一个 module，入口检查的判据收在 `repo/identity.ts` 的 `looksLikeProjectPath`。
 *
 * ── 请求边界不在这个文件里 ─────────────────────────────────────────────────────
 * `GET /projects/:id?simple=true` 的形状（方法、路径、超时怎么传）住在根目录 `requests.ts` 的
 * `requestProjectPermissions`；项目路径的编码仍只有 `queries.ts` 一处口径，由请求函数去调它。
 * 本文件只做请求前后属于操作上下文的事：入口检查、解析回包、按失败档位挑话术、落降级日志。
 * 行为与搬进子树之前逐字一致：返回的两个布尔、失败档位、提示话术、`read.degraded` 的 op 与 reason、
 * 以及 `GITLAB_READ_TIMEOUT_MS` 这一档超时都没有变。
 *
 * ── 远端回包形状（GitLab 官方文档，2026-10-14 查）───────────────────────────────
 * 仓库权限：`GET /projects/:id` 的回包里 `"permissions"` 形如
 *   `{"project_access": {"access_level": 10, "notification_level": 3},
 *     "group_access":   {"access_level": 50, "notification_level": 3}}`；
 * 两格分别表示「直接加在这个项目上的成员档位」与「从上层分组继承来的档位」，
 * 用户没有那一侧的关系时那一格是 `null`（不是 0，也不是缺这一格）。
 *
 * ── 档位数字与含义：核实到什么程度，写清楚 ──────────────────────────────────────
 * 已核实（官方文档原文）：
 *   · 档位数字：`10 Guest / 20 Reporter / 30 Developer / 40 Maintainer / 50 Owner`
 *     （`doc/api/group_members.md`）。同一份文档还写明今天另有 `15 Planner`、`25 Security Manager`
 *     两档，以及 Premium 及以上才有效、且只对顶级分组有效的 `5 Minimal access`。
 *   · 各档能做什么（官方「默认角色」权限表）：Guest 能看议题、写评论，**不能推代码、看不到仓库代码**；
 *     Reporter 能看代码、建议题、出报告，**不能推代码、不能管保护分支**；
 *     Developer 能**往非保护分支推代码**、开合并请求、跑流水线；Maintainer / Owner 是更高的全集。
 *     项目计划那张表里「编辑议题（含元数据与锁定）」与「关闭/重开议题」两行都从 Planner(15) 起有、
 *     Guest 那一行是空的 —— 本文件的 `TRIAGE_MIN_LEVEL` 就是按这两行定的（15），
 *     `PUSH_MIN_LEVEL` 按仓库表里「推送到非保护分支」那一行定（Developer，30），逐条依据写在两个常量上。
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

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { OpContext } from '../../../contract/contexts.js'
import type { RepositoryRef } from '../../../contract/entities.js'
import type { OpResult, RepoPermissions } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { failGlab } from '../errors.js'
import { emitReadDegraded } from '../support/read-log.js'
// 仓库标识的取法与优先级只在 model/repo-identity.ts 一处（#1910）。
import { repoRefId } from '../model/repo-identity.js'
// 入口检查的判据与仓库坐标解析同一口径，住在仓库身份 module 一处（#1918）。
import { looksLikeProjectPath } from './identity.js'
// 请求的形状住在房间根目录的 requests.ts（#1918）：读仓库权限的端点在那里收口。
import { requestProjectPermissions } from '../requests.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GITLAB_READ_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'

/**
 * 能推代码的最低档位：Developer(30)。
 * 依据是官方权限表里项目仓库那一行 —— 「推送到非保护分支」只有 Developer / Maintainer / Owner 有，
 * Guest 与 Reporter 是空的（Reporter 那一条明文写着「不能推代码、不能管保护分支」）。
 */
const PUSH_MIN_LEVEL = 30

/**
 * 能整理别人的票的最低档位：Planner(15)。
 *
 * 依据是官方文档「Roles and permissions」里「Project planning」那一节的项目权限表
 * （https://docs.gitlab.com/user/permissions/，2026-10-15 照官方文档核实）。「整理别人的票」对应表里这两件事，
 * 两行的勾选都**从 Planner 起有**，Guest 那一格是空的。把那两行抄下来（第一列是动作，
 * 之后依次是 Guest / Planner / Reporter / Security Manager / Developer / Maintainer / Owner，
 * 原文挂在动作上的脚注编号略去）就是这样：
 *   | Edit issues, including metadata and item locking |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
 *   | Close and reopen issues                          |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
 * Planner 的档位数字是 15：GitLab 源码 `lib/gitlab/access.rb` 里写着 `PLANNER = 15`
 * （同处还写着 `GUEST = 10`、`REPORTER = 20`、`DEVELOPER = 30`，与文件头那串数字同一出处）。
 * 契约对 `triage` 的定义是「能不能整理别人的票（改指派、关别人的票）」（`contract/results.ts:104`），
 * 与上面那两行正是同一件事。
 *
 * **此前这里写的是 20，注释里还引了一句「契约自己给 triage 的注释也是『Reporter 及以上』」——
 * 契约里没有这句话（`RepoPermissions` 只定义了两个布尔，一个档位数字都没提），是编的，已删。**
 */
const TRIAGE_MIN_LEVEL = 15

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
 * 问「当前账号在这张仓库上能不能推、能不能整理别人的票」（契约的 `getRepoPermissions`）。
 *
 * 两道门槛与依据写在文件头与两个常量上，这里只说清楚三件不许改的事：
 *   1）只回 `push` / `triage` 两个布尔，**问不出来就如实失败**，不许拿 `false` 顶上 ——
 *      契约对这两个字段的约定是「未知由调用方处理」，编一个 false 等于替远端说「你没有权限」。
 *   2）`permissions` 整格缺席、两格 access 都没有、回包是空串或字面 null，都是失败（见下面各条）。
 *   3）`triage` 按 `>= 15` 判，与官方权限表的勾选一致：有整理议题权限的档位是 Planner(15)、
 *      Reporter(20)、Security Manager(25)、Developer(30)、Maintainer(40)、Owner(50)，
 *      Guest(10) 与 Minimal access(5) 没有 —— 这些档位在「Edit issues, including metadata and item locking」
 *      与「Close and reopen issues」两行上是连续一路 ✓ 的，所以数字比较与逐档列举等价，不必再写一张表。
 *      **但不许拿角色名字去推断别的能力**：官方文档明说 Planner 与 Security Manager 是「专精档」，
 *      不继承其它档位的全部权限，只有逐行读表才算数。
 *
 * @param repo 仓库身份（refId 缺失或不像项目路径就如实失败）
 * @param ctx 单次调用上下文（平台与执行器从这里取；日志也记在它上面）
 */
export async function getRepoPermissions(repo: RepositoryRef, ctx: OpContext): Promise<OpResult<RepoPermissions>> {
  const t0 = Date.now()
  const id = repoRefId(repo)
  if (!looksLikeProjectPath(id)) {
    // 与 getCurrentUser 同一道入口检查，理由见 repo/current-user.ts 那条函数的注释；这一格的 reason 已登记。
    emitReadDegraded(ctx, 'permissions', 'permissions:repo-ref', Date.now() - t0)
    return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'getRepoPermissions: repo.refId 缺失或不像是「分组/项目」', '')
  }

  try {
    // 项目路径的编码只有 queries.ts 一处口径，请求函数照旧走它；`simple=true` 的来龙去脉见文件头。
    const res = await requestProjectPermissions(ctx, id, GITLAB_READ_TIMEOUT_MS)
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

export default { getRepoPermissions }
