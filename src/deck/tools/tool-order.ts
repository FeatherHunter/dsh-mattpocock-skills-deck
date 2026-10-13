// src/deck/tools/tool-order.ts —— 九个 deck_* 工具的装配顺序（宿主侧门面）
//
// 本件在 #1039 拆层后只剩转发：这份顺序是一串固定文字，不碰宿主，本体已经搬到
// src/deck/rules/tool-order.ts（装表在那一侧，顺序与装表住同一层才不用跨层取常量）。
// 保留这条路径的理由同 tool-table 那条：现有 import 不必跟着拆层一起改。
export { DECK_TOOL_ORDER } from '../rules/tool-order.js'
