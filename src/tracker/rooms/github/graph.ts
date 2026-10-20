/**
 * src/tracker/rooms/github/graph.ts — 图关系（setParent / getDependencies / setBlockedBy）。
 *
 * 定版依据：#138 §1.2 + #128（树/图数据需求由 parentKey+tickets+getDependencies 覆盖）
 * - 树 setParent → POST/DELETE /repos/{o}/{r}/issues/{n}/sub_issues（null → DELETE；GHES 不支持 → unsupported）
 * - 依赖 getDependencies → {blockedBy, blocking}；setBlockedBy → 自环/成环 conflict；read→diff→N写
 * - 所有 op 返回 OpResult，不 throw；preflight 只判环境，能力不在 preflight 预判
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { OpContext } from '../../contract/contexts.js';
import type { Issue, IssueRef, RepositoryRef } from '../../contract/entities.js';
import type { DepsOpts, SetOpts } from '../../contract/inputs.js';
import type { Dependencies, OpResult } from '../../contract/results.js';
import { fail } from '../../kernel/preflight.js'
// 记日志那层壳、耗时与「成没成、失败哪一档」的读法都在内核一份（#1182 第 3 件）：
// 本文件从前留着手写副本，与另两座房逐字同形，留着就是「同一句承诺三处实现」。
import { debugOn, guardEmit, outcomeOf } from '../../kernel/log-emit.js'
import { ghClient } from './client.js'
import { ghFailureMessage, ghVerdictOf } from './errors.js'
import { getIssue, listIssues } from './issues.js'
import { adjacencyFor, hasCycle, CYCLE_VERDICT } from './cycle-check.js'
import type { CycleVerdict } from './cycle-check.js'
import { markDirty } from './roster.js'
import type { MemoContext } from './roster.js';
import { normalizeIssue } from './normalize.js'
// 写阻塞边这一段（GraphQL 优先、明确不支持才回落 REST）搬到了 blocked-by-write.ts：
// graph.ts 的有效行已被零增长基线冻结（只许减不许增），所以这里只留「读真值 → 算差集 → 委托写 → 读回」这条主干。
import { writeBlockedByEdges } from './blocked-by-write.js'
import type { EdgeTrail } from './blocked-by-write.js'

/** gh 执行器的形状（client 房的 ghClient 回什么就是什么，这里只借它的类型）。 */
type GhClient = ReturnType<typeof ghClient>;

/** 仓库定位：拥有者 + 仓名（文件内自带的小解析，形状与 issues 房那一版一致）。 */
interface ParsedRepo {
  owner: string;
  name: string;
}

// 为什么 catch 里的错误要先转这层再读：catch 出来是 unknown，直接读 message 报缺成员；
// 转成最小形状后读法与原来一致，运行时不变。
type CaughtMsg = { message?: unknown } | null;
function caughtMessage(e: unknown, len: number): string {
  const eb = e as CaughtMsg;
  return String((eb && eb.message) || e).slice(0, len)
}
// 为什么不断言判空：失败里没有 stderr 这一格（类型上就没有，message 恒有字）；
// 旧逻辑留了这道或门（万一哪天有了就读），断言只为过编译，读的还是原来那两格，运行时不变。
function errMessageOrStderr(err: { message: string }): string {
  return err.message || (err as unknown as { stderr?: unknown }).stderr as string || ''
}

// 一趟边写入的轨迹（形状与写边的两条路一起搬到了 blocked-by-write.ts）：由 setParent / setBlockedBy
// 的内层实现边走边填，外层包装统一发射（附录 1.4 节 #100 `edge.write`）。
// 为什么用一个小对象传进内层，而不是在出口处回头猜：同一趟写入可能走原生旗、也可能退回裸接口，
// 还可能因为「这条边本来就在位」一条都没真写下去 —— 这些事实只有内层知道。小对象按调用各建一个，并发写不会串。
function newEdgeTrail(): EdgeTrail {
  return { route: 'none', added: 0, removed: 0, kept: 0, reason: 'none' }
}

/**
 * 边写入的常驻结论线（附录 1.4 节 #100 `edge.write`）：一趟写入一行，成功与失败都记，
 * 回答「这条边落没落下去、停在哪一步、为什么」。字段全是枚举、布尔与计数：
 * kind 这一次写的是父子边还是阻塞边、route 走的哪条路（none 没走到外部调用 / flag 原生旗 / rest 裸接口 / graphql 边 mutation）、
 * ok 成没成、added 真落了几条、removed 真撤了几条、kept 本来就在位几条（对账之后没重复提交的那些）、
 * reason 为什么是这个结论、latencyMs 这一趟花了多久。
 * 票号、命令原文、上游报错原文一个字都不记：票号在工具返回值里，命令与报错原文在 gh.exec / gh.timeout 那两条里。
 * 为什么定常驻：边是人和 AI 显式动作（一次建图十几步），出「这条边怎么没挂上」这类问题时，
 * 查的人不会先去打开调试开关；它也是这一组里唯一一条「写没写下去」的结论线。
 */
function emitEdgeWrite(ctx: OpContext, kind: string, trail: EdgeTrail, r: OpResult<Issue>, t0: number): void {
  guardEmit(ctx, (c) => {
    // 失败那一路的档位从返回里读；返回是联合类型，先按「有 error 这一格」的形状取，读法与原逻辑一致。
    const o = outcomeOf(r)
    const reason = o.ok ? trail.reason : 'fail:' + o.errKind
    c.logEvent('info', 'edge.write', { kind: kind, route: trail.route, ok: o.ok, added: trail.added, removed: trail.removed, kept: trail.kept, reason: reason, latencyMs: Date.now() - t0 })
  })
}

function parseRepo(repo: RepositoryRef): ParsedRepo | null {
  if (!repo || typeof repo.refId !== 'string' || !repo.refId) return null
  const s = repo.refId.trim()
  const idx = s.indexOf('/')
  if (idx <= 0) return null
  return { owner: s.slice(0, idx), name: s.slice(idx + 1) }
}

function repoId(repo: RepositoryRef): string {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

// 取一张票的数据库编号（非 # 显示编号）：裸接口建边用；与阻塞边的 idOf 同形。
async function issueDbId(c: GhClient, parsed: ParsedRepo, numberKey: string, ctx: OpContext): Promise<number | null> {
  try {
    const rr = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${numberKey}`, '--jq', '.id'], { cwd: ctx && ctx.cwd })
    if (!rr.ok) return null
    const v = Number(String(rr.data.stdout || '').trim())
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : null
  } catch { return null }
}

function isUnknownFlag(msg: unknown): boolean {
  return /unknown flag|unknown option|unknown shorthand/i.test(String(msg || ''))
}

/**
 * 读一张票**原生**的阻塞边真值（`GET /repos/{o}/{r}/issues/{n}/dependencies/blocked_by`），返回一组票面编号。
 *
 * 为什么单开这条路（#1100 现象 2）：写前差集从前只读契约的 blockedBy 字段，而那张字段在 GraphQL 拿不到、
 * 退回 REST 列表读时是空的（REST 单票与列表回包都不带父子与阻塞边）。差集于是退化成「全集」——
 * 已经存在的边会被再 POST 一遍，上游回 422 already been taken，这一批边一条都落不下去。
 * 这里直接问原生接口，读到什么就是什么，不猜。
 *
 * 读不到（端点不存在、没权限、回包不是数组）返回 null，调用方退回契约字段的老口径 —— 那时行为与改动前一致。
 */
async function nativeBlockedByKeys(c: GhClient, parsed: ParsedRepo, numberKey: string, ctx: OpContext): Promise<Set<string> | null> {
  try {
    const rr = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${numberKey}/dependencies/blocked_by?per_page=100`], { cwd: ctx && ctx.cwd })
    if (!rr.ok) return null
    let j: unknown
    try { j = JSON.parse(rr.data.stdout || '') } catch { return null }
    if (!Array.isArray(j)) return null
    const out = new Set<string>()
    for (const it of j) {
      // 每一条就是一张票的对象（回包形状不对的行跳过），只取它的票面编号。
      if (!it || typeof it !== 'object') continue
      const n = (it as Record<string, unknown>).number
      if (n != null) out.add(String(n))
    }
    return out
  } catch { return null }
}

/**
 * setParent(repo, key, parentKey, opts, ctx) -> OpResult<Issue>
 * parentKey: string|null（单父语义，只认原生 parent，忽略 task list）
 *
 * 对外入口只做两件事：记这一趟开始时的时间、把内层填好的轨迹发成 `edge.write`（附录 1.4 节 #100）。
 * 真正的读写全在内层；走原生旗还是退回裸接口，只有内层知道。
 */
export async function setParent(repo: RepositoryRef, key: string, parentKey: string | null | undefined, opts: SetOpts | undefined, ctx: MemoContext): Promise<OpResult<Issue>> {
  const trail = newEdgeTrail()
  const t0 = Date.now()
  const r = await setParentInner(repo, key, parentKey, opts, ctx, trail)
  emitEdgeWrite(ctx, 'parent', trail, r, t0)
  return r
}

/**
 * setParent 的内层实现。
 *
 * 失败时的第三段原文（`fail` 的 `raw`）按三种情况交：
 * 一是入参形状不合格——这时还没跑过任何外部命令，手里确实没有更早的原文，就交那个不合格的入参本身；
 * 二是上游交回过结果（`gh` 的执行结果、别处 op 的返回）——交那份结果，原话就在它里面；
 * 三是本地根据读回来的数据算出的结论（自环、成环、编号查不到）——交触发它的那份入参。
 */
async function setParentInner(repo: RepositoryRef, key: string, parentKey: string | null | undefined, opts: SetOpts | undefined, ctx: MemoContext, trail: EdgeTrail): Promise<OpResult<Issue>> {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `setParent: repo.refId missing: ${repoId(repo)}`, repo)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'setParent: key required', key)
    const wantParent = parentKey == null ? null : String(parentKey).trim() || null

    // If-Match 前置
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const cur = await getIssue(repo, k, {}, ctx)
      if (!cur.ok) return cur
      if (cur.data.updatedAt !== opts.expectedUpdatedAt) {
        // 原文交读回来的那个时间戳：它就是与期望值对不上的那一头。
        return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur.data.updatedAt})`, cur.data.updatedAt)
      }
    }

    // 读取当前 parentKey
    const curRes = await getIssue(repo, k, {}, ctx)
    const curParentKey = curRes.ok ? curRes.data.parentKey : null

    if (wantParent === curParentKey) {
      // 已是目标状态，幂等（这一趟一条边都没动，结论线照记一行：写没写到、为什么没写）
      trail.reason = 'noop'
      if (curRes.ok) return curRes
      // 原文交上游那次读取的结果：说「这张票没有」的原话就在它里面。
      return fail(ERROR_KIND.NOTFOUND, `setParent: issue ${k} not found`, curRes)
    }
    try { if (ctx && ctx.memo) markDirty(ctx.memo, k) } catch (eM) { /* 名册脏标记失败不影响写本身 */ }

    const c = ghClient(ctx)
    const slug = `${parsed.owner}/${parsed.name}`

    if (wantParent == null) {
      // 解除父子：先走原生旗（按票号，不用数据库编号）；老版本才回退裸接口。
      if (curParentKey == null) {
        if (curRes.ok) return curRes
        return fail(ERROR_KIND.NOTFOUND, `setParent: issue ${k} not found`, curRes)
      }
      const rm = await c.execGh(['issue', 'edit', k, '--repo', slug, '--remove-parent'], { cwd: ctx && ctx.cwd })
      if (rm.ok) {
        // 走的是原生旗这一路：真撤掉了一条父子边。
        trail.route = 'flag'; trail.removed = 1; trail.reason = 'removed'
        const back = await getIssue(repo, k, {}, ctx)
        if (back.ok) return back
        return curRes.ok ? curRes : back
      }
      const rmMsg = errMessageOrStderr(rm.error)
      if (!isUnknownFlag(rmMsg)) return { ok: false, error: rm.error }
      const childId = await issueDbId(c, parsed, k, ctx)
      // 查编号没查到时还没有任何上游报错，能交的原文就是被查的那个票号。
      if (!childId) return fail(ERROR_KIND.NOTFOUND, `setParent: issue ${k} not found`, k)
      const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${curParentKey}/sub_issues`, '--method', 'DELETE', '-F', `sub_issue_id=${childId}`]
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
      if (!r.ok) {
        const msg = String(r.error.message || '').toLowerCase()
        if (/not found|404/.test(msg)) return { ok: false, error: r.error }
        if (/unsupported|not supported|404.*sub_issues|sub_issues.*not/i.test(msg)) {
          return fail(ERROR_KIND.UNSUPPORTED, 'setParent unsupported (GHES or sub_issues not enabled)', r)
        }
        return { ok: false, error: r.error }
      }
      // 原生旗不认识 → 退回裸接口这一路，真撤掉了一条父子边。
      trail.route = 'rest'; trail.removed = 1; trail.reason = 'removed'
    } else {
      // 设置父子：先走原生旗 `gh issue edit --parent`（按票号；裸接口要数据库编号且用 -F，-f 传票号必 422，见 #790）。
      // 说「编号必须是数字」的原文就是调用方给的那个值本身。
      if (!/^\d+$/.test(wantParent)) return fail(ERROR_KIND.PARSE, `setParent: parentKey 必须是数字编号：${wantParent}`, String(wantParent))
      if (!/^\d+$/.test(k)) return fail(ERROR_KIND.PARSE, `setParent: key 必须是数字编号：${k}`, String(k))
      let set = await c.execGh(['issue', 'edit', k, '--repo', slug, '--parent', wantParent], { cwd: ctx && ctx.cwd })
      if (!set.ok) {
        const m = errMessageOrStderr(set.error)
        // 改挂：已是别的父的子票时先解再挂，保证单父语义不断。
        if (/already a sub-issue/i.test(m) && curParentKey != null && curParentKey !== wantParent) {
          const rm2 = await c.execGh(['issue', 'edit', k, '--repo', slug, '--remove-parent'], { cwd: ctx && ctx.cwd })
          if (rm2.ok) set = await c.execGh(['issue', 'edit', k, '--repo', slug, '--parent', wantParent], { cwd: ctx && ctx.cwd })
        }
      }
      if (!set.ok) {
        const m = errMessageOrStderr(set.error)
        // #829：旗报重复时以重读为准（读过期后重试）：已是目标父则成功，否则带原话失败。
        if (/already.*sub-issue|duplicate|addSubIssue|may not contain duplicate/i.test(m)) {
          // 旗报重复、重读确认已是目标父：这一趟没有新写边，但目标状态确实在（kept 记一笔）。
          try { const re = await getIssue(repo, k, {}, ctx); if (re.ok && re.data && re.data.parentKey === wantParent) { trail.route = 'flag'; trail.kept = 1; trail.reason = 'noop'; return re } } catch {}
          return { ok: false, error: set.error }
        }
        if (!isUnknownFlag(m)) {
          if (/unsupported|not supported|sub_issues.*not|ghes/i.test(m.toLowerCase())) {
            return fail(ERROR_KIND.UNSUPPORTED, 'setParent unsupported (GHES or sub_issues not enabled)', set)
          }
          return { ok: false, error: set.error }
        }
        if (curParentKey != null && curParentKey !== wantParent) {
          const childIdDel = await issueDbId(c, parsed, k, ctx)
          if (childIdDel) await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${curParentKey}/sub_issues`, '--method', 'DELETE', '-F', `sub_issue_id=${childIdDel}`], { cwd: ctx && ctx.cwd })
        }
        const childId = await issueDbId(c, parsed, k, ctx)
        if (!childId) return fail(ERROR_KIND.NOTFOUND, `setParent: issue ${k} not found`, k)
        const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${wantParent}/sub_issues`, '--method', 'POST', '-F', `sub_issue_id=${childId}`]
        const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
        if (!r.ok) {
          const msg = String(r.error.message || '').toLowerCase()
          if (/unsupported|not supported|sub_issues.*not|ghes/i.test(msg)) {
            return fail(ERROR_KIND.UNSUPPORTED, 'setParent unsupported (GHES or sub_issues not enabled)', r)
          }
          return { ok: false, error: r.error }
        }
        // 走的是裸接口这一路（原生旗不认识）。
        trail.route = 'rest'
      }
      // 走到这里说明这一趟父子边已经落下去了：原生旗那一路是 flag，退回裸接口那一路在上面的分支里已改成 rest。
      if (trail.route === 'none') trail.route = 'flag'
      trail.added = 1
      trail.reason = 'added'
    }

    // 读回最新。这一步是「这条边到底落上了没有」的唯一判据（#790）：
    // 写动作自己回成功不等于盘上有这条边。从前这里在读回失败时拼一张 parentKey = wantParent 的票
    // 回 ok:true（optimistic 写法），调用方据此把没确认的边报成了落上 —— 现在如实回失败，
    // 并把「写已回成功、读没读回来」这件事说清楚，让上层按「没确认」处理（既不算成功，也不说没落上）。
    const finalRes = await getIssue(repo, k, {}, ctx)
    if (finalRes.ok) return finalRes
    const readMsg = String((finalRes.error && finalRes.error.message) || '后端没给出原因')
    return fail(
      (finalRes.error && finalRes.error.kind) || ERROR_KIND.NETWORK,
      `setParent: 写动作已回成功（route=${trail.route}），但写后读回失败：${readMsg}；这条父子边可能已建成但没确认`,
      finalRes
    )
  } catch (e) {
    // 判档只走本房唯一的出口（`ghVerdictOf`）：档位由规则表判、话术按票面实现决定第 11 条挑。
    // 第三段把出错的那个值原样交出去当原文。
    const verdict = ghVerdictOf(e, ctx)
    return fail(verdict.kind, ghFailureMessage(verdict, caughtMessage(e, 800)), e)
  }
}

