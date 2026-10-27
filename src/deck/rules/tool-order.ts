// src/deck/rules/tool-order.ts —— 十个 deck_* 工具的装配顺序（纯规则侧）
//
// 本文件由 src/deck/tools/tool-order.ts 搬来（#1039：装表是纯规则侧的事，而顺序是装表的输入，
// 两者住同一层才不用跨层拿常量）。原来的路径仍然可用：src/deck/tools/tool-order.ts 只做转发。
//
// 为什么顺序要单独有一份而不是散在各处：工具装进表、注册行列出十个工具、帮助文本按序渲染，
// 三处读的都必须是同一份顺序，否则会出现「表里的序」与「帮助里的序」不一致这种没人察觉的漂移。
//
// 纯在哪：一个冻结的字符串数组，没有任何依赖。

/** 十个工具的装配顺序（描述都很短：详细语义在 deck_context 的返回值里，不进系统提示）。 */
export const DECK_TOOL_ORDER: readonly string[] = Object.freeze([
  'deck_context', 'deck_issue_get', 'deck_map_snapshot', 'deck_issue_list', 'deck_issue_create', 'deck_map_plan_create', 'deck_map_link', 'deck_issue_patch', 'deck_issue_report', 'deck_work_route',
])
