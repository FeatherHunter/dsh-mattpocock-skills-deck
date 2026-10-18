/**
 * src/client/kernel/tabsfold.ts —— 面板页签折叠机器纯函数叶子。
 *
 * 为什么折叠要做成纯函数：可用宽度与各级自然宽都是调用时才知道的数，
 * 算出哪一档只与这三个数有关，与界面状态无关，所以做成不碰任何外部东西的纯函数，测起来只看输入输出。
 * 本文件由 tabsfold.js 转写而来，只加类型标注，运行行为一字不改。
 * 反例：不要在这里读写界面或缓存，调用方传什么就按什么算。
 */
// 滞回带宽度（px）：折叠态需 avail ≥ 上一级自然宽 + HYST 才展开，防临界抖动
export const TABS_FOLD_HYST: number = 4
// 折叠档位总数：0 = 短文案全显 · 1 = 动作按钮转图标 · 2 = tab 三键也转图标
export const TABS_LEVELS: number = 3
/**
 * 按当前档位与可用宽度算出下一档。
 * 放不下就升档，空间回够就降档；自然宽数组缺失或非法时回 0，保证调用方永远拿到合法档位。
 */
export function tabsLevelDecide(level: any, avail: any, nats: any): number {
  if (!Array.isArray(nats) || !nats.length) return 0
  let cur: number = level < 0 ? 0 : level
  while (cur < nats.length - 1 && nats[cur] > avail + 1) cur++
  while (cur > 0 && avail >= nats[cur - 1] + TABS_FOLD_HYST) cur--
  return cur
}
