// merge/version-gate.ts —— 版本门的纯判断。
//
// 语义（#1931 起）：只看这一批「实际表达了」的组，某一组的 written_version 严格大于 startMergeVersion
// 就跳过**那一组**，同批其余组照写。没表达的组不算 —— 否则一批只写标签的读结果会被另一批只写正文的
// 提交误伤。
//
// 为什么从「整批丢弃」改成「按组跳过」：一次整份刷新带回几十张票，其中一张的行组可能刚好被另一个
// 写者更新过。整批丢弃会让调用方拿它读到的旧数据重试一遍，把那几十张票一起再写一次；按组跳过只丢
// 真正过期的那几组，代价小得多，也不会把「其实没变」的行重新盖一遍章。
//
// 整批丢弃仍然存在，但它现在只属于同步世代门（sync.expectedGeneration 不匹配）：见 runtime/ingest.ts。
// 那条门管的是「这一趟结果比库里的旧」，与「这一组比库里的旧」是两件事，不要合并成一条。

/** 把调用方给的起点归一成非负有限整数；非法值按 0 处理。 */
export function normalizeStartMergeVersion(raw: number): number {
  if (!Number.isFinite(raw)) return 0
  const n = Math.trunc(raw)
  return n < 0 ? 0 : n
}

/**
 * 这一组该不该跳过：库里这一组的 written_version 严格大于这次读的起点，说明库里那份更新。
 *
 * 没有写入记录（null / undefined / 坏值）一律不算过期：那一组从没写过，谈不上「比起点新」。
 * 反例：把「没有记录」当成 0 之外的另一个数去比较，或者拿 NaN 去比 —— NaN 与任何数比较都是 false，
 * 会把整道门静默绕过（这也是起点必须先归一的理由）。
 */
export function isGroupStale(
  startMergeVersion: number,
  writtenVersion: number | null | undefined,
): boolean {
  if (writtenVersion === null || writtenVersion === undefined) return false
  const version = Number(writtenVersion)
  if (!Number.isFinite(version)) return false
  return version > normalizeStartMergeVersion(startMergeVersion)
}
