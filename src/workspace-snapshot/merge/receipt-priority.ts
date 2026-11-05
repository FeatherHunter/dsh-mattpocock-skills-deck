// merge/receipt-priority.ts —— 回执优先窗口的纯判断（#1889，规格 #1885 §8）
//
// 为什么需要它：版本门只能挡「起读版本早于这次提交」的那一趟读。还有一种更隐蔽的迟到：
// 写已经在 T 时刻提交进库（版本 v10），一趟读在 T 之后才开始（起读版本也是 v10），
// 但它从远端拿到的是写之前的状态、回来得更晚。版本门对它无能为力（10 不大于 10），
// 于是刚写完的值会被这趟读顶回去——「发了又消失」正是这样发生的。
//
// 规则（按字段组判，不按行整条挡）：
//   1. 写回执提交时，把它表达过的每一组盖一个 receipt_ms（这一组最后一次由回执写入的时刻）。
//   2. 回执提交之后的 windowMs 之内，任何读结果都不得覆盖这些组；窗口一过，读结果照常覆盖。
//   3. 只有「真会覆盖值」的读结果才被挡：unknown 的组只盖章、不动值 —— 挡它没有意义。
//      评论的一页（无论 complete 还是 truncated）都算覆盖：truncated 只覆盖从头数的前几条，
//      而刚发的那一条可能正落在这一段里（见 persistence/comment-write.ts 的 replace-prefix），
//      照样会被冲掉，所以它也要让给回执。
//   4. 窗口按「票 + 组」判，不是全库暂停写入：别的票、这张票没表达过的组照常更新。
//
// 本文件只做判断，不碰数据库、不读时钟也不写死数字：窗口长度由调用方从中央时间参数传入
// （config/ttl.yaml 的 snapshotReceiptPriorityMs，生成器见 scripts/generate-time-config.mts）。

/** 组名（与 issue_group 的 group_name 一致）。判断只看这几个名字，不认别的写法。 */
export type ReceiptGroupName =
  | 'row' | 'body' | 'labels' | 'assignees' | 'parents' | 'blockedBy'
  | 'subIssues' | 'mergeInfo' | 'comments' | 'review'

/** 一组的完整度，含义与 contract 里的 GroupCompleteness 一致（这里不 import，免得判据被上层类型绑住）。 */
export type ReceiptCompleteness = 'complete' | 'truncated' | 'unknown'

/**
 * 把库里读出来的 receipt_ms 归一成「毫秒数或 null」。
 * 0、负数、NaN、非数字一律当「从没被回执写过」——宁可让读结果覆盖，也不要拿一个坏值把组永久锁住。
 */
export function normalizeReceiptMs(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.trunc(value)
}

/**
 * 把窗口长度归一成非负整数毫秒。非法值与 0 都表示「窗口关掉」：
 * 配置写坏时回执优先失效（退回改造前的行为），而不是把所有读结果永久挡在门外。
 */
export function normalizeReceiptWindowMs(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.trunc(value)
}

/**
 * 这一组此刻是否还在回执优先窗口内。
 *
 * 边界取「不到窗口算在内、正好满窗口算过期」：写完之后第 windowMs 毫秒的那一趟读可以覆盖。
 * 时钟往回调（nowMs 小于 receiptMs）时差值为负，仍算在窗口内 —— 时钟不可信时保住回执，
 * 比放一趟可能过期的读结果进来安全。
 */
export function isReceiptWindowActive(receiptMs: number | null, nowMs: number, windowMs: number): boolean {
  const receipt = normalizeReceiptMs(receiptMs)
  if (receipt === null) return false
  const window = normalizeReceiptWindowMs(windowMs)
  if (window === 0) return false
  return (nowMs - receipt) < window
}

export interface ReadGroupGuardInput {
  /** 库里这一组上次由回执写入的时刻；null = 从没被回执写过。 */
  receiptMs: number | null
  /** 这一批读结果发生的时刻（库的注入时钟）。 */
  nowMs: number
  /** 窗口长度毫秒，来自中央时间参数。 */
  windowMs: number
  /** 这一批读结果表达的组名。 */
  group: ReceiptGroupName
  /** 这一批读结果对这一组的完整度。 */
  completeness: ReceiptCompleteness
}

/**
 * 这一批「读结果」对某一组的写入要不要让给回执。
 *
 * 返回 true = 这一组这次不写（值保持回执写下的那一份、也不盖新的取数章），
 * 返回 false = 照常写。写入方仍然是写回执时永远返回 false：回执不被自己的窗口挡住。
 */
export function shouldDeferReadGroup(input: ReadGroupGuardInput): boolean {
  // 只盖章不动值的读结果不存在「覆盖」这回事。
  if (input.completeness === 'unknown') return false
  // 评论的一页也按覆盖算：truncated 只覆盖从头数的前几条，刚发的那一条可能正落在这一段里。
  return isReceiptWindowActive(input.receiptMs, input.nowMs, input.windowMs)
}
