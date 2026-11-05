/**
 * src/tracker/rooms/gitlab/graph/read.ts —— 关系（阻塞边）的读路径：读一张票被谁阻塞。
 *
 * 为什么搬进 graph/ 子树（#1917）：阻塞关系是一个概念，读与写的落点都应该在这个概念目录里。
 * 写半边搬进 graph/write.ts（#1920：设置阻塞边、环检、原生真写与正文成对回退）；读半边——
 * getDependencies、原生阻塞能力探测 tryNativeBlockedBy、对端状态落实 resolveBlockerStates——搬到这里。
 * 入口 index.ts 的 getDependencies 因此改从 './graph/read.js' 取。
 *
 * 请求的形状不在这里：原生边读根目录 requests.ts 的 requestIssueLinks；共享的原始票读取用
 * issues/read.ts 的 fetchRawIssue（它自己再走 requestIssueGet）。本文件只决定每次请求的时限，
 * 以及拿到原始进程结果之后的事：判档、解析 JSON、按三层顺序回退、把对端状态逐张落实。
 * 所以本文件不拼 glab 参数，method、路径与查询串仍然只有一个出处。
 *
 * 读的顺序是既有行为，改它之前先看 #144、#1599 的结论：原生 is_blocked_by 有值就用原生；
 * links 端点可达但没有 is_blocked_by（免费档常见形状，nativeEmpty）或探针失败（probeFailed）时，
 * 回退读正文——机器表优先、可见行兜底，认法只在 model/description-markers.ts 一处。
 * 对端状态取不到时按 open 记：不知道对端关没关，就当它还开着继续挡路（保守方向，
 * frontier 因此可能少放行，不会多放行）。返回形状固定为 { blockedBy, blocking: [] }：
 * 反向边 blocking 由宿主投影，本后端不维护第二真相。
 */

