/**
 * src/tracker/rooms/gitlab/issues/write.ts —— 票的写路径：建票、关票、重开、改票（#1913）。
 *
 * 为什么在 issues/ 子树：票是一个概念，读在 read.ts、写在 write.ts；根目录 issues.ts 只剩转发，
 * 房外按旧路径 import 的六个名字因此不用改。
 *
 * 请求的形状不在这里：建票走 issues/create-write.ts 的单写路径（它再调根目录 requests.ts 的
 * requestIssueCreate），关票、重开、改正文、改认领人与改票走 requests.ts 各自的具名函数，按名字
 * 查里程碑走 requestMilestones。本文件只做拿到原始进程结果之后的事：非零退出码按原话术抛、解析
 * JSON、归一成契约形状。读请求与写请求共用的回包收尾助手在 ./shared.ts 一处。
 * 行为与搬迁前逐字一致，包括失败话术、错误档位、空补丁读回与自定义字段的拒绝。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { Issue, RepositoryRef } from '../../../contract/entities.js'
import type { CloseOpts, CreateInput, UpdatePatch } from '../../../contract/inputs.js'
import type { OpResult } from '../../../contract/results.js'
import { TRACKER_ERROR_STAGE } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import type { GlabRunResult } from '../client.js'
import { normalizeIssue } from '../model/normalize.js'
// 正文标记的规则只在 model/description-markers.ts 一处，本文件直接用那个出处。
import { rewriteDescriptionWithHiddenParent } from '../model/description-markers.js'
import { failGlab } from '../errors.js'
import { issuePath, milestonesPath } from '../queries.js'
// #711：创建幂等锚。锚那一行怎么拼、命中判据是什么，在刷新核心的产物里（唯一一处判据）；
// 本间房专属的「建后按锚回查」在 ./idempotency.ts（服务端搜索 + 按创建时间倒序列出逐张看票面）。
import { checkIdempotencyKey } from '../../../../refresh/contract/idempotency-keys.js'
import { withAnchor, lookupByAnchor } from './idempotency.js'
// #722：建票只有一条写路径（POST 到集合端点），发几次、许不许再发一次由纯函数判。
// 不许再写成「先发 PUT、拿不到票面再回落发 POST」——那是一次调用里两次可能都成功的写。
import { writeNewIssue, createWriteFailureKind, createWriteFailureMessage } from './create-write.js'
import type { CreateIssueBody } from './create-write.js'
// 仓库标识的取法与优先级只在 model/repo-identity.ts 一处（#1910）。
import { repoRefId } from '../model/repo-identity.js'
// 票的读半边住在同一个概念目录里：建票后的富化与改票的空补丁回读仍要用它交出的函数。
import { getIssue, fetchAugment } from './read.js'
// 票读与票写共用的回包收尾助手只在同目录的 shared.ts 一处（#1907 评审修复）。
import { apiJson, errMsg, parseJsonSafe, toApiError } from './shared.js'
// 写端点与里程碑查询的形状住在房间根目录的 requests.ts（#1913）：本文件只传领域值。
import { requestIssueClose, requestIssueReopen, requestIssueUpdate, requestMilestones } from '../requests.js'
import type { IssueUpdateFields } from '../requests.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml；请求函数收领域值 timeoutMs，档位由这里按操作选。
import { GITLAB_READ_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'

// 仓库身份只取 refId/name，是因为票读写只认这两样，拿全量会把 effortId 搅进来。
type RepoLike = Partial<RepositoryRef> | null | undefined
// 上下文两形都收，是因为调用方有时把执行器放在 ctx、有时放在 opCtx，缺了就让请求函数里的 glabClient 按 127 回。
type CtxLike = Partial<OpContext> & Partial<BackendContext>
type RawBag = Record<string, unknown>

/**
 * 把一次已经发出去的写请求（PUT）收成 JSON。
 *
 * 与读请求同一套处理，只有兜底话术里多一个 PUT：搬家前 apiPut 的失败消息是
 * `api PUT <路径> failed`，这句话原样留住，排障时仍能一眼看出失败的是哪条写请求。
 *
 * @param request 已经发出的那次请求的承诺（调用请求函数时请求就开始了）
 * @param path 这次请求的路径（只在 stderr 与 stdout 都为空时用来兜底）
 * @returns 解析出来的值；回包不是 JSON 时回 null（旧行为）
 */
async function apiPut(request: Promise<GlabRunResult>, path: string): Promise<unknown> {
  const res = await request
  if (res.code !== 0) {
    throw toApiError(res.stderr || res.stdout || `api PUT ${path} failed`, res.stderr, res.stdout, res.code)
  }
  return parseJsonSafe(res.stdout)
}

