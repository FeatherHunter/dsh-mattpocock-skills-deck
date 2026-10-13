// src/deck/tools/tool-order.ts —— 九个 deck_* 工具的装配顺序（详细语义在 deck_context 的返回值里）
//
// 本文件由 src/shared/deck-tools/plan.js 拆出（地图01 #1019 机械搬家），只挪位置不改行为。

/** 九个工具的装配顺序（描述都很短：详细语义在 deck_context 的返回值里，不进系统提示）。 */
export const DECK_TOOL_ORDER = Object.freeze([
  'deck_context', 'deck_issue_get', 'deck_map_snapshot', 'deck_issue_list', 'deck_issue_create', 'deck_map_plan_create', 'deck_map_link', 'deck_issue_patch', 'deck_issue_report',
])
