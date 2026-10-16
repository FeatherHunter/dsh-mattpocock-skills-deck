// graph-membership.ts —— 以后改亲缘挂载与指派接口时改它：Part of 行挂载、assignee_ids 解析。
// 抓取底座（repoId/fetchRawIssue）从阻塞文件单向导入，不自建第二份（同房互引，老门禁放行）。
import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { Issue, RepositoryRef } from '../../contract/entities.js'
import type { AssigneeInput, SetOpts } from '../../contract/inputs.js'
import type { OpResult } from '../../contract/results.js'
import { fail } from '../../kernel/preflight.js'
import { glabClient } from './client.js'
import { normalizeIssue, rewriteDescriptionWithPartOf } from './normalize.js'
import { failGlab } from './errors.js'
import { issuePath } from './queries.js'
import { repoId, fetchRawIssue } from './graph-blocking.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GITLAB_READ_TIMEOUT_MS, GITLAB_PROBE_TIMEOUT_MS } from '../../../shared/time-config/values.js'

// 仓库身份只取 refId/name，是因为亲缘与指派只认这两样，拿全量会把 effortId 搅进来。
type RepoLike = Partial<RepositoryRef> | null | undefined
// 上下文两形都收，是因为调用方有时把执行器放在 ctx、有时放在 opCtx，缺了就让 glabClient 按 127 回。
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
 * 挂亲缘：子票归属的唯一真相是它自己正文顶部的 `Part of #<父票>` 声明行。
 * parentKey 为 null 时拆掉这一行，否则幂等写上这一行，再回读归一。
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
  const id = (repoId as (r: unknown) => string)(repo)
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
    const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
    if (parentKey === null) {
      const newBody = rewriteDescriptionWithPartOf(
        String((curRaw as RawBag)['description'] || (curRaw as RawBag)['body'] || ''),
        null,
      )
      const oldBody = String((curRaw as RawBag)['description'] || (curRaw as RawBag)['body'] || '')
      if (newBody === oldBody) {
        // 本来就没有这一行：一次写都不发，直接回读回来的样子。
        const issue = normalizeIssue(curRaw)
        return { ok: true, data: issue }
      }
      const res = await c.run(['api', issuePath(id, k), '--method', 'PUT', '-f', `description=${newBody}`], { timeout: GITLAB_READ_TIMEOUT_MS })
      if (res.code !== 0) {
        // 原文 = 拆归属行那一次 PUT 的进程结果。
        return failGlab(res, res.stderr || res.stdout || 'setParent failed', res, effective)
      }
    } else {
      const pk = String(parentKey)
      // 环检：parentKey成环 → conflict（若 pk == k 自环）
      // 自环先判：结论是「入参自己和自己打架」，不是外部来源说了什么，所以原文给这次入参快照。
      if (pk === k) return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: self-parent', JSON.stringify({ key: k, parentKey: pk }))
      const oldBody = String((curRaw as RawBag)['description'] || (curRaw as RawBag)['body'] || '')
      const newBody = rewriteDescriptionWithPartOf(oldBody, pk)
      if (newBody !== oldBody) {
        // PUT 整篇 description（换行原样发，不转义：读回来的归一靠真实换行认行）。
        const res = await c.run(['api', issuePath(id, k), '--method', 'PUT', '-f', `description=${newBody}`], { timeout: GITLAB_READ_TIMEOUT_MS })
        if (res.code !== 0) {
          // 原文 = 写归属行那一次 PUT 的进程结果。
          return failGlab(res, res.stderr || res.stdout || 'setParent failed', res, effective)
        }
      }
    }
    const raw = ((await (fetchRawIssue as (c: unknown, i: string, kk: string) => Promise<unknown>)(effective, id, k)) as RawBag) || {}
    const issue = normalizeIssue(raw)
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
  const id = (repoId as (r: unknown) => string)(repo)
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
    const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
    const assigneeIds: string[] = []
    for (const u of wanted) {
      try {
        const res = await c.run(['api', `users?username=${encodeURIComponent(u)}`], { timeout: GITLAB_PROBE_TIMEOUT_MS })
        if (res.code === 0) {
          const arr: unknown = JSON.parse(res.stdout) as unknown
          if (Array.isArray(arr) && arr[0] && (arr[0] as RawBag)['id']) {
            assigneeIds.push(String((arr[0] as RawBag)['id']))
          }
        }
      } catch {
        // 单个用户换不出 id 就跳过，不拦整批。
      }
    }
    const res = await c.run(['api', issuePath(id, k), '--method', 'PUT', '-f', `assignee_ids=${assigneeIds.join(',')}`], { timeout: GITLAB_READ_TIMEOUT_MS })
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
