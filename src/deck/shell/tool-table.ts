// src/deck/shell/tool-table.ts —— 把九个工具装成一张表 { name → { definition, run } }
//
// 本文件由 src/shared/deck-tools/plan.js 拆出（地图01 #1019 机械搬家），只挪位置不改行为。

import { DECK_TOOL_ORDER } from '../tools/tool-order.js'

/**
 * 把九个工具装成一张表：{ name → { definition, run } }。
 * factories 是九个工具工厂的数组（由接线方 import 进来后传进去）；缺哪个就少哪个，
 * 缺的会被如实列在 returned.missing 里，不补一个假的桩 —— 工具要么真能用，要么不在表里。
 */
export function createDeckTools(factories, deps) {
  const d = deps || {}
  const built = {};
  const missing = []
  for (const f of (Array.isArray(factories) ? factories : [])) {
    try {
      const tool = (typeof f === 'function') ? f(d.toolDeps || {}) : f
      if (tool && tool.definition && typeof tool.run === 'function') built[tool.definition.name] = tool
    } catch (e) { /* 一个工具装不起来不影响其它八个；缺谁由下面的 missing 说出来 */ }
  }
  const names = DECK_TOOL_ORDER.filter((n) => built[n])
  for (const n of DECK_TOOL_ORDER) if (!built[n]) missing.push(n)
  return { tools: built, names: names, definitions: names.map((n) => built[n].definition), missing: missing }
}
