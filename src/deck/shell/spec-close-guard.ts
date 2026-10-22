// src/deck/shell/spec-close-guard.ts —— 关规格前的三道闸（#1298 T7）
// 门禁归属: tests/verify-1298-spec-close.ts
//
// 规格（spec）是容器票：它下面挂着实施票，只有「收口核对通过」之后才允许自动关闭。核对通过 =
// 实施票全部关闭 + 同一次调用里带一条逐张核对结论的评论。所以关闭动作前先过三道闸：
//   1) 实施票必须全部关闭，没关的逐张报出来（票号、标题、当前状态），回执里写清缺哪几张；
//   2) 实施票全关之后还必须有收口核对评论，没有这条评论的关闭算不合规；
//   3) 一张实施票都没有的空规格不算核对通过：没有可核对的东西，不能按完成态关它。
// 三道闸之外还有两条兜底：读不回这张票、读不回子票清单时都整笔拒绝——判不了就不关，
// 宁可这次没关成，也不能凭一次读失败把规格当成可以关。
//
// 这里只判、只读，不做任何写动作；回执文案与状态码由调用方（issue-patch）按结果渲染。
// 判定放在这里而不是工具入口，是为了让三条规则只有一处实现，也让它们能脱离工具单独验证。
import { childrenOf } from './edge-landing.js'
import { markerKindInHeader } from '../../shared/issue-file/src/marker.js'

/** 契约层的一行返回：成不成、数据、失败原话。形状收窄到本文件真正会读的字段。 */
type ContractReply = { ok?: boolean; data?: unknown; error?: { message?: unknown; kind?: unknown } } | null | undefined

/** 本闸只用到后端的两件事：读一张票、按父票列子票。 */
export interface SpecCloseTracker {
  get(repo: unknown, key: string, opts: Record<string, unknown>, ctx: unknown): Promise<ContractReply>
  list(repo: unknown, filter: Record<string, unknown>, ctx: unknown): Promise<ContractReply>
}

/**
 * 判定结果。四种：不是规格（照常关）、是规格且三道闸全过（可以关）、执行层超时（整笔按超时回）、
 * 判不过（整笔拒绝，rule 是机器可读的原因码，reads 是这次已经读了几次、用于记账）。
 */
export type SpecCloseGuardResult =
  | { kind: 'not-spec' }
  | { kind: 'ok' }
  | { kind: 'timeout'; message: string }
  | { kind: 'refuse'; rule: string; text: string; data: Record<string, unknown>; reads: number }

/** 执行层超时的原话；不是超时就回 null，一个字不改判。 */
function timeoutOf(reply: ContractReply): string | null {
  const e = reply && reply.error
  if (e && e.kind === 'timeout') return String(e.message || '执行层没回来')
  return null
}

/** 后端失败的原话（截短到 200 字）：回执里要带，但不能让一句超长报错占满整条回执。 */
function errorText(reply: ContractReply): string {
  return String((reply && reply.error && reply.error.message) || '后端没给出原因').slice(0, 200)
}

export async function specCloseGuard(input: {
  tracker: SpecCloseTracker
  repo: unknown
  key: string
  opCtx: unknown
  hasComment: boolean
}): Promise<SpecCloseGuardResult> {
  const t = input.tracker
  const key = input.key
  const rawSelf = await t.get(input.repo, key, {}, input.opCtx)
  const selfTimeout = timeoutOf(rawSelf)
  if (selfTimeout) return { kind: 'timeout', message: selfTimeout }
  if (!rawSelf || rawSelf.ok !== true) {
    const msg = errorText(rawSelf)
    return { kind: 'refuse', rule: 'spec-close-unreadable', text: '这张票没读回来（后端原话：' + msg + '）：判不了它是普通票还是规格，先不关。等能读回再调一次。', data: { error: { message: msg } }, reads: 1 }
  }
  const data: Record<string, unknown> = (rawSelf.data && typeof rawSelf.data === 'object') ? rawSelf.data as Record<string, unknown> : {}
  // 判「是不是规格」两个判据取或：三个后端的归一层都按正文文件头标记把 type 标成 spec（#1403 T1 读侧统一）。
  // 这里再用 markerKindInHeader 兜一次，是因为远端回包可能只带原始正文、或老缓存里 type 还没归一；
  // 两边同一条判据（第一个标题之前、整行精确），不会互相打架，也不会有哪家把规格读成普通票。
  const isSpec = String(data.type || '') === 'spec' || markerKindInHeader(String(data.body || '')) === 'spec'
  if (!isSpec) return { kind: 'not-spec' }

  const rawKids = await t.list(input.repo, { parentKey: key }, input.opCtx)
  const kidsTimeout = timeoutOf(rawKids)
  if (kidsTimeout) return { kind: 'timeout', message: kidsTimeout }
  if (!rawKids || rawKids.ok !== true) {
    const msg = errorText(rawKids)
    return { kind: 'refuse', rule: 'spec-close-children-unreadable', text: '这张规格下面的实施票没取到（后端原话：' + msg + '）：判不了是不是全关了，先不关。等能读回子票清单再调一次。', data: { error: { message: msg } }, reads: 2 }
  }
  const children = childrenOf(Array.isArray(rawKids.data) ? rawKids.data : [], key).children
  if (children.length === 0) {
    return { kind: 'refuse', rule: 'spec-close-no-children', text: '这张规格下面还没有实施票：没有实施票就没有可核对的东西，不能按完成态关它。先补实施票（跑 /to-tickets）再回来关。', data: {}, reads: 2 }
  }
  const openKids = children.filter((c) => String(c.state) !== 'closed')
  if (openKids.length > 0) {
    const missing = openKids.map((c) => ({ key: String(c.key || ''), title: String(c.title || ''), state: String(c.state || '') }))
    return { kind: 'refuse', rule: 'spec-close-children-open', text: '这张规格下面还有 ' + missing.length + ' 张实施票没关：' + missing.map((m) => '#' + m.key + '（' + (m.title || '没标题') + '，当前 ' + (m.state || '未知') + '）').join('；') + '。实施票没全关时不能关规格：先把没做完的做完或说明清楚，再回来走收口核对。', data: { missing: missing }, reads: 2 }
  }
  if (!input.hasComment) {
    return { kind: 'refuse', rule: 'spec-close-no-comment', text: '关规格前必须留一条评论写明逐张核对结论：这次调用里没带 comment，关闭动作没做（评论与关闭要在同一次调用里）。先在 comment 里写每一张实施票的核对结论，再带 close:true 一起调一次。', data: {}, reads: 2 }
  }
  return { kind: 'ok' }
}