/**
 * backends/gitlab/issues.ts — issue 操作（list/get/create/close/reopen/update）。
 *
 * 按 #135/#144：REST主路径，list/get均聚合 notes+links 后 normalize；分页per_page；milestone更新走milestone_id。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { Issue, RepositoryRef } from '../../contract/entities.js'
import type { CloseOpts, CreateInput, GetOpts, ListFilter, UpdatePatch } from '../../contract/inputs.js'
import type { OpResult } from '../../contract/results.js'
import { fail } from '../../preflight.js'
import { glabClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { failGlab } from './errors.js'
import { issuesPath, issuePath, notesPath, linksPath, milestonesPath } from './queries.js'
// #711：创建幂等锚。锚那一行怎么拼、命中判据是什么，在刷新核心的产物里（唯一一处判据）；
// 本间房专属的「建后按锚回查」在 ./idempotency.js（服务端搜索 + 按创建时间倒序列出逐张看票面）。
import { checkIdempotencyKey } from '../../../shared/refresh/idempotency.js'
import { withAnchor, lookupByAnchor } from './idempotency.js'
// #722：建票只有一条写路径（POST 到集合端点），发几次、许不许再发一次由纯函数判。
// 不许再写成「先发 PUT、拿不到票面再回落发 POST」——那是一次调用里两次可能都成功的写。
import { writeNewIssue, createWriteFailureKind, createWriteFailureMessage } from './create-write.js'
import type { CreateIssueBody } from './create-write.js'

// 仓库身份只取 refId/name，是因为票读写只认这两样，拿全量会把 effortId 搅进来。
type RepoLike = Partial<RepositoryRef> | null | undefined
// 上下文两形都收，是因为调用方有时把执行器放在 ctx、有时放在 opCtx，缺了就让 glabClient 按 127 回。
type CtxLike = Partial<OpContext> & Partial<BackendContext>
type RawBag = Record<string, unknown>

function repoId(repo: RepoLike): string {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

function parseJsonSafe(s: string): unknown {
  try {
    return JSON.parse(s) as unknown
  } catch {
    return null
  }
}

function errMsg(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'message' in (err as Record<string, unknown>)) {
    const m = (err as Record<string, unknown>)['message']
    if (typeof m === 'string' && m) return m
  }
  return String(err)
}

// 抛出去的错要带原始回包，是因为上层只 catch 到一个 Error，原文得躺在错身上才拿得到。
interface ApiError extends Error {
  stderr?: string
  stdout?: string
  code?: number
}

function toApiError(message: string, stderr: string, stdout: string, code: number): ApiError {
  const err = { message, stderr, stdout, code }
  return Object.assign(new Error(err.message), err) as ApiError
}

async function apiGet(opCtx: CtxLike | null | undefined, path: string): Promise<unknown> {
  const c = glabClient(opCtx as Partial<OpContext> & Partial<BackendContext>)
  const res = await c.run(['api', path], { timeout: 8000 })
  if (res.code !== 0) {
    throw toApiError(res.stderr || res.stdout || `api ${path} failed`, res.stderr, res.stdout, res.code)
  }
  return parseJsonSafe(res.stdout)
}

async function apiPut(opCtx: CtxLike | null | undefined, path: string, body: RawBag): Promise<unknown> {
  const c = glabClient(opCtx as Partial<OpContext> & Partial<BackendContext>)
  const args = ['api', path, '--method', 'PUT']
  for (const [k, v] of Object.entries(body || {})) {
    if (v == null) continue
    if (Array.isArray(v)) args.push('-f', `${k}=${(v as unknown[]).join(',')}`)
    else args.push('-f', `${k}=${String(v)}`)
  }
  const res = await c.run(args, { timeout: 8000 })
  if (res.code !== 0) {
    throw toApiError(res.stderr || res.stdout || `api PUT ${path} failed`, res.stderr, res.stdout, res.code)
  }
  return parseJsonSafe(res.stdout)
}

async function fetchAugment(opCtx: CtxLike | null | undefined, refId: string, raw: RawBag): Promise<RawBag> {
  const iid = raw['iid']
  if (iid == null) return raw
  // 聚合 notes + links（best-effort，失败忽略）
  try {
    const notes = await apiGet(opCtx, notesPath(refId, iid as string | number))
    if (Array.isArray(notes)) raw['notes'] = notes
  } catch {
    // 聚合失败就按无聚合归一，不拦主流程。
  }
  try {
    const links = await apiGet(opCtx, linksPath(refId, iid as string | number))
    if (Array.isArray(links)) raw['links'] = links
  } catch {
    // 聚合失败就按无聚合归一，不拦主流程。
  }
  return raw
}

/**
 * 列票：按 state 筛后归一，keys 在内存里滤（远端无批量接口，如实全量再滤）。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param filter 过滤器（state/keys 两项，其余由宿主二次过滤）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function listIssues(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  filter: ListFilter | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue[]>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'list: repo.refId missing', '')
  // filter → query（state/labels/milestone/分页）
  const params = new URLSearchParams()
  params.set('per_page', '100')
  params.set('with_labels_details', 'true')
  if (filter && filter.state) {
    // GitLab state: opened/closed
    params.set('state', filter.state === 'closed' ? 'closed' : 'opened')
  }
  if (filter && Array.isArray(filter.keys) && filter.keys.length) {
    // GitLab无批量keys过滤，返回全量后前端过滤（诚实）
  }
  try {
    const path = issuesPath(id, params.toString())
    const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
    const res = await c.run(['api', path], { timeout: 10000 })
    if (res.code !== 0) {
      // 原文 = 列票那一次 glab 调用的进程结果。
      return failGlab(res, res.stderr || res.stdout || 'list failed', res, effective)
    }
    let arr: unknown = parseJsonSafe(res.stdout)
    // 原文 = 远端回的那一段（人据此看出返回的到底是什么形状，而不是只被告知「不是数组」）。
    if (!Array.isArray(arr)) return fail(ERROR_KIND.PARSE as ErrorKind, 'list returned non-array', res.stdout)
    // 若filter有keys，内存过滤
    if (filter && Array.isArray(filter.keys) && filter.keys.length) {
      const set = new Set(filter.keys.map(String))
      arr = (arr as RawBag[]).filter((x) => set.has(String(x['iid'])))
    }
    if (filter && filter.parentKey !== undefined) {
      // parentKey过滤需links聚合（heavy），此处先返回全量由宿主侧二次过滤（诚实但不阻塞）
    }
    // 归一（不逐条聚合links以免爆量；get会聚合）
    const issues = (arr as unknown[]).map((raw) => normalizeIssue(raw))
    return { ok: true, data: issues }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（apiGet/apiPut 已经把 stderr/stdout/退出码挂在它身上）。
    return failGlab(err, errMsg(err), err, effective)
  }
}

/**
 * 读单票：主票面加聚合 notes/links 后归一，回包不是票形就按没找到回。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param key 票号（iid 字符串）
 * @param opts 读选项（今天只有评论分页，由宿主处理）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function getIssue(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  opts: GetOpts | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  void opts
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'get: repo.refId missing', '')
  const k = String(key)
  if (!k) return fail(ERROR_KIND.PARSE as ErrorKind, 'get: key required', '')
  try {
    const raw = (await apiGet(effective, `${issuePath(id, k)}?with_labels_details=true`)) as RawBag | null
    // 原文 = 这次接口回给我们的那个值（它不是一张票的形状，所以按「没找到」如实失败）。
    if (!raw || typeof raw !== 'object') {
      return fail(ERROR_KIND.NOTFOUND as ErrorKind, `issue ${k} not found`, raw === undefined || raw === null ? '' : raw)
    }
    await fetchAugment(effective, id, raw)
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（apiGet/apiPut 已经把 stderr/stdout/退出码挂在它身上）。
    return failGlab(err, errMsg(err), err, effective)
  }
}

/**
 * 建票：先验幂等键、按锚回查命中就复用，否则走单写路径，parentKey 在建后链 relates_to。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param input 建票输入（标题必填，幂等键不合规当场拦）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function createIssue(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  input: CreateInput,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'create: repo.refId missing', '')
  if (!input || typeof input.title !== 'string' || !input.title.trim()) {
    return fail(ERROR_KIND.PARSE as ErrorKind, 'create: title required', '')
  }
  try {
    // #711：幂等键当场检查 —— 不合规的键绝不落到 description 上，而且必须比回查更早失败。
    // 值实现来自构建产物 .js（无类型），检查结果以源码 .ts 的形状为准，只收敛类型不改逻辑。
    const wantKey =
      input.idempotencyKey === undefined || input.idempotencyKey === null
        ? null
        : (checkIdempotencyKey(input.idempotencyKey) as unknown as { ok: boolean; key: string; reason: string })
    // 原文给这次用不了的键本身（判据不成立的原因在 message 里，原文让人看见实际给的是什么）。
    if (wantKey && !wantKey.ok) {
      return fail(ERROR_KIND.PARSE as ErrorKind, 'create: idempotencyKey 不能用：' + wantKey.reason, String(input.idempotencyKey))
    }
    const idemKey = wantKey ? wantKey.key : ''
    // #711：建票之前先按锚回查（回查看的是票面上的 description，不是内存里的表）。
    // 命中就复用那张票、返回同一个 key，一个字节都不再往远端写；回查拿不准时如实失败、绝不建票。
    if (idemKey) {
      const found = await lookupByAnchor(repo, idemKey, effective)
      if (!found.ok) return found
      if (found.hit) return { ok: true, data: found.issue }
    }
    const body: CreateIssueBody = { title: input.title.trim() }
    // 锚写在 description 的第一行（渲染后看不见的 HTML 注释），重试时凭它把这张票找回来。
    const description = withAnchor(typeof input.body === 'string' ? input.body : '', idemKey)
    if (description) body.description = description
    if (Array.isArray(input.labels) && input.labels.length) {
      const names = input.labels
        .map((l) => (typeof l === 'string' ? l : (l as { name?: unknown })['name']))
        .filter((x): x is string => typeof x === 'string' && Boolean(x))
      if (names.length) body.labels = names.join(',')
    }
    // #722：到这里建票只走一条写路径（POST 到集合端点），回包判据与「许不许再发一次」都在纯函数里。
    // 「可能已经写出去」的回包（超时、EOF、回包形状不对、5xx）一律不再发第二次写，只如实失败并带上幂等键。
    // parentKey → 创建后链 relates_to
    const written = await writeNewIssue(effective as Partial<OpContext> & Partial<BackendContext>, id, body)
    if (written.verdict.verdict !== 'created') {
      // 原文 = 建票那一次写路径的判据对象（回包形状、超时/EOF 都在里面）+ 实际发出去的 argv。
      // 这两样合起来才够人判断「那次写到底有没有落到远端」——正是这条支路要回答的问题。
      const writeRaw = JSON.stringify({ verdict: written.verdict, argvs: written.argvs })
      return fail(createWriteFailureKind(written.verdict), createWriteFailureMessage(written.verdict, idemKey, written.argvs), writeRaw)
    }
    const raw = (written.verdict.issue || {}) as RawBag
    // 若有parentKey，建立 relates_to
    if (input.parentKey != null) {
      try {
        const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
        await c.run(
          ['api', `${issuePath(id, String(raw['iid']))}/links`, '--method', 'POST', '-f', `target_project_id=${id}`, '-f', `target_issue_iid=${String(input.parentKey)}`, '-f', 'link_type=relates_to'],
          { timeout: 8000 },
        )
      } catch {
        // 亲缘链失败不拦建票主流程，票已建成，后续可补挂。
      }
    }
    await fetchAugment(effective, id, raw)
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（apiGet/apiPut 已经把 stderr/stdout/退出码挂在它身上）。
    return failGlab(err, errMsg(err), err, effective)
  }
}

/**
 * 关票：PUT state_event=close，失败带原文回。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param key 票号（iid 字符串）
 * @param opts 关票选项（关闭原因由后端默认处理）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function closeIssue(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  opts: CloseOpts | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  void opts
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'close: repo.refId missing', '')
  const k = String(key)
  try {
    const raw = ((await apiPut(effective, issuePath(id, k), { state_event: 'close' })) || { iid: k, state: 'closed' }) as unknown
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（apiGet/apiPut 已经把 stderr/stdout/退出码挂在它身上）。
    return failGlab(err, errMsg(err), err, effective)
  }
}

/**
 * 重开：PUT state_event=reopen，失败带原文回。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param key 票号（iid 字符串）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function reopenIssue(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'reopen: repo.refId missing', '')
  const k = String(key)
  try {
    const raw = ((await apiPut(effective, issuePath(id, k), { state_event: 'reopen' })) || { iid: k, state: 'opened' }) as unknown
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（apiGet/apiPut 已经把 stderr/stdout/退出码挂在它身上）。
    return failGlab(err, errMsg(err), err, effective)
  }
}

/**
 * 改票：标题与正文直写，里程碑按名换 id，空补丁直接读回，自定义字段报不支持。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param key 票号（iid 字符串）
 * @param patch 补丁（多字段一次原子写）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function updateIssue(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  patch: UpdatePatch,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'update: repo.refId missing', '')
  const k = String(key)
  if (!patch || typeof patch !== 'object') return fail(ERROR_KIND.PARSE as ErrorKind, 'update: patch required', '')
  try {
    const body: RawBag = {}
    if (typeof patch.title === 'string') body['title'] = patch.title
    if (typeof patch.body === 'string') body['description'] = patch.body
    if ('milestone' in patch) {
      if (patch.milestone === null) body['milestone_id'] = 0 // 清除
      else if (patch.milestone && typeof patch.milestone.name === 'string') {
        // 查 milestone_id
        const search = encodeURIComponent(patch.milestone.name)
        const miles = (await apiGet(effective, milestonesPath(id, `search=${search}`))) as unknown
        const found = Array.isArray(miles)
          ? (miles as RawBag[]).find((m) => m['title'] === patch.milestone!.name)
          : null
        // 原文 = 按名字查里程碑那一次 GET 的回包（人据此看出远端到底有哪些里程碑）。
        if (!found) return fail(ERROR_KIND.NOTFOUND as ErrorKind, `milestone '${patch.milestone.name}' not found`, JSON.stringify(miles))
        body['milestone_id'] = found['id']
      }
    }
    if (Array.isArray(patch.customFields) && patch.customFields.length) {
      // 原文给这次传进来的那些自定义字段（这条支路一个请求都没发，没有远端回包）。
      return fail(ERROR_KIND.UNSUPPORTED as ErrorKind, 'customFields not supported on gitlab', JSON.stringify(patch.customFields))
    }
    if (Object.keys(body).length === 0) {
      // 无可更新字段，返回当前
      return getIssue(ctx, repo, k, {}, effective)
    }
    const raw = ((await apiPut(effective, issuePath(id, k), body)) || { iid: k }) as unknown
    await fetchAugment(effective, id, (raw || { iid: k }) as RawBag)
    const issue = normalizeIssue((raw || { iid: k, ...body }) as unknown)
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（apiGet/apiPut 已经把 stderr/stdout/退出码挂在它身上）。
    return failGlab(err, errMsg(err), err, effective)
  }
}

export default { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue }
