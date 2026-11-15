/**
 * src/tracker/rooms/gitea/issues/write.ts —— gitea 房票的写路径：建票（create）、关票（close）、
 * 重开（reopen）、改票（update）（票 #12）。
 *
 * 与读路径（read.ts）同一条纪律：命令词汇表只在 ../support/tea-run.ts 一处，本文件只做拿到
 * 原始进程结果之后的事——判档、解析回包、归一成契约形状、失败带原文回。
 *
 * tea 的写回包口径（本机 0.16.0 实测）：
 *   · issues create 不认 --output，回包是含井号编号的一行文本——parseCreatedIssueKey 抠出编号后
 *     回查一次票面交契约形状；抠不出编号就如实失败（「可能已经建出去」绝不猜编号）。
 *   · issues close / issues edit 认 --output json，回包就是写完之后的票面。
 * 幂等键：本房今天只做 checkIdempotencyKey 的入参校验（不合规 parse 拒绝）；「建后按锚回查」
 * 依赖服务端搜索，gitlab 房的锚回查写法尚无共享版，等共享后接入（取舍见票 #12）。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { Issue, RepositoryRef } from '../../../contract/entities.js'
import type { CloseOpts, CreateInput, UpdatePatch } from '../../../contract/inputs.js'
import type { OpResult } from '../../../contract/results.js'
import { TRACKER_ERROR_STAGE } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { normalizeIssue } from '../model/normalize.js'
// 正文隐藏标记的规则只在 model/description-markers.ts 一处，建票时 parentKey 直接用它写进正文头。
import { rewriteDescriptionWithHiddenParent } from '../model/description-markers.js'
import { failGitea } from '../errors.js'
// 幂等键判据的唯一出处：校验（不清洗、不合规拒绝）在刷新核心的产物里。
import { checkIdempotencyKey } from '../../../../refresh/contract/idempotency-keys.js'
import { getIssue, fetchRawIssue } from './read.js'
// 目标解析三行守卫收编在 ../support/target.ts 一处（票 #14），四个写操作入口共用。
import { resolveTarget } from '../support/target.js'
import { ensureLabelsExist } from '../labels/assign.js'
import {
  type CtxLike,
  type RawBag,
  argsIssueClose,
  argsIssueCreate,
  argsIssueEdit,
  argsIssueReopen,
  createdKeyFrom,
  writeFailureTexts,
  errMsg,
  parseReadBag,
  runWrite,
  writeFailureError,
} from '../support/tea-run.js'

type RepoLike = Partial<RepositoryRef> | null | undefined

/** 把写命令的 --output json 回包收成一张原始票面；不是票的形状回 null。走 parseReadBag 是
 * 因为 gt 的回包 author/assignees 是登录名字符串（票 #20），要先过 gt 适配层才归一得出——
 * 对 tea 形状的回包它是恒等，行为与改动前一致。 */
function bagOf(stdout: unknown): RawBag | null {
  return parseReadBag(typeof stdout === 'string' ? stdout : '')
}

