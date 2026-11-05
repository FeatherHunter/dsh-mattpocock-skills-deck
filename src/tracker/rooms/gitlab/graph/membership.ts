/**
 * src/tracker/rooms/gitlab/graph/membership.ts —— 亲缘挂载与指派：隐藏标记挂载、assignee_ids 解析。
 *
 * 为什么搬进 graph/ 子树（#1920）：亲缘挂载与指派和阻塞边同属关系这一概念，读与写的落点都在
 * graph/ 里。根目录 graph-membership.ts 只剩纯转发（它在 #1907 的 9 个旧路径名单里，留给房外
 * 读者）；入口 index.ts 已改从本文件取 setParent / setAssignees，房内不再绕转发文件。
 *
 * 请求的形状只在根目录 requests.ts 一处（#1920）：挂父与指派都是整篇 PUT，走 requestIssuePatch；
 * 登录名换用户编号走 requestUserByName。本文件只决定每次请求的时限，以及拿到原始进程结果之后的
 * 事：解析回包、归一、写后读回核对、按失败档位挑话术。
 *
 * 共享的原始票读取（fetchRawIssue）从票读文件 issues/read.ts 单向导入；仓库标识从
 * model/repo-identity.ts 取。两样都不自建第二份。正文标记的规则只在 model/description-markers.ts 一处。
 */