/**
 * getDependencies(repo, key, opts, ctx) -> OpResult<{blockedBy, blocking}>
 * - blockedBy 读自 GitHub blockedBy 边（GraphQL blockedBy 字段）
 * - blocking 反向聚合：全量扫描 blockedBy 或单点 blocking 边（此处全量扫描，host 侧 LRU 缓存）
 */
export async function getDependencies(repo: RepositoryRef, key: string, opts: DepsOpts | undefined, ctx: MemoContext): Promise<OpResult<Dependencies>> {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `getDependencies: repo.refId missing: ${repoId(repo)}`, repo)
    // 批量模式：opts.keys
    if (opts && Array.isArray(opts.keys) && opts.keys.length) {
      // 批量返回聚合：对每 key 各自取 blockedBy，再反向聚合 blocking（简化：直接调单点并合并）
      // 为什么显式标：循环里才往里装，编译器判成隐式 any；装的本来就是编号与那份依赖投影，运行时还是原来那几个值。
      const results: { key: string; data: Dependencies }[] = []
      for (const kk of opts.keys) {
        const single = await getDependencies(repo, kk, {}, ctx)
        if (!single.ok) return single
        results.push({ key: String(kk), data: single.data })
      }
      // 为保持契约返回单对象，此处仅支持单 key 批量由宿主 snapshot LRU 处理；批量请求暂返回首个
      if (results.length === 1) return { ok: true, data: results[0].data }
      // 多 key 批量：返回首个的 data（宿主会逐 key 调用，此分支罕见）
      return { ok: true, data: results[0]?.data || { blockedBy: [], blocking: [] } }
    }
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'getDependencies: key required', key)
    // 取单票 blockedBy
    const cur = await getIssue(repo, k, {}, ctx)
    if (!cur.ok) return cur
    const blockedBy = Array.isArray(cur.data.blockedBy) ? cur.data.blockedBy : []
    // blocking 反向聚合：名册优先（脏票定向重读），缺席时退回整仓拉取；阻塞方的标题逐张读回，读不回的键照列（标题空，不吞边）。
    const adj = await adjacencyFor(repo, ctx)
    // 为什么显式标成串数组：分支里才往里装，编译器判成隐式 any；装的本来就是阻塞方的票号串，运行时还是原来那几个值。
    const blockingKeys: string[] = []
    if (adj) {
      for (const entry of adj) { if (entry[1] && entry[1].has(k) && entry[0] !== k) blockingKeys.push(entry[0]) }
    } else {
      const allRes = await listIssues(repo, {}, ctx)
      // 整仓回退：名册缺席时把整仓的票拉回来，逐张扫它的 blockedBy 反推 blocking。
      // 名册平时都在，这条路罕见；拉全仓慢，但这是设计（见 235 行注释），不是临时凑合。
      const all: Issue[] = allRes.ok ? allRes.data : []
      for (const issue of all) {
        if (!issue.blockedBy || !Array.isArray(issue.blockedBy)) continue
        if (issue.blockedBy.some((b) => b.key === k)) blockingKeys.push(issue.key)
      }
    }
    // 为什么标成引用数组：反向聚合的每一项本来就是「键+标题+状态」的引用（读不回的标题给空串），与契约的 blocking 一一对应。
    const blocking: IssueRef[] = []
    for (const bk of blockingKeys) {
      // 为什么显式标：两条分支（读回 / 没读回）都往里装，编译器判成隐式 any；装的本来就是那张票或空，运行时还是原来那个值。
      let info: Issue | null = null
      try { const g = await getIssue(repo, bk, {}, ctx); if (g && g.ok === true) info = g.data } catch (e) {}
      blocking.push(info ? { key: info.key, title: info.title, state: info.state, type: info.type } : { key: bk, title: '', state: 'open' })
    }
    return { ok: true, data: { blockedBy, blocking } }
  } catch (e) {
    // 判档只走本房唯一的出口（`ghVerdictOf`）：档位由规则表判、话术按票面实现决定第 11 条挑。
    // 第三段把出错的那个值原样交出去当原文。
    const verdict = ghVerdictOf(e, ctx)
    return fail(verdict.kind, ghFailureMessage(verdict, caughtMessage(e, 800)), e)
  }
}

