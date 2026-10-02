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

// 取一张票的数据库编号（不是 # 后面的显示编号）：裸接口建边要用它。
// 阻塞边那条路已有同类换算（setBlockedBy 的 idOf），这里给父子路复用同一形状。
async function issueDbId(c, parsed, numberKey, ctx) {
  try {
    const rr = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${numberKey}`, '--jq', '.id'], { cwd: ctx && ctx.cwd })
    if (!rr.ok) return null
    const v = Number(String(rr.data.stdout || '').trim())
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : null
  } catch { return null }
}

function isUnknownFlag(msg) {
  return /unknown flag|unknown option|unknown shorthand/i.test(String(msg || ''))
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
    const slug = `${parsed.owner}/${parsed.name}`

    if (wantParent == null) {
      // 解除父子：先走原生旗（按票号，不用数据库编号）；老版本才回退裸接口。
      if (curParentKey == null) {
        if (curRes.ok) return curRes
        return fail(ERROR_KIND.NOTFOUND, `setParent: issue ${k} not found`)
      }
      const rm = await c.execGh(['issue', 'edit', k, '--repo', slug, '--remove-parent'], { cwd: ctx && ctx.cwd })
      if (rm.ok) {
        const back = await getIssue(repo, k, {}, ctx)
        if (back.ok) return back
        return curRes.ok ? curRes : back
      }
      const rmMsg = String((rm.error && (rm.error.message || rm.error.stderr)) || '')
      if (!isUnknownFlag(rmMsg)) return { ok: false, error: rm.error }
      const childId = await issueDbId(c, parsed, k, ctx)
      if (!childId) return fail(ERROR_KIND.NOTFOUND, `setParent: issue ${k} not found`)
      const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${curParentKey}/sub_issues`, '--method', 'DELETE', '-F', `sub_issue_id=${childId}`]
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
      // 设置父子：先走原生旗 `gh issue edit --parent`（按票号，与 wire-subissues.mjs 同路）。
      // 票号与数据库编号不是一回事：裸接口要的是数据库编号（.id 那种大数），且用 -F 按数字传；
      // 用 -f 传票号会被 422 拒收（#790）。阻塞边那条路已这么换算，父子路此前漏了。
      if (!/^\d+$/.test(wantParent)) return fail(ERROR_KIND.PARSE, `setParent: parentKey 必须是数字编号：${wantParent}`)
      if (!/^\d+$/.test(k)) return fail(ERROR_KIND.PARSE, `setParent: key 必须是数字编号：${k}`)
      let set = await c.execGh(['issue', 'edit', k, '--repo', slug, '--parent', wantParent], { cwd: ctx && ctx.cwd })
      if (!set.ok) {
        const m = String((set.error && (set.error.message || set.error.stderr)) || '')
        // 改挂：已是别的父的子票时先解再挂，保证单父语义不断。
        if (/already a sub-issue/i.test(m) && curParentKey != null && curParentKey !== wantParent) {
          const rm2 = await c.execGh(['issue', 'edit', k, '--repo', slug, '--remove-parent'], { cwd: ctx && ctx.cwd })
          if (rm2.ok) set = await c.execGh(['issue', 'edit', k, '--repo', slug, '--parent', wantParent], { cwd: ctx && ctx.cwd })
        }
      }
      if (!set.ok) {
        const m = String((set.error && (set.error.message || set.error.stderr)) || '')
        if (!isUnknownFlag(m)) {
          if (/unsupported|not supported|sub_issues.*not|ghes/i.test(m.toLowerCase())) {
            return fail(ERROR_KIND.UNSUPPORTED, 'setParent unsupported (GHES or sub_issues not enabled)')
          }
          return { ok: false, error: set.error }
        }
        if (curParentKey != null && curParentKey !== wantParent) {
          const childIdDel = await issueDbId(c, parsed, k, ctx)
          if (childIdDel) await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${curParentKey}/sub_issues`, '--method', 'DELETE', '-F', `sub_issue_id=${childIdDel}`], { cwd: ctx && ctx.cwd })
        }
        const childId = await issueDbId(c, parsed, k, ctx)
        if (!childId) return fail(ERROR_KIND.NOTFOUND, `setParent: issue ${k} not found`)
        const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${wantParent}/sub_issues`, '--method', 'POST', '-F', `sub_issue_id=${childId}`]
        const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
        if (!r.ok) {
          const msg = String(r.error.message || '').toLowerCase()
          if (/unsupported|not supported|sub_issues.*not|ghes/i.test(msg)) {
            return fail(ERROR_KIND.UNSUPPORTED, 'setParent unsupported (GHES or sub_issues not enabled)')
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
    // 票号（number，如 758）与接口要的内部标识（id，如 5595650996）不是一回事：
    // 写边与删边都要先把票号换成内部标识，且传参用 -F（按类型传数字），-f 会传成字符串被 422 拒收。
    async function idOf(numberKey) {
      try {
        const rr = await c.execGh(['api', `repos/${parsed.owner}/${parsed.name}/issues/${numberKey}`, '--jq', '.id'], { cwd: ctx && ctx.cwd })
        if (!rr.ok) return null
        const v = Number(String(rr.data.stdout || '').trim())
        return Number.isFinite(v) && v > 0 ? Math.floor(v) : null
      } catch { return null }
    }
    const idByKey = new Map()
    for (const kk of [...new Set([...toAdd, ...toRemove])]) {
      const id = await idOf(kk)
      if (id) idByKey.set(kk, id)
    }

    for (const b of toRemove) {
      const bid = idByKey.get(b)
      if (!bid) return fail(ERROR_KIND.NOTFOUND, `setBlockedBy: issue ${b} not found`)
      const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${k}/dependencies/blocked_by/${bid}`, '--method', 'DELETE']
      const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
      if (!r.ok) {
        // 若 API 不存在（GHES）→ unsupported
        const msg = String(r.error.message || '').toLowerCase()
        if (/unsupported|not found|404.*dependencies/i.test(msg)) return fail(ERROR_KIND.UNSUPPORTED, 'setBlockedBy unsupported')
        return { ok: false, error: r.error }
      }
    }
    for (const b of toAdd) {
      const bid = idByKey.get(b)
      if (!bid) return fail(ERROR_KIND.NOTFOUND, `setBlockedBy: issue ${b} not found`)
      const args = ['api', `repos/${parsed.owner}/${parsed.name}/issues/${k}/dependencies/blocked_by`, '--method', 'POST', '-F', `issue_id=${bid}`]
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
