/**
 * src/tracker/rooms/github/read/deps-read.ts —— 依赖投影的读路径（#1304）。
 * #1686 阶段 1：从房间根迁入 read/，旧路径 src/tracker/rooms/github/deps-read.ts 保留纯转发，行为零变化。
 * #1687 阶段 1：getDependencies（入口校验＋批量分支）从房间根 graph.ts 并入本文件；它只读不写，归读侧，
 * 导出面与行为不变，旧路径 graph.ts 保留纯转发。
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
 * 每趟只落一行 `read.degraded`（op 固定 `deps`）：原生到上限写 `deps:truncated`、
 * 退回整仓反推但结果完整写 `deps:shape`、兜底也没读全写 `deps:scan`。
 * 三条取值登记在 `./read-log.ts`；这行日志让事后翻导出包的人能直接把「慢」与「不全」归到依赖这条读路上。
 *
 * 写阻塞边仍然只认 blockedBy（真源不变）：这里只是读投影。
 */

import type { Issue, IssueRef, RepositoryRef } from '../../../contract/entities.js'
import type { DepsOpts } from '../../../contract/inputs.js'
import type { Dependencies, DependenciesResult, OpResult } from '../../../contract/results.js'
import { ERROR_KIND } from '../../../contract/vocabulary.js'
import { fail } from '../../../kernel/preflight.js'
import { ghClient } from '../transport/client.js'
import { getIssue, listIssues } from './issues.js'
import { ghFailureMessage, ghVerdictOf } from '../support/errors.js'
import { parseRepo, repoId } from '../model/issue-key.js'
import type { ParsedRepo } from '../model/issue-key.js'
import { normalizeDependencyEdges } from '../model/normalize.js'
import { DEPS_MAX, DEPS_QUERY } from '../channels/graphql/queries.js'
import { emitReadDegraded } from '../support/read-log.js'
import { beginRead } from '../routing/read-result.js'
import type { ReadClock } from '../routing/read-result.js'
import { dependenciesProvenanceFromGraphql, dependenciesProvenanceFromRest } from '../routing/read-assembly.js'
import type { MemoContext } from '../model/roster.js'

/**
 * 原生路：一次 GraphQL 同时取回正向与反向连接。
 * 失败（起不了进程、回包不是 JSON、回 errors、缺 repository.issue）一律回 null 交给兜底 ——
 * 不把「没读到」当成「没有依赖」，也不在这里自己拼一份空边糊弄调用方。
 * 到了后端一次能给的条数上限时照常返回已给的条目，但把「不全」写进 Complete 位与注记。
 */
async function readNativeDependencies(parsed: ParsedRepo, k: string, ctx: MemoContext, started: number): Promise<Dependencies | null> {
  const num = Number(k)
  if (!Number.isFinite(num)) return null
  const c = ghClient(ctx)
  const args = ['api', 'graphql', '-f', 'query=' + DEPS_QUERY, '-f', 'owner=' + parsed.owner, '-f', 'name=' + parsed.name, '-F', 'number=' + String(num)]
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
    blockedByComplete: !edges.blockedByTruncated,
  }
  if (edges.blockingTruncated || edges.blockedByTruncated) {
    // 人话：不写 GraphQL 术语（连接、字段、上限之外的词），只说「后端一次最多给多少、这次到了顶」。
    let note = '这次读到的反向边来自后端自带的「我挡住了谁」，一次就取回来了'
    if (edges.blockingTruncated) {
      note += '；但它一次最多给 ' + DEPS_MAX + ' 条，反向边这次到了上限，可能不全（' + DEPS_MAX + ' 条是后端一次能给的上限，不是「没有阻塞别人」）'
    }
    if (edges.blockedByTruncated) {
      note += '；「被谁阻塞」这一侧也到了 ' + DEPS_MAX + ' 条上限，可能不全'
    }
    data.blockingNote = note + '。'
    emitReadDegraded(ctx, 'deps', 'deps:truncated', Date.now() - started)
  }
  return data
}

/**
 * 兜底路：原生反向字段不可用时，退回整仓列表逐行看 blockedBy 里有没有这张票。
 * 标题与状态直接取列表行本身，不再逐张读 —— 原来那一串 N+1 读标题就出在这里。
 * 列表被截断、走了 REST、或干脆没读回来时，结果可能不全：标记位与注记都会说清。
 *
 * 有意不再先试名册快路（旧路：名册完整就零整仓拉取、只定向重读脏票）：那条路要拿标题还是得逐张读，
 * 又回到 N+1；#1304 要求名册命中与整仓兜底两条路都不许逐张读标题。兜底只在后端没有原生反向字段时
 * 才走，代价大但少见；换来的是每条路都只翻一次整仓、标题随列表行回来。
 */