import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { BackendContext, OpContext } from '../../../contract/contexts.js'
import type { IssueRef, RepositoryRef } from '../../../contract/entities.js'
import type { ErrorKind, IssueType, State } from '../../../contract/identity.js'
import type { DepsOpts } from '../../../contract/inputs.js'
import type { Dependencies, OpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { failGlab } from '../errors.js'
// 正文回退读（机器表优先、可见行兜底）只在 model/description-markers.ts 一处，本文件直接用那个出处。
import { parseBlockedByFallback } from '../model/description-markers.js'
// 共享的原始票读取（按 iid GET 单票）住在 issues/read.ts 一处（#1914）：关系读写的几个文件都从这里取。
import { fetchRawIssue } from '../issues/read.js'
// 仓库标识的取法与优先级只在 model/repo-identity.ts 一处（#1910）。
import { repoRefId } from '../model/repo-identity.js'
// 请求的形状住在房间根目录的 requests.ts（#1912）：本文件只收原始进程结果，再按旧口径归位。
import { requestIssueLinks } from '../requests.js'
// 超时住中央 YAML，调时间改 config/timeouts.yaml；每次请求用哪一档由本文件选。
import { GITLAB_READ_TIMEOUT_MS } from '../../../../shared/time-config/src/values.js'

// 仓库身份只取 refId/name，是因为阻塞读只认这两样，拿全量会把 effortId 搅进来。
export type RepoLike = Partial<RepositoryRef> | null | undefined
// 上下文两形都收，是因为调用方有时把执行器放在 ctx、有时放在 opCtx，缺了就让请求边界按 127 回。
export type CtxLike = Partial<OpContext> & Partial<BackendContext>
// 远端回包先收成袋再读，是因为 links/iid 等字段可缺可空，直接按定型读会把缺字段当成错。
export type RawBag = Record<string, unknown>

/**
 * 原生阻塞能力探测的三种结局，必须分开记，不能合并成一个布尔。
 *
 *   native 有行：原生边读到了，行里可能自带标题与开关；
 *   nativeEmpty：links 端点通，但没有 is_blocked_by 行（免费档常见）——读路径据此回退正文，
 *     写路径把「零条」当成可用的空集合；
 *   probeFailed：这次读不出（403/404/超时/回包形状不对）——读路径回退正文，写路径则要如实失败。
 *
 * 把 nativeEmpty 与 probeFailed 混成一句「没有原生」是 #1599 修掉的缺陷：免费档取消阻塞时
 * 会把「读回零条」当成核对失败，永远滑不进正文回退。
 */
export interface NativeProbe {
  native: RawBag[] | null
  probeFailed: boolean
  nativeEmpty?: boolean
}

/**
 * 探测原生阻塞能力：GET projects/{仓库}/issues/{票号}/links，只看 link_type 是 is_blocked_by 的行。
 *
 * 为什么用 links 端点探测而不是直接读票面的 blocked_by 字段：本房取数走 REST，票面回包没有
 * 可写的 blocked_by 数组；阻塞关系就住在这些链接行的 link_type 上。relates_to 是平级关联，不算阻塞。
 *
 * GitLab 的原生阻塞是付费能力：免费档下 links 端点通常可读，但读回只有 relates_to 或空数组，
 * 所以「端点通、is_blocked_by 零条」要单独记成 nativeEmpty，而不是当成读失败。
 *
 * @param opCtx 本次调用的上下文（执行器从这里取；缺了请求边界按 127 如实回）
 * @param refId 目标仓库（形如 group/project）
 * @param key 票号（iid 字符串）
 */
export async function tryNativeBlockedBy(
  opCtx: CtxLike | null | undefined,
  refId: string,
  key: string,
): Promise<NativeProbe> {
  // 探针读不出（403/404/超时/回包形状不对）都只表示「这次探测不到原生」，交给回退路径；
  // 真写阶段的 500/超时另按故障如实失败，不滑进回退（见 ./write.ts 的 isNativeCapabilityError）。
  const res = await requestIssueLinks(opCtx, refId, key, GITLAB_READ_TIMEOUT_MS)
  if (res.code !== 0) return { native: null, probeFailed: true }
  try {
    const links: unknown = JSON.parse(res.stdout) as unknown
    if (Array.isArray(links)) {
      const blocked = (links as RawBag[]).filter(
        (l) => String(l['link_type'] || '').toLowerCase() === 'is_blocked_by',
      )
      if (blocked.length > 0) return { native: blocked, probeFailed: false }
      // links 端点可达，但没有 is_blocked_by：按「原生这次零条」记，读路径回退正文。
      return { native: null, probeFailed: false, nativeEmpty: true }
    }
  } catch {
    // 读不出链接形状就按探针失败走回退，不拦主流程。
  }
  return { native: null, probeFailed: true }
}

/**
 * 对端已知表：title 能从原生行直接拿；state 只有行里写明了才信，没写就逐张取对端票面，不猜。
 */
export interface BlockerKnown {
  title?: string
  state?: State
}

/**
 * 对端状态逐张落实：key -> { title, state }，title 取不到退回 `#key`。
 *
 * 取不到对端（删了、没权限、读失败）时 state 按 open 记：这是保守方向——不知道对端关没关，
 * 就当它还开着继续挡路；frontier 因此可能少放行，不会多放行。这个选择写在这里，调用方不用再猜。
 *
 * @param effective 本次调用的上下文（执行器从这里取）
 * @param id 目标仓库（形如 group/project）
 * @param keys 要落实的阻塞者票号
 * @param known 原生行里已经写明标题或开关的条目（按票号索引）
 */
export async function resolveBlockerStates(
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

/**
 * 读一张票被谁阻塞：原生 is_blocked_by 有值就用原生，否则回退读正文的 Blocked by 机器表/可见行。
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
  const id = repoRefId(repo)
  if (!id) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'getDependencies: repo.refId missing', '')
  const k = String(key)
  try {
    // 先读当前票本身：正文回退读要用它的 description/body。读票失败是这一趟的失败，如实回。
    let raw: RawBag | null = null
    try {
      raw = await fetchRawIssue(effective, id, k)
    } catch (e: unknown) {
      // 原文 = 读票面失败的那个 Error（它身上带着 glab 的 stderr/stdout）。
      return failGlab(e, errMsg(e), e, effective)
    }
    // 原生行原样留一份：行里写明的标题与开关直接当已知，不再逐张取对端。
    let nativeRows: RawBag[] = []
    let blockedKeys: string[] = []
    try {
      const probe = await tryNativeBlockedBy(effective, id, k)
      if (probe.native && probe.native.length > 0) {
        nativeRows = probe.native
        blockedKeys = probe.native.map((b) => String(b['iid'] || b['target_issue_iid'] || b['key'] || ''))
      } else {
        // 原生零条（免费档常见）或探测失败：按旧口径回退正文，机器表优先、可见行兜底。
        const fromLine = parseBlockedByFallback((raw && (raw['description'] || raw['body'])) || '')
        if (fromLine !== null) blockedKeys = fromLine
      }
    } catch {
      const fromLine = parseBlockedByFallback((raw && (raw['description'] || raw['body'])) || '')
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
    // blocking 反向聚合由宿主投影，此处仅返回便利投影：blocking=[]（后端不维护第二真相）。
    return { ok: true, data: { blockedBy, blocking: [] } }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身。
    return failGlab(err, errMsg(err), err, effective)
  }
}

function errMsg(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'message' in (err as Record<string, unknown>)) {
    const m = (err as Record<string, unknown>)['message']
    if (typeof m === 'string' && m) return m
  }
  return String(err)
}
