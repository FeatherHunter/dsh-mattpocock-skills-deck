// Star History 纯函数：聚合与增量追加，不含 IO
// 输入：starredAtList: string[] (ISO 8601)
// 输出：{ date: 'YYYY-MM-DD', total: number, daily: number }[] 按 date 升序

export function aggregateByDay(starredAtList) {
  if (!Array.isArray(starredAtList) || starredAtList.length === 0) return [];
  const dayCounts = new Map();
  for (const iso of starredAtList) {
    if (typeof iso !== 'string' || !iso) continue;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10); // YYYY-MM-DD UTC
    dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
  }
  const sortedDays = Array.from(dayCounts.keys()).sort();
  let running = 0;
  return sortedDays.map(date => {
    const daily = dayCounts.get(date);
    running += daily;
    return { date, total: running, daily };
  });
}

export function mergeHistory(existing, nextAggregated) {
  // existing 与 nextAggregated 均为按日聚合数组，返回合并后按 date 去重、total 重算
  const map = new Map();
  for (const row of [...(existing || []), ...(nextAggregated || [])]) {
    if (!row || typeof row.date !== 'string') continue;
    // 以 daily 为准，total 将重算，故只记录 daily
    const prev = map.get(row.date) || 0;
    // 若重复日期，取最大的 daily（避免重复计数），此处假设 nextAggregated 是增量，不会与 existing 同日重复，除非回溯
    map.set(row.date, Math.max(prev, row.daily || 0));
  }
  // 但更稳妥：若 existing 已有某日，nextAggregated 的同日应视为“该日新增”，需累加？
  // 简化：若 nextAggregated 来自全量回溯，则直接以全量为准；若来自增量，则日期不会重叠。
  // 因此：若 nextAggregated 包含的日期与 existing 有交集，说明是全量回溯，直接用全量的聚合结果
  if (nextAggregated && nextAggregated.length > 0 && existing && existing.length > 0) {
    const nextDates = new Set(nextAggregated.map(r => r.date));
    const hasOverlap = existing.some(r => nextDates.has(r.date));
    if (hasOverlap) {
      // 全量回溯：直接返回按 nextAggregated 重算的 total（但需与 existing 的历史前缀合并？此处假设 nextAggregated 已是全量，直接返回它）
      // 为兼容“回溯包含全部历史”的场景，返回 nextAggregated 本身（已是正确 total）
      // 若需合并前缀，日后可扩展
      return nextAggregated.slice().sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  const sorted = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  let running = 0;
  return sorted.map(([date, daily]) => {
    running += daily;
    return { date, total: running, daily };
  });
}
