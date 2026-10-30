// src/refresh/rooms/host/thin-row-fetch.ts —— 行级增量的取数三件套（#1255 从 patch.ts 拆出）
//
// 为什么单列：取数（发请求、拼行）与合并（水印、待办、世代）是两件事。
// 取数这边只认两样：开只读会话的装配口、计数表，全由调用方以参数注入；
// 合并那边的状态（快照、水印、待办）一件都不碰。调用方（row-patch.ts 的 run）只认回包形状：
//   回 { ok:true, rows, queries }，或 { ok:false, outcome:'failed', keys, reason }。
// 本文件不 import 宿主其它模块，免得接出环（row-patch.ts 头注释里的那条分工仍在）；
// #1689 只 import 更下层的 kernel（预算核与额度常量），方向仍是 rooms → kernel，不成环。
//
// #1444（规格 1439 的 A2 第一批）：这一条从「每票直调 gh api」改成「同一趟只读会话里逐票 get」。
// 三条口径：
//   1. 读路径不花额度：会话的读裁决一律放行、记账空实现（见 session-opener.ts 文件头），
//      所以这里不再经过出站闸，也就没有「发送被推迟/丢弃」那两种结局；
//      取不到就只有失败的结局，调用方照旧记待办、水印不动。
//   2. 一票一次 get，字段由房间归一，不再拼 REST 的 --jq 参数；行的形状仍与全量取数那份同形，
//      免得并进列表之后同一行有两种形状（界面在两种形状之间摇摆是最难查的一类错）。
//   3. 一条没取到就整批不并（定稿第十一章点名的那个静默漏报）：只并进去一半、却把水印推走，
//      剩下那几条变化就再也发现不了了。
//
// 失败形状保持旧样：开会话失败或任何一票取不到，回 { ok:false, outcome:'failed', keys, reason }，
// 不抛、不假装成功；row-patch 那边据此把这几条记进待办，等下一趟整池或下一次增量。
import type { OpContext } from '../../../tracker/contract/contexts.js'
import type { Issue, RepositoryRef } from '../../../tracker/contract/entities.js'
import type { TrackerSession } from '../../../tracker/session/open-tracker.js'
// #1689 降级取数：同一时刻最多 8 条请求在飞（超出的排队，一条不丢）；每条请求先预扣、收到后校正、失败回填。
import { createFallbackConcurrencyGate } from '../../kernel/fallback-fetch-budget.js'
import type { FallbackRoundBudget } from '../../kernel/fallback-fetch-budget.js'
import { FALLBACK_MAX_CONCURRENCY } from '../../kernel/host-budget.js'

// 8 路并发闸按模块共享：同一时刻全仓的薄行请求加起来也不超过这个上限（不是每个调用各开一个）。
const THIN_FETCH_GATE = createFallbackConcurrencyGate({ maxConcurrency: FALLBACK_MAX_CONCURRENCY })

/**
 * 取数要用的两样：开只读会话的装配口（宿主接线注入 openSessionFor）、
 * 计数表（门禁与现场排查都读它）。全部由 patch.ts 接线处传入。
 */
export interface ThinFetchEnv {
  openSession: (cwd: any, opts?: any) => Promise<any>
  stats: { thinQueries: number }
  /** #1689：降级常驻时的增量轮预算本子（由 probe-handler 透传下来）；主路正常时不传，一条都不记账。 */
  budget?: FallbackRoundBudget
}

/** 本文件认的仓库坐标：宿主 getRepoKey 交出来的那两格。 */
interface RepoKey { owner: string; name: string }

/** 会话回包的失败来源（TrackerError）：kind 是判档、message 是原话。 */
interface SessionError { kind?: string; message?: string }

/** 一票的取数结局：拿到行，或一条失败原因（整批据此不并）。 */
interface OneResult { k: any; row?: any; bad?: { outcome: string; reason: string } }

/** 把会话交回来的契约票转成列表里那一行的形状（与 issue-list-fetch.ts 的 fetchIssues 同口径）。 */
function rowOf(issue: Issue): any {
  const labels = (issue.labels || []).map(function (l: any): any { return { name: l.name, color: l.color || '' } })
  const assignees = (issue.assignees || []).map(function (a: any): any { return a.login })
  const row: any = {
    number: Number(issue.key),
    title: issue.title,
    state: (issue.state === 'closed' ? 'CLOSED' : 'OPEN'),
    assignees: assignees,
    labels: labels,
    author: issue.author ? { login: issue.author.login, name: (issue.author.name || ''), avatarUrl: (issue.author.avatarUrl || '') } : undefined,
    updatedAt: issue.updatedAt,
    createdAt: issue.createdAt,
  }
  // 拉取请求行必须带这个标记：客户端 isTicketRow 只把 isPullRequest 为真的行挡在工单列表之外。
  if (issue.isPullRequest === true) { row.isPullRequest = true; row.mergedAt = issue.mergedAt || null }
  return row
}

/** 由宿主给的 owner/name 拼会话要的仓库坐标；refId 是 GitHub 房间认的 'owner/name'。 */
function repoRefOf(repo: RepoKey | null, backendId: string): RepositoryRef | null {
  if (!repo || !repo.owner || !repo.name) return null
  const refId = String(repo.owner) + '/' + String(repo.name)
  return { backend: backendId as any, refId: refId, name: refId, url: 'https://github.com/' + refId }
}

/** 开会话失败时整批都算没取到；理由写成能定位的一句话，不把会话结局名藏起来。 */
function sessionFailure(keys: any, reason: string): any {
  return { ok: false, outcome: 'failed', keys: (keys || []).slice(), reason: reason }
}

/**
 * 取那几条：一趟只读会话里一票一次 get，多条同时发。
 * 回 { ok:true, rows, queries }，或 { ok:false, outcome:'failed', keys, reason }。
 */
export async function fetchThinRows(env: ThinFetchEnv, cwd: any, repo: any, keys: any): Promise<any> {
  const list: any[] = Array.isArray(keys) ? keys : []
  if (!list.length) return { ok: true, rows: [], queries: 0 }
  if (!env || typeof env.openSession !== 'function') return sessionFailure(list, 'read-session-unavailable')
  let opened: any = null
  try { opened = await Promise.resolve(env.openSession(cwd)) } catch (e: any) { return sessionFailure(list, 'read-session-threw') }
  if (!opened || opened.ok !== true || typeof opened.call !== 'function') {
    return sessionFailure(list, 'read-session-unavailable:' + String((opened && opened.reason) || 'open-failed'))
  }
  const ref = repoRefOf(repo as RepoKey, String(opened.backendId || ''))
  if (!ref) return sessionFailure(list, 'repo-key-missing')
  let got: OneResult[] = []
  try {
    got = await opened.call(async function (session: TrackerSession, ctx: OpContext): Promise<OneResult[]> {
      return Promise.all(list.map(async function (k: any): Promise<OneResult> {
        // #1689：降级轮的红线 —— 每条请求发出前先预扣（预扣不到就拒发，一个字节都不许出去）。
        const ticket: any = env.budget ? env.budget.reserve({ bucket: 'read', cost: 1, classLabel: 'thin-row' }) : null
        if (env.budget && !ticket) return { k: k, bad: { outcome: 'failed', reason: 'fallback-budget-refused' } }
        // 一次薄查询的计数进这一条路的账（门禁与现场排查读 stats.thinQueries）。
        env.stats.thinQueries += 1
        let r: any = null
        try { r = await THIN_FETCH_GATE.run(function () { return session.get(ref as RepositoryRef, String(k), undefined, ctx) }) } catch (e: any) { r = null }
        // #1689 收到后校正：成功按 1 条定账；失败也回填 —— 这条请求真的发出去过，账上不许漏。
        if (env.budget && ticket) {
          if (r && r.ok === true) env.budget.correct(ticket, 1)
          else env.budget.backfill(ticket, 1)
        }
        if (!r || r.ok !== true || !r.data) return { k: k, bad: { outcome: 'failed', reason: 'thin-query-failed' } }
        const row = rowOf(r.data)
        if (!Number.isFinite(row.number)) return { k: k, bad: { outcome: 'failed', reason: 'thin-query-parse' } }
        return { k: k, row: row }
      }))
    })
  } catch (e: any) {
    return sessionFailure(list, 'thin-query-threw')
  }
  const rows: any[] = new Array(list.length)
  const failedKeys: any[] = []
  let firstBad: any = null
  for (let i = 0; i < got.length; i++) {
    if (got[i].bad) { failedKeys.push(list[i]); if (!firstBad) firstBad = got[i].bad }
    else rows[i] = got[i].row
  }
  if (firstBad) return { ok: false, outcome: firstBad.outcome, keys: failedKeys, reason: firstBad.reason }
  return { ok: true, rows: rows, queries: list.length }
}
