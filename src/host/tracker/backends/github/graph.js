/**
 * backends/github/graph.js — 图关系（setParent / getDependencies / setBlockedBy）。
 *
 * 定版依据：#138 §1.2（图表承载）+ #128（树/图表数据需求已由 parentKey+tickets+getDependencies 覆盖）
 * - 树：setParent(repo,key,parentKey,opts,ctx) → POST/DELETE /repos/{o}/{r}/issues/{n}/sub_issues
 *   parentKey===null → DELETE；非 null → POST；GHES 不支持 → unsupported
 * - 依赖：getDependencies(repo,key,opts?,ctx) → {blockedBy, blocking}；blockedBy 真源，blocking 反向聚合
 * - setBlockedBy(repo,key,blockers,opts,ctx) → 自环/成环显式 conflict；read→diff→N写 Last-write-wins
 * - 所有 op 返回 OpResult，不 throw；preflight 只判环境，能力不在 preflight 预判
 */

import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { ghClient } from './client.js'
import { classifyGhError } from './errors.js'
import { getIssue, listIssues } from './issues.js'
import { normalizeIssue } from './normalize.js'

function parseRepo(repo) {
  if (!repo || typeof repo.refId !== 'string' || !repo.refId) return null
  const s = repo.refId.trim()
  const idx = s.indexOf('/')
  if (idx <= 0) return null
  return { owner: s.slice(0, idx), name: s.slice(idx + 1) }
}

function repoId(repo) {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

/**
 * setParent(repo, key, parentKey, opts, ctx) -> OpResult<Issue>
 * parentKey: string|null（单父语义，只认原生 parent，忽略 task list）
 */
export async function setParent(repo, key, parentKey, opts, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `setParent: repo.refId missing: ${repoId(repo)}`)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'setParent: key required')
    const wantParent = parentKey == null ? null : String(parentKey).trim() || null

    // If-Match 前置
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const cur = await getIssue(repo, k, {}, ctx)
      if (!cur.ok) return cur
      if (cur.data.updatedAt !== opts.expectedUpdatedAt) {
        return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur.data.updatedAt})`)
      }
    }

    // 读取当前 parentKey
    const curRes = await getIssue(repo, k, {}, ctx)
    const curParentKey = curRes.ok ? curRes.data.parentKey : null

    if (wantParent === curParentKey) {
      // 已是目标状态，幂等
      if (curRes.ok) return curRes
      return fail(ERROR_KIND.NOTFOUND, `setParent: issue ${k} not found`)
    }

    const c = ghClient(ctx)

    if (wantParent == null) {
      // 解除父子：DELETE /repos/{o}/{r}/issues/{n}/sub_issues 需指定子 issue_url
      // 先取当前 parent → DELETE
      if (curParentKey == null) {
        if (curRes.ok) return curRes
        return fail(ERROR_KIND.NOTFOUND, `setParent: issue ${k} not found`)
      }
      // GitHub sub_issues API：DELETE /repos/{owner}/{repo}/issues/{parent_number}/sub_issue?sub_issue_id=<child_number>
      // 实际 REST：DELETE /repos/{o}/{r}/issues/{parent}/sub_issues  body {sub_issue_id: child}
      // 使用 gh api DELETE
      const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${curParentKey}/sub_issues`, '--method', 'DELETE', '-f', `sub_issue_id=${k}`]
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
      if (!r.ok) {
        const msg = String(r.error.message || '').toLowerCase()
        if (/not found|404/.test(msg)) return { ok: false, error: r.error }
        if (/unsupported|not supported|404.*sub_issues|sub_issues.*not/i.test(msg)) {
          return fail(ERROR_KIND.UNSUPPORTED, 'setParent unsupported (GHES or sub_issues not enabled)')
        }
        return { ok: false, error: r.error }
      }
    } else {
      // 设置父子：POST /repos/{o}/{r}/issues/{parent}/sub_issues {sub_issue_id: k}
      // 若已存在旧 parent，先解绑旧，再绑新（保证单父）
      if (curParentKey != null && curParentKey !== wantParent) {
        const delArgs = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${curParentKey}/sub_issues`, '--method', 'DELETE', '-f', `sub_issue_id=${k}`]
        await c.execGh(delArgs, { cwd: ctx && ctx.cwd })
      }
      const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${wantParent}/sub_issues`, '--method', 'POST', '-f', `sub_issue_id=${k}`]
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
      if (!r.ok) {
        const msg = String(r.error.message || '').toLowerCase()
        if (/unsupported|not supported|sub_issues.*not|ghes/i.test(msg)) {
          return fail(ERROR_KIND.UNSUPPORTED, 'setParent unsupported (GHES or sub_issues not enabled)')
        }
        return { ok: false, error: r.error }
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
    const kind = classifyGhError(e)
    return fail(kind, String((e && e.message) || e).slice(0, 800))
  }
}

