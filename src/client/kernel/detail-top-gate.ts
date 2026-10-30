/**
 * src/client/kernel/detail-top-gate.ts —— 票详情页顶栏的动作按钮能不能点（#1668 · 规格 #1667）
 *
 * ── 为什么要有这一份 ─────────────────────────────────────────────────────────
 * 详情页顶栏的「主动作」与「新会话」两颗按钮，在票已关闭或已合并时应当整体压灰：点了没有动作、
 * Tab 也落不上去、悬停只说「只能查看」。同一页还有「复制链接」与「在跟踪器打开」两颗只读按钮，
 * 它们不经过这里。判断收在这一个纯函数里，是为了下一张票（#1669「被还没关闭的票阻塞」）只在
 * 这里长出第二支，视图接线不用再改一次。
 *
 * ── 两条不能改的约定 ─────────────────────────────────────────────────────────
 * ① 票自身的状态只问 prStateKind（src/client/views/shared/stateKind.ts 那一份）：已合并也算关闭，
 *   而且它「先看合并时间、再看关闭状态」的顺序就是判据本身，这里不抄第二份。
 * ② 判断保持纯：不读全局界面状态、不发请求、不碰 DOM。入参就是这张票（详情回包或列表兜底快照
 *   都行）与详情回包里的被阻塞清单。容器「完成」不是关闭，容器三态不参与这里。
 */
declare function prStateKind(x: any): any

/** 判据的答案：能不能点、为什么、被哪几张票阻塞（编号升序；本票恒为空）。 */
export interface DetailTopGate {
  /** 两颗动作按钮能不能点（复制链接与在跟踪器打开不经过这里）。 */
  readonly clickable: boolean
  /** 不能点的原因；本票只会给出 closed / none，#1669 再加 blocked。 */
  readonly reason: 'closed' | 'blocked' | 'none'
  /** 明确读到「还没关闭」的阻塞票号；本票恒为空数组，#1669 才填。 */
  readonly blockedNumbers: number[]
}

/**
 * 算一次「详情页顶栏两颗动作按钮能不能点」。
 *
 * @param issue 这张票（详情回包或列表兜底快照，同一形状）。
 * @param blockedNodes 详情回包里的 blockedBy.nodes；没拿到就传空数组。
 *   本票不读它，参数先留着，免得 #1669 再改一次视图接线。
 */
export function detailTopGate(issue: any, blockedNodes?: any[]): DetailTopGate {
  // 判据函数缺席时宁可保持可点：那是接线出了问题，不该顺手把整页按钮锁死。
  const kind: string = (typeof prStateKind === 'function') ? prStateKind(issue) : 'open'
  if (kind !== 'open') return { clickable: false, reason: 'closed', blockedNumbers: [] }
  // #1669 在这里读 blockedNodes：只有明确没关闭的票才算阻塞；状态缺失或认不出的不参与。
  return { clickable: true, reason: 'none', blockedNumbers: [] }
}
