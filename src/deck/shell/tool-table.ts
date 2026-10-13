// src/deck/shell/tool-table.ts —— 把九个工具装成一张表（宿主侧门面）
//
// 本件在 #1039 拆层后只剩转发：装表这件事只算数组与对象，不碰宿主，本体已经搬到
// src/deck/rules/tool-table.ts。保留这条路径的理由同 minimal-spec 那条 —— 接线方
// （src/deck/registration/host-assemble.ts）与门禁都按老路径 import，先拆层、后改调用点，
// 两件事不搅在一起。
//
// 顺序常量（DECK_TOOL_ORDER）也在这里转出去：原来它是从 ../tools/tool-order.js 取的，
// 现在那份文件自己也搬去了纯侧，这里把两条路径都留着，谁的 import 都不用改。
export { createDeckTools } from '../rules/tool-table.js'
export type { DeckTool, DeckToolDefinition, DeckToolFactory, DeckToolTable } from '../rules/tool-table.js'
export { DECK_TOOL_ORDER } from '../rules/tool-order.js'
