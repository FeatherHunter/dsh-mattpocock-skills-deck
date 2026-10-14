/**
 * backends/github/graph.js — 图关系（setParent / getDependencies / setBlockedBy）。
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
import { fail } from '../../preflight.js'
import { ghClient } from './client.js'
import { ghFailureMessage, ghVerdictOf } from './errors.js'
import { getIssue, listIssues } from './issues.js'
import { adjacencyFor, hasCycle } from './cycle-check.js'
import { markDirty } from './roster.js'
import type { MemoContext } from './roster.js';
import { normalizeIssue } from './normalize.js'

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
 * setParent(repo, key, parentKey, opts, ctx) -> OpResult<Issue>
 * parentKey: string|null（单父语义，只认原生 parent，忽略 task list）
 *
 * 失败时的第三段原文（`fail` 的 `raw`）按三种情况交：
 * 一是入参形状不合格——这时还没跑过任何外部命令，手里确实没有更早的原文，就交那个不合格的入参本身；
 * 二是上游交回过结果（`gh` 的执行结果、别处 op 的返回）——交那份结果，原话就在它里面；
 * 三是本地根据读回来的数据算出的结论（自环、成环、编号查不到）——交触发它的那份入参。
 */
export async function setParent(repo: RepositoryRef, key: string, parentKey: string | null | undefined, opts: SetOpts | undefined, ctx: MemoContext): Promise<OpResult<Issue>> {
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
      // 已是目标状态，幂等
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
          try { const re = await getIssue(repo, k, {}, ctx); if (re.ok && re.data && re.data.parentKey === wantParent) return re } catch {}
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
      }
    }

    // 读回最新
    const finalRes = await getIssue(repo, k, {}, ctx)
    if (finalRes.ok) return finalRes
    // optimistic：若 get 失败，构造本地更新
    const optimisticRaw = { number: Number(k) || k, parent: wantParent ? { number: Number(wantParent) } : null, parentKey: wantParent }
    const issue = normalizeIssue(optimisticRaw)
    issue.parentKey = wantParent
    return { ok: true, data: issue }
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

/** 成环检测：邻接关系名册优先（只定向重读脏票），缺席时退回整仓拉取；DFS 判环。返回 true = 成环。 */
async function wouldCreateCycle(repo: RepositoryRef, key: string, blockers: unknown, ctx: MemoContext): Promise<boolean> {
  try {
    const adj = await adjacencyFor(repo, ctx)
    if (!adj) return false
    return hasCycle(adj, key, blockers)
  } catch {
    return false
  }
}

/**
 * setBlockedBy(repo, key, blockers, opts, ctx) -> OpResult<Issue>
 * - blockers: string[]（key 列表）
 * - 自环：self∈blockers → conflict
 * - 成环：写后环检成环 → conflict 不落盘
 */
export async function setBlockedBy(repo: RepositoryRef, key: string, blockers: string[] | undefined, opts: SetOpts | undefined, ctx: MemoContext): Promise<OpResult<Issue>> {
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
    const cycle = await wouldCreateCycle(repo, k, uniq, ctx)
    // 成环是本地拿读回来的邻接关系算出来的，还没有任何上游报错可交，原文就交调用方给的这份阻塞列表。
    if (cycle) return fail(ERROR_KIND.CONFLICT, `conflict: cycle detected for ${k} -> [${uniq.join(',')}]`, blockers)

    const c = ghClient(ctx)
    // 读当前 blockedBy 做 diff（需额外 API：GitHub dependencies API）
    // GitHub blockedBy 边操作：POST/DELETE /repos/{o}/{r}/issues/{n}/dependencies/blocked_by {issue_id}
    // 为兼容，本实现用 REST 依赖 API
    const curRes = await getDependencies(repo, k, {}, ctx)
    if (!curRes.ok) return curRes
    // 为什么敢断言非空：getDependencies 的 blockedBy 恒为数组（本文件上面那一步取不到也给 []），成功返回不可能缺这一格。
    const curBlockers = curRes.data.blockedBy!.map((b) => b.key)
    const toAdd = uniq.filter((b) => !curBlockers.includes(b))
    const toRemove = curBlockers.filter((b) => !uniq.includes(b))
    // 票号（number，如 758）与接口要的内部标识（id，如 5595650996）不是一回事：
    // 写边与删边都要先把票号换成内部标识，且传参用 -F（按类型传数字），-f 会传成字符串被 422 拒收。
    // 为什么进闭包前先留一个：parsed 在上面已验过非空，但闭包里编译器会丢掉那次收窄；留一个已收窄的别名，闭包里读的还是原来那两个串。
    const repoParsed: ParsedRepo = parsed;
    async function idOf(numberKey: string): Promise<number | null> {
      try {
        const rr = await c.execGh(['api', `repos/${repoParsed.owner}/${repoParsed.name}/issues/${numberKey}`, '--jq', '.id'], { cwd: ctx && ctx.cwd })
        if (!rr.ok) return null
        const v = Number(String(rr.data.stdout || '').trim())
        return Number.isFinite(v) && v > 0 ? Math.floor(v) : null
      } catch { return null }
    }
    // 为什么显式标：键是票号串、值是换到的内部标识（查不到的不进表）；标法与读写一致，运行时还是原来那几对值。
    const idByKey = new Map<string, number>()
    for (const kk of [...new Set([...toAdd, ...toRemove])]) {
      const id = await idOf(kk)
      if (id) idByKey.set(kk, id)
    }

    for (const b of toRemove) {
      const bid = idByKey.get(b)
      if (!bid) return fail(ERROR_KIND.NOTFOUND, `setBlockedBy: issue ${b} not found`, b)
      const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${k}/dependencies/blocked_by/${bid}`, '--method', 'DELETE']
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
      if (!r.ok) {
        // 若 API 不存在（GHES）→ unsupported
        const msg = String(r.error.message || '').toLowerCase()
        if (/unsupported|not found|404.*dependencies/i.test(msg)) return fail(ERROR_KIND.UNSUPPORTED, 'setBlockedBy unsupported', r)
        return { ok: false, error: r.error }
      }
    }
    for (const b of toAdd) {
      const bid = idByKey.get(b)
      if (!bid) return fail(ERROR_KIND.NOTFOUND, `setBlockedBy: issue ${b} not found`, b)
      const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${k}/dependencies/blocked_by`, '--method', 'POST', '-F', `issue_id=${bid}`]
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
      if (!r.ok) {
        const msg = String(r.error.message || '').toLowerCase()
        // 上游报错时原文交那份执行结果：判 unsupported 还是 conflict 的原话都在它里面。
        if (/unsupported|not found|404.*dependencies/i.test(msg)) return fail(ERROR_KIND.UNSUPPORTED, 'setBlockedBy unsupported', r)
        if (/cycle|circular/i.test(msg)) return fail(ERROR_KIND.CONFLICT, `conflict: cycle ${msg.slice(0, 200)}`, r)
        return { ok: false, error: r.error }
      }
    }

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