/**
 * 环检测的调试线（附录 1.5 节 #101 `edge.cycle`）：一趟一行，回答「这次查没查、拿什么查的、结论是什么」。
 * 只在调试开关打开时记（写一条阻塞边就可能查一次，属高频路径），字段全是枚举与计数：
 * verdict 结论（clear 没成环 / cycle 成环 / unchecked 邻接关系没取到、这一趟按不成环放行；
 * 三个词只在 `cycle-check.ts` 的 `CYCLE_VERDICT` 里声明一次，#1180）、
 * nodes 邻接表里几张票、blockers 这一次拟写入几条阻塞边、latencyMs 查了多久。
 * 票号一个字都不记（哪张票在工具返回值与 gh.exec 的调用链里）。
 */
function emitEdgeCycle(ctx: OpContext, verdict: CycleVerdict, nodes: number, blockers: number, t0: number): void {
  guardEmit(ctx, (c) => {
    c.logEvent('debug', 'edge.cycle', { verdict: verdict, nodes: nodes, blockers: blockers, latencyMs: Date.now() - t0 })
  }, () => debugOn(ctx))
}

/**
 * 成环检测：邻接关系名册优先（只定向重读脏票），缺席时退回整仓拉取；DFS 判环。
 * 返回三态而不是布尔：邻接关系没取到时这一趟其实没查成（老行为是当不成环放行），
 * 这个「没查成」必须能被日志看见，所以单列 `unchecked` 一档（#1054 补日志）。
 * 三个取值一律写 `CYCLE_VERDICT.XXX`，不手写字符串（#1180）。
 */
