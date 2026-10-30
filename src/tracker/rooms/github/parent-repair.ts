// src/tracker/rooms/github/parent-repair.ts —— 已搬进 read/parent-repair.ts（#1686 阶段 1 房间分层）。
//
// 这里只留转发，行为一字不变：房内还没搬走的文件与外部导入仍按旧路径导入，等 #1687 收口时才删这一层。
// 新代码请直接写 src/tracker/rooms/github/read/parent-repair.ts；tests/verify-room-layering.ts
// 会拦住「新分层代码从旧路径导入」这种写法。
export * from './read/parent-repair.js'
