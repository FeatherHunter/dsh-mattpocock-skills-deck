// graph-blocking.ts —— 以后改阻塞关系语义时改它：Blocked by 行格式、原生 blocked_by 探测、读合并写回退、环检、阻塞读写两操作。
// 抓取底座（repoId/fetchRawIssue）暂住本文件，亲缘文件从本文件单向导入（同房互引，老门禁放行；本文件不依赖亲缘文件）。
import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { Issue, IssueRef, RepositoryRef } from '../../contract/entities.js'
import type { DepsOpts, SetOpts } from '../../contract/inputs.js'
import type { Dependencies, OpResult } from '../../contract/results.js'
import type { State, IssueType } from '../../contract/identity.js'
import { fail } from '../../kernel/preflight.js'
import { glabClient } from './client.js'
import { normalizeIssue } from './normalize.js'
import { failGlab } from './errors.js'
import { issuePath, linksPath } from './queries.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GITLAB_READ_TIMEOUT_MS, GITLAB_PROBE_TIMEOUT_MS } from '../../../shared/time-config/src/values.js'
import { PAGINATION } from '../pagination.js'

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
  const res = await c.run(['api', `${issuePath(refId, key)}?with_labels_details=true`], { timeout: GITLAB_READ_TIMEOUT_MS })
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
  const res = await c.run(['api', linksPath(refId, key)], { timeout: GITLAB_READ_TIMEOUT_MS })
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

// 原生能力缺失的信号：免费档/无许可时服务端回 403，或 links 端点不存在（404），或回包点名 blocking 要 Premium。
// 404 在这里只表示「links 端点没有」不表示「票没有」——调到这里之前票已经取回来了，所以不会误判票的存在。
// 其它失败（超时、500）是故障不是没能力，必须如实失败，不能滑进回退（回退会掩盖一次没写成的写）。
function isNativeCapabilityError(res: { code: number; stdout: string; stderr: string } | null | undefined): boolean {
  if (!res || res.code === 0) return false
  const s = `${String(res.stderr || '')}\n${String(res.stdout || '')}`.toLowerCase()
  return /(^|\D)(403|404)(\D|$)|premium|blocked issues|not available/.test(s)
}

// 对端已知表：title 能从原生行直接拿，state 只有行里写明了才信（行里没写就逐张取对端票面，不猜）。
interface BlockerKnown {
  title?: string
  state?: State
}

// 对端状态：key -> { title, state }，title 取不到退回 `#key`。
// 取不到对端（删了/没权限）时 state 按 open 记：这是保守方向——不知道对端关没关，就当它还开着继续挡路；
// frontier 因此可能少放行，不会多放行。这个保守选择写在这里，调用方不用再猜。
async function resolveBlockerStates(
  effective: CtxLike | undefined,
  id: string,
  keys: string[],
  known: Map<string, BlockerKnown>,
): Promise<IssueRef[]> {
  const out: IssueRef[] = []
  for (const k of keys) {
    const hit = known.get(k)
    if (hit && hit.state) {
      out.push({ key: k, title: hit.title || `#${k}`, state: hit.state, type: 'issue' as IssueType })
      continue
    }
    try {
      const raw = (await fetchRawIssue(effective, id, k)) as unknown as RawBag
      const st: State = raw['state'] === 'closed' ? 'closed' : 'open'
      const rawTitle = raw['title']
      const title = typeof rawTitle === 'string' && rawTitle ? rawTitle : (hit && hit.title) || `#${k}`
      out.push({ key: k, title: title, state: st, type: 'issue' as IssueType })
    } catch {
      out.push({ key: k, title: (hit && hit.title) || `#${k}`, state: 'open' as State, type: 'issue' as IssueType })
    }
  }
  return out
}