async function readScanDependencies(repo: RepositoryRef, k: string, ctx: MemoContext, started: number, clock: ReadClock): Promise<DependenciesResult> {
  const cur = await getIssue(repo, k, {}, ctx)
  if (!cur.ok) {
    // 连目标票本身都没读回来：这一趟依赖投影彻底没成，兜底路也没走通。
    emitReadDegraded(ctx, 'deps', 'deps:scan', Date.now() - started)
    return cur
  }
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
    ? '这次没能直接读到后端自带的「我挡住了谁」，只好退回整仓列表反推（把票单拉回来，逐张看谁挡住了谁）；那份清单可能不全（整仓超过后端一次能给的条数、走了别的通道，或这次没读回来），所以「阻塞别人」可能不全 —— 不是「没有阻塞别人」。'
    : '这次没能直接读到后端自带的「我挡住了谁」，只好退回整仓列表反推；结果是完整的，但票越多越慢。'
  // 一趟只落一行：兜底已走完，按最终完整性挑原因（列表被截断优先归为 truncated）。
  emitReadDegraded(ctx, 'deps', incomplete ? (listTruncated ? 'deps:truncated' : 'deps:scan') : 'deps:shape', Date.now() - started)
  // 来源按反推那份整仓列表实际走的通道记：走 REST 时同时记「GraphQL 没成、降级过来」。
  // blockedBy 这一侧来自目标票本身的原生字段，永远表达得出来；反推出来的 blocking 那一侧在清单不全时给 null（记未表达，不给 0）。
  const facts = { blockedByCount: blockedBy.length, blockingCount: incomplete ? null : blocking.length }
  return {
    ok: true,
    data: data,
    provenance: walkedRest ? dependenciesProvenanceFromRest(clock, facts) : dependenciesProvenanceFromGraphql(clock, facts),
  }
}

/**
 * 读一张票的依赖投影：先原生，取不到才退回整仓反推。
 * 返回的 `blockingSource` / `blockingComplete` / `blockedByComplete` / `blockingNote`
 * 让工具层能把「用了哪条路、全不全」如实带给调用方。
 */
export async function readDependencies(repo: RepositoryRef, parsed: ParsedRepo, k: string, ctx: MemoContext): Promise<DependenciesResult> {
  const started = Date.now()
  // 读来源记录从入口起算（#1686）：原生成功与退回反推两条路都在成功分支挂 provenance。
  const clock = beginRead()
  const native = await readNativeDependencies(parsed, k, ctx, started)
  if (native) {
    return {
      ok: true,
      data: native,
      provenance: dependenciesProvenanceFromGraphql(clock, { blockedByCount: native.blockedBy.length, blockingCount: native.blocking.length }),
    }
  }
  return readScanDependencies(repo, k, ctx, started, clock)
}

// 判档失败时把错误转成最小形状再读（catch 出来是 unknown，直接读 message 报缺成员）：与旧 graph.ts 同一函数体。
type CaughtMsg = { message?: unknown } | null;
function caughtMessage(e: unknown, len: number): string {
  const eb = e as CaughtMsg;
  return String((eb && eb.message) || e).slice(0, len)
}

/**
 * getDependencies(repo, key, opts, ctx) -> OpResult<{blockedBy, blocking, blockingSource, blockingComplete}>
 * - blockedBy 读自 GitHub blockedBy 边（唯一真源，写边也只认它）
 * - blocking 反向投影：原生字段一次查询取回，开销与仓库总票数无关；原生不可用才退回整仓列表反推。
 *   退回兜底、或者连接/列表到了上限时，返回值会自己说清「用了兜底」「可能不全」（见本文件上面两条读路）。
 * - #1687 从房间根 graph.ts 迁到这里：它只读不写，归读侧；房间入口仍按旧接口名要它，导出面不变。
 */
export async function getDependencies(repo: RepositoryRef, key: string, opts: DepsOpts | undefined, ctx: MemoContext): Promise<OpResult<Dependencies>> {
  try {
    const parsed = parseRepo(repo)
    if (!parsed) return fail(ERROR_KIND.NOTFOUND, `getDependencies: repo.refId missing: ${repoId(repo)}`, repo)
    // 批量模式：opts.keys
    if (opts && Array.isArray(opts.keys) && opts.keys.length) {
      // 批量返回聚合：对每 key 各自取依赖投影，再合并；宿主快照平时逐 key 调用，多 key 分支罕见。
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
    // 读路径整段委托给下面那条 readDependencies：原生优先、兜底自曝，这里只留入口校验与判档。
    return await readDependencies(repo, parsed, k, ctx)
  } catch (e) {
    // 判档只走本房唯一的出口（`ghVerdictOf`）：档位由规则表判、话术按票面实现决定第 11 条挑。
    // 第三段把出错的那个值原样交出去当原文。
    const verdict = ghVerdictOf(e, ctx)
    return fail(verdict.kind, ghFailureMessage(verdict, caughtMessage(e, 800)), e)
  }
}