async function cycleVerdict(repo: RepositoryRef, key: string, blockers: unknown, ctx: MemoContext): Promise<CycleVerdict> {
  const t0 = Date.now()
  const count = Array.isArray(blockers) ? blockers.length : 0
  try {
    const adj = await adjacencyFor(repo, ctx)
    if (!adj) {
      emitEdgeCycle(ctx, CYCLE_VERDICT.UNCHECKED, 0, count, t0)
      return CYCLE_VERDICT.UNCHECKED
    }
    const cycle = hasCycle(adj, key, blockers)
    const verdict = cycle ? CYCLE_VERDICT.CYCLE : CYCLE_VERDICT.CLEAR
    emitEdgeCycle(ctx, verdict, adj.size, count, t0)
    return verdict
  } catch {
    emitEdgeCycle(ctx, CYCLE_VERDICT.UNCHECKED, 0, count, t0)
    return CYCLE_VERDICT.UNCHECKED
  }
}

/**
 * setBlockedBy(repo, key, blockers, opts, ctx) -> OpResult<Issue>
 * - blockers: string[]（key 列表）
 * - 自环：self∈blockers → conflict
 * - 成环：写后环检成环 → conflict 不落盘
 *
 * 对外入口只做两件事：记这一趟开始时的时间、把内层填好的轨迹发成 `edge.write`（附录 1.4 节 #100）。
 */
export async function setBlockedBy(repo: RepositoryRef, key: string, blockers: string[] | undefined, opts: SetOpts | undefined, ctx: MemoContext): Promise<OpResult<Issue>> {
  const trail = newEdgeTrail()
  const t0 = Date.now()
  const r = await setBlockedByInner(repo, key, blockers, opts, ctx, trail)
  emitEdgeWrite(ctx, 'block', trail, r, t0)
  return r
}

