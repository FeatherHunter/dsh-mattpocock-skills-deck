/**
 * src/tracker/rooms/gitlab/graph/write.ts —— 关系（阻塞边）的写半边：设置阻塞边的两条路、环检与滚回。
 *
 * 为什么搬进 graph/ 子树（#1920）：阻塞关系是一个概念，读在 ./read.ts、写在这里；根目录
 * graph-blocking.ts 已删除，入口 index.ts 的 setBlockedBy 改从本文件取。
 *
 * 写的时候两条路：原生 is_blocked_by 可达就逐条真写（POST 加、DELETE 删），写后读回核对；
 * 远端没能力（403/404/premium 字样）且滚回干净时，回退重写正文里的成对两行
 * （可见 `Blocked by:` 行 + 隐藏机器表）。环检是两条路共用的一道门；读不到的节点当叶子。
 *
 * 请求形状只在根目录 requests.ts 一处（#1920）：环检快照走 requestIssueListCapped，原生边加/删走
 * requestLinkCreate / requestLinkDelete，正文成对回退与读链接走 requestIssuePatch / requestIssueLinks。
 * 本文件只决定每次请求的时限，不再自己拼 glab 的 method、路径与表单字段。
 *
 * 读半边（getDependencies、原生阻塞能力探测 tryNativeBlockedBy、对端状态落实 resolveBlockerStates）
 * 住在 ./read.ts（#1917）；本文件从那里取，不在本文件再养一份。
 * 共享的原始票读取（fetchRawIssue）住在 issues/read.ts 一处（#1914）；
 * 仓库标识住 model/repo-identity.ts（#1910）；正文成对写法住 model/description-markers.ts。
 */
