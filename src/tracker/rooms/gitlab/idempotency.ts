/**
 * backends/gitlab/idempotency.ts — 创建幂等锚在这间房里的落地（#711）。
 *
 * 契约层答应的事只有一条：同一个锚提交两次，只多出一张票、返回同一个 key（语义见
 * src/host/tracker/contract-idempotency.js）。锚的构造与「找到的票算不算命中」的判据在
 * 刷新核心的产物（src/shared/refresh/idempotency.js），这里只做 GitLab 专属的两件事：
 *   ① 把锚那一行写进 issue 的 description（由 issues.js 拼 description 时加上，本文件提供 helper）；
 *   ② **建后按锚回查**：先从 GitLab 上把「可能已经建过的那张票」找出来。
 *
 * 回查为什么这么写：
 *  - 唯一的证据是**票面 description 里的那一行锚**。接口说「找到了」不算数、内存里记着谁建过也不算数 ——
 *    进程重启、插件重载、换个会话回来之后内存里什么都没有，而票还在远端。所以每条候选都要把
 *    description 拿回来，交给 matchAnchor 按票面原文判。
 *  - 两条路：① `issues?search=<锚>&in=description`（服务端搜索，一次出站，最快）；
 *    ② 按创建时间倒序列出开着的票，逐张看 description（不依赖搜索服务，也顺带挡住「搜索服务
 *    对刚建好的票有延迟」这种情形）。
 *  - 两条路都**没找到**才算「这张票确实还没建过」；任何一条路上出岔子拿不准（接口报错、返回的不是数组）
 *    时，绝不当成「没找到」，一律如实失败（错误档沿用既有分类，消息说清是回查出的问题）——
 *    「拿不准」当成「没找到」正是重复建票的来路，而且是看起来成功了的那种。
 */

import { anchorLineFor, matchAnchor, isAnchorHit, describeAnchorFailure, anchorUnsupported } from '../../../shared/refresh/src/idempotency.js'
import type { AnchorCandidate, AnchorMatch } from '../../../shared/refresh/src/idempotency.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { Issue, RepositoryRef } from '../../contract/entities.js'
import type { OpResult, TrackerError } from '../../contract/results.js'
import { glabClient } from './client.js'
import { classifyGlabError, hintFor } from './errors.js'
import type { GlabVerdict } from './errors.js'
import { normalizeIssue } from './normalize.js'
import { issuesPath } from './queries.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GITLAB_READ_TIMEOUT_MS, GITLAB_SLOW_READ_TIMEOUT_MS } from '../../../shared/time-config/src/values.js'
import { PAGINATION } from '../../contract/pagination.js'

/** 慢路最多看几张候选（按创建时间倒序的第一页）。到了这个数还没找到就如实说「拿不准」。 */
const SCAN_LIMIT = PAGINATION.gitlab.anchorLookupScanLimit

/** 一次回查要找的几个字段（REST 返回里本来就有这些，写出来是为了让读代码的人知道用了什么）。 */
const DETAIL_QUERY = 'with_labels_details=true'

// 回查三种结论用联合收拢，是因为调用方要按 hit/miss 穷尽分支，写成开放形状会漏掉如实失败那条。
export type LookupByAnchorResult =
  | { ok: true; hit: false; reason: string }
  | { ok: true; hit: true; issue: Issue }
  | { ok: false; error: TrackerError }

/**
 * 把锚那一行拼到 description 前面。不带锚时原样返回（一个字节都不改）。
 * 带锚时锚是 description 的第一行：渲染后看不见，读回来还在，重试时能凭它找回这张票。
 */
export function withAnchor(description: string, key: string | null | undefined): string {
  if (!key) return description
  return anchorLineFor(String(key)) + (description || '')
}

function repoId(repo: Partial<RepositoryRef> | null | undefined): string {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof (repo as Record<string, unknown>)['name'] === 'string' && (repo as Record<string, unknown>)['name']) {
    return (repo as Record<string, unknown>)['name'] as string
  }
  return ''
}

function parseRows(text: string): Record<string, unknown>[] {
  const t = String(text || '').trim()
  if (!t) return []
  const j: unknown = JSON.parse(t)
  if (!Array.isArray(j)) throw new Error('返回的不是一个列表')
  return j as Record<string, unknown>[]
}

/** 把一行原始数据变成回查判据要的候选（读不出 iid 就返回 null）。 */
function toCandidate(raw: unknown): AnchorCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const bag = raw as Record<string, unknown>
  const key = bag['iid'] === undefined || bag['iid'] === null ? '' : String(bag['iid'])
  if (!key) return null
  const body = typeof bag['description'] === 'string' ? String(bag['description']) : ''
  const out: AnchorCandidate = { key, body }
  out.state = bag['state'] === 'closed' ? 'closed' : bag['state'] ? 'open' : undefined
  if (out.state === undefined) delete out.state
  return out
}

/**
 * 回查没做成时的失败结果（原因沿用既有分类，说得清是哪条路出的问题）。
 *
 * 三段式一样要齐：`raw` 存两条回查路各自的原文（哪条路说了什么，人自己看）。
 * 档位与话术由调用方给的判档结果决定：兜底判出来的（`fallback` 为真）与「不支持」两档
 * 换成通用提示，其余用这里拼的这句有上下文的话。
 *
 * @param verdict `classifyGlabError` 的结果
 * @param message 本家那句话
 * @param raw 两条路各自的原文
 */
