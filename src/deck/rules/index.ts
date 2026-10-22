// src/deck/rules/index.ts —— 纯规则侧的整个对外面（#1039）
//
// 这一件只有一个用途：让「想知道纯规则侧一共有什么」的人（与门禁）不必逐个文件去翻。
// 内部的模块之间**不**通过这里互相引用 —— 它们直接写各自的相对路径，这样谁依赖谁在图上
// 一眼看得见，也不会因为多了一个转发层而出现难查的环。
//
// 这里的重导出全是 `export { ... } from './x.js'` 的形状而不是 `export *`：
// 一来看得见每件东西的来路，二来两件同名的东西（例如 anchor.ts 与 minimal-spec.ts 里
// 各自手写的 `labelNames` 收口函数）不会在这里撞在一起。

// —— 时钟：纯侧不读钟，时刻从形参进来 ——
export type { Timestamp } from './time.js'
export { toTimestamp } from './time.js'

// —— 幂等锚 ——
export type { AnchorParts } from './anchor.js'
export { ANCHOR_WINDOW_MS, anchorBucket, anchorKeyFor, labelNames } from './anchor.js'

// —— 强制最小规范：必备标签、进度区、整份判据 ——
export type { DeckKind } from './minimal-spec.js'
export { MAP_BLOCK_TITLES, ensureBody, ensureLabels, isWholeIssueBody } from './minimal-spec.js'

// —— 建票的两层词表：位置值 → 契约类型 / 类型标签 / 正文标记 / 父票规则 ——
// 这是「这个位置在三种后端各是什么」的唯一答案；必备标签与正文骨架都从这里取。
export type { ContractType, CreateKindResolution, ObjectKindRule, ParentRule, PositionKind } from './object-kind.js'
export {
  MAP_TICKET_LABELS, OBJECT_KIND_RULES, POSITION_KINDS, TYPE_LABELS,
  isTypeLabel, labelsToEnsure, ruleFor, resolveCreateKind, typeLabelIn,
} from './object-kind.js'

// —— 边的落点判定 ——
export type { EdgeEvidence, EdgeVerdict, Relations } from './edge-landing.js'
export { EDGE_LANDING, bodyRefersTo, classifyEdgeLanding, edgeVerdict, landingOf, relationsOf } from './edge-landing.js'

// —— 依赖图上的算法 ——
export type { BlockBatchInput, BlockBatchVerdict } from './dependency-graph.js'
export { hasCycleInAdj, refuseCyclicBlockBatch } from './dependency-graph.js'

// —— 装表与装配顺序 ——
export type { DeckTool, DeckToolDefinition, DeckToolFactory, DeckToolTable } from './tool-table.js'
export { createDeckTools } from './tool-table.js'
export { DECK_TOOL_ORDER } from './tool-order.js'

// —— 工作区配置文件的字符串翻译（编解码器由宿主侧注入） ——
export type { WorkspaceChoice, WorkspaceChoiceInput, WorkspaceCodec, WorkspaceDecodeResult, WorkspaceEncodeResult } from './workspace-file.js'
export { WORKSPACE_FILE_PROTOCOL_VERSION, WORKSPACE_FILE_SOURCE_AUTO, parseWorkspaceFile, stringifyWorkspaceFile } from './workspace-file.js'
