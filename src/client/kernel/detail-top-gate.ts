/**
 * src/client/kernel/detail-top-gate.ts —— 票详情页顶栏的动作按钮能不能点（#1668 / #1669 · 规格 #1667）
 *
 * ── 为什么要有这一份 ─────────────────────────────────────────────────────────
 * 详情页顶栏的「主动作」与「新会话」两颗按钮，在票已关闭、已合并或被还没关闭的票阻塞时应当
 * 整体压灰：点了没有动作、Tab 也落不上去、悬停说清原因。同一页还有「复制链接」与「在跟踪器
 * 打开」两颗只读按钮，它们不经过这里。判断收在这一个纯函数里，视图只取数、传参、按结果渲染。
 *
 * ── 两条不能改的约定 ─────────────────────────────────────────────────────────
 * ① 票自身的状态只问 prStateKind（src/client/views/shared/stateKind.ts 那一份）：已合并也算关闭，
 *   而且它「先看合并时间、再看关闭状态」的顺序就是判据本身，这里不抄第二份。
 * ② 判断保持纯：不读全局界面状态、不发请求、不碰 DOM。入参就是这张票（详情回包或列表兜底快照
 *   都行）与详情回包里的被阻塞清单。容器「完成」不是关闭，容器三态不参与这里。
 */
declare function prStateKind(x: any): any

/** 判据的答案：能不能点、为什么、被哪几张票阻塞（编号升序）。 */
export interface DetailTopGate {
  /** 两颗动作按钮能不能点（复制链接与在跟踪器打开不经过这里）。 */
  readonly clickable: boolean
  /** 不能点的原因：已关闭 / 被阻塞 / 无。 */
  readonly reason: 'closed' | 'blocked' | 'none'
  /** 明确读到「还没关闭」的阻塞票号，去重、升序；可点时恒为空数组。 */
  readonly blockedNumbers: number[]
}

/**
 * 这张阻塞票是不是「明确还没做完」。
 *
 * 只有明确读到「没关闭」才算阻塞：状态去掉前后空白、统一小写之后恰好是 open，且没有合并时间。
 * 反过来讲，这里故意不认任何「猜」出来的结论 ——
 *   · 状态字段缺失、空串、认不出的值：不知道它关没关，按未知处理，不置灰；
 *   · 带合并时间（或状态写着 closed / merged）：算已完成，不阻塞；
 *   · 票号不成（缺失、0、负数、小数、字符串）：点不出「#哪一张」，也按未知处理。
 * 宁可在数据不全时让按钮保持能点：未知只说明这一趟没读到，不代表这张票真的没做完；
 * 凭猜灰掉，等于替用户否掉一张可能已经能开工的票，而按钮自己没有任何自救路径。
 *
 * 注意不要拿 prStateKind 当这里的判据：它为了显示状态，把认不出的状态一律兜底成 open；
 * 那对徽标是对的（不知道就显示打开），对「阻塞票」却是反的 —— 会把缺字段的票当成没关闭，
 * 进而把这些票的主人锁死在「被阻塞」上。
 */
function isExplicitlyUnfinished(node: any): boolean {
  if (!node || typeof node !== 'object') return false
  // 合并时间是「已完成」的硬证据：拉取请求即使状态字段还写着 open，带着合并时间也算做完。
  if (node.mergedAt) return false
  const state: string = (node.state == null) ? '' : String(node.state).trim().toLowerCase()
  return state === 'open'
}

/** 读一张阻塞票的编号：只认可用的正整数；其余（缺失、0、负数、小数、字符串）当未知。 */
function usableTicketNumber(node: any): number | null {
  const raw: any = node && node.number
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) return null
  return raw
}

/**
 * 算一次「详情页顶栏两颗动作按钮能不能点」。
 *
 * @param issue 这张票（详情回包或列表兜底快照，同一形状）。
 * @param blockedNodes 详情回包里的 blockedBy.nodes；没拿到、不是数组都当作空数组。
 */
export function detailTopGate(issue: any, blockedNodes?: any[]): DetailTopGate {
  // 判据函数缺席时宁可保持可点：那是接线出了问题，不该顺手把整页按钮锁死。
  const kind: string = (typeof prStateKind === 'function') ? prStateKind(issue) : 'open'
  // 票自身的关闭/合并优先：两条同时命中时只说「已关闭」，更直接、也不用再列阻塞票。
  if (kind !== 'open') return { clickable: false, reason: 'closed', blockedNumbers: [] }
  const list: any[] = Array.isArray(blockedNodes) ? blockedNodes : []
  const numbers: number[] = []
  for (let i = 0; i < list.length; i++) {
    const node: any = list[i]
    if (!isExplicitlyUnfinished(node)) continue
    const n: number | null = usableTicketNumber(node)
    if (n === null) continue
    if (numbers.indexOf(n) < 0) numbers.push(n)
  }
  // 票号升序：悬停里按编号从小到大点名，读起来与列表、徽标里的顺序一致。
  numbers.sort(function (a: number, b: number) { return a - b })
  if (numbers.length) return { clickable: false, reason: 'blocked', blockedNumbers: numbers }
  return { clickable: true, reason: 'none', blockedNumbers: [] }
}
