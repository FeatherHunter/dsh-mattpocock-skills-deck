// src/tracker/rooms/github/issues-write.ts —— 已搬进 write/issues.ts（#1687 阶段 1 房间分层）。
//
// 这里只留转发，行为一字不变：房内还没搬走的文件与外部导入仍按旧路径导入，#1687 末批删除这一层。
// 新代码请直接写 src/tracker/rooms/github/write/issues.ts；tests/verify-room-layering.ts
// 会拦住「新分层代码从旧路径导入」这种写法。
export * from './write/issues.js'
