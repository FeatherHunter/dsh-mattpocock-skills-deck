/**
 * src/tracker/rooms/gitea/labels/assign.ts —— 给一张票整集替换标签与认领人（契约操作
 * setLabels 与 setAssignees，票 #12）。
 *
 * 与 GitLab 房（labels/assign.ts）同一条纪律：先读后写、乐观并发、写后把调用方要的形状补回去。
 * 与 GitLab 有一处命令面差异必须记牢：tea 没有「整集替换标签」的参数，只有 --add-labels 与
 * --remove-labels，所以 tea 路径的整集替换在这里是**先读现标签、算差集、再按差集发 add/remove**
 * 两步；认领人反而有 --set-assignees 整集替换，一步到位。空集目标 = 移除全部现标签，语义不变。
 *
 * gt 路径（票 #23）：gt issue edit 的 --set-labels 本来就是整集替换（空值清空，票 #20 真机
 * 结论），所以 gt 选中时整集替换直接发 --set-labels 一步到位，不算差集——两条路径对外的
 * 语义（调用方要的集合就是远端最终集合）完全一致，只是指令形状不同。
 *
 * expectedUpdatedAt 前置读：对不上回 conflict（透传档位），绝不后写覆盖先写。
 * 颜色不由调用方持久化：读侧颜色来自仓库标签清单，写后 issue.labels 按调用方给的形状覆盖。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { Issue, Label, RepositoryRef } from '../../../contract/entities.js'
import type { AssigneeInput, LabelInput, SetOpts } from '../../../contract/inputs.js'
import type { OpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { normalizeIssue } from '../model/normalize.js'
import { failGitea } from '../errors.js'
import { fetchRawIssue } from '../issues/read.js'
// 目标解析守卫与 expectedUpdatedAt 前置读收编在 support/ 一处（票 #14），不再各房私有。
import { resolveTarget } from '../support/target.js'
import { preflightExpected } from '../support/expected-preflight.js'
import { PAGINATION } from '../../../contract/pagination.js'
import {
  type CtxLike,
  type RawBag,
  argsIssueEdit,
  argsLabelCreate,
  argsLabelsPage,
  errMsg,
  parseReadBag,
  writeFailureTexts,
  parseJsonRows,
  parseReadRows,
  selectedCli,
  runRead,
  runWrite,
  writeFailureError,
} from '../support/tea-run.js'

type RepoLike = Partial<RepositoryRef> | null | undefined

/** LabelInput 两形归一：裸串回 {name,color:''}；对象取 name（空名丢弃）。 */
function labelNameOf(li: unknown): string | null {
  if (typeof li === 'string') {
    const name = li.trim()
    return name || null
  }
  if (!li || typeof li !== 'object') return null
  const name = (li as Record<string, unknown>)['name']
  if (typeof name !== 'string' || !name.trim()) return null
  return name.trim()
}

