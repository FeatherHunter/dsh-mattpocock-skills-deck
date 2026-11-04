// runtime/log.ts —— 快照库的日志出口。
//
// 仓库的既有约定是「可选注入 logEvent，缺席就完全不记」（样板见 src/tracker/kernel/log-emit.ts）。
// 这样这一层不依赖任何具体日志库，宿主接进来时再决定往哪写。
//
// 事件名与字段一旦定下就不改含义；三个边界各留一趟轨迹：
//   workspaceSnapshot.open   开库/建库/身份不符/损坏重建/退回只读
//   workspaceSnapshot.lease  抢租约结果、心跳丢失
//   workspaceSnapshot.ingest 一批写入的起点、组数、提交/丢弃、失败原因与耗时
//
// 路径不直接落盘：root 与 repo 用 8 位摘要，既能串起同一工作区又不把用户目录写进日志。
import type { SnapshotLogEvent, SnapshotLogLevel } from '../contract/types.js'

/** 记一条日志。回调自己抛错不影响快照读写——日志是旁路，不是主流程的一部分。 */
export function logSnapshot(
  logEvent: SnapshotLogEvent | undefined,
  level: SnapshotLogLevel,
  event: string,
  fields: Record<string, unknown>,
): void {
  if (!logEvent) return
  try {
    logEvent(level, event, fields)
  } catch {
    // 日志接收方的问题不该让写入失败；这里故意不转发。
  }
}

/** djb2 32 位摘要，取 8 位十六进制。只用于把同一条路径在日志里串起来，不是安全哈希。 */
export function shortHash(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