/**
 * 建票（契约 create）：标题必填、幂等键先校验，parentKey 写进正文头的隐藏归属标记；
 * 建完按回包里的编号回查一次票面，交契约形状。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId）
 * @param input 建票输入
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function createIssue(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  input: CreateInput,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  // 建票没有票号这一格：目标解析只管仓库标识（票号守卫对空串字面量永远不触发）。
  const t = resolveTarget(ctx, repo, '', opCtx, 'create', 'create: repo.refId 缺失，无法向 Gitea 建票')
  if (!t.ok) return t.result
  const { effective, refId } = t
  if (!input || typeof input.title !== 'string' || !input.title.trim()) {
    // 输入要改的失败重试同一份没有意义：标输入被拒（与 GitLab 房同一档位）。
    return fail(ERROR_KIND.PARSE as ErrorKind, 'create: 标题必填', '', TRACKER_ERROR_STAGE.INPUT_REFUSED)
  }
  try {
    // 幂等键当场检查：不合规的键绝不发出建票命令，而且必须早于一切远端写。
    const wantKey =
      input.idempotencyKey === undefined || input.idempotencyKey === null
        ? null
        : (checkIdempotencyKey(input.idempotencyKey) as unknown as { ok: boolean; key: string; reason: string })
    if (wantKey && !wantKey.ok) {
      // 原文给这次用不了的键本身（判据不成立的原因在 message 里，原文让人看见实际给的是什么）。
      return fail(ERROR_KIND.PARSE as ErrorKind, 'create: idempotencyKey 不能用：' + wantKey.reason, String(input.idempotencyKey), TRACKER_ERROR_STAGE.INPUT_REFUSED)
    }
    let description = typeof input.body === 'string' ? input.body : ''
    if (input.parentKey != null) {
      // 隐藏归属标记写在正文头：读侧 parseHiddenParent 认得它，建完不再链任何关联。
      description = rewriteDescriptionWithHiddenParent(description, String(input.parentKey))
    }
    const labelNames = Array.isArray(input.labels)
      ? (input.labels as unknown[])
          .map((l) => (typeof l === 'string' ? l : ((l as Record<string, unknown>) || {})['name']))
          .filter((x): x is string => typeof x === 'string' && Boolean(x))
      : []
    const assigneeLogins = Array.isArray(input.assignees)
      ? (input.assignees as unknown[])
          .map((a) => (typeof a === 'string' ? a : ((a as Record<string, unknown>) || {})['login']))
          .filter((x): x is string => typeof x === 'string' && Boolean(x))
      : []
    // 仓库里还没有的标签先建再挂：tea 的建票 --labels 对不存在的标签静默跳过
    // （真机 2026-11-11 实测口径，与 setLabels 同一条 ensure 路）。
    await ensureLabelsExist(effective, refId, labelNames)
    const res = await runWrite(effective, argsIssueCreate(refId, input.title.trim(), description, labelNames, assigneeLogins))
    if (res.code !== 0) {
      // 原文 = 这一次 CLI 调用的进程结果（stderr 里是执行器或远端的原话）。命令可能已经写出去，
      // 这里绝不重发第二次建票——重复建票正是幂等键要挡的事，如实失败交给上层。
      const t = writeFailureTexts('create')
      return failGitea(writeFailureError(res, effective, t.fallback), t.human, res, effective)
    }
    // 建票编号从回包读（票 #23）：gt 走 --json 回包的 number 格；tea 仍是抠 #编号 文本。
    // 两条路都取不到时如实失败，绝不猜编号、绝不重发。
    const newKey = createdKeyFrom(typeof res.stdout === 'string' ? res.stdout : '')
    if (!newKey) {
      // 回包里抠不出编号：票可能已经建成，绝不猜编号，也绝不重发。原文给建票回包本身。
      return fail(
        ERROR_KIND.PARSE as ErrorKind,
        'create: 建票回包里抠不出新票编号（票可能已建成，请先到 Gitea 核对后再重试）',
        typeof res.stdout === 'string' ? res.stdout : '',
      )
    }
    // 回查一次票面：契约 create 交的是归一后的整张票。
    const raw = await fetchRawIssue(effective, refId, newKey)
    return { ok: true, data: normalizeIssue(raw) }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象（它带着 tea 的 stderr/stdout）。
    return failGitea(err, errMsg(err), err, effective)
  }
}

/**
 * 关票（契约 close）：tea issues close，回包就是关完之后的票面；回包不成形状时按编号兜一张
 * 最小票面（关票这条写本身已经成功，不能因为回包难读把它判成失败）。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId）
 * @param key 票号
 * @param opts 关票选项（关闭原因由远端默认处理，本房不展开）
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
  // 目标解析三行守卫收编在 support/target.ts 一处（票 #14）；各操作的原话消息在这里传进去。
  const t = resolveTarget(ctx, repo, key, opCtx, 'close', 'close: repo.refId 缺失，无法向 Gitea 关票')
  if (!t.ok) return t.result
  const { effective, refId, key: k } = t
  try {
    const res = await runWrite(effective, argsIssueClose(refId, k))
    if (res.code !== 0) {
      // 原文 = 这一次 CLI 调用的进程结果。
      const t = writeFailureTexts('close')
      return failGitea(writeFailureError(res, effective, t.fallback), t.human, res, effective)
    }
    // 写已成功：回包难读不判失败，兜一张最小票面（状态按关后的来）。
    const raw = bagOf(res.stdout) || ({ index: Number(k) || k, state: 'closed' } as RawBag)
    return { ok: true, data: normalizeIssue(raw) }
  } catch (err: unknown) {
    return failGitea(err, errMsg(err), err, effective)
  }
}

/**
 * 重开（契约 reopen）：tea issues reopen（0.16.0 的命令面里 reopen 是独立子命令）。
 * 回包处理与关票同一套。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId）
 * @param key 票号
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function reopenIssue(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  const t = resolveTarget(ctx, repo, key, opCtx, 'reopen', 'reopen: repo.refId 缺失，无法向 Gitea 重开票')
  if (!t.ok) return t.result
  const { effective, refId, key: k } = t
  try {
    const res = await runWrite(effective, argsIssueReopen(refId, k))
    if (res.code !== 0) {
      const t = writeFailureTexts('reopen')
      return failGitea(writeFailureError(res, effective, t.fallback), t.human, res, effective)
    }
    const raw = bagOf(res.stdout) || ({ index: Number(k) || k, state: 'open' } as RawBag)
    return { ok: true, data: normalizeIssue(raw) }
  } catch (err: unknown) {
    return failGitea(err, errMsg(err), err, effective)
  }
}

/**
 * 改票（契约 update）：标题与正文直写（tea issues edit），里程碑按名换名传给 --milestone
 * （tea 按名字认里程碑，清空传空串）；空补丁不发写命令、回读当前票面；自定义字段报不支持。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId）
 * @param key 票号
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
  const t = resolveTarget(ctx, repo, key, opCtx, 'update', 'update: repo.refId 缺失，无法向 Gitea 改票')
  if (!t.ok) return t.result
  const { effective, refId, key: k } = t
  if (!patch || typeof patch !== 'object') {
    return fail(ERROR_KIND.PARSE as ErrorKind, 'update: patch 必填', '', TRACKER_ERROR_STAGE.INPUT_REFUSED)
  }
  try {
    if (Array.isArray(patch.customFields) && patch.customFields.length) {
      // tea 命令面没有自定义字段这一格。原文给这次传进来的那些自定义字段（这条支路一个命令都没发）。
      return fail(ERROR_KIND.UNSUPPORTED as ErrorKind, 'customFields not supported on gitea', JSON.stringify(patch.customFields))
    }
    const fields: Parameters<typeof argsIssueEdit>[2] = {}
    if (typeof patch.title === 'string') fields.title = patch.title
    if (typeof patch.body === 'string') fields.description = patch.body
    if ('milestone' in patch) {
      // tea 的 --milestone 按名字认：给名字，清空给空串；没有名字可传的形状如实拒。
      if (patch.milestone === null) fields.milestone = ''
      else if (patch.milestone && typeof patch.milestone.name === 'string') fields.milestone = patch.milestone.name
    }
    if (Object.keys(fields).length === 0) {
      // 空补丁不发写命令（空操作白花一次配额）：回读当前票面。
      return getIssue(ctx, repo, k, {}, effective)
    }
    const res = await runWrite(effective, argsIssueEdit(refId, k, fields))
    if (res.code !== 0) {
      const t = writeFailureTexts('update')
      return failGitea(writeFailureError(res, effective, t.fallback), t.human, res, effective)
    }
    // 写已成功：回包难读时回查一次票面兜底（改票的回读是契约口径，deck_issue_patch 的写回链路靠它）。
    let raw = bagOf(res.stdout)
    if (!raw) raw = await fetchRawIssue(effective, refId, k)
    return { ok: true, data: normalizeIssue(raw) }
  } catch (err: unknown) {
    return failGitea(err, errMsg(err), err, effective)
  }
}