/**
 * getDependencies(repo, key, opts, ctx) -> OpResult<{blockedBy, blocking}>
 * - blockedBy 读自 GitHub blockedBy 边（GraphQL blockedBy 字段）
 * - blocking 反向聚合：全量扫描 blockedBy 或单点 blocking 边（此处全量扫描，host 侧 LRU 缓存）
 */
export async function getDependencies(repo, key, opts, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `getDependencies: repo.refId missing: ${repoId(repo)}`)
    // 批量模式：opts.keys
    if (opts && Array.isArray(opts.keys) && opts.keys.length) {
      // 批量返回聚合：对每 key 各自取 blockedBy，再反向聚合 blocking（简化：直接调单点并合并）
      const results = []
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
    if (!k) return fail(ERROR_KIND.PARSE, 'getDependencies: key required')
    // 取单票 blockedBy
    const cur = await getIssue(repo, k, {}, ctx)
    if (!cur.ok) return cur
    const blockedBy = Array.isArray(cur.data.blockedBy) ? cur.data.blockedBy : []
    // blocking 反向聚合：需全量 list 的 blockedBy 边扫描（避免 N+1，每次 list 全量）
    // 为控制调用量，此处采用简化：全量 list 后聚合
    const allRes = await listIssues(repo, {}, ctx)
    const all = allRes.ok ? allRes.data : []
    const blocking = []
    for (const issue of all) {
      if (!issue.blockedBy || !Array.isArray(issue.blockedBy)) continue
      if (issue.blockedBy.some((b) => b.key === k)) {
        blocking.push({ key: issue.key, title: issue.title, state: issue.state, type: issue.type })
      }
    }
    return { ok: true, data: { blockedBy, blocking } }
  } catch (e) {
    const kind = classifyGhError(e)
    return fail(kind, String((e && e.message) || e).slice(0, 800))
  }
}

/**
 * 成环检测（DFS/Kahn）：在图 G = 现有 blockedBy 全量边 + 拟写入边（key -> blockers）上判环
 * 返回 true = 成环
 */
