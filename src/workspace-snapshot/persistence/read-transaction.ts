// persistence/read-transaction.ts —— 读事务：一次投影里的版本读取与全部查询取同一个库快照。
//
// 为什么需要它：投影是「先读库版本、再读行 / 正文 / 边、再拼形状」的一串查询。没有事务时，
// 另一个写者可以正好在这几个查询之间提交 —— 结果是同一份投影里前半截来自旧快照、后半截来自
// 新快照，界面上就出现「版本还是第 5 版，标题却已经是第 6 版的」这种自相矛盾的一屏。
//
// 约定：
//   1. 已经在事务里（db.isTransaction 为真）时直接跑，不再 BEGIN —— 嵌套 BEGIN 会抛
//      「cannot start a transaction within a transaction」，而不是安静地并进外层事务。
//   2. 只许放投影自己的查询与版本读取。渲染、组装快照、发网络电话一律放在事务外面：
//      SQLite 的读事务会一直压着 WAL 的回收位点，事务越长，别的写者留下的日志越难回收。
//   3. 读事务用不写锁的 BEGIN（不是 BEGIN IMMEDIATE）：它只取一个读快照，别的写者照常提交；
//      这正是要证的行为 —— 写者能提交，而这次投影仍旧只看写之前那一份。
//   4. 出错时先 ROLLBACK 再把原错误抛回去：把 SQLite 的锁留在这个连接上，后面的写入会被自己卡住。
import type { DatabaseSync } from 'node:sqlite'

/**
 * 在一个读事务里执行 fn，返回它的结果。
 *
 * 反例：不要把它套在「读一批 → 交给界面 → 界面再读一批」这种整段流程上；
 * 那会让事务横跨两次用户交互，这个连接会一直拿着一个旧快照，之后读到的都是过期数据。
 */
export function withReadTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn()
  db.exec('BEGIN')
  try {
    const value = fn()
    db.exec('COMMIT')
    return value
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 事务可能已被 SQLite 因错误自动回滚 */ }
    throw error
  }
}