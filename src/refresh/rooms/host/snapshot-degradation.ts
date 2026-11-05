// src/refresh/rooms/host/snapshot-degradation.ts —— 快照退化的原因值（#1899，规格 #1885「可诊断性」）
//
// 为什么单列一份：规格要求五种退化（库没接、库空、库坏、数据太旧、落后太多）在日志里分得开。
// 这五个原因值会同时出现在三处：首屏在线重建的判断、变化集回「整份」的判断、客户端版本读失败之后
// 退回整份的判断。三处各写一份字面量，改一个忘一个就会让日志里出现两个说法、按原因搜不全。
// 所以真源只有这一份，三处都从这里取。
//
// 值本身是对外契约的一部分：日志里按 reason 过滤、附录第 1 章按它登记，改值等于换事件含义；
// 要加一种退化就加一个新值，不要改动已有值的拼写。
export const SNAPSHOT_DEGRADE = {
  /** 本地快照库门面根本没接上（宿主没注入），读不到版本与变化集。 */
  libraryNotWired: 'library-not-wired',
  /** 库开得出来，但里面一行数据都没有（第一次用、刚重建完）。 */
  libraryEmpty: 'library-empty',
  /** 库坏了或打不开：完整性检查不过、整库重建过，或句柄根本开不出来。 */
  libraryCorrupt: 'library-corrupt',
  /** 客户端手上的版本太旧（超过时间上限），增量已经不可信。 */
  ageOverLimit: 'age-over-limit',
  /** 两个版本之间变化的行太多（超过行数上限），增量不值得发。 */
  rowsOverLimit: 'rows-over-limit',
  /** 客户端见过的版本比库里的大：文件被旧拷贝覆盖或库重建过，任何增量都是错的。 */
  versionRegressed: 'version-regressed',
  /** 客户端手上没有基线，猜一个 0 会把整库都算成变化。 */
  noBaseline: 'no-baseline',
} as const

/** 快照退化原因值的联合类型。日志字段 reason 只会取这几个值之一。 */
export type SnapshotDegradeReason = typeof SNAPSHOT_DEGRADE[keyof typeof SNAPSHOT_DEGRADE]

/**
 * 开库诊断里属于「本机数据被清过」的那几个码：出现任何一个，这一趟首屏没有回放就不再是「库空」，
 * 而是「库坏」——它要的是重新取一遍，不是等第一次取数。码的真源在 src/workspace-snapshot/runtime/open-schema.ts。
 */
export const SNAPSHOT_REBUILD_DIAGNOSTIC_CODES: readonly string[] = [
  'corrupt-rebuilt',
  'schema-reset',
  'identity-mismatch-rebuilt',
]

/** 这一份开库诊断里有没有「库被重建过」的证据；有就是库坏，没有才是库空。 */
export function hasRebuildDiagnostic(diagnostics: unknown): boolean {
  if (!Array.isArray(diagnostics)) return false
  for (const item of diagnostics) {
    const code = String((item && (item as { code?: unknown }).code) || '')
    if (SNAPSHOT_REBUILD_DIAGNOSTIC_CODES.indexOf(code) >= 0) return true
  }
  return false
}

/**
 * 把变化集投影给的原因归一到这一份枚举；不认识的取值原样交回。
 *
 * 为什么原样交回而不是改写成「未知」：变化集投影（src/workspace-snapshot/projection/changes.ts）
 * 是原因值的第一现场，它以后若多一档降级，日志里应当直接看见那个新值，而不是被这一层吞成一个大类。
 */
export function degradeReasonOf(raw: unknown): string {
  return typeof raw === 'string' && raw ? raw : ''
}
