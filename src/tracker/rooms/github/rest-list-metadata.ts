// src/tracker/rooms/github/rest-list-metadata.ts —— 已搬进 channels/rest/list-row-metadata.ts（#1685 阶段 1）。
//
// 这里只留转发，行为一字不变：tests/verify-github-rest-fallback.ts 与阶段 4 的接线仍按旧路径导入，
// 等 1687 批次收口时才删这一层。新代码请直接写 src/tracker/rooms/github/channels/rest/list-row-metadata.ts；
// tests/verify-room-layering.ts 会拦住「新分层代码从旧路径导入」这种写法。
export * from './channels/rest/list-row-metadata.js'
