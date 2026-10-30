// src/tracker/rooms/github/graph.ts —— 已拆进 write/graph.ts（写侧）与 read/deps-read.ts（getDependencies）。
//
// 这里只留转发，行为一字不变：房内还没搬走的文件与外部导入仍按旧路径导入，等本票末批收口时才删这一层。
// 新代码请直接写 src/tracker/rooms/github/write/graph.ts 或 src/tracker/rooms/github/read/deps-read.ts；
// tests/verify-room-layering.ts 会拦住「新分层代码从旧路径导入」这种写法。
export { setParent, setBlockedBy } from './write/graph.js'
export { getDependencies } from './read/deps-read.js'
export { default } from './write/graph.js'
