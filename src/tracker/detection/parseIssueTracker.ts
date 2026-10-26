// src/tracker/detection/parseIssueTracker.ts —— 转出口：实现在 src/tracker/kernel/issue-tracker-declaration.ts（#1555）。
//
// 为什么留这一层：detection 里的 explicitDetector / backendDecision 与工具壳装配层都按老路径引用它；
// 搬家只搬实现，引用一条都不改，也就不存在「两份解析器各说一套」。要改解析口径，改内核那一份。
export { parseIssueTracker, normalizeTrackerText } from '../kernel/issue-tracker-declaration.js'
export type { ParsedIssueTracker } from '../kernel/issue-tracker-declaration.js'
export { default } from '../kernel/issue-tracker-declaration.js'
