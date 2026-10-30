// src/tracker/rooms/github/client.ts —— 已搬进 transport/client.ts（#1684 阶段 1 房间分层）。
//
// 这里只留转发，行为一字不变：房内 22 个调用方与宿主仍按旧路径导入，等 1687 批次收口时才删这一层。
// 新代码请直接写 src/tracker/rooms/github/transport/client.ts；tests/verify-room-layering.ts
// 会拦住「新分层代码从旧路径导入」这种写法。
export * from './transport/client.js'
export { default } from './transport/client.js'