/**
 * 建票：先验幂等键、按锚回查命中就复用，否则走单写路径，parentKey 在建票时直接写进文件头的隐藏标记。
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
  const id = repoRefId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'create: repo.refId missing', '')
  if (!input || typeof input.title !== 'string' || !input.title.trim()) {
    // 标题与幂等键都在发出建票请求之前检查：失败说明输入要改，重试同一份输入没有意义，所以标输入被拒。
    return fail(ERROR_KIND.PARSE as ErrorKind, 'create: title required', '', TRACKER_ERROR_STAGE.INPUT_REFUSED)
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
      return fail(ERROR_KIND.PARSE as ErrorKind, 'create: idempotencyKey 不能用：' + wantKey.reason, String(input.idempotencyKey), TRACKER_ERROR_STAGE.INPUT_REFUSED)
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
    let description = withAnchor(typeof input.body === 'string' ? input.body : '', idemKey)
    // parentKey → 建票时直接把隐藏归属标记写进文件头（幂等锚之后；锚按行扫描认得出来，位置不影响回查）。
    if (input.parentKey != null) {
      description = rewriteDescriptionWithHiddenParent(description, String(input.parentKey))
    }
    if (description) body.description = description
    if (Array.isArray(input.labels) && input.labels.length) {
      const names = input.labels
        .map((l) => (typeof l === 'string' ? l : (l as { name?: unknown })['name']))
        .filter((x): x is string => typeof x === 'string' && Boolean(x))
      if (names.length) body.labels = names.join(',')
    }
    // #722：到这里建票只走一条写路径（POST 到集合端点），回包判据与「许不许再发一次」都在纯函数里。
    // 「可能已经写出去」的回包（超时、EOF、回包形状不对、5xx）一律不再发第二次写，只如实失败并带上幂等键。
    // parentKey → 建票时已经写进文件头的隐藏归属标记，建完不再链任何 links：
    // `relates_to` 是对称的平级关联，链上它反而污染归属（读回来分不出哪一头是父）。
    const written = await writeNewIssue(effective as Partial<OpContext> & Partial<BackendContext>, id, body)
    if (written.verdict.verdict !== 'created') {
      // 原文 = 建票那一次写路径的判据对象（回包形状、超时/EOF 都在里面）+ 这次实际发了几次请求。
      // 请求形状已经收进 requests.ts，argv 不再经过这里；判据与次数合起来仍够人判断「那次写到底有没有落到远端」。
      const writeRaw = JSON.stringify({ verdict: written.verdict, attempts: written.attempts })
      return fail(createWriteFailureKind(written.verdict), createWriteFailureMessage(written.verdict, idemKey, written.attempts), writeRaw)
    }
    const raw = (written.verdict.issue || {}) as RawBag
    await fetchAugment(effective, id, raw)
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（请求失败时它带着 stderr/stdout/退出码）。
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
  const id = repoRefId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'close: repo.refId missing', '')
  const k = String(key)
  try {
    const raw = ((await apiPut(
      requestIssueClose(effective, id, k, GITLAB_READ_TIMEOUT_MS),
      issuePath(id, k),
    )) || { iid: k, state: 'closed' }) as unknown
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（请求失败时它带着 stderr/stdout/退出码）。
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
  const id = repoRefId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'reopen: repo.refId missing', '')
  const k = String(key)
  try {
    const raw = ((await apiPut(
      requestIssueReopen(effective, id, k, GITLAB_READ_TIMEOUT_MS),
      issuePath(id, k),
    )) || { iid: k, state: 'opened' }) as unknown
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（请求失败时它带着 stderr/stdout/退出码）。
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
  const id = repoRefId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'update: repo.refId missing', '')
  const k = String(key)
  if (!patch || typeof patch !== 'object') return fail(ERROR_KIND.PARSE as ErrorKind, 'update: patch required', '', TRACKER_ERROR_STAGE.INPUT_REFUSED)
  try {
    const fields: IssueUpdateFields = {}
    if (typeof patch.title === 'string') fields.title = patch.title
    if (typeof patch.body === 'string') fields.description = patch.body
    if ('milestone' in patch) {
      if (patch.milestone === null) fields.milestoneId = 0 // 清除
      else if (patch.milestone && typeof patch.milestone.name === 'string') {
        // 查 milestone_id
        const search = encodeURIComponent(patch.milestone.name)
        const query = 'search=' + search
        const miles = (await apiJson(
          requestMilestones(effective, id, query, GITLAB_READ_TIMEOUT_MS),
          milestonesPath(id, query),
        )) as unknown
        const found = Array.isArray(miles)
          ? (miles as RawBag[]).find((m) => m['title'] === patch.milestone!.name)
          : null
        // 原文 = 按名字查里程碑那一次 GET 的回包（人据此看出远端到底有哪些里程碑）。
        if (!found) return fail(ERROR_KIND.NOTFOUND as ErrorKind, `milestone '${patch.milestone.name}' not found`, JSON.stringify(miles))
        fields.milestoneId = found['id'] as string | number
      }
    }
    if (Array.isArray(patch.customFields) && patch.customFields.length) {
      // 原文给这次传进来的那些自定义字段（这条支路一个请求都没发，没有远端回包）。
      return fail(ERROR_KIND.UNSUPPORTED as ErrorKind, 'customFields not supported on gitlab', JSON.stringify(patch.customFields))
    }
    if (Object.keys(fields).length === 0) {
      // 无可更新字段，返回当前
      return getIssue(ctx, repo, k, {}, effective)
    }
    const raw = ((await apiPut(
      requestIssueUpdate(effective, id, k, fields, GITLAB_READ_TIMEOUT_MS),
      issuePath(id, k),
    )) || { iid: k }) as unknown
    await fetchAugment(effective, id, (raw || { iid: k }) as RawBag)
    const issue = normalizeIssue((raw || { iid: k }) as unknown)
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（请求失败时它带着 stderr/stdout/退出码）。
    return failGlab(err, errMsg(err), err, effective)
  }
}