async function wouldCreateCycle(repo, key, blockers, ctx) {
  try {
    const allRes = await listIssues(repo, {}, ctx)
    const all = allRes.ok ? allRes.data : []
    const adj = new Map() // nodeKey -> Set(blocks)
    for (const issue of all) {
      const deps = (issue.blockedBy || []).map((b) => b.key)
      adj.set(issue.key, new Set(deps))
    }
    // 应用拟写入边
    adj.set(String(key), new Set(blockers.map((b) => String(b))))
    // DFS 判环
    const visiting = new Set()
    const visited = new Set()
    function dfs(u) {
      if (visiting.has(u)) return true // 环
      if (visited.has(u)) return false
      visiting.add(u)
      const neigh = adj.get(u) || new Set()
      for (const v of neigh) {
        if (dfs(v)) return true
      }
      visiting.delete(u)
      visited.add(u)
      return false
    }
    for (const u of adj.keys()) {
      if (dfs(u)) return true
    }
    return false
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
export async function setBlockedBy(repo, key, blockers, opts, ctx) {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `setBlockedBy: repo.refId missing: ${repoId(repo)}`)
    const k = String(key || '').trim()
    if (!k) return fail(ERROR_KIND.PARSE, 'setBlockedBy: key required')
    const want = Array.isArray(blockers) ? blockers.map((b) => String(b).trim()).filter(Boolean) : []
    // 去重
    const uniq = [...new Set(want)]
    // 自环
    if (uniq.includes(k)) return fail(ERROR_KIND.CONFLICT, `conflict: self in blockers (${k})`)
    // If-Match 前置
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const cur = await getIssue(repo, k, {}, ctx)
      if (!cur.ok) return cur
      if (cur.data.updatedAt !== opts.expectedUpdatedAt) {
        return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur.data.updatedAt})`)
      }
    }
    // 成环检测（写前，不落盘）
    const cycle = await wouldCreateCycle(repo, k, uniq, ctx)
    if (cycle) return fail(ERROR_KIND.CONFLICT, `conflict: cycle detected for ${k} -> [${uniq.join(',')}]`)

    const c = ghClient(ctx)
    // 读当前 blockedBy 做 diff（需额外 API：GitHub dependencies API）
    // GitHub blockedBy 边操作：POST/DELETE /repos/{o}/{r}/issues/{n}/dependencies/blocked_by {issue_id}
    // 为兼容，本实现用 REST 依赖 API
    const curRes = await getDependencies(repo, k, {}, ctx)
    if (!curRes.ok) return curRes
    const curBlockers = curRes.data.blockedBy.map((b) => b.key)
    const toAdd = uniq.filter((b) => !curBlockers.includes(b))
    const toRemove = curBlockers.filter((b) => !uniq.includes(b))

    for (const b of toRemove) {
      const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${k}/dependencies/blocked_by/${b}`, '--method', 'DELETE']
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
      if (!r.ok) {
        // 若 API 不存在（GHES）→ unsupported
        const msg = String(r.error.message || '').toLowerCase()
        if (/unsupported|not found|404.*dependencies/i.test(msg)) return fail(ERROR_KIND.UNSUPPORTED, 'setBlockedBy unsupported')
        return { ok: false, error: r.error }
      }
    }
    for (const b of toAdd) {
      const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${k}/dependencies/blocked_by`, '--method', 'POST', '-f', `issue_id=${b}`]
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
      if (!r.ok) {
        const msg = String(r.error.message || '').toLowerCase()
        if (/unsupported|not found|404.*dependencies/i.test(msg)) return fail(ERROR_KIND.UNSUPPORTED, 'setBlockedBy unsupported')
        if (/cycle|circular/i.test(msg)) return fail(ERROR_KIND.CONFLICT, `conflict: cycle ${msg.slice(0, 200)}`)
        return { ok: false, error: r.error }
      }
    }

    // 读回最新
    const finalRes = await getIssue(repo, k, {}, ctx)
    if (finalRes.ok) {
      // 覆盖 blockedBy 为 uniq 归一（确保本地一致）
      // 需把 uniq 转为 IssueRef[]（title/state 暂空，由 normalize 补全）
      finalRes.data.blockedBy = uniq.map((kk) => ({ key: String(kk), title: '', state: 'open' }))
      return finalRes
    }
    const optimisticRaw = { number: Number(k) || k, blockedBy: { nodes: uniq.map((kk) => ({ number: Number(kk), title: '', state: 'open' })) } }
    const issue = normalizeIssue(optimisticRaw)
    issue.blockedBy = uniq.map((kk) => ({ key: String(kk), title: '', state: 'open' }))
    return { ok: true, data: issue }
  } catch (e) {
    const kind = classifyGhError(e)
    // conflict 显式已在上处返回，此处兜底
    if (kind === ERROR_KIND.CONFLICT) return fail(ERROR_KIND.CONFLICT, String((e && e.message) || e).slice(0, 800))
    return fail(kind, String((e && e.message) || e).slice(0, 800))
  }
}

export default { setParent, getDependencies, setBlockedBy }