import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { Issue, RepositoryRef } from '../../../contract/entities.js'
import type { AssigneeInput, SetOpts } from '../../../contract/inputs.js'
import { TRACKER_ERROR_STAGE, type OpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { normalizeIssue } from '../model/normalize.js'
// 正文标记的规则只在 model/description-markers.ts 一处，本文件直接用那个出处。
import { rewriteDescriptionWithHiddenParent } from '../model/description-markers.js'
import { failGlab } from '../errors.js'
import { fetchRawIssue } from '../issues/read.js'
// 仓库标识的取法与优先级只在 model/repo-identity.ts 一处（#1910）。
import { repoRefId } from '../model/repo-identity.js'
// 请求的形状只在房间根目录 requests.ts 一处（#1920）：本文件只收原始进程结果，再按旧口径判档与核对。
import { requestIssuePatch, requestUserByName } from '../requests.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml；每次请求用哪一档由本文件按操作选。
import { GITLAB_READ_TIMEOUT_MS, GITLAB_PROBE_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'

// 仓库身份只取 refId/name，是因为亲缘与指派只认这两样，拿全量会把 effortId 搅进来。
type RepoLike = Partial<RepositoryRef> | null | undefined
// 上下文两形都收，是因为调用方有时把执行器放在 ctx、有时放在 opCtx，缺了就让请求边界按 127 如实回。
type CtxLike = Partial<OpContext> & Partial<BackendContext>

type RawBag = Record<string, unknown>

function errMsg(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'message' in (err as Record<string, unknown>)) {
    const m = (err as Record<string, unknown>)['message']
    if (typeof m === 'string' && m) return m
  }
  return String(err)
}

function rawUpdatedAt(curRaw: unknown): string {
  const bag = curRaw !== null && typeof curRaw === 'object' ? (curRaw as RawBag) : null
  if (!bag) return ''
  if (typeof bag['updated_at'] === 'string') return String(bag['updated_at'])
  if (typeof bag['updatedAt'] === 'string') return String(bag['updatedAt'])
  return ''
}

/**
 * 挂亲缘：子票归属的唯一真相是它自己文件头里的隐藏标记 `<!-- DSH-PARENT: <父票> -->`。
 * parentKey 为 null 时拆掉这一行，否则幂等写上这一行，再回读归一并核对语义（写后读回的
 * parentKey 对不上要写的就回 conflict，不把“写丢了”包装成成功）。旧 `Part of #<父票>` 可见行
 * 在写时顺手置换掉，不再新增。
 * 不再 POST 任何 links：`relates_to` 是对称的平级关联，分不出哪一头是父。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param key 票号（iid 字符串）
 * @param parentKey 父票号（null 表示拆掉）
 * @param opts 乐观并发选项（对不上就回 conflict，不写）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function setParent(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  parentKey: string | null,
  opts: SetOpts | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoRefId(repo)
  // 原文给空串：这一条是本地入参不全（远端一个请求都没发），没有外部原文可取。
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'setParent: repo.refId missing', '')
  const k = String(key)
  try {
    // If-Match
    const curRaw = (await (fetchRawIssue as (c: unknown, i: string, kk: string) => Promise<unknown>)(effective, id, k)) as unknown
    if (!curRaw || typeof curRaw !== 'object') {
      // 原文给空串：票面没读回来（远端一个写请求都没发），没有外部原文可取。
      return fail(ERROR_KIND.NOTFOUND as ErrorKind, `issue ${k} not found`, '')
    }
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const cur = rawUpdatedAt(curRaw)
      if (cur !== opts.expectedUpdatedAt) {
        // 原文 = 回读到的票面（人据此自己核对远端现在是什么版本），不是给人看的那句冲突话。
        return fail(ERROR_KIND.CONFLICT as ErrorKind, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur})`, JSON.stringify(curRaw))
      }
    }
    if (parentKey === null) {
      const newBody = rewriteDescriptionWithHiddenParent(
        String((curRaw as RawBag)['description'] || (curRaw as RawBag)['body'] || ''),
        null,
      )
      const oldBody = String((curRaw as RawBag)['description'] || (curRaw as RawBag)['body'] || '')
      if (newBody === oldBody) {
        // 本来就没有这一行：一次写都不发，直接回读回来的样子。
        const issue = normalizeIssue(curRaw)
        return { ok: true, data: issue }
      }
      const res = await requestIssuePatch(effective, id, k, { description: newBody }, GITLAB_READ_TIMEOUT_MS)
      if (res.code !== 0) {
        // 原文 = 拆归属行那一次 PUT 的进程结果。
        return failGlab(res, res.stderr || res.stdout || 'setParent failed', res, effective)
      }
    } else {
      const pk = String(parentKey)
      // 环检：parentKey成环 → conflict（若 pk == k 自环）
      // 自环先判：结论是「入参自己和自己打架」，不是外部来源说了什么，所以原文给这次入参快照。
      if (pk === k) return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: self-parent', JSON.stringify({ key: k, parentKey: pk }), TRACKER_ERROR_STAGE.INPUT_REFUSED)
      const oldBody = String((curRaw as RawBag)['description'] || (curRaw as RawBag)['body'] || '')
      const newBody = rewriteDescriptionWithHiddenParent(oldBody, pk)
      if (newBody !== oldBody) {
        // PUT 整篇 description（换行原样发，不转义：读回来的归一靠真实换行认行）。
        const res = await requestIssuePatch(effective, id, k, { description: newBody }, GITLAB_READ_TIMEOUT_MS)
        if (res.code !== 0) {
          // 原文 = 写归属行那一次 PUT 的进程结果。
          return failGlab(res, res.stderr || res.stdout || 'setParent failed', res, effective)
        }
      }
    }
    const raw = ((await (fetchRawIssue as (c: unknown, i: string, kk: string) => Promise<unknown>)(effective, id, k)) as RawBag) || {}
    const issue = normalizeIssue(raw)
    // 写后语义核对：读回的归属必须等于要写的（null 表示拆干净）。对不上说明远端没落盘
    // 或并发改了，如实回 conflict——调用方凭原文（回读到的票面）自己核对远端现在是什么。
    const want = parentKey === null ? null : String(parentKey)
    if (issue.parentKey !== want) {
      return fail(ERROR_KIND.CONFLICT as ErrorKind, `conflict: parent write readback mismatch (want ${want === null ? '无' : '#' + want} got ${issue.parentKey === null ? '无' : '#' + issue.parentKey})`, JSON.stringify(raw))
    }
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身。
    return failGlab(err, errMsg(err), err, effective)
  }
}

/**
 * 换指派：先把登录名逐个换成用户 id，再 PUT assignee_ids，失败带原文回。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param key 票号（iid 字符串）
 * @param assignees 要换成的整集（裸串与对象两形都收）
 * @param opts 乐观并发选项（对不上就回 conflict，不写）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function setAssignees(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  assignees: AssigneeInput[],
  opts: SetOpts | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoRefId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'setAssignees: repo.refId missing', '')
  const k = String(key)
  const wanted: string[] = Array.isArray(assignees)
    ? (assignees as unknown[])
        .map((a) => (typeof a === 'string' ? a : a !== null && typeof a === 'object' ? String((a as RawBag)['login'] || '') : ''))
        .filter(Boolean)
    : []
  try {
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const curRaw = (await (fetchRawIssue as (c: unknown, i: string, kk: string) => Promise<unknown>)(effective, id, k)) as unknown
      const cur = rawUpdatedAt(curRaw)
      if (cur !== opts.expectedUpdatedAt) {
        // 原文 = 回读到的票面（人据此自己核对远端现在是什么版本）。
        return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: expectedUpdatedAt mismatch', JSON.stringify(curRaw))
      }
    }
    // GitLab single/multi assignee: PUT assignee_ids
    // 需解析 username→id（via GET /users?username=）
    // 先把每个用户名换成用户 id。换不出来（查不到这个人，或者查人这一步本身没跑成）的记在
    // unresolved 里；只要有一个，就整步停在这里，一个写请求都不发。原因是 PUT assignee_ids 给的是
    // 整集：少写一个名字，GitLab 就会把那个人的认领删掉，人却只看到「成了 0 步」。
    const assigneeIds: string[] = []
    const unresolved: string[] = []
    for (const u of wanted) {
      let resolved = ''
      try {
        const probe = await requestUserByName(effective, u, GITLAB_PROBE_TIMEOUT_MS)
        if (probe.code === 0) {
          const arr: unknown = JSON.parse(probe.stdout) as unknown
          if (Array.isArray(arr) && arr[0] && (arr[0] as RawBag)['id']) {
            resolved = String((arr[0] as RawBag)['id'])
          }
        }
      } catch {
        // 查人这一步抛错，同样算换不出 id，交给下面的整步失败处理，不再吞掉接着写。
      }
      if (resolved !== '') assigneeIds.push(resolved)
      else unresolved.push(u)
    }
    if (unresolved.length > 0) {
      // 一个写请求都没发出去，远端认领还是原样，所以原文给空串。
      return fail(
        ERROR_KIND.NOTFOUND as ErrorKind,
        `认领人用户名不存在：${unresolved.join('、')}。原认领没有改动，这次没有发出写请求。`,
        '',
      )
    }
    const res = await requestIssuePatch(effective, id, k, { assignee_ids: assigneeIds.join(',') }, GITLAB_READ_TIMEOUT_MS)
    if (res.code !== 0) {
      // 原文 = 写指派那一次 PUT 的进程结果。
      return failGlab(res, res.stderr || res.stdout || 'setAssignees failed', res, effective)
    }
    let raw: unknown = null
    try {
      raw = JSON.parse(res.stdout) as unknown
    } catch {
      raw = { iid: k }
    }
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身。
    return failGlab(err, errMsg(err), err, effective)
  }
}
