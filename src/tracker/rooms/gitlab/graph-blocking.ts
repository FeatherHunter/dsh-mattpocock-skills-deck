// graph-blocking.ts —— 以后改阻塞关系语义时改它：Blocked by 行格式、原生 blocked_by 探测、读合并写回退、环检、阻塞读写两操作。
// 抓取底座（repoId/fetchRawIssue）暂住本文件，亲缘文件从本文件单向导入（同房互引，老门禁放行；本文件不依赖亲缘文件）。
import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { Issue, IssueRef, RepositoryRef } from '../../contract/entities.js'
import type { DepsOpts, SetOpts } from '../../contract/inputs.js'
import type { Dependencies, OpResult } from '../../contract/results.js'
import type { State, IssueType } from '../../contract/identity.js'
import { fail } from '../../preflight.js'
import { glabClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { failGlab } from './errors.js'
import { issuePath, linksPath } from './queries.js'

// 仓库身份只取 refId/name，是因为阻塞读写只认这两样，拿全量会把 effortId 搅进来。
type RepoLike = Partial<RepositoryRef> | null | undefined
// 上下文两形都收，是因为调用方有时把执行器放在 ctx、有时放在 opCtx，缺了就让 glabClient 按 127 回。
type CtxLike = Partial<OpContext> & Partial<BackendContext>
type RawBag = Record<string, unknown>

// 远端回包先收成袋再读，是因为 links/iid 等字段可缺可空，直接按定型读会把缺字段当成错。
interface NativeProbe {
  native: RawBag[] | null
  probeFailed: boolean
  nativeEmpty?: boolean
}

// 抛出去的错要带原始回包，是因为上层只 catch 到一个 Error，原文得躺在错身上才拿得到。
interface GlabFetchError extends Error {
  stderr?: string
  stdout?: string
  code?: number
}

export function repoId(repo: RepoLike): string {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

function parseBlockedByLine(body: unknown): string[] | null {
  if (typeof body !== 'string' || !body) return null
  const m = body.match(/^Blocked by:\s*(.+)$/m)
  if (!m) return null
  const line = (m[1] as string).trim()
  if (!line) return []
  const parts = line
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    const mm = p.match(/#(\d+)\s*$/)
    const key = mm ? (mm[1] as string) : p.replace(/^#/, '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

function buildBlockedByLine(keys: string[]): string {
  if (!keys || keys.length === 0) return ''
  return `Blocked by: ${keys.map((k) => `#${k}`).join(', ')}`
}

function rewriteDescriptionWithBlockedBy(oldBody: string | null | undefined, keys: string[]): string {
  const body = oldBody || ''
  const line = buildBlockedByLine(keys)
  if (/^Blocked by:\s*.+$/m.test(body)) {
    if (!line) return body.replace(/^Blocked by:\s*.+$/m, '').replace(/^\n+/, '')
    return body.replace(/^Blocked by:\s*.+$/m, line)
  }
  if (!line) return body
  return line + (body ? '\n\n' + body : '')
}

/**
 * 按 iid 拉一张票的原始形状：成功回票面，失败抛带原文的错以便上层归一。
 *
 * @param opCtx 本次调用的上下文（glabClient 吃这个 ctx）
 * @param refId 目标仓库（形如 group/project）
 * @param key 票号（iid 字符串）
 */
export async function fetchRawIssue(
  opCtx: CtxLike | null | undefined,
  refId: string,
  key: string,
): Promise<RawBag | null> {
  const c = glabClient(opCtx as Partial<OpContext> & Partial<BackendContext>)
  const res = await c.run(['api', `${issuePath(refId, key)}?with_labels_details=true`], { timeout: 8000 })
  if (res.code !== 0) {
    // 抛出去的那个错带上这一趟的原始回包（stderr/stdout/退出码）：上层只 catch 到一个 Error 时，
    // 原始回包仍然躺在这个错上，`fail()` 取原文时才拿得到「glab 到底说了什么」。
    const err = new Error(res.stderr || res.stdout) as GlabFetchError
    err.stderr = res.stderr
    err.stdout = res.stdout
    err.code = res.code
    throw err
  }
  let raw: unknown = null
  try {
    raw = JSON.parse(res.stdout) as unknown
  } catch {
    raw = null
  }
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) return raw as RawBag
  return raw as RawBag | null
}

async function tryNativeBlockedBy(
  opCtx: CtxLike | null | undefined,
  refId: string,
  key: string,
): Promise<NativeProbe> {
  // 试原生：GET .../blocked_by 或 links过滤 is_blocked_by
  // GitLab原生blocking仅Premium；free返回403/404
  const c = glabClient(opCtx as Partial<OpContext> & Partial<BackendContext>)
  // 先试 links filtered
  const res = await c.run(['api', linksPath(refId, key)], { timeout: 8000 })
  if (res.code !== 0) {
    const s = String(res.stderr || res.stdout || '').toLowerCase()
    if (/403|404|premium|not found/.test(s)) return { native: null, probeFailed: true }
    return { native: null, probeFailed: true }
  }
  try {
    const links: unknown = JSON.parse(res.stdout) as unknown
    if (Array.isArray(links)) {
      const blocked = (links as RawBag[]).filter(
        (l) => String(l['link_type'] || '').toLowerCase() === 'is_blocked_by',
      )
      if (blocked.length > 0) return { native: blocked, probeFailed: false }
      // 若有 links 但无 is_blocked_by，视为原生空（忽略回退）
      // 需判断是否有 blocking 能力：若 links 端点可达，说明 free也有 relates_to，此时对 blocking 仍应判无原生能力
      // 简化：仅当 filtered is_blocked_by 有值才用原生；否则视为无原生， fallback
      return { native: null, probeFailed: false, nativeEmpty: true }
    }
  } catch {
    // 读不出链接形状就按探针失败走回退，不拦主流程。
  }
  return { native: null, probeFailed: true }
}

// 环检：DFS对blockedBy图（Kahn简化版，针对增量检测），新边连出环就拦下这次写。
function hasCycle(allBlockedByMap: Map<string, string[]>, startKey: string, newBlockers: string[]): boolean {
  const graph = new Map<string, string[]>()
  for (const [k, v] of allBlockedByMap) graph.set(k, [...v])
  graph.set(startKey, [...newBlockers])
  const visited = new Set<string>()
  const stack = new Set<string>()
  function dfs(node: string): boolean {
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

function errMsg(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'message' in (err as Record<string, unknown>)) {
    const m = (err as Record<string, unknown>)['message']
    if (typeof m === 'string' && m) return m
  }
  return String(err)
}

/**
 * 读一张票被谁阻塞：原生 is_blocked_by 有值就用原生，否则回退读 Blocked by 行。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param key 票号（iid 字符串）
 * @param opts 批量选项（今天只用单票，keys 由宿主缓存层处理）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function getDependencies(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  opts: DepsOpts | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Dependencies>> {
  void opts
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'getDependencies: repo.refId missing', '')
  const k = String(key)
  try {
    // 读当前 issue 的 blockedBy（走原生优先→回退）
    let raw: RawBag | null = null
    try {
      raw = await fetchRawIssue(effective, id, k)
    } catch (e: unknown) {
      // 原文 = 读票面失败的那个 Error（它身上带着 glab 的 stderr/stdout）。
      return failGlab(e, errMsg(e), e, effective)
    }
    // 尝试原生
    let blockedKeys: string[] = []
    try {
      const probe = await tryNativeBlockedBy(effective, id, k)
      if (probe.native && probe.native.length > 0) {
        blockedKeys = probe.native.map((b) => String(b['iid'] || b['target_issue_iid'] || b['key'] || ''))
      } else if (probe.nativeEmpty) {
        // 原生空但可达 → 按#144合并策略：原生有值忽略回退，原生空时只用回退？此处links可达但blocking原生不可达，仍用回退
        const fromLine = parseBlockedByLine((raw && (raw['description'] || raw['body'])) || '')
        if (fromLine !== null) blockedKeys = fromLine
      } else if (probe.probeFailed) {
        const fromLine = parseBlockedByLine((raw && (raw['description'] || raw['body'])) || '')
        if (fromLine !== null) blockedKeys = fromLine
      } else {
        const fromLine = parseBlockedByLine((raw && (raw['description'] || raw['body'])) || '')
        if (fromLine !== null) blockedKeys = fromLine
      }
    } catch {
      const fromLine = parseBlockedByLine((raw && (raw['description'] || raw['body'])) || '')
      if (fromLine !== null) blockedKeys = fromLine
    }

    const blockedBy: IssueRef[] = blockedKeys.map((kk) => ({
      key: String(kk),
      title: `#${kk}`,
      state: 'open' as State,
      type: 'issue' as IssueType,
    }))
    // blocking反向聚合由宿主投影，此处仅返回便利投影：blocking=[]（后端不维护第二真相）
    return { ok: true, data: { blockedBy, blocking: [] } }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身。
    return failGlab(err, errMsg(err), err, effective)
  }
}

/**
 * 写阻塞：自环先拦，环检拦增量成环，其余重写 description 的 Blocked by 行。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId/name）
 * @param key 票号（iid 字符串）
 * @param blockers 要换成的阻塞者整集（iid 字符串数组）
 * @param opts 乐观并发选项（对不上就回 conflict，不写）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function setBlockedBy(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  blockers: string[],
  opts: SetOpts | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const id = repoId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'setBlockedBy: repo.refId missing', '')
  const k = String(key)
  if (!k) return fail(ERROR_KIND.PARSE as ErrorKind, 'setBlockedBy: key required', '')
  const wanted: string[] = Array.isArray(blockers) ? [...new Set(blockers.map(String).filter(Boolean))] : []
  // 自环先判
  // 这一处没有外部来源的原文：结论是「入参自己和自己打架」。原文给这次请求的入参快照，
  // 让人一眼看见是哪张票被指成了自己的阻塞者。
  if (wanted.includes(k)) return fail(ERROR_KIND.CONFLICT as ErrorKind, `conflict: self-loop ${k}`, JSON.stringify({ key: k, blockers: wanted }))
  try {
    const raw = (await fetchRawIssue(effective, id, k)) as RawBag | null
    // 回包不是一个带 iid 的票面（空对象/空值）：没有外部错误文本，原文给空串。
    if (!raw) return fail(ERROR_KIND.NOTFOUND as ErrorKind, `issue ${k} not found`, '')
    // If-Match
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const cur = (raw['updated_at'] || raw['updatedAt'] || '') as string
      // 原文 = 回读到的票面（人据此自己核对远端现在是什么版本）。
      if (cur !== opts.expectedUpdatedAt) {
        return fail(ERROR_KIND.CONFLICT as ErrorKind, `conflict: expectedUpdatedAt mismatch (want ${opts.expectedUpdatedAt} got ${cur})`, JSON.stringify(raw))
      }
    }
    // 探针：原生是否可用
    let useNative = false
    try {
      const probe = await tryNativeBlockedBy(effective, id, k)
      if (probe.native !== null || probe.nativeEmpty === false) useNative = false // 若原生有is_blocked_by，优先原生（但当前策略free回退）
      // 按#144推荐：free/CE写回Blocked by行，而非报unsupported；检测首调403/404即判无能力
      if (!probe.probeFailed && probe.native && probe.native.length > 0) useNative = true
    } catch {
      // 探针失败就走回退，不拦主流程。
    }

    if (useNative) {
      // 原生路径：需 diff links (is_blocked_by)
      // 简化：调用 set via glab api links（此处桩为回退，真实 premium 仍走回退可通过）
      // 原文给空串：这条支路今天一个请求都没发出去，没有远端回包可交（那句话说给人听的别当原文）。
      return fail(ERROR_KIND.UNSUPPORTED as ErrorKind, 'native blocking write pending premium path (use fallback)', '')
    }

    // 回退路径：重写 description 的 Blocked by: 行
    const oldBody = String(raw['description'] || raw['body'] || '')
    const newBody = rewriteDescriptionWithBlockedBy(oldBody, wanted)

    // 环检（best-effort：拉全量 blockedBy 图）
    try {
      const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
      const listRes = await c.run(['api', `projects/${encodeURIComponent(id)}/issues?per_page=100`], { timeout: 8000 })
      if (listRes.code === 0) {
        let arr: unknown = []
        try {
          arr = JSON.parse(listRes.stdout) as unknown
        } catch {
          arr = []
        }
        if (Array.isArray(arr)) {
          const map = new Map<string, string[]>()
          for (const it of arr as RawBag[]) {
            const kk = String(it['iid'])
            if (kk === k) continue
            const line = parseBlockedByLine(it['description'] || '')
            if (line) map.set(kk, line)
            else if (Array.isArray(it['blocked_by']) && (it['blocked_by'] as RawBag[]).length) {
              map.set(kk, (it['blocked_by'] as RawBag[]).map((b) => String(b['iid'])))
            }
          }
          if (hasCycle(map, k, wanted)) {
            // 原文 = 这次看到的阻塞关系快照（人据此自己复算那条环），不是给人看的那句结论。
            return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: cycle detected', JSON.stringify({ key: k, wanted, observed: Array.from(map.entries()) }))
          }
        }
      }
    } catch {
      // 环检读不全就不拦这次写，免得把读失败当成写失败。
    }

    const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
    const putRes = await c.run(['api', issuePath(id, k), '--method', 'PUT', '-f', `description=${newBody.replace(/\n/g, '\\n')}`], { timeout: 8000 })
    // glab api 对换行处理：改用 --input stdin 更稳妥，重试
    const res = putRes
    if (putRes.code !== 0) {
      // 重试：用 glabClient.api PUT with body object
      const raw2 = await fetchRawIssue(effective, id, k) // fresh
      void raw2
      // 直接 PUT description via glab api with -f (handle multiline via stdin file)
      // 简化：返回 conflict 报文
      // 原文 = 写阻塞那一次 PUT 的进程结果（stderr/stdout/退出码都在里面）。
      return failGlab(putRes, putRes.stderr || putRes.stdout || 'setBlockedBy failed', putRes, effective)
    }
    let updatedRaw: unknown = null
    try {
      updatedRaw = JSON.parse(res.stdout) as unknown
    } catch {
      updatedRaw = { iid: k, description: newBody }
    }
    // 归一并返回
    // 需补 links 未变，直接 normalize
    const ub = updatedRaw !== null && typeof updatedRaw === 'object' ? (updatedRaw as RawBag) : ({} as RawBag)
    if (!ub['links']) {
      try {
        const linksRes = await glabClient(effective as Partial<OpContext> & Partial<BackendContext>).run(['api', linksPath(id, k)], { timeout: 5000 })
        if (linksRes.code === 0) {
          try {
            ub['links'] = JSON.parse(linksRes.stdout) as unknown
          } catch {
            // 读不出链接就按无链接归一，不拦主流程。
          }
        }
      } catch {
        // 链接读失败就按无链接归一，不拦主流程。
      }
    }
    const issue = normalizeIssue(ub)
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身。kind 为 conflict 时这里走的是透传那一路，
    // 本家那句话原样留着，不会被换成通用提示。
    return failGlab(err, errMsg(err), err, effective)
  }
}

