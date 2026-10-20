/**
 * src/tracker/rooms/github/deps-read.ts —— 依赖投影的读路径（#1304）。
 *
 * 一只票的「被谁阻塞」与「阻塞了谁」本来要读两条边：正向的 blockedBy 与反向的 blocking。
 * 从前反向边靠「整仓列表逐行看 blockedBy 里有没有这张票」推出来，再逐张读标题：
 * 千级票仓一次要 25～29 秒，列表被上限截断时还会静默少边（看起来像「没人被它阻塞」）。
 *
 * 现在先问后端原生的反向字段：一条 GraphQL 查询同时拿回两条连接，标题与状态随行返回，
 * 开销与仓库总票数无关，也不用再逐张读标题。原生字段不可用（老版本、非 GitHub、查询失败）时，
 * 才退回整仓列表反推 —— 而且只要退回了、或列表被截断，回执必须自己说「用了兜底」「可能不全」，
 * 不许把「没看到」说成「没有」。
 *
 * 写阻塞边仍然只认 blockedBy（真源不变）：这里只是读投影。
 */

import type { Issue, IssueRef, RepositoryRef } from '../../contract/entities.js'
import type { Dependencies, OpResult } from '../../contract/results.js'
import { ghClient } from './client.js'
import { getIssue, listIssues } from './issues.js'
import { normalizeDependencyEdges } from './normalize.js'
import { DEPS_QUERY } from './queries.js'
import type { MemoContext } from './roster.js'

/** 仓库定位：拥有者 + 仓名（形状与 graph.ts 里那个同名接口一致）。 */
interface ParsedRepo {
  owner: string
  name: string
}

/** 后端一次最多给多少条反向边（与 DEPS_QUERY 里的 first:50 是同一个数，改一处必须全改）。 */
const DEPS_MAX = 50

/**
 * 原生路：一次 GraphQL 同时取回正向与反向连接。
 * 失败（起不了进程、回包不是 JSON、回 errors、缺 repository.issue）一律回 null 交给兜底 ——
 * 不把「没读到」当成「没有依赖」，也不在这里自己拼一份空边糊弄调用方。
 */
async function readNativeDependencies(parsed: ParsedRepo, k: string, ctx: MemoContext): Promise<Dependencies | null> {
  const num = Number(k)
  if (!Number.isFinite(num)) return null
  const c = ghClient(ctx)
  const args = ['api', 'graphql', '-f', 'query=' + DEPS_QUERY, '-F', 'owner=' + parsed.owner, '-F', 'name=' + parsed.name, '-F', 'number=' + String(num)]
  const r = await c.execGh(args, { cwd: ctx && ctx.cwd, via: 'deps.gql' })
  if (!r.ok) return null
  let j: unknown
  try { j = JSON.parse((r.data && r.data.stdout) || '') } catch (e) { return null }
  const root = j as { errors?: unknown; data?: { repository?: { issue?: unknown } } } | null
  if (!root || root.errors) return null
  const issueRaw = root.data && root.data.repository ? root.data.repository.issue : null
  if (!issueRaw || typeof issueRaw !== 'object') return null
  // 回包里必须真有这两条连接：缺 blockedBy 或 blocking 都按「原生字段不可用」退回兜底 ——
  // 少了字段却当空连接收下，正好会把「没看到」说成「没有」，那是这张票要修的病。
  const rawBag = issueRaw as Record<string, unknown>
  if (!rawBag.blockedBy || typeof rawBag.blockedBy !== 'object') return null
  if (!rawBag.blocking || typeof rawBag.blocking !== 'object') return null
  const edges = normalizeDependencyEdges(issueRaw)
  const data: Dependencies = {
    blockedBy: edges.blockedBy,
    blocking: edges.blocking,
    blockingSource: 'native',
    blockingComplete: !edges.blockingTruncated,
  }
  if (edges.blockingTruncated) {
    data.blockingNote = '反向边这次从后端的原生字段一次取回，但连接到了 ' + DEPS_MAX + ' 条上限，可能不全：这是后端一次能给的上限，不是「没有阻塞别人」。'
  }
  return data
}

/**
 * 兜底路：原生反向字段不可用时，退回整仓列表逐行看 blockedBy 里有没有这张票。
 * 标题与状态直接取列表行本身，不再逐张读 —— 原来那一串 N+1 读标题就出在这里。
 * 列表被截断、走了 REST、或干脆没读回来时，结果可能不全：标记位与注记都会说清。
 */
async function readScanDependencies(repo: RepositoryRef, k: string, ctx: MemoContext): Promise<OpResult<Dependencies>> {
  const cur = await getIssue(repo, k, {}, ctx)
  if (!cur.ok) return cur
  const blockedBy: IssueRef[] = Array.isArray(cur.data.blockedBy) ? cur.data.blockedBy : []

  // 列表这一步失败不把整件事判失败（正向边已经读到了），而是按「不全」如实交代。
  type ListShape = { ok: boolean; data?: unknown; truncated?: boolean; fallback?: string; error?: unknown }
  let allRes: ListShape | null = null
  try { allRes = await listIssues(repo, {}, ctx) as unknown as ListShape } catch (e) { allRes = null }
  const listOk = !!(allRes && allRes.ok === true)
  const rows: Issue[] = listOk && Array.isArray(allRes!.data) ? allRes!.data as Issue[] : []
  const walkedRest = !!(allRes && allRes.fallback === 'rest')
  const listTruncated = !!(allRes && allRes.truncated === true)
  const incomplete = !listOk || walkedRest || listTruncated

  const blocking: IssueRef[] = []
  for (const row of rows) {
    if (!row || String(row.key) === k) continue
    const blockers = Array.isArray(row.blockedBy) ? row.blockedBy : []
    if (!blockers.some((b) => b && String(b.key) === k)) continue
    const ref: IssueRef = { key: String(row.key), title: String(row.title || ''), state: row.state }
    if (row.type) ref.type = row.type
    blocking.push(ref)
  }

  const data: Dependencies = {
    blockedBy: blockedBy,
    blocking: blocking,
    blockingSource: 'scan',
    blockingComplete: !incomplete,
  }
  data.blockingNote = incomplete
    ? '原生反向边字段这次没取到，退回整仓列表反推；整仓列表被上限截断（工单 500 条、拉取请求 1000 条）、走了 REST，或没读回来，所以「阻塞别人」可能不全 —— 不是「没有阻塞别人」。'
    : '原生反向边字段这次没取到，退回整仓列表反推（结果完整，但代价随仓库票数增长）。'
  return { ok: true, data: data }
}

/**
 * 读一张票的依赖投影：先原生，取不到才退回整仓反推。
 * 返回的 `blockingSource` / `blockingComplete` / `blockingNote` 让工具层能把「用了哪条路、全不全」如实带给调用方。
 */
export async function readDependencies(repo: RepositoryRef, parsed: ParsedRepo, k: string, ctx: MemoContext): Promise<OpResult<Dependencies>> {
  const native = await readNativeDependencies(parsed, k, ctx)
  if (native) return { ok: true, data: native }
  return readScanDependencies(repo, k, ctx)
}