/** setBlockedBy 的内层实现：读真值 → 算差集 → 逐条写，走得怎样写进 trail。 */
async function setBlockedByInner(repo: RepositoryRef, key: string, blockers: string[] | undefined, opts: SetOpts | undefined, ctx: MemoContext, trail: EdgeTrail): Promise<OpResult<Issue>> {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `setBlockedBy: repo.refId missing: ${repoId(repo)}`, repo)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'setBlockedBy: key required', key)
    const want = Array.isArray(blockers) ? blockers.map((b) => String(b).trim()).filter(Boolean) : []
    // 去重
    const uniq = [...new Set(want)]
    // 自环
    // 原文交调用方给的这份阻塞列表本身：自环就是从它里面看出来的。
    if (uniq.includes(k)) return fail(ERROR_KIND.CONFLICT, `conflict: self in blockers (${k})`, blockers)
    try { if (ctx && ctx.memo) markDirty(ctx.memo, k) } catch (eM) { /* 名册脏标记失败不影响写本身 */ }
    // If-Match 前置
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const cur = await getIssue(repo, k, {}, ctx)
      if (!cur.ok) return cur
      if (cur.data.updatedAt !== opts.expectedUpdatedAt) {
        return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur.data.updatedAt})`, cur.data.updatedAt)
      }
    }
    // 成环检测（写前，不落盘）
    const verdict = await cycleVerdict(repo, k, uniq, ctx)
    // 成环是本地拿读回来的邻接关系算出来的，还没有任何上游报错可交，原文就交调用方给的这份阻塞列表。
    if (verdict === CYCLE_VERDICT.CYCLE) return fail(ERROR_KIND.CONFLICT, `conflict: cycle detected for ${k} -> [${uniq.join(',')}]`, blockers)

    const c = ghClient(ctx)
    // 读当前 blockedBy 做 diff（需额外 API：GitHub dependencies API）
    // GitHub blockedBy 边操作：POST/DELETE /repos/{o}/{r}/issues/{n}/dependencies/blocked_by {issue_id}
    // 为兼容，本实现用 REST 依赖 API
    const curRes = await getDependencies(repo, k, {}, ctx)
    if (!curRes.ok) return curRes
    // 为什么敢断言非空：getDependencies 的 blockedBy 恒为数组（本文件上面那一步取不到也给 []），成功返回不可能缺这一格。
    const curBlockers = curRes.data.blockedBy!.map((b) => b.key)
    // 写前逐条对账（#1100 现象 2）：先直接问原生接口「这一张票现在真正挂着哪几条阻塞边」，
    // 按这份真值算差集；问不到（端点不在、没权限）才退回契约字段的老口径，行为与改动前一致。
    // 为什么必须多问这一趟：契约那张 blockedBy 字段在 GraphQL 拿不到时是空的（读路径的 REST 降级回包
    // 不带阻塞边），而空字段算出来的差集是「全集」——已经存在的边会被再提交一遍，上游 422 整批中止。
    const native = await nativeBlockedByKeys(c, parsed, k, ctx)
    const knownSet: Set<string> = native || new Set<string>(curBlockers.map(String))
    const toAdd = uniq.filter((b) => !knownSet.has(b))
    const toRemove = [...knownSet].filter((b) => !uniq.includes(b))
    // 轨迹：走的这条 REST 路；kept 记几条第这次目标里的边本来就在位（对账之后没重复提交的那些）。
    trail.route = 'rest'
    trail.kept = uniq.length - toAdd.length
    trail.reason = (toAdd.length || toRemove.length) ? 'diff' : 'noop'
    // 写边：先走 GraphQL mutation（addBlockedBy / removeBlockedBy），只有它明确说「这个仓库没有这条能力」
    // 才回落 REST 依赖接口。换 id、两条写循环、回落判据与计数都在 blocked-by-write.ts；这里只认结论。
    const write = await writeBlockedByEdges({ client: c, owner: parsed.owner, name: parsed.name, key: k, toAdd, toRemove, nativeKnown: native !== null, ctx, trail })
    if (!write.ok) return write.result
    if (write.route === 'graphql') trail.route = 'graphql'

    // 读回最新
    const finalRes = await getIssue(repo, k, {}, ctx)
    if (finalRes.ok) {
      // 覆盖 blockedBy 为 uniq 归一（确保本地一致）
      // 需把 uniq 转为 IssueRef[]（title/state 暂空，由 normalize 补全）
      // 为什么标返回形状：map 回的每一项本来就是引用形状（键+空标题+开态），标上后字面量里的开态才不会被展宽成串；交的还是原来那几项。
      finalRes.data.blockedBy = uniq.map((kk): IssueRef => ({ key: String(kk), title: '', state: 'open' }))
      return finalRes
    }
    const optimisticRaw = { number: Number(k) || k, blockedBy: { nodes: uniq.map((kk) => ({ number: Number(kk), title: '', state: 'open' })) } }
    const issue = normalizeIssue(optimisticRaw)
    issue.blockedBy = uniq.map((kk): IssueRef => ({ key: String(kk), title: '', state: 'open' }))
    return { ok: true, data: issue }
  } catch (e) {
    const verdict = ghVerdictOf(e, ctx)
    const own = caughtMessage(e, 800)
    // conflict 显式已在上处返回，此处兜底
    if (verdict.kind === ERROR_KIND.CONFLICT) return fail(ERROR_KIND.CONFLICT, ghFailureMessage(verdict, own), e)
    return fail(verdict.kind, ghFailureMessage(verdict, own), e)
  }
}

export default { setParent, getDependencies, setBlockedBy }
