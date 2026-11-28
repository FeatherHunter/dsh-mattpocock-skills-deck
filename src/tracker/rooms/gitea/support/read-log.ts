/**
 * src/tracker/rooms/gitea/support/read-log.ts —— gitea 房读路径「这一趟没读成」的登记出口。
 *
 * 与 GitHub / GitLab / 本地 Markdown 三座房同一条纪律（票 #14 评审收编）：read.degraded 的
 * op 与 reason 不许散着写自由串，只能取本文件两张登记清单里的值。取值表跟着调用点走：
 * 本房会报降级的读路径是——listIssues 满页截断（issues/read.ts）、listSubIssues 撞扫描上限
 * （issues/sub-issues.ts）、setBlockedBy 的环检快照拉不到放行（graph/write.ts，写路径里的
 * 这一次读降级；契约 operations.ts 写明环检不许省，但读不到时放行而非当写失败），以及仓库
 * 识别 matches（index.ts，票 #18 起：认了哪条线索、哪条线索没问成、exec 兜底问了没有、
 * 回来什么结论，都要在导出包里读得出来）。
 *
 * 事件名沿用全仓已登记的 read.degraded（research/489-appendix.md 第 1 章 #108 行，字段白名单
 * 见 tests/verify-log-fields.ts），不新开事件。字段形状保持本房原样：{ backend, op, reason,
 * elapsedMs }——与另三房的 { op, reason, latencyMs, opId } 键名不同（gitea 房从落地起就是
 * 这三个键，verify-log-fields 的白名单放行），改名是一次行为变化，不在本次收编范围内。
 *
 * 改 reason 取值的含义就当改事件，照 #489 附录的规矩另立一条，不要就地改意思。
 */

import { LIST_TRUNCATED_REASON } from '../../../contract/results.js'
import type { CtxLike } from './tea-run.js'

/**
 * 会报降级的读操作（写路径只有 setBlockedBy 的环检快照这一处读，也列在这里）。
 * 只列本房真会报降级的几条，与另三房的清单互不通用。
 * matches 是仓库识别本身（票 #18）：它不读票，但同样是一次「问线索」的读——四条线索哪条没问成、
 * exec 兜底问没问、回来什么结论，都按同一套字段落进 read.degraded。
 */
export const READ_DEGRADED_OPS = Object.freeze([
  'list',
  'listSubIssues',
  'setBlockedBy',
  'matches',
] as const)

/**
 * 这一趟为什么算「没读成」。格式是「操作名:这一步」，冒号后是短枚举：
 *  - list:truncated            : 列表只取了第一页（maxPerPage 上限 100）就按成功返回，可能还有下一页
 *  - listSubIssues:truncated   : 子票扫描撞了 subIssuesMax 硬上限，按 capped 如实交代
 *  - setBlockedBy:cycle-unchecked : 环检用的阻塞图快照拉不到，环检没法做、按契约放行（缺口认账）
 *
 * matches 这一组按「问线索问到哪一步」记（票 #18）：
 *  - matches:fs-skipped        : 上下文里没有可用的文件服务，依赖文件的两条线索（.git/config、
 *                                docs/agents/issue-tracker.md）整段跳过、继续走 exec 兜底。
 *                                这是 #17 之后的正常兜底分支，不是「识别失败」，更不等于「不是 Gitea」。
 *  - matches:git-config        : .git/config 这条线索没问成（文件不在、或读不出来），没拿到远端地址
 *  - matches:tracker-doc       : docs/agents/issue-tracker.md 这条线索没问成（文件不在、或读不出来）
 *  - matches:exec-hit          : exec 兜底真被调用了，回来的地址指向 gitea/forgejo（认出来了）
 *  - matches:exec-miss         : exec 兜底真被调用了，回来的地址不指向 gitea/forgejo（正常否定）
 *  - matches:exec-fail         : exec 兜底真被调用了，但这一问没问成：回包非零退出或带 error（git
 *                                不在、目录不是仓库、超时被杀），或实现不守契约直接抛错
 *  - matches:exec-unavailable  : 上下文里没有 exec，兜底这一问根本没发出（不等于问了没认出）
 *  - matches:unknown           : 整趟识别中途抛了别的错，按「不确定就当不是」回 false
 *
 * 为什么 exec 的三种结论都要记、而两条文件线索「读成了但没写 gitea」不记：文件线索读成那一刻
 * 就已经证明「这条问了，答案是别家」；exec 是兜底探针，它跑没跑只有日志能回答，尤其在 #17 之后
 * 无文件服务的上下路径里它是唯一线索。出现 exec-hit / exec-miss / exec-fail 三枚之一就证明兜底
 * 确实被调用过；出现 exec-unavailable 则证明没调用。
 */
export const READ_DEGRADED_REASONS = Object.freeze([
  LIST_TRUNCATED_REASON,
  'listSubIssues:truncated',
  'setBlockedBy:cycle-unchecked',
  'matches:fs-skipped',
  'matches:git-config',
  'matches:tracker-doc',
  'matches:exec-hit',
  'matches:exec-miss',
  'matches:exec-fail',
  'matches:exec-unavailable',
  'matches:unknown',
] as const)

/** op 与 reason 的登记类型：调用点传了清单外的值，编译期就红，不再靠人眼对齐。 */
export type ReadDegradedOp = (typeof READ_DEGRADED_OPS)[number]
export type ReadDegradedReason = (typeof READ_DEGRADED_REASONS)[number]

/**
 * 把「这一趟读没能拿全」落进诊断日志（best-effort：上下文没带 logEvent 就跳过，不拦主流程）。
 * 事件 read.degraded；op / reason 必须取上面两张登记清单里的值（类型上钉死）。
 *
 * @param effective 调用上下文（没有它、或它没有 logEvent 就静默跳过：读路径不许因为日志而失败）
 * @param op 哪条读操作，取 READ_DEGRADED_OPS 里的值
 * @param reason 为什么，取 READ_DEGRADED_REASONS 里的值
 * @param elapsedMs 这一笔花了多久（毫秒）。既有三条按「从入口到这里的总耗时」；matches 组按
 *                  「这一步自己花了多久」：读文件为读这一份的耗时、exec 为进程调用耗时、
 *                  fs-skipped / exec-unavailable 两档没真花时间记 0。两种口径不混用。
 */
export function emitReadDegraded(effective: CtxLike | null | undefined, op: ReadDegradedOp, reason: ReadDegradedReason, elapsedMs: number): void {
  const logEvent = effective && effective.logEvent
  if (typeof logEvent !== 'function') return
  try {
    // 契约的 logEvent 是 (level, event, fields)：读降级是「结果比预期少」的旁路记录，取 warn 档。
    // 键名写成显式「键: 值」不写简写：verify-log-fields 的静态收集器只认带冒号的键，
    // 简写会让 elapsedMs 在白名单对账里凭空消失、门禁判红（行为零变化，只是写法）。
    logEvent('warn', 'read.degraded', { backend: 'gitea', op: op, reason: reason, elapsedMs: elapsedMs })
  } catch {
    // 日志是旁路：写不进去不影响读操作本身的结论。
  }
}
