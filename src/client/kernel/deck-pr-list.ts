/**
 * src/client/kernel/deck-pr-list.ts —— 拉取请求这一屏的数据（#1897，规格 #1885 S6）
 *
 * 为什么要有这一份：拉取请求页原来自己从会话存储里挑行（prIssuesOf）、自己判三态（prStateKind）、
 * 自己排序 —— 页面既是读口又是判据，同一张 PR 在页签与详情页就可能说出两个状态。这一份把「这一屏
 * 要画的行」一次从投影里取出来交给视图模型：行、三态、次序与四个数都在这里定下来，页面只照着画；
 * 点开一行也只喊视图模型的选中命令，不自己取数。
 *
 * 切片的形状（字段名是公开契约，页面与门禁都按它读）：
 *   rows    要画的行（投影行的拷贝，每行多一格 stateKind：'open' / 'closed' / 'merged'）；
 *   total / open / closed / merged  四个数，按同一批行算（三个状态数只数判据给出种类的行：
 *           判据缺席时三数之和会小于 total —— 那时是「不知道」，不是数据错）；
 *   version 这份投影的库版本（同一版本里页签与详情必须说同一个状态）；
 *   source  'projection'（投影在）/ 'none'（没有投影，连「有没有拉取请求」都还不知道）。
 *
 * 三条不能改的约定：
 *  1. 纯函数：不打电话、不读时钟、不改入参；同一份输入连续两次结果逐字相同。
 *  2. 三态只问调用方给的判据（生产是 views/shared/stateKind.ts 的 prStateKind），这里不另写一份
 *     「有合并时间就算已合并」；判据缺席时 stateKind 是空串，页面自己退回共享判据，免得两处口径分叉。
 *  3. 不知道 ≠ 空：没有投影时 source 是 none；投影在但一张拉取请求都没有时 source 是 projection、总数 0。
 *
 * 反例：不要在这里拼样式，也不要另判「哪些行算拉取请求」（那是 prIssuesOf 的事，这里只按
 * isPullRequest 收行）；不要在这里调任何宿主电话。
 */
declare function prIssuesOf(...args: any[]): any
declare function prStateKind(...args: any[]): any

/** 拉取请求这一屏要用的东西；字段含义见文件头。 */
export interface DeckPrList {
  rows: any[]
  total: number
  open: number
  closed: number
  merged: number
  version: number | null
  source: string
}

/** 行的次序：更新时间倒序、同一时间按票号升序 —— 与改造前的拉取请求页一致，同一份投影只出一种顺序。 */
function deckPrOrder(a: any, b: any): number {
  const au: string = String((a && a.updatedAt) || '')
  const bu: string = String((b && b.updatedAt) || '')
  if (au !== bu) return au < bu ? 1 : -1
  return Number((a && (a.number || a.key)) || 0) - Number((b && (b.number || b.key)) || 0)
}

/**
 * 从一份投影与它的候选行算出拉取请求切片。
 *
 * input.projection  视图模型 projection 切片里的那份快照；没有它时返回「不知道」。
 * input.version     这份投影的库版本（帧上带来的），不是数字时记 null。
 * input.rows        候选行（生产是 prIssuesOf 的结果：issues 与各地图的子票都收）；只按 isPullRequest 收。
 * input.stateKindOf 三态判据（生产是 prStateKind）；缺席时行上的 stateKind 为空串。
 */
export function deckPrListOf(input: any): DeckPrList {
  const projection: any = (input && input.projection) ? input.projection : null
  const raw: any[] = (projection && input && Array.isArray(input.rows)) ? input.rows : []
  const judge: any = (input && typeof input.stateKindOf === 'function') ? input.stateKindOf : null
  const rows: any[] = []
  let open = 0
  let closed = 0
  let merged = 0
  for (let i = 0; i < raw.length; i++) {
    const row: any = raw[i]
    if (!row || row.isPullRequest !== true) continue
    const kind: string = judge ? String(judge(row) || '') : ''
    if (kind === 'open') open += 1
    else if (kind === 'merged') merged += 1
    else if (kind === 'closed') closed += 1
    const copy: any = Object.assign({}, row)
    copy.stateKind = kind
    rows.push(copy)
  }
  rows.sort(deckPrOrder)
  const version: number | null = (input && typeof input.version === 'number' && isFinite(input.version)) ? input.version : null
  return { rows: rows, total: rows.length, open: open, closed: closed, merged: merged, version: version, source: projection ? 'projection' : 'none' }
}

/**
 * 生产接线用的一步：把投影帧里的投影交给 prIssuesOf 挑出拉取请求行，再用共享判据收成切片。
 * 这一份只做「取函数引用、转手调用」，不新写领域规则；两个全局都由客户端闭包里的邻居提供，
 * 门禁直接 import 本文件时按需在 globalThis 上挂好再调它。
 */
export function deckPrPortOf(frame: any): DeckPrList {
  const projection: any = (frame && frame.projection) ? frame.projection : null
  const rows: any[] = (projection && typeof prIssuesOf === 'function') ? (prIssuesOf({ snapshot: projection }) || []) : []
  const judge: any = (typeof prStateKind === 'function') ? prStateKind : null
  return deckPrListOf({ projection: projection, version: (frame ? frame.version : null), rows: rows, stateKindOf: judge })
}