// 环检用的阻塞图：先拉一页快照（正文行优先、回包 blocked_by 数组次之），
// 再从本次要写的阻塞出发沿边展开，把沿途各票的原生边并进来，最后统一交给 hasCycle 判定。
// 这样正文行世界的环与原生边织成的环都拦得住；读不到的节点当叶子——那一段藏着环就拦不住，这个缺口认。
async function buildBlockMap(
  effective: CtxLike | undefined,
  id: string,
  selfKey: string,
  wanted: string[],
): Promise<Map<string, string[]>> {
  void selfKey
  const map = new Map<string, string[]>()
  try {
    const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
    const listRes = await c.run(['api', `projects/${encodeURIComponent(id)}/issues?per_page=${PAGINATION.gitlab.maxPerPage}`], { timeout: GITLAB_READ_TIMEOUT_MS })
    if (listRes.code === 0) {
      let arr: unknown = []
      try {
        arr = JSON.parse(listRes.stdout) as unknown
      } catch {
        arr = []
      }
      if (Array.isArray(arr)) {
        for (const it of arr as RawBag[]) {
          const kk = String(it['iid'])
          if (!kk) continue
          const line = parseBlockedByLine(it['description'] || '')
          if (line) map.set(kk, line)
          else if (Array.isArray(it['blocked_by']) && (it['blocked_by'] as RawBag[]).length) {
            map.set(kk, (it['blocked_by'] as RawBag[]).map((b) => String(b['iid'])))
          }
        }
      }
    }
  } catch {
    // 快照拉不全就不拦这次写，免得把读失败当成写失败（与旧实现同一条纪律）。
  }
  const keyOf = (l: RawBag): string => String(l['iid'] ?? l['target_issue_iid'] ?? l['key'] ?? '')
  const seen = new Set<string>()
  const stack = [...wanted]
  while (stack.length > 0) {
    const cur = stack.pop() as string
    if (seen.has(cur)) continue
    seen.add(cur)
    const base = map.get(cur) || []
    let native: string[] = []
    try {
      const probe = await tryNativeBlockedBy(effective, id, cur)
      if (!probe.probeFailed && probe.native) native = probe.native.map(keyOf).filter(Boolean)
    } catch {
      // 这张票的原生边读不出就当它没有（叶子），不拦整张图。
    }
    const merged = [...new Set([...base, ...native])]
    map.set(cur, merged)
    for (const n of merged) if (!seen.has(n)) stack.push(n)
  }
  return map
}

