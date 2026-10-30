// src/tracker/rooms/github/queries.ts —— 已搬进 channels/graphql/queries.ts（#1685 阶段 1 房间分层）。
//
// 这里只留转发，行为一字不变：房内调用方与 tests/ 仍按旧路径导入，等 1687 批次收口时才删这一层。
// 新代码请直接写 src/tracker/rooms/github/channels/graphql/queries.ts；tests/verify-room-layering.ts
// 会拦住「新分层代码从旧路径导入」这种写法。
export * from './channels/graphql/queries.js'
export { default } from './channels/graphql/queries.js'
