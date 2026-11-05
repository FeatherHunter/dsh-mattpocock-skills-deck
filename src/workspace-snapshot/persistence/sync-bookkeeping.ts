// persistence/sync-bookkeeping.ts —— 库级元信息里的同步簿记三样（#1888，规格 #1885 §5）。
//
// 为什么要有它：行级增量判「远端有没有变」靠三样东西 —— 水印（上次看到哪）、世代号（迟到的结果
// 不许覆盖更新的结果）、待办（这一轮没并进去的变化）。从前这三样写在宿主快照的 delta 字段里，
// 跟着进程内存走：切会话、重启宿主之后水印与待办一起清空，重启后的第一拍又得整仓枚举；而
// 「某张票变了」的变化只补进内存时，库与界面还会说出两个值。从 #1888 起三样都住进 meta 表，
// 与数据同生共死（列由 #1886 加好：sync_watermark_ms、sync_generation、sync_pending_json）。
//
// 约定（改这里之前先读这三条）：
//   1. 簿记不是数据：只写簿记不动 merge_version、不盖行上的变化版本。版本号只由数据提交推进，
//      否则每 5 秒一拍探测都会让别人的 startMergeVersion 提前过期。
//   2. 待办存成一段 JSON：{ keys, atMs, reason }。keys 是票号字符串，atMs 与 reason 是最近一次
//      记账的时刻与原因；读的时候也认「裸数组」这种更早写法，缺什么补什么，不抛错。
//   3. expectedGeneration 是「迟到的结果不许覆盖更新的结果」在库这一侧的落点：给了它、而库里
//      当前的世代号与它不等，整笔写入一个字都不动。
import type { DatabaseSync } from 'node:sqlite'
// #1885 评审修复：簿记的类型只有契约一处（README 说过「上层只应该 import contract/ 里的东西」）。
// 这里从前另写一份，结果类型的 reason 已经漂成只有 'stale'——库侧只读 / 写失败那两档在类型上消失。
// 现在两样都从契约导入，persistence 不再声明同名类型。
import type {
  SyncBookkeeping,
  SyncBookkeepingResult,
  SyncBookkeepingWrite,
} from '../contract/types.js'

/** 空簿记：新库、或夹具还没写过时的读数。 */
export function emptySyncBookkeeping(): SyncBookkeeping {
  return { watermarkMs: 0, generation: 0, pending: [], pendingAtMs: 0, pendingReason: '', fullEnumerationMs: 0 }
}

/** 待办 JSON 的解析：认 { keys, atMs, reason } 与裸数组两种写法，坏数据按空处理。 */
export function decodePendingJson(raw: unknown): { keys: string[], atMs: number, reason: string } {
  const empty = { keys: [] as string[], atMs: 0, reason: '' }
  if (typeof raw !== 'string' || !raw) return empty
  let parsed: any = null
  try { parsed = JSON.parse(raw) } catch { return empty }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.keys) ? parsed.keys : [])
  const keys = list.map((k: any) => String(k == null ? '' : k)).filter((k: string) => k !== '')
  const atMs = (!Array.isArray(parsed) && parsed && Number.isFinite(Number(parsed.atMs))) ? Number(parsed.atMs) : 0
  const reason = (!Array.isArray(parsed) && parsed && typeof parsed.reason === 'string') ? parsed.reason : ''
  return { keys, atMs, reason }
}

/** 把簿记编码成 sync_pending_json 那一格；没有待办时写 null（与「从没有过」同一个读数）。 */
export function encodePendingJson(state: SyncBookkeeping): string | null {
  if (!state.pending.length && !state.pendingAtMs && !state.pendingReason) return null
  return JSON.stringify({ keys: state.pending, atMs: state.pendingAtMs, reason: state.pendingReason })
}

/** 读 meta 里的簿记；meta 行缺失是结构错误，直接抛（与 readMergeVersion 同一口径）。 */
export function readSyncBookkeepingRow(db: DatabaseSync): SyncBookkeeping {
  const row = db.prepare(
    `SELECT sync_watermark_ms, sync_generation, sync_pending_json, full_enumeration_ms
       FROM meta WHERE id = 1`,
  ).get() as
    | { sync_watermark_ms?: number, sync_generation?: number, sync_pending_json?: string | null, full_enumeration_ms?: number }
    | null
  if (!row) throw new Error('快照库缺少 meta 行，无法读取同步簿记')
  const pending = decodePendingJson(row.sync_pending_json)
  return {
    watermarkMs: Number(row.sync_watermark_ms ?? 0) || 0,
    generation: Number(row.sync_generation ?? 0) || 0,
    pending: pending.keys,
    pendingAtMs: pending.atMs,
    pendingReason: pending.reason,
    fullEnumerationMs: Number(row.full_enumeration_ms ?? 0) || 0,
  }
}

/** 在调用方已开的事务里写簿记；返回写完之后的状态与「有没有被世代门挡下」。 */
export function applySyncBookkeepingRow(
  db: DatabaseSync,
  write: SyncBookkeepingWrite | null | undefined,
  current: SyncBookkeeping,
): SyncBookkeepingResult {
  if (!write) return { committed: true, state: current }
  if (write.expectedGeneration !== undefined && Number(write.expectedGeneration) !== current.generation) {
    return { committed: false, state: current, reason: 'stale' }
  }
  const next: SyncBookkeeping = {
    watermarkMs: write.watermarkMs !== undefined ? Number(write.watermarkMs) || 0 : current.watermarkMs,
    generation: write.generation !== undefined ? Number(write.generation) || 0 : current.generation,
    pending: write.pending !== undefined
      ? Array.from(new Set(write.pending.map((k) => String(k == null ? '' : k)).filter((k) => k !== ''))).sort()
      : current.pending,
    pendingAtMs: write.pendingAtMs !== undefined ? Number(write.pendingAtMs) || 0 : current.pendingAtMs,
    pendingReason: write.pendingReason !== undefined ? String(write.pendingReason || '') : current.pendingReason,
    fullEnumerationMs: write.fullEnumerationMs !== undefined ? Number(write.fullEnumerationMs) || 0 : current.fullEnumerationMs,
  }
  db.prepare(
    `UPDATE meta SET
       sync_watermark_ms = ?, sync_generation = ?, sync_pending_json = ?, full_enumeration_ms = ?
     WHERE id = 1`,
  ).run(next.watermarkMs, next.generation, encodePendingJson(next), next.fullEnumerationMs)
  return { committed: true, state: next }
}
