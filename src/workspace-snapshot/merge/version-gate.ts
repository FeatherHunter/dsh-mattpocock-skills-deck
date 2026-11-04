// merge/version-gate.ts —— 版本门的纯判断。
//
// 语义与 src/refresh/kernel/snapshot-merge.ts 一致：只看这一批「实际表达了」的组，
// 任一组的 written_version 大于 startMergeVersion 就整批丢弃。没表达的组不算——
// 否则一批只写标签的读结果会被另一批只写正文的提交误伤。
//
// startMergeVersion 非法时归一成 0（与既有实现同一口径）：绝不把 NaN 带进比较，
// 否则 NaN > x 恒为 false，版本门会被静默绕过。

/** 把调用方给的起点归一成非负有限整数；非法值按 0 处理。 */
export function normalizeStartMergeVersion(raw: number): number {
  if (!Number.isFinite(raw)) return 0
  const n = Math.trunc(raw)
  return n < 0 ? 0 : n
}

/**
 * 这一批是否该丢。writtenVersions 只传本批表达的组在库里的 written_version；
 * 没有行（从没写过）不要传进来，传 0 也可以——0 永远不会大于合法起点。
 */
export function shouldDiscardBatch(
  startMergeVersion: number,
  writtenVersions: readonly number[],
): boolean {
  const start = normalizeStartMergeVersion(startMergeVersion)
  for (const version of writtenVersions) {
    if (Number.isFinite(version) && version > start) return true
  }
  return false
}
