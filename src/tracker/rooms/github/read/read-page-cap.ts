/**
 * src/tracker/rooms/github/read/read-page-cap.ts —— 这一次列表最多翻几页（#1898，规格 #1885 S7）
 *
 * 为什么单独一份：翻页的两条通道（GraphQL 主路与 REST 降级路）都要按同一个数停页，
 * 而「这个数是几」由调用方经上下文给（`OpContext.listMaxPages`），不是房间自己的判断。
 * 收在一处，才不会有第三处自己再写一遍「最大 10 页」之类的数字。
 *
 * 三条不能改的约定：
 *  1. 只做归一，不做默认值：没给就回 0（= 翻到底，与改造前完全一致），房间不许在这里补一个数字
 *     ——上限只有 host-budget.ts 那一份，房间自己补一份就是第二份配置。
 *  2. 非法值（负数、小数、NaN、Infinity、字符串）一律按「没给」处理：多翻几页是浪费，不是故障。
 *  3. 停页要如实记成截断（调用方看得到「这一次没翻到底」），不许把停下来的那一页说成全部。
 */

/** 这一次列表最多翻几页；0 表示没给上限（翻到底）。 */
export function listMaxPagesOf(ctx: unknown): number {
  const bag = (ctx && typeof ctx === 'object' ? (ctx as Record<string, unknown>) : null)
  const raw = bag ? bag.listMaxPages : undefined
  if (typeof raw !== 'number' || !isFinite(raw) || raw <= 0) return 0
  return Math.floor(raw)
}

export default { listMaxPagesOf }
