// projection/counts.ts —— 面板顶上六个数字的一次查询（#1887，规格 #1885 §7）
//
// 为什么单成一份：这六个数字以前有两个来源（后端 counts / 上次已知 + 待校准），所以同一屏上
// 数字与列表可能各说一套。这一层只做一件事：用库里的行与边算出 six 个数，并把「这份答案够不够全」
// 一起带出来。数字与完整度必须一起给，消费方不能拿一个半成品去猜另一个。
//
// 一次查询：六个数字由本文件里那一条 SQL 算完（行、指派、阻塞边、墓碑各用相关子查询，SQLite 在
// 主键与唯一索引上走点查）；完整度不看行，看库级同步簿记里的「整仓完整枚举时刻」，那是另一条
// 单行读（meta 只有一行，读它不改变「六个数字由一次查询算出」这件事）。
//
// 口径（与 model/types.ts 的 SnapshotCounts 注释一一对应，改一处必须改另一处）：
//  - 只数「有 row 组记录、没被墓碑标记、不是拉取请求」的票；PR 身份未知（is_pull_request IS NULL）
//    按工单算，与界面 ticketRowsOf 的工单口径一致。
//  - total 是全部；open / closed 按小写状态严格比。状态未知的票进 total，不进 open / closed ——
//    不知道就是不知道，不拿它凑「开放」。
//  - 可接 / 阻塞 / 已认领只数还开着的票：已关闭的票不再可接、不再算阻塞，也不算在办认领。
//  - 可接 = 开放 + 指派组完整且为空 + 没有未关闭（或状态未知 / 不存在）的阻塞者。指派组缺失、
//    unknown 或 truncated 都不算「确认没人认领」，所以不算可接（三态：不知道 ≠ 空）。
//  - 阻塞 = 开放 + 至少一个阻塞者不是已关闭。目标票不存在（引用骨架）或已被墓碑标记，一律
//    按「不是已关闭」处理 —— 这与派生统计的 NOT-FOUND → 安全 blocked 是同一条口径。
//  - 已认领 = 开放 + 至少一个指派人。
//
// 完整度：整仓完整枚举时刻 > 0 → complete；否则 known。known 是诚实的下界，不是 0，
// 也不是「真的只有这么多」。写这个时刻的人只在整仓枚举完整（没被截断）时写。
import type { DatabaseSync } from 'node:sqlite'
import type { SnapshotCounts } from '../model/types.js'
import { readSyncBookkeepingRow } from '../persistence/sync-bookkeeping.js'

/**
 * 六个数字的那一条 SQL。
 *
 * 为什么写成子查询而不是先读一批行再在 JS 里数：这一层要的是「一次查询」的预算；
 * 把行读回来再数，1000 张票要传 1000 次（还只是这个数字，不含边与指派）。
 * 相关子查询都落在主键/唯一索引上：issue_assignee(issue_id, actor_id)、
 * issue_group(issue_id, group_name)、issue_edge(subject_id, kind, object_id)。
 */
const COUNTS_SQL = `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN s.state = 'open' THEN 1 ELSE 0 END), 0) AS open,
      COALESCE(SUM(CASE WHEN s.state = 'closed' THEN 1 ELSE 0 END), 0) AS closed,
      COALESCE(SUM(CASE WHEN s.state = 'open' AND s.claimed = 0 AND s.assignees_complete = 1 AND s.blocked = 0 THEN 1 ELSE 0 END), 0) AS takeable,
      COALESCE(SUM(CASE WHEN s.state = 'open' AND s.blocked = 1 THEN 1 ELSE 0 END), 0) AS blocked,
      COALESCE(SUM(CASE WHEN s.state = 'open' AND s.claimed = 1 THEN 1 ELSE 0 END), 0) AS claimed
      FROM (
        SELECT i.issue_id AS issue_id,
               LOWER(COALESCE(i.state, '')) AS state,
               EXISTS(SELECT 1 FROM issue_assignee a WHERE a.issue_id = i.issue_id) AS claimed,
               EXISTS(SELECT 1 FROM issue_group ag
                       WHERE ag.issue_id = i.issue_id AND ag.group_name = 'assignees'
                         AND ag.completeness = 'complete') AS assignees_complete,
               EXISTS(SELECT 1 FROM issue_edge e
                        JOIN issue t ON t.issue_id = e.object_id
                        LEFT JOIN issue_tombstone tt ON tt.issue_id = t.issue_id
                       WHERE e.subject_id = i.issue_id AND e.kind = 'blocks'
                         AND (LOWER(COALESCE(t.state, '')) <> 'closed' OR tt.issue_id IS NOT NULL)) AS blocked
          FROM issue i
          JOIN issue_group g ON g.issue_id = i.issue_id AND g.group_name = 'row'
          LEFT JOIN issue_tombstone tb ON tb.issue_id = i.issue_id
         WHERE tb.issue_id IS NULL
           AND COALESCE(i.is_pull_request, 0) = 0
      ) s
`

/** 六个数字的原始行形状：列名与 SQL 的别名一一对应。 */
interface CountsRow {
  total: number | bigint
  open: number | bigint
  closed: number | bigint
  takeable: number | bigint
  blocked: number | bigint
  claimed: number | bigint
}

/** SQLite 的整数在 JS 侧可能以 number 或 bigint 出现；非负、取整，坏值按 0（这一层只搬运）。 */
function countOf(value: number | bigint | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/**
 * 读一次六个数字 + 完整度。只读，不写、不缓存、不记时间。
 *
 * 完整度在同一个函数里读同步簿记：两者必须来自同一时刻的库。分开两次调用、中间夹一次写入，
 * 就会出现「数字是新的、完整度还是旧的」这种自相矛盾的答案。
 */
export function readCountsProjection(db: DatabaseSync): SnapshotCounts {
  const row = db.prepare(COUNTS_SQL).get() as CountsRow | null
  const book = readSyncBookkeepingRow(db)
  return {
    total: countOf(row && row.total),
    open: countOf(row && row.open),
    closed: countOf(row && row.closed),
    takeable: countOf(row && row.takeable),
    blocked: countOf(row && row.blocked),
    claimed: countOf(row && row.claimed),
    completeness: book.fullEnumerationMs > 0 ? 'complete' : 'known',
  }
}