function lookupFailure(
  verdict: GlabVerdict | null | undefined,
  message: string,
  raw: string,
): { ok: false; error: TrackerError } {
  const native =
    '带锚创建的回查没能做成：' + String(message || '原因不明').slice(0, 500) + '。这一次没有建票 —— 请先修好回查，或者换用不带锚的创建。'
  // 档位兜底也走 ERROR_KIND 常量：这条兜底只在判档结果缺失时才用得上，含义是「本家不敢断定」。
  return {
    ok: false,
    error: {
      kind: (verdict && verdict.kind) || (ERROR_KIND.UNSUPPORTED as ErrorKind),
      message: hintFor(verdict, native),
      raw: String(raw || ''),
    },
  }
}

function errMsg(e: unknown): string {
  if (e !== null && typeof e === 'object' && 'message' in (e as Record<string, unknown>)) {
    const m = (e as Record<string, unknown>)['message']
    if (typeof m === 'string' && m) return m
  }
  return String(e)
}

/**
 * 建后按锚回查（本间房的实现）。返回三种结果：
 *   { ok:true, hit:false }             —— 确实没找到，照常建票
 *   { ok:true, hit:true, issue }       —— 找到了，复用它（issue 是已经归一化好的那张票）
 *   { ok:false, error }                —— 回查没做成，如实失败，绝不建票
 *
 * @param repo  目标仓库（refId 形如 group/project）
 * @param key   幂等键（已经过 checkIdempotencyKey 检查）
 * @param opCtx 本次调用的上下文（房内约定：glabClient 吃这个 ctx）
 */
export async function lookupByAnchor(
  repo: Partial<RepositoryRef> | null | undefined,
  key: string,
  opCtx: (Partial<OpContext> & Partial<BackendContext>) | null | undefined,
): Promise<LookupByAnchorResult> {
  const id = repoId(repo)
  if (!id) return lookupFailure({ kind: ERROR_KIND.UNSUPPORTED as ErrorKind, fallback: false }, '这个仓库的 refId 是空的，回查无从做起', '')
  const c = glabClient(opCtx as Partial<OpContext> & Partial<BackendContext>)

  // ① 快路：服务端搜索（只搜 description）。
  let searchError: string | null = null
  try {
    const q = 'search=' + encodeURIComponent(key) + '&in=description&state=opened'
    const res = await c.run(['api', issuesPath(id, q)], { timeout: GITLAB_READ_TIMEOUT_MS })
    if (res.code !== 0) searchError = res.stderr || res.stdout || '搜索接口报错'
    else {
      const rows = parseRows(res.stdout)
      const cands = rows.map(toCandidate).filter((x): x is AnchorCandidate => x !== null)
      // 值实现来自构建产物 .js（无类型），回查结论以源码 .ts 的 AnchorMatch 为准，只收敛类型不改逻辑。
      const m = matchAnchor(cands, repo && repo.refId ? String(repo.refId) : undefined, key) as unknown as AnchorMatch
      if (isAnchorHit(m)) {
        const found = rows.find((x) => String(x['iid']) === String(m.key)) || {}
        return { ok: true, hit: true, issue: normalizeIssue(found) }
      }
    }
  } catch (e: unknown) {
    searchError = errMsg(e)
  }

  // ② 慢路：按创建时间倒序列出开着的票，逐张看票面（不依赖搜索服务）。
  let listError: string | null = null
  try {
    const q = 'state=opened&order_by=created_at&sort=desc&per_page=' + SCAN_LIMIT + '&' + DETAIL_QUERY
    const res = await c.run(['api', issuesPath(id, q)], { timeout: GITLAB_SLOW_READ_TIMEOUT_MS })
    if (res.code !== 0) listError = res.stderr || res.stdout || '列出票时报错'
    else {
      const rows = parseRows(res.stdout)
      for (const raw of rows) {
        const cand = toCandidate(raw)
        if (!cand) continue
        const m = matchAnchor([cand], repo && repo.refId ? String(repo.refId) : undefined, key) as unknown as AnchorMatch
        if (isAnchorHit(m)) return { ok: true, hit: true, issue: normalizeIssue(raw) }
      }
      if (rows.length >= SCAN_LIMIT) {
        // 这一档是「本家承认自己这次不敢断定」，不是判档判出来的；原文给扫描上限本身。
        return lookupFailure(
          { kind: ERROR_KIND.UNSUPPORTED as ErrorKind, fallback: false },
          '按创建时间倒序看完了前 ' + SCAN_LIMIT + ' 张还没找到这个锚，这个仓库比这更大，这次不敢断定「还没建过」',
          'per_page=' + SCAN_LIMIT,
        )
      }
    }
  } catch (e: unknown) {
    listError = errMsg(e)
  }

  // 两条路都没找到：只有在**两条路都真跑通了、都确认没有**时才算「确实还没建过」。
  if (searchError && listError) {
    const bothRaw = '搜索：' + searchError + '\n列表：' + listError
    return lookupFailure(
      // 空上下文统一成 undefined，是因为判档只收 undefined，null 会被当成非法值拦掉。
      classifyGlabError({ message: listError }, opCtx ?? undefined),
      '搜索接口与列表接口都没跑通（搜索：' + searchError + '；列表：' + listError + '）',
      bothRaw,
    )
  }
  if (listError) {
    return lookupFailure(
      classifyGlabError({ message: listError }, opCtx ?? undefined),
      '列表这条回查路没跑通（' + listError + '），而搜索接口没搜到不能算数（服务端搜索对刚建好的票可能有延迟）',
      listError,
    )
  }
  const miss = matchAnchor([], repo && repo.refId ? String(repo.refId) : undefined, key) as unknown as AnchorMatch
  return { ok: true, hit: false, reason: miss.reason }
}

/** 回查没做成时给调用方看的那句话（句式由核心里那一处给，本文件不自己拼）。 */
export function describeLookupFailure(match: AnchorMatch | null | undefined): string {
  return describeAnchorFailure(match || anchorUnsupported('回查没有做成'))
}

export default { withAnchor, lookupByAnchor, describeLookupFailure }
