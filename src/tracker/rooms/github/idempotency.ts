// src/tracker/rooms/github/idempotency.ts —— 已搬进 routing/idempotency.ts（#1686 阶段 1 房间分层）。
//
// 幂等锚回查要先选读或写、再经客户端发请求，属于路由层的取数决策，所以搬进 routing/。
// 这里只留转发，行为一字不变：房内还没搬走的文件与外部导入仍按旧路径导入，等 #1687 收口时才删这一层。
// 新代码请直接写 src/tracker/rooms/github/routing/idempotency.ts；tests/verify-room-layering.ts
// 会拦住「新分层代码从旧路径导入」这种写法。
export * from './routing/idempotency.js'
export { default } from './routing/idempotency.js'
