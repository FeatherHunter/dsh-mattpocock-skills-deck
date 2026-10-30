// src/tracker/rooms/github/label-colors-ops.ts —— 已拆进 write/label-colors.ts（写侧）与 read/labels.ts（读侧）。
//
// 这里只留转发，行为一字不变：房内还没搬走的文件与外部导入仍按旧路径导入，等本票末批收口时才删这一层。
// 新代码请直接写 src/tracker/rooms/github/write/label-colors.ts 或 src/tracker/rooms/github/read/labels.ts；
// tests/verify-room-layering.ts 会拦住「新分层代码从旧路径导入」这种写法。
export { setLabelColors, WRITE_CONCURRENCY_MAX, WRITE_CONCURRENCY_DEFAULT } from './write/label-colors.js'
export { listLabels, LABEL_LIST_LIMIT } from './read/labels.js'
export { default } from './write/label-colors.js'
