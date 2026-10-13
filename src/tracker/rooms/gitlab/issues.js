/**
 * backends/gitlab/issues.js — issue 操作（list/get/create/close/reopen/update）。
 *
 * 按 #135/#144：REST主路径，list/get均聚合 notes+links 后 normalize；分页per_page；milestone更新走milestone_id。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import { fail } from '../../preflight.js'
import { glabClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { failGlab } from './errors.js'
import { issuesPath, issuePath, notesPath, linksPath, milestonesPath } from './queries.js'
// #711：创建幂等锚。锚那一行怎么拼、命中判据是什么，在刷新核心的产物里（唯一一处判据）；
// 本间房专属的「建后按锚回查」在 ./idempotency.js（服务端搜索 + 按创建时间倒序列出逐张看票面）。
import { checkIdempotencyKey } from '../../../shared/refresh/idempotency.js'
import { withAnchor, lookupByAnchor } from './idempotency.js'
// #722：建票只有一条写路径（POST 到集合端点），发几次、许不许再发一次由纯函数判。
// 不许再写成「先发 PUT、拿不到票面再回落发 POST」——那是一次调用里两次可能都成功的写。
import { writeNewIssue, createWriteFailureKind, createWriteFailureMessage } from './create-write.js'

function repoId(repo) {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

function parseJsonSafe(s) {
  try { return JSON.parse(s) } catch { return null }
}

async function apiGet(opCtx, path) {
  const c = glabClient(opCtx)
  const res = await c.run(['api', path], { timeout: 8000 })
  if (res.code !== 0) {
    const err = { message: res.stderr || res.stdout || `api ${path} failed`, stderr: res.stderr, stdout: res.stdout, code: res.code }
    throw Object.assign(new Error(err.message), err)
  }
  return parseJsonSafe(res.stdout)
}

async function apiPut(opCtx, path, body) {
  const c = glabClient(opCtx)
  const args = ['api', path, '--method', 'PUT']
  for (const [k, v] of Object.entries(body || {})) {
    if (v == null) continue
    if (Array.isArray(v)) args.push('-f', `${k}=${v.join(',')}`)
    else args.push('-f', `${k}=${String(v)}`)
  }
  const res = await c.run(args, { timeout: 8000 })
  if (res.code !== 0) {
    const err = { message: res.stderr || res.stdout || `api PUT ${path} failed`, stderr: res.stderr, stdout: res.stdout, code: res.code }
    throw Object.assign(new Error(err.message), err)
  }
  return parseJsonSafe(res.stdout)
}

async function fetchAugment(opCtx, refId, raw) {
  const iid = raw.iid
  if (iid == null) return raw
  // 聚合 notes + links（best-effort，失败忽略）
  try {
    const notes = await apiGet(opCtx, notesPath(refId, iid))
    if (Array.isArray(notes)) raw.notes = notes
  } catch {}
  try {
    const links = await apiGet(opCtx, linksPath(refId, iid))
    if (Array.isArray(links)) raw.links = links
  } catch {}
  return raw
}

export async function listIssues(ctx, repo, filter, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'list: repo.refId missing', '')
  // filter → query（state/labels/milestone/分页）
  const params = new URLSearchParams()
  params.set('per_page', '100')
  params.set('with_labels_details', 'true')
  if (filter && filter.state) {
    // GitLab state: opened/closed
    params.set('state', filter.state === 'closed' ? 'closed' : 'opened')
  }
  if (filter && Array.isArray(filter.keys) && filter.keys.length) {
    // GitLab无批量keys过滤，返回全量后前端过滤（诚实）
  }
  try {
    const path = issuesPath(id, params.toString())
    const c = glabClient(effective)
    const res = await c.run(['api', path], { timeout: 10000 })
    if (res.code !== 0) {
      // 原文 = 列票那一次 glab 调用的进程结果。
      return failGlab(res, res.stderr || res.stdout || 'list failed', res, effective)
    }
    let arr = parseJsonSafe(res.stdout)
    // 原文 = 远端回的那一段（人据此看出返回的到底是什么形状，而不是只被告知「不是数组」）。
    if (!Array.isArray(arr)) return fail(ERROR_KIND.PARSE, 'list returned non-array', res.stdout)
    // 若filter有keys，内存过滤
    if (filter && Array.isArray(filter.keys) && filter.keys.length) {
      const set = new Set(filter.keys.map(String))
      arr = arr.filter((x) => set.has(String(x.iid)))
    }
    if (filter && filter.parentKey !== undefined) {
      // parentKey过滤需links聚合（heavy），此处先返回全量由宿主侧二次过滤（诚实但不阻塞）
    }
    // 归一（不逐条聚合links以免爆量；get会聚合）
    const issues = arr.map((raw) => normalizeIssue(raw))
    return { ok: true, data: issues }
  } catch (err) {
    // 原文 = 抛上来的那个 Error 对象（apiGet/apiPut 已经把 stderr/stdout/退出码挂在它身上）。
    return failGlab(err, err && err.message ? String(err.message) : String(err), err, effective)
  }
}

export async function getIssue(ctx, repo, key, opts, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'get: repo.refId missing', '')
  const k = String(key)
  if (!k) return fail(ERROR_KIND.PARSE, 'get: key required', '')
  try {
    const raw = await apiGet(effective, `${issuePath(id, k)}?with_labels_details=true`)
    // 原文 = 这次接口回给我们的那个值（它不是一张票的形状，所以按「没找到」如实失败）。
    if (!raw || typeof raw !== 'object') return fail(ERROR_KIND.NOTFOUND, `issue ${k} not found`, raw === undefined || raw === null ? '' : raw)
    await fetchAugment(effective, id, raw)
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err) {
    // 原文 = 抛上来的那个 Error 对象（apiGet/apiPut 已经把 stderr/stdout/退出码挂在它身上）。
    return failGlab(err, err && err.message ? String(err.message) : String(err), err, effective)
  }
}

export async function createIssue(ctx, repo, input, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'create: repo.refId missing', '')
  if (!input || typeof input.title !== 'string' || !input.title.trim()) return fail(ERROR_KIND.PARSE, 'create: title required', '')
  try {
    // #711：幂等键当场检查 —— 不合规的键绝不落到 description 上，而且必须比回查更早失败。
    const wantKey = input.idempotencyKey === undefined || input.idempotencyKey === null ? null : checkIdempotencyKey(input.idempotencyKey)
    // 原文给这次用不了的键本身（判据不成立的原因在 message 里，原文让人看见实际给的是什么）。
    if (wantKey && !wantKey.ok) return fail(ERROR_KIND.PARSE, 'create: idempotencyKey 不能用：' + wantKey.reason, String(input.idempotencyKey))
    const idemKey = wantKey ? wantKey.key : ''
    // #711：建票之前先按锚回查（回查看的是票面上的 description，不是内存里的表）。
    // 命中就复用那张票、返回同一个 key，一个字节都不再往远端写；回查拿不准时如实失败、绝不建票。
    if (idemKey) {
      const found = await lookupByAnchor(repo, idemKey, effective)
      if (!found.ok) return found
      if (found.hit) return { ok: true, data: found.issue }
    }
    const body = { title: input.title.trim() }
    // 锚写在 description 的第一行（渲染后看不见的 HTML 注释），重试时凭它把这张票找回来。
    const description = withAnchor(typeof input.body === 'string' ? input.body : '', idemKey)
    if (description) body.description = description
    if (Array.isArray(input.labels) && input.labels.length) {
      const names = input.labels.map((l) => typeof l === 'string' ? l : l.name).filter(Boolean)
      if (names.length) body.labels = names.join(',')
    }
    // #722：到这里建票只走一条写路径（POST 到集合端点），回包判据与「许不许再发一次」都在纯函数里。
    // 「可能已经写出去」的回包（超时、EOF、回包形状不对、5xx）一律不再发第二次写，只如实失败并带上幂等键。
    // parentKey → 创建后链 relates_to
    const written = await writeNewIssue(effective, id, body)
    if (written.verdict.verdict !== 'created') {
      // 原文 = 建票那一次写路径的判据对象（回包形状、超时/EOF 都在里面）+ 实际发出去的 argv。
      // 这两样合起来才够人判断「那次写到底有没有落到远端」——正是这条支路要回答的问题。
      const writeRaw = JSON.stringify({ verdict: written.verdict, argvs: written.argvs })
      return fail(createWriteFailureKind(written.verdict), createWriteFailureMessage(written.verdict, idemKey, written.argvs), writeRaw)
    }
    const raw = written.verdict.issue
    // 若有parentKey，建立 relates_to
    if (input.parentKey != null) {
      try {
        const c = glabClient(effective)
        await c.run(['api', `${issuePath(id, raw.iid)}/links`, '--method', 'POST', '-f', `target_project_id=${id}`, '-f', `target_issue_iid=${String(input.parentKey)}`, '-f', 'link_type=relates_to'], { timeout: 8000 })
      } catch {}
    }
    await fetchAugment(effective, id, raw)
    const issue = normalizeIssue(raw)
    return { ok: true, data: issue }
  } catch (err) {
    // 原文 = 抛上来的那个 Error 对象（apiGet/apiPut 已经把 stderr/stdout/退出码挂在它身上）。
    return failGlab(err, err && err.message ? String(err.message) : String(err), err, effective)
  }
}

export async function closeIssue(ctx, repo, key, opts, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'close: repo.refId missing', '')
  const k = String(key)
  try {
    const raw = await apiPut(effective, issuePath(id, k), { state_event: 'close' })
    const issue = normalizeIssue(raw || { iid: k, state: 'closed' })
    return { ok: true, data: issue }
  } catch (err) {
    // 原文 = 抛上来的那个 Error 对象（apiGet/apiPut 已经把 stderr/stdout/退出码挂在它身上）。
    return failGlab(err, err && err.message ? String(err.message) : String(err), err, effective)
  }
}

export async function reopenIssue(ctx, repo, key, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'reopen: repo.refId missing', '')
  const k = String(key)
  try {
    const raw = await apiPut(effective, issuePath(id, k), { state_event: 'reopen' })
    const issue = normalizeIssue(raw || { iid: k, state: 'opened' })
    return { ok: true, data: issue }
  } catch (err) {
    // 原文 = 抛上来的那个 Error 对象（apiGet/apiPut 已经把 stderr/stdout/退出码挂在它身上）。
    return failGlab(err, err && err.message ? String(err.message) : String(err), err, effective)
  }
}

export async function updateIssue(ctx, repo, key, patch, opCtx) {
  const effective = opCtx || ctx
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND, 'update: repo.refId missing', '')
  const k = String(key)
  if (!patch || typeof patch !== 'object') return fail(ERROR_KIND.PARSE, 'update: patch required', '')
  try {
    const body = {}
    if (typeof patch.title === 'string') body.title = patch.title
    if (typeof patch.body === 'string') body.description = patch.body
    if ('milestone' in patch) {
      if (patch.milestone === null) body.milestone_id = 0 // 清除
      else if (patch.milestone && typeof patch.milestone.name === 'string') {
        // 查 milestone_id
        const search = encodeURIComponent(patch.milestone.name)
        const miles = await apiGet(effective, milestonesPath(id, `search=${search}`))
        const found = Array.isArray(miles) ? miles.find((m) => m.title === patch.milestone.name) : null
        // 原文 = 按名字查里程碑那一次 GET 的回包（人据此看出远端到底有哪些里程碑）。
        if (!found) return fail(ERROR_KIND.NOTFOUND, `milestone '${patch.milestone.name}' not found`, JSON.stringify(miles))
        body.milestone_id = found.id
      }
    }
    if (Array.isArray(patch.customFields) && patch.customFields.length) {
      // 原文给这次传进来的那些自定义字段（这条支路一个请求都没发，没有远端回包）。
      return fail(ERROR_KIND.UNSUPPORTED, 'customFields not supported on gitlab', JSON.stringify(patch.customFields))
    }
    if (Object.keys(body).length === 0) {
      // 无可更新字段，返回当前
      return getIssue(ctx, repo, k, {}, effective)
    }
    const raw = await apiPut(effective, issuePath(id, k), body)
    await fetchAugment(effective, id, raw || { iid: k })
    const issue = normalizeIssue(raw || { iid: k, ...body })
    return { ok: true, data: issue }
  } catch (err) {
    // 原文 = 抛上来的那个 Error 对象（apiGet/apiPut 已经把 stderr/stdout/退出码挂在它身上）。
    return failGlab(err, err && err.message ? String(err.message) : String(err), err, effective)
  }
}

export default { listIssues, getIssue, createIssue, closeIssue, reopenIssue, updateIssue }