// 原生阻塞真写（上限路径）：diff 出要加/要删，加在前、删在后，逐条 POST / DELETE。
// 顺序的理由：加的过程中撞上能力错误时，盘上还没删东西，滚回（删掉本轮刚加的）干净后才能滑进正文行回退；
// 滚不干净就如实失败——盘上已经动了，这时再写正文行会留下双份表示。
// 非能力错误直接如实失败，同样不滑进回退（同上：可能已动盘，回退会掩盖一次没写成的写）。
async function writeNativeBlockedBy(
  effective: CtxLike | undefined,
  id: string,
  key: string,
  wanted: string[],
  current: RawBag[],
  classifyCtx: CtxLike | null | undefined,
): Promise<{ ok: true } | { ok: false; fallback: boolean; message: string; raw: unknown }> {
  void classifyCtx
  const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
  const keyOf = (l: RawBag): string => String(l['iid'] ?? l['target_issue_iid'] ?? l['key'] ?? '')
  const currentKeys = current.map(keyOf).filter(Boolean)
  const linkIdOf = (k: string): string => {
    const row = current.find((l) => keyOf(l) === k)
    return row ? String(row['issue_link_id'] ?? row['link_id'] ?? '') : ''
  }
  const added: string[] = []
  for (const w of wanted) {
    if (currentKeys.includes(w)) continue
    const res = await c.run(
      ['api', linksPath(id, key), '--method', 'POST', '-f', `target_project_id=${id}`, '-f', `target_issue_iid=${w}`, '-f', 'link_type=is_blocked_by'],
      { timeout: GITLAB_READ_TIMEOUT_MS },
    )
    if (res.code !== 0) {
      if (!isNativeCapabilityError(res)) {
        return { ok: false, fallback: false, message: `阻塞真写：原生边 POST #${w} 失败（盘上是中间态，已加的不回滚）`, raw: res }
      }
      // 能力错误：滚回本轮刚加的，删干净才能回退。
      for (const a of added) {
        try {
          const back = await tryNativeBlockedBy(effective, id, key)
          const row = (back.native || []).find((l) => keyOf(l) === a)
          const linkId = row ? String(row['issue_link_id'] ?? row['link_id'] ?? '') : ''
          if (linkId) await c.run(['api', `${linksPath(id, key)}/${linkId}`, '--method', 'DELETE'], { timeout: GITLAB_READ_TIMEOUT_MS })
        } catch {
          // 滚回尽力而为；滚没滚干净由下面的核对说了算，这里不提前下结论。
        }
      }
      const verify = await tryNativeBlockedBy(effective, id, key)
      const leftovers = verify.probeFailed || !verify.native
        ? ['读回失败']
        : verify.native.map(keyOf).filter((kk) => wanted.includes(kk) && !currentKeys.includes(kk))
      if (leftovers.length > 0) {
        return { ok: false, fallback: false, message: `阻塞真写：原生边加上又滚不干净（残留 ${leftovers.join(', ')}），不敢再写正文行`, raw: res }
      }
      return { ok: false, fallback: true, message: '', raw: res }
    }
    added.push(w)
  }
  for (const cur of currentKeys) {
    if (wanted.includes(cur)) continue
    const linkId = linkIdOf(cur)
    if (!linkId) {
      return { ok: false, fallback: false, message: `阻塞真写：原生边 #${cur} 在回包里没有 link id，删不掉（盘上是中间态，加边已成功）`, raw: current }
    }
    const res = await c.run(['api', `${linksPath(id, key)}/${linkId}`, '--method', 'DELETE'], { timeout: GITLAB_READ_TIMEOUT_MS })
    if (res.code !== 0) {
      if (isNativeCapabilityError(res)) {
        return { ok: false, fallback: false, message: `阻塞真写：删原生边 #${cur} 时远端说没能力，但加边可能已成功，不敢滑进正文行`, raw: res }
      }
      return { ok: false, fallback: false, message: `阻塞真写：删原生边 #${cur} 失败（盘上是中间态，加边已成功）`, raw: res }
    }
  }
  return { ok: true }
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
    // 原生行原样留一份：行里写明的标题与开关状态直接当已知，不再逐张取对端。
    let nativeRows: RawBag[] = []
    try {
      const probe = await tryNativeBlockedBy(effective, id, k)
      if (probe.native && probe.native.length > 0) {
        nativeRows = probe.native
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

    // 对端状态逐张落实：原生行里写明了开关才信，没写明的逐张取对端票面；取不到的按开着记（保守方向，见 resolveBlockerStates）。
    const known = new Map<string, BlockerKnown>()
    for (const b of nativeRows) {
      const kk = String(b['iid'] || b['target_issue_iid'] || b['key'] || '')
      if (!kk) continue
      const title = typeof b['title'] === 'string' && b['title'] ? String(b['title']) : `#${kk}`
      const st = b['state']
      known.set(kk, typeof st === 'string' && (st === 'open' || st === 'closed') ? { title: title, state: st as State } : { title: title })
    }
    const blockedBy: IssueRef[] = await resolveBlockerStates(effective, id, blockedKeys.map((kk) => String(kk)), known)
    // blocking反向聚合由宿主投影，此处仅返回便利投影：blocking=[]（后端不维护第二真相）
    return { ok: true, data: { blockedBy, blocking: [] } }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身。
    return failGlab(err, errMsg(err), err, effective)
  }
}

/**
 * 写阻塞：自环先拦，两条写路径共用同一道环检；原生可达时走原生边真写（上限路径，写后读回核对），
 * 探针失败或远端没能力时滑进正文行回退（滚回不干净就不滑，如实失败）。
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
    // 探针：原生是否可用。探针挂了（免费档 403 / 端点不存在 / 网络问题）→ 正文行回退；
    // 探针活着 → 走上限：原生边真写。正文行在上限路径下只当回退写，不再当正典读。
    const probe = await tryNativeBlockedBy(effective, id, k)
    // 环检（两条写路径共用同一道门）：先拉快照、再沿边把原生并进来，统一交 hasCycle 判定。
    // 读不到的节点当叶子——那一段藏着环就拦不住，这个缺口写在 buildBlockMap 头上。
    const blockMap = await buildBlockMap(effective, id, k, wanted)
    if (hasCycle(blockMap, k, wanted)) {
      // 原文 = 这次看到的阻塞关系快照（人据此自己复算那条环），不是给人看的那句结论。
      return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: cycle detected', JSON.stringify({ key: k, wanted, observed: Array.from(blockMap.entries()) }))
    }
    if (!probe.probeFailed) {
      const keyOfProbe = (l: RawBag): string => String(l['iid'] ?? l['target_issue_iid'] ?? l['key'] ?? '')
      const res = await writeNativeBlockedBy(effective, id, k, wanted, probe.native || [], effective)
      if (!res.ok && !res.fallback) {
        // 原文 = 真写那次失败的进程结果（或构造失败时的现场）；kind 走 failGlab 的判档，结论话保留真写那句。
        return failGlab(res.raw, `setBlockedBy: ${res.message}`, res.raw, effective)
      }
      if (res.ok) {
        // 写后读回核对：上限路径的最后一道门。读回对不上（远端没落盘/并发改了），如实失败，不滑进回退。
        const back = await tryNativeBlockedBy(effective, id, k)
        // 探针三种结局要分开：probeFailed（读不出，核对不了，如实失败）；nativeEmpty（端点通、边是零条，
        // 删光之后读回就该是这个形状）；native 非空（逐条对）。把「零条」当成「读不出」是错的 —— 上面
        // tryNativeBlockedBy 特意用 nativeEmpty 区分这两者，这里必须认它，否则删光阻塞永远报读回对不上。
        const backKeys = back.probeFailed ? null : (back.native || []).map(keyOfProbe).filter(Boolean)
        const missing = backKeys ? wanted.filter((w) => !backKeys.includes(w)) : [...wanted]
        const extra = backKeys ? backKeys.filter((b) => !wanted.includes(b)) : []
        if (!backKeys || missing.length > 0 || extra.length > 0) {
          return fail(ERROR_KIND.CONFLICT as ErrorKind, `conflict: native write readback mismatch (missing ${missing.join(', ') || '无'}, extra ${extra.join(', ') || '无'})`, JSON.stringify({ key: k, wanted, backKeys }))
        }
        // 读回对上了：返回票面，对端状态逐张落实（上限路径的返回与读路径同一条纪律，不硬写 open）。
        const refreshed = (await fetchRawIssue(effective, id, k)) as unknown as RawBag
        const issue = normalizeIssue(refreshed)
        issue.blockedBy = await resolveBlockerStates(effective, id, wanted, new Map())
        return { ok: true, data: issue }
      }
      // 能力错误且滚回干净 → 滑进下面的正文行回退（res.raw 留给回退失败时拼原文，见下）。
    }

    // 回退路径：重写 description 的 Blocked by: 行（环检已在上面两条路径共用那道门里做过，这里不再做第二次）。
    const oldBody = String(raw['description'] || raw['body'] || '')
    const newBody = rewriteDescriptionWithBlockedBy(oldBody, wanted)

    const c = glabClient(effective as Partial<OpContext> & Partial<BackendContext>)
    // 换行按真换行发：远端存什么读回就是什么，读回的解析才对得上。旧代码在这里把换行转成字面 `\n`，
    // 多行正文走这条路会被破坏（读回整段变成一行，正文丢格式），2026-10-15 查实并修。
    const putRes = await c.run(['api', issuePath(id, k), '--method', 'PUT', '-f', `description=${newBody}`], { timeout: GITLAB_READ_TIMEOUT_MS })
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
        const linksRes = await glabClient(effective as Partial<OpContext> & Partial<BackendContext>).run(['api', linksPath(id, k)], { timeout: GITLAB_PROBE_TIMEOUT_MS })
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
    // 回退写后核对：PUT 回包就是读回（服务端回显更新后的票面）。要写的阻塞一个都不能少，
    // 少了说明远端没落盘或回显丢了正文，如实失败，不把「写丢了」包装成成功。
    const written = (issue.blockedBy || []).map((b) => b.key)
    const lost = wanted.filter((w) => !written.includes(w))
    if (lost.length > 0) {
      return fail(ERROR_KIND.CONFLICT as ErrorKind, `conflict: fallback write readback mismatch (missing ${lost.join(', ') || '无'})`, JSON.stringify({ key: k, wanted, written }))
    }
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身。kind 为 conflict 时这里走的是透传那一路，
    // 本家那句话原样留着，不会被换成通用提示。
    return failGlab(err, errMsg(err), err, effective)
  }
}

