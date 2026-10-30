// src/tracker/rooms/github/issues.ts —— 已搬进 read/issues.ts（#1687 阶段 1 房间分层）。
// 只保留旧路径的导出面：读实现、provenance 组装与房间外调用方都从 read/issues.ts 走。
export * from './read/issues.js'
export { default } from './read/issues.js'