/** 整集目标归一成去重后的名字列表（保持调用方给的顺序）。 */
function wantedNamesOf(labels: unknown): string[] {
  if (!Array.isArray(labels)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const li of labels as unknown[]) {
    const name = labelNameOf(li)
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** AssigneeInput 两形归一：裸串回登录名；对象取 login（空名丢弃），去重。 */
function wantedLoginsOf(assignees: unknown): string[] {
  if (!Array.isArray(assignees)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const ai of assignees as unknown[]) {
    let login: string | null = null
    if (typeof ai === 'string') login = ai.trim() || null
    else if (ai && typeof ai === 'object') {
      const v = (ai as Record<string, unknown>)['login']
      login = typeof v === 'string' && v.trim() ? v.trim() : null
    }
    if (!login || seen.has(login)) continue
    seen.add(login)
    out.push(login)
  }
  return out
}

// expectedUpdatedAt 前置读收编在 ../support/expected-preflight.ts 一处（票 #14 评审收编），
// setLabels / setAssignees 与 graph/write.ts 的两条结构写走同一份。

/**
 * 翻页拉一遍仓库标签名（供 ensureLabelsExist 对照用）：翻页判据与 listLabels 同一套，
 * 到顶还是满页就抛错由调用方按 env 档失败——这里不静默截断，截断会让「以为存在」的标签漏建。
 */
async function repoLabelNames(effective: CtxLike | null | undefined, refId: string): Promise<string[]> {
  const perPage = PAGINATION.gitea.labelListPerPage
  const maxPages = PAGINATION.gitea.labelListMaxPages
  const names: string[] = []
  for (let page = 1; page <= maxPages; page += 1) {
    // 标签清单是读操作：与 listLabels 同一入口（runRead），gt/tea 分派与回包解析都在那一处。
    const res = await runRead(effective, argsLabelsPage(refId, perPage, page))
    if (res.code !== 0) {
      throw new Error(res.stderr || res.stdout || 'ensureLabels: 标签清单读取失败')
    }
    const text = typeof res.stdout === 'string' ? res.stdout : ''
    const batch = parseReadRows(text)
    if (!batch) throw new Error('ensureLabels: 回包不是插件预期的数组形状')
    for (const raw of batch as unknown[]) {
      const name = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['name'] : raw
      if (typeof name === 'string' && name.trim()) names.push(name)
    }
    if (batch.length < perPage) return names
    if (page === maxPages) {
      throw new Error('ensureLabels: 标签数超出一次能取的上限（' + String(maxPages * perPage) + ' 个）')
    }
  }
  return names
}

/**
 * 确保调用方要的标签在仓库里都存在，缺哪条补建哪条（真机口径：tea 对不存在的标签静默跳过，
 * --add-labels 与建票 --labels 都一样，不先建就会报成功实际没写上）。建失败如实抛错，
 * 由调用方的 failGitea 落档——绝不在标签没建齐的情况下继续挂标签。
 */
export async function ensureLabelsExist(
  effective: CtxLike | null | undefined,
  refId: string,
  wanted: string[],
): Promise<void> {
  if (!wanted.length) return
  const existing = new Set(await repoLabelNames(effective, refId))
  for (const name of wanted) {
    if (existing.has(name)) continue
    const res = await runWrite(effective, argsLabelCreate(refId, name))
    if (res.code !== 0) {
      throw new Error(res.stderr || res.stdout || 'ensureLabels: 建标签失败（' + name + '）')
    }
  }
}

/**
 * 整集替换一张票的标签（契约 setLabels）：expectedUpdatedAt 前置读，随后按「现标签 → 差集」
 * 发 --add-labels / --remove-labels（tea 没有整集替换参数，见文件头），写后回读交契约形状。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId）
 * @param key 票号
 * @param labels 要换成的整集（裸串与对象两形都收，重名去重）
 * @param opts 乐观并发选项（对不上就回 conflict，不写）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function setLabels(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  labels: LabelInput[],
  opts: SetOpts | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  // 目标解析三行守卫收编在 support/target.ts 一处（票 #14）；各操作的原话消息在这里传进去。
  const t = resolveTarget(ctx, repo, key, opCtx, 'setLabels', 'setLabels: repo.refId 缺失，无法向 Gitea 改标签')
  if (!t.ok) return t.result
  const { effective, refId, key: k } = t
  const wanted = wantedNamesOf(labels)
  try {
    let pre = await preflightExpected(effective, refId, k, opts)
    if (pre && 'ok' in (pre as OpResult<Issue>)) return pre as OpResult<Issue>
    if (!pre) {
      // 没给 expectedUpdatedAt 时 preflight 不会读：差集必须以远端现标签为准，自己读一次。
      pre = await fetchRawIssue(effective, refId, k)
    }
    const current = Array.isArray((pre as RawBag | null)?.['labels'])
      ? ((pre as RawBag)['labels'] as unknown[])
          .map((l) => ((l && typeof l === 'object' ? (l as RawBag)['name'] : l)) as unknown)
          .filter((x): x is string => typeof x === 'string' && Boolean(x))
      : []
    const curSet = new Set(current)
    const add = wanted.filter((n) => !curSet.has(n))
    const wantSet = new Set(wanted)
    const remove = current.filter((n) => !wantSet.has(n))
    if (add.length === 0 && remove.length === 0) {
      // 目标集合与现状一致：不发写命令，把前置读到的票面归一交回（labels 按调用方形状覆盖）。
      const issue = normalizeIssue((pre as RawBag) || ({} as RawBag))
      issue.labels = wanted.map((name) => ({ name, color: '' }))
      return { ok: true, data: issue }
    }
    // 仓库里还没有的标签先建再挂：tea 对不存在的标签静默跳过（真机口径，见 argsLabelCreate）。
    // gt 的 edit 对不存在的标签直接报错，先建齐一样挡得住。
    await ensureLabelsExist(effective, refId, add)
    // gt 选中时整集替换走 --set-labels 一步到位（票 #23，见文件头）；tea 仍按差集增删两步。
    // 两条路对外的语义一致：远端最终集合 = wanted。
    const fields = selectedCli() === 'gt'
      ? { setLabels: wanted }
      : { addLabels: add, removeLabels: remove }
    const res = await runWrite(effective, argsIssueEdit(refId, k, fields))
    if (res.code !== 0) {
      // 原文 = 写标签那一次 CLI 调用的进程结果。
      const t = writeFailureTexts('setLabels')
      return failGitea(writeFailureError(res, effective, t.fallback), t.human, res, effective)
    }
    // 写后回读：差集两步有先后，回读拿到的才是远端真实的最终集合——labels 按回读如实交，
    // 不拿调用方要的形状覆盖（真机 2026-11-11 教训：tea 对不存在的标签静默跳过，覆盖会把
    // 「没写上」伪装成「写上了」）。
    const raw = await fetchRawIssue(effective, refId, k)
    return { ok: true, data: normalizeIssue(raw) }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身。kind 为 conflict 时按透传档走，本家那句话原样留着。
    return failGitea(err, errMsg(err), err, effective)
  }
}

/**
 * 整集替换一张票的认领人（契约 setAssignees）：tea 的 --set-assignees 本来就是整集替换
 * （空串清空），一步到位；expectedUpdatedAt 前置读与 setLabels 同一套。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId）
 * @param key 票号
 * @param assignees 要换成的整集（裸串与对象两形都收，重名去重）
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
  const t = resolveTarget(ctx, repo, key, opCtx, 'setAssignees', 'setAssignees: repo.refId 缺失，无法向 Gitea 改认领人')
  if (!t.ok) return t.result
  const { effective, refId, key: k } = t
  const wanted = wantedLoginsOf(assignees)
  try {
    const pre = await preflightExpected(effective, refId, k, opts)
    if (pre && 'ok' in (pre as OpResult<Issue>)) return pre as OpResult<Issue>
    const res = await runWrite(effective, argsIssueEdit(refId, k, { setAssignees: wanted.join(',') }))
    if (res.code !== 0) {
      // 原文 = 写认领人那一次 CLI 调用的进程结果。
      const t = writeFailureTexts('setAssignees')
      return failGitea(writeFailureError(res, effective, t.fallback), t.human, res, effective)
    }
    // 写后回读：认领人的最终集合以远端为准（名字拼错时 tea 会怎样要靠回读看得见）。
    // 写后回读走 parseReadBag：gt 回包的 assignees 是登录名字符串（票 #20），先过 gt 适配层
    // 才归一得出；对 tea 形状的回包它是恒等。否则 setAssignees 明明成功、返回的认领人却是空的。
    let raw = parseReadBag(typeof res.stdout === 'string' ? res.stdout : '')
    if (!raw) raw = await fetchRawIssue(effective, refId, k)
    return { ok: true, data: normalizeIssue(raw) }
  } catch (err: unknown) {
    return failGitea(err, errMsg(err), err, effective)
  }
}
