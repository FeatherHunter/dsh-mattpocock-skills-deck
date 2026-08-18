/**
 * src/client/kernel/tabsfold.js —— client 折叠机器纯函数叶子（阶段 1 · 源真源）
 *
 * 来源：client.js / package/lib/client.js 内联定义原样抽取（issue #15 · e0f31ac 分级折叠机器）。
 * 现状（阶段 1）：client.js / package/lib/client.js 仍保留各自内联副本（零行为变化），
 *   本文件是「唯一真源 + 测试基准」；阶段 2（领域模块化）时让两边 import 本叶子的同名导出。
 * 约束：纯函数（不碰 ctx / 不碰 DOM / 无共享状态）。
 */

// 滞回带宽度（px）：折叠态需 avail ≥ 上一级自然宽 + HYST 才展开，防临界抖动
export const TABS_FOLD_HYST = 4
// 折叠档位总数：0 = 短文案全显 · 1 = 动作按钮转图标 · 2 = tab 三键也转图标
export const TABS_LEVELS = 3

/**
 * tabsLevelDecide(curLevel, avail, nats)
 *   curLevel: 当前档位（0/1/2）
 *   avail:    容器实际可用宽度（clientWidth）
 *   nats:     各级自然宽数组（nats[k] = 设档 k 时 scrollWidth），应有 TABS_LEVELS 项
 * 规则：
 *   放不下（nats[cur] > avail + 1）→ 升档；空间回够（avail ≥ nats[cur-1] + HYST）→ 降档；
 *   nats 空/非法 → 返回 0（保护）
 */
export function tabsLevelDecide(level, avail, nats) {
  if (!Array.isArray(nats) || !nats.length) return 0
  let cur = level < 0 ? 0 : level
  while (cur < nats.length - 1 && nats[cur] > avail + 1) cur++
  while (cur > 0 && avail >= nats[cur - 1] + TABS_FOLD_HYST) cur--
  return cur
}