import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { Issue } from '../../../contract/entities.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { SetOpts } from '../../../contract/inputs.js'
import { TRACKER_ERROR_STAGE, type OpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { normalizeIssue } from '../normalize.js'
// 正文阻塞的回退写与环检快照只在 model/description-markers.ts 一处，本文件直接用那个出处。
import { parseBlockedByFallback, rewriteDescriptionWithBlockedPair } from '../model/description-markers.js'
import { failGlab } from '../errors.js'
// 共享的原始票读取（按 iid GET 单票）住在 issues/read.ts 一处（#1914）：亲缘文件也从那里取，不各建一份。
import { fetchRawIssue } from '../issues/read.js'
// 仓库标识的取法与优先级只在 model/repo-identity.ts 一处（#1910）。
import { repoRefId } from '../model/repo-identity.js'
// 请求的形状只在房间根目录 requests.ts 一处（#1920）：本文件只收原始进程结果，再按旧口径判档与核对。
import {
  requestIssueLinks,
  requestIssueListCapped,
  requestLinkCreate,
  requestLinkDelete,
  requestIssuePatch,
} from '../requests.js'
// 原生探测与对端状态落实住在关系读 module（#1917）：两条写路径都从那里取，不复制。
import { tryNativeBlockedBy, resolveBlockerStates } from './read.js'
import type { CtxLike, RawBag, RepoLike } from './read.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml。
import { GITLAB_READ_TIMEOUT_MS, GITLAB_PROBE_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'

// 环检：DFS 对 blockedBy 图（Kahn 简化版，针对增量检测），新边连出环就拦下这次写。
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
    // 快照的请求形状只在 requests.ts 一处（#1920）：这里只给仓库标识与这次请求的时限。
    const listRes = await requestIssueListCapped(effective, id, GITLAB_READ_TIMEOUT_MS)
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
          const line = parseBlockedByFallback(it['description'] || '')
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
): Promise<{ ok: true } | { ok: false; fallback: boolean; message: string; raw: unknown }> {
  const keyOf = (l: RawBag): string => String(l['iid'] ?? l['target_issue_iid'] ?? l['key'] ?? '')
  const currentKeys = current.map(keyOf).filter(Boolean)
  const linkIdOf = (k: string): string => {
    const row = current.find((l) => keyOf(l) === k)
    return row ? String(row['issue_link_id'] ?? row['link_id'] ?? '') : ''
  }
  const added: string[] = []
  for (const w of wanted) {
    if (currentKeys.includes(w)) continue
    // 原生边的请求形状只在 requests.ts 一处：表单顺序（target_project_id → target_issue_iid →
    // link_type）与搬迁前逐字相同，远端收到的内容不变。
    const res = await requestLinkCreate(effective, id, key, id, w, 'is_blocked_by', GITLAB_READ_TIMEOUT_MS)
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
          if (linkId) await requestLinkDelete(effective, id, key, linkId, GITLAB_READ_TIMEOUT_MS)
        } catch {
          // 滚回尽力而为；滚没滚干净由下面的核对说了算，这里不提前下结论。
        }
      }
      const verify = await tryNativeBlockedBy(effective, id, key)
      // 核对只认「多出来的原生边」：nativeEmpty（端点通、is_blocked_by 零条）说明本轮什么都没落下，
      // 滚回是干净的，可以滑进正文行回退；只有读不出（probeFailed）才算核对不了。之前这里把 nativeEmpty
      // 也当成读回失败，导致免费档（GET 通、POST 403）永远滑不进回退（#1599 真机探针查实）。
      const verifyRows = verify.probeFailed ? null : (verify.native || [])
      const leftovers = verifyRows === null
        ? ['读回失败']
        : verifyRows.map(keyOf).filter((kk) => wanted.includes(kk) && !currentKeys.includes(kk))
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
    const res = await requestLinkDelete(effective, id, key, linkId, GITLAB_READ_TIMEOUT_MS)
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
  const id = repoRefId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'setBlockedBy: repo.refId missing', '')
  const k = String(key)
  if (!k) return fail(ERROR_KIND.PARSE as ErrorKind, 'setBlockedBy: key required', '', TRACKER_ERROR_STAGE.INPUT_REFUSED)
  const wanted: string[] = Array.isArray(blockers) ? [...new Set(blockers.map(String).filter(Boolean))] : []
  // 自环先判
  // 这一处没有外部来源的原文：结论是「入参自己和自己打架」。原文给这次请求的入参快照，
  // 让人一眼看见是哪张票被指成了自己的阻塞者。
  if (wanted.includes(k)) return fail(ERROR_KIND.CONFLICT as ErrorKind, `conflict: self-loop ${k}`, JSON.stringify({ key: k, blockers: wanted }), TRACKER_ERROR_STAGE.INPUT_REFUSED)
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
    const oldBody = String(raw['description'] || raw['body'] || '')
    // 免费档形状（links 端点通、is_blocked_by 零条）下，读路径（graph/read.ts 的 getDependencies）遇到原生零条时以正文成对行为真相；
    // 写路径不能把「原生零条」当成已经取消：writeNativeBlockedBy 在 wanted=[]、current=[] 时是空操作，
    // 什么都不写就报成功，正文两行原样留着（#1801）。用「拆空后正文会变」判断正文里真有可拆的写法，
    // 有就跳过原生写，走下面的正文回退删行。
    const cancelMustClearBodyPair = probe.nativeEmpty && wanted.length === 0 && rewriteDescriptionWithBlockedPair(oldBody, []) !== oldBody
    // 环检（两条写路径共用同一道门）：先拉快照、再沿边把原生并进来，统一交 hasCycle 判定。
    // 读不到的节点当叶子——那一段藏着环就拦不住，这个缺口写在 buildBlockMap 头上。
    const blockMap = await buildBlockMap(effective, id, k, wanted)
    if (hasCycle(blockMap, k, wanted)) {
      // 原文 = 这次看到的阻塞关系快照（人据此自己复算那条环），不是给人看的那句结论。
      return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: cycle detected', JSON.stringify({ key: k, wanted, observed: Array.from(blockMap.entries()) }), TRACKER_ERROR_STAGE.INPUT_REFUSED)
    }
    if (!probe.probeFailed && !cancelMustClearBodyPair) {
      const keyOfProbe = (l: RawBag): string => String(l['iid'] ?? l['target_issue_iid'] ?? l['key'] ?? '')
      const res = await writeNativeBlockedBy(effective, id, k, wanted, probe.native || [])
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
        // 读回都读不出来时，不能再说「missing 无, extra 无」：那两句的前提是读到了东西，两个「无」凑在一起
        // 会变成「对不上却什么都没差」的自相矛盾话术（#1801 票面第二次回执）。读不出就如实说读不出。
        if (!backKeys) return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: native write readback failed (could not read back links)', JSON.stringify({ key: k, wanted }))
        const missing = wanted.filter((w) => !backKeys.includes(w))
        const extra = backKeys.filter((b) => !wanted.includes(b))
        if (missing.length > 0 || extra.length > 0) {
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

    // 回退路径：重写 description 的阻塞对（可见 Blocked by: 行 + 隐藏机器表，环检已在上面两条路径共用那道门里做过，这里不再做第二次）。
    const newBody = rewriteDescriptionWithBlockedPair(oldBody, wanted)

    // 换行按真换行发：远端存什么读回就是什么，读回的解析才对得上。旧代码在这里把换行转成字面 `\n`，
    // 多行正文走这条路会被破坏（读回整段变成一行，正文丢格式），2026-10-15 查实并修。
    const putRes = await requestIssuePatch(effective, id, k, { description: newBody }, GITLAB_READ_TIMEOUT_MS)
    if (putRes.code !== 0) {
      // 失败前再读一次票面，让现场多一份远端此刻的正文；这次读的结果不参与结论，只留给日志与
      // 排障的人看（搬迁前就有这一读，保留它是为了请求次数与失败路径逐字不变）。
      const raw2 = await fetchRawIssue(effective, id, k) // fresh
      void raw2
      // 原文 = 写阻塞那一次 PUT 的进程结果（stderr/stdout/退出码都在里面）。
      return failGlab(putRes, putRes.stderr || putRes.stdout || 'setBlockedBy failed', putRes, effective)
    }
    let updatedRaw: unknown = null
    try {
      updatedRaw = JSON.parse(putRes.stdout) as unknown
    } catch {
      updatedRaw = { iid: k, description: newBody }
    }
    // 归一并返回
    // 需补 links 未变，直接 normalize
    const ub = updatedRaw !== null && typeof updatedRaw === 'object' ? (updatedRaw as RawBag) : ({} as RawBag)
    if (!ub['links']) {
      try {
        // 读链接也走请求边界（#1917）：路径与 method 只在 requests.ts 一处，这里只给领域值与超时。
        const linksRes = await requestIssueLinks(effective, id, k, GITLAB_PROBE_TIMEOUT_MS)
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
    // 回退路径的返回与上限路径同一条纪律（上面写后读回对上那一段）：对端标题与开关逐张落实，不硬写占位。
    issue.blockedBy = await resolveBlockerStates(effective, id, (issue.blockedBy || []).map((b) => b.key), new Map())
    // 回退写后核对：PUT 回包就是读回（服务端回显更新后的票面）。要写的阻塞一个都不能少，
    // 少了说明远端没落盘或回显丢了正文，如实失败，不把「写丢了」包装成成功。
    const written = (issue.blockedBy || []).map((b) => b.key)
    const lost = wanted.filter((w) => !written.includes(w))
    const extra = written.filter((w) => !wanted.includes(w))
    if (lost.length > 0 || extra.length > 0) {
      return fail(ERROR_KIND.CONFLICT as ErrorKind, `conflict: fallback write readback mismatch (missing ${lost.join(', ') || '无'}, extra ${extra.join(', ') || '无'})`, JSON.stringify({ key: k, wanted, written }))
    }
    return { ok: true, data: issue }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身。kind 为 conflict 时这里走的是透传那一路，
    // 本家那句话原样留着，不会被换成通用提示。
    return failGlab(err, errMsg(err), err, effective)
  }
}
