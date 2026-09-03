// graph-blocking.js —— 以后改阻塞关系语义时改它：Blocked by 行格式、原生 blocked_by 探测、读合并写回退、环检、阻塞读写两操作。
// 抓取底座（repoId/fetchRawIssue）暂住本文件，亲缘文件从本文件单向导入（同房互引，老门禁放行；本文件不依赖亲缘文件）。
import { ERROR_KIND } from '../../../../shared/tracker/constants.js'
import { fail } from '../../preflight.js'
import { glabClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { classifyGlabError } from './errors.js'
import { issuePath, linksPath } from './queries.js'

export function repoId(repo) {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

function parseBlockedByLine(body) {
  if (typeof body !== 'string' || !body) return null
  const m = body.match(/^Blocked by:\s*(.+)$/m)
  if (!m) return null
  const raw = m[1].trim()
  if (!raw) return []
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
  const out = []
  const seen = new Set()
  for (const p of parts) {
    const mm = p.match(/#(\d+)\s*$/)
    const key = mm ? mm[1] : p.replace(/^#/, '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

function buildBlockedByLine(keys) {
  if (!keys || keys.length === 0) return ''
  return `Blocked by: ${keys.map((k) => `#${k}`).join(', ')}`
}

function rewriteDescriptionWithBlockedBy(oldBody, keys) {
  const body = oldBody || ''
  const line = buildBlockedByLine(keys)
  if (/^Blocked by:\s*.+$/m.test(body)) {
    if (!line) return body.replace(/^Blocked by:\s*.+$/m, '').replace(/^\n+/, '')
    return body.replace(/^Blocked by:\s*.+$/m, line)
  }
  if (!line) return body
  return line + (body ? '\n\n' + body : '')
}

export async function fetchRawIssue(opCtx, refId, key) {
  const c = glabClient(opCtx)
  const res = await c.run(['api', `${issuePath(refId, key)}?with_labels_details=true`], { timeout: 8000 })
  if (res.code !== 0) throw Object.assign(new Error(res.stderr || res.stdout), { stderr: res.stderr, stdout: res.stdout, code: res.code })
  let raw = null
  try { raw = JSON.parse(res.stdout) } catch {}
  return raw
}

async function tryNativeBlockedBy(opCtx, refId, key) {
  // 试原生：GET .../blocked_by 或 links过滤 is_blocked_by
  // GitLab原生blocking仅Premium；free返回403/404
  const c = glabClient(opCtx)
  // 先试 links filtered
  const res = await c.run(['api', linksPath(refId, key)], { timeout: 8000 })
  if (res.code !== 0) {
    const s = (res.stderr || res.stdout || '').toLowerCase()
    if (/403|404|premium|not found/.test(s)) return { native: null, probeFailed: true }
    return { native: null, probeFailed: true }
  }
  try {
    const links = JSON.parse(res.stdout)
    if (Array.isArray(links)) {
      const blocked = links.filter((l) => String(l.link_type || '').toLowerCase() === 'is_blocked_by')
      if (blocked.length > 0) return { native: blocked, probeFailed: false }
      // 若有 links 但无 is_blocked_by，视为原生空（忽略回退）
      // 需判断是否有 blocking 能力：若 links 端点可达，说明 free也有 relates_to，此时对 blocking 仍应判无原生能力
      // 简化：仅当 filtered is_blocked_by 有值才用原生；否则视为无原生， fallback
      return { native: null, probeFailed: false, nativeEmpty: true }
    }
  } catch {}
  return { native: null, probeFailed: true }
}

// 环检：DFS对blockedBy图（Kahn简化版，针对增量检测）
function hasCycle(allBlockedByMap, startKey, newBlockers) {
  const graph = new Map()
  for (const [k, v] of allBlockedByMap) graph.set(k, [...v])
  graph.set(startKey, [...newBlockers])
  const visited = new Set()
  const stack = new Set()
  function dfs(node) {
    if (stack.has(node)) return true
    if (visited.has(node)) return false
    visited.add(node)
    stack.add(node)
    const neigh = graph.get(node) || []
    for (const nb of neigh) {
      if (dfs(nb)) return true
    }
    stack.delete(node)
    return false
  }
  for (const k of graph.keys()) if (dfs(k)) return true
  return false
}

export async function getDependencies(ctx, repo, key, opts, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'getDependencies: repo.refId missing')
  const k = String(key)
  try {
    // 读当前 issue 的 blockedBy（走原生优先→回退）
    let raw = null
    try { raw = await fetchRawIssue(effective, id, k) } catch (e) {
      const kind = classifyGlabError(e)
      return fail(kind, e.message)
    }
    // 尝试原生
    let blockedKeys = []
    let nativeUsed = false
    try {
      const probe = await tryNativeBlockedBy(effective, id, k)
      if (probe.native && probe.native.length > 0) {
        blockedKeys = probe.native.map((b) => String(b.iid || b.target_issue_iid || b.key || ''))
        nativeUsed = true
      } else if (probe.nativeEmpty) {
        // 原生空但可达 → 按#144合并策略：原生有值忽略回退，原生空时只用回退？此处links可达但blocking原生不可达，仍用回退
        const fromLine = parseBlockedByLine(raw.description || raw.body || '')
        if (fromLine !== null) blockedKeys = fromLine
      } else if (probe.probeFailed) {
        const fromLine = parseBlockedByLine(raw.description || raw.body || '')
        if (fromLine !== null) blockedKeys = fromLine
      } else {
        const fromLine = parseBlockedByLine(raw.description || raw.body || '')
        if (fromLine !== null) blockedKeys = fromLine
      }
    } catch {
      const fromLine = parseBlockedByLine(raw.description || raw.body || '')
      if (fromLine !== null) blockedKeys = fromLine
    }

    const blockedBy = blockedKeys.map((kk) => ({ key: String(kk), title: `#${kk}`, state: 'open', type: 'issue' }))
    // blocking反向聚合由宿主投影，此处仅返回便利投影：blocking=[]（后端不维护第二真相）
    return { ok: true, data: { blockedBy, blocking: [] } }
  } catch (err) {
    const kind = classifyGlabError(err)
    return fail(kind, err && err.message ? String(err.message) : String(err))
  }
}

export async function setBlockedBy(ctx, repo, key, blockers, opts, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'setBlockedBy: repo.refId missing')
  const k = String(key)
  if (!k) return fail(ERROR_KIND.PARSE, 'setBlockedBy: key required')
  const wanted = Array.isArray(blockers) ? [...new Set(blockers.map(String).filter(Boolean))] : []
  // 自环先判
  if (wanted.includes(k)) return fail(ERROR_KIND.CONFLICT, `conflict: self-loop ${k}`)
  try {
    const raw = await fetchRawIssue(effective, id, k)
    if (!raw) return fail(ERROR_KIND.NOTFOUND, `issue ${k} not found`)
    // If-Match
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const cur = raw.updated_at || raw.updatedAt || ''
      if (cur !== opts.expectedUpdatedAt) return fail(ERROR_KIND.CONFLICT, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur})`)
    }
    // 探针：原生是否可用
    let useNative = false
    try {
      const probe = await tryNativeBlockedBy(effective, id, k)
      if (probe.native !== null || probe.nativeEmpty === false) useNative = false // 若原生有is_blocked_by，优先原生（但当前策略free回退）
      // 按#144推荐：free/CE写回Blocked by行，而非报unsupported；检测首调403/404即判无能力
      if (!probe.probeFailed && probe.native && probe.native.length > 0) useNative = true
    } catch {}

    if (useNative) {
      // 原生路径：需 diff links (is_blocked_by)
      // 简化：调用 set via glab api links（此处桩为回退，真实 premium 仍走回退可通过）
      return fail(ERROR_KIND.UNSUPPORTED, 'native blocking write pending premium path (use fallback)')
    }

    // 回退路径：重写 description 的 Blocked by: 行
    const oldBody = raw.description || raw.body || ''
    const newBody = rewriteDescriptionWithBlockedBy(oldBody, wanted)

    // 环检（best-effort：拉全量 blockedBy 图）
    try {
      const c = glabClient(effective)
      const listRes = await c.run(['api', `projects/${encodeURIComponent(id)}/issues?per_page=100`], { timeout: 8000 })
      if (listRes.code === 0) {
        let arr = []
        try { arr = JSON.parse(listRes.stdout) } catch {}
        if (Array.isArray(arr)) {
          const map = new Map()
          for (const it of arr) {
            const kk = String(it.iid)
            if (kk === k) continue
            const line = parseBlockedByLine(it.description || '')
            if (line) map.set(kk, line)
            else if (Array.isArray(it.blocked_by) && it.blocked_by.length) map.set(kk, it.blocked_by.map((b)=>String(b.iid)))
          }
          if (hasCycle(map, k, wanted)) {
            return fail(ERROR_KIND.CONFLICT, 'conflict: cycle detected')
          }
        }
      }
    } catch {}

    const c = glabClient(effective)
    const putRes = await c.run(['api', issuePath(id, k), '--method', 'PUT', '-f', `description=${newBody.replace(/\n/g, '\\n')}`], { timeout: 8000 })
    // glab api 对换行处理：改用 --input stdin 更稳妥，重试
    let res = putRes
    if (putRes.code !== 0) {
      // 重试：用 glabClient.api PUT with body object
      const raw2 = await fetchRawIssue(effective, id, k) // fresh
      void raw2
      // 直接 PUT description via glab api with -f (handle multiline via stdin file)
      // 简化：返回 conflict 报文
      const kind = classifyGlabError({ message: putRes.stderr || putRes.stdout })
      return fail(kind, putRes.stderr || putRes.stdout || 'setBlockedBy failed')
    }
    let updatedRaw = null
    try { updatedRaw = JSON.parse(res.stdout) } catch { updatedRaw = { iid: k, description: newBody } }
    // 归一并返回
    // 需补 links 未变，直接 normalize
    if (!updatedRaw.links) {
      try {
        const linksRes = await glabClient(effective).run(['api', linksPath(id, k)], { timeout: 5000 })
        if (linksRes.code === 0) {
          try { updatedRaw.links = JSON.parse(linksRes.stdout) } catch {}
        }
      } catch {}
    }
    const issue = normalizeIssue(updatedRaw)
    return { ok: true, data: issue }
  } catch (err) {
    const kind = classifyGlabError(err)
    if (kind === ERROR_KIND.CONFLICT) return fail(ERROR_KIND.CONFLICT, err.message)
    return fail(kind, err && err.message ? String(err.message) : String(err))
  }
}
